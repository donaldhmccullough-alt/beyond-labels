import { supabase } from './supabase';

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

export async function signOut() {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.signOut();
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

  // Mark migration done in localStorage so we don't re-run
  localStorage.setItem('bl_migrated', userId);
}
