'use strict';

/**
 * __tests__/api/account/deletion-status.test.js
 *
 * Tests for GET /api/account/deletion-status.
 *
 * requireUser() is mocked — token verification is covered directly in
 * lib/requireUser.test.js. getSupabaseServer() is mocked with a fake client
 * matching the real handler's select().eq().maybeSingle() chain.
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../lib/requireUser', () => ({
  requireUser: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const { requireUser } = require('../../../lib/requireUser');
const handler = require('../../../pages/api/account/deletion-status').default;

const USER = { id: 'user-1', email: 'user@example.com' };

function makeReq(headers = { authorization: 'Bearer user-token' }) {
  return { method: 'GET', headers };
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

function mockSb(selectResult) {
  const maybeSingleSpy = jest.fn().mockResolvedValue(selectResult);
  const eqSpy = jest.fn(() => ({ maybeSingle: maybeSingleSpy }));
  const selectSpy = jest.fn(() => ({ eq: eqSpy }));
  const fromSpy = jest.fn((table) => {
    if (table === 'account_deletions') return { select: selectSpy };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, selectSpy, eqSpy, maybeSingleSpy };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireUser.mockResolvedValue(USER);
});

describe('Method + auth wiring', () => {
  test('non-GET method → 405, requireUser never called', async () => {
    const req = { method: 'POST', headers: {} };
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

describe('Status shapes', () => {
  test('a pending row exists → pending: true, scheduledFor from the row', async () => {
    const { eqSpy } = mockSb({ data: { scheduled_for: '2026-07-28T00:00:00.000Z' }, error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pending: true, scheduledFor: '2026-07-28T00:00:00.000Z' });
    // Scoped to the verified user's own id, never a client-supplied one.
    expect(eqSpy).toHaveBeenCalledWith('user_id', USER.id);
  });

  test('no pending row → pending: false, scheduledFor: null', async () => {
    mockSb({ data: null, error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pending: false, scheduledFor: null });
  });

  test('query error → 500', async () => {
    mockSb({ data: null, error: { message: 'query failed' } });
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
