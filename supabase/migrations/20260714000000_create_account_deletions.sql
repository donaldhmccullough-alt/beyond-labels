-- Account deletion with a grace period (see CLAUDE.md "Account Deletion").
-- Records a pending deletion request; a daily Vercel Cron job
-- (pages/api/cron/process-account-deletions.js) sweeps for rows whose grace
-- period has lapsed and performs the actual hard delete. Signing back in
-- during the grace period surfaces a restore interstitial that simply
-- deletes this row.
--
-- user_id references auth.users(id) directly, NOT profiles(id) — profiles
-- rows are created lazily (upsert on first onboarding write), so a user who
-- signs up but never finishes onboarding may have no profiles row at all.
-- Every signed-up user has an auth.users row immediately, so that's the
-- safe anchor. ON DELETE CASCADE means the cron job's final
-- auth.admin.deleteUser() call also cleans up this row as a backstop, in
-- addition to the cron job's own explicit claim-then-delete step.
--
-- user_id is the primary key (not a separate id + unique constraint) since
-- a user can only have one pending deletion request at a time.
--
-- Server-only — same pattern as swap_candidate_reviews/swap_products/
-- verdict_shadow_diffs: RLS enabled, zero policies. Read/written exclusively
-- via getSupabaseServer() from identity-verified API routes (see
-- lib/requireUser.js) and the CRON_SECRET-gated cron route.

CREATE TABLE IF NOT EXISTS account_deletions (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for TIMESTAMPTZ NOT NULL
);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service-role-only, matching swap_products/
-- swap_candidate_reviews/verdict_shadow_diffs.
