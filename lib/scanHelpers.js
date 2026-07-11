'use strict';

/**
 * lib/scanHelpers.js — shared scan-decision helpers
 *
 * Stage 5a of the L1/L2 unification project: extracted verbatim from
 * pages/api/scan.js's private functions/constants (no logic changes — a
 * pure relocation). Previously these existed ONLY as private, unexported
 * definitions inside scan.js, which meant scripts/shadowMode/
 * compareVerdicts.js had to hand-mirror them (with "will drift" comments)
 * for Stage 4's shadow-mode comparison. Moving them here gives scan.js,
 * lib/verdictEngine.js, and scripts/shadowMode/compareVerdicts.js a single
 * shared source of truth — no more copies to keep in sync by hand.
 *
 * CommonJS on purpose (module.exports, not ES export), matching
 * lib/rulesEngine.js and lib/verdictRules.js: this file needs to be
 * `require()`-able directly from plain Node scripts (scripts/shadowMode/
 * compareVerdicts.js) as well as `import`-able from pages/api/scan.js
 * (Next.js's build pipeline handles the CommonJS/ESM interop the same way
 * it already does for lib/rulesEngine.js).
 */

const { ALWAYS_IGNORE_INGREDIENTS } = require('./rulesEngine');

/**
 * Conservative mapping from Open Food Facts labels_tags values to the
 * internal certification strings recognised by the rules engine.
 *
 * Only verified certification labels are mapped.
 * Generic brand claims ("en:no-artificial-flavors", etc.) are intentionally
 * excluded — they have no effect on Cat 2 clearance.
 */
const OFF_LABEL_MAP = {
  'en:usda-organic':              'usda-organic',
  'en:organic':                   'usda-organic',
  'en:non-gmo-project-verified':  'non-gmo-project-verified',
  'en:glyphosate-free':           'glyphosate-free',
  'en:glyphosate-residue-free':   'glyphosate-free',
  'en:wild-caught':               'wild-caught',
  'en:wild-fish':                 'wild-caught',
  'en:wild-caught-fish':          'wild-caught',
  'en:wild-caught-seafood':       'wild-caught',
  'en:farmed':                    'farmed',
  'en:farm-raised':               'farmed',
  'en:glyphosate-heavy':          'glyphosate-heavy',
  // "en:no-gmos" is a self-declared claim, not a third-party certification;
  // we do NOT map it to non-gmo-project-verified to avoid false clearance.
};

/**
 * Convert an OFF labels_tags array into our deduplicated internal label array.
 * Unknown or unmapped tags are silently ignored.
 *
 * @param {unknown} labelsTags — value of product.labels_tags from OFF
 * @returns {string[]}
 */
function normalizeLabelTags(labelsTags) {
  if (!Array.isArray(labelsTags)) return [];

  const seen = new Set();
  const result = [];

  for (const tag of labelsTags) {
    const mapped = OFF_LABEL_MAP[String(tag).toLowerCase()];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }

  return result;
}

// ── Seafood category detection ────────────────────────────────────────────
// Single source of truth for seafood-related OFF tags — used both to
// identify products where wild-caught vs. farmed is the key safety
// distinction, AND as the seafood component of MEAT_CATEGORIES below.
// Declared first (not as a "subset" comment on a second, separately
// hardcoded literal) so MEAT_CATEGORIES can spread from it directly —
// two independently maintained literal lists happening to match today
// would drift silently the moment either one is edited without the other.
const SEAFOOD_CATEGORIES = new Set([
  'en:fish',
  'en:seafood',
  'en:shellfish',
  'en:crustaceans',
  'en:molluscs',
  'en:salmon',
  'en:tuna',
  'en:cod',
  'en:tilapia',
  'en:shrimp',
]);

// ── Meat product detection ────────────────────────────────────────────────
// Seafood entries are spread in from SEAFOOD_CATEGORIES (single source of
// truth, above) rather than re-listed as separate literal strings — mirrors
// the LEVEL_1_YELLOW_TRIGGERS pattern in lib/rulesEngine.js, built from the
// actual category arrays so the two lists can't silently diverge.
const MEAT_CATEGORIES = new Set([
  'en:meats', 'en:meat', 'en:beef', 'en:ground-beef', 'en:pork', 'en:chicken',
  'en:turkey', 'en:lamb', 'en:veal', 'en:poultry', 'en:game-meats',
  ...SEAFOOD_CATEGORIES,
  'en:deli-meats', 'en:cold-cuts', 'en:sausages', 'en:hot-dogs',
  'en:charcuterie', 'en:bacon', 'en:ham', 'en:salami', 'en:pepperoni',
  'en:smoked-meats', 'en:cured-meats',
  // NOTE: 'en:broths' and 'en:stocks' were removed here (bare parent tags
  // OFF also applies to vegetable/mushroom broths and stocks — see the
  // is_meat false-positive fix below). The specific broth tags are kept.
  'en:bone-broth', 'en:chicken-broth', 'en:beef-broth',
  'en:eggs', 'en:egg-products', 'en:poultry-eggs',
]);

