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
