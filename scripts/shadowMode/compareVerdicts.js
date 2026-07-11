'use strict';

/**
 * scripts/shadowMode/compareVerdicts.js
 *
 * Stage 4 of the L1/L2 unification project: shadow-mode comparison.
 *
 * Runs the CORRECTED target logic (as encoded in lib/verdictRules.js's
 * VERDICT_RULES / CROSS_CUTTING_RULES / DESIGN_DECISIONS) against all 135
 * Golden Master cases, and diffs it against the real, frozen scan.js output
 * already captured in scripts/goldenMaster/snapshot-baseline.json.
 *
 * Nothing here is wired into any live path:
 *   - pages/api/scan.js, lib/rulesEngine.js, lib/verdictRules.js are all
 *     read/required but never modified.
 *   - No Supabase client is constructed; no network calls happen.
 *   - No PROMPT_VERSION bump — this stage changes no production behavior.
 *
 * Run: node scripts/shadowMode/compareVerdicts.js
 * Writes: scripts/shadowMode/shadow-report.json, scripts/shadowMode/shadow-report.md
 *
 * ── Why this script duplicates several pages/api/scan.js helpers ──────────
 * scan.js only exports `handler` (default) and `MEAT_CATEGORIES`/
 * `SEAFOOD_CATEGORIES` (named, added for an existing drift-guard test).
 * Every other helper the L1/L2 logic depends on — normalizeLabelTags(),
 * isMeatProduct()/isSeafoodProduct()/isGameMeatProduct(), detectWildCaught(),
 * allIngredientsPrefixedOrganic(), allIngredientsAreWaterSafe(),
 * maskIgnoredIngredients(), mapProductCategory() — is private to that file.
 * scan.js also uses ES module import/export syntax that plain `node` cannot
 * `require()` at all (confirmed in Stage 1 — ERR_MODULE_NOT_FOUND), so even
 * the two exported Sets aren't reachable without running through Jest.
 * Per explicit instruction not to modify scan.js (which would be required to
 * export these), this script re-derives faithful copies of each helper
 * below, each flagged with a standing "will drift if scan.js changes" note.
 *
 * lib/rulesEngine.js's exports ARE genuinely reused, not copied:
 * analyzeIngredients, containsFortifiedVitamins, containsNaturalColorants,
 * containsMilkDerived, containsMeatDerived, containsMeatIngredient,
 * ALWAYS_IGNORE_INGREDIENTS.
 */

const fs = require('fs');
const path = require('path');

const {
  analyzeIngredients,
  containsFortifiedVitamins,
  containsNaturalColorants,
  containsMilkDerived,
  containsMeatDerived,
  containsMeatIngredient,
  ALWAYS_IGNORE_INGREDIENTS,
} = require('../../lib/rulesEngine');

const {
  CROSS_CUTTING_RULES,
  DESIGN_DECISIONS,
} = require('../../lib/verdictRules');

const SCAN_JS_MIRROR_AS_OF = 'commit 5252708, 2026-07-11';

// ════════════════════════════════════════════════════════════════════════
// Mirrored copies of pages/api/scan.js's private helpers
// ════════════════════════════════════════════════════════════════════════