/**
 * Returns true if any OFF categories_tags value matches a known meat/fish/egg category.
 *
 * @param {string[]} categoriesTags — product.categories_tags from OFF
 * @returns {boolean}
 */
function isMeatProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => MEAT_CATEGORIES.has(String(t).toLowerCase()));
}

/**
 * Returns true if the product is a seafood/fish product.
 * @param {string[]} categoriesTags
 * @returns {boolean}
 */
function isSeafoodProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => SEAFOOD_CATEGORIES.has(String(t).toLowerCase()));
}

// ── Game meat category detection ──────────────────────────────────────────
// Game meats are wild-harvested by nature — no certification required.
const GAME_MEAT_CATEGORIES = new Set([
  'en:game-meats',
  'en:game',
  'en:wild-game',
]);

/**
 * Returns true if the product is a game meat product.
 * @param {string[]} categoriesTags
 * @returns {boolean}
 */
function isGameMeatProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => GAME_MEAT_CATEGORIES.has(String(t).toLowerCase()));
}

// ── Wild-caught detection ─────────────────────────────────────────────────

/**
 * Returns true if the product is reliably identified as wild-caught fish.
 * Combines OFF label data with product name signals, then applies exclusion
 * guards for known farmed indicators.
 *
 * Positive signals (checked in order):
 *   (1) OFF label 'wild-caught' (normalised from labels_tags via normalizeLabelTags)
 *   (2) Product name contains "wild-caught" or "wild caught" (case-insensitive)
 *   (3) Product name contains standalone word "wild" (word-boundary safe — will not
 *       match "wildlife" or "wilderness"; covers "ALBACORE WILD TUNA", etc.)
 *   (4) Ingredients text contains standalone word "wild" (same constraint; covers
 *       products like "Wild pink salmon" in the ingredient list)
 *
 * Farmed exclusions (take precedence over all positive signals):
 *   - Product name contains "farm-raised", "farmed", or "atlantic salmon"
 *     ('atlantic salmon' is an aquaculture proxy — virtually all atlantic salmon
 *     sold commercially is farmed)
 *   - Ingredients text contains "astaxanthin" (a synthetic color additive used in
 *     farmed salmon to simulate the pink pigment of wild fish)
 *
 * @param {string}      productName    — product name from OFF
 * @param {string[]}    labelsDetected — normalised labels from normalizeLabelTags()
 * @param {string|null} ingredientsText — raw ingredients text
 * @returns {boolean}
 */
function detectWildCaught(productName, labelsDetected, ingredientsText) {
  const nameLower = (productName || '').toLowerCase();
  const ingLower  = (ingredientsText || '').toLowerCase();

  // ── Farmed exclusions take precedence over all positive signals ───────────
  const FARMED_NAME_SIGNALS = ['farm-raised', 'farmed', 'atlantic salmon'];
  if (FARMED_NAME_SIGNALS.some(s => nameLower.includes(s))) return false;
  if (ingLower.includes('astaxanthin')) return false;

  // Word-boundary regex for the standalone word "wild" — matches "wild" surrounded
  // by non-letter characters (spaces, punctuation, start/end of string), but not
  // inside compound words like "wildlife" or "wilderness".
  const STANDALONE_WILD = /\bwild\b/;

  // ── Positive wild-caught signals ──────────────────────────────────────────
  // Signal 1: OFF label (already normalised from labels_tags)
  if (labelsDetected.includes('wild-caught')) return true;

  // Signal 2: Product name contains "wild-caught" or "wild caught"
  const WILD_NAME_SIGNALS = ['wild-caught', 'wild caught'];
  if (WILD_NAME_SIGNALS.some(s => nameLower.includes(s))) return true;

  // Signal 3: Product name contains standalone word "wild"
  if (STANDALONE_WILD.test(nameLower)) return true;

  // Signal 4: Ingredients text contains standalone word "wild"
  if (ingLower && STANDALONE_WILD.test(ingLower)) return true;

  return false;
}

// ── Cert-unconfirmed detection ────────────────────────────────────────────

/**
 * Trivial ingredients that do not require organic certification and should
 * not block the all-organic-prefix determination. These are simple processing
 * necessities: water variants and salt variants.
 */
const CERT_UNCONFIRMED_TRIVIAL = new Set([
  'water', 'filtered water', 'purified water', 'spring water',
  'sea salt', 'salt', 'himalayan salt', 'himalayan pink salt',
  'pink himalayan salt',
]);

