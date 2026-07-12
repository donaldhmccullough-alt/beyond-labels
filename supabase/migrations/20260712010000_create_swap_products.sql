-- Phase 0 of the swaps system overhaul: migrates the swaps data source from
-- the Google Sheet (SWAP_SHEET_ID) to a first-class Supabase table, so a
-- later admin approval workflow (source = 'scan_approved') has somewhere
-- real to write to instead of a spreadsheet.
--
-- Server-only — same pattern as scan_cache/verdict_shadow_diffs writes: no
-- anon SELECT/INSERT/UPDATE policies. pages/api/swaps.js reads this table
-- exclusively via getSupabaseServer() (service role key, bypasses RLS). RLS
-- is left enabled with zero policies — the existing in-memory 1hr cache in
-- pages/api/swaps.js is what makes it safe to hit on every uncached request
-- without an anon-facing policy.
--
-- IMPORTANT: run this migration against the live Supabase database BEFORE
-- running scripts/migrateSwapsFromSheet.js or deploying the updated
-- pages/api/swaps.js — per the documented deploy-gap incident in CLAUDE.md,
-- do not assume a migration file sitting in this repo has actually been
-- applied. Confirm column existence directly (e.g. a
-- `select=id&limit=1` PostgREST query against swap_products) before relying
-- on it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS swap_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name    TEXT NOT NULL,
  brand           TEXT,
  category        TEXT NOT NULL,
  barcode         TEXT,
  certifications  TEXT[],
  why_it_passes   TEXT[],
  where_to_buy    TEXT[],
  image_url       TEXT,
  swap_level      INTEGER NOT NULL CHECK (swap_level IN (1, 2)),
  source          TEXT NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'scan_approved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE swap_products ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service-role-only reads/writes, matching
-- verdict_shadow_diffs' precedent for a table the browser never touches.
