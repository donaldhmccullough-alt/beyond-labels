'use strict';

/**
 * lib/verdictEngine.test.js
 *
 * Stage 5b of the L1/L2 unification project.
 *
 * This file has one job: prove that the fixture used by
 * __tests__/api/scan.test.js's shadow-mode label-normalization regression
 * test genuinely produces DIFFERENT computeCorrectedVerdict() output
 * depending on whether it receives raw OFF-style labels (e.g.
 * 'en:usda-organic') or already-normalized labels (e.g. 'usda-organic').
 *
 * Why this matters: computeCorrectedVerdict() calls normalizeLabelTags()
 * internally. If pages/api/scan.js's shadow branch ever accidentally passes
 * the already-normalized `labelsDetected` instead of the raw
 * `product.labels_tags`, normalizeLabelTags() silently finds no match
 * (OFF_LABEL_MAP's keys are the raw 'en:usda-organic' form, not
 * 'usda-organic') and returns []  — no error is thrown, the result is just
 * silently wrong. This test fixes the exact fixture and expected values so
 * the scan.js integration test (which exercises the real wiring, not this
 * unit-level behavior) has a fixture proven, independently, to be
 * diagnostic — not just assumed to be.
 */

const { computeCorrectedVerdict } = require('./verdictEngine');
// getUnverifiedCopy() is 'use client' React component code, but the export
// itself is a plain function — safe to require under testEnvironment: 'node'
// as long as the component function body is never invoked (same pattern
// already established for ConcernCard.jsx/getFallbackSummary and
// SwapsScreen.jsx/FLAG_CATEGORY_MAP).
const { getUnverifiedCopy } = require('../components/verdict/VerdictScreen');

describe('computeCorrectedVerdict — raw vs. normalized label handling', () => {
  const FIXTURE = {
    ingredientText: 'Oats, salt, water.',
    categoriesTags: [],
    productName: 'Test Product',
    userLevel: 2,
  };

  test('raw OFF-style label ("en:usda-organic") correctly clears glyphosate_heavy via organic certification', () => {
    const result = computeCorrectedVerdict({
      ...FIXTURE,
      productLabels: ['en:usda-organic'],
    });
    expect(result.verdict).toBe('green');
    expect(result.clearedBy).toBe('organic');
    expect(result.flags).toEqual([]);
  });

  test('REGRESSION GUARD — an already-normalized label ("usda-organic", no "en:" prefix) is NOT recognized, and produces a silently WRONG result', () => {
    // This simulates the exact bug scan.js's shadow branch must avoid: passing
    // the already-normalized `labelsDetected` array (which contains
    // 'usda-organic', not 'en:usda-organic') into computeCorrectedVerdict().
    // normalizeLabelTags() finds no match for the bare string and returns [],
    // so organic clearance silently never applies — oats trips a real
    // glyphosate_heavy reject flag instead of being cleared.
    const result = computeCorrectedVerdict({
      ...FIXTURE,
      productLabels: ['usda-organic'],
    });
    expect(result.verdict).toBe('red');
    expect(result.clearedBy).toBeNull();
    expect(result.flags).toEqual([
      expect.objectContaining({ category: 'glyphosate_heavy', severity: 'reject', matchedIngredient: 'oats' }),
    ]);
  });

  test('the two label forms produce genuinely different verdicts for the same ingredient text (fixture is diagnostic)', () => {
    const withRawLabel = computeCorrectedVerdict({ ...FIXTURE, productLabels: ['en:usda-organic'] });
    const withNormalizedLabel = computeCorrectedVerdict({ ...FIXTURE, productLabels: ['usda-organic'] });

    expect(withRawLabel.verdict).not.toBe(withNormalizedLabel.verdict);
    expect(withRawLabel.clearedBy).not.toBe(withNormalizedLabel.clearedBy);
  });
});

/**
 * Stage 5c of the L1/L2 unification project.
 *
 * The two describe blocks below close the "known coverage gaps" flagged in
 * CLAUDE.md's Stage 4 notes: no golden-master case, and no direct unit test
 * anywhere in the repo, exercised either CORRECTION #1 (bioengineering +
 * organic-label clearance) or CORRECTION #2 (game meat + a co-occurring
 * reject-severity flag) — the exact scenario the gated-green fix exists to
 * distinguish from a clean game-meat product. Roughly 100 real production
 * shadow-mode scans never surfaced either combination either, so this was
 * genuinely unproven anywhere before Stage 5c. Both are closed here, as a
 * prerequisite for cutting VERDICT_ENGINE_MODE over to 'live'.
 */

