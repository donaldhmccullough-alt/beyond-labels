'use strict';

/**
 * backfillSwapProductSubcategories.js — one-time best-effort subcategory
 * classification for existing swap_products rows (Phase 1 of the swaps
 * system overhaul, July 2026 — see CLAUDE.md "Swaps System").
 *
 * Only touches rows in the 5 categories with subcategory support
 * (chips, dairy, meat, beverages, bread — see SUBCATEGORY_TAG_MAP in
 * lib/scanHelpers.js) and only rows whose subcategory is currently null —
 * never overwrites an already-set value, so this is safe to re-run after
 * new rows are added (e.g. from a later admin approval workflow) without
 * re-classifying (or accidentally reclassifying) existing rows.
 *
 * Classification is simple keyword matching against `product_name + brand`
 * (lowercased) — NOT the same OFF-tag-based SUBCATEGORY_TAG_MAP used for
 * live scans, since swap_products rows don't carry OFF categories_tags data.
 * For each row, every keyword group for its category is tested; a row is
 * only classified when EXACTLY ONE group matches (two documented exceptions
 * below). Zero matches or multiple matches (e.g. "beef bacon" matching both
 * beef and pork) both leave subcategory null — ambiguous is treated the same
 * as unknown, per the "don't guess when uncertain" instruction. Several
 * subcategories exist as possible values (chips:veggie, meat:deli,
 * bread:keto_low_carb, bread:sandwich) that have no SUBCATEGORY_TAG_MAP entry
 * for live-scan detection but CAN still be assigned here, since this is plain
 * keyword matching on product name text, not OFF tag matching — a
 * swap_products row named "Garden Veggie Chips" is confidently classifiable
 * by name even though no live OFF tag reliably distinguishes veggie chips
 * from potato chips (see the SUBCATEGORY_TAG_MAP comment in
 * lib/scanHelpers.js for the research that established that gap).
 *
 * Two exceptions to "exactly one match wins" (added in the subcategory
 * follow-up session, July 2026):
 *   1. chips with ZERO matches default to 'other' (DEFAULT_SUBCATEGORY_ON_NO_MATCH)
 *      — 'other' was always meant to be the 4th chips bucket
 *      (tortilla/potato/veggie/other); the fallback just wasn't implemented
 *      in the first backfill pass. chips is the only category with a
 *      no-match default — deliberately not applied anywhere else, and NOT
 *      mirrored in lib/scanHelpers.js's live-scan mapProductSubcategory()
 *      (see that file's own comment for why the two situations aren't
 *      analogous).
 *   2. dairy rows matching BOTH milk and yogurt resolve to 'yogurt', not
 *      null — see the tie-break comment on classify() below. Every other
 *      dairy multi-match combination is still genuinely ambiguous and stays
 *      null.
 *
 * Usage:
 *   node scripts/backfillSwapProductSubcategories.js            # apply + print unclassified rows
 *   node scripts/backfillSwapProductSubcategories.js --dry-run  # preview only, no writes
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — read
 * from .env.local / .env, same convention as
 * scripts/migrateSwapsFromSheet.js and scripts/appendScanCacheToOffResults.js.
 */

