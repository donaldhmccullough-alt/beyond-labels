/**
 * pages/api/account/restore.js — Beyond Labels account deletion restore
 *
 * POST /api/account/restore
 * Header: Authorization: Bearer <supabase access token> (see lib/requireUser.js)
 *
 * Clears the caller's OWN pending-deletion request — scoped to the verified
 * token's user id, never a client-supplied one. Called from the restore
 * interstitial (components/shared/AccountPendingDeletionModal.jsx) when the
 * user taps "Restore my account" (see CLAUDE.md "Account Deletion").
 *
 * Naturally idempotent: deleting a row that's already gone (already
 * restored, or already hard-deleted by the cron sweep) affects 0 rows and
 * is not an error — the response is the same either way.
 */

import { requireUser } from '../../../lib/requireUser';
import { getSupabaseServer } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const user = await requireUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return res.status(500).json({ error: 'Supabase client unavailable.' });
  }

  try {
    const { error } = await sb
      .from('account_deletions')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
