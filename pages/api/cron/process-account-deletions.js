/**
 * pages/api/cron/process-account-deletions.js — Beyond Labels scheduled account hard-delete sweep
 *
 * GET /api/cron/process-account-deletions
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Triggered daily by Vercel Cron (see vercel.json's `crons` block). NOT a
 * user-facing route — locked down via a shared secret, not a Supabase
 * session token, since there is no signed-in user involved. Vercel
 * automatically sends `Authorization: Bearer <value-of-CRON_SECRET-env-var>`
 * on every cron-triggered request (Vercel's own documented mechanism); this
 * route must reject anything else.
 *
 * For every account_deletions row whose scheduled_for has passed:
 *   1. Atomically CLAIM it — DELETE ... WHERE user_id = :id AND
 *      scheduled_for <= now() RETURNING user_id. If this returns 0 rows, a
 *      concurrent restore() call already won the race (or a duplicate cron
 *      invocation already processed it) — skip. This is deliberately not a
 *      separate SELECT-then-DELETE: doing the claim as a single conditional
 *      DELETE avoids a window where two invocations could both "see" the
 *      row as still-due and both attempt to process it.
 *   2. Anonymize scans: UPDATE scans SET user_id = NULL WHERE user_id = :id.
 *      Done BEFORE touching profiles/auth.users — a NULL FK value satisfies
 *      any ON DELETE behavior on either downstream FK (scans.user_id ->
 *      profiles.id, profiles.id -> auth.users.id), regardless of what that
 *      clause actually is (unconfirmable via this project's available
 *      tooling — see CLAUDE.md "Account Deletion" investigation notes).
 *      scan_cache is deliberately untouched — shared product data, not
 *      personal, no user link at all.
 *   3. DELETE FROM profiles WHERE id = :id — explicit, not relied-upon
 *      cascade.
 *   4. supabase.auth.admin.deleteUser(id) — the actual hard delete. Also
 *      cascades cleanup of this user's account_deletions row via
 *      ON DELETE CASCADE, though step 1 already removed it explicitly.
 *
 * ⚠️ Partial-failure recovery (why steps 2-4 are wrapped in their own nested
 * try/catch, separate from step 1's): once step 1 claims a row, that row is
 * gone from account_deletions — if step 2, 3, or 4 then fails, the naive
 * version of this sweep would leave that user permanently stuck (claimed,
 * partially processed, but no longer tracked anywhere, so no future sweep
 * would ever retry them). To avoid that, any failure in steps 2-4
 * re-inserts the account_deletions row with scheduled_for = now() — so
 * it's immediately due again on the *next* daily run — using the ORIGINAL
 * requested_at (carried through from the initial query) rather than
 * fabricating a new one. If that re-insert itself fails, this is logged as
 * CRITICAL: the user's auth.users row still exists but is no longer
 * tracked for automatic retry, and would need manual intervention. This
 * residual risk (no true multi-step transaction) is accepted, consistent
 * with every other multi-step Supabase write in this codebase (see
 * pages/api/admin/swap-candidates/review.js's compensating-delete comment
 * for the same reasoning applied elsewhere).
 *
 * Per Vercel's own cron documentation: delivery is best-effort (a scheduled
 * run can be skipped, or fire more than once) and failures are never
 * retried. This sweep is written to tolerate both: a missed run is simply
 * caught up by the next day's query (WHERE scheduled_for <= now() picks up
 * anything still outstanding, not just "due today"); a duplicate invocation
 * finds nothing left to claim for anything the first invocation already
 * finished. Each user is processed in its own try/catch so one failure
 * can't abort the rest of the sweep.
 */

import { getSupabaseServer } from '../../../lib/supabaseServer';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return res.status(500).json({ error: 'Supabase client unavailable.' });
  }

  const nowIso = new Date().toISOString();
  const processed = [];
  const skipped = [];
  const failed = [];

  let dueRows;
  try {
    const { data, error: queryError } = await sb
      .from('account_deletions')
      .select('user_id, requested_at')
      .lte('scheduled_for', nowIso);

    if (queryError) {
      console.error('[cron] process-account-deletions: failed to query due rows:', queryError.message);
      return res.status(500).json({ error: 'Failed to query account_deletions.' });
    }
    dueRows = data || [];
  } catch (err) {
    console.error('[cron] process-account-deletions: unexpected error querying due rows:', err);
    return res.status(500).json({ error: 'Unexpected error querying account_deletions.' });
  }

  for (const row of dueRows) {
    const userId = row.user_id;
    const requestedAt = row.requested_at;
    try {
      // Step 1 — atomically claim.
      const { data: claimed, error: claimError } = await sb
        .from('account_deletions')
        .delete()
        .eq('user_id', userId)
        .lte('scheduled_for', nowIso)
        .select('user_id');

      if (claimError) {
        console.error(`[cron] process-account-deletions: failed to claim user ${userId}:`, claimError.message);
        failed.push({ userId, stage: 'claim', error: claimError.message });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        skipped.push(userId);
        continue;
      }

      // Steps 2-4 — the actual destructive work. Any failure here needs the
      // re-schedule-for-retry handling below, so it's a separate try/catch
      // from step 1's.
      try {
        const { error: scansError } = await sb
          .from('scans')
          .update({ user_id: null })
          .eq('user_id', userId);
        if (scansError) throw new Error(`anonymize-scans: ${scansError.message}`);

        const { error: profileError } = await sb
          .from('profiles')
          .delete()
          .eq('id', userId);
        if (profileError) throw new Error(`delete-profile: ${profileError.message}`);

        const { error: authError } = await sb.auth.admin.deleteUser(userId);
        if (authError) throw new Error(`delete-auth-user: ${authError.message}`);

        processed.push(userId);
      } catch (stepErr) {
        console.error(
          `[cron] process-account-deletions: user ${userId} failed after being claimed (${stepErr.message}) — re-scheduling for retry on the next run`
        );
        const { error: reinsertError } = await sb
          .from('account_deletions')
          .upsert(
            { user_id: userId, requested_at: requestedAt, scheduled_for: nowIso },
            { onConflict: 'user_id' }
          );
        if (reinsertError) {
          console.error(
            `[cron] process-account-deletions: CRITICAL — failed to re-schedule user ${userId} after a partial failure; this user's auth record still exists but is no longer tracked in account_deletions and will not be retried automatically:`,
            reinsertError.message
          );
        }
        failed.push({ userId, stage: 'partial-failure', error: stepErr.message });
      }
    } catch (err) {
      console.error(`[cron] process-account-deletions: unexpected error processing user ${userId}:`, err);
      failed.push({ userId, stage: 'unexpected', error: err.message });
    }
  }

  const summary = {
    dueCount: dueRows.length,
    processedCount: processed.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
  };
  console.log('[cron] process-account-deletions summary:', summary);

  return res.status(200).json({ ...summary, processed, skipped, failed });
}
