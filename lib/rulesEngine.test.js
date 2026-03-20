'use strict';

/**
 * rulesEngine.test.js
 *
 * Test suites:
 *   1. UNVERIFIED  — null / empty / whitespace input
 *   2. Kraft Mac & Cheese  — conventional product, all 4 hard-reject categories
 *   3. Annie's Homegrown   — USDA Organic, only gluten soft-flag remains
 *   4. Non-GMO Verified    — non-gmo-project-verified label clears Cat 2
 *   5. Mixed edge case     — "organic corn starch" beside conventional soy lecithin
 *   6. Overlap prevention  — longest-match wins (partially hydrogenated, HFCS, etc.)
 *   7. Clearance boundary  — organic prefix vs. fake organic claims
 *   8. Green path          — fully clean product
 *   9. Return-shape        — structural guarantee on every result field
 */

const { analyzeIngredients } = require('./rulesEngine');

// ─── Shared test fixtures ────────────────────────────────────────────────────

/**
 * Representative Kraft Mac & Cheese ingredient string.
 * Deliberately includes triggers from all 4 hard-reject categories:
 *   Cat 1 (seed oil):      soybean oil
 *   Cat 2 (conv. crops):   wheat flour, citric acid
 *   Cat 3 (bioengineering):contains bioengineered food ingredients
 *   Cat 4 (additives):     yellow 5, yellow 6
 */
const KRAFT_INGREDIENTS =
  'ENRICHED MACARONI (WHEAT FLOUR, NIACIN, FERROUS SULFATE, THIAMIN MONONITRATE, ' +
  'RIBOFLAVIN, FOLIC ACID), CHEESE SAUCE MIX (WHEY, MILKFAT, MILK PROTEIN CONCENTRATE, ' +
  'SALT, SODIUM TRIPOLYPHOSPHATE, CONTAINS LESS THAN 2% OF CITRIC ACID, SODIUM PHOSPHATE, ' +
  'LACTIC ACID, CALCIUM PHOSPHATE, SOYBEAN OIL, YELLOW 5, YELLOW 6). ' +
  'CONTAINS BIOENGINEERED FOOD INGREDIENTS.';

/**
 * Annie's Homegrown Shells & White Cheddar (USDA Organic).
 * All risky crops are prefixed "organic"; product label is 'usda-organic'.
 * Only expected flag: gluten soft-flag from wheat.
 */
const ANNIES_INGREDIENTS =
  'ORGANIC WHEAT FLOUR, ORGANIC WHEY, ORGANIC CHEDDAR CHEESE (ORGANIC PASTEURIZED MILK, ' +
  'CULTURES, SALT, NON-ANIMAL ENZYMES), ORGANIC CORN STARCH, SEA SALT, ' +
  'ORGANIC ANNATTO EXTRACT.';

/**
 * Non-GMO Project Verified product (no organic seal).
 * Contains conventional-looking crops that the non-gmo label should clear.
 * Also contains "natural flavors" → soft flag.
 */
const NON_GMO_INGREDIENTS =
  'CORN STARCH, WHEAT FLOUR, SUGAR, NATURAL FLAVORS, SOY LECITHIN.';

/**
 * Mixed edge case: "organic corn starch" (should be CLEARED by prefix) beside
 * "soy lecithin" (NOT cleared — no organic prefix, no product-level label).
 * Also includes "natural flavors" soft flag.
 */
const MIXED_INGREDIENTS =
  'ORGANIC CORN STARCH, SOY LECITHIN, WATER, SALT, NATURAL FLAVORS.';

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Returns all flags belonging to a given category. */
const flagsFor = (result, category) =>
  result.flags.filter(f => f.category === category);

// ════════════════════════════════════════════════════════════════════════════
// 1. UNVERIFIED
// ════════════════════════════════════════════════════════════════════════════

