/**
 * pages/api/scan.js — Beyond Labels barcode scan endpoint
 *
 * POST /api/scan
 * Body (JSON): { barcode: string, userLevel?: 1 | 2 }
 *
 * Flow:
 *   1. Validate method and input
 *   2. Sanitise barcode (strip non-digits, preserve leading zeros)
 *   3. Check scan_cache — return immediately on hit (source: 'cache')
 *   4. Fetch product from Open Food Facts
 *   5. Normalise OFF labels_tags → our internal certification strings
 *   6. Run ingredients through rulesEngine.analyzeIngredients()
 *   7. Call Claude for plain-language explanation
 *   8. Write full result to scan_cache
 *   9. Return structured JSON verdict
 *
 * Response shape (200 — product found or cache hit):
 * {
 *   verdict:               'red' | 'yellow' | 'green',
 *   flags:                 Flag[],
 *   clearedBy:             string | null,
 *   productName:           string,
 *   ingredients:           string | null,
 *   barcode:               string,
 *   source:                'open-food-facts' | 'cache',
 *   found:                 true,
 *   labelsDetected:        string[],
 *   unverifiedIngredients: string[],
 *   explanation:           { summary: string, details: object } | null
 * }
 *
 * Response shape (404 — product not in OFF database):
 * {
 *   verdict:               'unverified',
 *   flags:                 [],
 *   clearedBy:             null,
 *   productName:           null,
 *   ingredients:           null,
 *   barcode:               string,
 *   source:                'open-food-facts',
 *   found:                 false,
 *   labelsDetected:        [],
 *   unverifiedIngredients: [],
 *   explanation:           null
 * }
 */

import rulesEngine from '../../lib/rulesEngine';
const {
  analyzeIngredients,
  containsFortifiedVitamins,
  containsNaturalColorants,
  ALWAYS_IGNORE_INGREDIENTS,
  containsMilkDerived,
  containsMeatDerived,
  containsMeatIngredient,
} = rulesEngine;

import { getSupabaseServer } from '../../lib/supabaseServer';
import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_VERSION } from '../../lib/cacheVersion';
import { SYSTEM_PROMPT, buildUserMessage, parseExplanationResponse } from './explain';
import { ANTHROPIC_MODEL } from '../../lib/aiConfig';

const OFF_BASE = 'https://world.openfoodfacts.org/api/v0/product';

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

// Named exports for test use only (drift-guard: confirms MEAT_CATEGORIES's
// seafood entries and SEAFOOD_CATEGORIES stay in sync — see
// __tests__/api/scan.test.js). Not used by any other module; the handler
// itself remains the default export.
export { MEAT_CATEGORIES, SEAFOOD_CATEGORIES };

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

/**
 * Persist unverified ingredients to Supabase for team review.
 * Uses a select-then-insert-or-update pattern to correctly maintain
 * first_seen (never overwritten) and occurrence_count (always incremented).
 *
 * Designed to be called fire-and-forget — caller should .catch(() => {}).
 *
 * @param {string[]} ingredients  - Unrecognised ingredient tokens from rulesEngine.
 * @param {string}   productName  - Product name for context.
 * @param {string}   barcode      - Cleaned barcode for context.
 */
async function captureUnverifiedIngredients(ingredients, productName, barcode) {
  const sb = getSupabaseServer();
  if (!sb) return;

  const now = new Date().toISOString();

  for (const ingredient of ingredients) {
    // Check if this ingredient is already known.
    const { data: existing } = await sb
      .from('unverified_ingredients')
      .select('occurrence_count')
      .eq('ingredient', ingredient.toLowerCase())
      .maybeSingle();

    if (existing) {
      // Row exists — increment the counter and record the latest product context.
      await sb
        .from('unverified_ingredients')
        .update({
          occurrence_count: existing.occurrence_count + 1,
          product_name: productName || null,
          barcode: barcode || null,
        })
        .eq('ingredient', ingredient.toLowerCase());
    } else {
      // First time we've seen this ingredient — insert a new row.
      await sb
        .from('unverified_ingredients')
        .insert({
          ingredient: ingredient.toLowerCase(),
          product_name: productName || null,
          barcode: barcode || null,
          first_seen: now,
          occurrence_count: 1,
        });
    }
  }
}