/** Mirrors pages/api/scan.js's private OFF_LABEL_MAP as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
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
};

/** Mirrors pages/api/scan.js's private normalizeLabelTags() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
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

/** Mirrors pages/api/scan.js's private SEAFOOD_CATEGORIES as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
const SEAFOOD_CATEGORIES = new Set([
  'en:fish', 'en:seafood', 'en:shellfish', 'en:crustaceans', 'en:molluscs',
  'en:salmon', 'en:tuna', 'en:cod', 'en:tilapia', 'en:shrimp',
]);

/** Mirrors pages/api/scan.js's private MEAT_CATEGORIES as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
const MEAT_CATEGORIES = new Set([
  'en:meats', 'en:meat', 'en:beef', 'en:ground-beef', 'en:pork', 'en:chicken',
  'en:turkey', 'en:lamb', 'en:veal', 'en:poultry', 'en:game-meats',
  ...SEAFOOD_CATEGORIES,
  'en:deli-meats', 'en:cold-cuts', 'en:sausages', 'en:hot-dogs',
  'en:charcuterie', 'en:bacon', 'en:ham', 'en:salami', 'en:pepperoni',
  'en:smoked-meats', 'en:cured-meats',
  'en:bone-broth', 'en:chicken-broth', 'en:beef-broth',
  'en:eggs', 'en:egg-products', 'en:poultry-eggs',
]);

/** Mirrors pages/api/scan.js's private GAME_MEAT_CATEGORIES as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
const GAME_MEAT_CATEGORIES = new Set([
  'en:game-meats',
  'en:game',
  'en:wild-game',
]);

/** Mirrors pages/api/scan.js's private isMeatProduct() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
function isMeatProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => MEAT_CATEGORIES.has(String(t).toLowerCase()));
}

/** Mirrors pages/api/scan.js's private isSeafoodProduct() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
function isSeafoodProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => SEAFOOD_CATEGORIES.has(String(t).toLowerCase()));
}

/** Mirrors pages/api/scan.js's private isGameMeatProduct() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
function isGameMeatProduct(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return false;
  return categoriesTags.some(t => GAME_MEAT_CATEGORIES.has(String(t).toLowerCase()));
}

/** Mirrors pages/api/scan.js's private detectWildCaught() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
function detectWildCaught(productName, labelsDetected, ingredientsText) {
  const nameLower = (productName || '').toLowerCase();
  const ingLower  = (ingredientsText || '').toLowerCase();

  const FARMED_NAME_SIGNALS = ['farm-raised', 'farmed', 'atlantic salmon'];
  if (FARMED_NAME_SIGNALS.some(s => nameLower.includes(s))) return false;
  if (ingLower.includes('astaxanthin')) return false;

  const STANDALONE_WILD = /\bwild\b/;

  if (labelsDetected.includes('wild-caught')) return true;

  const WILD_NAME_SIGNALS = ['wild-caught', 'wild caught'];
  if (WILD_NAME_SIGNALS.some(s => nameLower.includes(s))) return true;

  if (STANDALONE_WILD.test(nameLower)) return true;

  if (ingLower && STANDALONE_WILD.test(ingLower)) return true;

  return false;
}

/** Mirrors pages/api/scan.js's private CERT_UNCONFIRMED_TRIVIAL as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
const CERT_UNCONFIRMED_TRIVIAL = new Set([
  'water', 'filtered water', 'purified water', 'spring water',
  'sea salt', 'salt', 'himalayan salt', 'himalayan pink salt',
  'pink himalayan salt',
]);

/** Mirrors pages/api/scan.js's private allIngredientsPrefixedOrganic() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run.
 *  NOTE: computed for completeness (feeds unverifiedReason) but unverifiedReason is
 *  explicitly OUT OF SCOPE for this comparison's diff — see the methodology notes in
 *  the generated report. */
function allIngredientsPrefixedOrganic(ingredientsText) {
  if (!ingredientsText) return false;
  const stripped = ingredientsText.replace(/\([^)]*\)/g, '');
  const tokens = stripped
    .split(',')
    .map(t => t.trim().replace(/[.*†‡]/g, '').trim().toLowerCase())
    .filter(t => t.length > 0);
  if (tokens.length === 0) return false;
  const nonTrivial = tokens.filter(t => !CERT_UNCONFIRMED_TRIVIAL.has(t));
  if (nonTrivial.length === 0) return false;
  return nonTrivial.every(t => t.startsWith('organic'));
}

/** Mirrors pages/api/scan.js's private WATER_SAFE_INGREDIENTS as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
const WATER_SAFE_INGREDIENTS = new Set([
  'water', 'spring water', 'artesian water', 'mineral water', 'sparkling water',
  'carbonated water', 'purified water', 'distilled water', 'reverse osmosis water',
  'deionized water', 'filtered water',
  'silica', 'calcium', 'magnesium', 'bicarbonates', 'bicarbonate', 'sodium',
  'potassium', 'fluoride', 'sulfate', 'sulfates', 'chloride', 'chlorides',
  'iron', 'zinc', 'manganese', 'chromium', 'selenium', 'lithium', 'strontium',
  'phosphate', 'phosphates',
  'carbon dioxide', 'co2', 'natural carbon dioxide',
]);

/** Mirrors pages/api/scan.js's private allIngredientsAreWaterSafe() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run. */
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

/** Mirrors pages/api/scan.js's private maskIgnoredIngredients() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run.
 *  ALWAYS_IGNORE_INGREDIENTS itself is genuinely reused (imported from lib/rulesEngine.js's
 *  exports) — only the masking loop is a copy. */
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

/** Mirrors pages/api/scan.js's private CATEGORY_TAG_MAP / mapProductCategory() as of commit 5252708, 2026-07-11 — not imported, will drift if scan.js changes before this script is next run.
 *  NOTE: productCategory is explicitly OUT OF SCOPE for this comparison's diff (per
 *  decision #2 — unrelated to verdict logic) — included only so the interpreter's
 *  return shape mirrors scan.js's full response shape for completeness. */
