'use strict';

/**
 * __tests__/api/account/request-deletion.test.js
 *
 * Tests for POST /api/account/request-deletion.
 *
 * requireUser() is mocked so most tests focus on the endpoint's own
 * upsert/read-back logic — token verification itself is already covered
 * directly in lib/requireUser.test.js. getSupabaseServer() is mocked with a
 * fake client whose .from('account_deletions') routes to canned responses,
 * matching the real handler's exact chain shape (upsert, then a
 * select().eq().maybeSingle() read-back).
 *
 * Suites:
 *   A. Method + auth wiring
 *   B. Successful request — insert shape, response shape
 *   C. Duplicate-request (ON CONFLICT DO NOTHING) — read-back reflects the
 *      ORIGINAL scheduled_for, not this call's locally-computed guess
 *   D. Failure handling
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../lib/requireUser', () => ({
  requireUser: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const { requireUser } = require('../../../lib/requireUser');
const handler = require('../../../pages/api/account/request-deletion').default;

const USER = { id: 'user-1', email: 'user@example.com' };

function makeReq(headers = { authorization: 'Bearer user-token' }) {
  return { method: 'POST', headers };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data)   { this.body = data;       return this; },
  };
  return res;
}

function mockSb({
  upsertResult = { error: null },
  readBackResult = { data: { scheduled_for: '2026-07-28T00:00:00.000Z' }, error: null },
} = {}) {
  const upsertSpy = jest.fn().mockResolvedValue(upsertResult);
  const maybeSingleSpy = jest.fn().mockResolvedValue(readBackResult);
  const eqSpy = jest.fn(() => ({ maybeSingle: maybeSingleSpy }));
  const selectSpy = jest.fn(() => ({ eq: eqSpy }));

  const fromSpy = jest.fn((table) => {
    if (table === 'account_deletions') return { upsert: upsertSpy, select: selectSpy };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, upsertSpy, selectSpy, eqSpy, maybeSingleSpy };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireUser.mockResolvedValue(USER);
});

describe('A. Method + auth wiring', () => {
  test('non-POST method → 405, requireUser never called', async () => {
    const req = { method: 'GET', headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(requireUser).not.toHaveBeenCalled();
  });

  test('requireUser() returns null → 401, Supabase never touched', async () => {
    requireUser.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(401);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('getSupabaseServer() unavailable → 500', async () => {
    getSupabaseServer.mockReturnValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe('B. Successful request', () => {
  test('upserts with the verified user id, ON CONFLICT (user_id) DO NOTHING semantics, ~14 days out', async () => {
    const { upsertSpy } = mockSb();
    const res = makeRes();
    const before = Date.now();

    await handler(makeReq(), res);

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [payload, options] = upsertSpy.mock.calls[0];
    expect(payload.user_id).toBe(USER.id);
    expect(options).toEqual({ onConflict: 'user_id', ignoreDuplicates: true });

    const scheduledMs = new Date(payload.scheduled_for).getTime();
    const requestedMs = new Date(payload.requested_at).getTime();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    // Allow slack for test execution time rather than asserting an exact ms value.
    expect(scheduledMs - requestedMs).toBe(fourteenDaysMs);
    expect(requestedMs).toBeGreaterThanOrEqual(before - 1000);
  });

  test('never trusts a client-supplied user id — only requireUser()\'s verified result is used', async () => {
    const { upsertSpy } = mockSb();
    const res = makeRes();
    // No body/user id on the request at all -- requireUser() is the only source.
    await handler(makeReq(), res);
    expect(upsertSpy.mock.calls[0][0].user_id).toBe(USER.id);
  });

  test('200 response echoes the read-back scheduled_for (not a locally-recomputed value)', async () => {
    mockSb({ readBackResult: { data: { scheduled_for: '2026-07-28T00:00:00.000Z' }, error: null } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, scheduledFor: '2026-07-28T00:00:00.000Z' });
  });
});

describe('C. Duplicate-request handling', () => {
  test('a second request while one is already pending: upsert is still called (ignoreDuplicates handles the no-op server-side), and the response reflects the ORIGINAL scheduled_for from the read-back, not a freshly-computed one', async () => {
    // Simulates: first request scheduled for 2026-07-20; this second request
    // (a duplicate) is silently ignored server-side by ignoreDuplicates, so
    // the read-back still returns the ORIGINAL date, not a new ~14-days-
    // from-now value.
    const { upsertSpy } = mockSb({
      readBackResult: { data: { scheduled_for: '2026-07-20T00:00:00.000Z' }, error: null },
    });
    const res = makeRes();

    await handler(makeReq(), res);

    // The upsert payload itself still contains a freshly-computed
    // scheduled_for (the route doesn't know in advance this is a
    // duplicate) -- but the RESPONSE must reflect the read-back, proving
    // the route doesn't just echo back what it attempted to write.
    const attemptedScheduledFor = upsertSpy.mock.calls[0][0].scheduled_for;
    expect(res.body.scheduledFor).toBe('2026-07-20T00:00:00.000Z');
    expect(res.body.scheduledFor).not.toBe(attemptedScheduledFor);
  });
});

describe('D. Failure handling', () => {
  test('upsert error → 500 with the error message', async () => {
    mockSb({ upsertResult: { error: { message: 'insert failed' } } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('insert failed');
  });

  test('read-back error after a successful upsert → 500', async () => {
    mockSb({ readBackResult: { data: null, error: { message: 'read failed' } } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });

  test('read-back returns no row at all (should be unreachable, but defensively handled) → 500, not a crash', async () => {
    mockSb({ readBackResult: { data: null, error: null } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });

  test('an unexpected thrown exception → 500, does not crash the handler', async () => {
    getSupabaseServer.mockReturnValue({
      from: () => { throw new Error('boom'); },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