/**
 * Call the Claude API and return a parsed explanation object.
 * Returns null on any error — callers must always handle null gracefully.
 * This includes an unparseable/truncated Claude response (see
 * parseExplanationResponse() in ./explain) — never surfaces raw,
 * malformed text as the explanation.
 *
 * @param {string}   verdict
 * @param {object[]} flags
 * @param {string}   productName
 * @param {string|null} ingredientsText
 * @param {1|2}      userLevel
 * @returns {Promise<{summary: string, details: object} | null>}
 */
async function fetchExplanation(verdict, flags, productName, ingredientsText, userLevel, clearedBy = null, unverifiedReason = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      ANTHROPIC_MODEL,
      max_tokens: 2000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: buildUserMessage(verdict, flags, productName, ingredientsText, userLevel, clearedBy, unverifiedReason),
      }],
    });

    const rawText = message.content.find(b => b.type === 'text')?.text ?? '{}';
    return parseExplanationResponse(rawText);
  } catch {
    return null;
  }
}

/**
 * Next.js API route handler.
 *
 * @param {import('next').NextApiRequest}  req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed. Send a POST request with { barcode } in the body.',
    });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { barcode, userLevel: rawUserLevel } = req.body ?? {};
  const userLevel = rawUserLevel === 1 || rawUserLevel === 2 ? rawUserLevel : 2;

  if (barcode === undefined || barcode === null || barcode === '') {
    return res.status(400).json({
      error: '`barcode` is required in the JSON request body.',
    });
  }

  // Strip everything that isn't a digit (hyphens, spaces, check-digit separators).
  // Leading zeros are preserved because barcodes like 021000025350 are valid.
  const cleanBarcode = String(barcode).trim().replace(/[^0-9]/g, '');

  if (!cleanBarcode) {
    return res.status(400).json({
      error: '`barcode` must contain at least one digit.',
    });
  }

  // ── Cache lookup ──────────────────────────────────────────────────────────
  const sb = getSupabaseServer();
  if (sb) {
    try {
      const { data: cached } = await sb
        .from('scan_cache')
        .select('*')
        .eq('barcode', cleanBarcode)
        .eq('user_level', userLevel)
        .eq('prompt_version', PROMPT_VERSION)
        .maybeSingle();

      if (cached) {
        // Touch last_accessed_at fire-and-forget — don't delay response.
        sb.from('scan_cache')
          .update({ last_accessed_at: new Date().toISOString() })
          .eq('id', cached.id)
          .then(() => {}).catch(() => {});

        return res.status(200).json({
          verdict:               cached.verdict,
          flags:                 cached.flags ?? [],
          clearedBy:             cached.cleared_by ?? null,
          productName:           cached.product_name,
          ingredients:           cached.ingredients ?? null,
          barcode:               cleanBarcode,
          source:                'cache',
          found:                 true,
          labelsDetected:        [],
          unverifiedIngredients: cached.unverified_ingredients ?? [],
          explanation:           cached.explanation ?? null,
          productCategory:       cached.product_category ?? null,
          unverifiedReason:      cached.unverified_reason ?? null,
          isMeat:                cached.is_meat ?? false,
          oliveCaveat:           cached.olive_caveat ?? false,
        });
      }
    } catch {
      // Cache read failure is non-fatal — fall through to normal scan flow.
    }
  }

  // ── Fetch from Open Food Facts ────────────────────────────────────────────
  let offData;

  try {
    const response = await fetch(`${OFF_BASE}/${cleanBarcode}.json`, {
      headers: {
        // OFF requests a meaningful User-Agent for non-trivial integrations.
        'User-Agent': 'BeyondLabels/1.0 (session-2-prototype)',
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        error: 'Upstream error from Open Food Facts.',
        detail: `HTTP ${response.status} ${response.statusText}`,
      });
    }

    offData = await response.json();
  } catch (err) {
    return res.status(502).json({
      error: 'Failed to reach Open Food Facts. Check network connectivity.',
      detail: err.message,
    });
  }

  // ── Product not found in OFF database ─────────────────────────────────────
  // OFF returns { status: 0 } when a barcode is not in their database.
  if (!offData || offData.status === 0 || !offData.product) {
    const { verdict, flags, clearedBy } = analyzeIngredients(null);

    return res.status(404).json({
      verdict,          // always 'unverified'
      flags,            // always []
      clearedBy,        // always null
      productName:           null,
      ingredients:           null,
      barcode:               cleanBarcode,
      source:                'open-food-facts',
      found:                 false,
      labelsDetected:        [],
      unverifiedIngredients: [],
      explanation:           null,
      productCategory:       null,
      unverifiedReason:      'not_found',
      isMeat:                false,
      oliveCaveat:           false,
    });
  }

  // ── Extract fields from OFF product object ────────────────────────────────
  const { product } = offData;

  // Prefer English names/ingredients when available.
  const productName =
    product.product_name_en ||
    product.product_name    ||
    'Unknown Product';

  const ingredientsText =
    product.ingredients_text_en ||
    product.ingredients_text    ||
    null;

  const labelsDetected   = normalizeLabelTags(product.labels_tags);
  const categoriesTags   = product.categories_tags ?? [];
  const productCategory  = mapProductCategory(categoriesTags);

  // is_meat corroboration (PROMPT_VERSION-independent — see CLAUDE.md
  // changelog): OFF categories_tags alone missed a majority of real meat
  // products in a scan_cache audit (missing category data, OFF's modern
  // canonical parent tags not matching our short-form set, or products
  // filed under an unrelated branch like "en:sandwiches"). Tracked as two
  // independent signals, OR'd for the actual isMeat used by the decision
  // tree. Both are persisted to scan_cache (is_meat_category,
  // is_meat_ingredient — Phase 2) so a cached row's meat classification is
  // auditable without re-scanning. The console.log below is kept
  // deliberately even though the values are now persisted — it gives an
  // immediate, real-time signal for the rollout of this exact fix (and any
  // future rules-engine session) without needing a DB round-trip, and per
  // the olive_caveat incident (see the Phase 2 migration file), verifying
  // this specific write path actually succeeds post-deploy is worth the
  // redundancy.
  const isMeatCategory   = isMeatProduct(categoriesTags);
  const isMeatIngredient = ingredientsText
    ? containsMeatIngredient(maskIgnoredIngredients(ingredientsText.toLowerCase()))
    : false;
  const isMeat = isMeatCategory || isMeatIngredient;
  console.log('[scan] meat detection signals:', {
    barcode,
    isMeatCategory,
    isMeatIngredient,
    isMeat,
  });

  let unverifiedReason = !ingredientsText ? 'no_ingredients' : null;

  // ── Run the rules engine ──────────────────────────────────────────────────
  const engineResult = analyzeIngredients(ingredientsText, labelsDetected, userLevel);
  let { verdict, flags, clearedBy, unverifiedIngredients } = engineResult;

  // oliveCaveat: true when the L2 organic path hits the olive oil adulteration
  // branch. Available on the response for future messaging; not yet persisted to DB.
  let oliveCaveat = false;

  // ── Level 1 explicit overrides ───────────────────────────────────────────────
  // Three post-engine adjustments for L1 users only. L2 has its own waterfall below.
  if (userLevel === 1) {
    // Override 1: suppress gluten_grains flags (paywall feature — not shown at L1).
    // Recalculate verdict from remaining flags so gluten never inflates the colour.
    const nonGlutenFlags = flags.filter(f => f.category !== 'gluten_grains');
    if (nonGlutenFlags.length !== flags.length) {
      flags = nonGlutenFlags;
      // Recalculate verdict from the pruned flag set.
      if (flags.some(f => f.severity === 'reject')) {
        verdict = 'red';
      } else if (flags.some(f => f.severity === 'caution')) {
        verdict = 'yellow';
      } else {
        verdict = 'green';
      }
    }

    // Pre-compute helpers shared by Overrides 2 and 3.
    const l1IsSeafood  = isSeafoodProduct(categoriesTags);
    const l1IsGameMeat = isGameMeatProduct(categoriesTags);
    const l1HasOrganic = labelsDetected.includes('usda-organic');
    const l1MaskedText = ingredientsText
      ? maskIgnoredIngredients(ingredientsText.toLowerCase())
      : '';

    // Override 2: meat handling at L1 — mirrors L2 nodes 5 and 6.
    // Wild-caught seafood and game meat are left clean (no flag injected).
    // Farmed/conventional seafood and all other meat get a caution flag.
    // Does not run for unverified products (nothing screened, no ingredients present).
    if (isMeat && verdict !== 'unverified') {
      if (l1IsSeafood && detectWildCaught(productName, labelsDetected, ingredientsText)) {
        // Mirror L2 node 5: wild-caught seafood → leave verdict and flags unchanged.
      } else if (l1IsGameMeat) {
        // Mirror L2 node 6: game meat → leave verdict and flags unchanged.
      } else {
        // Conventional meat or non-wild seafood: inject educational caution.
        // Summary text branches on l1IsSeafood so a farmed/unlabeled seafood
        // product doesn't get land-animal "grass-fed, pasture-raised" copy —
        // mirrors L2 Node 5b's seafood-aware wording ("Farmed or unlabeled
        // seafood — wild-caught certification not found"), softened to this
        // file's L1 educational tone (see Override 3's conventional_dairy
        // caution for the same "Joel explains..." phrasing convention).
        const summary = l1IsSeafood
          ? 'Farmed or unlabeled seafood — Joel explains the difference between wild-caught and farmed: sourcing matters as much as ingredients. Look for a wild-caught certification, or seafood from a source you trust.'
          : 'Conventional meat — Joel explains the difference between conventional and pasture-raised: sourcing matters as much as ingredients. Look for grass-fed, pasture-raised, or meat from a farm you trust.';
        flags = [{
          category:          'conventional_meat',
          severity:          'caution',
          matchedIngredient: '',
          summary,
        }, ...flags];
        // A caution flag can upgrade green → yellow, but cannot override red.
        if (verdict === 'green') verdict = 'yellow';
      }
    }

    // Override 3: conventional dairy caution at L1 — mirrors L2 node 9, softened.
    // Injects an educational caution when milk-derived ingredients are present
    // without USDA Organic certification. Caution severity only — does not
    // downgrade red verdicts, and does not run for unverified products.
    if (!l1HasOrganic && l1MaskedText && containsMilkDerived(l1MaskedText) && verdict !== 'unverified') {
      flags = [{
        category:          'conventional_dairy',
        severity:          'caution',
        matchedIngredient: '',
        summary:           "Conventional dairy — Joel explains what the farming system behind conventional dairy looks like: GMO feed, synthetic hormones, antibiotics. Organic dairy is a meaningful alternative when you're ready for that step.",
      }, ...flags];
      // A caution flag can upgrade green → yellow, but cannot override red.
      if (verdict === 'green') verdict = 'yellow';
    }
  }

  // ── Inconclusive verdict — recognized product, all-unknown ingredients ───────
  // Runs BEFORE the L2 waterfall so a product the engine could not screen at all
  // is never evaluated by the cert gate (there are no screened ingredients to
  // certify). Returning 'green' here would be a false-positive; 'inconclusive'
  // signals that screening was impossible.
  //
  // Proxy threshold: > 5 unverified tokens avoids flipping genuinely clean
  // products that have a handful of unfamiliar whole-food tokens.
  //
  // "No real flags" must exclude gluten_grains, mirroring the activeFlags
  // filter lib/rulesEngine.js uses for its own verdict calculation
  // (gluten is a paywall feature, invisible at both levels, by design).
  // rulesEngine.js excludes gluten_grains from ITS verdict field but does
  // NOT strip gluten_grains entries out of the flags array it returns — that
  // stripping only happens later, in the L2 tree pre-processing below. Using
  // the raw `flags` array here meant any product containing a gluten grain
  // (wheat, oat, barley, rye, etc.) had a non-empty flags array even when
  // gluten_grains was its only flag category, so this check would
  // short-circuit before ever evaluating the unverified-count threshold —
  // regardless of how many ingredients were actually unrecognized.
  const nonGlutenFlagsForInconclusive = flags.filter(f => f.category !== 'gluten_grains');
  if (
    ingredientsText !== null &&
    verdict === 'green' &&
    nonGlutenFlagsForInconclusive.length === 0 &&
    (unverifiedIngredients?.length ?? 0) > 5
  ) {
    verdict = 'inconclusive';
  }

  // ── Level 2 universal decision tree ──────────────────────────────────────
  // Replaces the previous cert-gate waterfall with a single decision tree that
  // applies to all 10 product categories. First matching node wins.
  // Does not run for unverified or inconclusive results — no ingredients to gate.
  // Level 1 users are completely unaffected.
  //
  // Category name note: the engine emits 'additives' for all of
  // SYNTHETIC_ADDITIVES (artificial dyes, MSG, sweeteners, preservatives, etc.).
  if (userLevel === 2 && verdict !== 'unverified' && verdict !== 'inconclusive') {
    // ── Strip gluten_grains before the tree runs ──────────────────────────────
    // Gluten is a future paywall feature — invisible at both levels. Without this
    // strip the engine's caution verdict (from gluten) would enter the tree
    // inflated, and gluten ConcernCards would render in the UI.
    const nonGlutenL2 = flags.filter(f => f.category !== 'gluten_grains');
    if (nonGlutenL2.length !== flags.length) {
      flags = nonGlutenL2;
      if (flags.some(f => f.severity === 'reject'))       verdict = 'red';
      else if (flags.some(f => f.severity === 'caution')) verdict = 'yellow';
      else                                                 verdict = 'green';
    }

    // ── Build masked ingredient text for helper checks ─────────────────────
    // Masks ALWAYS_IGNORE_INGREDIENTS (salt, water, mined minerals, yeast,
    // cultures, enzymes) to prevent false positives in containsFortifiedVitamins,
    // containsMilkDerived, containsEggDerived, etc.
    const maskedText = ingredientsText
      ? maskIgnoredIngredients(ingredientsText.toLowerCase())
      : '';

    // ── Pre-compute certification and product-type booleans ─────────────────
    const hasOrganic         = labelsDetected.includes('usda-organic');
    const hasNonGmo          = labelsDetected.includes('non-gmo-project-verified');
    const hasGlyphosateFree  = labelsDetected.includes('glyphosate-free');
    const hasGlyphosateHeavy = labelsDetected.includes('glyphosate-heavy');
    const isSeafood          = isSeafoodProduct(categoriesTags);
    const isGameMeat         = isGameMeatProduct(categoriesTags);
    // Conventional meat = any MEAT_CATEGORIES product that is NOT seafood and
    // NOT game meat (seafood/game have their own dedicated tree nodes).
    const isConventionalMeat = isMeat && !isSeafood && !isGameMeat;

    // ── Nodes 1–3: Instant RED categories ─────────────────────────────────
    // Any flag in these categories → RED immediately, no further checks.
    const INSTANT_RED_CATEGORIES = new Set([
      'additives',       // SYNTHETIC_ADDITIVES: dyes, MSG, sweeteners, preservatives
      'natural_flavors',
      'seed_oils',
      'trans_fats',
    ]);
    const hasInstantRedFlag = flags.some(f => INSTANT_RED_CATEGORIES.has(f.category));

    if (hasInstantRedFlag) {
      // Nodes 1–3 hit — synthetic / seed-oil / trans-fat contamination.
      verdict   = 'red';
      clearedBy = null;

    } else if (hasOrganic) {
      // ── Node 4: ORGANIC PATH ──────────────────────────────────────────────
      // Product passed nodes 1–3 and carries USDA Organic cert.
      // Minor concerns can still downgrade verdict to yellow.
      // clearedBy is set to 'organic' for all organic-path branches.
      clearedBy = 'organic';
      if (maskedText && containsFortifiedVitamins(maskedText)) {
        // Synthetic vitamin fortification.
        flags = [...flags, {
          category:          'fortified_vitamins',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with synthetic vitamin fortification',
        }];
        verdict = 'yellow';
      } else if (maskedText && containsNaturalColorants(maskedText)) {
        // Plant-derived colorants signal processing-related color correction.
        flags = [...flags, {
          category:          'natural_colorants',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with natural plant-derived colorants',
        }];
        verdict = 'yellow';
      } else if (maskedText && maskedText.includes('olive oil')) {
        // Olive oil adulteration risk — even organic labels are not immune.
        oliveCaveat = true;
        verdict = 'yellow';
        flags = [...flags, {
          category:          'olive_oil_adulteration',
          severity:          'caution',
          matchedIngredient: 'olive oil',
          summary:           'Olive oil adulteration is common — even organic olive oil may be cut with cheaper oils.',
        }];
      } else {
        // No concerns found → fully clean.
        verdict = 'green';
      }

    } else {
      // ── NON-ORGANIC PATH (Nodes 5–14) ────────────────────────────────────

      if (
        isSeafood &&
        !flags.some(f => f.severity === 'reject') &&
        detectWildCaught(productName, labelsDetected, ingredientsText)
      ) {
        // Node 5: Wild-caught fish — clean regardless of how the product is
        // categorised in OFF. Detected via OFF label OR product name; farmed
        // signals (name contains "farm-raised"/"farmed"/"atlantic salmon", or
        // ingredients contain "astaxanthin") take precedence and skip this node.
        //
        // Two gates added (fixing a live false-"all clear" bug): (1) `isSeafood`
        // — detectWildCaught() fires on the standalone word "wild" appearing
        // ANYWHERE in the product name or ingredients text (e.g. "wild rice",
        // "wild honey", "wild blueberries", "wild oats"), which is meaningless
        // for a non-seafood product; "wild-caught" as a clearance reason only
        // makes sense for actual seafood, so non-seafood products now fall
        // through to whichever later node actually matches their content
        // (e.g. Node 10 for conventional_crops). (2) `!flags.some(reject)` —
        // this node was unconditionally forcing verdict='green' even when a
        // reject-severity flag (conventional_crops, conventional_eggs,
        // bioengineering, glyphosate_heavy) was already present in `flags`,
        // silently ignoring it — the flag stayed in the response, but the
        // verdict never reflected it. Both gates mirror the existing
        // "reject flags always win" precedent already used by
        // INSTANT_RED_CATEGORIES at the very top of this tree.
        verdict   = 'green';
        clearedBy = 'wild-caught';

      } else if (isSeafood) {
        // Node 5b: Seafood without a wild-caught signal — farmed or unlabeled.
        verdict   = 'red';
        clearedBy = null;
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Farmed or unlabeled seafood — wild-caught certification not found',
        }, ...flags];

      } else if (isGameMeat) {
        // Node 6: Game meat — wild-harvested by nature, no certification needed.
        verdict   = 'green';
        clearedBy = null;

      } else if (hasNonGmo) {
        // Node 7: Non-GMO Project Verified → caution yellow.
        verdict   = 'yellow';
        clearedBy = 'non-gmo-project-verified';

      } else if (isConventionalMeat) {
        // Node 8: Conventional meat without organic cert.
        verdict   = 'red';
        clearedBy = null;
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Conventional meat product without USDA Organic certification',
        }, ...flags];

      } else if (flags.some(f => f.category === 'conventional_eggs')) {
        // Node 8b: Conventional eggs detected by the rules engine — no organic cert.
        // The flag (with matchedIngredient) was already emitted by the engine loop;
        // just set the verdict here. No injection needed.
        verdict   = 'red';
        clearedBy = null;

      } else if (maskedText && containsMeatDerived(maskedText)) {
        // Node 8c: Animal-derived gelatin without organic cert.
        verdict   = 'red';
        clearedBy = null;
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Contains animal-derived gelatin without organic certification.',
        }, ...flags];

      } else if (maskedText && containsMilkDerived(maskedText)) {
        // Node 9: Conventional dairy without organic cert.
        verdict   = 'red';
        clearedBy = null;
        flags = [{
          category:          'conventional_dairy',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Conventional dairy product without USDA Organic certification',
        }, ...flags];

      } else if (flags.some(f => f.category === 'conventional_crops')) {
        // Node 10: Conventional crops without cert — flags kept so user understands verdict.
        verdict   = 'red';
        clearedBy = null;

      } else if (flags.some(f => f.category === 'bioengineering')) {
        // Node 11: Bioengineered product without cert.
        verdict   = 'red';
        clearedBy = null;

      } else if (flags.some(f => f.category === 'glyphosate_heavy' && f.severity === 'reject')) {
        // Node 11b: Glyphosate-heavy crop the engine rejected (no organic/glyphosate-free
        // clearance — if either applied, the engine would already have downgraded this
        // flag's own severity to 'caution', so this check and Node 12 below are mutually
        // exclusive by construction). Every other reject-severity category the engine can
        // emit has an explicit check in this tree; this one was missing, silently letting
        // glyphosate_heavy-only products fall through to Node 14's default yellow.
        verdict   = 'red';
        clearedBy = null;

      } else if (hasGlyphosateFree) {
        // Node 12: Glyphosate Free certification → caution yellow.
        verdict   = 'yellow';
        clearedBy = 'glyphosate-free';

      } else if (hasGlyphosateHeavy) {
        // Node 13: Glyphosate heavy → Red.
        verdict   = 'red';
        clearedBy = null;

      } else {
        // Node 14: Default — no cert, but no specific concern triggered.
        // Yellow rather than red: clean-looking products like "pistachios, salt"
        // should not default to red just because they lack a certification.
        verdict   = 'yellow';
        clearedBy = null;
      }
    }
  }

  // ── L2 post-waterfall: strip conventional_crops for organic products ──────
  // The tree used conventional_crops flags in node 10 but on the organic path
  // the cert supersedes the conventional-crop concern — strip to avoid confusing
  // the user with a "conventional crops" card on an organic verdict.
  if (userLevel === 2 && clearedBy === 'organic') {
    flags = flags.filter(f => f.category !== 'conventional_crops');
  }

  // ── Cert-unconfirmed detection ────────────────────────────────────────────
  // When the verdict is default-Yellow (no flags, no clearedBy) and every
  // non-trivial ingredient in the text is prefixed "Organic", the product
  // looks fully organic but no USDA cert tag was found in OFF. Signal this
  // to the explanation layer so Claude gives the user the right message:
  // "the label looks organic — flip the package and check for the seal."
  // This runs for both user levels; in practice it only fires at L2 because
  // L1 organic-prefix products return green from the engine.
  if (
    verdict === 'yellow' &&
    flags.length === 0 &&
    clearedBy === null &&
    ingredientsText &&
    allIngredientsPrefixedOrganic(ingredientsText)
  ) {
    unverifiedReason = 'cert_unconfirmed';
  }

  // ── Pure-water GREEN path ─────────────────────────────────────────────────
  // Natural mineral water, spring water, artesian water and similar geological
  // water products cannot hold USDA organic certification — organic cert is
  // inapplicable to water sources. Leaving them at default YELLOW (Node 14)
  // misleads users into thinking there is a problem. When every ingredient
  // token is in WATER_SAFE_INGREDIENTS (water forms, naturally occurring
  // minerals, CO2), upgrade the verdict to GREEN with clearedBy 'pure_water'.
  //
  // Guard: clearedBy === null ensures cert-cleared products (e.g. glyphosate-free
  // water products — unlikely but possible) are not overwritten.
  if (
    verdict === 'yellow' &&
    flags.length === 0 &&
    clearedBy === null &&
    allIngredientsAreWaterSafe(ingredientsText)
  ) {
    verdict   = 'green';
    clearedBy = 'pure_water';
  }

  // ── Capture unverified ingredients ───────────────────────────────────────
  // Awaited so Vercel doesn't terminate the function before the write lands.
  // A failed write is logged and skipped — it never blocks the response.
  if (unverifiedIngredients?.length) {
    try {
      await captureUnverifiedIngredients(unverifiedIngredients, productName, cleanBarcode);
    } catch (err) {
      console.error('unverified_ingredients write failed:', err);
    }
  }

  // ── Fetch Claude explanation ──────────────────────────────────────────────
  // Skip for unverified and inconclusive results — no screened ingredients to
  // explain. Fail silently otherwise — null degrades gracefully on the frontend.
  const explanation = (verdict !== 'unverified' && verdict !== 'inconclusive')
    ? await fetchExplanation(verdict, flags, productName, ingredientsText, userLevel, clearedBy, unverifiedReason)
    : null;

  // ── Write to scan cache ───────────────────────────────────────────────────
  // Awaited so Vercel doesn't terminate the function before the write lands.
  // A failed write is logged and skipped — it never blocks the response.
  if (sb) {
    try {
      await sb.from('scan_cache')
        .upsert(
          {
            barcode:                cleanBarcode,
            user_level:             userLevel,
            verdict,
            flags,
            ingredients:            ingredientsText,
            cleared_by:             clearedBy,
            unverified_ingredients: unverifiedIngredients ?? [],
            explanation,
            unverified_reason:      unverifiedReason,
            product_name:           productName,
            product_category:       productCategory,
            is_meat:                isMeat,
            is_meat_category:       isMeatCategory,
            is_meat_ingredient:     isMeatIngredient,

            prompt_version:         PROMPT_VERSION,
            last_accessed_at:       new Date().toISOString(),
          },
          { onConflict: 'barcode,user_level' },
        );
    } catch (err) {
      console.error('scan_cache write failed:', err);
    }
  }

  return res.status(200).json({
    verdict,
    flags,
    clearedBy,
    productName,
    ingredients:           ingredientsText,
    barcode:               cleanBarcode,
    source:                'open-food-facts',
    found:                 true,
    labelsDetected,
    unverifiedIngredients: unverifiedIngredients ?? [],
    explanation,
    productCategory,
    unverifiedReason,
    isMeat,
    oliveCaveat,
  });
}
