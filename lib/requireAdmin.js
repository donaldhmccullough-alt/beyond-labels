// Server-only — never import this from a client component or any file under app/

import { getSupabaseServer } from './supabaseServer';

/**
 * Verifies the caller of an API route is a signed-in Supabase user whose
 * email is in the ADMIN_EMAILS allowlist.
 *
 * The client is expected to send its own Supabase session access token
 * (see lib/auth.js's getSession() — session.access_token) as
 * `Authorization: Bearer <token>`. This function verifies that token
 * server-side via supabase.auth.getUser(token) — a real round-trip to
 * Supabase Auth, not a local JWT decode, so an expired/revoked/forged
 * token is rejected — then checks the resulting email against
 * ADMIN_EMAILS (comma-separated, case-insensitive).
 *
 * Reuses getSupabaseServer() (service-role client, lazy-initialized —
 * never a module-level client, per the project's established rule) rather
 * than constructing a second Supabase client just for this check.
 *
 * Returns the Supabase user object on success, or `null` on any failure
 * (missing/malformed Authorization header, invalid/expired token, Supabase
 * unavailable, or a valid user whose email isn't in ADMIN_EMAILS). Callers
 * should respond 401 when this returns null — see
 * pages/api/admin/swap-candidates.js for the pattern every admin-only
 * route should follow (including Phase 3b's approve/reject actions).
 *
 * @param {import('next').NextApiRequest} req
 * @returns {Promise<object|null>}
 */
export async function requireAdmin(req) {
  const authHeader = req.headers?.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;
  if (!token) return null;

  const sb = getSupabaseServer();
  if (!sb) return null;

  let user;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.email) return null;
    user = data.user;
  } catch {
    return null;
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmails.includes(user.email.toLowerCase())) return null;

  return user;
}