/**
 * Returns true when every non-trivial ingredient token in the ingredient text
 * is prefixed with "organic" (case-insensitive). Used to detect products that
 * appear fully organic from their ingredient list even though no USDA cert tag
 * was found in the Open Food Facts database.
 *
 * Trivial ingredients (water and salt variants) are excluded from the check —
 * they are never organically certified and their presence should not block
 * the detection.
 *
 * Returns false when:
 *   - ingredientsText is empty/null
 *   - only trivial ingredients exist (e.g., "water, sea salt")
 *   - any non-trivial ingredient is NOT prefixed with "organic"
 *
 * @param {string|null} ingredientsText — raw ingredient string from OFF
 * @returns {boolean}
 */
function allIngredientsPrefixedOrganic(ingredientsText) {
  if (!ingredientsText) return false;

  // Strip parenthetical sub-ingredient lists so nested ingredients inside
  // a compound entry don't produce spurious tokens.
  // e.g. "Organic broth (organic carrots, water)" → "Organic broth "
  const stripped = ingredientsText.replace(/\([^)]*\)/g, '');

  // Split on commas; normalise each token (strip trailing punctuation/symbols)
  const tokens = stripped
    .split(',')
    .map(t => t.trim().replace(/[.*†‡]/g, '').trim().toLowerCase())
    .filter(t => t.length > 0);

  if (tokens.length === 0) return false;

  // Remove trivial ingredients before the organic-prefix check
  const nonTrivial = tokens.filter(t => !CERT_UNCONFIRMED_TRIVIAL.has(t));

  // No non-trivial ingredients (e.g., "water, sea salt") — never flag
  if (nonTrivial.length === 0) return false;

  return nonTrivial.every(t => t.startsWith('organic'));
}

// ── Pure-water detection ──────────────────────────────────────────────────

/**
 * Ingredients that are safe and expected in natural water products.
 * Covers all standard water forms and the minerals/gases that naturally
 * occur in spring, artesian, and mineral waters.
 *
 * Used by allIngredientsAreWaterSafe() to upgrade default-YELLOW water
 * products to GREEN — organic certification is inapplicable to geological
 * water sources, so the absence of a cert label is not a concern.
 */
const WATER_SAFE_INGREDIENTS = new Set([
  // Water forms
  'water', 'spring water', 'artesian water', 'mineral water', 'sparkling water',
  'carbonated water', 'purified water', 'distilled water', 'reverse osmosis water',
  'deionized water', 'filtered water',
  // Naturally occurring minerals (from geological water sources)
  'silica', 'calcium', 'magnesium', 'bicarbonates', 'bicarbonate', 'sodium',
  'potassium', 'fluoride', 'sulfate', 'sulfates', 'chloride', 'chlorides',
  'iron', 'zinc', 'manganese', 'chromium', 'selenium', 'lithium', 'strontium',
  'phosphate', 'phosphates',
  // CO2 (carbonation)
  'carbon dioxide', 'co2', 'natural carbon dioxide',
]);

/**
 * Returns true when every ingredient token in the text is found in the
 * WATER_SAFE_INGREDIENTS set. Used to identify pure natural water products
 * (spring water, artesian water, mineral water, etc.) that should receive a
 * GREEN verdict even though they cannot hold USDA organic certification.
 *
 * Strips parenthetical sub-ingredient lists before tokenising, exactly
 * as allIngredientsPrefixedOrganic() does.
 *
 * Returns false when:
 *   - ingredientsText is empty/null
 *   - any token is NOT in WATER_SAFE_INGREDIENTS (e.g. "coconut water", "natural flavor")
 *
 * @param {string|null} ingredientsText — raw ingredient string from OFF
 * @returns {boolean}
 */
function allIngredientsAreWaterSafe(ingredientsText) {
  if (!ingredientsText) return false;

  const stripped = ingredientsText.replace(/\([^)]*\)/g, '');

  const tokens = stripped
    .split(',')
    .map(t => t.trim().replace(/[.*†‡]/g, '').trim().toLowerCase())
    .filter(t => t.length > 0);

  if (tokens.length === 0) return false;

  return tokens.every(t => WATER_SAFE_INGREDIENTS.has(t));
}

/**
 * Replace each ALWAYS_IGNORE_INGREDIENTS term in the already-lowercased
 * `text` with same-length spaces. Prevents false positives in ingredient-
 * level helper functions (e.g. 'calcium carbonate' matching FORTIFIED_VITAMINS,
 * or 'cultures' being confused with dairy). The longest-first ordering in
 * ALWAYS_IGNORE_INGREDIENTS ensures 'himalayan pink salt' is masked before
 * the shorter 'salt' sub-string match would fire.
 *
 * @param {string} text — already lowercased ingredient string
 * @returns {string}
 */