const CATEGORY_TAG_MAP = [
  { category: 'cereal', tags: ['en:cereals-and-their-products', 'en:cereals', 'en:breakfast-cereals', 'en:granolas', 'en:oatmeals', 'en:mueslis', 'en:porridges', 'en:hot-cereals'] },
  { category: 'dairy', tags: ['en:dairy-products', 'en:yogurts', 'en:milks', 'en:butters', 'en:creams', 'en:cheeses', 'en:kefirs', 'en:dairy-alternatives', 'en:plant-based-milks', 'en:oat-milks', 'en:almond-milks'] },
  { category: 'bread', tags: ['en:breads', 'en:english-muffins', 'en:bagels', 'en:baked-products', 'en:muffins', 'en:tortillas', 'en:flatbreads', 'en:wraps', 'en:rolls', 'en:pitas'] },
  { category: 'beverages', tags: ['en:beverages', 'en:drinks', 'en:juices', 'en:sodas', 'en:waters', 'en:teas', 'en:coffees', 'en:smoothies', 'en:energy-drinks', 'en:plant-based-beverages', 'en:kombuchas', 'en:coconut-waters', 'en:cold-brew-coffees'] },
  { category: 'frozen', tags: ['en:frozen-foods', 'en:frozen-meals', 'en:frozen-vegetables', 'en:frozen-desserts', 'en:frozen-meat', 'en:frozen-fish', 'en:frozen-waffles', 'en:frozen-pizza'] },
  { category: 'cooking_oils', tags: ['en:oils', 'en:cooking-oils', 'en:olive-oils', 'en:coconut-oils', 'en:avocado-oils', 'en:vegetable-oils', 'en:fats', 'en:cooking-fats'] },
  { category: 'condiments', tags: ['en:condiments', 'en:sauces', 'en:dressings', 'en:ketchups', 'en:mustards', 'en:mayonnaises', 'en:vinegars', 'en:hot-sauces', 'en:salad-dressings', 'en:marinades', 'en:spreads', 'en:dips', 'en:salsas'] },
  { category: 'chips', tags: ['en:chips-and-fries', 'en:crisps'] },
  { category: 'snacks', tags: ['en:snacks', 'en:salty-snacks', 'en:popcorn', 'en:pretzels', 'en:crackers', 'en:nuts', 'en:seeds', 'en:dried-fruits', 'en:fruit-snacks', 'en:energy-bars', 'en:meat-snacks', 'en:jerky', 'en:rice-cakes'] },
  { category: 'meat', tags: ['en:meats', 'en:fresh-meats', 'en:frozen-meats', 'en:poultry', 'en:beef', 'en:pork', 'en:chicken', 'en:turkey', 'en:ground-meat', 'en:sausages', 'en:deli-meats', 'en:bacon'] },
];

