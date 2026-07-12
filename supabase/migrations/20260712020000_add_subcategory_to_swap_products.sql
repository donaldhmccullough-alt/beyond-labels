-- Phase 1 of the swaps system overhaul: subcategory support for 5 top-level
-- categories (chips, dairy, meat, beverages, bread). See CLAUDE.md "Swaps
-- System" for the full subcategory list and why only these 5 categories.
--
-- Deliberately a free TEXT column with no CHECK/enum constraint (unlike
-- swap_products.category, which does have exact-value discipline enforced
-- in application code) — subcategory values are expected to grow over time
-- as more categories get subcategory support, and a DB-level enum would
-- require a migration for every addition. Application code (SUBCATEGORY_TAG_MAP
-- in lib/scanHelpers.js) is the source of truth for which values are
-- currently meaningful.

ALTER TABLE swap_products ADD COLUMN IF NOT EXISTS subcategory TEXT;