function maskIgnoredIngredients(text) {
  let masked = text;
  for (const term of ALWAYS_IGNORE_INGREDIENTS) {
    const replacement = ' '.repeat(term.length);
    let idx = masked.indexOf(term);
    while (idx !== -1) {
      masked = masked.slice(0, idx) + replacement + masked.slice(idx + term.length);
      idx = masked.indexOf(term, idx + replacement.length);
    }
  }
  return masked;
}

// ── Product category mapping ──────────────────────────────────────────────
const CATEGORY_TAG_MAP = [
  { category: 'cereal', tags: [
    'en:cereals-and-their-products',
    'en:cereals',
    'en:breakfast-cereals',
    'en:granolas',
    'en:oatmeals',
    'en:mueslis',
    'en:porridges',
    'en:hot-cereals',
  ]},
  { category: 'dairy', tags: [
    'en:dairy-products',
    'en:yogurts',
    'en:milks',
    'en:butters',
    'en:creams',
    'en:cheeses',
    'en:kefirs',
    'en:dairy-alternatives',
    'en:plant-based-milks',
    'en:oat-milks',
    'en:almond-milks',
  ]},
  { category: 'bread', tags: [
    'en:breads',
    'en:english-muffins',
    'en:bagels',
    'en:baked-products',
    'en:muffins',
    'en:tortillas',
    'en:flatbreads',
    'en:wraps',
    'en:rolls',
    'en:pitas',
  ]},
  { category: 'beverages', tags: [
    'en:beverages',
    'en:drinks',
    'en:juices',
    'en:sodas',
    'en:waters',
    'en:teas',
    'en:coffees',
    'en:smoothies',
    'en:energy-drinks',
    'en:plant-based-beverages',
    'en:kombuchas',
    'en:coconut-waters',
    'en:cold-brew-coffees',
  ]},
  { category: 'frozen', tags: [
    'en:frozen-foods',
    'en:frozen-meals',
    'en:frozen-vegetables',
    'en:frozen-desserts',
    'en:frozen-meat',
    'en:frozen-fish',
    'en:frozen-waffles',
    'en:frozen-pizza',
  ]},
  { category: 'cooking_oils', tags: [
    'en:oils',
    'en:cooking-oils',
    'en:olive-oils',
    'en:coconut-oils',
    'en:avocado-oils',
    'en:vegetable-oils',
    'en:fats',
    'en:cooking-fats',
  ]},
  { category: 'condiments', tags: [
    'en:condiments',
    'en:sauces',
    'en:dressings',
    'en:ketchups',
    'en:mustards',
    'en:mayonnaises',
    'en:vinegars',
    'en:hot-sauces',
    'en:salad-dressings',
    'en:marinades',
    'en:spreads',
    'en:dips',
    'en:salsas',
  ]},
  { category: 'chips', tags: [
    'en:chips-and-fries',
    'en:crisps',
  ]},
  { category: 'snacks', tags: [
    'en:snacks',
    'en:salty-snacks',
    'en:popcorn',
    'en:pretzels',
    'en:crackers',
    'en:nuts',
    'en:seeds',
    'en:dried-fruits',
    'en:fruit-snacks',
    'en:energy-bars',
    'en:meat-snacks',
    'en:jerky',
    'en:rice-cakes',
  ]},
  { category: 'meat', tags: [
    'en:meats',
    'en:fresh-meats',
    'en:frozen-meats',
    'en:poultry',
    'en:beef',
    'en:pork',
    'en:chicken',
    'en:turkey',
    'en:ground-meat',
    'en:sausages',
    'en:deli-meats',
    'en:bacon',
  ]},
];

function mapProductCategory(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return null;
  const normalized = new Set(categoriesTags.map(t => String(t).toLowerCase()));
  for (const { category, tags } of CATEGORY_TAG_MAP) {
    if (tags.some(t => normalized.has(t))) {
      return category;
    }
  }
  return null;
}

module.exports = {
  OFF_LABEL_MAP,
  normalizeLabelTags,
  SEAFOOD_CATEGORIES,
  MEAT_CATEGORIES,
  isMeatProduct,
  isSeafoodProduct,
  GAME_MEAT_CATEGORIES,
  isGameMeatProduct,
  detectWildCaught,
  CERT_UNCONFIRMED_TRIVIAL,
  allIngredientsPrefixedOrganic,
  WATER_SAFE_INGREDIENTS,
  allIngredientsAreWaterSafe,
  maskIgnoredIngredients,
  CATEGORY_TAG_MAP,
  mapProductCategory,
};
