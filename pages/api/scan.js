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
  containsMilkDerived,
  containsMeatDerived,
  containsMeatIngredient,
} = rulesEngine;

import scanHelpers from '../../lib/scanHelpers';
const {
  normalizeLabelTags,
  isMeatProduct,
  isSeafoodProduct,
  isGameMeatProduct,
  detectWildCaught,
  allIngredientsPrefixedOrganic,
  allIngredientsAreWaterSafe,
  maskIgnoredIngredients,
  mapProductCategory,
  mapProductSubcategory,
  MEAT_CATEGORIES,
  SEAFOOD_CATEGORIES,
} = scanHelpers;

import verdictEngineModule from '../../lib/verdictEngine';
const { computeCorrectedVerdict } = verdictEngineModule;

import { getSupabaseServer } from '../../lib/supabaseServer';
import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_VERSION } from '../../lib/cacheVersion';
import { SYSTEM_PROMPT, buildUserMessage, parseExplanationResponse } from './explain';
import { ANTHROPIC_MODEL } from '../../lib/aiConfig';

const OFF_BASE = 'https://world.openfoodfacts.org/api/v0/product';

// Named exports for test use only (drift-guard: confirms MEAT_CATEGORIES's
// seafood entries and SEAFOOD_CATEGORIES stay in sync — see
// __tests__/api/scan.test.js). Both now live in lib/scanHelpers.js (Stage 5a
// extraction) and are re-exported here unchanged so the existing test's
// import path needs no changes. Not used by any other module; the handler
// itself remains the default export.
export { MEAT_CATEGORIES, SEAFOOD_CATEGORIES };

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
 * Computes verdict/flags/clearedBy/oliveCaveat/unverifiedReason for a scan
 * using TODAY'S live decision logic — the L1 explicit overrides plus the L2
 * universal decision tree, unchanged from before the Stage 5a extraction.
 * This is a pure relocation of that existing logic into its own function
 * (previously inline in the handler) so it can be selected by
 * VERDICT_ENGINE_MODE below — no behavior change of any kind.
 *
 * @param {Object} input
 * @param {string|null} input.ingredientsText
 * @param {string[]} input.labelsDetected
 * @param {string[]} input.categoriesTags
 * @param {string} input.productName
 * @param {1|2} input.userLevel
 * @param {boolean} input.isMeat
 * @returns {{verdict: string, flags: object[], clearedBy: string|null, oliveCaveat: boolean, unverifiedReason: string|null, unverifiedIngredients: string[]}}
 */
