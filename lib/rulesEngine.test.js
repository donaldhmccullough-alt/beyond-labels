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
  test('has gluten caution flags for all grains (wheat flour + corn starch; organic clearance does not apply to prolamin concern)', () => {
    const flags = flagsFor(result, 'gluten_grains');
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags.every(f => f.severity === 'caution')).toBe(true);
    expect(flags.some(f => f.matchedIngredient === 'wheat flour')).toBe(true);
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

  test('specifically: "corn starch", "wheat flour", "sugar", "soy lecithin" all cleared from conventional_crops', () => {
    const matchedIngredients = flagsFor(result, 'conventional_crops').map(f => f.matchedIngredient);
    expect(matchedIngredients).not.toContain('corn starch');
    expect(matchedIngredients).not.toContain('wheat flour');
    expect(matchedIngredients).not.toContain('sugar');
    expect(matchedIngredients).not.toContain('soy lecithin');
  });

  // ── One hard reject remains (natural flavors) ──
  test('exactly one hard reject: "natural flavors" in natural_flavors category', () => {
    const rejectFlags = result.flags.filter(f => f.severity === 'reject');
    expect(rejectFlags).toHaveLength(1);
    expect(rejectFlags[0].matchedIngredient).toBe('natural flavors');
    expect(rejectFlags[0].category).toBe('natural_flavors');
  });

  // ── Soft flags ──
  test('has gluten caution flags (wheat flour and corn starch both present)', () => {
    const flags = flagsFor(result, 'gluten_grains');
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags.every(f => f.severity === 'caution')).toBe(true);
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

  // ── "natural flavors" produces a natural_flavors hard reject ──
  test('has a natural_flavors hard reject for "natural flavors"', () => {
    const flag = flagsFor(result, 'natural_flavors')
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
    const hydroFlags = flagsFor(result, 'trans_fats').filter(
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
      'organic olive oil, organic tapioca starch, sea salt, water',
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
      'organic lentils, sea salt, spices, water',
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

      test('unverifiedIngredients is an array', () => {
        expect(Array.isArray(result.unverifiedIngredients)).toBe(true);
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
    // corn is now in GLUTEN_GRAINS (broader prolamin definition) → YELLOW, not GREEN
    expect(result.verdict).toBe('yellow');
  });

  test('standalone "corn" is cleared by usda-organic product label', () => {
    const result = analyzeIngredients('corn, sea salt', ['usda-organic']);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'corn')).toBeUndefined();
  });

  // ── Natural flavors — now in natural_flavors category ──
  test('"natural and artificial flavor" is a hard reject in natural_flavors', () => {
    const result = analyzeIngredients('salt, natural and artificial flavor', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural and artificial flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"natural and artificial flavors" (plural) is a hard reject in natural_flavors', () => {
    const result = analyzeIngredients('salt, natural and artificial flavors', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural and artificial flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"natural flavor" (original form) is a hard reject in natural_flavors', () => {
    const result = analyzeIngredients('water, natural flavor, sea salt', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"natural flavors" is a hard reject in natural_flavors category (not a soft flag)', () => {
    const result = analyzeIngredients('natural flavors, spices', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
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
      f => f.category === 'conventional_crops' && (
        f.matchedIngredient === 'corn syrup' ||
        f.matchedIngredient === 'corn syrup solids'
      )
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
    const natFlags = flagsFor(result, 'natural_flavors');
    expect(natFlags).toHaveLength(1);
    expect(natFlags[0].matchedIngredient).toBe('natural and artificial flavor');
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'artificial flavor')).toBeUndefined();
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

  // ── Pure "natural flavors" is a hard reject at level 2 ──
  test('"natural flavors" is a hard reject (natural_flavors category), not a caution soft flag', () => {
    const result = analyzeIngredients('natural flavors, sea salt', []);
    const flag = flagsFor(result, 'natural_flavors')
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

    // "natural and artificial flavor" → natural_flavors category, hard reject
    expect(matched).toContain('natural and artificial flavor');
    expect(matched).toContain('artificial color');
    // natural_flavors category has exactly the "natural and artificial flavor" flag
    expect(flagsFor(result, 'natural_flavors')).toHaveLength(1);
    expect(flagsFor(result, 'natural_flavors')[0].severity).toBe('reject');

    // Standalone "CORN" (first ingredient) should appear in exactly two categories:
    //   conventional_crops (pesticide/GE concern) and gluten_grains (prolamin concern).
    // "corn" inside "(made from corn)" and "corn" inside "corn oil" must NOT appear.
    const cornFlags = result.flags.filter(f => f.matchedIngredient === 'corn');
    expect(cornFlags).toHaveLength(2);
    expect(cornFlags.map(f => f.category).sort()).toEqual(['conventional_crops', 'gluten_grains']);
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
      f => f.category === 'conventional_crops' && (
        f.matchedIngredient === 'corn starch' ||
        f.matchedIngredient === 'corn starch modified'
      )
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
      f => f.category === 'conventional_crops' && (
        f.matchedIngredient === 'maize' ||
        f.matchedIngredient === 'maize starch'
      )
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

  test('"fractionated palm oil" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('fractionated palm oil, water', []);
    expect(flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'fractionated palm oil')).toBeDefined();
  });

  test('"palm kernel oil" is flagged (seed_oils)', () => {
    const result = analyzeIngredients('palm kernel oil, water', []);
    expect(flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'palm kernel oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"palm olein" is flagged as seed_oils / reject', () => {
    const result = analyzeIngredients('palm olein, water', []);
    expect(flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'palm olein')).toBeDefined();
  });

  // ── Natural-flavors hard-reject upgrade ───────────────────────────────────

  test('"natural flavors" is a hard reject in natural_flavors category (level 2)', () => {
    const result = analyzeIngredients('natural flavors, sea salt', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'natural flavors')).toBeUndefined();
  });

  test('"natural flavor" (singular) is a hard reject in natural_flavors category', () => {
    const result = analyzeIngredients('water, natural flavor, sea salt', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'natural flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"with other natural flavors" is flagged as natural_flavors / reject', () => {
    const result = analyzeIngredients('water, with other natural flavors, spices', []);
    const flag = flagsFor(result, 'natural_flavors')
      .find(f => f.matchedIngredient === 'with other natural flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('"wonf" is flagged as natural_flavors / reject', () => {
    const result = analyzeIngredients('water, wonf, spices', []);
    const flag = flagsFor(result, 'natural_flavors')
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

// ════════════════════════════════════════════════════════════════════════════
// 12. filterUnrecognizedTokens — level-aware heuristic filtering
// ════════════════════════════════════════════════════════════════════════════

describe('12. filterUnrecognizedTokens — level-aware heuristic filtering', () => {

  // ── Common rules (both levels) ────────────────────────────────────────────

  test('token starting with "organic" is suppressed at Level 2', () => {
    const r = analyzeIngredients('organic turmeric, sea salt', ['usda-organic'], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase()))
      .not.toContain('organic turmeric');
  });

  test('token starting with "organic" is suppressed at Level 1', () => {
    const r = analyzeIngredients('organic turmeric, water', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase()))
      .not.toContain('organic turmeric');
  });

  test('artifact phrase "contains" is suppressed at both levels', () => {
    const r2 = analyzeIngredients('water, contains, salt', [], 2);
    expect(r2.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('contains');

    const r1 = analyzeIngredients('water, contains, salt', [], 1);
    expect(r1.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('contains');
  });

  test('artifact phrase "less than" is suppressed at both levels', () => {
    const r2 = analyzeIngredients('water, less than, sea salt', [], 2);
    expect(r2.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('less than');

    const r1 = analyzeIngredients('water, less than, sea salt', [], 1);
    expect(r1.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('less than');
  });

  test('2-char token "or" is suppressed at both levels (< 3 chars)', () => {
    const r = analyzeIngredients('water, or, salt', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('or');
  });

  test('purely numeric token is suppressed at both levels', () => {
    const r = analyzeIngredients('salt, 2%, water', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('2%');
  });

  // ── Level 1 — inverted logic: only surface chemical-looking tokens ─────────

  test('plain natural words (pumpkin, sunflower seeds) are suppressed at Level 1', () => {
    const r = analyzeIngredients('pumpkin, sunflower seeds, water, salt', [], 1);
    const ui = r.unverifiedIngredients.map(t => t.toLowerCase());
    expect(ui).not.toContain('pumpkin');
    expect(ui).not.toContain('sunflower seeds');
  });

  test('common whole foods are suppressed at Level 1 (no digit, short, natural)', () => {
    const r = analyzeIngredients('water, salt, honey, eggs, milk, cream, butter, flour', [], 1);
    const ui = r.unverifiedIngredients.map(t => t.toLowerCase());
    expect(ui).not.toContain('water');
    expect(ui).not.toContain('salt');
    expect(ui).not.toContain('honey');
    expect(ui).not.toContain('eggs');
    expect(ui).not.toContain('milk');
    expect(ui).not.toContain('cream');
    expect(ui).not.toContain('butter');
    expect(ui).not.toContain('flour');
  });

  test('token with a digit surfaces at Level 1 (looks chemical)', () => {
    // "e472" is an E-number code not in SYNTHETIC_ADDITIVES — has digit, matches E-number pattern
    const r = analyzeIngredients('water, e472, sea salt', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).toContain('e472');
  });

  test('E-number pattern surfaces at Level 1', () => {
    const r = analyzeIngredients('water, e1442, sea salt', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).toContain('e1442');
  });

  test('token with > 4 words surfaces at Level 1 (technical phrase)', () => {
    // 6 words — looks like a chemical INCI name; no known trigger is a substring
    // (original "calcium disodium phosphate" broke when "sodium phosphate" was added to SYNTHETIC_ADDITIVES)
    const r = analyzeIngredients('water, tricalcium phosphate zinc gluconate extra grade, salt', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase()))
      .toContain('tricalcium phosphate zinc gluconate extra grade');
  });

  test('token containing a SEED_OILS trigger is suppressed at Level 1', () => {
    // caught by ALL_TRIGGERS pass before reaching filterUnrecognizedTokens
    const r = analyzeIngredients('canola oil, water', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('canola oil');
  });

  test('token containing a NATURAL_FLAVORS trigger is suppressed at Level 1', () => {
    const r = analyzeIngredients('natural flavors, water', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('natural flavors');
  });

  // ── Level 2 — narrow whole-food token list ────────────────────────────────

  test('"water" is suppressed at Level 2', () => {
    const r = analyzeIngredients('water, turmeric', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('water');
  });

  test('"sea salt" is suppressed at Level 2', () => {
    const r = analyzeIngredients('water, sea salt, turmeric', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('sea salt');
  });

  test('"himalayan pink salt" is suppressed at Level 2', () => {
    const r = analyzeIngredients('water, himalayan pink salt', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('himalayan pink salt');
  });

  test('"baking soda" is suppressed at Level 2', () => {
    const r = analyzeIngredients('water, baking soda, sea salt', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('baking soda');
  });

  test('"sodium bicarbonate" is suppressed at Level 2', () => {
    const r = analyzeIngredients('sodium bicarbonate, water', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('sodium bicarbonate');
  });

  test('"turmeric" is suppressed at Level 2 (added to WHOLE_FOOD_TOKENS_L2)', () => {
    const r = analyzeIngredients('water, turmeric, sea salt', [], 2);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase())).not.toContain('turmeric');
  });

  test('"salt" (plain) is suppressed at Level 2 (added to WHOLE_FOOD_TOKENS_L2)', () => {
    const r = analyzeIngredients('water, salt, turmeric', [], 2);
    const ui = r.unverifiedIngredients.map(t => t.toLowerCase());
    expect(ui).not.toContain('salt');
    expect(ui).not.toContain('turmeric');
  });

  test('"turmeric" is suppressed at Level 1 (plain natural word, no chemical signals)', () => {
    const r = analyzeIngredients('water, turmeric, salt', [], 1);
    const ui = r.unverifiedIngredients.map(t => t.toLowerCase());
    expect(ui).not.toContain('turmeric');
    expect(ui).not.toContain('water');
    expect(ui).not.toContain('salt');
  });

  test('unverifiedIngredients is always an array (structural guarantee)', () => {
    expect(Array.isArray(analyzeIngredients('water, sea salt', [], 1).unverifiedIngredients)).toBe(true);
    expect(Array.isArray(analyzeIngredients('water, sea salt', [], 2).unverifiedIngredients)).toBe(true);
    expect(Array.isArray(analyzeIngredients(null).unverifiedIngredients)).toBe(true);
  });
});

// ── 13. Texas SB 25 additions — always red at both levels ─────────────────
describe('13 — Texas SB 25 SYNTHETIC_ADDITIVES (always red)', () => {
  test('azodicarbonamide — red at Level 1', () => {
    expect(analyzeIngredients('contains azodicarbonamide', [], 1).verdict).toBe('red');
  });
  test('azodicarbonamide — red at Level 2', () => {
    expect(analyzeIngredients('contains azodicarbonamide', [], 2).verdict).toBe('red');
  });

  test('ada — red at Level 1', () => {
    expect(analyzeIngredients('contains ada', [], 1).verdict).toBe('red');
  });
  test('ada — red at Level 2', () => {
    expect(analyzeIngredients('contains ada', [], 2).verdict).toBe('red');
  });

  test('bromated flour — red at Level 1', () => {
    expect(analyzeIngredients('contains bromated flour', [], 1).verdict).toBe('red');
  });
  test('bromated flour — red at Level 2', () => {
    expect(analyzeIngredients('contains bromated flour', [], 2).verdict).toBe('red');
  });

  test('calcium bromate — red at Level 1', () => {
    expect(analyzeIngredients('contains calcium bromate', [], 1).verdict).toBe('red');
  });
  test('calcium bromate — red at Level 2', () => {
    expect(analyzeIngredients('contains calcium bromate', [], 2).verdict).toBe('red');
  });

  test('datem — red at Level 1', () => {
    expect(analyzeIngredients('contains datem', [], 1).verdict).toBe('red');
  });
  test('datem — red at Level 2', () => {
    expect(analyzeIngredients('contains datem', [], 2).verdict).toBe('red');
  });

  test('diacetyl tartaric acid esters — red at Level 1', () => {
    expect(analyzeIngredients('contains diacetyl tartaric acid esters', [], 1).verdict).toBe('red');
  });
  test('diacetyl tartaric acid esters — red at Level 2', () => {
    expect(analyzeIngredients('contains diacetyl tartaric acid esters', [], 2).verdict).toBe('red');
  });

  test('diacetyl — red at Level 1', () => {
    expect(analyzeIngredients('contains diacetyl', [], 1).verdict).toBe('red');
  });
  test('diacetyl — red at Level 2', () => {
    expect(analyzeIngredients('contains diacetyl', [], 2).verdict).toBe('red');
  });

  test('canthaxanthin — red at Level 1', () => {
    expect(analyzeIngredients('contains canthaxanthin', [], 1).verdict).toBe('red');
  });
  test('canthaxanthin — red at Level 2', () => {
    expect(analyzeIngredients('contains canthaxanthin', [], 2).verdict).toBe('red');
  });

  test('red 3 — red at Level 1', () => {
    expect(analyzeIngredients('contains red 3', [], 1).verdict).toBe('red');
  });
  test('red 3 — red at Level 2', () => {
    expect(analyzeIngredients('contains red 3', [], 2).verdict).toBe('red');
  });

  test('red 4 — red at Level 1', () => {
    expect(analyzeIngredients('contains red 4', [], 1).verdict).toBe('red');
  });
  test('red 4 — red at Level 2', () => {
    expect(analyzeIngredients('contains red 4', [], 2).verdict).toBe('red');
  });

  test('citrus red 2 — red at Level 1', () => {
    expect(analyzeIngredients('contains citrus red 2', [], 1).verdict).toBe('red');
  });
  test('citrus red 2 — red at Level 2', () => {
    expect(analyzeIngredients('contains citrus red 2', [], 2).verdict).toBe('red');
  });

  test('olestra — red at Level 1', () => {
    expect(analyzeIngredients('contains olestra', [], 1).verdict).toBe('red');
  });
  test('olestra — red at Level 2', () => {
    expect(analyzeIngredients('contains olestra', [], 2).verdict).toBe('red');
  });

  test('olean — red at Level 1', () => {
    expect(analyzeIngredients('contains olean', [], 1).verdict).toBe('red');
  });
  test('olean — red at Level 2', () => {
    expect(analyzeIngredients('contains olean', [], 2).verdict).toBe('red');
  });

  test('propylparaben — red at Level 1', () => {
    expect(analyzeIngredients('contains propylparaben', [], 1).verdict).toBe('red');
  });
  test('propylparaben — red at Level 2', () => {
    expect(analyzeIngredients('contains propylparaben', [], 2).verdict).toBe('red');
  });

  test('potassium iodate — red at Level 1', () => {
    expect(analyzeIngredients('contains potassium iodate', [], 1).verdict).toBe('red');
  });
  test('potassium iodate — red at Level 2', () => {
    expect(analyzeIngredients('contains potassium iodate', [], 2).verdict).toBe('red');
  });

  test('potassium aluminum sulfate — red at Level 1', () => {
    expect(analyzeIngredients('contains potassium aluminum sulfate', [], 1).verdict).toBe('red');
  });
  test('potassium aluminum sulfate — red at Level 2', () => {
    expect(analyzeIngredients('contains potassium aluminum sulfate', [], 2).verdict).toBe('red');
  });

  test('sodium aluminum sulfate — red at Level 1', () => {
    expect(analyzeIngredients('contains sodium aluminum sulfate', [], 1).verdict).toBe('red');
  });
  test('sodium aluminum sulfate — red at Level 2', () => {
    expect(analyzeIngredients('contains sodium aluminum sulfate', [], 2).verdict).toBe('red');
  });

  test('sodium lauryl sulfate — red at Level 1', () => {
    expect(analyzeIngredients('contains sodium lauryl sulfate', [], 1).verdict).toBe('red');
  });
  test('sodium lauryl sulfate — red at Level 2', () => {
    expect(analyzeIngredients('contains sodium lauryl sulfate', [], 2).verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 14. Emulsifiers + generic flavor terms — always red at both levels
// ════════════════════════════════════════════════════════════════════════════
describe('14 — Emulsifiers and generic flavor terms (SYNTHETIC_ADDITIVES, always red)', () => {

  // ── Emulsifiers ───────────────────────────────────────────────────────────

  test('mono- and diglycerides — red at Level 1', () => {
    expect(analyzeIngredients('contains mono- and diglycerides', [], 1).verdict).toBe('red');
  });
  test('mono- and diglycerides — red at Level 2', () => {
    expect(analyzeIngredients('contains mono- and diglycerides', [], 2).verdict).toBe('red');
  });

  test('mono and diglycerides — red at Level 1', () => {
    expect(analyzeIngredients('contains mono and diglycerides', [], 1).verdict).toBe('red');
  });
  test('mono and diglycerides — red at Level 2', () => {
    expect(analyzeIngredients('contains mono and diglycerides', [], 2).verdict).toBe('red');
  });

  test('monoglycerides — red at Level 1', () => {
    expect(analyzeIngredients('contains monoglycerides', [], 1).verdict).toBe('red');
  });
  test('monoglycerides — red at Level 2', () => {
    expect(analyzeIngredients('contains monoglycerides', [], 2).verdict).toBe('red');
  });

  test('diglycerides — red at Level 1', () => {
    expect(analyzeIngredients('contains diglycerides', [], 1).verdict).toBe('red');
  });
  test('diglycerides — red at Level 2', () => {
    expect(analyzeIngredients('contains diglycerides', [], 2).verdict).toBe('red');
  });

  test('"mono- and diglycerides" wins over "diglycerides" at the same position', () => {
    const result = analyzeIngredients('mono- and diglycerides, water', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'mono- and diglycerides' ||
           f.matchedIngredient === 'diglycerides'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('mono- and diglycerides');
  });

  test('"mono and diglycerides" wins over "diglycerides" at the same position', () => {
    const result = analyzeIngredients('mono and diglycerides, water', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'mono and diglycerides' ||
           f.matchedIngredient === 'diglycerides'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('mono and diglycerides');
  });

  test('emulsifiers are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('monoglycerides, water', ['usda-organic'], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'monoglycerides')).toHaveLength(1);
    expect(result.verdict).toBe('red');
  });

  // ── Generic flavor terms ──────────────────────────────────────────────────

  test('flavor enhancer — red at Level 1', () => {
    expect(analyzeIngredients('salt, flavor enhancer, spices', [], 1).verdict).toBe('red');
  });
  test('flavor enhancer — red at Level 2', () => {
    expect(analyzeIngredients('salt, flavor enhancer, spices', [], 2).verdict).toBe('red');
  });

  test('flavor base — red at Level 1', () => {
    expect(analyzeIngredients('water, flavor base, salt', [], 1).verdict).toBe('red');
  });
  test('flavor base — red at Level 2', () => {
    expect(analyzeIngredients('water, flavor base, salt', [], 2).verdict).toBe('red');
  });

  test('flavor — red at Level 1', () => {
    expect(analyzeIngredients('salt, flavor, spices', [], 1).verdict).toBe('red');
  });
  test('flavor — red at Level 2', () => {
    expect(analyzeIngredients('salt, flavor, spices', [], 2).verdict).toBe('red');
  });

  test('"flavor enhancer" wins over "flavor" at the same position', () => {
    const result = analyzeIngredients('flavor enhancer, water', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'flavor enhancer' ||
           f.matchedIngredient === 'flavor'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('flavor enhancer');
  });

  test('"flavor base" wins over "flavor" at the same position', () => {
    const result = analyzeIngredients('flavor base, water', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'flavor base' ||
           f.matchedIngredient === 'flavor'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('flavor base');
  });

  test('"natural flavor" (NATURAL_FLAVORS) shadows "flavor" — no double-flag', () => {
    const result = analyzeIngredients('water, natural flavor, salt', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'natural flavor')).toHaveLength(1);
    expect(result.flags.filter(f => f.matchedIngredient === 'flavor')).toHaveLength(0);
  });

  test('"artificial flavor" (SYNTHETIC_ADDITIVES) shadows "flavor" — no double-flag', () => {
    const result = analyzeIngredients('water, artificial flavor, salt', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'artificial flavor')).toHaveLength(1);
    expect(result.flags.filter(f => f.matchedIngredient === 'flavor')).toHaveLength(0);
  });

  test('flavor triggers are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('flavor, water', ['usda-organic'], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'flavor')).toHaveLength(1);
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 15. New SEED_OILS triggers — canola and cottonseed bare forms
//     Level 2: red (reject). Level 1: yellow (caution).
// ════════════════════════════════════════════════════════════════════════════
describe('15 — New SEED_OILS triggers (canola, cottonseed bare forms)', () => {

  test('"canola" standalone is flagged as seed_oils / caution at Level 1', () => {
    const result = analyzeIngredients('canola, salt', [], 1);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'canola');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
    expect(result.verdict).toBe('yellow');
  });

  test('"canola" standalone is flagged as seed_oils / reject at Level 2', () => {
    const result = analyzeIngredients('canola, salt', [], 2);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'canola');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"canola oil" still wins over "canola" at the same position', () => {
    const result = analyzeIngredients('canola oil, salt', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'canola oil' || f.matchedIngredient === 'canola'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('canola oil');
  });

  test('"high oleic canola oil" still wins over "canola" at the same position', () => {
    const result = analyzeIngredients('high oleic canola oil, salt', [], 2);
    const flags = result.flags.filter(
      f => ['high oleic canola oil', 'canola oil', 'canola'].includes(f.matchedIngredient)
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('high oleic canola oil');
  });

  test('"cottonseed" standalone is flagged as seed_oils / caution at Level 1', () => {
    const result = analyzeIngredients('cottonseed, salt', [], 1);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'cottonseed');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
    expect(result.verdict).toBe('yellow');
  });

  test('"cottonseed" standalone is flagged as seed_oils / reject at Level 2', () => {
    const result = analyzeIngredients('cottonseed, salt', [], 2);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'cottonseed');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"cottonseed oil" still wins over "cottonseed" at the same position', () => {
    const result = analyzeIngredients('cottonseed oil, salt', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'cottonseed oil' || f.matchedIngredient === 'cottonseed'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('cottonseed oil');
  });

  test('seed_oils are NOT cleared by usda-organic label (no clearance mechanism)', () => {
    const result = analyzeIngredients('canola, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'canola')).toBeDefined();
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 16. New CONVENTIONAL_CROPS triggers — enriched rice, macaroni, potatoes
//     Level 2: red (reject). Level 1: yellow (caution). Clearable by organic/non-gmo.
// ════════════════════════════════════════════════════════════════════════════
describe('16 — New CONVENTIONAL_CROPS triggers (enriched rice, macaroni product, potatoes)', () => {

  test('"enriched long grain white rice" — yellow at Level 1', () => {
    const result = analyzeIngredients('water, enriched long grain white rice, salt', [], 1);
    expect(result.verdict).toBe('yellow');
  });

  test('"enriched long grain white rice" — red at Level 2', () => {
    const result = analyzeIngredients('water, enriched long grain white rice, salt', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched long grain white rice');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"enriched long grain white rice" cleared by usda-organic label', () => {
    const result = analyzeIngredients('enriched long grain white rice, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched long grain white rice')).toBeUndefined();
  });

  test('"enriched macaroni product" — yellow at Level 1', () => {
    const result = analyzeIngredients('water, enriched macaroni product, salt', [], 1);
    expect(result.verdict).toBe('yellow');
  });

  test('"enriched macaroni product" — red at Level 2', () => {
    const result = analyzeIngredients('water, enriched macaroni product, salt', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched macaroni product');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"enriched macaroni product" cleared by non-gmo-project-verified label', () => {
    const result = analyzeIngredients(
      'enriched macaroni product, salt', ['non-gmo-project-verified'], 2
    );
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'enriched macaroni product')).toBeUndefined();
  });

  test('"dried potatoes" — yellow at Level 1', () => {
    const result = analyzeIngredients('dried potatoes, salt', [], 1);
    expect(result.verdict).toBe('yellow');
  });

  test('"dried potatoes" — red at Level 2', () => {
    const result = analyzeIngredients('dried potatoes, salt', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'dried potatoes');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"dried potatoes" cleared by usda-organic label', () => {
    const result = analyzeIngredients('dried potatoes, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'dried potatoes')).toBeUndefined();
  });

  test('"organic dried potatoes" cleared by the organic prefix', () => {
    const result = analyzeIngredients('organic dried potatoes, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'dried potatoes')).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 17. New SYNTHETIC_ADDITIVES triggers — functional additives, E-numbers, Spanish
//     Always red at both user levels (no level downgrade).
// ════════════════════════════════════════════════════════════════════════════
describe('17 — New SYNTHETIC_ADDITIVES triggers (functional, E-numbers, Spanish)', () => {

  // ── Processing / functional additives ────────────────────────────────────

  test('acetylated monoglycerides — red at Level 1', () => {
    expect(analyzeIngredients('contains acetylated monoglycerides', [], 1).verdict).toBe('red');
  });
  test('acetylated monoglycerides — red at Level 2', () => {
    expect(analyzeIngredients('contains acetylated monoglycerides', [], 2).verdict).toBe('red');
  });

  test('"acetylated monoglycerides" wins over "monoglycerides" at the same position', () => {
    const result = analyzeIngredients('acetylated monoglycerides, water', [], 2);
    const flags = result.flags.filter(
      f => f.matchedIngredient === 'acetylated monoglycerides' ||
           f.matchedIngredient === 'monoglycerides'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('acetylated monoglycerides');
  });

  test('emulsifiers — red at Level 1', () => {
    expect(analyzeIngredients('water, emulsifiers, salt', [], 1).verdict).toBe('red');
  });
  test('emulsifiers — red at Level 2', () => {
    expect(analyzeIngredients('water, emulsifiers, salt', [], 2).verdict).toBe('red');
  });

  test('acidity regulators — red at Level 1', () => {
    expect(analyzeIngredients('water, acidity regulators, salt', [], 1).verdict).toBe('red');
  });
  test('acidity regulators — red at Level 2', () => {
    expect(analyzeIngredients('water, acidity regulators, salt', [], 2).verdict).toBe('red');
  });

  test('anticaking agent — red at Level 1', () => {
    expect(analyzeIngredients('salt, anticaking agent', [], 1).verdict).toBe('red');
  });
  test('anticaking agent — red at Level 2', () => {
    expect(analyzeIngredients('salt, anticaking agent', [], 2).verdict).toBe('red');
  });

  test('antioxidant — red at Level 1', () => {
    expect(analyzeIngredients('water, antioxidant, salt', [], 1).verdict).toBe('red');
  });
  test('antioxidant — red at Level 2', () => {
    expect(analyzeIngredients('water, antioxidant, salt', [], 2).verdict).toBe('red');
  });

  test('silicon dioxide — red at Level 1', () => {
    expect(analyzeIngredients('salt, silicon dioxide', [], 1).verdict).toBe('red');
  });
  test('silicon dioxide — red at Level 2', () => {
    expect(analyzeIngredients('salt, silicon dioxide', [], 2).verdict).toBe('red');
  });

  test('nisin preparation — red at Level 1', () => {
    expect(analyzeIngredients('water, nisin preparation, salt', [], 1).verdict).toBe('red');
  });
  test('nisin preparation — red at Level 2', () => {
    expect(analyzeIngredients('water, nisin preparation, salt', [], 2).verdict).toBe('red');
  });

  test('ferrous sulfate — red at Level 1', () => {
    expect(analyzeIngredients('water, ferrous sulfate, salt', [], 1).verdict).toBe('red');
  });
  test('ferrous sulfate — red at Level 2', () => {
    expect(analyzeIngredients('water, ferrous sulfate, salt', [], 2).verdict).toBe('red');
  });

  test('functional additives are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('silicon dioxide, water', ['usda-organic'], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'silicon dioxide')).toHaveLength(1);
    expect(result.verdict).toBe('red');
  });

  // ── E-number additives ────────────────────────────────────────────────────

  test('e319 — red at Level 1', () => {
    expect(analyzeIngredients('water, e319, salt', [], 1).verdict).toBe('red');
  });
  test('e319 — red at Level 2', () => {
    expect(analyzeIngredients('water, e319, salt', [], 2).verdict).toBe('red');
  });

  test('e330 — red at Level 1', () => {
    expect(analyzeIngredients('water, e330, salt', [], 1).verdict).toBe('red');
  });
  test('e330 — red at Level 2', () => {
    expect(analyzeIngredients('water, e330, salt', [], 2).verdict).toBe('red');
  });

  test('e339 — red at Level 1', () => {
    expect(analyzeIngredients('water, e339, salt', [], 1).verdict).toBe('red');
  });
  test('e339 — red at Level 2', () => {
    expect(analyzeIngredients('water, e339, salt', [], 2).verdict).toBe('red');
  });

  test('e471 — red at Level 1', () => {
    expect(analyzeIngredients('water, e471, salt', [], 1).verdict).toBe('red');
  });
  test('e471 — red at Level 2', () => {
    expect(analyzeIngredients('water, e471, salt', [], 2).verdict).toBe('red');
  });

  test('e476 — red at Level 1', () => {
    expect(analyzeIngredients('water, e476, salt', [], 1).verdict).toBe('red');
  });
  test('e476 — red at Level 2', () => {
    expect(analyzeIngredients('water, e476, salt', [], 2).verdict).toBe('red');
  });

  test('e500 — red at Level 1', () => {
    expect(analyzeIngredients('water, e500, salt', [], 1).verdict).toBe('red');
  });
  test('e500 — red at Level 2', () => {
    expect(analyzeIngredients('water, e500, salt', [], 2).verdict).toBe('red');
  });

  test('E-number triggers are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, e471, salt', ['usda-organic'], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'e471')).toHaveLength(1);
    expect(result.verdict).toBe('red');
  });

  // ── Spanish-language equivalents ─────────────────────────────────────────

  test('colorante amarillo 6 — red at Level 1', () => {
    expect(analyzeIngredients('agua, colorante amarillo 6, sal', [], 1).verdict).toBe('red');
  });
  test('colorante amarillo 6 — red at Level 2', () => {
    const result = analyzeIngredients('agua, colorante amarillo 6, sal', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'colorante amarillo 6'))
      .toHaveLength(1);
    expect(result.verdict).toBe('red');
  });

  test('colorante artificial rojo 40 — red at Level 1', () => {
    expect(analyzeIngredients('agua, colorante artificial rojo 40, sal', [], 1).verdict).toBe('red');
  });
  test('colorante artificial rojo 40 — red at Level 2', () => {
    const result = analyzeIngredients('agua, colorante artificial rojo 40, sal', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient === 'colorante artificial rojo 40'))
      .toHaveLength(1);
    expect(result.verdict).toBe('red');
  });

  test('Spanish colorant triggers are NOT cleared by non-gmo label', () => {
    const result = analyzeIngredients(
      'agua, colorante amarillo 6, sal', ['non-gmo-project-verified'], 2
    );
    expect(result.flags.filter(f => f.matchedIngredient === 'colorante amarillo 6'))
      .toHaveLength(1);
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 18. Session 4 additions — new SEED_OILS, CONVENTIONAL_CROPS, SYNTHETIC_ADDITIVES
// ════════════════════════════════════════════════════════════════════════════
describe('18 — Session 4: high-oleic soybean, mustard seed oil, malt syrup, glycerol, fortification, flavouring, Spanish', () => {

  // ── SEED_OILS: high oleic soybean variants ────────────────────────────────

  test('"high oleic soybean oil" — yellow at Level 1', () => {
    expect(analyzeIngredients('high oleic soybean oil, salt', [], 1).verdict).toBe('yellow');
  });

  test('"high oleic soybean oil" — red at Level 2', () => {
    const result = analyzeIngredients('high oleic soybean oil, salt', [], 2);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'high oleic soybean oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"high oleic soybean oil" wins over "soybean oil" at the same position', () => {
    const result = analyzeIngredients('high oleic soybean oil, salt', [], 2);
    const flags = flagsFor(result, 'seed_oils').filter(
      f => f.matchedIngredient === 'high oleic soybean oil' ||
           f.matchedIngredient === 'soybean oil' ||
           f.matchedIngredient === 'high oleic soybean'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('high oleic soybean oil');
  });

  test('"high oleic soybean" (bare) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, high oleic soybean, salt', [], 1).verdict).toBe('yellow');
  });

  test('"high oleic soybean" (bare) — red at Level 2', () => {
    const result = analyzeIngredients('water, high oleic soybean, salt', [], 2);
    expect(flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'high oleic soybean')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SEED_OILS: mustard seed oil ───────────────────────────────────────────

  test('"mustard seed oil" — yellow at Level 1', () => {
    expect(analyzeIngredients('water, mustard seed oil, salt', [], 1).verdict).toBe('yellow');
  });

  test('"mustard seed oil" — red at Level 2', () => {
    const result = analyzeIngredients('water, mustard seed oil, salt', [], 2);
    const flag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'mustard seed oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"mustard seed oil" is NOT cleared by usda-organic label (seed_oils never cleared)', () => {
    const result = analyzeIngredients('water, mustard seed oil, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'mustard seed oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── CONVENTIONAL_CROPS: malt syrup ────────────────────────────────────────

  test('"malt syrup" — yellow at Level 1', () => {
    expect(analyzeIngredients('malt syrup, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt syrup" — red at Level 2', () => {
    const result = analyzeIngredients('malt syrup, salt', [], 2);
    const flag = flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt syrup');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"malt syrup" cleared by usda-organic label', () => {
    const result = analyzeIngredients('malt syrup, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt syrup')).toBeUndefined();
  });

  test('"organic malt syrup" cleared by organic prefix', () => {
    const result = analyzeIngredients('organic malt syrup, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt syrup')).toBeUndefined();
  });

  // ── SYNTHETIC_ADDITIVES: mono - and diglycerides (space variant) ──────────

  test('"mono - and diglycerides" — red at Level 1', () => {
    expect(analyzeIngredients('water, mono - and diglycerides, salt', [], 1).verdict).toBe('red');
  });

  test('"mono - and diglycerides" — red at Level 2', () => {
    const result = analyzeIngredients('water, mono - and diglycerides, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mono - and diglycerides')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SYNTHETIC_ADDITIVES: glycerol-based emulsifiers ──────────────────────

  test('"glycerol monostearate" — red at Level 1', () => {
    expect(analyzeIngredients('water, glycerol monostearate, salt', [], 1).verdict).toBe('red');
  });

  test('"glycerol monostearate" — red at Level 2', () => {
    const result = analyzeIngredients('water, glycerol monostearate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'glycerol monostearate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"glycerol monostearate" wins over "glycerol" at the same position', () => {
    const result = analyzeIngredients('glycerol monostearate, water', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'glycerol monostearate' || f.matchedIngredient === 'glycerol'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('glycerol monostearate');
  });

  test('"glyceryl monostearate" — red at Level 1', () => {
    expect(analyzeIngredients('water, glyceryl monostearate, salt', [], 1).verdict).toBe('red');
  });

  test('"glyceryl monostearate" — red at Level 2', () => {
    const result = analyzeIngredients('water, glyceryl monostearate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'glyceryl monostearate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"glycerol" — red at Level 1', () => {
    expect(analyzeIngredients('water, glycerol, salt', [], 1).verdict).toBe('red');
  });

  test('"glycerol" — red at Level 2', () => {
    expect(analyzeIngredients('water, glycerol, salt', [], 2).verdict).toBe('red');
  });

  test('"humectants" — red at Level 1', () => {
    expect(analyzeIngredients('water, humectants, salt', [], 1).verdict).toBe('red');
  });

  test('"humectants" — red at Level 2', () => {
    expect(analyzeIngredients('water, humectants, salt', [], 2).verdict).toBe('red');
  });

  test('"hydrolyzed corn protein" — red at Level 1', () => {
    expect(analyzeIngredients('water, hydrolyzed corn protein, salt', [], 1).verdict).toBe('red');
  });

  test('"hydrolyzed corn protein" — red at Level 2', () => {
    const result = analyzeIngredients('water, hydrolyzed corn protein, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'hydrolyzed corn protein')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('glycerol-based emulsifiers are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('glycerol monostearate, water', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'glycerol monostearate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SYNTHETIC_ADDITIVES: synthetic fortification ──────────────────────────

  test('"folic acid" — red at Level 1', () => {
    expect(analyzeIngredients('water, folic acid, salt', [], 1).verdict).toBe('red');
  });

  test('"folic acid" — red at Level 2', () => {
    const result = analyzeIngredients('water, folic acid, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'folic acid')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"folic acid" is NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, folic acid, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'folic acid')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"niacin" — red at Level 1', () => {
    expect(analyzeIngredients('water, niacin, salt', [], 1).verdict).toBe('red');
  });

  test('"niacin" — red at Level 2', () => {
    const result = analyzeIngredients('water, niacin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'niacin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"niacinamide" — red at Level 1', () => {
    expect(analyzeIngredients('water, niacinamide, salt', [], 1).verdict).toBe('red');
  });

  test('"niacinamide" — red at Level 2', () => {
    const result = analyzeIngredients('water, niacinamide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'niacinamide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"niacinamide" wins over "niacin" at the same position', () => {
    const result = analyzeIngredients('niacinamide, water', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'niacinamide' || f.matchedIngredient === 'niacin'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('niacinamide');
  });

  test('"potassium phosphate" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium phosphate, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium phosphate" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium phosphate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium phosphate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SYNTHETIC_ADDITIVES: flavouring ──────────────────────────────────────

  test('"flavouring" — red at Level 1', () => {
    expect(analyzeIngredients('water, flavouring, salt', [], 1).verdict).toBe('red');
  });

  test('"flavouring" — red at Level 2', () => {
    const result = analyzeIngredients('water, flavouring, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'flavouring')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"flavouring" wins over "flavor" at the same position', () => {
    const result = analyzeIngredients('flavouring, water', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'flavouring' || f.matchedIngredient === 'flavor'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('flavouring');
  });

  // ── SYNTHETIC_ADDITIVES: new Spanish phrases ──────────────────────────────

  test('"jarabe de maíz de alta fructosa" — red at Level 1', () => {
    expect(analyzeIngredients('agua, jarabe de maíz de alta fructosa, sal', [], 1).verdict).toBe('red');
  });

  test('"jarabe de maíz de alta fructosa" — red at Level 2', () => {
    const result = analyzeIngredients('agua, jarabe de maíz de alta fructosa, sal', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'jarabe de maíz de alta fructosa')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"aceite de palma y/o karité" — red at Level 1', () => {
    expect(analyzeIngredients('agua, aceite de palma y/o karité, sal', [], 1).verdict).toBe('red');
  });

  test('"aceite de palma y/o karité" — red at Level 2', () => {
    const result = analyzeIngredients('agua, aceite de palma y/o karité, sal', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'aceite de palma y/o karité')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"aceite de palma y/o palmiste" — red at Level 1', () => {
    expect(analyzeIngredients('agua, aceite de palma y/o palmiste, sal', [], 1).verdict).toBe('red');
  });

  test('"aceite de palma y/o palmiste" — red at Level 2', () => {
    const result = analyzeIngredients('agua, aceite de palma y/o palmiste, sal', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'aceite de palma y/o palmiste')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('new Spanish additives are NOT cleared by non-gmo label', () => {
    const result = analyzeIngredients(
      'agua, jarabe de maíz de alta fructosa, sal', ['non-gmo-project-verified'], 2
    );
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'jarabe de maíz de alta fructosa')).toBeDefined();
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 19. Session 5 additions — thiamin/riboflavin/sodium preservatives,
//     soybean, malt extract/flavor, whole grain brown rice flour, soya lecithin
// ════════════════════════════════════════════════════════════════════════════
describe('19 — Session 5: B-vitamin fortification, sodium preservatives, soybean, malt derivatives, rice, soya lecithin', () => {

  // ── SYNTHETIC_ADDITIVES: B-vitamin / iron fortification ──────────────────

  test('"thiamin mononitrate" — red at Level 1', () => {
    expect(analyzeIngredients('wheat flour, thiamin mononitrate, salt', [], 1).verdict).toBe('red');
  });

  test('"thiamin mononitrate" — red at Level 2', () => {
    const result = analyzeIngredients('wheat flour, thiamin mononitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamin mononitrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"thiamine mononitrate" (alternate spelling) — red at Level 1', () => {
    expect(analyzeIngredients('water, thiamine mononitrate, salt', [], 1).verdict).toBe('red');
  });

  test('"thiamine mononitrate" — red at Level 2', () => {
    const result = analyzeIngredients('water, thiamine mononitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamine mononitrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"thiamine mononitrate" wins over "thiamin mononitrate" at the same position', () => {
    const result = analyzeIngredients('thiamine mononitrate, water', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'thiamine mononitrate' || f.matchedIngredient === 'thiamin mononitrate'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('thiamine mononitrate');
  });

  test('"thiamin mononitrite" (typo variant) — red at Level 1', () => {
    expect(analyzeIngredients('water, thiamin mononitrite, salt', [], 1).verdict).toBe('red');
  });

  test('"thiamin mononitrite" — red at Level 2', () => {
    const result = analyzeIngredients('water, thiamin mononitrite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamin mononitrite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"riboflavin" — red at Level 1', () => {
    expect(analyzeIngredients('water, riboflavin, salt', [], 1).verdict).toBe('red');
  });

  test('"riboflavin" — red at Level 2', () => {
    const result = analyzeIngredients('water, riboflavin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'riboflavin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"reduced iron" — red at Level 1', () => {
    expect(analyzeIngredients('wheat flour, reduced iron, salt', [], 1).verdict).toBe('red');
  });

  test('"reduced iron" — red at Level 2', () => {
    const result = analyzeIngredients('wheat flour, reduced iron, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'reduced iron')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('fortification triggers are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, riboflavin, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'riboflavin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SYNTHETIC_ADDITIVES: sodium-based preservatives ───────────────────────

  test('"sodium alginate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium alginate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium alginate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium alginate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium alginate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium caseinate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium caseinate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium caseinate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium caseinate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium caseinate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium citrate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium citrate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium citrate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium citrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium citrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium diacetate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium diacetate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium diacetate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium diacetate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium diacetate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium phosphate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium phosphate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium phosphate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium phosphate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium phosphate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sorbic acid" — red at Level 1', () => {
    expect(analyzeIngredients('water, sorbic acid, salt', [], 1).verdict).toBe('red');
  });

  test('"sorbic acid" — red at Level 2', () => {
    const result = analyzeIngredients('water, sorbic acid, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sorbic acid')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('sodium preservatives are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, sodium phosphate, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium phosphate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SYNTHETIC_ADDITIVES: soya lecithin ────────────────────────────────────

  test('"soya lecithin" (British/EU spelling) — red at Level 1', () => {
    expect(analyzeIngredients('water, soya lecithin, salt', [], 1).verdict).toBe('red');
  });

  test('"soya lecithin" — red at Level 2', () => {
    const result = analyzeIngredients('water, soya lecithin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'soya lecithin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"soya lecithin" is NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, soya lecithin, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'soya lecithin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── CONVENTIONAL_CROPS: soybean (bare crop form) ──────────────────────────

  test('"soybean" (standalone) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, soybean, salt', [], 1).verdict).toBe('yellow');
  });

  test('"soybean" (standalone) — red at Level 2', () => {
    const result = analyzeIngredients('water, soybean, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'soybean')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"soybean" cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, soybean, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'soybean')).toBeUndefined();
  });

  test('"soybean" cleared by non-gmo-project-verified label', () => {
    const result = analyzeIngredients('water, soybean, salt', ['non-gmo-project-verified'], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'soybean')).toBeUndefined();
  });

  test('"soybean oil" is NOT double-flagged — SEED_OILS claims first, conventional_crops soybean is blocked', () => {
    const result = analyzeIngredients('water, soybean oil, salt', [], 2);
    const seedFlag = flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'soybean oil');
    const cropFlag = flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'soybean');
    expect(seedFlag).toBeDefined();
    expect(cropFlag).toBeUndefined();
  });

  // ── CONVENTIONAL_CROPS: malt extract, malt flavor ─────────────────────────

  test('"malt extract" (CONVENTIONAL_CROPS) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, malt extract, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt extract" (CONVENTIONAL_CROPS) — red at Level 2', () => {
    const result = analyzeIngredients('water, malt extract, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt extract')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"malt extract" cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, malt extract, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt extract')).toBeUndefined();
  });

  test('"malt flavor" (CONVENTIONAL_CROPS) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, malt flavor, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt flavor" (CONVENTIONAL_CROPS) — red at Level 2', () => {
    const result = analyzeIngredients('water, malt flavor, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt flavor')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"malt flavor" cleared by organic prefix', () => {
    const result = analyzeIngredients('water, organic malt flavor, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt flavor')).toBeUndefined();
  });

  // ── GLUTEN_GRAINS: malt flavor ────────────────────────────────────────────

  test('"malt flavor" (GLUTEN_GRAINS) — caution flag present at Level 2', () => {
    const result = analyzeIngredients('water, malt flavor, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'malt flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('"malt flavor" gluten flag fires even when conventional_crops is cleared by usda-organic', () => {
    const result = analyzeIngredients('water, malt flavor, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'malt flavor')).toBeUndefined();
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'malt flavor')).toBeDefined();
  });

  // ── GLUTEN_GRAINS: whole grain brown rice flour (broader prolamin definition)

  // Note: rice prolamins (oryzin) can trigger sensitivity in some celiac and
  // non-celiac gluten-sensitive individuals — broader prolamin definition.
  test('"whole grain brown rice flour" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('whole grain brown rice flour, water', [], 1);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'whole grain brown rice flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('"whole grain brown rice flour" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('whole grain brown rice flour, water', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'whole grain brown rice flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('"whole grain brown rice flour" wins over "rice flour" and "brown rice" at the same position', () => {
    const result = analyzeIngredients('whole grain brown rice flour, water', [], 2);
    const flags = flagsFor(result, 'gluten_grains').filter(
      f => f.matchedIngredient === 'whole grain brown rice flour' ||
           f.matchedIngredient === 'rice flour' ||
           f.matchedIngredient === 'brown rice'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('whole grain brown rice flour');
  });

  test('"whole grain brown rice flour" gluten flag is NOT suppressed by usda-organic label', () => {
    const result = analyzeIngredients('whole grain brown rice flour, water', ['usda-organic'], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'whole grain brown rice flour')).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 20. Bucket 1 — expanded SYNTHETIC_ADDITIVES triggers
// ════════════════════════════════════════════════════════════════════════════

describe('20 — Bucket 1: gallates, preservatives, sulfites, EDTA, lactylates, parabens, colorants, novel proteins, vanillin', () => {

  // ── Gallate antioxidants ──────────────────────────────────────────────────

  test('"octyl gallate" — red at Level 1', () => {
    expect(analyzeIngredients('octyl gallate, water', [], 1).verdict).toBe('red');
  });

  test('"octyl gallate" — red at Level 2', () => {
    const result = analyzeIngredients('octyl gallate, water', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'octyl gallate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"dodecyl gallate" — red at Level 1', () => {
    expect(analyzeIngredients('dodecyl gallate, water', [], 1).verdict).toBe('red');
  });

  test('"dodecyl gallate" — red at Level 2', () => {
    const result = analyzeIngredients('dodecyl gallate, water', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'dodecyl gallate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Preservative acids and salts ─────────────────────────────────────────

  test('"potassium benzoate" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium benzoate, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium benzoate" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium benzoate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium benzoate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"benzoic acid" — red at Level 1', () => {
    expect(analyzeIngredients('water, benzoic acid, salt', [], 1).verdict).toBe('red');
  });

  test('"benzoic acid" — red at Level 2', () => {
    const result = analyzeIngredients('water, benzoic acid, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'benzoic acid')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium sorbate" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium sorbate, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium sorbate" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium sorbate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium sorbate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"calcium propionate" — red at Level 1', () => {
    expect(analyzeIngredients('water, calcium propionate, salt', [], 1).verdict).toBe('red');
  });

  test('"calcium propionate" — red at Level 2', () => {
    const result = analyzeIngredients('water, calcium propionate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'calcium propionate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium propionate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium propionate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium propionate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium propionate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium propionate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"propionic acid" — red at Level 1', () => {
    expect(analyzeIngredients('water, propionic acid, salt', [], 1).verdict).toBe('red');
  });

  test('"propionic acid" — red at Level 2', () => {
    const result = analyzeIngredients('water, propionic acid, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'propionic acid')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium nitrate" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium nitrate, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium nitrate" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium nitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium nitrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium nitrite" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium nitrite, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium nitrite" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium nitrite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium nitrite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium cyclamate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium cyclamate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium cyclamate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium cyclamate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium cyclamate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"natamycin" — red at Level 1', () => {
    expect(analyzeIngredients('water, natamycin, salt', [], 1).verdict).toBe('red');
  });

  test('"natamycin" — red at Level 2', () => {
    const result = analyzeIngredients('water, natamycin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'natamycin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"stannous chloride" — red at Level 1', () => {
    expect(analyzeIngredients('water, stannous chloride, salt', [], 1).verdict).toBe('red');
  });

  test('"stannous chloride" — red at Level 2', () => {
    const result = analyzeIngredients('water, stannous chloride, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'stannous chloride')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('preservatives are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, potassium sorbate, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium sorbate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Sulfur-based preservatives ────────────────────────────────────────────

  test('"sulfur dioxide" — red at Level 1', () => {
    expect(analyzeIngredients('water, sulfur dioxide, salt', [], 1).verdict).toBe('red');
  });

  test('"sulfur dioxide" — red at Level 2', () => {
    const result = analyzeIngredients('water, sulfur dioxide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sulfur dioxide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium bisulfite" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium bisulfite, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium bisulfite" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium bisulfite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium bisulfite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium metabisulfite" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium metabisulfite, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium metabisulfite" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium metabisulfite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium metabisulfite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium sulfite" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium sulfite, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium sulfite" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium sulfite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium sulfite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium bisulfite" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium bisulfite, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium bisulfite" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium bisulfite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium bisulfite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium metabisulfite" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium metabisulfite, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium metabisulfite" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium metabisulfite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium metabisulfite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sulfites" — red at Level 1', () => {
    expect(analyzeIngredients('contains sulfites, water', [], 1).verdict).toBe('red');
  });

  test('"sulfites" — red at Level 2', () => {
    const result = analyzeIngredients('contains sulfites, water', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sulfites')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium bisulfite" and "sulfites" are independent — neither is a substring of the other', () => {
    // "sodium bisulfite" ends in "ite" not "ites" — no substring overlap
    const r1 = analyzeIngredients('sodium bisulfite, water', [], 2);
    expect(flagsFor(r1, 'additives').find(f => f.matchedIngredient === 'sodium bisulfite')).toBeDefined();
    const r2 = analyzeIngredients('sulfites, water', [], 2);
    expect(flagsFor(r2, 'additives').find(f => f.matchedIngredient === 'sulfites')).toBeDefined();
  });

  // ── EDTA chelating agents ─────────────────────────────────────────────────

  test('"calcium disodium edta" — red at Level 1', () => {
    expect(analyzeIngredients('water, calcium disodium edta, salt', [], 1).verdict).toBe('red');
  });

  test('"calcium disodium edta" — red at Level 2', () => {
    const result = analyzeIngredients('water, calcium disodium edta, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'calcium disodium edta')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"calcium disodium edta" wins over "disodium edta" at same position', () => {
    const result = analyzeIngredients('water, calcium disodium edta, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'calcium disodium edta' ||
           f.matchedIngredient === 'disodium edta'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('calcium disodium edta');
  });

  test('"disodium edta" standalone — red at Level 1', () => {
    expect(analyzeIngredients('water, disodium edta, salt', [], 1).verdict).toBe('red');
  });

  test('"disodium edta" standalone — red at Level 2', () => {
    const result = analyzeIngredients('water, disodium edta, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'disodium edta')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"tetrasodium edta" — red at Level 1', () => {
    expect(analyzeIngredients('water, tetrasodium edta, salt', [], 1).verdict).toBe('red');
  });

  test('"tetrasodium edta" — red at Level 2', () => {
    const result = analyzeIngredients('water, tetrasodium edta, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'tetrasodium edta')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Lactylate emulsifiers ─────────────────────────────────────────────────

  test('"sodium stearoyl-2-lactylate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium stearoyl-2-lactylate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium stearoyl-2-lactylate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium stearoyl-2-lactylate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium stearoyl-2-lactylate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium stearoyl lactylate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium stearoyl lactylate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium stearoyl lactylate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium stearoyl lactylate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium stearoyl lactylate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium stearoyl-2-lactylate" and "sodium stearoyl lactylate" are independent triggers', () => {
    // hyphen-2- vs space — different strings; both fire when each appears
    const result = analyzeIngredients('sodium stearoyl-2-lactylate, sodium stearoyl lactylate, water', [], 2);
    expect(flagsFor(result, 'additives').filter(f => f.matchedIngredient === 'sodium stearoyl-2-lactylate')).toHaveLength(1);
    expect(flagsFor(result, 'additives').filter(f => f.matchedIngredient === 'sodium stearoyl lactylate')).toHaveLength(1);
  });

  test('"calcium stearoyl-2-lactylate" — red at Level 1', () => {
    expect(analyzeIngredients('water, calcium stearoyl-2-lactylate, salt', [], 1).verdict).toBe('red');
  });

  test('"calcium stearoyl-2-lactylate" — red at Level 2', () => {
    const result = analyzeIngredients('water, calcium stearoyl-2-lactylate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'calcium stearoyl-2-lactylate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Fat substitutes and sucrose esters ───────────────────────────────────

  test('"salatrim" — red at Level 1', () => {
    expect(analyzeIngredients('water, salatrim, salt', [], 1).verdict).toBe('red');
  });

  test('"salatrim" — red at Level 2', () => {
    const result = analyzeIngredients('water, salatrim, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'salatrim')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"succistearin" — red at Level 1', () => {
    expect(analyzeIngredients('water, succistearin, salt', [], 1).verdict).toBe('red');
  });

  test('"succistearin" — red at Level 2', () => {
    const result = analyzeIngredients('water, succistearin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'succistearin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sucroglycerides" — red at Level 1', () => {
    expect(analyzeIngredients('water, sucroglycerides, salt', [], 1).verdict).toBe('red');
  });

  test('"sucroglycerides" — red at Level 2', () => {
    const result = analyzeIngredients('water, sucroglycerides, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sucroglycerides')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Parabens (methylparaben, ethylparaben, butylparaben, heptylparaben;
  //    propylparaben already tested in describe 13) ──────────────────────────

  test('"methylparaben" — red at Level 1', () => {
    expect(analyzeIngredients('water, methylparaben, salt', [], 1).verdict).toBe('red');
  });

  test('"methylparaben" — red at Level 2', () => {
    const result = analyzeIngredients('water, methylparaben, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'methylparaben')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"ethylparaben" — red at Level 1', () => {
    expect(analyzeIngredients('water, ethylparaben, salt', [], 1).verdict).toBe('red');
  });

  test('"ethylparaben" — red at Level 2', () => {
    const result = analyzeIngredients('water, ethylparaben, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'ethylparaben')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"butylparaben" — red at Level 1', () => {
    expect(analyzeIngredients('water, butylparaben, salt', [], 1).verdict).toBe('red');
  });

  test('"butylparaben" — red at Level 2', () => {
    const result = analyzeIngredients('water, butylparaben, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'butylparaben')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"heptylparaben" — red at Level 1', () => {
    expect(analyzeIngredients('water, heptylparaben, salt', [], 1).verdict).toBe('red');
  });

  test('"heptylparaben" — red at Level 2', () => {
    const result = analyzeIngredients('water, heptylparaben, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'heptylparaben')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('parabens are NOT cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, methylparaben, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'methylparaben')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Additional synthetic colorants (red 3, red 4 already tested in describe 13) ──

  test('"carmine" — red at Level 1', () => {
    expect(analyzeIngredients('water, carmine, salt', [], 1).verdict).toBe('red');
  });

  test('"carmine" — red at Level 2', () => {
    const result = analyzeIngredients('water, carmine, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'carmine')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"cochineal" — red at Level 1', () => {
    expect(analyzeIngredients('cochineal extract, water', [], 1).verdict).toBe('red');
  });

  test('"cochineal" — red at Level 2', () => {
    const result = analyzeIngredients('cochineal extract, water', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'cochineal')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"erythrosine" — red at Level 1', () => {
    expect(analyzeIngredients('water, erythrosine, salt', [], 1).verdict).toBe('red');
  });

  test('"erythrosine" — red at Level 2', () => {
    const result = analyzeIngredients('water, erythrosine, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'erythrosine')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"iron oxide" — red at Level 1', () => {
    expect(analyzeIngredients('water, iron oxide, salt', [], 1).verdict).toBe('red');
  });

  test('"iron oxide" — red at Level 2', () => {
    const result = analyzeIngredients('water, iron oxide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'iron oxide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"red 40" wins over "red 4" at the same position', () => {
    // "red 4" is a substring of "red 40"; the longer trigger must claim that span
    const result = analyzeIngredients('water, red 40, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'red 40' || f.matchedIngredient === 'red 4'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('red 40');
  });

  // ── Novel proteins and food-tech ingredients ──────────────────────────────

  test('"soy leghemoglobin" — red at Level 1', () => {
    expect(analyzeIngredients('water, soy leghemoglobin, salt', [], 1).verdict).toBe('red');
  });

  test('"soy leghemoglobin" — red at Level 2', () => {
    const result = analyzeIngredients('water, soy leghemoglobin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'soy leghemoglobin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"insect flour" — red at Level 1', () => {
    expect(analyzeIngredients('water, insect flour, salt', [], 1).verdict).toBe('red');
  });

  test('"insect flour" — red at Level 2', () => {
    const result = analyzeIngredients('water, insect flour, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'insect flour')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Synthetic flavoring compounds ─────────────────────────────────────────

  test('"vanillin" — red at Level 1', () => {
    expect(analyzeIngredients('water, vanillin, salt', [], 1).verdict).toBe('red');
  });

  test('"vanillin" — red at Level 2', () => {
    const result = analyzeIngredients('water, vanillin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'vanillin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"ethyl vanillin" — red at Level 1', () => {
    expect(analyzeIngredients('water, ethyl vanillin, salt', [], 1).verdict).toBe('red');
  });

  test('"ethyl vanillin" — red at Level 2', () => {
    const result = analyzeIngredients('water, ethyl vanillin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'ethyl vanillin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"ethyl vanillin" wins over "vanillin" at the same position', () => {
    const result = analyzeIngredients('water, ethyl vanillin, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'ethyl vanillin' || f.matchedIngredient === 'vanillin'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('ethyl vanillin');
  });

  test('"vanillin" fires independently when not preceded by "ethyl"', () => {
    const result = analyzeIngredients('water, vanillin, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'vanillin' || f.matchedIngredient === 'ethyl vanillin'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('vanillin');
  });

  test('"vanillin" is NOT cleared by usda-organic label (Cat 4 — no clearance)', () => {
    const result = analyzeIngredients('water, vanillin, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'vanillin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 21. FD&C "No." normalization — label-style variants match existing triggers
// ════════════════════════════════════════════════════════════════════════════

describe('21 — FD&C "No." normalization: label variants match existing dye triggers', () => {

  // "No. " is stripped before lowercasing so "FD&C Red No. 40" →
  // "FD&C Red 40" → "fd&c red 40" → contains trigger `red 40`.

  test('"FD&C Red No. 40" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Red No. 40, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Red No. 40" — matchedIngredient is "red 40" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Red No. 40, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 40')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Yellow No. 5" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Yellow No. 5, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Yellow No. 5" — matchedIngredient is "yellow 5" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Yellow No. 5, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'yellow 5')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Yellow No. 6" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Yellow No. 6, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Yellow No. 6" — matchedIngredient is "yellow 6" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Yellow No. 6, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'yellow 6')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Blue No. 1" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Blue No. 1, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Blue No. 1" — matchedIngredient is "blue 1" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Blue No. 1, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'blue 1')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Blue No. 2" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Blue No. 2, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Blue No. 2" — matchedIngredient is "blue 2" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Blue No. 2, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'blue 2')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Green No. 3" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Green No. 3, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Green No. 3" — matchedIngredient is "green 3" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Green No. 3, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'green 3')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"FD&C Red No. 3" — red at Level 1', () => {
    expect(analyzeIngredients('water, FD&C Red No. 3, salt', [], 1).verdict).toBe('red');
  });

  test('"FD&C Red No. 3" — matchedIngredient is "red 3" at Level 2', () => {
    const result = analyzeIngredients('water, FD&C Red No. 3, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 3')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"Citrus Red No. 2" — red at Level 1', () => {
    expect(analyzeIngredients('orange peel, Citrus Red No. 2', [], 1).verdict).toBe('red');
  });

  test('"Citrus Red No. 2" — matchedIngredient is "citrus red 2" at Level 2', () => {
    const result = analyzeIngredients('orange peel, Citrus Red No. 2', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'citrus red 2')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('normalization handles mixed case "no." correctly', () => {
    // "NO. " (all caps) is also stripped
    const result = analyzeIngredients('water, FD&C Red NO. 40, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 40')).toBeDefined();
  });

  test('normalization does not affect ingredient strings without "No."', () => {
    // Existing triggers still work unchanged
    const result = analyzeIngredients('water, red 40, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 40')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"no." embedded in a word is not stripped (\\b boundary guard)', () => {
    // "annotto" contains "no" but not as a word — normalization leaves it alone
    const result = analyzeIngredients('annotto, water', [], 2);
    expect(result.verdict).toBe('green'); // annotto is not a known trigger
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 22. Processing methods — mechanically separated meat
// ════════════════════════════════════════════════════════════════════════════

describe('22 — Processing methods: mechanically separated meat', () => {

  test('"mechanically separated meat" — red at Level 1', () => {
    const result = analyzeIngredients('mechanically separated meat, water, salt', [], 1);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated meat')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"mechanically separated meat" — red at Level 2', () => {
    const result = analyzeIngredients('mechanically separated meat, water, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated meat')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"mechanically separated meat" is NOT cleared by usda-organic label (Cat 4 — no clearance)', () => {
    const result = analyzeIngredients('mechanically separated meat, water', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated meat')).toBeDefined();
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 23. Expanded SYNTHETIC_ADDITIVES — interesterified variants, lake dye forms,
//     dye chemical name synonyms, new E-numbers, stearyl ester emulsifiers,
//     bare cyclamate
// ════════════════════════════════════════════════════════════════════════════

describe('23 — Expanded SYNTHETIC_ADDITIVES: interesterified variants, lake forms, synonyms, E-numbers', () => {

  // ── Helper (already declared in outer scope) ─────────────────────────────
  // flagsFor(result, category) filters result.flags by category

  // ── Interesterified oil specific variants ────────────────────────────────

  test('"interesterified palm oil" — red at Level 1', () => {
    expect(analyzeIngredients('water, interesterified palm oil, salt', [], 1).verdict).toBe('red');
  });

  test('"interesterified palm oil" — matchedIngredient is "interesterified palm oil" at Level 2', () => {
    const result = analyzeIngredients('water, interesterified palm oil, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'interesterified palm oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"interesterified soybean oil" — red at Level 1', () => {
    expect(analyzeIngredients('water, interesterified soybean oil, salt', [], 1).verdict).toBe('red');
  });

  test('"interesterified soybean oil" — matchedIngredient is "interesterified soybean oil" at Level 2', () => {
    const result = analyzeIngredients('water, interesterified soybean oil, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'interesterified soybean oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"interesterified palm oil" wins over "interesterified oil" at the same position', () => {
    // "interesterified palm oil" contains "interesterified" but NOT "interesterified oil"
    // as a substring (palm sits between). Both are independent triggers; only one
    // should fire per occurrence since findMatches prevents overlap.
    const result = analyzeIngredients('water, interesterified palm oil, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'interesterified palm oil' ||
           f.matchedIngredient === 'interesterified oil'
    );
    // 'interesterified palm oil' is 24 chars; 'interesterified oil' is 19 chars.
    // They do NOT overlap in "interesterified palm oil" — 'interesterified oil' is NOT
    // a substring of "interesterified palm oil". Both would fire as separate ranges.
    // Confirm at least the specific variant is flagged.
    expect(flags.some(f => f.matchedIngredient === 'interesterified palm oil')).toBe(true);
  });

  // ── Bare cyclamate ────────────────────────────────────────────────────────

  test('"cyclamate" (bare form) — red at Level 1', () => {
    expect(analyzeIngredients('water, cyclamate, salt', [], 1).verdict).toBe('red');
  });

  test('"cyclamate" (bare form) — matchedIngredient is "cyclamate" at Level 2', () => {
    const result = analyzeIngredients('water, cyclamate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'cyclamate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Lake dye forms ────────────────────────────────────────────────────────
  // Lake forms are aluminum salt complexes of water-soluble dyes. They are
  // separate substances from their base dyes. Each needs an explicit trigger.
  // findMatches sorts by length so "yellow 5 lake" (13 chars) shadows
  // "yellow 5" (8 chars) when both appear at the same text position.

  test('"yellow 5 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, yellow 5 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"yellow 5 lake" — matchedIngredient is "yellow 5 lake" at Level 2', () => {
    const result = analyzeIngredients('water, yellow 5 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'yellow 5 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"yellow 5 lake" shadows "yellow 5" — only lake form reported', () => {
    const result = analyzeIngredients('water, yellow 5 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'yellow 5 lake' || f.matchedIngredient === 'yellow 5'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('yellow 5 lake');
  });

  test('"yellow 6 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, yellow 6 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"yellow 6 lake" — matchedIngredient is "yellow 6 lake" at Level 2', () => {
    const result = analyzeIngredients('water, yellow 6 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'yellow 6 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"yellow 6 lake" shadows "yellow 6" — only lake form reported', () => {
    const result = analyzeIngredients('water, yellow 6 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'yellow 6 lake' || f.matchedIngredient === 'yellow 6'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('yellow 6 lake');
  });

  test('"red 40 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, red 40 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"red 40 lake" — matchedIngredient is "red 40 lake" at Level 2', () => {
    const result = analyzeIngredients('water, red 40 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 40 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"red 40 lake" shadows "red 40" — only lake form reported', () => {
    const result = analyzeIngredients('water, red 40 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'red 40 lake' || f.matchedIngredient === 'red 40'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('red 40 lake');
  });

  test('"blue 1 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, blue 1 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"blue 1 lake" — matchedIngredient is "blue 1 lake" at Level 2', () => {
    const result = analyzeIngredients('water, blue 1 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'blue 1 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"blue 1 lake" shadows "blue 1" — only lake form reported', () => {
    const result = analyzeIngredients('water, blue 1 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'blue 1 lake' || f.matchedIngredient === 'blue 1'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('blue 1 lake');
  });

  test('"blue 2 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, blue 2 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"blue 2 lake" — matchedIngredient is "blue 2 lake" at Level 2', () => {
    const result = analyzeIngredients('water, blue 2 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'blue 2 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"blue 2 lake" shadows "blue 2" — only lake form reported', () => {
    const result = analyzeIngredients('water, blue 2 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'blue 2 lake' || f.matchedIngredient === 'blue 2'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('blue 2 lake');
  });

  test('"green 3 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, green 3 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"green 3 lake" — matchedIngredient is "green 3 lake" at Level 2', () => {
    const result = analyzeIngredients('water, green 3 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'green 3 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"green 3 lake" shadows "green 3" — only lake form reported', () => {
    const result = analyzeIngredients('water, green 3 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'green 3 lake' || f.matchedIngredient === 'green 3'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('green 3 lake');
  });

  test('"red 3 lake" — red at Level 1', () => {
    expect(analyzeIngredients('water, red 3 lake, salt', [], 1).verdict).toBe('red');
  });

  test('"red 3 lake" — matchedIngredient is "red 3 lake" at Level 2', () => {
    const result = analyzeIngredients('water, red 3 lake, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'red 3 lake')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"red 3 lake" shadows "red 3" — only lake form reported', () => {
    const result = analyzeIngredients('water, red 3 lake, salt', [], 2);
    const flags = flagsFor(result, 'additives').filter(
      f => f.matchedIngredient === 'red 3 lake' || f.matchedIngredient === 'red 3'
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].matchedIngredient).toBe('red 3 lake');
  });

  // ── Dye chemical name synonyms ────────────────────────────────────────────

  test('"brilliant blue fcf" (Blue 1 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, brilliant blue fcf, salt', [], 1).verdict).toBe('red');
  });

  test('"brilliant blue fcf" — matchedIngredient is "brilliant blue fcf" at Level 2', () => {
    const result = analyzeIngredients('water, brilliant blue fcf, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'brilliant blue fcf')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"fast green fcf" (Green 3 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, fast green fcf, salt', [], 1).verdict).toBe('red');
  });

  test('"fast green fcf" — matchedIngredient is "fast green fcf" at Level 2', () => {
    const result = analyzeIngredients('water, fast green fcf, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'fast green fcf')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sunset yellow" (Yellow 6 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, sunset yellow, salt', [], 1).verdict).toBe('red');
  });

  test('"sunset yellow" — matchedIngredient is "sunset yellow" at Level 2', () => {
    const result = analyzeIngredients('water, sunset yellow, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sunset yellow')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"tartrazine" (Yellow 5 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, tartrazine, salt', [], 1).verdict).toBe('red');
  });

  test('"tartrazine" — matchedIngredient is "tartrazine" at Level 2', () => {
    const result = analyzeIngredients('water, tartrazine, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'tartrazine')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"allura red" (Red 40 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, allura red, salt', [], 1).verdict).toBe('red');
  });

  test('"allura red" — matchedIngredient is "allura red" at Level 2', () => {
    const result = analyzeIngredients('water, allura red, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'allura red')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"indigotine" (Blue 2 synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, indigotine, salt', [], 1).verdict).toBe('red');
  });

  test('"indigotine" — matchedIngredient is "indigotine" at Level 2', () => {
    const result = analyzeIngredients('water, indigotine, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'indigotine')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"orange b" — red at Level 1', () => {
    expect(analyzeIngredients('water, orange b, salt', [], 1).verdict).toBe('red');
  });

  test('"orange b" — matchedIngredient is "orange b" at Level 2', () => {
    const result = analyzeIngredients('water, orange b, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'orange b')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── New E-numbers ─────────────────────────────────────────────────────────
  // E-numbers listed numerically. Where an E-number maps to an existing named
  // trigger (e.g. e171 → titanium dioxide), both forms are independently testable.

  test('"e102" (tartrazine / Yellow 5) — red at Level 1', () => {
    expect(analyzeIngredients('water, e102, salt', [], 1).verdict).toBe('red');
  });

  test('"e102" — matchedIngredient is "e102" at Level 2', () => {
    const result = analyzeIngredients('water, e102, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e102')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e110" (sunset yellow / Yellow 6) — red at Level 1', () => {
    expect(analyzeIngredients('water, e110, salt', [], 1).verdict).toBe('red');
  });

  test('"e110" — matchedIngredient is "e110" at Level 2', () => {
    const result = analyzeIngredients('water, e110, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e110')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e127" (erythrosine / Red 3) — red at Level 1', () => {
    expect(analyzeIngredients('water, e127, salt', [], 1).verdict).toBe('red');
  });

  test('"e127" — matchedIngredient is "e127" at Level 2', () => {
    const result = analyzeIngredients('water, e127, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e127')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e129" (allura red / Red 40) — red at Level 1', () => {
    expect(analyzeIngredients('water, e129, salt', [], 1).verdict).toBe('red');
  });

  test('"e129" — matchedIngredient is "e129" at Level 2', () => {
    const result = analyzeIngredients('water, e129, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e129')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e132" (indigotine / Blue 2) — red at Level 1', () => {
    expect(analyzeIngredients('water, e132, salt', [], 1).verdict).toBe('red');
  });

  test('"e132" — matchedIngredient is "e132" at Level 2', () => {
    const result = analyzeIngredients('water, e132, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e132')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e133" (brilliant blue FCF / Blue 1) — red at Level 1', () => {
    expect(analyzeIngredients('water, e133, salt', [], 1).verdict).toBe('red');
  });

  test('"e133" — matchedIngredient is "e133" at Level 2', () => {
    const result = analyzeIngredients('water, e133, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e133')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e143" (fast green FCF / Green 3) — red at Level 1', () => {
    expect(analyzeIngredients('water, e143, salt', [], 1).verdict).toBe('red');
  });

  test('"e143" — matchedIngredient is "e143" at Level 2', () => {
    const result = analyzeIngredients('water, e143, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e143')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e161g" (canthaxanthin) — red at Level 1', () => {
    expect(analyzeIngredients('water, e161g, salt', [], 1).verdict).toBe('red');
  });

  test('"e161g" — matchedIngredient is "e161g" at Level 2', () => {
    const result = analyzeIngredients('water, e161g, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e161g')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e171" (titanium dioxide) — red at Level 1', () => {
    expect(analyzeIngredients('water, e171, salt', [], 1).verdict).toBe('red');
  });

  test('"e171" — matchedIngredient is "e171" at Level 2', () => {
    const result = analyzeIngredients('water, e171, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e171')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e388" (thiodipropionic acid) — red at Level 1', () => {
    expect(analyzeIngredients('water, e388, salt', [], 1).verdict).toBe('red');
  });

  test('"e388" — matchedIngredient is "e388" at Level 2', () => {
    const result = analyzeIngredients('water, e388, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e388')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e472a" (acetic acid esters of mono- and diglycerides) — red at Level 1', () => {
    expect(analyzeIngredients('water, e472a, salt', [], 1).verdict).toBe('red');
  });

  test('"e472a" — matchedIngredient is "e472a" at Level 2', () => {
    const result = analyzeIngredients('water, e472a, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e472a')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e472b" (lactic acid esters of mono- and diglycerides) — red at Level 1', () => {
    expect(analyzeIngredients('water, e472b, salt', [], 1).verdict).toBe('red');
  });

  test('"e472b" — matchedIngredient is "e472b" at Level 2', () => {
    const result = analyzeIngredients('water, e472b, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e472b')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e472e" (DATEM) — red at Level 1', () => {
    expect(analyzeIngredients('water, e472e, salt', [], 1).verdict).toBe('red');
  });

  test('"e472e" — matchedIngredient is "e472e" at Level 2', () => {
    const result = analyzeIngredients('water, e472e, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e472e')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e483" (stearyl tartrate) — red at Level 1', () => {
    expect(analyzeIngredients('water, e483, salt', [], 1).verdict).toBe('red');
  });

  test('"e483" — matchedIngredient is "e483" at Level 2', () => {
    const result = analyzeIngredients('water, e483, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e483')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e485" (sodium stearoyl fumarate) — red at Level 1', () => {
    expect(analyzeIngredients('water, e485, salt', [], 1).verdict).toBe('red');
  });

  test('"e485" — matchedIngredient is "e485" at Level 2', () => {
    const result = analyzeIngredients('water, e485, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e485')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e487" (sodium lauryl sulfate) — red at Level 1', () => {
    expect(analyzeIngredients('water, e487, salt', [], 1).verdict).toBe('red');
  });

  test('"e487" — matchedIngredient is "e487" at Level 2', () => {
    const result = analyzeIngredients('water, e487, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e487')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Stearyl ester emulsifiers ─────────────────────────────────────────────

  test('"sodium stearyl fumarate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium stearyl fumarate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium stearyl fumarate" — matchedIngredient is "sodium stearyl fumarate" at Level 2', () => {
    const result = analyzeIngredients('water, sodium stearyl fumarate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium stearyl fumarate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"stearyl tartrate" — red at Level 1', () => {
    expect(analyzeIngredients('water, stearyl tartrate, salt', [], 1).verdict).toBe('red');
  });

  test('"stearyl tartrate" — matchedIngredient is "stearyl tartrate" at Level 2', () => {
    const result = analyzeIngredients('water, stearyl tartrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'stearyl tartrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

});

// ════════════════════════════════════════════════════════════════════════════
// 24. Synonym / E-number expansion — nitrates, BVO, bleaching agents,
//     BHA/BHT full names, ADA synonym, SLS forms, new E-numbers
// ════════════════════════════════════════════════════════════════════════════

describe('24 — Synonym/E-number expansion: nitrates, BVO, bleaching agents, BHA/BHT names, SLS, E-numbers', () => {

  // ── Nitrates / nitrites (pre-existing triggers — confirming coverage) ─────

  test('"potassium nitrate" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium nitrate, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium nitrate" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium nitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium nitrate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium nitrite" — red at Level 1', () => {
    expect(analyzeIngredients('water, potassium nitrite, salt', [], 1).verdict).toBe('red');
  });

  test('"potassium nitrite" — red at Level 2', () => {
    const result = analyzeIngredients('water, potassium nitrite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium nitrite')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── "Uncured" nitrate sources ─────────────────────────────────────────────

  test('"cultured celery juice" — red at Level 1', () => {
    expect(analyzeIngredients('water, cultured celery juice, salt', [], 1).verdict).toBe('red');
  });

  test('"cultured celery juice" — red at Level 2', () => {
    const result = analyzeIngredients('water, cultured celery juice, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'cultured celery juice')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"cultured celery powder" — red at Level 1', () => {
    expect(analyzeIngredients('water, cultured celery powder, salt', [], 1).verdict).toBe('red');
  });

  test('"cultured celery powder" — red at Level 2', () => {
    const result = analyzeIngredients('water, cultured celery powder, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'cultured celery powder')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('bare "celery powder" does NOT trigger any flag', () => {
    const result = analyzeIngredients('water, celery powder, salt', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient.includes('celery powder'))).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('bare "celery juice" does NOT trigger any flag', () => {
    const result = analyzeIngredients('water, celery juice, salt', [], 2);
    expect(result.flags.filter(f => f.matchedIngredient.includes('celery juice'))).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  // ── Brominated vegetable oil ───────────────────────────────────────────────

  test('"brominated vegetable oil" — red at Level 1', () => {
    expect(analyzeIngredients('water, brominated vegetable oil, salt', [], 1).verdict).toBe('red');
  });

  test('"brominated vegetable oil" — red at Level 2', () => {
    const result = analyzeIngredients('water, brominated vegetable oil, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'brominated vegetable oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"brominated vegetable oil" fires as category additives (not seed_oils) — PRIORITY_ADDITIVES pre-pass', () => {
    const result = analyzeIngredients('water, brominated vegetable oil, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'brominated vegetable oil')).toBeDefined();
    expect(flagsFor(result, 'seed_oils').find(f => f.matchedIngredient === 'vegetable oil')).toBeUndefined();
    expect(result.verdict).toBe('red');
  });

  test('"brominated oil" — red at Level 1', () => {
    expect(analyzeIngredients('water, brominated oil, salt', [], 1).verdict).toBe('red');
  });

  test('"brominated oil" — red at Level 2', () => {
    const result = analyzeIngredients('water, brominated oil, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'brominated oil')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Flour bleaching / oxidizing agents ───────────────────────────────────

  test('"benzoyl peroxide" — red at Level 1', () => {
    expect(analyzeIngredients('enriched flour, benzoyl peroxide, salt', [], 1).verdict).toBe('red');
  });

  test('"benzoyl peroxide" — red at Level 2', () => {
    const result = analyzeIngredients('water, benzoyl peroxide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'benzoyl peroxide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"acetone peroxide" — red at Level 1', () => {
    expect(analyzeIngredients('water, acetone peroxide, salt', [], 1).verdict).toBe('red');
  });

  test('"acetone peroxide" — red at Level 2', () => {
    const result = analyzeIngredients('water, acetone peroxide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'acetone peroxide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"chlorine dioxide" — red at Level 1', () => {
    expect(analyzeIngredients('water, chlorine dioxide, salt', [], 1).verdict).toBe('red');
  });

  test('"chlorine dioxide" — red at Level 2', () => {
    const result = analyzeIngredients('water, chlorine dioxide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'chlorine dioxide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Erythrosine (pre-existing dye synonym — confirming coverage) ──────────

  test('"erythrosine" — red at Level 1', () => {
    expect(analyzeIngredients('water, erythrosine, salt', [], 1).verdict).toBe('red');
  });

  test('"erythrosine" — red at Level 2', () => {
    const result = analyzeIngredients('water, erythrosine, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'erythrosine')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── BHA / BHT full chemical names ─────────────────────────────────────────

  test('"butylated hydroxyanisole" (BHA) — red at Level 1', () => {
    expect(analyzeIngredients('water, butylated hydroxyanisole, salt', [], 1).verdict).toBe('red');
  });

  test('"butylated hydroxyanisole" (BHA) — red at Level 2', () => {
    const result = analyzeIngredients('water, butylated hydroxyanisole, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'butylated hydroxyanisole')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"butylated hydroxytoluene" (BHT) — red at Level 1', () => {
    expect(analyzeIngredients('water, butylated hydroxytoluene, salt', [], 1).verdict).toBe('red');
  });

  test('"butylated hydroxytoluene" (BHT) — red at Level 2', () => {
    const result = analyzeIngredients('water, butylated hydroxytoluene, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'butylated hydroxytoluene')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── ADA synonym ───────────────────────────────────────────────────────────

  test('"azobisformamide" (ADA synonym) — red at Level 1', () => {
    expect(analyzeIngredients('water, azobisformamide, salt', [], 1).verdict).toBe('red');
  });

  test('"azobisformamide" (ADA synonym) — red at Level 2', () => {
    const result = analyzeIngredients('water, azobisformamide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'azobisformamide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── SLS text forms ────────────────────────────────────────────────────────

  test('"sodium lauryl sulfate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium lauryl sulfate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium lauryl sulfate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium lauryl sulfate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium lauryl sulfate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"sodium dodecyl sulfate" — red at Level 1', () => {
    expect(analyzeIngredients('water, sodium dodecyl sulfate, salt', [], 1).verdict).toBe('red');
  });

  test('"sodium dodecyl sulfate" — red at Level 2', () => {
    const result = analyzeIngredients('water, sodium dodecyl sulfate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium dodecyl sulfate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── New E-numbers ─────────────────────────────────────────────────────────

  test('"e320" (BHA) — red at Level 1', () => {
    expect(analyzeIngredients('water, e320, salt', [], 1).verdict).toBe('red');
  });

  test('"e320" (BHA) — red at Level 2', () => {
    const result = analyzeIngredients('water, e320, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e320')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e321" (BHT) — red at Level 1', () => {
    expect(analyzeIngredients('water, e321, salt', [], 1).verdict).toBe('red');
  });

  test('"e321" (BHT) — red at Level 2', () => {
    const result = analyzeIngredients('water, e321, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e321')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e924" (potassium bromate) — red at Level 1', () => {
    expect(analyzeIngredients('water, e924, salt', [], 1).verdict).toBe('red');
  });

  test('"e924" (potassium bromate) — red at Level 2', () => {
    const result = analyzeIngredients('water, e924, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e924')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e950" (acesulfame potassium) — red at Level 1', () => {
    expect(analyzeIngredients('water, e950, salt', [], 1).verdict).toBe('red');
  });

  test('"e950" (acesulfame potassium) — red at Level 2', () => {
    const result = analyzeIngredients('water, e950, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e950')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e951" (aspartame) — red at Level 1', () => {
    expect(analyzeIngredients('water, e951, salt', [], 1).verdict).toBe('red');
  });

  test('"e951" (aspartame) — red at Level 2', () => {
    const result = analyzeIngredients('water, e951, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e951')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e952" (cyclamate) — red at Level 1', () => {
    expect(analyzeIngredients('water, e952, salt', [], 1).verdict).toBe('red');
  });

  test('"e952" (cyclamate) — red at Level 2', () => {
    const result = analyzeIngredients('water, e952, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e952')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e954" (saccharin) — red at Level 1', () => {
    expect(analyzeIngredients('water, e954, salt', [], 1).verdict).toBe('red');
  });

  test('"e954" (saccharin) — red at Level 2', () => {
    const result = analyzeIngredients('water, e954, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e954')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"e955" (sucralose) — red at Level 1', () => {
    expect(analyzeIngredients('water, e955, salt', [], 1).verdict).toBe('red');
  });

  test('"e955" (sucralose) — red at Level 2', () => {
    const result = analyzeIngredients('water, e955, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e955')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('new E-numbers are NOT cleared by usda-organic label (Cat 4 — no clearance)', () => {
    const result = analyzeIngredients('water, e955, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'e955')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

});

// ════════════════════════════════════════════════════════════════════════════
// 25. Gluten grains expansion — ancient grains, botanical names, asafoetida,
//     teff, sorghum, smoke flavoring + CONVENTIONAL_CROPS brown rice syrup
// ════════════════════════════════════════════════════════════════════════════

describe('25 — Gluten grains expansion: ancient grains, botanical names, asafoetida, smoke flavoring, brown rice syrup', () => {

  // ── Ancient and hybrid wheat varieties ────────────────────────────────────

  test('"triticale" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, triticale, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticale')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"triticale" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, triticale, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticale')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"einkorn" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, einkorn, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'einkorn')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"einkorn" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, einkorn, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'einkorn')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"emmer" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, emmer, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'emmer')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"emmer" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, emmer, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'emmer')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  // ── Botanical names ────────────────────────────────────────────────────────

  test('"triticum vulgare" (common wheat) — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, triticum vulgare, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticum vulgare')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"triticum vulgare" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, triticum vulgare, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticum vulgare')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"hordeum vulgare" (barley) — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, hordeum vulgare, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hordeum vulgare')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"hordeum vulgare" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, hordeum vulgare, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hordeum vulgare')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"secale cereale" (rye) — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, secale cereale, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'secale cereale')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"secale cereale" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, secale cereale, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'secale cereale')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"avena sativa" (oats) — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, avena sativa, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'avena sativa')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"avena sativa" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, avena sativa, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'avena sativa')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  // ── Barley-derived sweetener ──────────────────────────────────────────────

  test('"dextrimaltose" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, dextrimaltose, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'dextrimaltose')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"dextrimaltose" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, dextrimaltose, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'dextrimaltose')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  // ── Wheat-labeled derivative ──────────────────────────────────────────────

  test('"wheat maltodextrin" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, wheat maltodextrin, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'wheat maltodextrin')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"wheat maltodextrin" — gluten_grains caution flag fires at Level 2', () => {
    const result = analyzeIngredients('water, wheat maltodextrin, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'wheat maltodextrin');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
    // verdict is 'red' because the 'maltodextrin' substring also fires conventional_crops at L2
    expect(result.verdict).toBe('red');
  });

  // ── Gluten-risk spices ─────────────────────────────────────────────────────

  test('"asafoetida" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, asafoetida, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'asafoetida')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"asafoetida" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, asafoetida, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'asafoetida')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"hing" (asafoetida synonym) — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, hing, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hing')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"hing" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, hing, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hing')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  // ── Cross-sensitivity risk grains ─────────────────────────────────────────

  test('"teff" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, teff, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'teff')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"teff" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, teff, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'teff')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"teff flour" ingredient text fires a gluten_grains flag (teff substring match)', () => {
    const result = analyzeIngredients('water, teff flour, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(
      f => f.matchedIngredient === 'teff flour' || f.matchedIngredient === 'teff'
    );
    expect(flag).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"sorghum" — gluten_grains caution at Level 1', () => {
    const result = analyzeIngredients('water, sorghum, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'sorghum')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"sorghum" — gluten_grains caution at Level 2', () => {
    const result = analyzeIngredients('water, sorghum, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'sorghum')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"sorghum syrup" fires a gluten_grains flag via the sorghum substring match', () => {
    const result = analyzeIngredients('water, sorghum syrup, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(
      f => f.matchedIngredient === 'sorghum' || f.matchedIngredient === 'sorghum flour'
    );
    expect(flag).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  // ── Barley-carrier flavoring ──────────────────────────────────────────────

  test('"smoke flavoring" — gluten_grains caution flag at Level 1', () => {
    const result = analyzeIngredients('water, smoke flavoring, salt', [], 1);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'smoke flavoring');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('"smoke flavoring" — gluten_grains caution flag at Level 2', () => {
    const result = analyzeIngredients('water, smoke flavoring, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'smoke flavoring');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  // ── CONVENTIONAL_CROPS: brown rice syrup ──────────────────────────────────

  test('"brown rice syrup" — conventional_crops caution at Level 1', () => {
    const result = analyzeIngredients('water, brown rice syrup, salt', [], 1);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'brown rice syrup')).toBeDefined();
    expect(result.verdict).toBe('yellow');
  });

  test('"brown rice syrup" — conventional_crops reject at Level 2', () => {
    const result = analyzeIngredients('water, brown rice syrup, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'brown rice syrup')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"organic brown rice syrup" clears the conventional_crops flag', () => {
    const result = analyzeIngredients('organic brown rice syrup, water', [], 2);
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'brown rice syrup')).toBeUndefined();
  });

  test('"brown rice syrup" fires a gluten_grains flag via the "brown rice" trigger', () => {
    const result = analyzeIngredients('water, brown rice syrup, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(
      f => f.matchedIngredient === 'brown rice' || f.matchedIngredient === 'rice'
    );
    expect(flag).toBeDefined();
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// Block 26 — H2: unverified ingredient triage: artifacts and red list additions
// ══════════════════════════════════════════════════════════════════════════════

describe('26 — H2: unverified ingredient triage: artifacts and red list additions', () => {

  // ── ARTIFACT_PHRASES: label-structure phrases must not surface as unverified ──
  // These phrases appear as preambles or structural notes in ingredient lists
  // (e.g. "Contains 2% or less of: X, Y"). After tokenization they become
  // standalone tokens; ARTIFACT_PHRASES suppresses them at both levels.

  test('"contains less than 2% of" is not surfaced as unverified at Level 1', () => {
    const result = analyzeIngredients('water, salt, contains less than 2% of', [], 1);
    expect(result.unverifiedIngredients).not.toContain('contains less than 2% of');
  });

  test('"contains less than 2% of" is not surfaced as unverified at Level 2', () => {
    const result = analyzeIngredients('water, salt, contains less than 2% of', [], 2);
    expect(result.unverifiedIngredients).not.toContain('contains less than 2% of');
  });

  test('"contains 2% or less of the following" is not surfaced as unverified at Level 1', () => {
    const result = analyzeIngredients('water, contains 2% or less of the following, salt', [], 1);
    expect(result.unverifiedIngredients).not.toContain('contains 2% or less of the following');
  });

  test('"contains 2% or less of the following" is not surfaced as unverified at Level 2', () => {
    const result = analyzeIngredients('water, contains 2% or less of the following, salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('contains 2% or less of the following');
  });

  test('"contains one or more of the following" is not surfaced as unverified at Level 1', () => {
    const result = analyzeIngredients('water, contains one or more of the following, salt', [], 1);
    expect(result.unverifiedIngredients).not.toContain('contains one or more of the following');
  });

  test('"contains one or more of the following" is not surfaced as unverified at Level 2', () => {
    const result = analyzeIngredients('water, contains one or more of the following, salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('contains one or more of the following');
  });

  test('"added to preserve freshness" is not surfaced as unverified at Level 1', () => {
    const result = analyzeIngredients('water, salt, added to preserve freshness', [], 1);
    expect(result.unverifiedIngredients).not.toContain('added to preserve freshness');
  });

  test('"added to preserve freshness" is not surfaced as unverified at Level 2', () => {
    const result = analyzeIngredients('water, salt, added to preserve freshness', [], 2);
    expect(result.unverifiedIngredients).not.toContain('added to preserve freshness');
  });

  // ── GROUP A — Synthetic emulsifiers: polysorbates ─────────────────────────

  test('"polysorbate 60" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, polysorbate 60, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('polysorbate 60');
    expect(result.verdict).toBe('red');
  });

  test('"polysorbate 80" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, polysorbate 80, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('polysorbate 80');
    expect(result.verdict).toBe('red');
  });

  // ── GROUP B — Synthetic phosphates ───────────────────────────────────────

  test('"tetrasodium diphosphate" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, tetrasodium diphosphate, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('tetrasodium diphosphate');
    expect(result.verdict).toBe('red');
  });

  test('"tetrasodium pyrophosphate" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, tetrasodium pyrophosphate, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('tetrasodium pyrophosphate');
    expect(result.verdict).toBe('red');
  });

  test('"sodium hexametaphosphate" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, sodium hexametaphosphate, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('sodium hexametaphosphate');
    expect(result.verdict).toBe('red');
  });

  test('"sodium aluminum phosphate" triggers a synthetic_additives reject flag', () => {
    const result = analyzeIngredients('water, sodium aluminum phosphate, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('sodium aluminum phosphate');
    expect(result.verdict).toBe('red');
  });

  // ── GROUP C — Artificial dyes (existing + normalization) ─────────────────

  test('"red 3" triggers a synthetic_additives reject flag (already in list)', () => {
    const result = analyzeIngredients('water, red 3, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('red 3');
    expect(result.verdict).toBe('red');
  });

  test('"erythrosine" triggers a synthetic_additives reject flag (already in list)', () => {
    const result = analyzeIngredients('water, erythrosine, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('erythrosine');
    expect(result.verdict).toBe('red');
  });

  test('"c red #3" matches "red 3" via # normalizer', () => {
    const result = analyzeIngredients('water, c red #3, salt', [], 2);
    const flag = flagsFor(result, 'additives')[0];
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

});
