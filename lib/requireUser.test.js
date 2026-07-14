'use strict';

/**
 * lib/requireUser.test.js
 *
 * Direct unit tests of requireUser() — the identity-only verification
 * helper used by the account-deletion routes (pages/api/account/*.js).
 * Mirrors lib/requireAdmin.test.js's structure closely (same
 * Authorization-header parsing, same supabase.auth.getUser(token)
 * round-trip), minus the admin-email allowlist check this helper doesn't
 * have.
 *
 * getSupabaseServer() is mocked so every test controls its own
 * auth.getUser(token) response without a real Supabase connection.
 */

jest.mock('./supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));

const { getSupabaseServer } = require('./supabaseServer');
const { requireUser } = require('./requireUser');

function makeReq(authHeader) {
  return { headers: authHeader !== undefined ? { authorization: authHeader } : {} };
}

function mockGetUser(result) {
  getSupabaseServer.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue(result) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireUser()', () => {
  test('valid token → returns the user object', async () => {
    mockGetUser({ data: { user: { id: 'u1', email: 'user@example.com' } }, error: null });
    const user = await requireUser(makeReq('Bearer real-token'));
    expect(user).toEqual({ id: 'u1', email: 'user@example.com' });
  });

  test('valid token for a user with no email set → still returns the user object (only .id is required)', async () => {
    mockGetUser({ data: { user: { id: 'u2', email: null } }, error: null });
    const user = await requireUser(makeReq('Bearer real-token'));
    expect(user).toEqual({ id: 'u2', email: null });
  });

  test('missing Authorization header → null, Supabase never called', async () => {
    const user = await requireUser(makeReq(undefined));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('Authorization header present but not "Bearer <token>" shaped → null, Supabase never called', async () => {
    const user = await requireUser(makeReq('Basic dXNlcjpwYXNz'));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('"Bearer" with no token after it → null, Supabase never called', async () => {
    const user = await requireUser(makeReq('Bearer '));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('invalid/expired token — supabase.auth.getUser returns an error → null', async () => {
    mockGetUser({ data: { user: null }, error: { message: 'invalid JWT' } });
    const user = await requireUser(makeReq('Bearer expired-token'));
    expect(user).toBeNull();
  });

  test('a user object with no id (malformed response) → null', async () => {
    mockGetUser({ data: { user: { email: 'user@example.com' } }, error: null });
    const user = await requireUser(makeReq('Bearer real-token'));
    expect(user).toBeNull();
  });

  test('supabase.auth.getUser throws → null, does not propagate the exception', async () => {
    getSupabaseServer.mockReturnValue({
      auth: { getUser: jest.fn().mockRejectedValue(new Error('network error')) },
    });
    const user = await requireUser(makeReq('Bearer some-token'));
    expect(user).toBeNull();
  });

  test('getSupabaseServer() unavailable (env vars absent) → null', async () => {
    getSupabaseServer.mockReturnValue(null);
    const user = await requireUser(makeReq('Bearer some-token'));
    expect(user).toBeNull();
  });
});
