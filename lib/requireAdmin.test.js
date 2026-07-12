'use strict';

/**
 * lib/requireAdmin.test.js
 *
 * Direct unit tests of requireAdmin() — the reusable admin-auth check used
 * by every admin-only API route (GET /api/admin/swap-candidates today;
 * Phase 3b's approve/reject actions will reuse the same helper). Co-located
 * with the module under test, same convention as lib/rulesEngine.test.js
 * and lib/verdictRules.test.js.
 *
 * getSupabaseServer() is mocked so every test controls its own
 * auth.getUser(token) response without a real Supabase connection.
 */

jest.mock('./supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));

const { getSupabaseServer } = require('./supabaseServer');
const { requireAdmin } = require('./requireAdmin');

function makeReq(authHeader) {
  return { headers: authHeader !== undefined ? { authorization: authHeader } : {} };
}

function mockGetUser(result) {
  getSupabaseServer.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue(result) },
  });
}

const ADMIN_EMAIL = 'admin@beyondlabels.example';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe('requireAdmin()', () => {
  test('valid token + admin email → returns the user object', async () => {
    mockGetUser({ data: { user: { email: ADMIN_EMAIL, id: 'u1' } }, error: null });
    const user = await requireAdmin(makeReq(`Bearer real-token`));
    expect(user).toEqual({ email: ADMIN_EMAIL, id: 'u1' });
  });

  test('valid token + non-admin email → null (401 territory)', async () => {
    mockGetUser({ data: { user: { email: 'not-admin@example.com', id: 'u2' } }, error: null });
    const user = await requireAdmin(makeReq('Bearer real-token'));
    expect(user).toBeNull();
  });

  test('missing Authorization header → null, Supabase never called', async () => {
    const user = await requireAdmin(makeReq(undefined));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('Authorization header present but not "Bearer <token>" shaped → null, Supabase never called', async () => {
    const user = await requireAdmin(makeReq('Basic dXNlcjpwYXNz'));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('"Bearer" with no token after it → null, Supabase never called', async () => {
    const user = await requireAdmin(makeReq('Bearer '));
    expect(user).toBeNull();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test('invalid/expired token — supabase.auth.getUser returns an error → null', async () => {
    mockGetUser({ data: { user: null }, error: { message: 'invalid JWT' } });
    const user = await requireAdmin(makeReq('Bearer expired-token'));
    expect(user).toBeNull();
  });

  test('supabase.auth.getUser throws → null, does not propagate the exception', async () => {
    getSupabaseServer.mockReturnValue({
      auth: { getUser: jest.fn().mockRejectedValue(new Error('network error')) },
    });
    const user = await requireAdmin(makeReq('Bearer some-token'));
    expect(user).toBeNull();
  });

  test('getSupabaseServer() unavailable (env vars absent) → null', async () => {
    getSupabaseServer.mockReturnValue(null);
    const user = await requireAdmin(makeReq('Bearer some-token'));
    expect(user).toBeNull();
  });

  test('ADMIN_EMAILS match is case-insensitive', async () => {
    process.env.ADMIN_EMAILS = 'Admin@BeyondLabels.example';
    mockGetUser({ data: { user: { email: 'admin@beyondlabels.example', id: 'u1' } }, error: null });
    const user = await requireAdmin(makeReq('Bearer real-token'));
    expect(user).not.toBeNull();
  });

  test('ADMIN_EMAILS supports multiple comma-separated entries with surrounding whitespace', async () => {
    process.env.ADMIN_EMAILS = ' first@example.com , admin@beyondlabels.example ,third@example.com';
    mockGetUser({ data: { user: { email: ADMIN_EMAIL, id: 'u1' } }, error: null });
    const user = await requireAdmin(makeReq('Bearer real-token'));
    expect(user).not.toBeNull();
  });

  test('ADMIN_EMAILS unset entirely → every user is rejected', async () => {
    delete process.env.ADMIN_EMAILS;
    mockGetUser({ data: { user: { email: ADMIN_EMAIL, id: 'u1' } }, error: null });
    const user = await requireAdmin(makeReq('Bearer real-token'));
    expect(user).toBeNull();
  });
});
