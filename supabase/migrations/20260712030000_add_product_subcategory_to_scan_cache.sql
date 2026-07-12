-- Phase 1 of the swaps system overhaul: mirrors product_category on
-- scan_cache with a new product_subcategory column, populated by
-- pages/api/scan.js via SUBCATEGORY_TAG_MAP (lib/scanHelpers.js) for the 5
-- categories that have subcategory support (chips, dairy, meat, beverages,
-- bread). Null for every other category, and null when no subcategory tag
-- matches within a covered category — same fallback-to-category-level
-- behavior product_category already has.
--
-- Purely additive — no PROMPT_VERSION bump, no cache invalidation. Existing
-- cached rows simply read product_subcategory = null until their barcode is
-- rescanned, the same pattern already used for is_meat_category/
-- is_meat_ingredient (see the "is_meat ingredient-text corroboration, Phase 2"
-- changelog entry in CLAUDE.md) and olive_caveat before that.

ALTER TABLE scan_cache ADD COLUMN IF NOT EXISTS product_subcategory TEXT;
