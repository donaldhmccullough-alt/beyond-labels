/**
 * pages/api/reports/verdict.js — Beyond Labels "Report Wrong Verdict" feedback
 *
 * POST /api/reports/verdict
 * Header: Authorization: Bearer <supabase access token> (optional — see below)
 *
 * Records free-form user feedback that a scan's verdict, flags, or AI
 * explanation looks wrong. This is feedback about a product, not an auth-gated
 * action — no sign-in is required to submit a report.
 *
 * If an Authorization header is present, it's verified the same way
 * lib/requireUser.js verifies every other route's caller (a real round-trip
 * to Supabase Auth, never a client-supplied id) and the resulting user_id is
 * attached to the report. requireUser() already returns null for a missing,
 * malformed, or invalid token — that null is treated as "anonymous report",
 * not as a reason to reject the request. This route never rejects for lack
 * of (or a bad) auth header.
 *
 * A DB failure here must never surface as anything worse than "the report
 * didn't save" — this is called after a scan has already succeeded and
 * rendered, so a failure in this endpoint has no business affecting anything
 * else. Errors are caught and returned as { success: false, error }.
 */

import { requireUser } from '../../../lib/requireUser';
import { getSupabaseServer } from '../../../lib/supabaseServer';
import * as Sentry from '@sentry/nextjs';

const VALID_REASONS = new Set([
  'wrong_verdict',
  'missing_ingredient',
  'confusing_explanation',
  'other',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const { barcode, productName, verdict, flags, userLevel, reason, comment } = req.body || {};

  if (typeof barcode !== 'string' || !barcode.trim()) {
    return res.status(400).json({ success: false, error: 'barcode is required.' });
  }
  if (typeof verdict !== 'string' || !verdict.trim()) {
    return res.status(400).json({ success: false, error: 'verdict is required.' });
  }
  if (!VALID_REASONS.has(reason)) {
    return res.status(400).json({ success: false, error: `reason must be one of: ${[...VALID_REASONS].join(', ')}.` });
  }

  // Never reject for missing/bad auth — an anonymous report is still a
  // valid report. requireUser() already collapses "no header", "malformed
  // header", and "invalid token" all down to null.
  const user = await requireUser(req);
  const userId = user?.id || null;

  const sb = getSupabaseServer();
  if (!sb) {
    return res.status(500).json({ success: false, error: 'Supabase client unavailable.' });
  }

  try {
    const { error } = await sb.from('verdict_reports').insert({
      user_id: userId,
      barcode,
      product_name: productName || null,
      verdict,
      flags: flags || null,
      user_level: userLevel || null,
      reason,
      comment: comment || null,
    });

    if (error) {
      // barcode/reason only — never the free-text `comment` field or the
      // user's own account id in the Sentry payload.
      Sentry.captureMessage('[reports/verdict] insert failed', {
        level: 'error',
        tags: { route: 'reports/verdict', barcode, reason },
        contexts: { supabase: { message: error.message } },
      });
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'reports/verdict', barcode, reason },
    });
    return res.status(500).json({ success: false, error: err.message });
  }
}
