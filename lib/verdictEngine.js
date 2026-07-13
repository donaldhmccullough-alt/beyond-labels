'use strict';

/**
 * lib/verdictEngine.js — corrected unified L1/L2 verdict engine
 *
 * Stage 5a of the L1/L2 unification project: the first REAL, CALLABLE
 * production implementation of the corrected decision logic designed in
 * Stage 3 (lib/verdictRules.js's VERDICT_RULES / CROSS_CUTTING_RULES /
 * DESIGN_DECISIONS) and validated in Stage 4 (scripts/shadowMode/
 * compareVerdicts.js's shadow-mode comparison against all 135 golden-master
 * cases — see shadow-report.md: 133/135 matching, 2 expected diffs, both
 * attributable to the conventional_eggs-priority correction, 0 unexpected).
 *
 * This file is a direct, cleaned-up port of that already-validated
 * interpreter (previously hand-written inside compareVerdicts.js) — not a
 * fresh reimplementation. The control flow intentionally still mirrors
 * pages/api/scan.js's L1-override / L2-tree structure (per Stage 2's own
 * finding that VERDICT_RULES deliberately does not re-encode full control
 * flow, only per-category facts), with the three corrected behaviors baked
 * in in place of scan.js's current (buggy) equivalents:
 *
 *   #1 — bioengineering clearance is organic-label (and organic-ingredient-
 *        prefix, not implemented here — see the note below) ONLY. Non-GMO
 *        Project Verified does NOT clear it — see
 *        DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded in
 *        lib/verdictRules.js.
 *   #2 — game-meat detection is a GATED GREEN, mirroring the wild-caught
 *        pattern exactly: game-meat category present AND no pre-existing
 *        reject-severity flag → green; a reject flag present is left alone,
 *        never discarded. See DESIGN_DECISIONS.correctedGameMeatGatedGreenAtL2.
 *   #4 — conventional_eggs is checked BEFORE the generic conventional_meat
 *        injection, at both levels, so eggs win whenever both would
 *        otherwise apply. See DESIGN_DECISIONS.correctedEggsPriorityOverGenericMeatInjection.
 *
 * NOT YET WIRED INTO pages/api/scan.js. Stage 5a only builds and unit-tests
 * this module standalone (same posture lib/verdictRules.js had after Stage
 * 3) — wiring it into scan.js's shadow/live VERDICT_ENGINE_MODE branches is
 * explicitly Stage 5b/5c's job.
 *
 * Known limitation carried over from the Stage 4 interpreter unchanged:
 * organic-ingredient-PREFIX clearance for bioengineering is NOT implemented
 * (would require re-deriving lib/rulesEngine.js's private
 * isPrecededByOrganic(), which needs the character index of the match
 * inside the engine's internal cleaned text — not exposed by
 * analyzeIngredients()'s return value — and no current golden-master case
 * exercises that combination anyway; see CLAUDE.md's "Known coverage gaps"
 * note).
 */

const {
  analyzeIngredients,
  containsFortifiedVitamins,
  containsNaturalColorants,
  containsMilkDerived,
  containsMeatDerived,
  containsMeatIngredient,
} = require('./rulesEngine');

const { CROSS_CUTTING_RULES } = require('./verdictRules');

const {
  normalizeLabelTags,
  isMeatProduct,
  isSeafoodProduct,
  isGameMeatProduct,
  detectWildCaught,
  allIngredientsPrefixedOrganic,
  allIngredientsAreWaterSafe,
  maskIgnoredIngredients,
} = require('./scanHelpers');

const INSTANT_RED_CATEGORIES = new Set(CROSS_CUTTING_RULES.instantRedPriorityTier.categories);

/**
 * Mirrors lib/rulesEngine.js's own internal verdict-from-flags rule
 * (hasReject→red, hasCaution→yellow, else green, excluding gluten_grains) —
 * used here to recompute verdict after this engine's own flag-array
 * mutations (bioengineering clearance, gluten strip), exactly as
 * pages/api/scan.js does after its own equivalent mutations.
 *
 * @param {Array<{category: string, severity: string}>} flags
 * @returns {'red'|'yellow'|'green'}
 */
function recomputeVerdictFromFlags(flags) {
  const activeFlags = flags.filter(f => f.category !== 'gluten_grains');
  if (activeFlags.some(f => f.severity === 'reject')) return 'red';
  if (activeFlags.some(f => f.severity === 'caution')) return 'yellow';
  return 'green';
}

/**
 * Computes the corrected verdict/flags/clearedBy for a single scan, per the
 * unified rule table's target design (lib/verdictRules.js).
 *
 * @param {Object} input
 * @param {string|null} input.ingredientText — raw ingredients text from OFF
 * @param {string[]} [input.productLabels] — raw OFF labels_tags values
 * @param {string[]} [input.categoriesTags] — raw OFF categories_tags values
 * @param {string} [input.productName] — product name from OFF
 * @param {1|2} input.userLevel
 * @returns {{
 *   verdict: 'red'|'yellow'|'green'|'unverified'|'inconclusive',
 *   flags: Array<{category: string, severity: string, matchedIngredient: string, summary: string}>,
 *   clearedBy: string|null,
 *   isMeat: boolean,
 *   oliveCaveat: boolean,
 *   unverifiedReason: string|null,
 *   unverifiedIngredients: string[],
 * }}
 */
function computeCorrectedVerdict({ ingredientText, productLabels = [], categoriesTags = [], productName = '', userLevel }) {
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
  // Mirrors pages/api/scan.js's computeVerdictLegacy() (lines 223-224) exactly
  // — that function guarantees unverifiedReason is 'no_ingredients' whenever
  // verdict becomes 'unverified' (analyzeIngredients() only returns
  // 'unverified' when ingredientText is falsy, the same condition checked
  // here). This engine previously initialized unverifiedReason to an
  // unconditional null and never set 'no_ingredients' anywhere, so any scan
  // run through VERDICT_ENGINE_MODE=live for a product OFF has no ingredient
  // text for would silently persist unverified_reason: null instead — see
  // CLAUDE.md for the investigation (8 real scan_cache rows found this way).
  let unverifiedReason = !ingredientText ? 'no_ingredients' : null;

  // ── CORRECTION #1: bioengineering label-based clearance (organic-label ONLY) ──
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

      // CORRECTION #2: game-meat is a GATED GREEN, mirroring the wild-caught
      // branch immediately above — game meat + no pre-existing reject-
      // severity flag → green. If a reject flag IS present, this condition
      // is simply false and the chain falls through to whichever later node
      // matches the real concern, exactly like the wild-caught gate's own
      // fallback behavior. isGameMeat still excludes the product from
      // isConventionalMeat below, unchanged.
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
  // DESIGN_DECISIONS.deadCodePostTreeConventionalCropsStrip, it is not
  // carried into lib/verdictRules.js at all (believed dead/unreachable).

  // Cert-unconfirmed — metadata only, never touches flags or verdict itself.
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

module.exports = {
  computeCorrectedVerdict,
};
