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
const { analyzeIngredients, containsFortifiedVitamins, containsNaturalColorants } = rulesEngine;

import { supabaseServer as sb } from '../../lib/supabaseServer';
import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_VERSION } from '../../lib/cacheVersion';
import { SYSTEM_PROMPT, buildUserMessage } from './explain';

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

// ── Meat product detection ────────────────────────────────────────────────
const MEAT_CATEGORIES = new Set([
  'en:meats', 'en:meat', 'en:beef', 'en:ground-beef', 'en:pork', 'en:chicken',
  'en:turkey', 'en:lamb', 'en:veal', 'en:poultry', 'en:game-meats',
  'en:fish', 'en:seafood', 'en:shellfish', 'en:crustaceans', 'en:molluscs',
  'en:salmon', 'en:tuna', 'en:cod', 'en:tilapia', 'en:shrimp',
  'en:deli-meats', 'en:cold-cuts', 'en:sausages', 'en:hot-dogs',
  'en:charcuterie', 'en:bacon', 'en:ham', 'en:salami', 'en:pepperoni',
  'en:smoked-meats', 'en:cured-meats',
  'en:broths', 'en:stocks', 'en:bone-broth', 'en:chicken-broth', 'en:beef-broth',
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
 *
 * @param {string}   verdict
 * @param {object[]} flags
 * @param {string}   productName
 * @param {string|null} ingredientsText
 * @param {1|2}      userLevel
 * @returns {Promise<{summary: string, details: object} | null>}
 */
async function fetchExplanation(verdict, flags, productName, ingredientsText, userLevel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: buildUserMessage(verdict, flags, productName, ingredientsText, userLevel),
      }],
    });

    const rawText = message.content.find(b => b.type === 'text')?.text ?? '{}';

    try {
      return JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      return { summary: rawText, details: {} };
    }
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
  const isMeat           = isMeatProduct(categoriesTags);
  const unverifiedReason = !ingredientsText ? 'no_ingredients' : null;

  // ── Run the rules engine ──────────────────────────────────────────────────
  const engineResult = analyzeIngredients(ingredientsText, labelsDetected, userLevel);
  let { verdict, flags, clearedBy, unverifiedIngredients } = engineResult;

  // ── Level 1 explicit overrides ───────────────────────────────────────────────
  // Two post-engine adjustments for L1 users only. L2 has its own waterfall below.
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

    // Override 2: conventional meat caution at L1 (educational yellow, no cert check).
    // Certification is irrelevant at L1 — the flag is always informational.
    // Does not run for unverified products (nothing screened, no ingredients present).
    if (isMeat && verdict !== 'unverified') {
      flags = [{
        category:          'conventional_meat',
        severity:          'caution',
        matchedIngredient: '',
        summary:           'Conventional meat — Joel explains the difference between conventional and pasture-raised: sourcing matters as much as ingredients. Look for grass-fed, pasture-raised, or meat from a farm you trust.',
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
  if (
    ingredientsText !== null &&
    verdict === 'green' &&
    flags.length === 0 &&
    (unverifiedIngredients?.length ?? 0) > 5
  ) {
    verdict = 'inconclusive';
  }

  // ── Level 2 verdict waterfall ─────────────────────────────────────────────
  // Overrides the engine verdict for Level 2 users only. First match wins.
  // Does not run for unverified or inconclusive results — no ingredients to gate.
  // Level 1 users are completely unaffected.
  //
  // Category name note: the engine emits 'additives' for all of
  // SYNTHETIC_ADDITIVES (artificial dyes, MSG, sweeteners, preservatives, etc.).
  // There are no separate 'artificial_dyes', 'flavor_enhancers', or
  // 'artificial_sweeteners' categories in the engine output.
  if (userLevel === 2 && verdict !== 'unverified' && verdict !== 'inconclusive') {
    // Strip gluten_grains flags before the waterfall evaluates verdict and flags.
    // Gluten is a future paywall feature — invisible at both levels. Without this
    // strip the engine's caution verdict (from gluten) would enter the cert gate
    // inflated, and gluten ConcernCards would render in the UI.
    const nonGlutenL2 = flags.filter(f => f.category !== 'gluten_grains');
    if (nonGlutenL2.length !== flags.length) {
      flags = nonGlutenL2;
      if (flags.some(f => f.severity === 'reject'))       verdict = 'red';
      else if (flags.some(f => f.severity === 'caution')) verdict = 'yellow';
      else                                                 verdict = 'green';
    }

    const hasOrganic = labelsDetected.includes('usda-organic');

    // ── INSTANT RED categories (nodes 1–7) ───────────────────────────────────
    // Any flag in these categories stops evaluation immediately → RED.
    const INSTANT_RED_CATEGORIES = new Set([
      'additives',       // covers all SYNTHETIC_ADDITIVES: dyes, MSG, sweeteners, preservatives
      'natural_flavors',
      'seed_oils',
      'trans_fats',
    ]);

    const hasInstantRedFlag = flags.some(f => INSTANT_RED_CATEGORIES.has(f.category));

    // Node 8: meat/fish/egg product without USDA Organic certification.
    const needsMeatFlag = isMeat && !hasOrganic;

    if (hasInstantRedFlag || needsMeatFlag) {
      // Inject conventional_meat flag first (node 8) when applicable.
      if (needsMeatFlag) {
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Meat product without USDA Organic certification',
        }, ...flags];
      }
      verdict   = 'red';
      clearedBy = null;

    } else if (hasOrganic) {
      // ── ORGANIC PATH (nodes 10–13) ─────────────────────────────────────────
      // Product passed all instant-red nodes and carries USDA Organic cert.
      // Minor concerns can still downgrade the verdict to yellow.
      // clearedBy is preserved from the engine ('organic') in all organic-path branches.
      if (ingredientsText && containsFortifiedVitamins(ingredientsText)) {
        // Node 10: synthetic vitamin fortification present.
        flags = [...flags, {
          category:          'fortified_vitamins',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with synthetic vitamin fortification',
        }];
        verdict = 'yellow';
      } else if (ingredientsText && containsNaturalColorants(ingredientsText)) {
        // Node 11: plant-derived colorants indicate processing-related color correction.
        flags = [...flags, {
          category:          'natural_colorants',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with natural plant-derived colorants',
        }];
        verdict = 'yellow';
      } else if (ingredientsText && ingredientsText.toLowerCase().includes('olive oil')) {
        // Node 12: olive oil adulteration risk — even organic labels are not immune.
        verdict = 'yellow';
        flags = [...flags, {
          category:          'olive_oil_adulteration',
          severity:          'caution',
          matchedIngredient: 'olive oil',
          summary:           'Olive oil adulteration is common — even organic olive oil may be cut with cheaper oils.',
        }];
      } else {
        // Node 13: no concerns found → fully clean.
        verdict = 'green';
      }

    } else {
      // ── NON-ORGANIC PATH (nodes 14–16) ────────────────────────────────────
      // Product passed all instant-red nodes but has no USDA Organic cert.
      const hasNonGmo = labelsDetected.includes('non-gmo-project-verified');
      const hasGlyphosateFree = labelsDetected.some(
        l => l === 'glyphosate-free' || l === 'glyphosate free'
      );

      if (hasNonGmo) {
        // Node 14: Non-GMO Project Verified → caution yellow.
        verdict   = 'yellow';
        clearedBy = 'non-gmo-project-verified';
      } else if (hasGlyphosateFree) {
        // Node 15: Glyphosate Free certification → caution yellow.
        verdict   = 'yellow';
        clearedBy = 'glyphosate-free';
      } else {
        // Node 16: no certification → conventional product → RED.
        verdict   = 'red';
        clearedBy = null;
      }
    }
  }

  // ── L2 post-waterfall: strip conventional_crops for organic products ──────
  // The cert gate already used conventional_crops flags to route the waterfall.
  // Displaying them alongside an organic verdict would mislead the user —
  // the organic certification supersedes the conventional-crop concern.
  if (userLevel === 2 && clearedBy === 'organic') {
    flags = flags.filter(f => f.category !== 'conventional_crops');
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
    ? await fetchExplanation(verdict, flags, productName, ingredientsText, userLevel)
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
  });
}
