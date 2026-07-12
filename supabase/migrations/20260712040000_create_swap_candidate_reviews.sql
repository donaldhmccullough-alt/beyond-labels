-- Phase 3a of the swaps system overhaul: foundation for the admin
-- swap-candidate review workflow (see CLAUDE.md "Swaps System"). Records
-- an admin's approve/reject decision for a candidate barcode surfaced by
-- GET /api/admin/swap-candidates, so a rejected (or already-approved)
-- barcode never resurfaces as a candidate again.
--
-- swap_product_id is nullable and populated later, by Phase 3b's approve
-- action, once it actually creates the corresponding swap_products row —
-- not implemented yet. No FK enforcement on write order is needed since a
-- 'rejected' decision never gets a swap_product_id at all, and an
-- 'approved' decision's row is created in the same transaction as this one
-- once Phase 3b exists.
--
-- Server-only — same pattern as swap_products/verdict_shadow_diffs: RLS
-- enabled, zero policies. Read/written exclusively via getSupabaseServer()
-- from admin-only API routes (see lib/requireAdmin.js).

CREATE TABLE IF NOT EXISTS swap_candidate_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode           TEXT NOT NULL,
  decision          TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note              TEXT,
  swap_product_id   UUID REFERENCES swap_products(id)
);

ALTER TABLE swap_candidate_reviews ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies — service-role-only, matching swap_products.
