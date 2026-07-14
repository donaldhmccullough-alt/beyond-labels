'use strict';

/**
 * __tests__/api/cron/process-account-deletions.test.js
 *
 * Tests for GET /api/cron/process-account-deletions — the daily Vercel Cron
 * sweep that hard-deletes accounts past their grace period.
 *
 * getSupabaseServer() is mocked with a fake client whose .from(table)
 * routes to per-table, per-userId-configurable behavior, matching the real
 * handler's exact chain shapes: account_deletions.select().lte() for the
 * initial due-rows query; account_deletions.delete().eq().lte().select()
 * for the atomic claim; scans.update().eq(); profiles.delete().eq();
 * auth.admin.deleteUser().
 *
 * Suites:
 *   A. CRON_SECRET auth wiring
 *   B. No due rows
 *   C. Happy path — full processing of one or more users
 *   D. Claim race — already restored / already processed by a duplicate invocation
 *   E. Claim itself errors
 *   F. Partial failure after a successful claim — re-schedule-for-retry behavior
 *   G. Top-level query failure
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const handler = require('../../../pages/api/cron/process-account-deletions').default;

const CRON_SECRET = 'test-cron-secret-value';

function makeReq(headers = { authorization: `Bearer ${CRON_SECRET}` }) {
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

/**
 * @param {object} opts
 * @param {Array<{user_id: string, requested_at: string}>} opts.dueRows
 * @param {object|null} opts.queryError
 * @param {Object<string, {data: any, error: any}>} opts.claimResults - per-userId override; default is a successful claim
 * @param {Object<string, object|null>} opts.scansErrors - per-userId error override
 * @param {Object<string, object|null>} opts.profileErrors - per-userId error override
 * @param {Object<string, object|null>} opts.authDeleteErrors - per-userId error override
 * @param {Object<string, object|null>} opts.reinsertErrors - per-userId error override for the retry re-insert
 */