const path = require('path');
const fs = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Env vars ──────────────────────────────────────────────────────────────
function readEnvVars() {
  const vars = {};
  for (const file of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return vars;
}
const ENV = readEnvVars();
for (const [key, value] of Object.entries(ENV)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// ── Lazy Supabase client — mirrors lib/supabaseServer.js's getSupabaseServer() ──
function getSupabaseServer() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !roleKey) return null;
  try {
    return createClient(url, roleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
}

// ── Keyword groups per category ─────────────────────────────────────────────
// Each group is tested independently against the lowercased
// `${product_name} ${brand}` string. A row is classified only when exactly
// one group's regex matches.
const KEYWORD_GROUPS = {
  chips: [
    { subcategory: 'tortilla', pattern: /tortilla/ },
    { subcategory: 'potato', pattern: /potato/ },
    { subcategory: 'veggie', pattern: /veggie|vegetable/ },
  ],
  dairy: [
    { subcategory: 'yogurt', pattern: /yogurt|yoghurt/ },
    { subcategory: 'cheese', pattern: /cheese|cheddar|mozzarella|parmesan|gouda|feta/ },
    { subcategory: 'butter', pattern: /butter/ },
    { subcategory: 'milk', pattern: /\bmilk\b/ },
  ],
  meat: [
    { subcategory: 'beef', pattern: /beef/ },
    { subcategory: 'poultry', pattern: /chicken|turkey|poultry/ },
    { subcategory: 'pork', pattern: /pork|bacon/ },
    { subcategory: 'seafood', pattern: /salmon|seafood|shrimp|tuna|cod|tilapia|fish/ },
    { subcategory: 'deli', pattern: /\bdeli\b|lunch meat|cold cuts|\bham\b/ },
  ],
  beverages: [
    { subcategory: 'soda', pattern: /soda|\bcola\b/ },
    { subcategory: 'juice', pattern: /juice/ },
    { subcategory: 'sparkling_water', pattern: /sparkling water|seltzer|carbonated water/ },
    { subcategory: 'coffee_tea', pattern: /coffee|\btea\b/ },
    // \s? (not a literal space) so "oat milk" and "oatmilk" both match with
    // one pattern per base. "barista blend" is its own alternation, not a
    // base+milk pair — real products (e.g. Califia Farms Oat Barista Blend)
    // often drop "milk" entirely from the name.
    { subcategory: 'plant_milk', pattern: /oat\s?milk|almond\s?milk|soy\s?milk|coconut\s?milk|cashew\s?milk|macadamia\s?milk|plant[\s-]?milk|non-dairy milk|barista blend/ },
  ],
  // Redesigned this session — sliced/tortillas_wraps/bagels_buns replaced by
  // sprouted_grain/gluten_free/keto_low_carb/sandwich/bagels_muffins/tortillas_wraps.
  bread: [
    { subcategory: 'sprouted_grain', pattern: /sprouted/ },
    // Word-boundary "gf" only — a bare substring match would false-positive
    // inside e.g. "stuffing" or a brand name containing those two letters.
    { subcategory: 'gluten_free', pattern: /gluten[\s-]?free|\bgf\b/ },
    { subcategory: 'keto_low_carb', pattern: /\bketo\b|low[\s-]?carb/ },
    { subcategory: 'sandwich', pattern: /sandwich|sliced|\bloaf\b/ },
    { subcategory: 'bagels_muffins', pattern: /english muffin|\bbagel/ },
    { subcategory: 'tortillas_wraps', pattern: /tortilla|\bwrap/ },
  ],
};

// Categories where a genuine zero-match result still gets a default value
// instead of staying null. Only 'chips' — 'other' was always meant to be the
// 4th bucket (tortilla/potato/veggie/other) in the original subcategory
// design; the fallback just wasn't implemented in the first backfill pass.
// Deliberately NOT applied to live-scan detection (mapProductSubcategory() in
// lib/scanHelpers.js) — an OFF product with no matching tag there could mean
// missing/incomplete tag data rather than a genuine "other"-type product;
// that ambiguity doesn't exist here, where a human is reviewing a real,
// specific curated product name by hand.
const DEFAULT_SUBCATEGORY_ON_NO_MATCH = { chips: 'other' };

function classify(category, productName, brand) {
  const groups = KEYWORD_GROUPS[category];
  if (!groups) return null;
  const haystack = `${productName || ''} ${brand || ''}`.toLowerCase();
  const matches = groups.filter(g => g.pattern.test(haystack)).map(g => g.subcategory);

  // dairy tie-break: "Whole Milk Yogurt"-style names legitimately match both
  // the milk and yogurt keyword groups. Rather than leaving these ambiguous
  // forever, yogurt wins — it's the more specific product (yogurt is milk
  // that's been cultured; the reverse isn't true). Every OTHER multi-match
  // combination for dairy (e.g. cheese+butter) is still genuinely ambiguous
  // and stays null.
  if (category === 'dairy' && matches.length === 2 && matches.includes('milk') && matches.includes('yogurt')) {
    return 'yogurt';
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0 && DEFAULT_SUBCATEGORY_ON_NO_MATCH[category]) {
    return DEFAULT_SUBCATEGORY_ON_NO_MATCH[category];
  }
  return null; // zero or multiple (ambiguous) matches — leave null
}

async function main() {
  const sb = getSupabaseServer();
  if (!sb) {
    console.error('Supabase client unavailable — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  const covered = Object.keys(KEYWORD_GROUPS);
  const { data: rows, error } = await sb
    .from('swap_products')
    .select('id, product_name, brand, category, subcategory')
    .in('category', covered)
    .is('subcategory', null);

  if (error) {
    console.error('Failed to fetch swap_products rows:', error.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} row(s) in covered categories (${covered.join(', ')}) with no subcategory set.`);

  const classified = [];
  const unclassified = [];

  for (const row of rows) {
    const subcategory = classify(row.category, row.product_name, row.brand);
    if (subcategory) {
      classified.push({ ...row, subcategory });
    } else {
      unclassified.push(row);
    }
  }

  console.log(`Classified: ${classified.length}. Left null (ambiguous or no keyword match): ${unclassified.length}.`);

  if (DRY_RUN) {
    console.log('--dry-run: no writes performed.');
  } else {
    for (const row of classified) {
      const { error: updateError } = await sb
        .from('swap_products')
        .update({ subcategory: row.subcategory, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) {
        console.error(`Failed to update row ${row.id} (${row.product_name}):`, updateError.message);
      }
    }
    console.log(`Wrote subcategory for ${classified.length} row(s).`);
  }

  console.log('\nBy subcategory:');
  const bySubcategory = {};
  for (const row of classified) {
    bySubcategory[row.subcategory] = (bySubcategory[row.subcategory] || 0) + 1;
  }
  for (const [subcategory, count] of Object.entries(bySubcategory).sort()) {
    console.log(`  ${subcategory}: ${count}`);
  }

  console.log(`\nUnclassified rows (${unclassified.length}) — review and set subcategory manually:`);
  for (const row of unclassified) {
    console.log(`  [${row.category}] "${row.product_name}" (brand: ${row.brand || '—'}, id: ${row.id})`);
  }
}

module.exports = { classify, KEYWORD_GROUPS, DEFAULT_SUBCATEGORY_ON_NO_MATCH };

// Only run against the live database when invoked directly via `node` —
// requiring this file from a test (see __tests__/scripts/backfillSwapProductSubcategories.test.js)
// must not trigger a real Supabase connection attempt.
if (require.main === module) {
  main().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
