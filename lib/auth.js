import { supabase } from './supabase';
import { clearScanLocalStorage } from './userProfile';

// ── Core auth ─────────────────────────────────────────────────────────────────

export async function signUp(email, password) {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Confirmation email will redirect here — our callback page handles the token exchange
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  return { data, error };
}

// Resends the signup confirmation email — used when the original didn't
// arrive (spam filter, slow delivery) or the user wants another shot at the
// same inbox after fixing a typo, without signing up again from scratch.
// Supabase rate-limits this endpoint server-side per email address (confirmed
// via the installed @supabase/auth-js source: resend() surfaces a plain
// AuthApiError with `.status === 429` on that limit, same shape as any other
// GoTrue call — there's no dedicated rate-limit error class). AuthModal.jsx
// layers a short client-side cooldown on top purely for UX, so the button
// doesn't invite a 429 in the first place — that cooldown is not a
// reimplementation of the security control; the server remains the real
// enforcement point regardless of what the client's timer says.
export async function resendConfirmationEmail(email) {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  return { data, error };
}

export async function signIn(email, password) {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signInWithGoogle() {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '/auth/callback' },
  });
  return { data, error };
}

export async function signInWithApple() {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '/auth/callback' },
  });
  return { data, error };
}

// requestPasswordReset() / updatePassword() — forgot-password (signed-out) and
// change-password (signed-in) flows both land on updatePassword() at the end;
// requestPasswordReset() only kicks off the email.
//
// The `?type=recovery` query param appended to redirectTo (rather than relying
// on Supabase's own template to add it) is deliberate: it survives unchanged
// regardless of which of the three shapes /auth/callback's handler ends up
// resolving the link through (PKCE `code`, `token_hash` OTP, or an implicit
// hash-fragment session) — see app/auth/callback/page.jsx's `isRecovery` check.
export async function requestPasswordReset(email) {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });
  return { data, error };
}

export async function updatePassword(newPassword) {
  if (!supabase) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  return { data, error };
}

const SIGN_OUT_TIMEOUT_MS = 6000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('signOut timed out')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// supabase.auth.signOut() (scope: 'global', the default) only clears the local
// session AFTER a successful server round-trip to revoke the token — see
// GoTrueClient#_signOut in @supabase/auth-js. A network error/timeout during
// that round-trip leaves the local session token sitting in localStorage
// untouched, which then silently logs the user back in on next load. Force it
// clear locally regardless, since tapping "Sign Out" must always end the local
// session even if the server-side revoke couldn't complete.
function clearLocalSupabaseSession() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage unavailable (private browsing, etc.) — nothing to clear
  }
}

export async function signOut() {
  if (!supabase) return { error: null };
  let error = null;
  try {
    const result = await withTimeout(supabase.auth.signOut(), SIGN_OUT_TIMEOUT_MS);
    error = result.error;
  } catch (err) {
    error = err;
  }
  if (error) {
    clearLocalSupabaseSession();
  }
  // Always wipe scan localStorage on sign-out regardless of Supabase result.
  // This prevents the next user (or anonymous session) from seeing stale data.
  clearScanLocalStorage();
  return { error };
}

export async function getUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ── User level (Supabase ↔ localStorage) ─────────────────────────────────────

/**
 * Read user_level from the Supabase profiles row and sync it to localStorage.
 * Called on sign-in so Supabase is the source of truth for signed-in users.
 * If the profile has no user_level yet, the local value is left unchanged.
 *
 * @param {string} userId
 * @returns {Promise<1|2|null>} the level that was synced, or null if none
 */
export async function syncUserLevelFromSupabase(userId) {
  if (!supabase || typeof window === 'undefined') return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_level')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const level = data.user_level;
  if (level === 1 || level === 2) {
    window.localStorage.setItem('bl_user_level', String(level));
    return level;
  }
  return null;
}

/**
 * Persist user_level to the Supabase profiles row.
 * Called whenever a signed-in user changes their level.
 *
 * @param {string} userId
 * @param {1|2}    level
 */
export async function saveUserLevelToSupabase(userId, level) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, user_level: level, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  return !error;
}

// ── Profile (Supabase) ────────────────────────────────────────────────────────

export async function getSupabaseProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return error ? null : data;
}

export async function upsertSupabaseProfile(userId, profileData) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...profileData, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  return !error;
}

// ── Scan tracking (Supabase) ──────────────────────────────────────────────────

export async function logScanToSupabase(userId, scanData) {
  if (!supabase) return false;
  const { error } = await supabase.from('scans').insert({
    user_id: userId,
    barcode: scanData.barcode || '',
    product_name: scanData.productName || '',
    verdict: scanData.verdict || 'unverified',
    flags: scanData.flags || [],
  });
  return !error;
}

export async function getSupabaseScanCountThisMonth(userId) {
  if (!supabase) return 0;
  const firstOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();
  const { count, error } = await supabase
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('scanned_at', firstOfMonth);
  return error ? 0 : (count || 0);
}

export async function getSupabaseScanHistory(userId, limit = 20) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
    .limit(limit);
  return error ? [] : (data || []);
}

// ── LocalStorage → Supabase migration ────────────────────────────────────────
// Called once on first sign-in to carry over anonymous data.

export async function migrateLocalToSupabase(userId) {
  if (!supabase || typeof window === 'undefined') return;

  const localProfile = (() => {
    try { return JSON.parse(localStorage.getItem('bl_profile') || 'null'); } catch { return null; }
  })();

  const localHistory = (() => {
    try { return JSON.parse(localStorage.getItem('bl_scan_history') || '[]'); } catch { return []; }
  })();

  // Upsert profile — only set fields we have data for
  const profilePayload = { id: userId };
  if (localProfile?.stage?.stage) profilePayload.stage = localProfile.stage.stage;
  if (localProfile?.score != null) profilePayload.score = localProfile.score;
  if (localProfile?.flags?.length) profilePayload.personal_flags = localProfile.flags;
  if (localProfile?.onboardingComplete) profilePayload.onboarding_complete = true;
  const localLevel = parseInt(localStorage.getItem('bl_user_level'), 10);
  if (localLevel === 1 || localLevel === 2) profilePayload.user_level = localLevel;

  await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });

  // Migrate scan history (avoid duplicates — best effort)
  if (localHistory.length > 0) {
    const scanRows = localHistory.map(item => ({
      user_id: userId,
      barcode: item.barcode || '',
      product_name: item.productName || '',
      verdict: item.verdict || 'unverified',
      flags: [],
      scanned_at: item.timestamp || new Date().toISOString(),
    }));
    await supabase.from('scans').insert(scanRows).select(); // ignore errors (may already exist)
  }

  // Clear ALL scan-related localStorage — Supabase is now the source of truth.
  // This prevents stale anonymous data from bleeding into this or any future session.
  clearScanLocalStorage();

  // Re-stamp the migration marker so we don't re-run on next sign-in for this user.
  localStorage.setItem('bl_migrated', userId);
}
