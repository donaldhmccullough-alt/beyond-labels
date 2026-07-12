-- Phase 3a of the swaps system overhaul: adds a structured purchase_links
-- column to swap_products, in preparation for real affiliate-link support.
-- Each array element will be shaped { retailer: string, affiliate_url: string }
-- once something actually populates it — not yet, this migration only adds
-- the column.
--
-- Purely additive, same discipline as every prior swap_products/scan_cache
-- column addition in this project: no PROMPT_VERSION bump, no backfill of
-- existing rows. The existing where_to_buy (text[]) column is deliberately
-- left untouched — pages/api/swaps.js keeps reading/returning it exactly as
-- before; purchase_links is not wired into any code path yet.

ALTER TABLE swap_products ADD COLUMN IF NOT EXISTS purchase_links JSONB NOT NULL DEFAULT '[]'::jsonb;