function mapProductCategory(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return null;
  const normalized = new Set(categoriesTags.map(t => String(t).toLowerCase()));
  for (const { category, tags } of CATEGORY_TAG_MAP) {
    if (tags.some(t => normalized.has(t))) return category;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// Shared helper
// ════════════════════════════════════════════════════════════════════════

/** Mirrors lib/rulesEngine.js's own internal verdict-from-flags rule
 *  (hasReject→red, hasCaution→yellow, else green, excluding gluten_grains) —
 *  used here to recompute verdict after the interpreter's own flag-array
 *  mutations (bioengineering clearance, gluten strip), exactly as
 *  pages/api/scan.js does after its own equivalent mutations. */
function recomputeVerdictFromFlags(flags) {
  const activeFlags = flags.filter(f => f.category !== 'gluten_grains');
  if (activeFlags.some(f => f.severity === 'reject')) return 'red';
  if (activeFlags.some(f => f.severity === 'caution')) return 'yellow';
  return 'green';
}

// ════════════════════════════════════════════════════════════════════════
// The corrected unified interpreter
// ════════════════════════════════════════════════════════════════════════

const INSTANT_RED_CATEGORIES = new Set(CROSS_CUTTING_RULES.instantRedPriorityTier.categories);

/**
 * Computes the CORRECTED target verdict/flags/clearedBy for one case,
 * mirroring today's L1-override / L2-tree control flow (still the right
 * shape for "which rule applies when" — VERDICT_RULES intentionally
 * doesn't re-encode control flow, only per-category facts, per Stage 2's
 * own cross-cutting-rules recommendation) but with the three DESIGN_DECISIONS
 * corrections baked in:
 *
 *   #1 — bioengineering gains LABEL-based clearance, but usda-organic ONLY
 *        (REVISED after the first shadow-mode run — non-gmo-project-verified
 *        was removed as a clearance mechanism for this category specifically,
 *        per lib/verdictRules.js's DESIGN_DECISIONS.bioengineeringNonGmoLabel
 *        Excluded: organic certification is a legal GMO prohibition, so full
 *        clearance there is safe; Non-GMO Project Verified is a private,
 *        point-in-time cert that can go stale relative to a product's current
 *        formulation, and bioengineering is a reject-severity flag — the
 *        app's strongest signal — so a false negative there is worse than an
 *        over-cautious verdict). Applied once, immediately after the real
 *        engine call, before either the L1 or L2 branch — modeling "as if
 *        the engine itself had cleared it." Organic-ingredient-PREFIX
 *        clearance is still NOT implemented — see the methodology notes in
 *        the generated report.
 *
 *   #2 — the L2 tree's game-meat branch is a GATED GREEN (REVISED after the
 *        first shadow-mode run — previously modeled as a full no-op removed
 *        from the priority chain entirely, which turned out to have an
 *        undecided side effect: a clean game-meat product fell through to
 *        Node 14's default yellow instead of getting an automatic green, a
 *        new L1/L2 asymmetry nobody had actually decided on). Now mirrors
 *        the wild-caught Node 5 pattern exactly: game-meat category present
 *        AND no pre-existing reject-severity flag → green; if a reject flag
 *        IS present, the branch does not match (condition is false) and the
 *        chain falls through normally, leaving that flag untouched. isGameMeat
 *        still excludes the product from isConventionalMeat, same as today.
 *
 *   #4 — conventional_eggs is checked BEFORE the generic conventional_meat
 *        injection, at both levels (L1's Override 2 "else" branch, and L2
 *        Node 8), so eggs win whenever both would otherwise apply. Scoped
 *        narrowly to the Node 8 / L1-else case specifically — matching the
 *        original discrepancy #4 finding exactly — NOT extended to Node 5b
 *        (farmed seafood) or Node 8c (gelatin), which were never part of
 *        the reported ordering issue.
 */
function computeUnifiedVerdict({ ingredientText, productLabels, categoriesTags, productName, userLevel }) {
  const labelsDetected = normalizeLabelTags(productLabels);
  const isMeatCategory = isMeatProduct(categoriesTags);
  const isMeatIngredient = ingredientText
    ? containsMeatIngredient(maskIgnoredIngredients(ingredientText.toLowerCase()))
    : false;
  const isMeat = isMeatCategory || isMeatIngredient;

  const engineResult = analyzeIngredients(ingredientText, labelsDetected, userLevel);
  let flags = engineResult.flags;
  let verdict = engineResult.verdict;
  let clearedBy = engineResult.clearedBy;
  const unverifiedIngredients = engineResult.unverifiedIngredients;
  let oliveCaveat = false;
  let unverifiedReason = null; // computed for completeness; explicitly OUT OF SCOPE for diffing

  // ── CORRECTION #1: bioengineering label-based clearance (organic-label ONLY) ──
  // REVISED: non-gmo-project-verified no longer clears this category — see
  // lib/verdictRules.js's DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded.
  const hasUsdaOrganicLabel = labelsDetected.includes('usda-organic');
  if (hasUsdaOrganicLabel) {
    const hadBioengineering = flags.some(f => f.category === 'bioengineering');
    if (hadBioengineering) {
      flags = flags.filter(f => f.category !== 'bioengineering');
      verdict = recomputeVerdictFromFlags(flags);
    }
  }

  if (userLevel === 1) {
    // Override 1: gluten strip.
    const nonGluten = flags.filter(f => f.category !== 'gluten_grains');
    if (nonGluten.length !== flags.length) {
      flags = nonGluten;
      verdict = recomputeVerdictFromFlags(flags);
    }

    const l1IsSeafood  = isSeafoodProduct(categoriesTags);
    const l1IsGameMeat = isGameMeatProduct(categoriesTags);
    const l1HasOrganic = labelsDetected.includes('usda-organic');
    const l1MaskedText = ingredientText ? maskIgnoredIngredients(ingredientText.toLowerCase()) : '';

    // Override 2: meat handling (game-meat/wild-caught branches are ALREADY
    // true no-ops today — no correction needed at L1; only the eggs-priority
    // check, #4, is new here).
    if (isMeat && verdict !== 'unverified') {
      if (l1IsSeafood && detectWildCaught(productName, labelsDetected, ingredientText)) {
        // no-op
      } else if (l1IsGameMeat) {
        // no-op
      } else if (flags.some(f => f.category === 'conventional_eggs')) {
        // CORRECTION #4: conventional_eggs takes priority — skip the generic injection.
      } else {
        const summary = l1IsSeafood
          ? 'Farmed or unlabeled seafood — Joel explains the difference between wild-caught and farmed: sourcing matters as much as ingredients. Look for a wild-caught certification, or seafood from a source you trust.'
          : 'Conventional meat — Joel explains the difference between conventional and pasture-raised: sourcing matters as much as ingredients. Look for grass-fed, pasture-raised, or meat from a farm you trust.';
        flags = [{ category: 'conventional_meat', severity: 'caution', matchedIngredient: '', summary }, ...flags];
        if (verdict === 'green') verdict = 'yellow';
      }
    }

    // Override 3: dairy caution — unaffected by any correction.
    if (!l1HasOrganic && l1MaskedText && containsMilkDerived(l1MaskedText) && verdict !== 'unverified') {
      flags = [{
        category: 'conventional_dairy', severity: 'caution', matchedIngredient: '',
        summary: "Conventional dairy — Joel explains what the farming system behind conventional dairy looks like: GMO feed, synthetic hormones, antibiotics. Organic dairy is a meaningful alternative when you're ready for that step.",
      }, ...flags];
      if (verdict === 'green') verdict = 'yellow';
    }
  }

  // ── Inconclusive verdict (both levels, unmodified) ───────────────────────
  const nonGlutenForInconclusive = flags.filter(f => f.category !== 'gluten_grains');
  if (
    ingredientText !== null &&
    verdict === 'green' &&
    nonGlutenForInconclusive.length === 0 &&
    (unverifiedIngredients?.length ?? 0) > 5
  ) {
    verdict = 'inconclusive';
  }

  if (userLevel === 2 && verdict !== 'unverified' && verdict !== 'inconclusive') {
    // Strip gluten pre-tree.
    const nonGlutenL2 = flags.filter(f => f.category !== 'gluten_grains');
    if (nonGlutenL2.length !== flags.length) {
      flags = nonGlutenL2;
      verdict = recomputeVerdictFromFlags(flags);
    }

    const maskedText = ingredientText ? maskIgnoredIngredients(ingredientText.toLowerCase()) : '';
    const hasOrganic         = labelsDetected.includes('usda-organic');
    const hasNonGmo          = labelsDetected.includes('non-gmo-project-verified');
    const hasGlyphosateFree  = labelsDetected.includes('glyphosate-free');
    const hasGlyphosateHeavy = labelsDetected.includes('glyphosate-heavy');
    const isSeafood  = isSeafoodProduct(categoriesTags);
    const isGameMeat = isGameMeatProduct(categoriesTags);
    const isConventionalMeat = isMeat && !isSeafood && !isGameMeat;

    const hasInstantRedFlag = flags.some(f => INSTANT_RED_CATEGORIES.has(f.category));

    if (hasInstantRedFlag) {
      verdict = 'red';
      clearedBy = null;

    } else if (hasOrganic) {
      clearedBy = 'organic';
      if (maskedText && containsFortifiedVitamins(maskedText)) {
        flags = [...flags, { category: 'fortified_vitamins', severity: 'caution', matchedIngredient: '', summary: 'Organic product with synthetic vitamin fortification' }];
        verdict = 'yellow';
      } else if (maskedText && containsNaturalColorants(maskedText)) {
        flags = [...flags, { category: 'natural_colorants', severity: 'caution', matchedIngredient: '', summary: 'Organic product with natural plant-derived colorants' }];
        verdict = 'yellow';
      } else if (maskedText && maskedText.includes('olive oil')) {
        oliveCaveat = true;
        verdict = 'yellow';
        flags = [...flags, { category: 'olive_oil_adulteration', severity: 'caution', matchedIngredient: 'olive oil', summary: 'Olive oil adulteration is common — even organic olive oil may be cut with cheaper oils.' }];
      } else {
        verdict = 'green';
      }

    } else {
      // Non-organic path.
      if (
        isSeafood &&
        !flags.some(f => f.severity === 'reject') &&
        detectWildCaught(productName, labelsDetected, ingredientText)
      ) {
        verdict = 'green';
        clearedBy = 'wild-caught';

      } else if (isSeafood) {
        verdict = 'red';
        clearedBy = null;
        flags = [{ category: 'conventional_meat', severity: 'reject', matchedIngredient: '', summary: 'Farmed or unlabeled seafood — wild-caught certification not found' }, ...flags];

      // CORRECTION #2 (REVISED): game-meat is a GATED GREEN, mirroring the
      // wild-caught branch immediately above — game meat + no pre-existing
      // reject-severity flag → green. If a reject flag IS present, this
      // condition is simply false and the chain falls through to whichever
      // later node matches the real concern, exactly like the wild-caught
      // gate's own fallback behavior. isGameMeat still excludes the product
      // from isConventionalMeat below, unchanged.
      } else if (isGameMeat && !flags.some(f => f.severity === 'reject')) {
        verdict = 'green';
        clearedBy = null;

      } else if (hasNonGmo && !flags.some(f => f.severity === 'reject')) {
        verdict = 'yellow';
        clearedBy = 'non-gmo-project-verified';

      // CORRECTION #4: conventional_eggs checked BEFORE isConventionalMeat
      // (today's live scan.js checks isConventionalMeat first — Node 8
      // before Node 8b).
      } else if (flags.some(f => f.category === 'conventional_eggs')) {
        verdict = 'red';
        clearedBy = null;

      } else if (isConventionalMeat) {
        verdict = 'red';
        clearedBy = null;
        flags = [{ category: 'conventional_meat', severity: 'reject', matchedIngredient: '', summary: 'Conventional meat product without USDA Organic certification' }, ...flags];

      } else if (maskedText && containsMeatDerived(maskedText)) {
        verdict = 'red';
        clearedBy = null;
        flags = [{ category: 'conventional_meat', severity: 'reject', matchedIngredient: '', summary: 'Contains animal-derived gelatin without organic certification.' }, ...flags];

      } else if (maskedText && containsMilkDerived(maskedText)) {
        verdict = 'red';
        clearedBy = null;
        flags = [{ category: 'conventional_dairy', severity: 'reject', matchedIngredient: '', summary: 'Conventional dairy product without USDA Organic certification' }, ...flags];

      } else if (flags.some(f => f.category === 'conventional_crops')) {
        verdict = 'red';
        clearedBy = null;

      } else if (flags.some(f => f.category === 'bioengineering')) {
        // Rarely reached post-correction-#1 (most bioengineering flags are
        // already cleared/removed above) — kept for completeness in case a
        // bioengineering flag survives with neither label present.
        verdict = 'red';
        clearedBy = null;

      } else if (flags.some(f => f.category === 'glyphosate_heavy' && f.severity === 'reject')) {
        verdict = 'red';
        clearedBy = null;

      } else if (hasGlyphosateFree) {
        verdict = 'yellow';
        clearedBy = 'glyphosate-free';

      } else if (hasGlyphosateHeavy) {
        verdict = 'red';
        clearedBy = null;

      } else {
        verdict = 'yellow';
        clearedBy = null;
      }
    }
  }

  // Note: the old L2 tree's post-waterfall "strip conventional_crops when
  // clearedBy==='organic'" step is deliberately NOT reproduced here — per
  // discrepancy #6, it is not carried into lib/verdictRules.js at all
  // (believed dead/unreachable), so the corrected interpreter built from
  // that table doesn't have it either.

  // Cert-unconfirmed — computed for completeness (unverifiedReason is part
  // of scan.js's real response shape) but explicitly OUT OF SCOPE for this
  // comparison's diff, per decision #2.
  if (
    verdict === 'yellow' &&
    flags.length === 0 &&
    clearedBy === null &&
    ingredientText &&
    allIngredientsPrefixedOrganic(ingredientText)
  ) {
    unverifiedReason = 'cert_unconfirmed';
  }

  // Pure-water GREEN path (both levels, unmodified) — DOES affect verdict/clearedBy.
  if (
    verdict === 'yellow' &&
    flags.length === 0 &&
    clearedBy === null &&
    allIngredientsAreWaterSafe(ingredientText)
  ) {
    verdict = 'green';
    clearedBy = 'pure_water';
  }

  return { verdict, flags, clearedBy, isMeat, oliveCaveat, unverifiedReason, unverifiedIngredients };
}

// ════════════════════════════════════════════════════════════════════════
// Diffing
// ════════════════════════════════════════════════════════════════════════

/** Reduces a flags array to the comparable shape: category + severity only
 *  (per decision #2 — summary text is presentation, not logic), sorted so
 *  array-order differences (e.g. which injected flag got prepended first)
 *  don't themselves count as a diff unless the actual member sets differ. */
function flagsForComparison(flags) {
  return flags
    .map(f => `${f.category}:${f.severity}`)
    .sort();
}

const CORRECTION_TAGS = {
  bioengineering: '#1 (bioengineering organic/non-gmo clearance)',
  conventional_meat_game: '#2 (conventional_meat game-meat no-op)',
  conventional_eggs_priority: '#4 (conventional_eggs priority over conventional_meat)',
};

/**
 * Classifies a diff between the corrected interpreter's output and the real
 * snapshot as "expected" (attributable to one of the three known
 * corrections) or "unexpected" (anything else). This is a best-effort
 * classification based on which categories/fields actually changed, not a
 * guarantee — every diff, expected or not, is still recorded in full in the
 * output so nothing is hidden by the classification.
 */
function classifyDiff(caseId, correctedOut, liveOut) {
  const correctedFlagCats = new Set(correctedOut.flags.map(f => f.category));
  const liveFlagCats = new Set(liveOut.flags.map(f => f.category));
  const tags = new Set();

  if (liveFlagCats.has('bioengineering') && !correctedFlagCats.has('bioengineering')) {
    tags.add(CORRECTION_TAGS.bioengineering);
  }
  if (/^meat-game-/.test(caseId)) {
    tags.add(CORRECTION_TAGS.conventional_meat_game);
  }
  if (
    (liveFlagCats.has('conventional_meat') !== correctedFlagCats.has('conventional_meat')) &&
    (liveFlagCats.has('conventional_eggs') || correctedFlagCats.has('conventional_eggs'))
  ) {
    tags.add(CORRECTION_TAGS.conventional_eggs_priority);
  }

  return tags.size > 0 ? { classification: 'expected', tags: [...tags] } : { classification: 'unexpected', tags: [] };
}

/** Builds the field-level diff object for one case. Returns null if every
 *  in-scope field matches. */
function diffCase(caseId, correctedOut, liveOut) {
  const fieldDiffs = {};

  const correctedVerdict = correctedOut.verdict;
  const liveVerdict = liveOut.verdict;
  if (correctedVerdict !== liveVerdict) {
    fieldDiffs.verdict = { corrected: correctedVerdict, live: liveVerdict };
  }

  const correctedFlags = flagsForComparison(correctedOut.flags);
  const liveFlags = flagsForComparison(liveOut.flags);
  if (JSON.stringify(correctedFlags) !== JSON.stringify(liveFlags)) {
    fieldDiffs.flags = { corrected: correctedFlags, live: liveFlags };
  }

  if (correctedOut.clearedBy !== liveOut.clearedBy) {
    fieldDiffs.clearedBy = { corrected: correctedOut.clearedBy, live: liveOut.clearedBy };
  }

  if (correctedOut.isMeat !== liveOut.isMeat) {
    fieldDiffs.isMeat = { corrected: correctedOut.isMeat, live: liveOut.isMeat };
  }

  if (correctedOut.oliveCaveat !== liveOut.oliveCaveat) {
    fieldDiffs.oliveCaveat = { corrected: correctedOut.oliveCaveat, live: liveOut.oliveCaveat };
  }

  if (Object.keys(fieldDiffs).length === 0) return null;
  return fieldDiffs;
}

// ════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════

function main() {
  const inputsPath = path.join(__dirname, '..', 'goldenMaster', 'inputs.json');
  const snapshotPath = path.join(__dirname, '..', 'goldenMaster', 'snapshot-baseline.json');
  const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

  const liveById = new Map(snapshot.results.map(r => [r.id, r.output]));

  const perCase = [];
  let expectedCount = 0;
  let unexpectedCount = 0;
  const unexpectedDetails = [];

  for (const testCase of inputs) {
    const liveOut = liveById.get(testCase.id);
    if (!liveOut) {
      throw new Error(`No snapshot-baseline.json entry found for case id "${testCase.id}" — inputs.json and the snapshot have drifted apart.`);
    }

    const correctedOut = computeUnifiedVerdict({
      ingredientText: testCase.ingredientText,
      productLabels: testCase.productLabels ?? [],
      categoriesTags: testCase.categoriesTags ?? [],
      productName: testCase.productName,
      userLevel: testCase.userLevel,
    });

    const fieldDiffs = diffCase(testCase.id, correctedOut, liveOut);

    let entry = {
      id: testCase.id,
      description: testCase.description,
      userLevel: testCase.userLevel,
      hasDiff: fieldDiffs !== null,
    };

    if (fieldDiffs) {
      const { classification, tags } = classifyDiff(testCase.id, correctedOut, liveOut);
      entry = {
        ...entry,
        classification,
        expectedCorrections: tags,
        fieldDiffs,
        correctedOutput: {
          verdict: correctedOut.verdict,
          flags: flagsForComparison(correctedOut.flags),
          clearedBy: correctedOut.clearedBy,
          isMeat: correctedOut.isMeat,
          oliveCaveat: correctedOut.oliveCaveat,
        },
        liveOutput: {
          verdict: liveOut.verdict,
          flags: flagsForComparison(liveOut.flags),
          clearedBy: liveOut.clearedBy,
          isMeat: liveOut.isMeat,
          oliveCaveat: liveOut.oliveCaveat,
        },
      };

      if (classification === 'expected') {
        expectedCount++;
      } else {
        unexpectedCount++;
        unexpectedDetails.push(entry);
      }
    }

    perCase.push(entry);
  }

  const methodologyNotes = {
    bioengineeringClearance:
      'REVISED after the first shadow-mode run: bioengineering clearance is now usda-organic-label ONLY (non-gmo-project-verified-label was removed as ' +
      'a clearance mechanism for this category specifically — see lib/verdictRules.js DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded, decided ' +
      "2026-07-11 after reviewing this comparison's first run). Organic-ingredient-PREFIX clearance (still documented as a third mechanism on the " +
      "bioengineering row) remains NOT implemented in this interpreter — replicating it faithfully would require re-deriving lib/rulesEngine.js's " +
      "private isPrecededByOrganic(), which needs the character index of the match inside the engine's internal cleaned text (not exposed by " +
      'analyzeIngredients()\'s return value), and no current Golden Master case exercises that combination anyway.',
    bioengineeringCoverageGap:
      'No current Golden Master case combines "bioengineered"/"genetically modified" ingredient text with a usda-organic LABEL — only the ' +
      'non-gmo-project-verified label path (clear-non-gmo-bioengineering-l1/l2) is covered, and that path no longer clears bioengineering after the ' +
      'revision above. This means NO case in the current input set exercises bioengineering\'s remaining (organic-label) clearance mechanism at all. ' +
      'Flagged as a candidate for a future Stage 1 supplement, not built as part of this stage.',
    comparisonScope:
      'Diffed fields: verdict, flags (by category+severity only — summary text excluded as presentation, not logic), clearedBy, isMeat, oliveCaveat. ' +
      'Excluded entirely: unverifiedIngredients, productCategory (both unrelated to verdict logic; nothing in Stage 3 changes them, so diffing them ' +
      'would only ever add noise). unverifiedReason is computed by the interpreter for completeness but is also excluded from the diff.',
    mirroredHelpers:
      'normalizeLabelTags, isMeatProduct, isSeafoodProduct, isGameMeatProduct, detectWildCaught, allIngredientsPrefixedOrganic, ' +
      'allIngredientsAreWaterSafe, maskIgnoredIngredients, mapProductCategory, and GAME_MEAT_CATEGORIES are re-derived copies of ' +
      `pages/api/scan.js's private helpers (mirrored as of ${SCAN_JS_MIRROR_AS_OF}), not imports — scan.js cannot be modified to export them, and ` +
      'its ES module syntax means plain node cannot require() it at all. These will silently drift if scan.js changes before this script is next run.',
    correction4Scope:
      'The conventional_eggs-over-conventional_meat priority correction (#4) is scoped narrowly to the same ordering the original discrepancy report ' +
      'described — conventional_eggs checked before the generic isConventionalMeat branch (live Node 8 vs Node 8b) — at both levels. It is NOT extended ' +
      'to the farmed-seafood (Node 5b) or gelatin (Node 8c) conventional_meat injection sites, which were never part of the reported ordering issue.',
    correction2GatedGreenRevision:
      'REVISED after the first shadow-mode run: correction #2 (game-meat handling) is now a GATED GREEN, mirroring the wild-caught Node 5 pattern ' +
      'exactly, instead of a full no-op removed from the priority chain. The first run\'s interpreter modeled a true no-op and surfaced an undecided side ' +
      "effect — a CLEAN game-meat product (zero other flags) fell through to Node 14's default YELLOW instead of getting an automatic GREEN, a new L1/L2 " +
      "asymmetry nobody had actually decided on (L1's equivalent no-op leaves a clean game-meat product GREEN via the engine's own default). Gated green " +
      'resolves this: a clean game-meat product now correctly shows GREEN again, matching L1, while a game-meat product WITH a genuine pre-existing ' +
      'reject-severity flag still has that flag preserved rather than discarded (the gate condition is simply false, so the branch does not match and ' +
      'the chain falls through normally to whichever node matches the real concern).',
    correction2CoverageGap:
      'No current Golden Master case combines game-meat category with a separate reject-severity flag present at the same time — the only two ' +
      'game-meat cases in the input set (meat-game-l1/l2) use a single clean fixture ("venison, water, salt") with zero flags in either category. This ' +
      "means the gate's actual discriminating behavior — leaving a reject flag alone when one exists — is exercised by neither this comparison run nor " +
      'lib/verdictRules.test.js\'s data-level assertions (which check the table documents the mechanism, not that it behaves correctly against a real ' +
      'case). Flagged as a candidate for a future Stage 1 supplement (e.g. a game-meat product with an added bioengineering disclosure and no ' +
      'organic/non-gmo label), not built as part of this stage.',
  };

  const report = {
    generatedAt: new Date().toISOString(),
    scanJsMirrorAsOf: SCAN_JS_MIRROR_AS_OF,
    totalCases: inputs.length,
    matchingCases: perCase.filter(c => !c.hasDiff).length,
    expectedDiffCount: expectedCount,
    unexpectedDiffCount: unexpectedCount,
    methodologyNotes,
    cases: perCase,
  };

  const reportPath = path.join(__dirname, 'shadow-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const md = buildMarkdownSummary(report, unexpectedDetails);
  const mdPath = path.join(__dirname, 'shadow-report.md');
  fs.writeFileSync(mdPath, md);

  console.log(md);
  console.log(`\nFull structured diff written to: ${reportPath}`);
  console.log(`Markdown summary written to: ${mdPath}`);
}

function buildMarkdownSummary(report, unexpectedDetails) {
  const lines = [];
  lines.push('# Shadow-Mode Comparison — Stage 4 Summary');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`scan.js mirrored as of: ${report.scanJsMirrorAsOf}`);
  lines.push('');
  lines.push(`- Total cases: ${report.totalCases}`);
  lines.push(`- Matching (no diff): ${report.matchingCases}`);
  lines.push(`- Expected diffs (attributable to #1/#2/#4): ${report.expectedDiffCount}`);
  lines.push(`- **Unexpected diffs: ${report.unexpectedDiffCount}**`);
  lines.push('');
  lines.push('## Methodology notes');
  for (const [key, note] of Object.entries(report.methodologyNotes)) {
    lines.push(`### ${key}`);
    lines.push(note);
    lines.push('');
  }

  lines.push('## Unexpected diffs (full detail)');
  if (unexpectedDetails.length === 0) {
    lines.push('None.');
  } else {
    for (const entry of unexpectedDetails) {
      lines.push(`### ${entry.id} (Level ${entry.userLevel})`);
      lines.push(entry.description);
      lines.push('```json');
      lines.push(JSON.stringify(entry.fieldDiffs, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

main();