function mockSb({
  dueRows = [],
  queryError = null,
  claimResults = {},
  scansErrors = {},
  profileErrors = {},
  authDeleteErrors = {},
  reinsertErrors = {},
} = {}) {
  const calls = { claim: [], scans: [], profiles: [], authDelete: [], reinsert: [] };

  const accountDeletionsTable = {
    select: () => ({
      lte: () => Promise.resolve(
        queryError ? { data: null, error: queryError } : { data: dueRows, error: null }
      ),
    }),
    delete: () => ({
      eq: (col, userId) => ({
        lte: () => ({
          select: () => {
            calls.claim.push(userId);
            const override = claimResults[userId];
            if (override) return Promise.resolve(override);
            return Promise.resolve({ data: [{ user_id: userId }], error: null });
          },
        }),
      }),
    }),
    upsert: (payload) => {
      calls.reinsert.push(payload.user_id);
      const error = reinsertErrors[payload.user_id] ?? null;
      return Promise.resolve({ error });
    },
  };

  const scansTable = {
    update: () => ({
      eq: (col, userId) => {
        calls.scans.push(userId);
        return Promise.resolve({ error: scansErrors[userId] ?? null });
      },
    }),
  };

  const profilesTable = {
    delete: () => ({
      eq: (col, userId) => {
        calls.profiles.push(userId);
        return Promise.resolve({ error: profileErrors[userId] ?? null });
      },
    }),
  };

  const fromSpy = jest.fn((table) => {
    if (table === 'account_deletions') return accountDeletionsTable;
    if (table === 'scans') return scansTable;
    if (table === 'profiles') return profilesTable;
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const deleteUserSpy = jest.fn((userId) => {
    calls.authDelete.push(userId);
    return Promise.resolve({ data: { user: {} }, error: authDeleteErrors[userId] ?? null });
  });

  const sb = { from: fromSpy, auth: { admin: { deleteUser: deleteUserSpy } } };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, deleteUserSpy, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('A. CRON_SECRET auth wiring', () => {
  test('non-GET method → 405, CRON_SECRET never checked', async () => {
    const req = { method: 'POST', headers: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('missing Authorization header → 401, Supabase never touched', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res.statusCode).toBe(401);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('wrong secret value → 401', async () => {
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer wrong-secret' }), res);
    expect(res.statusCode).toBe(401);
  });

  test('CRON_SECRET env var unset entirely → 401, even with a plausible-looking header (no bypass)', async () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer anything' }), res);
    expect(res.statusCode).toBe(401);
  });

  test('correct secret → proceeds past the auth check', async () => {
    mockSb({ dueRows: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
  });

  test('getSupabaseServer() unavailable → 500', async () => {
    getSupabaseServer.mockReturnValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe('B. No due rows', () => {
  test('returns 200 with all-zero counts, nothing else touched', async () => {
    const { calls, deleteUserSpy } = mockSb({ dueRows: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ dueCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 });
    expect(calls.claim).toEqual([]);
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });
});

describe('C. Happy path', () => {
  test('one due user: claimed, scans anonymized, profile deleted, auth user deleted, counted as processed', async () => {
    const { calls, deleteUserSpy } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' }],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.processed).toEqual(['user-1']);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.failed).toEqual([]);
    expect(calls.claim).toEqual(['user-1']);
    expect(calls.scans).toEqual(['user-1']);
    expect(calls.profiles).toEqual(['user-1']);
    expect(deleteUserSpy).toHaveBeenCalledWith('user-1');
  });

  test('multiple due users are each processed independently', async () => {
    const { calls } = mockSb({
      dueRows: [
        { user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' },
        { user_id: 'user-2', requested_at: '2026-06-29T00:00:00.000Z' },
      ],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.processed.sort()).toEqual(['user-1', 'user-2']);
    expect(calls.scans.sort()).toEqual(['user-1', 'user-2']);
    expect(calls.profiles.sort()).toEqual(['user-1', 'user-2']);
  });

  test('order of operations: scans is anonymized before profiles is deleted, which is before the auth user is deleted', async () => {
    const order = [];
    getSupabaseServer.mockReturnValue({
      from: (table) => {
        if (table === 'account_deletions') {
          return {
            select: () => ({ lte: () => Promise.resolve({ data: [{ user_id: 'user-1', requested_at: 'x' }], error: null }) }),
            delete: () => ({ eq: () => ({ lte: () => ({ select: () => Promise.resolve({ data: [{ user_id: 'user-1' }], error: null }) }) }) }),
          };
        }
        if (table === 'scans') return { update: () => ({ eq: () => { order.push('scans'); return Promise.resolve({ error: null }); } }) };
        if (table === 'profiles') return { delete: () => ({ eq: () => { order.push('profiles'); return Promise.resolve({ error: null }); } }) };
        throw new Error(`Unexpected table: ${table}`);
      },
      auth: { admin: { deleteUser: () => { order.push('auth'); return Promise.resolve({ error: null }); } } },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['scans', 'profiles', 'auth']);
  });
});

describe('D. Claim race — already restored or already processed', () => {
  test('claim returns 0 rows → skipped, and none of the destructive steps run', async () => {
    const { calls, deleteUserSpy } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: 'x' }],
      claimResults: { 'user-1': { data: [], error: null } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.processed).toEqual([]);
    expect(res.body.skipped).toEqual(['user-1']);
    expect(res.body.failed).toEqual([]);
    expect(calls.scans).toEqual([]);
    expect(calls.profiles).toEqual([]);
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });

  test('claim returns null data (defensive) → treated the same as 0 rows, skipped', async () => {
    const { calls } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: 'x' }],
      claimResults: { 'user-1': { data: null, error: null } },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toEqual(['user-1']);
    expect(calls.scans).toEqual([]);
  });
});

describe('E. Claim itself errors', () => {
  test('claim query error → failed with stage "claim", destructive steps never run', async () => {
    const { calls, deleteUserSpy } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: 'x' }],
      claimResults: { 'user-1': { data: null, error: { message: 'claim failed' } } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.processed).toEqual([]);
    expect(res.body.failed).toEqual([{ userId: 'user-1', stage: 'claim', error: 'claim failed' }]);
    expect(calls.scans).toEqual([]);
    expect(deleteUserSpy).not.toHaveBeenCalled();
  });
});

describe('F. Partial failure after a successful claim — re-schedule-for-retry', () => {
  test('scans anonymization fails after a successful claim → re-inserted with the ORIGINAL requested_at and scheduled_for = now, counted as failed (not processed, not skipped)', async () => {
    const { calls } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' }],
      scansErrors: { 'user-1': { message: 'scans update failed' } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.processed).toEqual([]);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.failed).toEqual([{ userId: 'user-1', stage: 'partial-failure', error: 'anonymize-scans: scans update failed' }]);
    expect(calls.reinsert).toEqual(['user-1']);
    // Profile delete and auth delete must NOT have been attempted once scans failed.
    expect(calls.profiles).toEqual([]);
  });

  test('profile delete fails after scans succeeded → also re-scheduled for retry, scans anonymization is NOT undone (accepted — see file header)', async () => {
    const { calls, deleteUserSpy } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' }],
      profileErrors: { 'user-1': { message: 'profile delete failed' } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.failed[0]).toMatchObject({ userId: 'user-1', stage: 'partial-failure' });
    expect(res.body.failed[0].error).toContain('delete-profile');
    expect(calls.scans).toEqual(['user-1']); // did run
    expect(deleteUserSpy).not.toHaveBeenCalled(); // did NOT run
    expect(calls.reinsert).toEqual(['user-1']);
  });

  test('auth user delete fails after scans+profile succeeded → re-scheduled for retry', async () => {
    const { calls } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' }],
      authDeleteErrors: { 'user-1': { message: 'auth delete failed' } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.failed[0]).toMatchObject({ userId: 'user-1', stage: 'partial-failure' });
    expect(res.body.failed[0].error).toContain('delete-auth-user');
    expect(calls.reinsert).toEqual(['user-1']);
  });

  test('the re-insert itself also fails (CRITICAL case) — still reported as failed, does not throw/crash the handler', async () => {
    const { calls } = mockSb({
      dueRows: [{ user_id: 'user-1', requested_at: '2026-06-30T00:00:00.000Z' }],
      scansErrors: { 'user-1': { message: 'scans update failed' } },
      reinsertErrors: { 'user-1': { message: 'reinsert also failed' } },
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200); // the sweep as a whole still completes
    expect(res.body.failed).toEqual([{ userId: 'user-1', stage: 'partial-failure', error: 'anonymize-scans: scans update failed' }]);
    expect(calls.reinsert).toEqual(['user-1']);
  });

  test('the re-insert uses the ORIGINAL requested_at carried from the initial query, not a freshly-fabricated one', async () => {
    let capturedPayload = null;
    getSupabaseServer.mockReturnValue({
      from: (table) => {
        if (table === 'account_deletions') {
          return {
            select: () => ({ lte: () => Promise.resolve({ data: [{ user_id: 'user-1', requested_at: '2026-06-01T00:00:00.000Z' }], error: null }) }),
            delete: () => ({ eq: () => ({ lte: () => ({ select: () => Promise.resolve({ data: [{ user_id: 'user-1' }], error: null }) }) }) }),
            upsert: (payload) => { capturedPayload = payload; return Promise.resolve({ error: null }); },
          };
        }
        if (table === 'scans') return { update: () => ({ eq: () => Promise.resolve({ error: { message: 'boom' } }) }) };
        throw new Error(`Unexpected table: ${table}`);
      },
      auth: { admin: { deleteUser: jest.fn() } },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(capturedPayload).toEqual({
      user_id: 'user-1',
      requested_at: '2026-06-01T00:00:00.000Z',
      scheduled_for: expect.any(String),
    });
  });
});

describe('G. Top-level query failure', () => {
  test('the initial due-rows query itself errors → 500, no per-user processing attempted', async () => {
    const { calls } = mockSb({ queryError: { message: 'query failed' } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(calls.claim).toEqual([]);
  });

  test('an unexpected thrown exception querying due rows → 500, does not crash the handler', async () => {
    getSupabaseServer.mockReturnValue({
      from: () => { throw new Error('boom'); },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
