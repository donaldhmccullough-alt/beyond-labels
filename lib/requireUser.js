// Server-only — never import this from a client component or any file under app/

import { getSupabaseServer } from './supabaseServer';
import * as Sentry from '@sentry/nextjs';

/**
 * Verifies the caller of an API route is a signed-in Supabase user, and
 * returns that user's own object — nothing more. This is requireAdmin.js's
 * identity-verification step (Authorization: Bearer <token> ->
 * supabase.auth.getUser(token), a real round-trip to Supabase Auth, not a
 * local JWT decode) without the admin-email allowlist check, for routes
 * that only need to know "who is this, really" so they can scope a query to
 * that user's own data — never trusting a client-supplied user id directly.
 *
 * Used by the account-deletion routes (pages/api/account/*.js): a user can
 * request deletion of, check the status of, or restore only their own
 * account_deletions row, because the row they're allowed to touch is
 * derived from the verified token, not from anything the request body or
 * query string claims.
 *
 * Returns the Supabase user object on success, or `null` on any failure
 * (missing/malformed Authorization header, invalid/expired token, or
 * Supabase unavailable). Callers should respond 401 when this returns null.
 *
 * @param {import('next').NextApiRequest} req
 * @returns {Promise<object|null>}
 */
export async function requireUser(req) {
  const authHeader = req.headers?.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;
  if (!token) return null;

  const sb = getSupabaseServer();
  if (!sb) return null;

  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user;
  } catch (err) {
    // No user available at this point (the call itself failed) — nothing
    // personal to tag.
    Sentry.captureException(err, {
      tags: { route: 'requireUser', op: 'verify_token' },
    });
    return null;
  }
}