describe('1. UNVERIFIED cases', () => {
  test('null ingredientText → unverified', () => {
    const r = analyzeIngredients(null);
    expect(r.verdict).toBe('unverified');
    expect(r.flags).toEqual([]);
    expect(r.clearedBy).toBeNull();
  });

  test('undefined ingredientText → unverified', () => {
    const r = analyzeIngredients(undefined);
    expect(r.verdict).toBe('unverified');
  });

  test('empty string → unverified', () => {
    const r = analyzeIngredients('');
    expect(r.verdict).toBe('unverified');
  });

  test('whitespace-only string → unverified', () => {
    const r = analyzeIngredients('   \n\t  ');
    expect(r.verdict).toBe('unverified');
  });

  test('unverified result has empty flags array', () => {
    expect(analyzeIngredients(null).flags).toHaveLength(0);
  });

  test('unverified result has null clearedBy', () => {
    expect(analyzeIngredients('').clearedBy).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Kraft Mac & Cheese — conventional product (all 4 hard-reject categories)
// ════════════════════════════════════════════════════════════════════════════

describe('2. Kraft Mac & Cheese — conventional product', () => {
  let result;
  beforeEach(() => {
    result = analyzeIngredients(KRAFT_INGREDIENTS, []);
  });

  // ── Verdict & top-level fields ──
  test('verdict is RED', () => {
    expect(result.verdict).toBe('red');
  });

  test('clearedBy is null (no certification labels)', () => {
    expect(result.clearedBy).toBeNull();
  });

  test('has at least 4 total flags (one per hard-reject category minimum)', () => {
    expect(result.flags.length).toBeGreaterThanOrEqual(4);
  });

  // ── Category 1: Seed oils ──
  test('flags "soybean oil" as seed_oils / reject', () => {
    const flag = flagsFor(result, 'seed_oils').find(
      f => f.matchedIngredient === 'soybean oil'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.summary).toContain('soybean oil');
  });

  // ── Category 2: Conventional crops ──
  test('flags "wheat flour" as conventional_crops / reject', () => {
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'wheat flour'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('flags "citric acid" as conventional_crops / reject', () => {
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'citric acid'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── Category 3: Bioengineering ──
  test('flags bioengineering disclosure', () => {
    const flags = flagsFor(result, 'bioengineering');
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('reject');
    expect(flags[0].matchedIngredient).toContain('bioengineered');
  });

  // ── Category 4: Synthetic additives ──
  test('flags "yellow 5" as additives / reject', () => {
    const flag = flagsFor(result, 'additives').find(
      f => f.matchedIngredient === 'yellow 5'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('flags "yellow 6" as additives / reject', () => {
    const flag = flagsFor(result, 'additives').find(
      f => f.matchedIngredient === 'yellow 6'
    );
    expect(flag).toBeDefined();
  });

  // ── Severity consistency ──
  test('all flags originating from the 4 hard categories have severity "reject"', () => {
    const hardCategories = ['seed_oils', 'conventional_crops', 'bioengineering', 'additives'];
    result.flags
      .filter(f => hardCategories.includes(f.category))
      .forEach(f => expect(f.severity).toBe('reject'));
  });

  // ── No false-green flags ──
  test('does not return a green or yellow verdict', () => {
    expect(result.verdict).not.toBe('green');
    expect(result.verdict).not.toBe('yellow');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Annie's Homegrown — USDA Organic product
// ════════════════════════════════════════════════════════════════════════════

describe("3. Annie's Homegrown — USDA Organic", () => {
  let result;
  beforeEach(() => {
    result = analyzeIngredients(ANNIES_INGREDIENTS, ['usda-organic']);
  });

  // ── Verdict & top-level ──
  test('verdict is YELLOW (gluten soft-flag from organic wheat)', () => {
    expect(result.verdict).toBe('yellow');
  });

  test('clearedBy is "organic"', () => {
    expect(result.clearedBy).toBe('organic');
  });

  // ── No hard-reject flags ──
  test('no seed_oils flags', () => {
    expect(flagsFor(result, 'seed_oils')).toHaveLength(0);
  });

  test('no conventional_crops flags (USDA Organic clears all Cat 2)', () => {
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });

  test('no bioengineering flags', () => {
    expect(flagsFor(result, 'bioengineering')).toHaveLength(0);
  });

  test('no additives flags', () => {
    expect(flagsFor(result, 'additives')).toHaveLength(0);
  });

  test('no flags with severity "reject"', () => {
    expect(result.flags.filter(f => f.severity === 'reject')).toHaveLength(0);
  });

  // ── Soft flag ──
  test('has exactly one gluten caution flag', () => {
    const flags = flagsFor(result, 'gluten');
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('caution');
    expect(flags[0].matchedIngredient).toBe('wheat');
  });

  // ── No double-flagging organic corn starch ──
  test('does not flag "organic corn starch"', () => {
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'corn starch'
    );
    expect(flag).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Non-GMO Project Verified product
// ════════════════════════════════════════════════════════════════════════════

describe('4. Non-GMO Project Verified product', () => {
  let result;
  beforeEach(() => {
    result = analyzeIngredients(NON_GMO_INGREDIENTS, ['non-gmo-project-verified']);
  });

  // ── Verdict & top-level ──
  // "natural flavors" is now a hard reject (SYNTHETIC_ADDITIVES), so even
  // though the non-gmo label clears all Cat 2 crops, natural flavors cannot
  // be cleared by any certification → verdict is RED.
  test('verdict is RED ("natural flavors" is a hard reject not cleared by non-gmo label)', () => {
    expect(result.verdict).toBe('red');
  });

  test('clearedBy is "non-gmo-project-verified"', () => {
    expect(result.clearedBy).toBe('non-gmo-project-verified');
  });

  // ── Cat 2 cleared ──
  test('no conventional_crops flags (non-gmo label clears all Cat 2)', () => {
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });

  test('specifically: "corn starch", "wheat flour", "sugar", "soy lecithin" all cleared', () => {
    const matchedIngredients = result.flags.map(f => f.matchedIngredient);
    expect(matchedIngredients).not.toContain('corn starch');
    expect(matchedIngredients).not.toContain('wheat flour');
    expect(matchedIngredients).not.toContain('sugar');
    expect(matchedIngredients).not.toContain('soy lecithin');
  });

  // ── One hard reject remains (natural flavors) ──
  test('exactly one hard reject: "natural flavors" in additives category', () => {
    const rejectFlags = result.flags.filter(f => f.severity === 'reject');
    expect(rejectFlags).toHaveLength(1);
    expect(rejectFlags[0].matchedIngredient).toBe('natural flavors');
    expect(rejectFlags[0].category).toBe('additives');
  });

  // ── Soft flags ──
  test('has a gluten caution flag (wheat flour is present)', () => {
    const flags = flagsFor(result, 'gluten');
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('caution');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Mixed edge case — "organic corn starch" + conventional soy lecithin
// ════════════════════════════════════════════════════════════════════════════

describe('5. Mixed edge case — organic corn starch beside conventional soy lecithin', () => {
  let result;
  beforeEach(() => {
    // No product-level certification — only per-ingredient organic prefix.
    result = analyzeIngredients(MIXED_INGREDIENTS, []);
  });

  // ── Verdict ──
  test('verdict is RED (soy lecithin is not cleared)', () => {
    expect(result.verdict).toBe('red');
  });

  test('clearedBy is null (no product-level certification supplied)', () => {
    expect(result.clearedBy).toBeNull();
  });

  // ── Corn starch is cleared ──
  test('does NOT flag "organic corn starch" (organic prefix clears it)', () => {
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'corn starch'
    );
    expect(flag).toBeUndefined();
  });

  // ── Soy lecithin is NOT cleared ──
  test('DOES flag "soy lecithin" as conventional_crops / reject', () => {
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'soy lecithin'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── "natural flavors" now produces an additives hard reject ──
  test('has an additives hard reject for "natural flavors"', () => {
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('exactly one conventional_crops flag (only soy lecithin)', () => {
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Longest-match / overlap-prevention rules
// ════════════════════════════════════════════════════════════════════════════

describe('6. Longest-match and overlap prevention', () => {
  test('"partially hydrogenated" wins; "hydrogenated" is NOT double-reported', () => {
    const result = analyzeIngredients('partially hydrogenated vegetable shortening');
    const hydroFlags = flagsFor(result, 'seed_oils').filter(
      f => f.matchedIngredient === 'hydrogenated' ||
           f.matchedIngredient === 'partially hydrogenated'
    );
    // Exactly one entry — the longer phrase
    expect(hydroFlags).toHaveLength(1);
    expect(hydroFlags[0].matchedIngredient).toBe('partially hydrogenated');
  });

  test('"high fructose corn syrup" wins over "corn syrup" at the same position', () => {
    const result = analyzeIngredients('high fructose corn syrup', []);
    const syrupFlags = result.flags.filter(
      f => f.matchedIngredient === 'corn syrup' ||
           f.matchedIngredient === 'high fructose corn syrup'
    );
    expect(syrupFlags).toHaveLength(1);
    expect(syrupFlags[0].matchedIngredient).toBe('high fructose corn syrup');
  });

  test('"modified food starch" wins over "modified starch"', () => {
    const result = analyzeIngredients('modified food starch', []);
    const modFlags = result.flags.filter(
      f => f.matchedIngredient === 'modified starch' ||
           f.matchedIngredient === 'modified food starch'
    );
    expect(modFlags).toHaveLength(1);
    expect(modFlags[0].matchedIngredient).toBe('modified food starch');
  });

  test('"contains a bioengineered food ingredient" wins over "bioengineered" alone', () => {
    const result = analyzeIngredients(
      'contains a bioengineered food ingredient'
    );
    const bioFlags = flagsFor(result, 'bioengineering');
    expect(bioFlags).toHaveLength(1);
    expect(bioFlags[0].matchedIngredient).toBe(
      'contains a bioengineered food ingredient'
    );
  });

  test('"beet sugar" is flagged once; plain "sugar" is not separately reported', () => {
    const result = analyzeIngredients('beet sugar', []);
    const sugarFlags = result.flags.filter(
      f => f.matchedIngredient === 'sugar' ||
           f.matchedIngredient === 'beet sugar'
    );
    expect(sugarFlags).toHaveLength(1);
    expect(sugarFlags[0].matchedIngredient).toBe('beet sugar');
  });

  test('two separate additives at distinct positions are each flagged', () => {
    const result = analyzeIngredients('red 40, yellow 5, blue 1, yellow 6');
    const additiveFlags = flagsFor(result, 'additives');
    expect(additiveFlags).toHaveLength(4);
    const matched = additiveFlags.map(f => f.matchedIngredient);
    expect(matched).toContain('red 40');
    expect(matched).toContain('yellow 5');
    expect(matched).toContain('blue 1');
    expect(matched).toContain('yellow 6');
  });

  test('seed oil and bioengineering trigger on the same product are both flagged', () => {
    const result = analyzeIngredients('canola oil. contains bioengineered food ingredient.');
    expect(flagsFor(result, 'seed_oils').length).toBeGreaterThanOrEqual(1);
    expect(flagsFor(result, 'bioengineering').length).toBe(1);
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. Clearance boundary conditions
// ════════════════════════════════════════════════════════════════════════════

describe('7. Clearance boundary conditions', () => {
  test('"organic" prefix clears the immediately following Cat 2 ingredient', () => {
    const result = analyzeIngredients('organic corn starch', []);
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });

  test('"inorganic" prefix does NOT clear the ingredient', () => {
    // "inorganic" contains the substring "organic" but is not the word "organic"
    const result = analyzeIngredients('inorganic corn starch', []);
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'corn starch'
    );
    expect(flag).toBeDefined();
  });

  test('"non-organic" prefix does NOT clear the ingredient', () => {
    const result = analyzeIngredients('non-organic corn starch', []);
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'corn starch'
    );
    expect(flag).toBeDefined();
  });

  test('"natural" claim does NOT clear a conventional crop', () => {
    const result = analyzeIngredients('all natural corn starch', []);
    const flag = flagsFor(result, 'conventional_crops').find(
      f => f.matchedIngredient === 'corn starch'
    );
    expect(flag).toBeDefined();
  });

  test('"no artificial ingredients" claim does NOT clear a conventional crop', () => {
    const result = analyzeIngredients(
      'no artificial ingredients. wheat flour, corn syrup.',
      []
    );
    expect(flagsFor(result, 'conventional_crops').length).toBeGreaterThanOrEqual(1);
  });

  test('USDA Organic label alone clears all Cat 2 even without organic prefix in text', () => {
    const result = analyzeIngredients(
      'corn starch, wheat flour, soy lecithin, citric acid',
      ['usda-organic']
    );
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });

  test('non-gmo-project-verified label alone clears all Cat 2', () => {
    const result = analyzeIngredients(
      'corn starch, soy lecithin, sugar, dextrose',
      ['non-gmo-project-verified']
    );
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });

  test('Cat 1 seed oils are NOT cleared by usda-organic label', () => {
    // Organic soybean oil is still a seed oil — always rejected.
    const result = analyzeIngredients('organic soybean oil', ['usda-organic']);
    expect(flagsFor(result, 'seed_oils').length).toBeGreaterThanOrEqual(1);
    expect(result.verdict).toBe('red');
  });

  test('Cat 1 seed oils are NOT cleared by per-ingredient organic prefix', () => {
    // "organic canola oil" — Cat 1 has no clearance mechanism.
    const result = analyzeIngredients('organic canola oil', []);
    expect(flagsFor(result, 'seed_oils').length).toBeGreaterThanOrEqual(1);
    expect(result.verdict).toBe('red');
  });

  test('"organic" comma-separated from ingredient is still recognised as a prefix', () => {
    // "organic, corn starch" — comma between organic and ingredient name
    const result = analyzeIngredients('organic, corn starch', []);
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. GREEN path — fully clean product
// ════════════════════════════════════════════════════════════════════════════

describe('8. GREEN path — fully clean ingredient list', () => {
  test('ingredient list with no triggers at all returns GREEN', () => {
    const result = analyzeIngredients(
      'organic rice flour, organic tapioca starch, sea salt, water',
      ['usda-organic']
    );
    expect(result.verdict).toBe('green');
    expect(result.flags).toHaveLength(0);
    expect(result.clearedBy).toBe('organic');
  });

  test('single ingredient "water" returns GREEN', () => {
    const result = analyzeIngredients('water');
    expect(result.verdict).toBe('green');
    expect(result.flags).toHaveLength(0);
  });

  test('gluten-free organic product with no natural flavors returns GREEN', () => {
    const result = analyzeIngredients(
      'organic rice, organic lentils, sea salt, spices',
      ['usda-organic']
    );
    expect(result.verdict).toBe('green');
  });

  test('GREEN result has empty flags array', () => {
    const result = analyzeIngredients('water, sea salt, lemon juice');
    expect(result.flags).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. Return-shape structural guarantees
// ════════════════════════════════════════════════════════════════════════════

describe('9. Return-shape structural guarantees', () => {
  const VERDICTS = ['red', 'yellow', 'green', 'unverified'];
  const SEVERITIES = ['reject', 'caution'];

  const scenarios = [
    { label: 'null input',            args: [null]                                                       },
    { label: 'Kraft (red)',           args: [KRAFT_INGREDIENTS, []]                                      },
    { label: "Annie's (yellow)",      args: [ANNIES_INGREDIENTS, ['usda-organic']]                       },
    { label: 'Non-GMO (yellow)',      args: [NON_GMO_INGREDIENTS, ['non-gmo-project-verified']]          },
    { label: 'Mixed edge case (red)', args: [MIXED_INGREDIENTS, []]                                      },
    { label: 'Clean product (green)', args: ['organic rice, sea salt', ['usda-organic']]                 },
  ];

  scenarios.forEach(({ label, args }) => {
    describe(`scenario: ${label}`, () => {
      let result;
      beforeEach(() => { result = analyzeIngredients(...args); });

      test('result is a plain object', () => {
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
      });

      test('verdict is one of the four valid values', () => {
        expect(VERDICTS).toContain(result.verdict);
      });

      test('flags is an array', () => {
        expect(Array.isArray(result.flags)).toBe(true);
      });

      test('clearedBy is a string or null', () => {
        expect(
          result.clearedBy === null || typeof result.clearedBy === 'string'
        ).toBe(true);
      });

      test('every flag has required fields with valid values', () => {
        result.flags.forEach(flag => {
          expect(typeof flag.category).toBe('string');
          expect(flag.category.length).toBeGreaterThan(0);

          expect(SEVERITIES).toContain(flag.severity);

          expect(typeof flag.matchedIngredient).toBe('string');
          expect(flag.matchedIngredient.length).toBeGreaterThan(0);

          expect(typeof flag.summary).toBe('string');
          expect(flag.summary.length).toBeGreaterThan(0);
        });
      });
    });
  });

  test('productLabels parameter is optional (no second arg)', () => {
    expect(() => analyzeIngredients('water, sea salt')).not.toThrow();
  });

  test('non-array productLabels is handled gracefully', () => {
    expect(() => analyzeIngredients('corn starch', 'usda-organic')).not.toThrow();
    // String is not an array — treated as no labels, corn starch is flagged
    const result = analyzeIngredients('corn starch', 'usda-organic');
    expect(result.flags.filter(f => f.matchedIngredient === 'corn starch').length)
      .toBeGreaterThan(0);
  });

  test('case-insensitive: ALLCAPS ingredient text matches lowercase triggers', () => {
    const result = analyzeIngredients('SOYBEAN OIL, YELLOW 5, YELLOW 6');
    expect(result.verdict).toBe('red');
    expect(flagsFor(result, 'seed_oils').length).toBeGreaterThan(0);
    expect(flagsFor(result, 'additives').length).toBe(2);
  });

  test('integer ingredientText is coerced to string without throwing', () => {
    expect(() => analyzeIngredients(42)).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 10. Gap-fix coverage — corn variants, natural-and-artificial flavor, MSG
// ════════════════════════════════════════════════════════════════════════════

describe('10. Gap-fix coverage — corn variants, flavor variants, MSG/nucleotides', () => {

  // ── Corn flour ──
  test('"corn flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('corn flour, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"organic corn flour" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic corn flour, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn flour');
    expect(flag).toBeUndefined();
  });

  test('"corn flour" listed after a comma is flagged', () => {
    const result = analyzeIngredients('water, salt, corn flour, spices', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn flour');
    expect(flag).toBeDefined();
  });

  // ── Standalone corn ──
  test('standalone "corn" at start of ingredient list is flagged', () => {
    const result = analyzeIngredients('corn, vegetable oil, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('standalone "corn" after a comma is flagged', () => {
    const result = analyzeIngredients('water, corn, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn');
    expect(flag).toBeDefined();
  });

  test('"corn" inside "corn oil" does NOT produce a conventional_crops flag', () => {
    const result = analyzeIngredients('water, corn oil, salt', []);
    // corn oil → seed_oils
    expect(flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'corn oil')).toBeDefined();
    // "corn" inside "corn oil" must NOT be separately flagged
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
  });

  test('"corn" inside "corn starch" does NOT create an extra conventional_crops flag', () => {
    const result = analyzeIngredients('corn starch, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn starch')).toBeDefined();
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
  });

  test('"corn" inside a parenthetical "(made from corn)" is NOT flagged as standalone', () => {
    // maltodextrin (made from corn) — the corn is a source note, not an ingredient entry
    const result = analyzeIngredients('maltodextrin (made from corn), salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
  });

  test('"organic corn" (standalone) is cleared by organic prefix', () => {
    const result = analyzeIngredients('organic corn, sea salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('standalone "corn" is cleared by usda-organic product label', () => {
    const result = analyzeIngredients('corn, sea salt', ['usda-organic']);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
  });

  // ── Natural and artificial flavor — now a hard reject (additives) ──
  test('"natural and artificial flavor" is a hard reject in additives', () => {
    const result = analyzeIngredients('salt, natural and artificial flavor', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural and artificial flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
    // Must NOT also appear as a natural_flavors soft flag
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(0);
  });

  test('"natural and artificial flavors" (plural) is a hard reject in additives', () => {
    const result = analyzeIngredients('salt, natural and artificial flavors', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural and artificial flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"natural flavor" (original form) is now a hard reject in additives', () => {
    const result = analyzeIngredients('water, natural flavor, sea salt', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"natural flavors" is a hard reject in additives (not a soft flag)', () => {
    const result = analyzeIngredients('natural flavors, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(0);
  });

  // ── MSG and nucleotides ──
  test('"monosodium glutamate" is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, monosodium glutamate, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'monosodium glutamate');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"disodium inosinate" is flagged as additives / reject', () => {
    const result = analyzeIngredients('disodium inosinate, salt', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'disodium inosinate');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"disodium guanylate" is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, disodium guanylate', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'disodium guanylate');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── Additional corn variants ──
  test('"cornmeal" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('cornmeal, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'cornmeal');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"organic cornmeal" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic cornmeal, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'cornmeal')).toBeUndefined();
  });

  test('"popcorn" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('popcorn, salt, oil', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'popcorn');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"corn syrup solids" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('corn syrup solids, water', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn syrup solids');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"corn syrup solids" wins over the shorter "corn syrup" at the same position', () => {
    const result = analyzeIngredients('corn syrup solids', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'corn syrup' ||
           f.matchedIngredient === 'corn syrup solids'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('corn syrup solids');
  });

  test('"corn bran" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('water, corn bran, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn bran');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── Artificial flavors & colors — hard rejects ──
  test('"artificial flavor" is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, artificial flavor, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'artificial flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"artificial flavors" (plural) is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, artificial flavors', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'artificial flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"artificial color" is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, artificial color, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'artificial color');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"artificial colour" (British spelling) is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, artificial colour', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'artificial colour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"artificial flavors" wins over "artificial flavor" at the same position', () => {
    const result = analyzeIngredients('artificial flavors', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'artificial flavor' ||
           f.matchedIngredient === 'artificial flavors'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('artificial flavors');
  });

  test('"natural and artificial flavor" wins and does not double-flag "artificial flavor"', () => {
    const result = analyzeIngredients('natural and artificial flavor', []);
    const addFlags = flagsFor(result, 'additives');
    expect(addFlags).toHaveLength(1);
    expect(addFlags[0].matchedIngredient).toBe('natural and artificial flavor');
  });

  test('"msg" abbreviation is flagged as additives / reject', () => {
    const result = analyzeIngredients('salt, msg, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'msg');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"monosodium glutamate" wins over "msg" when full name is listed', () => {
    // If a product lists the full name, it should match the longer trigger
    const result = analyzeIngredients('monosodium glutamate', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'msg' ||
           f.matchedIngredient === 'monosodium glutamate'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('monosodium glutamate');
  });

  // ── Pure "natural flavors" is now a hard reject ──
  test('"natural flavors" is a hard reject (additives), not a caution soft flag', () => {
    const result = analyzeIngredients('natural flavors, sea salt', []);
    // No soft flag category anymore
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(0);
    // Hard reject in additives
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  // ── Doritos-like integration test ──
  test('Doritos-like ingredient list gets all expected new flags', () => {
    const DORITOS_LIKE =
      'CORN, VEGETABLE OIL (SUNFLOWER OIL, CANOLA OIL, CORN OIL), ' +
      'MALTODEXTRIN (MADE FROM CORN), 2% SALT, MONOSODIUM GLUTAMATE, CORN FLOUR, ' +
      'NATURAL AND ARTIFICIAL FLAVOR, DEXTROSE, ' +
      'ARTIFICIAL COLOR (YELLOW 6, YELLOW 5, RED 40), CITRIC ACID, SUGAR, ' +
      'DISODIUM INOSINATE, DISODIUM GUANYLATE.';

    const result = analyzeIngredients(DORITOS_LIKE, []);
    expect(result.verdict).toBe('red');

    const matched = result.flags.map(f => f.matchedIngredient);

    // Newly added coverage
    expect(matched).toContain('corn');               // standalone first ingredient
    expect(matched).toContain('corn flour');          // Cat 2 new entry
    expect(matched).toContain('monosodium glutamate'); // Cat 4 new
    expect(matched).toContain('disodium inosinate');   // Cat 4 new
    expect(matched).toContain('disodium guanylate');   // Cat 4 new

    // Previously working
    expect(matched).toContain('vegetable oil');
    expect(matched).toContain('yellow 6');
    expect(matched).toContain('yellow 5');
    expect(matched).toContain('red 40');

    // "natural and artificial flavor" and "artificial color" → hard rejects now
    expect(matched).toContain('natural and artificial flavor');
    expect(matched).toContain('artificial color');
    // No natural_flavors soft flag (the "and artificial" form is a hard reject)
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(0);

    // "corn" inside parenthetical "(made from corn)" must NOT be double-flagged
    const cornFlags = result.flags.filter(f => f.matchedIngredient === 'corn');
    expect(cornFlags).toHaveLength(1); // only the first standalone ingredient
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 11. Session-8 expansion — sweeteners, flour variants, oats, maize,
//     sugar alcohols, seed-oil variants, natural-flavors hard-reject upgrade
// ════════════════════════════════════════════════════════════════════════════

describe('11. Session-8 expansion — new triggers across all categories', () => {

  // ── Sugar alcohols (CONVENTIONAL_CROPS — clearable) ──────────────────────

  test('"sorbitol" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('sorbitol, water', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'sorbitol');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"organic sorbitol" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic sorbitol, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'sorbitol')).toBeUndefined();
  });

  test('"erythritol" without organic prefix is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('erythritol, water', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'erythritol');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"organic erythritol" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic erythritol, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'erythritol')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"xylitol" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('xylitol, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'xylitol')).toBeDefined();
  });

  test('"mannitol" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('water, mannitol', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'mannitol')).toBeDefined();
  });

  // ── Corn derivatives (CONVENTIONAL_CROPS) ────────────────────────────────

  test('"corn grits" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('corn grits, water, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn grits');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"hominy" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('hominy, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'hominy')).toBeDefined();
  });

  test('"popped corn" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('popped corn, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'popped corn')).toBeDefined();
  });

  test('"corn starch modified" wins over "corn starch" at same position', () => {
    const result = analyzeIngredients('corn starch modified, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'corn starch' ||
           f.matchedIngredient === 'corn starch modified'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('corn starch modified');
  });

  test('"maize" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('maize, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'maize')).toBeDefined();
  });

  test('"maize starch" wins over "maize" at same position', () => {
    const result = analyzeIngredients('maize starch, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'maize' ||
           f.matchedIngredient === 'maize starch'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('maize starch');
  });

  test('"maize flour" and "maize syrup" each flagged once', () => {
    const result = analyzeIngredients('maize flour, maize syrup', []);
    expect(result.flags.filter(f => f.matchedIngredient === 'maize flour')).toHaveLength(1);
    expect(result.flags.filter(f => f.matchedIngredient === 'maize syrup')).toHaveLength(1);
  });

  test('"glucose syrup" wins over "glucose" at same position', () => {
    const result = analyzeIngredients('glucose syrup, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'glucose' ||
           f.matchedIngredient === 'glucose syrup'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('glucose syrup');
  });

  test('"glucose-fructose syrup" wins over "glucose syrup" and "glucose"', () => {
    const result = analyzeIngredients('glucose-fructose syrup, water', []);
    const flags = result.flags.filter(
      f => ['glucose', 'glucose syrup', 'glucose-fructose syrup'].includes(f.matchedIngredient)
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('glucose-fructose syrup');
  });

  test('"glucose" standalone is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('glucose, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'glucose')).toBeDefined();
  });

  test('"fructose" standalone is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('fructose, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'fructose')).toBeDefined();
  });

  test('"crystalline fructose" wins over "fructose" at same position', () => {
    const result = analyzeIngredients('crystalline fructose, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'fructose' ||
           f.matchedIngredient === 'crystalline fructose'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('crystalline fructose');
  });

  test('"invert sugar" wins over "sugar" at same position', () => {
    const result = analyzeIngredients('invert sugar, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'sugar' ||
           f.matchedIngredient === 'invert sugar'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('invert sugar');
  });

  test('"high fructose" standalone flagged (HFCS shadows it when HFCS is present)', () => {
    const result = analyzeIngredients('high fructose diet soda, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'high fructose')).toBeDefined();
  });

  test('"corn sugar" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('corn sugar, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn sugar')).toBeDefined();
  });

  // ── Wheat derivatives (CONVENTIONAL_CROPS) ───────────────────────────────

  test('"enriched flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('enriched flour, water, salt', []);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"organic enriched flour" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic enriched flour, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched flour')).toBeUndefined();
  });

  test('"bleached flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('bleached flour, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'bleached flour')).toBeDefined();
  });

  test('"unbleached flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('unbleached flour, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'unbleached flour')).toBeDefined();
  });

  test('"all purpose flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('all purpose flour, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'all purpose flour')).toBeDefined();
  });

  test('"bread flour" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('bread flour, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'bread flour')).toBeDefined();
  });

  test('"durum wheat" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('durum wheat, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'durum wheat')).toBeDefined();
  });

  test('"semolina" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('semolina, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'semolina')).toBeDefined();
  });

  test('"spelt" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('spelt flour, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'spelt')).toBeDefined();
  });

  test('"wheat bran" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('wheat bran, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'wheat bran')).toBeDefined();
  });

  test('"wheat germ" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('wheat germ, oil', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'wheat germ')).toBeDefined();
  });

  // ── Soy derivatives (CONVENTIONAL_CROPS) ─────────────────────────────────

  test('"soy sauce" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('soy sauce, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'soy sauce')).toBeDefined();
  });

  test('"soy extract" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('soy extract, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'soy extract')).toBeDefined();
  });

  test('"soy concentrate" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('soy concentrate, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'soy concentrate')).toBeDefined();
  });

  test('"soy isolate" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('soy isolate, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'soy isolate')).toBeDefined();
  });

  test('"textured soy" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('textured soy protein, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'textured soy')).toBeDefined();
  });

  // ── Rapeseed (CONVENTIONAL_CROPS) ────────────────────────────────────────

  test('"rapeseed" (the crop) is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('rapeseed, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'rapeseed')).toBeDefined();
  });

  test('"organic rapeseed" is cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic rapeseed, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'rapeseed')).toBeUndefined();
  });

  // ── Oat derivatives (CONVENTIONAL_CROPS) ─────────────────────────────────

  test('"oat starch" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('oat starch, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'oat starch')).toBeDefined();
  });

  test('"oat extract" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('oat extract, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'oat extract')).toBeDefined();
  });

  test('"oat syrup" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('oat syrup, water', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'oat syrup')).toBeDefined();
  });

  test('"oat bran" is flagged as conventional_crops / reject', () => {
    const result = analyzeIngredients('oat bran, salt', []);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'oat bran')).toBeDefined();
  });

  // ── Artificial sweeteners (SYNTHETIC_ADDITIVES) ──────────────────────────

  test('"sucralose" is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, sucralose', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'sucralose');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"aspartame" is flagged as additives / reject', () => {
    const result = analyzeIngredients('aspartame, water', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'aspartame');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"acesulfame potassium" wins over "acesulfame-k" at same position', () => {
    const result = analyzeIngredients('acesulfame potassium, water', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'acesulfame potassium' ||
           f.matchedIngredient === 'acesulfame-k'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('acesulfame potassium');
  });

  test('"acesulfame-k" is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, acesulfame-k', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'acesulfame-k')).toBeDefined();
  });

  test('"ace-k" is flagged as additives / reject', () => {
    const result = analyzeIngredients('ace-k, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'ace-k')).toBeDefined();
  });

  test('"saccharin" is flagged as additives / reject', () => {
    const result = analyzeIngredients('saccharin, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'saccharin')).toBeDefined();
  });

  test('"neotame" is flagged as additives / reject', () => {
    const result = analyzeIngredients('neotame, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'neotame')).toBeDefined();
  });

  test('"advantame" is flagged as additives / reject', () => {
    const result = analyzeIngredients('advantame, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'advantame')).toBeDefined();
  });

  test('"steviol glycoside" wins over "stevia extract" and "rebaudioside"', () => {
    const result = analyzeIngredients('steviol glycoside, water', []);
    const flags = result.flags.filter(
      f => ['steviol glycoside', 'stevia extract', 'rebaudioside', 'reb-a']
             .includes(f.matchedIngredient)
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('steviol glycoside');
  });

  test('"stevia extract" is flagged as additives / reject', () => {
    const result = analyzeIngredients('stevia extract, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'stevia extract')).toBeDefined();
  });

  test('"rebaudioside" is flagged as additives / reject', () => {
    const result = analyzeIngredients('rebaudioside a, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'rebaudioside')).toBeDefined();
  });

  test('"reb-a" is flagged as additives / reject', () => {
    const result = analyzeIngredients('reb-a, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'reb-a')).toBeDefined();
  });

  // ── Other synthetic additives (SYNTHETIC_ADDITIVES) ──────────────────────

  test('"carrageenan" is flagged as additives / reject', () => {
    const result = analyzeIngredients('carrageenan, water', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'carrageenan');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"titanium dioxide" is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, titanium dioxide', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'titanium dioxide');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"propyl gallate" is flagged as additives / reject', () => {
    const result = analyzeIngredients('propyl gallate, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'propyl gallate')).toBeDefined();
  });

  test('"propylene glycol" is flagged as additives / reject', () => {
    const result = analyzeIngredients('propylene glycol, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'propylene glycol')).toBeDefined();
  });

  test('"interesterified oil" wins over "interesterified fat" at same position', () => {
    // Ensure both are independently flagged when both appear
    const result = analyzeIngredients('interesterified oil, interesterified fat, water', []);
    expect(result.flags.filter(f => f.matchedIngredient === 'interesterified oil'))
      .toHaveLength(1);
    expect(result.flags.filter(f => f.matchedIngredient === 'interesterified fat'))
      .toHaveLength(1);
  });

  test('"fractionated palm oil" is flagged as additives / reject', () => {
    const result = analyzeIngredients('fractionated palm oil, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'fractionated palm oil')).toBeDefined();
  });

  test('"palm kernel oil" is flagged (seed_oils)', () => {
    const result = analyzeIngredients('palm kernel oil, water', []);
    expect(flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'palm kernel oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"palm olein" is flagged as additives / reject', () => {
    const result = analyzeIngredients('palm olein, water', []);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'palm olein')).toBeDefined();
  });

  // ── Natural-flavors hard-reject upgrade ───────────────────────────────────

  test('"natural flavors" is a hard reject in additives (not a caution)', () => {
    const result = analyzeIngredients('natural flavors, sea salt', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(0);
  });

  test('"natural flavor" (singular) is a hard reject in additives', () => {
    const result = analyzeIngredients('water, natural flavor, sea salt', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'natural flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"with other natural flavors" is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, with other natural flavors, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'with other natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"wonf" is flagged as additives / reject', () => {
    const result = analyzeIngredients('water, wonf, spices', []);
    const flag = flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'wonf');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"natural and artificial flavors" still wins at its position over "natural flavors"', () => {
    const result = analyzeIngredients('natural and artificial flavors', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'natural and artificial flavors' ||
           f.matchedIngredient === 'natural flavors' ||
           f.matchedIngredient === 'natural flavor'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('natural and artificial flavors');
  });

  // ── Seed-oil variants (SEED_OILS) ─────────────────────────────────────────

  test('"high oleic sunflower oil" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('high oleic sunflower oil, salt', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'high oleic sunflower oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"high oleic sunflower oil" wins over "sunflower oil" at same position', () => {
    const result = analyzeIngredients('high oleic sunflower oil', []);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'sunflower oil' ||
           f.matchedIngredient === 'high oleic sunflower oil'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('high oleic sunflower oil');
  });

  test('"high oleic canola oil" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('high oleic canola oil, salt', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'high oleic canola oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"high oleic safflower oil" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('high oleic safflower oil, water', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'high oleic safflower oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"rapeseed oil" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('rapeseed oil, water', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'rapeseed oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"fractionated palm" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('fractionated palm, water', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'fractionated palm');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── USDA Organic / Non-GMO clears new CONVENTIONAL_CROPS entries ──────────

  test('usda-organic label clears "erythritol" (Cat 2)', () => {
    const result = analyzeIngredients('erythritol, water', ['usda-organic']);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'erythritol')).toBeUndefined();
  });

  test('non-gmo-project-verified label clears "sorbitol" (Cat 2)', () => {
    const result = analyzeIngredients('sorbitol, water', ['non-gmo-project-verified']);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'sorbitol')).toBeUndefined();
  });

  test('sweeteners (SYNTHETIC_ADDITIVES) are NOT cleared by usda-organic label', () => {
    // Sucralose is Cat 4 — no organic clearance mechanism exists.
    const result = analyzeIngredients('sucralose, water', ['usda-organic']);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'sucralose')).toBeDefined();
    expect(result.verdict).toBe('red');
  });
});
