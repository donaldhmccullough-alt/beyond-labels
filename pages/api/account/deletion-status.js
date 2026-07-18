/**
 * pages/api/account/deletion-status.js — Beyond Labels account deletion status
 *
 * GET /api/account/deletion-status
 * Header: Authorization: Bearer <supabase access token> (see lib/requireUser.js)
 *
 * Returns whether the caller's OWN account currently has a pending deletion
 * request — scoped to the verified token's user id, never a client-supplied
 * one. Called from app/page.jsx's onAuthStateChange SIGNED_IN handler, right
 * after a successful sign-in, to decide whether to show the restore
 * interstitial (see CLAUDE.md "Account Deletion").
 */

import { requireUser } from '../../../lib/requireUser';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import * as Sentry from '@sentry/nextjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
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
    const { data, error } = await sb
      .from('account_deletions')
      .select('scheduled_for')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      // Note: never tag user.id here — an auth-scoped identifier tied to a
      // real person, not a public identifier like a barcode.
      Sentry.captureMessage('[account/deletion-status] query failed', {
        level: 'error',
        tags: { route: 'account/deletion-status' },
        contexts: { supabase: { message: error.message } },
      });
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      pending: !!data,
      scheduledFor: data?.scheduled_for ?? null,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'account/deletion-status' },
    });
    return res.status(500).json({ error: err.message });
  }
}