describe('CORRECTION #1 — bioengineering + usda-organic label clearance (coverage gap closure)', () => {
  // "bioengineered" is a bare BIOENGINEERING_TERMS trigger — confirmed
  // already diagnostic via __tests__/api/scan.test.js Suite L's L11 fixture
  // (same string, no cert, asserts a bioengineering flag at Node 11/RED).
  const BIOENGINEERED_TEXT = 'Bioengineered ingredient, salt, water.';

  test('L2: usda-organic label clears the bioengineering flag entirely — GREEN, clearedBy "organic", no bioengineering flag', () => {
    const result = computeCorrectedVerdict({
      ingredientText: BIOENGINEERED_TEXT,
      productLabels:  ['en:usda-organic'],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).toBe('green');
    expect(result.clearedBy).toBe('organic');
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(false);
  });

  test('L2 CONTRAST — same ingredient text with NO organic label still correctly flags bioengineering RED (fixture is diagnostic, not just always-green)', () => {
    const result = computeCorrectedVerdict({
      ingredientText: BIOENGINEERED_TEXT,
      productLabels:  [],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).toBe('red');
    expect(result.clearedBy).toBeNull();
    expect(result.flags.some(f => f.category === 'bioengineering' && f.severity === 'reject')).toBe(true);
  });

  test('L1: usda-organic label clears the bioengineering flag too — the clearance runs before the L1/L2 branch, so it applies at both levels', () => {
    const result = computeCorrectedVerdict({
      ingredientText: BIOENGINEERED_TEXT,
      productLabels:  ['en:usda-organic'],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      1,
    });
    expect(result.verdict).toBe('green');
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(false);
  });

  test('L1 CONTRAST — same text with no organic label produces the ordinary L1 caution (yellow), not a reject', () => {
    // At L1, BIOENGINEERING_TERMS is a LEVEL_1_YELLOW_CATEGORY at the engine
    // level (caution, not reject) — the correction filters the flag out
    // regardless of severity, so this confirms the flag is genuinely present
    // (and merely caution-severity) absent the organic label at L1.
    const result = computeCorrectedVerdict({
      ingredientText: BIOENGINEERED_TEXT,
      productLabels:  [],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      1,
    });
    expect(result.verdict).toBe('yellow');
    expect(result.flags.some(f => f.category === 'bioengineering' && f.severity === 'caution')).toBe(true);
  });

  // Explicitly NOT covered here, per DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded
  // (lib/verdictRules.js): non-gmo-project-verified does NOT clear this flag,
  // by design. See __tests__/api/scan.test.js Suite L's L19/L20 for that
  // reject-flag gate, which is a separate fix (PROMPT_VERSION 39, already
  // live in the legacy tree) and is unaffected by this correction.
});

describe('CORRECTION #2 — game meat + a co-occurring reject-severity flag (coverage gap closure)', () => {
  // 'en:game-meats' is a GAME_MEAT_CATEGORIES entry (isGameMeatProduct() →
  // true). Bare "sugar" is a CONVENTIONAL_CROPS trigger (reject at L2, no
  // clearance available here — no organic label, no organic ingredient
  // prefix) — confirmed via lib/rulesEngine.js's own CONVENTIONAL_CROPS list.

  test('L2: game meat WITH a co-occurring conventional_crops reject flag → RED, flag preserved (the discriminating case the gated-green fix exists for)', () => {
    const result = computeCorrectedVerdict({
      ingredientText: 'Venison, sugar, salt.',
      productLabels:  [],
      categoriesTags: ['en:game-meats'],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).toBe('red');
    expect(result.clearedBy).toBeNull();
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.severity === 'reject')).toBe(true);
  });

  test('L2 CONTRAST — clean game meat (no reject flag) still correctly resolves to GREEN (the gated-green behavior, not a full no-op)', () => {
    const result = computeCorrectedVerdict({
      ingredientText: 'Venison, salt, water.',
      productLabels:  [],
      categoriesTags: ['en:game-meats'],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).toBe('green');
    expect(result.clearedBy).toBeNull();
    expect(result.flags).toEqual([]);
  });
});

/**
 * Bug fix: computeCorrectedVerdict() never set unverifiedReason to
 * 'no_ingredients' — it initialized the variable to an unconditional `null`
 * and only ever reassigned it for the (mutually-exclusive, verdict==='yellow')
 * cert_unconfirmed case. pages/api/scan.js's computeVerdictLegacy() has
 * always guaranteed 'no_ingredients' whenever ingredientsText is falsy (line
 * 223-224); this engine was missing the equivalent default, so any scan run
 * through VERDICT_ENGINE_MODE=live for a product Open Food Facts has no
 * ingredient text for silently persisted unverified_reason: null instead.
 * Confirmed via 8 real scan_cache rows (barcode 011110638434 "Band Pretzel
 * Thins" among them) — all clustered in a single 2026-07-12 window, all
 * verdict: 'unverified', ingredients: null, unverified_reason: null. See
 * CLAUDE.md for the full investigation.
 *
 * This also closes the loop on VerdictScreen.jsx's getUnverifiedCopy(): its
 * 'no_ingredients' branches (including the meat-specific L1/L2 messaging)
 * were always correctly written, but unreachable in live mode because
 * unverifiedReason never carried the value they check for.
 */
describe('BUG FIX — computeCorrectedVerdict() missing the no_ingredients default (coverage gap closure)', () => {
  test('falsy ingredientText (null) → unverifiedReason "no_ingredients", not null', () => {
    const result = computeCorrectedVerdict({
      ingredientText: null,
      productLabels:  [],
      categoriesTags: [],
      productName:    'Band Pretzel Thins',
      userLevel:      2,
    });
    expect(result.verdict).toBe('unverified');
    expect(result.unverifiedReason).toBe('no_ingredients');
  });

  test('empty-string ingredientText also produces "no_ingredients" (matches computeVerdictLegacy\'s falsy check, not just strict null)', () => {
    const result = computeCorrectedVerdict({
      ingredientText: '',
      productLabels:  [],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).toBe('unverified');
    expect(result.unverifiedReason).toBe('no_ingredients');
  });

  test('a real, ingredient-bearing product is unaffected — unverifiedReason stays null when verdict is not unverified', () => {
    const result = computeCorrectedVerdict({
      ingredientText: 'Canola oil, salt, water.',
      productLabels:  [],
      categoriesTags: [],
      productName:    'Test Product',
      userLevel:      2,
    });
    expect(result.verdict).not.toBe('unverified');
    expect(result.unverifiedReason).toBeNull();
  });

  test('meat product with no ingredients → unverifiedReason "no_ingredients" AND isMeat true, at both user levels (the real-world Hickory Smoked Turkey Breast case, barcode 051900401657)', () => {
    const meatFixture = {
      ingredientText: null,
      productLabels:  [],
      categoriesTags: ['en:turkeys', 'en:meats'],
      productName:    'Hickory Smoked Turkey Breast & White Turkey | Lean',
    };

    const l1 = computeCorrectedVerdict({ ...meatFixture, userLevel: 1 });
    expect(l1.verdict).toBe('unverified');
    expect(l1.unverifiedReason).toBe('no_ingredients');
    expect(l1.isMeat).toBe(true);

    const l2 = computeCorrectedVerdict({ ...meatFixture, userLevel: 2 });
    expect(l2.verdict).toBe('unverified');
    expect(l2.unverifiedReason).toBe('no_ingredients');
    expect(l2.isMeat).toBe(true);
  });

  test('DOWNSTREAM REACHABILITY — feeding the meat product\'s real computeCorrectedVerdict() output into getUnverifiedCopy() now selects the meat-specific message, at both levels, not the generic fallback', () => {
    const meatResultL1 = computeCorrectedVerdict({
      ingredientText: null,
      productLabels:  [],
      categoriesTags: ['en:turkeys', 'en:meats'],
      productName:    'Hickory Smoked Turkey Breast & White Turkey | Lean',
      userLevel:      1,
    });
    const copyL1 = getUnverifiedCopy(meatResultL1.unverifiedReason, meatResultL1.isMeat, 1);
    expect(copyL1).toBe(
      "We couldn't find the ingredient list for this product. Flip the package over and read the label before buying — skip it if you see any synthetic chemicals, artificial additives, artificial flavors, or preservatives."
    );

    const meatResultL2 = computeCorrectedVerdict({
      ingredientText: null,
      productLabels:  [],
      categoriesTags: ['en:turkeys', 'en:meats'],
      productName:    'Hickory Smoked Turkey Breast & White Turkey | Lean',
      userLevel:      2,
    });
    const copyL2 = getUnverifiedCopy(meatResultL2.unverifiedReason, meatResultL2.isMeat, 2);
    expect(copyL2).toBe(
      "We couldn't find this product in our database. Look for the USDA Organic seal before buying, and use your best judgment on quality — grass-fed, pasture-raised, or sourced from a farm you trust is always the better choice."
    );

    // Neither must be the generic "couldn't identify" fallback that was
    // being shown before this fix (unreachable no_ingredients branches).
    const genericFallback = "We couldn't identify this product. Try scanning again — if it still doesn't work, it may not be in our database yet.";
    expect(copyL1).not.toBe(genericFallback);
    expect(copyL2).not.toBe(genericFallback);
  });

  test('DOWNSTREAM REACHABILITY — the exact non-meat "Band Pretzel Thins" case now selects the correct no_ingredients message, not the generic fallback', () => {
    const result = computeCorrectedVerdict({
      ingredientText: null,
      productLabels:  [],
      categoriesTags: [],
      productName:    'Band Pretzel Thins',
      userLevel:      2,
    });
    const copy = getUnverifiedCopy(result.unverifiedReason, result.isMeat, 2);
    expect(copy).toBe(
      "We found this product but it has no ingredient data on file. We can't screen what we can't see — check the label directly."
    );
  });
});
