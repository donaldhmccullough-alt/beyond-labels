-- "Report Wrong Verdict" feedback feature (see CLAUDE.md "Report Wrong Verdict").
-- Records a user-submitted report that a scan's verdict/flags/explanation looks
-- wrong, missing an ingredient, or was confusing — free-form feedback tied to a
-- specific scan, not a support ticket queue. No admin review UI exists yet
-- (a future session, same as swap_candidate_reviews' Phase 3a/3b split).
--
-- user_id is nullable and ON DELETE SET NULL (NOT CASCADE) — a report is
-- feedback about a product, not personal data tied to the reporter, so it
-- should survive account deletion rather than being purged with it. This
-- mirrors how scans.user_id is anonymized (not deleted) by the account
-- deletion cron job — see CLAUDE.md "Account Deletion".
--
-- Submission never requires a signed-in user (see pages/api/reports/verdict.js)
-- — user_id is populated only when a valid session token was sent.
--
-- Server-only — same pattern as account_deletions/swap_candidate_reviews/
-- swap_products: RLS enabled, zero policies. Read/written exclusively via
-- getSupabaseServer() from pages/api/reports/verdict.js.

CREATE TABLE IF NOT EXISTS verdict_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  barcode       TEXT NOT NULL,
  product_name  TEXT,
  verdict       TEXT NOT NULL,
  flags         JSONB,
  user_level    INTEGER,
  reason        TEXT NOT NULL,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE verdict_reports ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service-role-only, matching account_deletions/
-- swap_products/swap_candidate_reviews/verdict_shadow_diffs.
