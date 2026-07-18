/**
 * pages/api/account/request-deletion.js — Beyond Labels account deletion request
 *
 * POST /api/account/request-deletion
 * Header: Authorization: Bearer <supabase access token> (see lib/requireUser.js)
 *
 * Schedules the caller's own account for deletion ~14 days out. Does NOT
 * delete anything itself — inserts one account_deletions row; the actual
 * hard delete happens later, via pages/api/cron/process-account-deletions.js.
 *
 * The client (components/profile/DeleteAccountModal.jsx) is expected to
 * have already re-verified the user's current password via signIn() before
 * calling this route — but that's a UX/defense-in-depth measure, not the
 * real security boundary. The real boundary is here: requireUser() performs
 * its own independent, server-side identity verification (a real round-trip
 * to Supabase Auth), so this route only ever schedules deletion for the
 * account the verified token actually belongs to — never a client-supplied
 * user id.
 *
 * Double-submit handling: INSERT ... ON CONFLICT (user_id) DO NOTHING (via
 * .upsert(..., { ignoreDuplicates: true })). A second request while one is
 * already pending is a no-op — it does NOT reset the 14-day clock. This was
 * an explicit product decision, not an accidental default.
 *
 * The client is responsible for signing the user out after this call
 * succeeds (see DeleteAccountModal.jsx) — this route only writes the
 * pending-deletion record.
 */

import { requireUser } from '../../../lib/requireUser';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import * as Sentry from '@sentry/nextjs';

const GRACE_PERIOD_DAYS = 14;

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

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  try {
    const { error } = await sb
      .from('account_deletions')
      .upsert(
        {
          user_id: user.id,
          requested_at: now.toISOString(),
          scheduled_for: scheduledFor.toISOString(),
        },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    if (error) {
      Sentry.captureMessage('[account/request-deletion] upsert failed', {
        level: 'error',
        tags: { route: 'account/request-deletion' },
        contexts: { supabase: { message: error.message } },
      });
      return res.status(500).json({ error: error.message });
    }

    // Re-read rather than echo back the locally-computed value — if this was
    // a duplicate request (ignoreDuplicates: true silently no-op'd it), the
    // real row still holds the ORIGINAL scheduled_for from the first
    // request, not this attempt's. The response must reflect what's
    // actually true in the database, not what this specific call attempted.
    const { data: row, error: readError } = await sb
      .from('account_deletions')
      .select('scheduled_for')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError || !row) {
      Sentry.captureMessage('[account/request-deletion] read-back failed', {
        level: 'error',
        tags: { route: 'account/request-deletion' },
        contexts: { supabase: { message: readError?.message || 'no row returned' } },
      });
      return res.status(500).json({ error: readError?.message || 'Failed to read back scheduled deletion.' });
    }

    return res.status(200).json({ success: true, scheduledFor: row.scheduled_for });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'account/request-deletion' },
    });
    return res.status(500).json({ error: err.message });
  }
}
