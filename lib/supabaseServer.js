// Server-only — never import this from a client component or any file under app/

import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';

/**
 * Null-safe Supabase client for server-side API routes.
 * Uses SUPABASE_SERVICE_ROLE_KEY (not the public anon key), which bypasses
 * RLS — appropriate for trusted server writes like scan_cache upserts and
 * unverified_ingredients captures. Never expose this client to the browser.
 *
 * Returns null when env vars are absent so cache errors never affect scans.
 */
function makeServerClient() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !roleKey) return null;

  try {
    return createClient(url, roleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    // This is the highest-blast-radius failure this file can have — every
    // scan_cache/unverified_ingredients/etc. write downstream silently
    // no-ops when this returns null (see the June 2026 incident documented
    // in CLAUDE.md's "What NOT to Do").
    Sentry.captureException(err, {
      tags: { route: 'lib/supabaseServer', op: 'client_init' },
    });
    return null;
  }
}

export function getSupabaseServer() {
  return makeServerClient();
}
