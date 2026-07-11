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
