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
  test('verdict is YELLOW (natural flavors + gluten soft-flags)', () => {
    expect(result.verdict).toBe('yellow');
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

  // ── No hard rejects ──
  test('no flags with severity "reject"', () => {
    expect(result.flags.filter(f => f.severity === 'reject')).toHaveLength(0);
  });

  // ── Soft flags ──
  test('has a natural_flavors caution flag', () => {
    const flags = flagsFor(result, 'natural_flavors');
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('caution');
    expect(flags[0].matchedIngredient).toBe('natural flavors');
  });

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

  // ── Soft flag still present ──
  test('has a natural_flavors caution flag', () => {
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);
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

  // ── Natural and artificial flavor ──
  test('"natural and artificial flavor" triggers the natural_flavors soft flag', () => {
    const result = analyzeIngredients('salt, natural and artificial flavor', []);
    const flags = flagsFor(result, 'natural_flavors');
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('caution');
    expect(flags[0].matchedIngredient).toContain('natural');
    expect(flags[0].matchedIngredient).toContain('flavor');
  });

  test('"natural and artificial flavors" (plural) also triggers natural_flavors', () => {
    const result = analyzeIngredients('salt, natural and artificial flavors', []);
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);
  });

  test('"natural flavor" (original form) still triggers natural_flavors', () => {
    const result = analyzeIngredients('water, natural flavor, sea salt', []);
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);
  });

  test('"natural flavors" does not produce two flags (only one entry)', () => {
    const result = analyzeIngredients('natural flavors, spices', []);
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);
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

    // Natural and artificial flavor → soft flag
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);

    // "corn" inside parenthetical "(made from corn)" must NOT be double-flagged
    const cornFlags = result.flags.filter(f => f.matchedIngredient === 'corn');
    expect(cornFlags).toHaveLength(1); // only the first standalone ingredient
  });
});