function computeVerdictLegacy({ ingredientsText, labelsDetected, categoriesTags, productName, userLevel, isMeat }) {
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

    // Any flag in these categories → RED immediately, no further checks
    // (moved above Phase A — see hasRejectFlagBeforeInjection below for why
    // Phase A needs this Set before it runs, not just the priority chain).
    const INSTANT_RED_CATEGORIES = new Set([
      'additives',       // SYNTHETIC_ADDITIVES: dyes, MSG, sweeteners, preservatives
      'natural_flavors',
      'seed_oils',
      'trans_fats',
    ]);

    // ── Phase A: unconditional corroboration-signal flag injection ──────────
    // conventional_meat, conventional_dairy, and the three organic sub-tree
    // categories (fortified_vitamins, natural_colorants, olive_oil_adulteration)
    // used to be injected ONLY if the tree below reached their specific node —
    // meaning an earlier-firing node (an instant-red flag, or e.g. Node 7's
    // non-GMO check) silently prevented them from ever being EVALUATED at all,
    // not just suppressed. Confirmed via a production data audit: 64.6% of
    // dairy products and 44.2% of meat products with an instant-red flag never
    // got their sourcing flag. This block evaluates every corroboration signal
    // exactly once, unconditionally, before the verdict-determination chain
    // below runs — so `flags` is always fully populated regardless of which
    // node ultimately decides the top-level verdict/clearedBy.
    //
    // Part 1 of a multi-part change (Phase A only — see CLAUDE.md). Verdict/
    // clearedBy determination below is UNCHANGED: it still runs the same
    // first-match-wins priority chain, just reading from (and, for these five
    // categories, no longer re-injecting into) the now-richer flags array —
    // each of those five nodes had its own `flags = [...]` injection line
    // removed below, since this block already added the same flag.
    //
    // `hasRejectFlagBeforeInjection` snapshots reject-flag presence BEFORE this
    // block runs, because Node 5 (wild-caught) and Node 7 (non-GMO) each gate
    // on "no reject flag present" — a check written when the only way a reject
    // flag could exist at that point was via the engine itself. If those two
    // nodes read the live (post-injection) `flags` array instead, a newly
    // injected conventional_dairy/conventional_meat flag (e.g. dairy sauce on
    // an otherwise-clean wild-caught fish product) would incorrectly count as
    // "a reject flag is already present" and silently strip the wild-caught/
    // non-GMO clearance that today's code would still correctly grant.
    //
    // Deliberately EXCLUDES INSTANT_RED_CATEGORIES (additives/seed_oils/
    // trans_fats/natural_flavors). In the original (still-unchanged) chain,
    // Node 5/7 are only ever reached via the `else` branch of
    // `if (hasInstantRedFlag) {...} else if (hasOrganic) {...} else {...}` —
    // meaning at the exact point those nodes' own `flags.some(reject)` checks
    // ran, an instant-red category could never actually be present (it would
    // have already short-circuited the whole tree before Node 5/7 were ever
    // reached). Node 5/7's reject-gates were always implicitly scoped to the
    // OTHER reject categories only (conventional_crops, conventional_eggs,
    // bioengineering, glyphosate_heavy) — confirmed by a real regression this
    // caught during implementation: a genuinely wild-caught salmon product
    // with an unrelated seed_oils flag must still get verdict=red (from
    // seed_oils, via Node 1-3) with NO conventional_meat injected, since the
    // salmon itself is still wild-caught regardless of the seed oil. Including
    // instant-red categories here would have wrongly treated that seed_oils
    // flag as a competing "reject" and defeated the wild-caught exemption.
    const hasRejectFlagBeforeInjection = flags.some(
      f => f.severity === 'reject' && !INSTANT_RED_CATEGORIES.has(f.category)
    );

    if (!hasOrganic) {
      // ── conventional_meat — mirrors the exact priority Node 5 → 5b → 6 → 8
      // → 8c use below, so exactly one flag (with the correct summary for
      // whichever condition actually applies) is ever injected per product.
      const isWildCaughtSeafood =
        isSeafood &&
        !hasRejectFlagBeforeInjection &&
        detectWildCaught(productName, labelsDetected, ingredientsText);

      if (isSeafood && !isWildCaughtSeafood) {
        // Mirrors Node 5b: seafood without a wild-caught signal.
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Farmed or unlabeled seafood — wild-caught certification not found',
        }, ...flags];
      } else if (isGameMeat) {
        // Mirrors Node 6: game meat is wild-harvested by nature — no flag.
      } else if (isConventionalMeat) {
        // Mirrors Node 8: conventional meat without organic cert.
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Conventional meat product without USDA Organic certification',
        }, ...flags];
      } else if (maskedText && containsMeatDerived(maskedText)) {
        // Mirrors Node 8c: animal-derived gelatin without organic cert.
        flags = [{
          category:          'conventional_meat',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Contains animal-derived gelatin without organic certification.',
        }, ...flags];
      }

      // ── conventional_dairy — independent of meat; mirrors Node 9. A product
      // can now carry both conventional_meat AND conventional_dairy flags
      // simultaneously (e.g. a conventional meat product with dairy sauce) —
      // previously only whichever node the chain reached first would show.
      if (maskedText && containsMilkDerived(maskedText)) {
        flags = [{
          category:          'conventional_dairy',
          severity:          'reject',
          matchedIngredient: '',
          summary:           'Conventional dairy product without USDA Organic certification',
        }, ...flags];
      }
    }

    // ── Organic sub-tree flags — independent of each other and of any
    // instant-red flag; mirrors Node 4's three checks below, but all three are
    // now evaluated regardless of whether the others also apply ("whichever
    // apply" rather than first-match-wins).
    if (hasOrganic) {
      if (maskedText && containsFortifiedVitamins(maskedText)) {
        flags = [...flags, {
          category:          'fortified_vitamins',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with synthetic vitamin fortification',
        }];
      }
      if (maskedText && containsNaturalColorants(maskedText)) {
        flags = [...flags, {
          category:          'natural_colorants',
          severity:          'caution',
          matchedIngredient: '',
          summary:           'Organic product with natural plant-derived colorants',
        }];
      }
      if (maskedText && maskedText.includes('olive oil')) {
        flags = [...flags, {
          category:          'olive_oil_adulteration',
          severity:          'caution',
          matchedIngredient: 'olive oil',
          summary:           'Olive oil adulteration is common — even organic olive oil may be cut with cheaper oils.',
        }];
      }
    }

    // ── Nodes 1–3: Instant RED categories ─────────────────────────────────
    // Any flag in these categories → RED immediately, no further checks.
    // (INSTANT_RED_CATEGORIES itself is declared above, before Phase A.)
    const hasInstantRedFlag = flags.some(f => INSTANT_RED_CATEGORIES.has(f.category));

    if (hasInstantRedFlag) {
      // Nodes 1–3 hit — synthetic / seed-oil / trans-fat contamination.
      verdict = 'red';
      // Part 2 of the L2 tree flag-injection change (see CLAUDE.md): if the
      // product also carries USDA Organic certification, clearedBy is now
      // 'organic' instead of being discarded to null. The cert context stays
      // visible even though verdict is red for an unrelated reason (a real
      // synthetic additive/seed oil/trans fat is not excused by an organic
      // label) — this holds whether or not any of the three organic
      // sub-tree flags (fortified_vitamins/natural_colorants/
      // olive_oil_adulteration) actually fired, since clearedBy describes
      // certification status, not which concerns were found.
      clearedBy = hasOrganic ? 'organic' : null;

    } else if (hasOrganic) {
      // ── Node 4: ORGANIC PATH ──────────────────────────────────────────────
      // Product passed nodes 1–3 and carries USDA Organic cert.
      // Minor concerns can still downgrade verdict to yellow.
      // clearedBy is set to 'organic' for all organic-path branches.
      clearedBy = 'organic';
      if (maskedText && containsFortifiedVitamins(maskedText)) {
        // Synthetic vitamin fortification. Flag already injected by Phase A above.
        verdict = 'yellow';
      } else if (maskedText && containsNaturalColorants(maskedText)) {
        // Plant-derived colorants signal processing-related color correction.
        // Flag already injected by Phase A above.
        verdict = 'yellow';
      } else if (maskedText && maskedText.includes('olive oil')) {
        // Olive oil adulteration risk — even organic labels are not immune.
        // Flag already injected by Phase A above.
        oliveCaveat = true;
        verdict = 'yellow';
      } else {
        // No concerns found → fully clean.
        verdict = 'green';
      }

    } else {
      // ── NON-ORGANIC PATH (Nodes 5–14) ────────────────────────────────────

      if (
        isSeafood &&
        !hasRejectFlagBeforeInjection &&
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
        // Flag already injected by Phase A above.
        verdict   = 'red';
        clearedBy = null;

      } else if (isGameMeat) {
        // Node 6: Game meat — wild-harvested by nature, no certification needed.
        verdict   = 'green';
        clearedBy = null;

      } else if (hasNonGmo && !hasRejectFlagBeforeInjection) {
        // Node 7: Non-GMO Project Verified → caution yellow.
        //
        // Gate added (fixing a live verdict-contradicting bug found during
        // Stage 1 golden-master snapshot generation — same shape as the
        // Node 5 wild-caught fix at PROMPT_VERSION 29): this node was
        // unconditionally overriding verdict to 'yellow' even when a
        // reject-severity flag (bioengineering, conventional_crops,
        // conventional_eggs, glyphosate_heavy) was already present in
        // `flags` — the flag stayed in the response, but the verdict never
        // reflected it, and that contradictory flag still fed
        // buildUserMessage() in explain.js. Mirrors the "reject flags
        // always win" precedent used by INSTANT_RED_CATEGORIES and Node 5:
        // if ANY reject flag is present, this node is skipped and execution
        // falls through to whichever later node actually matches the
        // flag's category (e.g. Node 11 for bioengineering), which sets
        // the correct RED verdict and leaves clearedBy null instead of
        // falsely stamping 'non-gmo-project-verified' over a real reject.
        verdict   = 'yellow';
        clearedBy = 'non-gmo-project-verified';

      } else if (isConventionalMeat) {
        // Node 8: Conventional meat without organic cert.
        // Flag already injected by Phase A above.
        verdict   = 'red';
        clearedBy = null;

      } else if (flags.some(f => f.category === 'conventional_eggs')) {
        // Node 8b: Conventional eggs detected by the rules engine — no organic cert.
        // The flag (with matchedIngredient) was already emitted by the engine loop;
        // just set the verdict here. No injection needed.
        verdict   = 'red';
        clearedBy = null;

      } else if (maskedText && containsMeatDerived(maskedText)) {
        // Node 8c: Animal-derived gelatin without organic cert.
        // Flag already injected by Phase A above.
        verdict   = 'red';
        clearedBy = null;

      } else if (maskedText && containsMilkDerived(maskedText)) {
        // Node 9: Conventional dairy without organic cert.
        // Flag already injected by Phase A above.
        verdict   = 'red';
        clearedBy = null;

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

  return { verdict, flags, clearedBy, oliveCaveat, unverifiedReason, unverifiedIngredients };
}

/**
 * Stage 5b of the L1/L2 unification project: parses
 * VERDICT_ENGINE_SHADOW_SAMPLE_RATE (0-100), defaulting to 10 when unset,
 * empty, or non-numeric — start cautious; ramp up manually once real
 * divergence data looks sane. Clamped to [0, 100] for safety. Guards
 * against the empty-string env-var gotcha explicitly: Number('') is 0 (not
 * NaN) in JavaScript, which would otherwise silently mean "never sample"
 * instead of falling back to the documented default.
 *
 * @returns {number} 0-100
 */
function getShadowSampleRate() {
  const envValue = process.env.VERDICT_ENGINE_SHADOW_SAMPLE_RATE;
  if (envValue === undefined || envValue === '') return 10;
  const rate = Number(envValue);
  if (!Number.isFinite(rate)) return 10;
  return Math.min(100, Math.max(0, rate));
}

/**
 * Reduces a flags array to the shape used for shadow-mode comparison and
 * storage: category + severity + matchedIngredient, summary text omitted
 * (presentation, not logic — same convention as Stage 4's shadow-mode
 * comparison script, scripts/shadowMode/compareVerdicts.js). Sorted so
 * array-order differences (e.g. which injected flag got prepended first)
 * don't themselves register as a divergence unless the actual member sets
 * differ.
 *
 * @param {object[]} flags
 * @returns {Array<{category: string, severity: string, matchedIngredient: string}>}
 */
function reduceFlagsForShadowComparison(flags) {
  return flags
    .map(f => ({ category: f.category, severity: f.severity, matchedIngredient: f.matchedIngredient }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
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
          productSubcategory:    cached.product_subcategory ?? null,
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
      productSubcategory:    null,
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
  const productSubcategory = mapProductSubcategory(productCategory, categoriesTags);

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

  // ── Verdict computation — gated by VERDICT_ENGINE_MODE ───────────────────
  // Stage 5a of the L1/L2 unification project: the flag and branch point
  // exist now so Stage 5b (shadow) and Stage 5c (live) don't require
  // touching this control flow again — but only 'legacy' does anything
  // different from 'legacy' today. Defaults to 'legacy' when unset, so
  // production behavior is unchanged until someone explicitly sets this in
  // Vercel. See CLAUDE.md's "Unified Verdict Rule Table" / Stage 5 sections.
  const VERDICT_ENGINE_MODE = ['shadow', 'live'].includes(process.env.VERDICT_ENGINE_MODE)
    ? process.env.VERDICT_ENGINE_MODE
    : 'legacy';

  let verdictResult;
  if (VERDICT_ENGINE_MODE === 'shadow') {
    // Stage 5b: computeVerdictLegacy() runs first and unconditionally —
    // verdictResult is bound to its output before the corrected engine is
    // ever touched, and nothing below this point may reassign it. Shadow
    // mode never changes what the user sees.
    verdictResult = computeVerdictLegacy({ ingredientsText, labelsDetected, categoriesTags, productName, userLevel, isMeat });

    // Sampled, not run on every request — see getShadowSampleRate()'s doc
    // comment. Only a fraction of requests also run the corrected engine.
    const shadowSampleRate = getShadowSampleRate();
    if (Math.random() < shadowSampleRate / 100) {
      // Own try/catch, fully separate from the legacy path's error handling.
      // A throw anywhere in here is caught, console.error'd, and the request
      // proceeds with the already-computed legacy verdictResult, unaffected —
      // shadow mode must be able to fail silently even if
      // computeCorrectedVerdict() has a bug neither engine's author has
      // found yet.
      try {
        // IMPORTANT: computeCorrectedVerdict() normalizes labels itself, so
        // it must receive the RAW OFF labels_tags (product.labels_tags) —
        // never the already-normalized `labelsDetected` used by the legacy
        // path above. Passing the normalized array here would silently
        // double-normalize (normalizeLabelTags() finds no match for e.g.
        // 'usda-organic', since OFF_LABEL_MAP's keys are the raw
        // 'en:usda-organic' form) and produce a wrong-but-plausible
        // corrected result with no error thrown. See
        // __tests__/api/scan.test.js's shadow-mode suite and
        // lib/verdictEngine.test.js for the regression tests guarding this.
        const correctedResult = computeCorrectedVerdict({
          ingredientText: ingredientsText,
          productLabels: product.labels_tags,
          categoriesTags,
          productName,
          userLevel,
        });

        const divergingFields = [];
        if (correctedResult.verdict !== verdictResult.verdict) divergingFields.push('verdict');
        if (
          JSON.stringify(reduceFlagsForShadowComparison(correctedResult.flags)) !==
          JSON.stringify(reduceFlagsForShadowComparison(verdictResult.flags))
        ) {
          divergingFields.push('flags');
        }
        if (correctedResult.clearedBy !== verdictResult.clearedBy) divergingFields.push('clearedBy');
        if (correctedResult.isMeat !== isMeat) divergingFields.push('isMeat');
        if (correctedResult.oliveCaveat !== verdictResult.oliveCaveat) divergingFields.push('oliveCaveat');

        // Only log/persist on an actual mismatch — agreement produces
        // nothing, so log/table volume scales with real divergence, not
        // with sampled traffic volume.
        if (divergingFields.length > 0) {
          console.warn('[scan] shadow mode divergence:', {
            barcode: cleanBarcode,
            userLevel,
            divergingFields,
            legacy: {
              verdict: verdictResult.verdict,
              clearedBy: verdictResult.clearedBy,
              isMeat,
              oliveCaveat: verdictResult.oliveCaveat,
            },
            corrected: {
              verdict: correctedResult.verdict,
              clearedBy: correctedResult.clearedBy,
              isMeat: correctedResult.isMeat,
              oliveCaveat: correctedResult.oliveCaveat,
            },
          });

          // Awaited before res.json() — this file's existing documented
          // discipline for Supabase writes on Vercel serverless (see the
          // captureUnverifiedIngredients / scan_cache upsert calls below):
          // the execution context freezes the moment res.json() is called,
          // so an un-awaited write here would be silently dropped.
          if (sb) {
            try {
              await sb.from('verdict_shadow_diffs').insert({
                barcode:                cleanBarcode,
                user_level:             userLevel,
                product_name:           productName,
                ingredients:            ingredientsText,
                labels_detected:        product.labels_tags ?? [],
                categories_tags:        categoriesTags,
                legacy_verdict:         verdictResult.verdict,
                legacy_flags:           reduceFlagsForShadowComparison(verdictResult.flags),
                legacy_cleared_by:      verdictResult.clearedBy,
                legacy_is_meat:         isMeat,
                legacy_olive_caveat:    verdictResult.oliveCaveat,
                corrected_verdict:      correctedResult.verdict,
                corrected_flags:        reduceFlagsForShadowComparison(correctedResult.flags),
                corrected_cleared_by:   correctedResult.clearedBy,
                corrected_is_meat:      correctedResult.isMeat,
                corrected_olive_caveat: correctedResult.oliveCaveat,
                diverging_fields:       divergingFields,
                prompt_version:        PROMPT_VERSION,
              });
            } catch (err) {
              console.error('verdict_shadow_diffs write failed:', err);
            }
          }
        }
      } catch (err) {
        console.error('[scan] shadow mode computeCorrectedVerdict failed:', err);
      }
    }
  } else if (VERDICT_ENGINE_MODE === 'live') {
    // Stage 5c: the corrected engine is now the source of truth for real
    // user-facing verdicts. Same raw-label-passing requirement as the
    // shadow branch above — computeCorrectedVerdict() normalizes labels
    // itself, so it must receive the RAW product.labels_tags, never the
    // already-normalized labelsDetected (see the shadow branch's own
    // comment and __tests__/api/scan.test.js's regression test for why).
    //
    // Unlike shadow mode, there is no already-computed legacy result to
    // silently keep serving if this throws — a bug here would otherwise
    // 500 the endpoint. Fall back to computeVerdictLegacy() on any error so
    // a defect in the corrected engine degrades to today's known-good
    // behavior instead of taking the endpoint down.
    try {
      verdictResult = computeCorrectedVerdict({
        ingredientText: ingredientsText,
        productLabels: product.labels_tags,
        categoriesTags,
        productName,
        userLevel,
      });
    } catch (err) {
      console.error('[scan] live mode computeCorrectedVerdict failed, falling back to legacy:', err);
      verdictResult = computeVerdictLegacy({ ingredientsText, labelsDetected, categoriesTags, productName, userLevel, isMeat });
    }
  } else {
    verdictResult = computeVerdictLegacy({ ingredientsText, labelsDetected, categoriesTags, productName, userLevel, isMeat });
  }

  const { verdict, flags, clearedBy, oliveCaveat, unverifiedReason, unverifiedIngredients } = verdictResult;

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
            product_subcategory:    productSubcategory,
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
    productSubcategory,
    unverifiedReason,
    isMeat,
    oliveCaveat,
  });
}
