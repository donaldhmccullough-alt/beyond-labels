'use strict';

/**
 * lib/auth.test.js
 *
 * Regression coverage for the sign-out bug: tapping "Sign Out" would
 * sometimes leave a stale Supabase session in localStorage and never fire
 * SIGNED_OUT, so the app appeared stuck and snapped back to the signed-in
 * state on refresh. Root cause: supabase.auth.signOut() (scope: 'global')
 * only clears the local session after a *successful* network round-trip to
 * revoke the token server-side (see GoTrueClient#_signOut in
 * @supabase/auth-js) — a network error or hang leaves the local token
 * untouched with no timeout and no fallback.
 *
 * lib/supabase.js is mocked so no real Supabase client is constructed.
 */

jest.mock('./supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

const { supabase } = require('./supabase');
const { signOut } = require('./auth');

// jest.config.js sets testEnvironment: 'node' project-wide (API routes are
// server-side, no DOM needed) — there is no real `window`/`localStorage`
// here, so this file provides a minimal stand-in via the `global` object.
// `typeof window !== 'undefined'` in lib/auth.js / lib/userProfile.js
// resolves against `global.window`, same as it would against the real
// browser global.
function setLocalStorageKeys(keys) {
  // Real localStorage exposes its stored keys as the object's own enumerable
  // properties (that's what Object.keys(localStorage) relies on in
  // clearLocalSupabaseSession()) — so the Storage-interface methods below
  // must be defined non-enumerable, or Object.keys() would return method
  // names instead of the actual stored keys.
  const store = {};
  Object.defineProperties(store, {
    getItem: { value: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), enumerable: false },
    setItem: { value: (k, v) => { store[k] = String(v); }, enumerable: false },
    removeItem: { value: (k) => { delete store[k]; }, enumerable: false },
    clear: { value: () => { Object.keys(store).forEach((k) => delete store[k]); }, enumerable: false },
  });
  Object.entries(keys).forEach(([k, v]) => { store[k] = v; });
  // lib/auth.js reads via `window.localStorage`; lib/userProfile.js reads via
  // the bare `localStorage` global — both must point at the same store.
  global.window = { localStorage: store };
  global.localStorage = store;
}

describe('lib/auth signOut()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    setLocalStorageKeys({
      'sb-abcdefgh-auth-token': JSON.stringify({ access_token: 'fake' }),
      'bl_scans': '{"scanCount":1}',
      'bl_scan_history': '[]',
      'bl_total_scans': '3',
      'bl_migrated': 'user-123',
      'bl_profile': '{"stage":"x"}', // must survive — clearScanLocalStorage doesn't touch this
    });
  });

  test('success path: awaits supabase.auth.signOut(), returns no error, leaves any already-cleared session alone', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: null });

    const result = await signOut();

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
  });

  test('success path wipes scan-related localStorage but not bl_profile', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: null });

    await signOut();

    expect(window.localStorage.getItem('bl_scans')).toBeNull();
    expect(window.localStorage.getItem('bl_scan_history')).toBeNull();
    expect(window.localStorage.getItem('bl_total_scans')).toBeNull();
    expect(window.localStorage.getItem('bl_migrated')).toBeNull();
    expect(window.localStorage.getItem('bl_profile')).not.toBeNull();
  });

  test('network error from supabase.auth.signOut(): returns the error AND force-clears the local sb-*-auth-token key', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: new Error('Network request failed') });

    const result = await signOut();

    expect(result.error).toBeTruthy();
    // This is the core regression assertion — before the fix, a returned error
    // was never inspected, so this key would still be sitting in localStorage,
    // causing the next getSession() call to silently re-authenticate the user.
    expect(window.localStorage.getItem('sb-abcdefgh-auth-token')).toBeNull();
  });

  test('supabase.auth.signOut() rejecting outright is treated the same as a returned error — local session still force-cleared', async () => {
    supabase.auth.signOut.mockRejectedValue(new Error('fetch failed'));

    const result = await signOut();

    expect(result.error).toBeTruthy();
    expect(window.localStorage.getItem('sb-abcdefgh-auth-token')).toBeNull();
  });

  test('a hanging supabase.auth.signOut() (never resolves) times out instead of hanging forever, and force-clears the local session', async () => {
    jest.useFakeTimers();
    supabase.auth.signOut.mockReturnValue(new Promise(() => {})); // never resolves

    const pending = signOut();
    // Advance past the internal timeout without waiting on real wall-clock time —
    // this is what proves the "stuck spinner" symptom is now bounded.
    await jest.advanceTimersByTimeAsync(6000);
    const result = await pending;

    expect(result.error).toBeTruthy();
    expect(window.localStorage.getItem('sb-abcdefgh-auth-token')).toBeNull();

    jest.useRealTimers();
  });

  test('only removes keys matching the sb-*-auth-token pattern — leaves unrelated keys (including a differently-shaped sb- key) untouched', async () => {
    setLocalStorageKeys({
      'sb-abcdefgh-auth-token': 'stale-session',
      'sb-abcdefgh-auth-token-code-verifier': 'unrelated-pkce-artifact',
      'bl_user_level': '2',
    });
    supabase.auth.signOut.mockResolvedValue({ error: new Error('offline') });

    await signOut();

    expect(window.localStorage.getItem('sb-abcdefgh-auth-token')).toBeNull();
    expect(window.localStorage.getItem('sb-abcdefgh-auth-token-code-verifier')).toBe('unrelated-pkce-artifact');
    expect(window.localStorage.getItem('bl_user_level')).toBe('2');
  });

  test('does not invoke the local-session fallback when signOut succeeds', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: null });

    await signOut();

    // The mocked supabase.auth.signOut() doesn't itself touch localStorage
    // (that's the real library's internal _removeSession() job, out of scope
    // for this mock) — so if our code's own fallback clearing fired here too,
    // this key would be gone. It shouldn't have fired: a successful result
    // means the real client already handled clearing, and our fallback exists
    // only to cover the failure case.
    expect(window.localStorage.getItem('sb-abcdefgh-auth-token')).toBe(JSON.stringify({ access_token: 'fake' }));
  });
});
