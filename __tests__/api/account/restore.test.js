'use strict';

/**
 * __tests__/api/account/restore.test.js
 *
 * Tests for POST /api/account/restore.
 *
 * requireUser() is mocked — token verification is covered directly in
 * lib/requireUser.test.js. getSupabaseServer() is mocked with a fake client
 * matching the real handler's delete().eq() chain.
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../lib/requireUser', () => ({
  requireUser: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const { requireUser } = require('../../../lib/requireUser');
const handler = require('../../../pages/api/account/restore').default;

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

function mockSb(deleteEqResult = { error: null }) {
  const eqSpy = jest.fn().mockResolvedValue(deleteEqResult);
  const deleteSpy = jest.fn(() => ({ eq: eqSpy }));
  const fromSpy = jest.fn((table) => {
    if (table === 'account_deletions') return { delete: deleteSpy };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, deleteSpy, eqSpy };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireUser.mockResolvedValue(USER);
});

describe('Method + auth wiring', () => {
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

describe('Restore behavior', () => {
  test('deletes the account_deletions row scoped to the verified user id — never a client-supplied one', async () => {
    const { deleteSpy, eqSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('user_id', USER.id);
  });

  test('a row that no longer exists (already restored, or already hard-deleted) — 0 rows affected is still a success, not an error', async () => {
    // Deleting a non-existent row returns { error: null } from PostgREST,
    // same as deleting a real one -- this test documents that idempotent
    // behavior explicitly rather than assuming it.
    mockSb({ error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('delete error → 500', async () => {
    mockSb({ error: { message: 'delete failed' } });
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
