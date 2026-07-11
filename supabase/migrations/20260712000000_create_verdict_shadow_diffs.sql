-- Stage 5b of the L1/L2 unification project: durable record of every case
-- where lib/verdictEngine.js's computeCorrectedVerdict() disagrees with
-- today's live legacy decision logic, observed on real production traffic
-- under VERDICT_ENGINE_MODE=shadow (sampled per
-- VERDICT_ENGINE_SHADOW_SAMPLE_RATE, default 10%).
--
-- Write-only from the server (service role key, same client as scan_cache) —
-- nothing in the app ever reads this table, so RLS is left fully locked
-- down (enabled, no policies) rather than given an anon SELECT policy like
-- scan_cache has for its tap-to-verdict history feature.
--
-- Only written when the two engines' outputs actually differ — never one
-- row per request. Given a shadow rate of 10% and the low historical
-- divergence rate seen in Stage 4's golden-master comparison (2/135), this
-- table should stay small; if real traffic disagrees far more often than
-- that, the volume itself is a signal worth noticing.
--
-- ingredients/labels_detected/categories_tags are captured verbatim at scan
-- time (not just the barcode) because Open Food Facts product data can
-- change after the fact (community edits) — a barcode alone is not
-- guaranteed to reproduce the same case later.
--
-- flags are stored reduced to {category, severity, matchedIngredient} —
-- summary text (presentation copy) is deliberately omitted, matching the
-- comparison convention already established in
-- scripts/shadowMode/compareVerdicts.js. Full detail is always re-derivable
-- by replaying the stored ingredients/labels_detected/categories_tags
-- through either engine.
--
-- IMPORTANT: this migration must be run against the live Supabase database
-- BEFORE setting VERDICT_ENGINE_MODE=shadow in Vercel. If deployed out of
-- order, the verdict_shadow_diffs insert will fail every time a divergence
-- occurs — but per this file's own try/catch discipline (see
-- pages/api/scan.js), that failure is caught and logged
-- ("verdict_shadow_diffs write failed:"), never crashes the request, and
-- never affects the legacy response the user sees. Still, run this first —
-- a shadow-mode rollout with a missing table means zero divergences ever
-- get persisted, only console.warn'd, which defeats half the point.

CREATE TABLE IF NOT EXISTS verdict_shadow_diffs (
  id                  BIGSERIAL PRIMARY KEY,
  barcode             TEXT NOT NULL,
  user_level          SMALLINT NOT NULL,
  product_name        TEXT,
  ingredients         TEXT,
  labels_detected     JSONB,      -- raw OFF labels_tags at scan time
  categories_tags     JSONB,      -- raw OFF categories_tags at scan time

  legacy_verdict      TEXT NOT NULL,
  legacy_flags        JSONB NOT NULL,   -- [{category, severity, matchedIngredient}], summary text omitted
  legacy_cleared_by   TEXT,
  legacy_is_meat      BOOLEAN,
  legacy_olive_caveat BOOLEAN,

  corrected_verdict      TEXT NOT NULL,
  corrected_flags        JSONB NOT NULL,
  corrected_cleared_by   TEXT,
  corrected_is_meat      BOOLEAN,
  corrected_olive_caveat BOOLEAN,

  diverging_fields    TEXT[] NOT NULL,  -- e.g. {'verdict','flags'}
  prompt_version      INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE verdict_shadow_diffs ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service-role-only writes, never read by the app.
