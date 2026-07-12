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

const {
  analyzeIngredients,
  containsFortifiedVitamins,
  containsNaturalColorants,
  containsMilkDerived,
  containsEggDerived,
  ALWAYS_IGNORE_INGREDIENTS,
  GLYPHOSATE_HEAVY,
  REVIEWED_CLEAN_INGREDIENTS,
} = require('./rulesEngine');

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

  // ── Category 2: Conventional crops / glyphosate_heavy ──
  test('flags "wheat flour" as glyphosate_heavy / reject', () => {
    const flag = flagsFor(result, 'glyphosate_heavy').find(
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
  test('verdict is GREEN (gluten_grains fires but is excluded from verdict; paywall feature)', () => {
    expect(result.verdict).toBe('green');
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

  // ── Hard rejects remaining (natural flavors + wheat flour) ──
  // "wheat flour" moved to GLYPHOSATE_HEAVY which is NOT cleared by non-gmo cert
  // (only by usda-organic or organic prefix), so it remains a reject here.
  test('exactly two hard rejects: "natural flavors" (natural_flavors) and "wheat flour" (glyphosate_heavy)', () => {
    const rejectFlags = result.flags.filter(f => f.severity === 'reject');
    expect(rejectFlags).toHaveLength(2);
    const categories = rejectFlags.map(f => f.category);
    const ingredients = rejectFlags.map(f => f.matchedIngredient);
    expect(categories).toContain('natural_flavors');
    expect(categories).toContain('glyphosate_heavy');
    expect(ingredients).toContain('natural flavors');
    expect(ingredients).toContain('wheat flour');
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
    // scope to conventional_crops only — GLUTEN_GRAINS intentionally double-fires
    const syrupFlags = flagsFor(result, 'conventional_crops').filter(
      f => f.matchedIngredient === 'corn syrup' ||
           f.matchedIngredient === 'high fructose corn syrup'
    );
    expect(syrupFlags).toHaveLength(1);
    expect(syrupFlags[0].matchedIngredient).toBe('high fructose corn syrup');
  });

  test('"modified food starch" flags via GLUTEN_GRAINS (not conventional_crops)', () => {
    // "modified food starch" moved to GLUTEN_GRAINS in the Sina expansion.
    // conventional_crops has bare "modified starch" which is NOT a substring of
    // "modified food starch" (different word order) — so no conventional_crops hit.
    const result = analyzeIngredients('modified food starch', []);
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
    const glutenFlags = flagsFor(result, 'gluten_grains').filter(
      f => f.matchedIngredient === 'modified food starch'
    );
    expect(glutenFlags).toHaveLength(1);
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
    // corn fires gluten_grains, but gluten_grains is excluded from verdict → GREEN
    expect(result.verdict).toBe('green');
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
    // scope to conventional_crops only — GLUTEN_GRAINS intentionally double-fires
    const flags = flagsFor(result, 'conventional_crops').filter(
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
    // scope to conventional_crops only — GLUTEN_GRAINS intentionally double-fires on 'fructose'
    const flags = flagsFor(result, 'conventional_crops').filter(
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

  // ── Wheat derivatives (GLYPHOSATE_HEAVY — moved from CONVENTIONAL_CROPS) ──

  test('"enriched flour" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('enriched flour, water, salt', []);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'enriched flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"organic enriched flour" is cleared by the organic prefix (no glyphosate_heavy flag)', () => {
    const result = analyzeIngredients('organic enriched flour, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'enriched flour')).toBeUndefined();
  });

  test('"bleached flour" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('bleached flour, salt', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'bleached flour')).toBeDefined();
  });

  test('"unbleached flour" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('unbleached flour, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'unbleached flour')).toBeDefined();
  });

  test('"all purpose flour" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('all purpose flour, salt', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'all purpose flour')).toBeDefined();
  });

  test('"bread flour" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('bread flour, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'bread flour')).toBeDefined();
  });

  test('"durum wheat" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('durum wheat, salt', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'durum wheat')).toBeDefined();
  });

  test('"semolina" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('semolina, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'semolina')).toBeDefined();
  });

  test('"spelt" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('spelt flour, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'spelt')).toBeDefined();
  });

  test('"wheat bran" is flagged as glyphosate_heavy / reject (via bare "wheat" trigger)', () => {
    // "wheat bran" is not a standalone trigger; bare "wheat" (in GLYPHOSATE_HEAVY) matches
    const result = analyzeIngredients('wheat bran, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'wheat')).toBeDefined();
  });

  test('"wheat germ" is flagged as glyphosate_heavy / reject (via bare "wheat" trigger)', () => {
    // "wheat germ" is not a standalone trigger; bare "wheat" (in GLYPHOSATE_HEAVY) matches
    const result = analyzeIngredients('wheat germ, oil', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'wheat')).toBeDefined();
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

  // ── Oat derivatives (GLYPHOSATE_HEAVY — moved from CONVENTIONAL_CROPS) ──

  test('"oat starch" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('oat starch, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'oat starch')).toBeDefined();
  });

  test('"oat extract" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('oat extract, salt', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'oat extract')).toBeDefined();
  });

  test('"oat syrup" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('oat syrup, water', []);
    expect(flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'oat syrup')).toBeDefined();
  });

  test('"oat bran" is flagged as glyphosate_heavy / reject', () => {
    const result = analyzeIngredients('oat bran, salt', []);
    expect(flagsFor(result, 'glyphosate_heavy')
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

  test('"palm fruit oil" is flagged as seed_oils / reject', () => {
    // "palm oil" does not appear as a consecutive substring inside "palm fruit oil"
    // (the word "fruit" breaks the match). This entry must be an explicit trigger.
    const result = analyzeIngredients('rice, palm fruit oil, salt', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'palm fruit oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"organic palm fruit oil" still flags — seed oils have no organic clearance', () => {
    // Cat 1 (seed oils) has no isPrecededByOrganic() guard by design:
    // even organic refined oils disrupt omega-6/3 balance. Consistent with
    // "Cat 1 seed oils are NOT cleared by per-ingredient organic prefix" tests above.
    const result = analyzeIngredients('organic palm fruit oil, water', []);
    expect(flagsFor(result, 'seed_oils').length).toBeGreaterThanOrEqual(1);
    expect(result.verdict).toBe('red');
  });

  test('"palm oil" still fires — regression check', () => {
    const result = analyzeIngredients('palm oil, water', []);
    const flag = flagsFor(result, 'seed_oils')
      .find(f => f.matchedIngredient === 'palm oil');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
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
    // 6 words — looks like a chemical INCI name; no known trigger is a substring.
    // Updated phrase avoids FORTIFIED_VITAMINS triggers (zinc gluconate was in prior phrase).
    const r = analyzeIngredients('water, modified bamboo extract cellulose blend compound, salt', [], 1);
    expect(r.unverifiedIngredients.map(t => t.toLowerCase()))
      .toContain('modified bamboo extract cellulose blend compound');
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

  test('"enriched long grain white rice" — green at Level 1 (only gluten_grains fires, excluded from verdict)', () => {
    const result = analyzeIngredients('water, enriched long grain white rice, salt', [], 1);
    expect(result.verdict).toBe('green');
  });

  test('"enriched long grain white rice" — green at Level 2 (not in CONVENTIONAL_CROPS; gluten_grains excluded from verdict)', () => {
    // enriched long grain white rice is not in the updated CONVENTIONAL_CROPS or GLYPHOSATE_HEAVY.
    // GLUTEN_GRAINS matches "rice" → flag fires but excluded from verdict calculation.
    const result = analyzeIngredients('water, enriched long grain white rice, salt', [], 2);
    expect(flagsFor(result, 'conventional_crops')).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('"enriched long grain white rice" — GLUTEN_GRAINS rice caution fires', () => {
    const result = analyzeIngredients('enriched long grain white rice', [], 2);
    expect(flagsFor(result, 'gluten_grains').length).toBeGreaterThan(0);
  });

  test('"enriched macaroni product" — yellow at Level 1', () => {
    const result = analyzeIngredients('water, enriched macaroni product, salt', [], 1);
    expect(result.verdict).toBe('yellow');
  });

  test('"enriched macaroni product" — red at Level 2 (now in GLYPHOSATE_HEAVY)', () => {
    const result = analyzeIngredients('water, enriched macaroni product, salt', [], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'enriched macaroni product');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"enriched macaroni product" cleared by usda-organic label (GLYPHOSATE_HEAVY; non-gmo does not clear)', () => {
    // non-gmo does NOT clear GLYPHOSATE_HEAVY — only usda-organic or organic prefix
    const result = analyzeIngredients(
      'enriched macaroni product, salt', ['usda-organic'], 2
    );
    expect(flagsFor(result, 'glyphosate_heavy')
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

  test('"antioxidant" standalone does NOT trigger an additives flag (generic descriptor, not a synthetic additive)', () => {
    expect(analyzeIngredients('water, antioxidant, salt', [], 2).flags
      .filter(f => f.category === 'additives')).toHaveLength(0);
  });
  test('"mixed tocopherols (antioxidant)" does NOT trigger an additives flag', () => {
    expect(analyzeIngredients('sunflower oil, mixed tocopherols (antioxidant)', [], 2).flags
      .filter(f => f.category === 'additives')).toHaveLength(0);
  });
  test('BHA still triggers an additives flag (regression)', () => {
    const flags = analyzeIngredients('water, BHA, salt', [], 2).flags;
    expect(flags.some(f => f.category === 'additives' && f.matchedIngredient === 'bha')).toBe(true);
  });
  test('BHT still triggers an additives flag (regression)', () => {
    const flags = analyzeIngredients('water, BHT, salt', [], 2).flags;
    expect(flags.some(f => f.category === 'additives' && f.matchedIngredient === 'bht')).toBe(true);
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

  test('"ferrous sulfate" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, ferrous sulfate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'ferrous sulfate')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  // ── Regression: core synthetic additives still fire ───────────────────────

  test('"sodium benzoate" still triggers an additives flag (regression)', () => {
    const result = analyzeIngredients('water, sodium benzoate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'sodium benzoate')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"bht" still triggers an additives flag (regression)', () => {
    const result = analyzeIngredients('water, BHT, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'bht')).toBeDefined();
    expect(result.verdict).toBe('red');
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

  // ── GLYPHOSATE_HEAVY: malt syrup ─────────────────────────────────────────

  test('"malt syrup" — yellow at Level 1', () => {
    expect(analyzeIngredients('malt syrup, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt syrup" — red at Level 2', () => {
    const result = analyzeIngredients('malt syrup, salt', [], 2);
    const flag = flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt syrup');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"malt syrup" cleared by usda-organic label', () => {
    const result = analyzeIngredients('malt syrup, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt syrup')).toBeUndefined();
  });

  test('"organic malt syrup" cleared by organic prefix', () => {
    const result = analyzeIngredients('organic malt syrup, salt', [], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt syrup')).toBeUndefined();
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

  // ── Fortification ingredients — moved to FORTIFIED_VITAMINS, no longer additives ────

  test('"folic acid" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, folic acid, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'folic acid')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"niacin" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, niacin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'niacin')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"niacinamide" does NOT trigger an additives flag (now in CONVENTIONAL_CROPS, not SYNTHETIC_ADDITIVES)', () => {
    const result = analyzeIngredients('water, niacinamide, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'niacinamide')).toBeUndefined();
    // niacinamide is a corn fermentation derivative — now flagged as conventional_crops / reject
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'niacinamide')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"potassium phosphate" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, potassium phosphate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'potassium phosphate')).toBeUndefined();
    expect(result.verdict).toBe('green');
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

  // ── Fortification ingredients — moved to FORTIFIED_VITAMINS, no longer additives ──

  test('"thiamin mononitrate" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, thiamin mononitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamin mononitrate')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"thiamine mononitrate" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, thiamine mononitrate, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamine mononitrate')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"thiamin mononitrite" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, thiamin mononitrite, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'thiamin mononitrite')).toBeUndefined();
    expect(result.verdict).toBe('green');
  });

  test('"riboflavin" does NOT trigger an additives flag (now in CONVENTIONAL_CROPS, not SYNTHETIC_ADDITIVES)', () => {
    const result = analyzeIngredients('water, riboflavin, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'riboflavin')).toBeUndefined();
    // riboflavin is a corn fermentation derivative — now flagged as conventional_crops / reject
    expect(flagsFor(result, 'conventional_crops').find(f => f.matchedIngredient === 'riboflavin')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"reduced iron" does NOT trigger an additives flag (moved to FORTIFIED_VITAMINS)', () => {
    const result = analyzeIngredients('water, reduced iron, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'reduced iron')).toBeUndefined();
    expect(result.verdict).toBe('green');
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

  // ── GLYPHOSATE_HEAVY: malt extract, malt flavor ──────────────────────────

  test('"malt extract" (GLYPHOSATE_HEAVY) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, malt extract, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt extract" (GLYPHOSATE_HEAVY) — red at Level 2', () => {
    const result = analyzeIngredients('water, malt extract, salt', [], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt extract')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"malt extract" cleared by usda-organic label', () => {
    const result = analyzeIngredients('water, malt extract, salt', ['usda-organic'], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt extract')).toBeUndefined();
  });

  test('"malt flavor" (GLYPHOSATE_HEAVY) — yellow at Level 1', () => {
    expect(analyzeIngredients('water, malt flavor, salt', [], 1).verdict).toBe('yellow');
  });

  test('"malt flavor" (GLYPHOSATE_HEAVY) — red at Level 2', () => {
    const result = analyzeIngredients('water, malt flavor, salt', [], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt flavor')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"malt flavor" cleared by organic prefix', () => {
    const result = analyzeIngredients('water, organic malt flavor, salt', [], 2);
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt flavor')).toBeUndefined();
  });

  // ── GLUTEN_GRAINS: malt flavor ────────────────────────────────────────────

  test('"malt flavor" (GLUTEN_GRAINS) — caution flag present at Level 2', () => {
    const result = analyzeIngredients('water, malt flavor, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'malt flavor');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('"malt flavor" gluten flag fires even when glyphosate_heavy is cleared by usda-organic', () => {
    const result = analyzeIngredients('water, malt flavor, salt', ['usda-organic'], 2);
    // glyphosate_heavy is cleared by organic; conventional_crops never had malt flavor
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'malt flavor')).toBeUndefined();
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

describe('22 — Processing methods: mechanically separated [species]', () => {

  // The trigger is now the bare, species-agnostic 'mechanically separated'
  // (see the SYNTHETIC_ADDITIVES entry) — real labels never print the
  // literal word "meat" here, they name the species (chicken/turkey/pork/
  // beef). matchedIngredient now reports the bare trigger text itself,
  // 'mechanically separated', regardless of which species follows it.

  test('"mechanically separated meat" — red at Level 1 (regression: original literal phrase still matches)', () => {
    const result = analyzeIngredients('mechanically separated meat, water, salt', [], 1);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"mechanically separated meat" — red at Level 2 (regression: original literal phrase still matches)', () => {
    const result = analyzeIngredients('mechanically separated meat, water, salt', [], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"mechanically separated meat" is NOT cleared by usda-organic label (Cat 4 — no clearance)', () => {
    const result = analyzeIngredients('mechanically separated meat, water', ['usda-organic'], 2);
    expect(flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test.each([
    ['chicken', 'MECHANICALLY SEPARATED CHICKEN, PORK, WATER, CORN SYRUP.'],
    ['pork', 'mechanically separated pork, water, salt.'],
    ['turkey', 'mechanically separated turkey, water, salt.'],
    ['beef', 'mechanically separated beef, water, salt.'],
  ])('"mechanically separated %s" — real-world species-named label flags additives (reject)', (species, text) => {
    const result = analyzeIngredients(text, [], 2);
    const flag = flagsFor(result, 'additives').find(f => f.matchedIngredient === 'mechanically separated');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('real-world mixed-species label ("mechanically separated chicken, water, pork, ...") flags exactly once, not once per species word', () => {
    const result = analyzeIngredients('mechanically separated chicken, water, pork, dextrose, salt.', [], 2);
    const additivesFlags = flagsFor(result, 'additives').filter(f => f.matchedIngredient === 'mechanically separated');
    expect(additivesFlags).toHaveLength(1);
  });

  test('"MECHANICALLY SEPARATED CHICKEN" no longer appears in unverifiedIngredients (previously a literal-phrase-match gap)', () => {
    const result = analyzeIngredients('MECHANICALLY SEPARATED CHICKEN, PORK, WATER, CORN SYRUP.', [], 2);
    expect(result.unverifiedIngredients.some(t => /mechanically separated/i.test(t))).toBe(false);
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

  test('"triticale" — gluten_grains caution + glyphosate_heavy reject at Level 2 → red', () => {
    // triticale is in both GLUTEN_GRAINS (caution) and GLYPHOSATE_HEAVY (reject at L2)
    const result = analyzeIngredients('water, triticale, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticale')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'triticale')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"einkorn" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, einkorn, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'einkorn')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"einkorn" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, einkorn, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'einkorn')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"emmer" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, emmer, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'emmer')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"emmer" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, emmer, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'emmer')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  // ── Botanical names ────────────────────────────────────────────────────────

  test('"triticum vulgare" (common wheat) — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, triticum vulgare, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticum vulgare')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"triticum vulgare" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, triticum vulgare, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'triticum vulgare')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"hordeum vulgare" (barley) — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, hordeum vulgare, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hordeum vulgare')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"hordeum vulgare" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, hordeum vulgare, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hordeum vulgare')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"secale cereale" (rye) — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, secale cereale, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'secale cereale')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"secale cereale" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, secale cereale, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'secale cereale')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"avena sativa" (oats) — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, avena sativa, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'avena sativa')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"avena sativa" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, avena sativa, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'avena sativa')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  // ── Barley-derived sweetener ──────────────────────────────────────────────

  test('"dextrimaltose" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, dextrimaltose, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'dextrimaltose')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"dextrimaltose" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, dextrimaltose, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'dextrimaltose')).toBeDefined();
    expect(result.verdict).toBe('green');
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

  test('"asafoetida" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, asafoetida, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'asafoetida')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"asafoetida" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, asafoetida, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'asafoetida')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"hing" (asafoetida synonym) — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, hing, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hing')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"hing" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, hing, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hing')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  // ── Cross-sensitivity risk grains ─────────────────────────────────────────

  test('"teff" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, teff, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'teff')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"teff" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, teff, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'teff')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"teff flour" ingredient text fires a gluten_grains flag (teff substring match)', () => {
    const result = analyzeIngredients('water, teff flour, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(
      f => f.matchedIngredient === 'teff flour' || f.matchedIngredient === 'teff'
    );
    expect(flag).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"sorghum" — gluten_grains flag fires at Level 1, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, sorghum, salt', [], 1);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'sorghum')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"sorghum" — gluten_grains flag fires at Level 2, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, sorghum, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'sorghum')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"sorghum syrup" fires a gluten_grains flag via the sorghum substring match', () => {
    const result = analyzeIngredients('water, sorghum syrup, salt', [], 2);
    const flag = flagsFor(result, 'gluten_grains').find(
      f => f.matchedIngredient === 'sorghum' || f.matchedIngredient === 'sorghum flour'
    );
    expect(flag).toBeDefined();
    expect(result.verdict).toBe('green');
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

// ─────────────────────────────────────────────────────────────────────────────
// Block 27 — I: Sina gluten expansion: new GLUTEN_GRAINS entries
// ─────────────────────────────────────────────────────────────────────────────
describe('I — Sina gluten expansion: new GLUTEN_GRAINS entries', () => {

  // ── Corn derivatives ──────────────────────────────────────────────────────

  test('"high fructose corn syrup" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, high fructose corn syrup, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'high fructose corn syrup')).toBeDefined();
  });

  test('"dextrose" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, dextrose, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'dextrose')).toBeDefined();
  });

  test('"corn syrup" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, corn syrup, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'corn syrup')).toBeDefined();
  });

  test('"hydrolyzed corn protein" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, hydrolyzed corn protein, salt', [], 2);
    // also in SYNTHETIC_ADDITIVES → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hydrolyzed corn protein')).toBeDefined();
  });

  test('"xanthan gum" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, xanthan gum, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'xanthan gum')).toBeDefined();
  });

  test('"maltodextrin" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, maltodextrin, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'maltodextrin')).toBeDefined();
  });

  // ── Wheat flour varieties ─────────────────────────────────────────────────

  test('"bread flour" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, bread flour, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'bread flour')).toBeDefined();
  });

  test('"whole wheat flour" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, whole wheat flour, salt', [], 2);
    // also in CONVENTIONAL_CROPS (wheat flour) → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'whole wheat flour')).toBeDefined();
  });

  test('"self-rising flour" — gluten_grains flag fires, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, self-rising flour, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'self-rising flour')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"tipo 00 flour" — gluten_grains flag fires, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, tipo 00 flour, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'tipo 00 flour')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  // ── Barley varieties ──────────────────────────────────────────────────────

  test('"pearl barley" — gluten_grains caution + glyphosate_heavy reject → red', () => {
    // pearl barley is in both GLUTEN_GRAINS (caution) and GLYPHOSATE_HEAVY (reject at L2)
    const result = analyzeIngredients('water, pearl barley, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'pearl barley')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'pearl barley')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"barley flour" — gluten_grains caution + glyphosate_heavy reject → red', () => {
    // barley flour is in both GLUTEN_GRAINS (caution) and GLYPHOSATE_HEAVY (reject at L2)
    const result = analyzeIngredients('water, barley flour, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'barley flour')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'barley flour')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Rye varieties ─────────────────────────────────────────────────────────

  test('"pumpernickel" — gluten_grains caution + glyphosate_heavy reject → red', () => {
    // pumpernickel is in both GLUTEN_GRAINS (caution) and GLYPHOSATE_HEAVY (reject at L2)
    const result = analyzeIngredients('water, pumpernickel, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'pumpernickel')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'pumpernickel')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"cereal rye" — gluten_grains caution + glyphosate_heavy reject (via bare "rye") → red', () => {
    // GLYPHOSATE_HEAVY matches bare "rye" at position 7 in "cereal rye" → reject at L2
    const result = analyzeIngredients('water, cereal rye, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'cereal rye')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').find(f => f.matchedIngredient === 'rye')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  // ── Oat varieties ─────────────────────────────────────────────────────────

  test('"steel-cut oats" — gluten_grains caution + glyphosate_heavy reject (via "oats") → red', () => {
    // GLYPHOSATE_HEAVY matches "oats" inside "steel-cut oats" → reject at L2
    const result = analyzeIngredients('water, steel-cut oats, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'steel-cut oats')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').length).toBeGreaterThan(0);
    expect(result.verdict).toBe('red');
  });

  test('"oat groats" — gluten_grains caution + glyphosate_heavy reject (via "oats") → red', () => {
    // GLYPHOSATE_HEAVY matches "oats" inside "oat groats" → reject at L2
    const result = analyzeIngredients('water, oat groats, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'oat groats')).toBeDefined();
    expect(flagsFor(result, 'glyphosate_heavy').length).toBeGreaterThan(0);
    expect(result.verdict).toBe('red');
  });

  // ── Processed / ambiguous grain-based ingredients ─────────────────────────

  test('"modified food starch" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, modified food starch, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'modified food starch')).toBeDefined();
  });

  test('"soy sauce" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, soy sauce, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'soy sauce')).toBeDefined();
  });

  test('"textured vegetable protein" — gluten_grains caution', () => {
    const result = analyzeIngredients('water, textured vegetable protein, salt', [], 2);
    // also in CONVENTIONAL_CROPS → verdict will be 'red'; do not assert verdict
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'textured vegetable protein')).toBeDefined();
  });

  test('"hydrolyzed vegetable protein" — gluten_grains caution + conventional_crops reject → red', () => {
    // also in CONVENTIONAL_CROPS → verdict will be 'red'
    const result = analyzeIngredients('water, hydrolyzed vegetable protein, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'hydrolyzed vegetable protein')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

  test('"pregelatinized starch" — gluten_grains flag fires, verdict green (excluded from verdict)', () => {
    const result = analyzeIngredients('water, pregelatinized starch, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'pregelatinized starch')).toBeDefined();
    expect(result.verdict).toBe('green');
  });

  test('"miso" — gluten_grains caution + conventional_crops reject → red', () => {
    // miso is also in CONVENTIONAL_CROPS (soy extract) → verdict will be 'red'
    const result = analyzeIngredients('water, miso, salt', [], 2);
    expect(flagsFor(result, 'gluten_grains').find(f => f.matchedIngredient === 'miso')).toBeDefined();
    expect(result.verdict).toBe('red');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Block 28 — containsFortifiedVitamins helper
// ─────────────────────────────────────────────────────────────────────────────
describe('28 — containsFortifiedVitamins: detects synthetic vitamin fortification', () => {

  // ── Each ingredient is detected ──────────────────────────────────────────

  test('"riboflavin" is detected', () => {
    expect(containsFortifiedVitamins('enriched flour, riboflavin, iron')).toBe(true);
  });

  test('"thiamine mononitrate" is detected', () => {
    expect(containsFortifiedVitamins('enriched flour, thiamine mononitrate, riboflavin')).toBe(true);
  });

  test('"niacinamide" is detected', () => {
    expect(containsFortifiedVitamins('water, niacinamide, salt')).toBe(true);
  });

  test('"folic acid" is detected', () => {
    expect(containsFortifiedVitamins('enriched wheat flour, folic acid')).toBe(true);
  });

  test('"vitamin d3" is detected', () => {
    expect(containsFortifiedVitamins('skim milk, vitamin d3, calcium')).toBe(true);
  });

  test('"cyanocobalamin" is detected', () => {
    expect(containsFortifiedVitamins('water, cyanocobalamin, salt')).toBe(true);
  });

  test('"ferrous sulfate" is detected', () => {
    expect(containsFortifiedVitamins('enriched flour, ferrous sulfate, niacin')).toBe(true);
  });

  test('"zinc oxide" is detected', () => {
    expect(containsFortifiedVitamins('cereal, zinc oxide, iron')).toBe(true);
  });

  // ── Clean list returns false ──────────────────────────────────────────────

  test('clean ingredient list returns false', () => {
    expect(containsFortifiedVitamins('organic oats, honey, sea salt')).toBe(false);
  });

  // ── Case-insensitive matching ─────────────────────────────────────────────

  test('"Riboflavin" (title case) matches', () => {
    expect(containsFortifiedVitamins('Enriched Flour, Riboflavin, Iron')).toBe(true);
  });

  test('"FOLIC ACID" (all caps) matches', () => {
    expect(containsFortifiedVitamins('WHEAT FLOUR, FOLIC ACID, NIACIN')).toBe(true);
  });

  // ── Partial / substring match ─────────────────────────────────────────────

  test('"contains riboflavin" substring matches', () => {
    expect(containsFortifiedVitamins('enriched flour (contains riboflavin)')).toBe(true);
  });

  test('"added thiamine mononitrate" substring matches', () => {
    expect(containsFortifiedVitamins('flour, added thiamine mononitrate, yeast')).toBe(true);
  });

  // ── New entries from expanded FORTIFIED_VITAMINS array ───────────────────

  // B vitamins
  test('"thiamin mononitrate" is detected', () => {
    expect(containsFortifiedVitamins('enriched flour, thiamin mononitrate, salt')).toBe(true);
  });

  test('"thiamin mononitrite" (typo variant) is detected', () => {
    expect(containsFortifiedVitamins('water, thiamin mononitrite, salt')).toBe(true);
  });

  test('"niacin" is detected', () => {
    expect(containsFortifiedVitamins('enriched wheat flour, niacin, iron')).toBe(true);
  });

  test('"pyridoxine hydrochloride" is detected', () => {
    expect(containsFortifiedVitamins('cereal, pyridoxine hydrochloride, salt')).toBe(true);
  });

  test('"vitamin b6" is detected', () => {
    expect(containsFortifiedVitamins('water, vitamin b6, salt')).toBe(true);
  });

  test('"vitamin b12" is detected', () => {
    expect(containsFortifiedVitamins('milk, vitamin b12, salt')).toBe(true);
  });

  test('"cobalamin" is detected', () => {
    expect(containsFortifiedVitamins('water, cobalamin, salt')).toBe(true);
  });

  test('"pantothenic acid" is detected', () => {
    expect(containsFortifiedVitamins('cereal, pantothenic acid, niacin')).toBe(true);
  });

  test('"calcium pantothenate" is detected', () => {
    expect(containsFortifiedVitamins('water, calcium pantothenate, salt')).toBe(true);
  });

  test('"biotin" is detected', () => {
    expect(containsFortifiedVitamins('cereal, biotin, salt')).toBe(true);
  });

  test('"choline chloride" is detected', () => {
    expect(containsFortifiedVitamins('infant formula, choline chloride, salt')).toBe(true);
  });

  test('"choline bitartrate" is detected', () => {
    expect(containsFortifiedVitamins('water, choline bitartrate, salt')).toBe(true);
  });

  test('"inositol" is detected', () => {
    expect(containsFortifiedVitamins('infant formula, inositol, salt')).toBe(true);
  });

  // Fat-soluble vitamins
  test('"vitamin a palmitate" is detected', () => {
    expect(containsFortifiedVitamins('skim milk, vitamin a palmitate, salt')).toBe(true);
  });

  test('"vitamin a acetate" is detected', () => {
    expect(containsFortifiedVitamins('water, vitamin a acetate, salt')).toBe(true);
  });

  test('"vitamin a" (bare form) is detected', () => {
    expect(containsFortifiedVitamins('cereal, vitamin a, iron')).toBe(true);
  });

  test('"vitamin d2" is detected', () => {
    expect(containsFortifiedVitamins('milk, vitamin d2, salt')).toBe(true);
  });

  test('"dl-alpha-tocopherol" is detected', () => {
    expect(containsFortifiedVitamins('oil, dl-alpha-tocopherol, salt')).toBe(true);
  });

  test('"d-alpha-tocopherol" is detected', () => {
    expect(containsFortifiedVitamins('oil, d-alpha-tocopherol, salt')).toBe(true);
  });

  test('"mixed tocopherols" is detected', () => {
    expect(containsFortifiedVitamins('sunflower oil, mixed tocopherols, salt')).toBe(true);
  });

  test('"vitamin e" is detected', () => {
    expect(containsFortifiedVitamins('cereal, vitamin e, iron')).toBe(true);
  });

  test('"phytonadione" is detected', () => {
    expect(containsFortifiedVitamins('water, phytonadione, salt')).toBe(true);
  });

  test('"menaquinone" is detected', () => {
    expect(containsFortifiedVitamins('water, menaquinone, salt')).toBe(true);
  });

  test('"vitamin k" is detected', () => {
    expect(containsFortifiedVitamins('cereal, vitamin k, iron')).toBe(true);
  });

  // Iron and minerals
  test('"reduced iron" is detected', () => {
    expect(containsFortifiedVitamins('enriched flour, reduced iron, niacin')).toBe(true);
  });

  test('"zinc gluconate" is detected', () => {
    expect(containsFortifiedVitamins('cereal, zinc gluconate, iron')).toBe(true);
  });

  test('"zinc sulfate" is detected', () => {
    expect(containsFortifiedVitamins('water, zinc sulfate, salt')).toBe(true);
  });

  test('"calcium carbonate" is detected', () => {
    expect(containsFortifiedVitamins('cereal, calcium carbonate, iron')).toBe(true);
  });

  test('"calcium phosphate" is detected', () => {
    expect(containsFortifiedVitamins('water, calcium phosphate, salt')).toBe(true);
  });

  test('"calcium citrate" is detected', () => {
    expect(containsFortifiedVitamins('water, calcium citrate, salt')).toBe(true);
  });

  test('"magnesium oxide" is detected', () => {
    expect(containsFortifiedVitamins('cereal, magnesium oxide, iron')).toBe(true);
  });

  test('"magnesium citrate" is detected', () => {
    expect(containsFortifiedVitamins('water, magnesium citrate, salt')).toBe(true);
  });

  test('"potassium iodide" is detected', () => {
    expect(containsFortifiedVitamins('salt, potassium iodide')).toBe(true);
  });

  test('"potassium phosphate" is detected', () => {
    expect(containsFortifiedVitamins('water, potassium phosphate, salt')).toBe(true);
  });

  test('"sodium iodide" is detected', () => {
    expect(containsFortifiedVitamins('salt, sodium iodide')).toBe(true);
  });

  test('"copper gluconate" is detected', () => {
    expect(containsFortifiedVitamins('cereal, copper gluconate, iron')).toBe(true);
  });

  test('"copper sulfate" is detected', () => {
    expect(containsFortifiedVitamins('water, copper sulfate, salt')).toBe(true);
  });

  test('"manganese sulfate" is detected', () => {
    expect(containsFortifiedVitamins('cereal, manganese sulfate, iron')).toBe(true);
  });

  test('"chromium picolinate" is detected', () => {
    expect(containsFortifiedVitamins('water, chromium picolinate, salt')).toBe(true);
  });

  test('"selenium yeast" is detected', () => {
    expect(containsFortifiedVitamins('cereal, selenium yeast, iron')).toBe(true);
  });

  test('"sodium selenite" is detected', () => {
    expect(containsFortifiedVitamins('water, sodium selenite, salt')).toBe(true);
  });

  test('"sodium selenate" is detected', () => {
    expect(containsFortifiedVitamins('water, sodium selenate, salt')).toBe(true);
  });

  test('"molybdenum" is detected', () => {
    expect(containsFortifiedVitamins('cereal, molybdenum, iron')).toBe(true);
  });

  // Amino acids and conditionally essential nutrients
  test('"taurine" is detected', () => {
    expect(containsFortifiedVitamins('infant formula, taurine, choline chloride')).toBe(true);
  });

  test('"l-carnitine" is detected', () => {
    expect(containsFortifiedVitamins('infant formula, l-carnitine, taurine')).toBe(true);
  });

  test('"l-tryptophan" is detected', () => {
    expect(containsFortifiedVitamins('water, l-tryptophan, salt')).toBe(true);
  });

  test('"l-theanine" is detected', () => {
    expect(containsFortifiedVitamins('water, l-theanine, salt')).toBe(true);
  });

  test('"lysine" is detected', () => {
    expect(containsFortifiedVitamins('cereal, lysine, niacin')).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Block 29 — containsNaturalColorants helper
// ─────────────────────────────────────────────────────────────────────────────
describe('29 — containsNaturalColorants: detects plant-derived colorants', () => {

  // ── Each ingredient is detected ──────────────────────────────────────────

  test('"annatto" is detected', () => {
    expect(containsNaturalColorants('cheddar cheese, annatto, salt')).toBe(true);
  });

  test('"annatto extract" is detected', () => {
    expect(containsNaturalColorants('butter, annatto extract, cream')).toBe(true);
  });

  test('"beet juice" is detected', () => {
    expect(containsNaturalColorants('water, beet juice, citric acid')).toBe(true);
  });

  test('"beet juice concentrate" is detected', () => {
    expect(containsNaturalColorants('yogurt, beet juice concentrate, sugar')).toBe(true);
  });

  test('"turmeric extract" is detected', () => {
    expect(containsNaturalColorants('mustard, turmeric extract, vinegar')).toBe(true);
  });

  test('"paprika extract" is detected', () => {
    expect(containsNaturalColorants('chips, paprika extract, sunflower oil')).toBe(true);
  });

  test('"beta-carotene" is detected', () => {
    expect(containsNaturalColorants('margarine, beta-carotene, palm oil')).toBe(true);
  });

  // ── Clean list returns false ──────────────────────────────────────────────

  test('clean ingredient list returns false', () => {
    expect(containsNaturalColorants('organic oats, honey, sea salt')).toBe(false);
  });

  // ── Case-insensitive matching ─────────────────────────────────────────────

  test('"Annatto" (title case) matches', () => {
    expect(containsNaturalColorants('Cheddar Cheese, Annatto, Salt')).toBe(true);
  });

  test('"BETA-CAROTENE" (all caps) matches', () => {
    expect(containsNaturalColorants('MARGARINE, BETA-CAROTENE, PALM OIL')).toBe(true);
  });

  // ── Partial / substring match ─────────────────────────────────────────────

  test('"color from annatto" substring matches', () => {
    expect(containsNaturalColorants('cheese (color from annatto)')).toBe(true);
  });

  test('"colored with turmeric extract" substring matches', () => {
    expect(containsNaturalColorants('mustard, colored with turmeric extract')).toBe(true);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// 30 — gmo trigger guard: non-gmo and gmo-free contexts must not flag bioengineering
// ════════════════════════════════════════════════════════════════════════════

describe('30 — gmo trigger guard: non-gmo and gmo-free false positive prevention', () => {
  // ── Should NOT flag bioengineering ────────────────────────────────────────

  test('real-world case: "organic non-gmo popcorn" does not flag bioengineering', () => {
    const { flags } = analyzeIngredients(
      'organic non-gmo popcorn, organic coconut oil, himalayan salt', [], 2
    );
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"non-gmo corn starch, sea salt" does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('non-gmo corn starch, sea salt', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"non gmo soybean oil" (space separator) does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('non gmo soybean oil', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"gmo-free verified ingredients" does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('gmo-free verified ingredients', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"gmo free product" (space separator) does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('gmo free product', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"nongmo project verified ingredients" (no separator) does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('nongmo project verified ingredients', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('"nongmoproject verified" (fully concatenated) does not flag bioengineering', () => {
    const { flags } = analyzeIngredients('nongmoproject verified', [], 2);
    expect(flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  // ── Should STILL flag bioengineering ─────────────────────────────────────

  test('"contains gmo ingredients" (standalone disclosure) flags bioengineering', () => {
    const { flags } = analyzeIngredients('contains gmo ingredients', [], 2);
    const bioFlags = flags.filter(f => f.category === 'bioengineering');
    expect(bioFlags).toHaveLength(1);
    expect(bioFlags[0].matchedIngredient).toBe('gmo');
  });

  test('"bioengineered, contains gmo" flags bioengineering (bioengineered trigger wins)', () => {
    const { flags } = analyzeIngredients('bioengineered, contains gmo', [], 2);
    const bioFlags = flags.filter(f => f.category === 'bioengineering');
    expect(bioFlags).toHaveLength(1);
    expect(bioFlags[0].matchedIngredient).toBe('bioengineered');
  });

  test('"genetically modified corn starch" flags bioengineering (other triggers unaffected)', () => {
    const { flags } = analyzeIngredients('genetically modified corn starch', [], 2);
    const bioFlags = flags.filter(f => f.category === 'bioengineering');
    expect(bioFlags).toHaveLength(1);
    expect(bioFlags[0].matchedIngredient).toBe('genetically modified');
  });
});

describe('31 — isPrecededByOrganic: ingredient-boundary detection for multi-word compound names', () => {
  // ── Should NOT flag conventional_crops ───────────────────────────────────

  test('"organic unrefined coconut sugar" — multi-word organic compound does not flag', () => {
    const { flags } = analyzeIngredients('organic unrefined coconut sugar', [], 2);
    expect(flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  test('full real-world case: "organic cacao, organic unrefined coconut sugar, organic cocoa butter" — no conventional_crops flags', () => {
    const { flags } = analyzeIngredients(
      'organic cacao, organic unrefined coconut sugar, organic cocoa butter', [], 2
    );
    expect(flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  test('reordered: "organic unrefined coconut sugar, organic cocoa butter, organic cacao" — no conventional_crops flags', () => {
    const { flags } = analyzeIngredients(
      'organic unrefined coconut sugar, organic cocoa butter, organic cacao', [], 2
    );
    expect(flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  test('"organic whole grain corn flour" — multi-word with corn trigger does not flag', () => {
    const { flags } = analyzeIngredients('organic whole grain corn flour', [], 2);
    expect(flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  test('"organic coconut sugar" — simple two-word organic compound does not flag', () => {
    const { flags } = analyzeIngredients('organic coconut sugar', [], 2);
    expect(flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  // ── Should STILL flag conventional_crops ─────────────────────────────────

  test('"coconut sugar" — no organic prefix, flags conventional_crops', () => {
    const { flags } = analyzeIngredients('coconut sugar', [], 2);
    expect(flags.filter(f => f.category === 'conventional_crops').length).toBeGreaterThan(0);
  });

  test('"unrefined coconut sugar" — no organic prefix, flags conventional_crops', () => {
    const { flags } = analyzeIngredients('unrefined coconut sugar', [], 2);
    expect(flags.filter(f => f.category === 'conventional_crops').length).toBeGreaterThan(0);
  });

  test('"corn starch, organic coconut sugar" — corn flags, coconut sugar clears', () => {
    const { flags } = analyzeIngredients('corn starch, organic coconut sugar', [], 2);
    const cropFlags = flags.filter(f => f.category === 'conventional_crops');
    expect(cropFlags.length).toBeGreaterThan(0);
    expect(cropFlags.every(f => f.matchedIngredient !== 'coconut sugar')).toBe(true);
  });

  test('"organic coconut sugar, corn starch" — coconut sugar clears, corn flags', () => {
    const { flags } = analyzeIngredients('organic coconut sugar, corn starch', [], 2);
    const cropFlags = flags.filter(f => f.category === 'conventional_crops');
    expect(cropFlags.length).toBeGreaterThan(0);
    expect(cropFlags.every(f => f.matchedIngredient !== 'coconut sugar')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 32. MILK_DERIVED_INGREDIENTS, EGG_DERIVED_INGREDIENTS, ALWAYS_IGNORE_INGREDIENTS
//     Unit tests for the new ingredient-level helper functions and ignore-list
//     constants exported from rulesEngine.js.
// ════════════════════════════════════════════════════════════════════════════

describe('32. containsMilkDerived, containsEggDerived, ALWAYS_IGNORE_INGREDIENTS', () => {
  // ── containsMilkDerived ───────────────────────────────────────────────────

  test('containsMilkDerived: "whole milk" → true', () => {
    expect(containsMilkDerived('whole milk, vitamin d')).toBe(true);
  });

  test('containsMilkDerived: "cheese, salt" → true', () => {
    expect(containsMilkDerived('cheese, salt')).toBe(true);
  });

  test('containsMilkDerived: "whey, milkfat" → true', () => {
    expect(containsMilkDerived('whey, milkfat')).toBe(true);
  });

  test('containsMilkDerived: "yogurt" → true', () => {
    expect(containsMilkDerived('water, yogurt, cultures')).toBe(true);
  });

  test('containsMilkDerived: "casein" → true', () => {
    expect(containsMilkDerived('casein, water')).toBe(true);
  });

  test('containsMilkDerived: "sodium caseinate" → true', () => {
    expect(containsMilkDerived('sodium caseinate, salt')).toBe(true);
  });

  test('containsMilkDerived: "lactose" → true', () => {
    expect(containsMilkDerived('lactose, water')).toBe(true);
  });

  test('containsMilkDerived: "cheesecake" → false (word-boundary guard prevents false positive)', () => {
    expect(containsMilkDerived('cheesecake, sugar, flour')).toBe(false);
  });

  test('containsMilkDerived: "almond milk" → false (bare "milk" is not in MILK_DERIVED_INGREDIENTS)', () => {
    // Only compound forms like "whole milk", "skim milk" etc. are in the list.
    expect(containsMilkDerived('almond milk, water')).toBe(false);
  });

  test('containsMilkDerived: "cream of tartar" → false (bare "cream" is not in MILK_DERIVED_INGREDIENTS)', () => {
    expect(containsMilkDerived('cream of tartar, baking soda')).toBe(false);
  });

  test('containsMilkDerived: "peanut butter" → false (bare "butter" is not in MILK_DERIVED_INGREDIENTS)', () => {
    expect(containsMilkDerived('peanut butter, salt')).toBe(false);
  });

  test('containsMilkDerived: pure empty string → false', () => {
    expect(containsMilkDerived('')).toBe(false);
  });

  // ── containsEggDerived ────────────────────────────────────────────────────

  test('containsEggDerived: "eggs, salt" → true', () => {
    expect(containsEggDerived('eggs, salt')).toBe(true);
  });

  test('containsEggDerived: "whole egg" → true', () => {
    expect(containsEggDerived('flour, whole egg, water')).toBe(true);
  });

  test('containsEggDerived: "egg whites" → true', () => {
    expect(containsEggDerived('egg whites, sugar')).toBe(true);
  });

  test('containsEggDerived: bare "egg" at end of string → true', () => {
    expect(containsEggDerived('water, egg')).toBe(true);
  });

  test('containsEggDerived: "albumin" → true', () => {
    expect(containsEggDerived('water, albumin, salt')).toBe(true);
  });

  test('containsEggDerived: "egg yolk" → true', () => {
    expect(containsEggDerived('egg yolk, lecithin')).toBe(true);
  });

  test('containsEggDerived: "eggplant" → false (word-boundary guard prevents false positive)', () => {
    expect(containsEggDerived('eggplant, olive oil, garlic')).toBe(false);
  });

  test('containsEggDerived: "eggplant, egg" → true (eggplant skipped, bare egg matched)', () => {
    expect(containsEggDerived('eggplant, egg, salt')).toBe(true);
  });

  test('containsEggDerived: pure empty string → false', () => {
    expect(containsEggDerived('')).toBe(false);
  });

  // ── ALWAYS_IGNORE_INGREDIENTS ordering and membership ────────────────────

  test('ALWAYS_IGNORE_INGREDIENTS is an array', () => {
    expect(Array.isArray(ALWAYS_IGNORE_INGREDIENTS)).toBe(true);
  });

  test('ALWAYS_IGNORE_INGREDIENTS includes "salt"', () => {
    expect(ALWAYS_IGNORE_INGREDIENTS).toContain('salt');
  });

  test('ALWAYS_IGNORE_INGREDIENTS includes "water"', () => {
    expect(ALWAYS_IGNORE_INGREDIENTS).toContain('water');
  });

  test('ALWAYS_IGNORE_INGREDIENTS includes "calcium carbonate"', () => {
    expect(ALWAYS_IGNORE_INGREDIENTS).toContain('calcium carbonate');
  });

  test('ALWAYS_IGNORE_INGREDIENTS includes "yeast"', () => {
    expect(ALWAYS_IGNORE_INGREDIENTS).toContain('yeast');
  });

  test('ALWAYS_IGNORE_INGREDIENTS includes "enzymes"', () => {
    expect(ALWAYS_IGNORE_INGREDIENTS).toContain('enzymes');
  });

  test('"himalayan pink salt" appears before "salt" in ALWAYS_IGNORE_INGREDIENTS (longest-first)', () => {
    const hiIdx  = ALWAYS_IGNORE_INGREDIENTS.indexOf('himalayan pink salt');
    const saltIdx = ALWAYS_IGNORE_INGREDIENTS.indexOf('salt');
    expect(hiIdx).toBeGreaterThanOrEqual(0);
    expect(hiIdx).toBeLessThan(saltIdx);
  });

  test('"sea salt" appears before "salt" in ALWAYS_IGNORE_INGREDIENTS', () => {
    const ssIdx  = ALWAYS_IGNORE_INGREDIENTS.indexOf('sea salt');
    const saltIdx = ALWAYS_IGNORE_INGREDIENTS.indexOf('salt');
    expect(ssIdx).toBeGreaterThanOrEqual(0);
    expect(ssIdx).toBeLessThan(saltIdx);
  });

  test('"live active cultures" appears before "cultures" in ALWAYS_IGNORE_INGREDIENTS', () => {
    const lacIdx = ALWAYS_IGNORE_INGREDIENTS.indexOf('live active cultures');
    const cIdx   = ALWAYS_IGNORE_INGREDIENTS.indexOf('cultures');
    expect(lacIdx).toBeGreaterThanOrEqual(0);
    expect(lacIdx).toBeLessThan(cIdx);
  });

  // ── calcium carbonate: raw vs masked behaviour ────────────────────────────
  // This confirms that scan.js MUST mask before calling containsFortifiedVitamins
  // — the raw helper will false-positive on a mined mineral.

  test('containsFortifiedVitamins("calcium carbonate") → true without masking (confirms masking is needed in scan.js)', () => {
    expect(containsFortifiedVitamins('calcium carbonate')).toBe(true);
  });

  // "cultures" alone should not be treated as dairy by containsMilkDerived
  test('containsMilkDerived: "cultures" alone → false (cultures is in ignore list, not in MILK_DERIVED_INGREDIENTS)', () => {
    expect(containsMilkDerived('cultures')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 33. GLYPHOSATE_HEAVY — new category: high-glyphosate-risk crops
//     Tests: L2 detection, L1 caution, glyphosate-free escape hatch,
//            organic full-clearance, and GLYPHOSATE_HEAVY export.
// ════════════════════════════════════════════════════════════════════════════

describe('33. GLYPHOSATE_HEAVY — high-glyphosate-risk crops', () => {
  // ── L2 detection: specific triggers ────────────────────────────────────────

  test('"pea protein" hits glyphosate_heavy / reject at Level 2', () => {
    const result = analyzeIngredients('pea protein, sea salt', [], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'pea protein');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"oat milk" hits glyphosate_heavy / reject at Level 2', () => {
    const result = analyzeIngredients('oat milk, water, sea salt', [], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'oat milk');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"buckwheat" hits glyphosate_heavy / reject at Level 2', () => {
    const result = analyzeIngredients('buckwheat flour, sea salt', [], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'buckwheat flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  // ── CONVENTIONAL_CROPS: these remain in their original category ────────────

  test('"ascorbic acid" hits conventional_crops / reject at Level 2', () => {
    const result = analyzeIngredients('ascorbic acid, water', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'ascorbic acid');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"lecithin" (unspecified) hits conventional_crops / reject at Level 2', () => {
    const result = analyzeIngredients('water, lecithin, salt', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'lecithin');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"potato starch" hits conventional_crops / reject at Level 2', () => {
    const result = analyzeIngredients('potato starch, water', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'potato starch');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  test('"papaya" hits conventional_crops / reject at Level 2', () => {
    const result = analyzeIngredients('papaya, water', [], 2);
    const flag = flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'papaya');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(result.verdict).toBe('red');
  });

  // ── glyphosate-free escape hatch ────────────────────────────────────────────

  test('glyphosate-free cert + oats → Yellow (escape hatch: reject → caution)', () => {
    const result = analyzeIngredients('rolled oats, sea salt', ['glyphosate-free'], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'rolled oats');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
    expect(result.verdict).toBe('yellow');
  });

  test('glyphosate-free cert + wheat → Yellow (escape hatch: reject → caution)', () => {
    const result = analyzeIngredients('wheat flour, water', ['glyphosate-free'], 2);
    const flag = flagsFor(result, 'glyphosate_heavy')
      .find(f => f.matchedIngredient === 'wheat flour');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
    expect(result.verdict).toBe('yellow');
  });

  // ── GLYPHOSATE_HEAVY export ─────────────────────────────────────────────────

  test('GLYPHOSATE_HEAVY is exported and is an array', () => {
    expect(Array.isArray(GLYPHOSATE_HEAVY)).toBe(true);
    expect(GLYPHOSATE_HEAVY.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 34. CONVENTIONAL_CROPS_NO_FLAG — sunflower lecithin range-claim without flag
// ════════════════════════════════════════════════════════════════════════════

describe('34. CONVENTIONAL_CROPS_NO_FLAG — sunflower lecithin', () => {

  test('"sunflower lecithin" produces NO conventional_crops flag', () => {
    const result = analyzeIngredients('sunflower lecithin, water', [], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'sunflower lecithin')).toBeUndefined();
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'lecithin')).toBeUndefined();
  });

  test('"sunflower lecithin" verdict is GREEN (no other flags)', () => {
    expect(analyzeIngredients('sunflower lecithin, water', [], 2).verdict).toBe('green');
  });

  test('bare "lecithin" still fires as conventional_crops (only sunflower form is excluded)', () => {
    const result = analyzeIngredients('lecithin, water', [], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'lecithin')).toBeDefined();
  });

  test('"soy lecithin" still fires as conventional_crops', () => {
    const result = analyzeIngredients('soy lecithin, water', [], 2);
    expect(flagsFor(result, 'conventional_crops')
      .find(f => f.matchedIngredient === 'soy lecithin')).toBeDefined();
  });

  test('"soya lecithin" still fires as additives (PRIORITY_ADDITIVES; not affected by NO_FLAG list)', () => {
    const result = analyzeIngredients('soya lecithin, water', [], 2);
    expect(flagsFor(result, 'additives')
      .find(f => f.matchedIngredient === 'soya lecithin')).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 35. REVIEWED_CLEAN_INGREDIENTS — display-only suppression filter
// ════════════════════════════════════════════════════════════════════════════

describe('35. REVIEWED_CLEAN_INGREDIENTS — display-only suppression filter', () => {

  test('REVIEWED_CLEAN_INGREDIENTS is a Set exported from rulesEngine', () => {
    expect(REVIEWED_CLEAN_INGREDIENTS).toBeInstanceOf(Set);
    expect(REVIEWED_CLEAN_INGREDIENTS.size).toBeGreaterThan(0);
  });

  test('"almond flour" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    // almond flour is not in any trigger list → reaches unverified pass → suppressed by pass 3
    const result = analyzeIngredients('almond flour, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('almond flour');
  });

  test('"arrowroot" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('arrowroot, coconut sugar, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('arrowroot');
  });

  test('an ingredient NOT on the reviewed list still appears in unverifiedIngredients', () => {
    // 'mystery extract' is not a trigger and not in REVIEWED_CLEAN_INGREDIENTS → appears unverified
    const result = analyzeIngredients('mystery extract, sea salt', [], 2);
    expect(result.unverifiedIngredients).toContain('mystery extract');
  });

  test('REVIEWED_CLEAN_INGREDIENTS filter does not affect engine flags or verdict', () => {
    // almond flour clears the unverified filter but generates no flag — engine is untouched
    const result = analyzeIngredients('almond flour, sea salt', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 36. gluten_grains verdict exclusion + seed_oils level behaviour
// ════════════════════════════════════════════════════════════════════════════
describe('36. gluten_grains verdict exclusion and seed_oils level behaviour', () => {

  // ── gluten_grains ─────────────────────────────────────────────────────────

  test('product with only gluten_grains returns green at L1', () => {
    // rice flour fires only gluten_grains; should not inflate verdict
    const result = analyzeIngredients('rice flour, water, sea salt', [], 1);
    expect(result.verdict).toBe('green');
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(true);
  });

  test('product with only gluten_grains returns green at L2', () => {
    const result = analyzeIngredients('rice flour, water, sea salt', [], 2);
    expect(result.verdict).toBe('green');
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(true);
  });

  // ── seed_oils level behaviour ─────────────────────────────────────────────

  test('product with only seed_oils returns yellow at L1', () => {
    const result = analyzeIngredients('canola oil', [], 1);
    expect(result.verdict).toBe('yellow');
    const flag = result.flags.find(f => f.category === 'seed_oils');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('product with only seed_oils returns red at L2', () => {
    const result = analyzeIngredients('canola oil', [], 2);
    expect(result.verdict).toBe('red');
    const flag = result.flags.find(f => f.category === 'seed_oils');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── combined: gluten_grains + seed_oils ───────────────────────────────────

  test('product with gluten_grains + seed_oils returns yellow at L1 (seed_oils drives, gluten ignored)', () => {
    const result = analyzeIngredients('canola oil, rice flour', [], 1);
    expect(result.verdict).toBe('yellow');
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(true);
  });

  test('product with gluten_grains + seed_oils returns red at L2 (seed_oils drives, gluten ignored)', () => {
    const result = analyzeIngredients('canola oil, rice flour', [], 2);
    expect(result.verdict).toBe('red');
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(true);
  });

  // ── soy oil / soya oil variant triggers ──────────────────────────────────

  test('"soy oil" triggers seed_oils at L1 (yellow) and L2 (red)', () => {
    const r1 = analyzeIngredients('soy oil, sea salt', [], 1);
    expect(r1.flags.find(f => f.category === 'seed_oils' && f.matchedIngredient === 'soy oil')).toBeDefined();
    expect(r1.verdict).toBe('yellow');

    const r2 = analyzeIngredients('soy oil, sea salt', [], 2);
    expect(r2.flags.find(f => f.category === 'seed_oils' && f.matchedIngredient === 'soy oil')).toBeDefined();
    expect(r2.verdict).toBe('red');
  });

  test('"soya oil" triggers seed_oils at L1 (yellow) and L2 (red)', () => {
    const r1 = analyzeIngredients('soya oil, sea salt', [], 1);
    expect(r1.flags.find(f => f.category === 'seed_oils' && f.matchedIngredient === 'soya oil')).toBeDefined();
    expect(r1.verdict).toBe('yellow');

    const r2 = analyzeIngredients('soya oil, sea salt', [], 2);
    expect(r2.flags.find(f => f.category === 'seed_oils' && f.matchedIngredient === 'soya oil')).toBeDefined();
    expect(r2.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 37. Prebiotic fibers — chicory root and inulin must NOT trigger additives
//
// Chicory root fibre (also spelled 'fiber') and inulin are naturally-derived
// prebiotic fibers with well-established safety profiles. They must never
// appear in SYNTHETIC_ADDITIVES or any other reject/caution trigger array.
// These tests lock that behavior in permanently.
// ════════════════════════════════════════════════════════════════════════════

describe('37. Prebiotic fibers — chicory root / inulin not flagged as additives', () => {

  test('"chicory root fibre" does not trigger additives at either level', () => {
    const r1 = analyzeIngredients('chicory root fibre', [], 1);
    expect(r1.flags.some(f => f.category === 'additives')).toBe(false);

    const r2 = analyzeIngredients('chicory root fibre', [], 2);
    expect(r2.flags.some(f => f.category === 'additives')).toBe(false);
  });

  test('"chicory root fiber" (US spelling) does not trigger additives at either level', () => {
    const r1 = analyzeIngredients('chicory root fiber', [], 1);
    expect(r1.flags.some(f => f.category === 'additives')).toBe(false);

    const r2 = analyzeIngredients('chicory root fiber', [], 2);
    expect(r2.flags.some(f => f.category === 'additives')).toBe(false);
  });

  test('"inulin" does not trigger additives at either level', () => {
    const r1 = analyzeIngredients('inulin', [], 1);
    expect(r1.flags.some(f => f.category === 'additives')).toBe(false);

    const r2 = analyzeIngredients('inulin', [], 2);
    expect(r2.flags.some(f => f.category === 'additives')).toBe(false);
  });

  test('product with only chicory root fibre and inulin → GREEN at L1 (no flags fired)', () => {
    // Neither ingredient triggers any engine category — engine returns green
    // with no flags at L1.
    const result = analyzeIngredients('chicory root fibre, inulin', [], 1);
    expect(result.verdict).toBe('green');
    expect(result.flags).toHaveLength(0);
  });

  test('product with only chicory root fibre and inulin → GREEN at L2 (no flags fired)', () => {
    // Engine-level verdict only — no flags from any trigger array at L2 either.
    // (The scan.js L2 decision tree is not involved here; this confirms the
    // engine itself produces no false positives for these prebiotic fibers.)
    const result = analyzeIngredients('chicory root fibre, inulin', [], 2);
    expect(result.verdict).toBe('green');
    expect(result.flags).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 38. Allergen advisory stripping — "may contain" / "manufactured on a line"
//     phrases are legal disclaimers and must not trigger ingredient flags.
// ════════════════════════════════════════════════════════════════════════════

describe('38. Allergen advisory stripping — disclaimers not flagged as ingredients', () => {

  test('"roasted nuts, sea salt. May contain eggs, wheat." — no conventional_eggs or glyphosate_heavy flag', () => {
    const result = analyzeIngredients(
      'roasted nuts, sea salt. May contain eggs, wheat.',
      [], 2
    );
    expect(result.flags.some(f => f.category === 'conventional_eggs')).toBe(false);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
  });

  test('"almonds, canola oil. Manufactured on a line that processes peanuts and soy." — only seed_oils flag fires', () => {
    const result = analyzeIngredients(
      'almonds, canola oil. Manufactured on a line that processes peanuts and soy.',
      [], 2
    );
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(true);
    // No extra flags from the advisory text
    const nonSeedOilFlags = result.flags.filter(f => f.category !== 'seed_oils' && f.category !== 'gluten_grains');
    expect(nonSeedOilFlags).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 39. Yogurt culture strains in ALWAYS_IGNORE_INGREDIENTS — bacterial strain
//     names must not surface as unverified ingredients or cause inconclusive.
// ════════════════════════════════════════════════════════════════════════════

describe('39. Yogurt culture strains — not surfaced as unverified ingredients', () => {

  test('organic yogurt with bacterial culture strains — strains not in unverifiedIngredients', () => {
    const ingredients =
      'organic whole milk, organic cane sugar, live and active cultures: ' +
      's. thermophilus, l. bulgaricus, l. acidophilus, bifidobacterium lactis, l. casei';
    const result = analyzeIngredients(ingredients, ['usda-organic'], 2);
    // No culture strain should appear in unverified list
    const cultureTerms = ['thermophilus', 'bulgaricus', 'acidophilus', 'bifidobacterium', 'casei'];
    for (const term of cultureTerms) {
      expect(result.unverifiedIngredients.some(u => u.toLowerCase().includes(term))).toBe(false);
    }
    // Engine verdict should be green (organic clears conventional crops)
    expect(result.verdict).toBe('green');
  });

  test('non-organic yogurt with culture strains — strains do not bloat unverifiedIngredients', () => {
    const ingredients =
      'whole milk, cane sugar, streptococcus thermophilus, lactobacillus bulgaricus, ' +
      'lactobacillus acidophilus, bifidobacterium longum, bifidobacterium bifidum, pectin';
    const result = analyzeIngredients(ingredients, [], 2);
    const cultureTerms = ['thermophilus', 'bulgaricus', 'acidophilus', 'bifidobacterium', 'pectin'];
    for (const term of cultureTerms) {
      expect(result.unverifiedIngredients.some(u => u.toLowerCase().includes(term))).toBe(false);
    }
  });

  test('"rennet" alone does not surface as unverified ingredient', () => {
    const result = analyzeIngredients('whole milk, rennet, salt', [], 2);
    expect(result.unverifiedIngredients.some(u => u.toLowerCase() === 'rennet')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 40. Flag deduplication — same (category, matchedIngredient) pair must only
//     produce one flag even when the trigger appears multiple times in the text.
// ════════════════════════════════════════════════════════════════════════════

describe('40. Flag deduplication — repeated trigger matches collapse to one flag', () => {

  test('"sugar, cane sugar, brown sugar" — only 1 conventional_crops flag for sugar', () => {
    const result = analyzeIngredients('sugar, cane sugar, brown sugar', [], 2);
    const sugarFlags = result.flags.filter(
      f => f.category === 'conventional_crops' && f.matchedIngredient === 'sugar'
    );
    expect(sugarFlags.length).toBe(1);
  });

  test('"canola oil, organic canola oil, canola oil" — only 1 seed_oils flag', () => {
    // "organic canola oil" is cleared by isPrecededByOrganic; the two bare
    // "canola oil" entries should collapse to a single seed_oils flag.
    const result = analyzeIngredients('canola oil, organic canola oil, canola oil', [], 2);
    const canolaFlags = result.flags.filter(
      f => f.category === 'seed_oils' && f.matchedIngredient === 'canola oil'
    );
    expect(canolaFlags.length).toBe(1);
  });
});

describe('41. parseIngredientTokens — leading asterisk stripping (Change 1)', () => {

  test('asterisk-prefixed tokens not surfaced in unverifiedIngredients', () => {
    // "*sea salt" is a common organic-disclaimer annotation; the * should be stripped
    // so the token matches "sea salt" in ALWAYS_IGNORE_INGREDIENTS.
    const result = analyzeIngredients('organic almonds, *sea salt', ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('*sea salt');
    expect(result.unverifiedIngredients).not.toContain('sea salt');
  });
});

describe('42. parseIngredientTokens — trailing ) stripping (Change 2)', () => {

  test('"milk, cheese cultures, salt, enzymes)" — enzymes not in unverifiedIngredients', () => {
    // Trailing ) should be stripped from each token so "enzymes)" resolves to
    // "enzymes" and matches the ALWAYS_IGNORE_INGREDIENTS entry.
    const result = analyzeIngredients('milk, cheese cultures, salt, enzymes)', [], 2);
    expect(result.unverifiedIngredients).not.toContain('enzymes)');
    expect(result.unverifiedIngredients).not.toContain('enzymes');
  });
});

describe('43. rawUnknownTokens — standalone corn excluded (Change 3)', () => {

  test('"popcorn, corn, sea salt" — corn not in unverifiedIngredients', () => {
    // "corn" is handled by the standalone corn regex in analyzeIngredients() and
    // is intentionally absent from ALL_TRIGGERS. An inline exclusion prevents it
    // from appearing in the unverified queue.
    const result = analyzeIngredients('popcorn, corn, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('corn');
  });
});

describe('44. SYNTHETIC_ADDITIVES additions — caffeine, cherry powder, etc. (Change 4)', () => {

  test('caffeine triggers additives reject', () => {
    const result = analyzeIngredients('water, caffeine, citric acid', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'caffeine')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('cultured celery extract triggers additives reject', () => {
    const result = analyzeIngredients('pork, water, cultured celery extract, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'cultured celery extract')).toBe(true);
  });

  test('cherry powder triggers additives reject', () => {
    const result = analyzeIngredients('pork, water, cherry powder, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'cherry powder')).toBe(true);
  });

  test('disodium succinate triggers additives reject', () => {
    const result = analyzeIngredients('beef broth, disodium succinate, salt', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'disodium succinate')).toBe(true);
  });

  test('erythorbic acid triggers additives reject', () => {
    const result = analyzeIngredients('chicken, water, erythorbic acid, salt', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'erythorbic acid')).toBe(true);
  });

  test('ester gum triggers additives reject', () => {
    const result = analyzeIngredients('carbonated water, orange juice, ester gum', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'ester gum')).toBe(true);
  });

  test('cultured onion juice triggers additives reject', () => {
    const result = analyzeIngredients('beef, water, cultured onion juice, salt', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'cultured onion juice')).toBe(true);
  });

  test('fd&c yellow #5 triggers additives via preprocessing (#→strip + yellow 5 trigger)', () => {
    const result = analyzeIngredients('water, fd&c yellow #5, citric acid', [], 2);
    expect(result.flags.some(f => f.category === 'additives')).toBe(true);
  });
});

describe('45. FORTIFIED_VITAMINS — ferric phosphate (Change 5)', () => {

  test('ferric phosphate triggers fortified_vitamins caution on organic product', () => {
    const result = containsFortifiedVitamins('ferric phosphate, niacin, riboflavin');
    expect(result).toBe(true);
  });
});

describe('46. NATURAL_COLORANTS additions — annatto color, extractives of paprika, etc. (Change 7)', () => {

  test('annatto color triggers containsNaturalColorants', () => {
    expect(containsNaturalColorants('organic flour, annatto color, sea salt')).toBe(true);
  });

  test('extractives of paprika triggers containsNaturalColorants', () => {
    expect(containsNaturalColorants('organic rice, extractives of paprika, salt')).toBe(true);
  });

  test('beet powder triggers containsNaturalColorants', () => {
    expect(containsNaturalColorants('organic oats, beet powder, vanilla')).toBe(true);
  });
});

describe('47. MILK_DERIVED_INGREDIENTS additions — cultured milk, butter powder, caseins (Change 8)', () => {

  test('cultured pasteurized milk triggers containsMilkDerived', () => {
    expect(containsMilkDerived('organic wheat, cultured pasteurized milk, live cultures')).toBe(true);
  });

  test('butter powder triggers containsMilkDerived', () => {
    expect(containsMilkDerived('organic flour, butter powder, salt')).toBe(true);
  });

  test('caseins triggers containsMilkDerived', () => {
    expect(containsMilkDerived('water, caseins, salt')).toBe(true);
  });

  test('nonfat dry milk triggers containsMilkDerived', () => {
    expect(containsMilkDerived('organic flour, nonfat dry milk, sugar')).toBe(true);
  });
});

describe('48. ALWAYS_IGNORE_INGREDIENTS — culture singular and amylase (Change 9)', () => {

  test('"culture" singular not surfaced in unverifiedIngredients', () => {
    const result = analyzeIngredients('organic whole milk, culture, live active cultures', ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('culture');
  });

  test('"amylase" not surfaced in unverifiedIngredients', () => {
    const result = analyzeIngredients('organic wheat flour, amylase, sea salt', ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('amylase');
  });
});

describe('49. CONVENTIONAL_CROPS — cane juice and cane syrup (Change 10)', () => {

  test('cane juice triggers conventional_crops reject on non-organic product', () => {
    const result = analyzeIngredients('filtered water, cane juice, citric acid', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'cane juice')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('cane syrup triggers conventional_crops reject on non-organic product', () => {
    const result = analyzeIngredients('filtered water, cane syrup, natural flavor', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'cane syrup')).toBe(true);
  });

  test('organic cane juice cleared by organic prefix', () => {
    const result = analyzeIngredients('filtered water, organic cane juice, citric acid', ['usda-organic'], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'cane juice')).toBe(false);
  });
});

describe('50. GLYPHOSATE_HEAVY — enriched acini di pepe (Change 11)', () => {

  test('enriched acini di pepe triggers glyphosate_heavy flag', () => {
    const result = analyzeIngredients('enriched acini di pepe, chicken broth, salt', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'enriched acini di pepe')).toBe(true);
  });
});

describe('51. SYNTHETIC_ADDITIVES — Change 1 additions (glycerin, karaya/konjac gum, l-cysteine)', () => {

  test('glycerin triggers additives reject', () => {
    const result = analyzeIngredients('water, glycerin, natural flavor', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'glycerin')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('karaya gum triggers additives reject', () => {
    const result = analyzeIngredients('water, karaya gum, citric acid', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'karaya gum')).toBe(true);
  });

  test('konjac gum triggers additives reject', () => {
    const result = analyzeIngredients('filtered water, konjac gum, natural flavor', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'konjac gum')).toBe(true);
  });

  test('l-cysteine triggers additives reject', () => {
    const result = analyzeIngredients('enriched flour, l-cysteine, yeast', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'l-cysteine')).toBe(true);
  });
});

describe('52. CONVENTIONAL_CROPS — guar gum unverified gap (Change 2)', () => {

  test('"organic guar gum" — guar gum not in unverifiedIngredients', () => {
    const result = analyzeIngredients('organic rice flour, organic guar gum, sea salt', ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('guar gum');
    expect(result.unverifiedIngredients).not.toContain('organic guar gum');
  });

  test('guar gum triggers conventional_crops on non-organic product', () => {
    const result = analyzeIngredients('rice flour, guar gum, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'guar gum')).toBe(true);
  });
});

describe('53. FORTIFIED_VITAMINS in ALL_TRIGGERS — folic acid/iron unverified gap (Change 3)', () => {

  test('"folic acid, reduced iron" on organic product — neither in unverifiedIngredients', () => {
    const result = analyzeIngredients('organic rice flour, folic acid, reduced iron, sea salt', ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('folic acid');
    expect(result.unverifiedIngredients).not.toContain('reduced iron');
    expect(result.unverifiedIngredients).not.toContain('iron');
  });
});

describe('54. CONVENTIONAL_CROPS — grain vinegar (Change 4)', () => {

  test('grain vinegar triggers conventional_crops reject on non-organic product', () => {
    const result = analyzeIngredients('water, grain vinegar, salt', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'grain vinegar')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('organic grain vinegar cleared by organic prefix', () => {
    const result = analyzeIngredients('water, organic grain vinegar, spices', ['usda-organic'], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'grain vinegar')).toBe(false);
  });
});

describe('55. NATURAL_COLORANTS — fruit/vegetable juice color additions (Change 5)', () => {

  test('"fruit and/or vegetable juice color" triggers containsNaturalColorants', () => {
    expect(containsNaturalColorants('organic flour, fruit and/or vegetable juice color, sea salt')).toBe(true);
  });
});

describe('56. MILK_DERIVED_INGREDIENTS — fontina cheese (Change 6)', () => {

  test('fontina cheese triggers containsMilkDerived', () => {
    expect(containsMilkDerived('organic pasta, fontina cheese, salt')).toBe(true);
  });
});

describe('57. MEAT_DERIVED_INGREDIENTS — gelatin (Change 8)', () => {

  const { containsMeatDerived } = require('./rulesEngine');

  test('gelatin in non-organic product triggers containsMeatDerived', () => {
    expect(containsMeatDerived('sugar, gelatin, natural flavor')).toBe(true);
  });

  test('beef gelatin triggers containsMeatDerived', () => {
    expect(containsMeatDerived('fruit juice, beef gelatin, citric acid')).toBe(true);
  });

  test('gelatin on organic product (usda-organic label) — containsMeatDerived returns true but L2 tree handles via organic path', () => {
    // The rules engine correctly identifies gelatin as meat-derived.
    // scan.js L2 tree routes usda-organic products to the organic sub-tree
    // (Node 4) before reaching Node 8c, so gelatin is cleared for organic products
    // at the scan.js level. The rulesEngine itself does not clear gelatin.
    expect(containsMeatDerived('organic fruit juice, gelatin, citric acid')).toBe(true);
  });
});

describe('58. SYNTHETIC_ADDITIVES — batch 3 additions (malic acid, modified cellulose, nisin)', () => {

  test('malic acid triggers additives flag', () => {
    const r = analyzeIngredients('water, malic acid, salt', [], 2);
    expect(r.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'malic acid')).toBe(true);
  });

  test('modified cellulose triggers additives flag', () => {
    const r = analyzeIngredients('water, modified cellulose, salt', [], 2);
    expect(r.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'modified cellulose')).toBe(true);
  });

  test('bare nisin triggers additives flag', () => {
    const r = analyzeIngredients('water, nisin, salt', [], 2);
    expect(r.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'nisin')).toBe(true);
  });
});

describe('59. FORTIFIED_VITAMINS — mixed tocopherols (Change 3)', () => {

  const { containsFortifiedVitamins } = require('./rulesEngine');

  test('mixed tocopherols triggers containsFortifiedVitamins', () => {
    expect(containsFortifiedVitamins('whole grain oats, mixed tocopherols, sea salt')).toBe(true);
  });

  test('natural vitamin e triggers containsFortifiedVitamins', () => {
    expect(containsFortifiedVitamins('organic grain flour, natural vitamin e, salt')).toBe(true);
  });

  test('palmitate triggers containsFortifiedVitamins', () => {
    expect(containsFortifiedVitamins('skim milk, palmitate, vitamin d3')).toBe(true);
  });
});

describe('60. GLYPHOSATE_HEAVY — oatmilk no-space variant (Change 4)', () => {

  test('oatmilk (no space) triggers glyphosate_heavy', () => {
    const r = analyzeIngredients('oatmilk, cane sugar, sunflower oil', [], 2);
    expect(r.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'oatmilk')).toBe(true);
  });
});

describe('61. NATURAL_COLORANTS — oleoresin paprika variants (Change 5)', () => {

  const { containsNaturalColorants } = require('./rulesEngine');

  test('oleoresin paprika triggers containsNaturalColorants', () => {
    expect(containsNaturalColorants('organic vinegar, oleoresin paprika, sea salt')).toBe(true);
  });
});

describe('62. MILK_DERIVED_INGREDIENTS — mozzarella cheese forms (Change 6)', () => {

  const { containsMilkDerived } = require('./rulesEngine');

  test('mozzarella cheese triggers containsMilkDerived', () => {
    expect(containsMilkDerived('enriched flour, mozzarella cheese, yeast')).toBe(true);
  });

  test('low moisture mozzarella cheese triggers containsMilkDerived', () => {
    expect(containsMilkDerived('pizza sauce, low moisture mozzarella cheese, water')).toBe(true);
  });
});

describe('63. CONVENTIONAL_CROPS — lactose (Change 7)', () => {

  test('lactose triggers conventional_crops at L2 without organic clearance', () => {
    const r = analyzeIngredients('water, lactose, salt', [], 2);
    expect(r.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'lactose')).toBe(true);
  });
});

describe('64. CONVENTIONAL_CROPS — modified potato/tapioca starch (Change 8)', () => {

  test('modified potato starch triggers conventional_crops', () => {
    const r = analyzeIngredients('water, modified potato starch, salt', [], 2);
    expect(r.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'modified potato starch')).toBe(true);
  });

  test('modified tapioca starch triggers conventional_crops', () => {
    const r = analyzeIngredients('water, modified tapioca starch, salt', [], 2);
    expect(r.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'modified tapioca starch')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 65. REVIEWED_CLEAN_INGREDIENTS — Batch 6 additions (grain-free granola
//     whole-food coverage gap)
// ════════════════════════════════════════════════════════════════════════════
describe('65. REVIEWED_CLEAN_INGREDIENTS — Batch 6 additions (whole-food coverage gap)', () => {

  test('"coconut flakes" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('coconut flakes, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('coconut flakes');
  });

  test('"banana puree" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('banana puree, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('banana puree');
  });

  test('"bananas" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('bananas, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('bananas');
  });

  test('"sprouted sunflower seeds" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('sprouted sunflower seeds, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('sprouted sunflower seeds');
  });

  test('"sprouted pumpkin seeds" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('sprouted pumpkin seeds, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('sprouted pumpkin seeds');
  });

  test('"dried plums" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('dried plums, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('dried plums');
  });

  test('"prunes" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('prunes, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('prunes');
  });

  test('"virgin coconut oil" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('virgin coconut oil, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('virgin coconut oil');
  });

  test('"maca powder" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('maca powder, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('maca powder');
  });

  test('"ground cinnamon" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('ground cinnamon, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('ground cinnamon');
  });

  test('Batch 6 additions do not affect engine flags or verdict', () => {
    const result = analyzeIngredients('coconut flakes, banana puree, sea salt', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('"tree nuts" is intentionally NOT added — still appears in unverifiedIngredients', () => {
    // Excluded from this batch by design: its appearance is an artifact of a
    // separate allergen-advisory-parsing gap, not a missing whole food.
    const result = analyzeIngredients('coconut flakes, tree nuts', [], 2);
    expect(result.unverifiedIngredients).toContain('tree nuts');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 66. Allergen advisory stripping — unverifiedIngredients regression
//     (rawUnknownTokens now shares the same allergen-stripped text as
//     trigger matching; "contains:" regex now closes on comma / end-of-string,
//     not just a trailing period)
// ════════════════════════════════════════════════════════════════════════════

describe('66. Allergen advisory stripping — unverifiedIngredients regression', () => {

  test('"contains:" clause terminated by a comma (not a period) is stripped from unverifiedIngredients', () => {
    // Existing block 38 only asserted on result.flags, and its example text
    // happened to end in a period — this case would have caught the gap:
    // the disclaimer fragments "contains" and "dairy" must not leak into
    // the review queue just because the label has no closing period.
    const result = analyzeIngredients(
      'roasted nuts, sea salt, contains: dairy,',
      [], 2
    );
    expect(result.unverifiedIngredients).not.toContain('contains');
    expect(result.unverifiedIngredients).not.toContain('dairy');
  });

  test('"may contain" clause terminated by a comma is stripped from unverifiedIngredients (not just flags)', () => {
    const result = analyzeIngredients(
      'roasted nuts, sea salt, may contain peanuts,',
      [], 2
    );
    expect(result.unverifiedIngredients).not.toContain('may contain peanuts');
    expect(result.unverifiedIngredients).not.toContain('peanuts');
  });

  test('"contains:" clause with no trailing punctuation at all (end of string) is stripped', () => {
    const result = analyzeIngredients(
      'roasted nuts, sea salt, contains: soy',
      [], 2
    );
    expect(result.unverifiedIngredients).not.toContain('soy');
    expect(result.unverifiedIngredients).not.toContain('contains');
  });

  test('a comma-terminated "contains:" clause is also stripped from flag/trigger matching, not just the unverified queue', () => {
    // Regression for the more severe half of the bug: because the same
    // unstripped text fed trigger matching, a disclosed allergen ingredient
    // name inside "contains:" could trip a real reject flag on a product
    // that never actually contains that ingredient.
    const result = analyzeIngredients(
      'roasted nuts, sea salt, contains: soy lecithin,',
      [], 2
    );
    expect(result.flags.some(f => f.matchedIngredient === 'soy lecithin')).toBe(false);
    expect(result.verdict).toBe('green');
  });

  test('granola product — "contains: tree nuts (coconut)," fully stripped from unverifiedIngredients', () => {
    const ingredients =
      "coconut flakes*, banana puree* (bananas*, ascorbic acid), sprouted sunflower seeds*, " +
      "sprouted pumpkin seeds*, dried plums (prunes)*, virgin coconut oil*, maca powder*, " +
      "ground cinnamon*, pink himalayan salt, (*organic), contains: tree nuts (coconut),";
    const result = analyzeIngredients(ingredients, [], 2);
    expect(result.unverifiedIngredients).not.toContain('contains');
    expect(result.unverifiedIngredients).not.toContain('tree nuts');
    expect(result.unverifiedIngredients).not.toContain('coconut');
  });

  test('multi-item period-terminated "may contain" clause still fully stripped (no regression)', () => {
    const result = analyzeIngredients(
      'roasted nuts, sea salt. May contain eggs, wheat.',
      [], 2
    );
    expect(result.flags.some(f => f.category === 'conventional_eggs')).toBe(false);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.unverifiedIngredients).not.toContain('eggs');
    expect(result.unverifiedIngredients).not.toContain('wheat');
  });

  test('unverifiedIngredients tokens still preserve original casing (not lowercased by the fix)', () => {
    const result = analyzeIngredients('Mystery Extract, Sea Salt', [], 2);
    expect(result.unverifiedIngredients).toContain('Mystery Extract');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 67. REVIEWED_CLEAN_INGREDIENTS — Batch 7 additions (monk fruit, cocoa
//     whole-food coverage gap)
//     NOTE: singular "chickpea" was originally added here too, but was
//     reclassified to GLYPHOSATE_HEAVY in a follow-up correction — see
//     block 68 below and the CLAUDE.md changelog. Removed from this block.
// ════════════════════════════════════════════════════════════════════════════
describe('67. REVIEWED_CLEAN_INGREDIENTS — Batch 7 additions (whole-food coverage gap)', () => {

  test('"monk fruit" (bare form) is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('monk fruit, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('monk fruit');
  });

  test('"cocoa" (bare form) is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('cocoa, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('cocoa');
  });

  test('Batch 7 additions do not affect engine flags or verdict', () => {
    const result = analyzeIngredients('monk fruit, cocoa, sea salt', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('"chickpeas" (plural) triggers a glyphosate_heavy reject flag (unchanged by this batch)', () => {
    // Plural "chickpeas" is a real GLYPHOSATE_HEAVY trigger (edible beans
    // section) and is caught by Pass 1 (ALL_TRIGGERS) before it could ever
    // reach REVIEWED_CLEAN_INGREDIENTS.
    const result = analyzeIngredients('chickpeas, sea salt', [], 2);
    const flag = result.flags.find(f => f.category === 'glyphosate_heavy');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('chickpeas');
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 68. GLYPHOSATE_HEAVY — chickpea singular/plural correction
//     Follow-up fix: singular "chickpea" was briefly in REVIEWED_CLEAN_INGREDIENTS
//     (Batch 7) alongside plural "chickpeas" being a GLYPHOSATE_HEAVY trigger —
//     an inconsistency, since both forms refer to the same crop with the same
//     glyphosate pre-harvest desiccation exposure. Singular "chickpea" moved
//     to GLYPHOSATE_HEAVY to match the plural.
// ════════════════════════════════════════════════════════════════════════════
describe('68. GLYPHOSATE_HEAVY — chickpea singular/plural correction', () => {

  test('"chickpea" (singular) triggers a glyphosate_heavy reject flag, matching plural "chickpeas"', () => {
    const result = analyzeIngredients('chickpea, sea salt', [], 2);
    const flag = result.flags.find(f => f.category === 'glyphosate_heavy');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
    expect(flag.matchedIngredient).toBe('chickpea');
    expect(result.verdict).toBe('red');
    expect(result.unverifiedIngredients).not.toContain('chickpea');
  });

  test('singular and plural chickpea both produce a glyphosate_heavy reject with identical clearance behaviour (organic prefix clears both)', () => {
    const singular = analyzeIngredients('organic chickpea, sea salt', [], 2);
    const plural = analyzeIngredients('organic chickpeas, sea salt', [], 2);
    expect(singular.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(plural.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(singular.verdict).toBe('green');
    expect(plural.verdict).toBe('green');
  });

  test('"chickpea flour" is unaffected — still matches its own longer GLYPHOSATE_HEAVY trigger, not the bare singular', () => {
    const result = analyzeIngredients('chickpea flour, sea salt', [], 2);
    const flag = result.flags.find(f => f.category === 'glyphosate_heavy');
    expect(flag).toBeDefined();
    expect(flag.matchedIngredient).toBe('chickpea flour');
    expect(result.flags.filter(f => f.category === 'glyphosate_heavy')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 69. REVIEWED_CLEAN_INGREDIENTS — Batch 9 addition (unsweetened chocolate);
//     "chocolate chips" deliberately excluded — regression guard
// ════════════════════════════════════════════════════════════════════════════
describe('69. REVIEWED_CLEAN_INGREDIENTS — Batch 9 addition (unsweetened chocolate)', () => {

  test('"unsweetened chocolate" is in REVIEWED_CLEAN_INGREDIENTS and does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('unsweetened chocolate, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('unsweetened chocolate');
  });

  test('Batch 9 addition does not affect engine flags or verdict', () => {
    const result = analyzeIngredients('unsweetened chocolate, sea salt', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('"chocolate chips" (bare, no disclosed sub-ingredient breakdown) still surfaces as unverified', () => {
    // Deliberately NOT whitelisted: unlike a raw whole food, "chocolate chips"
    // is a manufactured/compound product whose composition varies by brand
    // and near-universally includes added sugar (often soy lecithin, milk
    // solids) that go undisclosed when a label lists it without a
    // parenthetical breakdown. Whitelisting the container term would mask
    // those undisclosed ingredients — same class of mistake as the
    // chickpea/chickpeas conflict from the Batch 7 correction. This is a
    // regression guard so the container term isn't accidentally whitelisted
    // in a future batch without this reasoning being revisited.
    const result = analyzeIngredients('chocolate chips, sea salt', [], 2);
    expect(result.unverifiedIngredients).toContain('chocolate chips');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 70. Trailing certification-note sentence fragment — malformed ". Organic"
//     token no longer leaks into unverifiedIngredients
// ════════════════════════════════════════════════════════════════════════════
describe('70. Trailing certification-note fragment stripping (". Organic." / ". Organic")', () => {

  test('exact reproduction — "...Bifidobacterium lactics (probiotic). Organic." does not produce a ". Organic" token', () => {
    const ingredients =
      'Cultured whole milk, blueberry purée, whole milk powder, cherry purée, Date, lemon juice, ' +
      'tapioca starch, vitamin E (mix tocopherols to protect flavor), Bifidobacterium lactics (probiotic). Organic.';
    const result = analyzeIngredients(ingredients, ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('. Organic');
    expect(result.unverifiedIngredients.some(t => t.includes('. Organic'))).toBe(false);
    expect(result.unverifiedIngredients.some(t => /^\.\s/.test(t))).toBe(false);
  });

  test('trailing ". Organic" with no closing period is also stripped', () => {
    const result = analyzeIngredients('oats, water. Organic', [], 2);
    expect(result.unverifiedIngredients.some(t => t.includes('Organic'))).toBe(false);
  });

  test('"Certified Organic." and "USDA Organic." trailing variants are also stripped', () => {
    const certified = analyzeIngredients('oats, water. Certified Organic.', [], 2);
    const usda = analyzeIngredients('oats, water. USDA Organic.', [], 2);
    expect(certified.unverifiedIngredients.some(t => t.includes('Organic'))).toBe(false);
    expect(usda.unverifiedIngredients.some(t => t.includes('Organic'))).toBe(false);
  });

  test('this fix does not change flags or verdict — display-only change to unverifiedIngredients', () => {
    const ingredients =
      'Cultured whole milk, blueberry purée, whole milk powder, cherry purée, Date, lemon juice, ' +
      'tapioca starch, vitamin E (mix tocopherols to protect flavor), Bifidobacterium lactics (probiotic). Organic.';
    const result = analyzeIngredients(ingredients, [], 2);
    expect(result.flags.map(f => ({ category: f.category, matchedIngredient: f.matchedIngredient }))).toEqual([
      { category: 'conventional_crops', matchedIngredient: 'vitamin e' },
      { category: 'conventional_crops', matchedIngredient: 'tocopherols' },
    ]);
    expect(result.verdict).toBe('red');
  });

  test('regression guard — mid-string periods (abbreviations, decimals) are NOT treated as token separators', () => {
    const abbreviation = analyzeIngredients('vitamin b12., salt, water', [], 2);
    const decimal = analyzeIngredients('contains 0.5% citric acid, salt', [], 2);
    // Neither should produce a malformed leading-period token.
    expect(abbreviation.unverifiedIngredients.some(t => /^\.\s/.test(t))).toBe(false);
    expect(decimal.unverifiedIngredients.some(t => /^\.\s/.test(t))).toBe(false);
    // The decimal case's real trigger match is untouched by this fix.
    expect(decimal.flags.some(f => f.matchedIngredient === 'citric acid')).toBe(true);
  });

  test('regression guard — a real trailing ingredient that merely starts with "Organic" (comma-separated, not period-connected) is left untouched', () => {
    // "Organic Coconut Oil." here is comma-separated from the prior ingredient,
    // not a period-connected sentence fragment — the fix must not touch it.
    const result = analyzeIngredients('salt, pepper, Organic Coconut Oil.', [], 2);
    expect(result.unverifiedIngredients).toContain('pepper');
    expect(result.unverifiedIngredients.some(t => t.includes('Coconut Oil'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 71. Batch 10 additions — bare "probiotic", "Bifidobacterium lactics" typo
//     variant, singular "date" (whole-food/probiotic-vocabulary coverage gap)
// ════════════════════════════════════════════════════════════════════════════
describe('71. Batch 10 additions (probiotic, bifidobacterium lactics, singular date)', () => {

  test('bare "probiotic" (ALWAYS_IGNORE_INGREDIENTS) does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('probiotic, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('probiotic');
  });

  test('"live and active probiotic" is unaffected by the new bare "probiotic" entry', () => {
    const result = analyzeIngredients('live and active probiotic, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('live and active probiotic');
  });

  test('"Bifidobacterium lactics" (typo/labeling variant, ALWAYS_IGNORE_INGREDIENTS) does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('Bifidobacterium lactics, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('Bifidobacterium lactics');
  });

  test('"bifidobacterium lactis" (existing correctly-spelled entry) is unaffected by the new "lactics" variant', () => {
    const result = analyzeIngredients('bifidobacterium lactis, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('bifidobacterium lactis');
  });

  test('singular "Date" (REVIEWED_CLEAN_INGREDIENTS) does NOT appear in unverifiedIngredients', () => {
    const result = analyzeIngredients('Date, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('Date');
  });

  test('plural "dates" is unaffected by the new singular "date" entry', () => {
    const result = analyzeIngredients('dates, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('dates');
  });

  test('compound "date sugar" still matches its own existing entry, not confused with singular "date"', () => {
    const result = analyzeIngredients('date sugar, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('date sugar');
    expect(result.unverifiedIngredients).not.toContain('date');
  });

  test('Batch 10 additions do not affect engine flags or verdict', () => {
    const result = analyzeIngredients('probiotic, Bifidobacterium lactics, Date, sea salt', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('real-world reproduction — Smoothie Melts ingredient string has no unverified tokens left from these three items', () => {
    const ingredients =
      'Cultured whole milk, blueberry purée, whole milk powder, cherry purée, Date, lemon juice, ' +
      'tapioca starch, vitamin E (mix tocopherols to protect flavor), Bifidobacterium lactics (probiotic). Organic.';
    const result = analyzeIngredients(ingredients, ['usda-organic'], 2);
    expect(result.unverifiedIngredients).not.toContain('Date');
    expect(result.unverifiedIngredients).not.toContain('Bifidobacterium lactics');
    expect(result.unverifiedIngredients).not.toContain('probiotic');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 72. Oxford-comma conjunction stripping, "l. rhamnosus" coverage, and
//     general purpose-note parenthetical stripping (Mango Chobani fixes)
// ════════════════════════════════════════════════════════════════════════════
describe('72. Oxford-comma conjunction, l. rhamnosus, and purpose-note parenthetical fixes', () => {

  // ── Issue 1 + 2: Oxford-comma "and" stripping + bare "l. rhamnosus" ──────

  test('exact reproduction — Mango Chobani: neither "L. Rhamnosus" nor "and L. Rhamnosus" appears in unverifiedIngredients', () => {
    const ingredients =
      'Cultured lowfat milk, water, mangoes, less than 2% of: natural flavors, lactase**, fruit pectin, ' +
      'vegetable juice (for color), sea salt, stevia extract, guar gum, locust bean gum, lemon juice concentrate, ' +
      'S. Thermophilus, L. Bulgaricus, L. Acidophilus, Bifidus, L. Casei, and L. Rhamnosus';
    const result = analyzeIngredients(ingredients, [], 2);
    expect(result.unverifiedIngredients).not.toContain('L. Rhamnosus');
    expect(result.unverifiedIngredients).not.toContain('and L. Rhamnosus');
    expect(result.unverifiedIngredients.some(t => t.toLowerCase().includes('rhamnosus'))).toBe(false);
  });

  test('bare "L. Rhamnosus" (no leading "and") is independently covered by ALWAYS_IGNORE_INGREDIENTS', () => {
    const result = analyzeIngredients('L. Rhamnosus, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('L. Rhamnosus');
  });

  test('leading "and " is stripped from an Oxford-comma list ending, isolated from the l. rhamnosus fix', () => {
    // Uses a different trailing item so this test only exercises the
    // conjunction strip, not the l. rhamnosus vocabulary entry.
    const result = analyzeIngredients('salt, pepper, and cherries', [], 2);
    expect(result.unverifiedIngredients).not.toContain('and cherries');
    expect(result.unverifiedIngredients).not.toContain('cherries');
  });

  test('regression guard — "andouille sausage" is NOT corrupted by the leading-conjunction strip', () => {
    // "and" immediately followed by "ouille" (no whitespace) must not match
    // the whitespace-required /^and\s+/i pattern — confirmed by checking the
    // token is never mangled into a stripped-prefix form like "ouille
    // sausage". The token no longer appears in unverifiedIngredients at all
    // as of this session's ALL_TRIGGERS change (describe block 76 below) —
    // "sausage" is a MEAT_INGREDIENT_TERMS entry now spread into
    // ALL_TRIGGERS, and containsMeatIngredient() already correctly
    // corroborates "andouille sausage" as meat — but that's a separate,
    // intentional suppression, not evidence of conjunction-strip corruption.
    const result = analyzeIngredients('andouille sausage, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('ouille sausage');
    expect(result.unverifiedIngredients.some(t => /^ouille\b/i.test(t))).toBe(false);
  });

  test('the existing compound trigger "l. paracasei and l. rhamnosus" is unaffected', () => {
    const result = analyzeIngredients('L. Paracasei and L. Rhamnosus, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('L. Paracasei and L. Rhamnosus');
  });

  // ── Issue 3: general purpose-note parenthetical stripping ────────────────

  test('"vegetable juice (for color)" — "for color" no longer leaks as its own unverified token', () => {
    const result = analyzeIngredients('vegetable juice (for color), sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('for color');
  });

  test('"(for freshness)" purpose-note variant is also stripped', () => {
    const result = analyzeIngredients('natural extract (for freshness), sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('for freshness');
  });

  test('"(to preserve texture)" purpose-note variant is also stripped', () => {
    const result = analyzeIngredients('ascorbic acid (to preserve texture), sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('to preserve texture');
  });

  test('regression guard — a real sub-ingredient parenthetical (chocolate chips, Batch 9) still flattens and checks normally', () => {
    const result = analyzeIngredients(
      'chocolate chips (unsweetened chocolate, sugar, cocoa butter), sea salt', [], 2
    );
    // "sugar" is a real sub-ingredient and must still be flagged.
    expect(result.flags.some(f => f.matchedIngredient === 'sugar')).toBe(true);
    // "unsweetened chocolate" and "cocoa butter" are already-clean whole
    // foods and must not appear as unverified.
    expect(result.unverifiedIngredients).not.toContain('unsweetened chocolate');
    expect(result.unverifiedIngredients).not.toContain('cocoa butter');
    // "chocolate chips" (the bare container term) is deliberately still
    // unverified per the Batch 9 policy — unaffected by this fix.
    expect(result.unverifiedIngredients).toContain('chocolate chips');
  });

  test('regression guard — a purpose note removed from between two words of a trigger phrase does not break that trigger match', () => {
    // Hardens against a double-space artifact: if a purpose note sat between
    // two words of a multi-word trigger, removing it must not leave a gap
    // wide enough to break the exact-substring trigger match.
    const result = analyzeIngredients('high oleic (for flavor) sunflower oil, sea salt', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'high oleic sunflower oil')).toBe(true);
  });

  test('the pre-existing "to preserve freshness" ARTIFACT_PHRASES case still works (now doubly covered)', () => {
    const result = analyzeIngredients(
      'salt, Ascorbic Acid and Mixed Tocopherols (to preserve freshness)', [], 2
    );
    expect(result.unverifiedIngredients).not.toContain('to preserve freshness');
  });

  test('Issue 3 CAN change flags for a realistic mid-phrase purpose note — "canola (for cooking) oil" now correctly flags seed_oils (was a false negative before this fix, since the raw text "canola (for cooking) oil" never contained the contiguous substring "canola oil")', () => {
    const result = analyzeIngredients('canola (for cooking) oil, salt', [], 2);
    const flag = result.flags.find(f => f.category === 'seed_oils');
    expect(flag).toBeDefined();
    expect(flag.matchedIngredient).toBe('canola oil');
  });

  test('Issue 2 is flags/verdict-neutral at the engine level — adding "l. rhamnosus" to a product introduces no new flag', () => {
    // FORTIFIED_VITAMINS is folded into ALL_TRIGGERS for unverified-suppression
    // purposes only — analyzeIngredients() itself does not run the
    // containsFortifiedVitamins()/maskIgnoredIngredients() organic-path check;
    // that lives in pages/api/scan.js's L2 tree. See scan.test.js Suite L for
    // a handler-level confirmation that l. rhamnosus masking doesn't disturb
    // the fortified_vitamins injection there.
    const result = analyzeIngredients('oats, l. rhamnosus, vitamin d3', ['usda-organic'], 2);
    expect(result.flags.filter(f => f.category !== 'gluten_grains')).toHaveLength(0);
    expect(result.verdict).toBe('green');
    expect(result.clearedBy).toBe('organic');
  });

  // ── Combined flags/verdict-unaffected check ───────────────────────────────

  test('for the exact Mango Chobani reproduction, flags and verdict are unchanged from the pre-fix baseline', () => {
    const ingredients =
      'Cultured lowfat milk, water, mangoes, less than 2% of: natural flavors, lactase**, fruit pectin, ' +
      'vegetable juice (for color), sea salt, stevia extract, guar gum, locust bean gum, lemon juice concentrate, ' +
      'S. Thermophilus, L. Bulgaricus, L. Acidophilus, Bifidus, L. Casei, and L. Rhamnosus';
    const result = analyzeIngredients(ingredients, [], 2);
    expect(result.flags.map(f => ({ category: f.category, matchedIngredient: f.matchedIngredient }))).toEqual([
      { category: 'conventional_crops', matchedIngredient: 'guar gum' },
      { category: 'natural_flavors', matchedIngredient: 'natural flavors' },
      { category: 'additives', matchedIngredient: 'stevia extract' },
    ]);
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 73. "-free"/"non-" bare-word trigger guard (isInFreeOrNonContext) +
//     manufacturer address / facility-statement stripping
//     (Guava Toasted Snack Crackers false-positive fixes)
// ════════════════════════════════════════════════════════════════════════════
describe('73. "-free" false-positive guard and facility/address stripping', () => {

  // ── Issue 1: isInFreeOrNonContext — full confirmed blast radius ──────────

  test('"egg-free" no longer triggers conventional_eggs', () => {
    const result = analyzeIngredients('this product is egg-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_eggs')).toBe(false);
    expect(result.verdict).toBe('green');
  });

  test('"corn-free" no longer triggers gluten_grains', () => {
    const result = analyzeIngredients('this product is corn-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  test('"wheat-free" no longer triggers glyphosate_heavy or gluten_grains', () => {
    const result = analyzeIngredients('this product is wheat-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
    expect(result.verdict).toBe('green');
  });

  test('"barley-free" no longer triggers glyphosate_heavy or gluten_grains', () => {
    const result = analyzeIngredients('this product is barley-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  test('"rye-free" no longer triggers glyphosate_heavy or gluten_grains', () => {
    const result = analyzeIngredients('this product is rye-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  test('"canola-free" no longer triggers seed_oils — most severe case, seed_oils is an INSTANT_RED_CATEGORIES member', () => {
    const result = analyzeIngredients('this product is canola-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(false);
    expect(result.verdict).toBe('green');
  });

  test('"sugar-free" no longer triggers conventional_crops', () => {
    const result = analyzeIngredients('this product is sugar-free, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'conventional_crops')).toBe(false);
    expect(result.verdict).toBe('green');
  });

  test('regression guard — a real, non-"-free" occurrence of each trigger still correctly flags (the guard only fires on actual "-free"/"non-" context)', () => {
    expect(analyzeIngredients('eggs, sea salt', [], 2).flags.some(f => f.category === 'conventional_eggs')).toBe(true);
    expect(analyzeIngredients('wheat, sea salt', [], 2).flags.some(f => f.category === 'glyphosate_heavy')).toBe(true);
    expect(analyzeIngredients('canola oil, sea salt', [], 2).flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(analyzeIngredients('sugar, sea salt', [], 2).flags.some(f => f.category === 'conventional_crops')).toBe(true);
  });

  // ── Regression guard: the pre-existing "gmo" guard behavior is unchanged ──

  test('regression guard — "non-gmo ingredients" still does not flag bioengineering (pre-existing guard, now via the shared helper)', () => {
    const result = analyzeIngredients('non-gmo ingredients, sea salt', [], 2);
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(false);
  });

  test('regression guard — "gmo-free verified ingredients" still does not flag bioengineering', () => {
    const result = analyzeIngredients('gmo-free verified ingredients', [], 2);
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(false);
  });

  test('regression guard — "gmo free product" (space separator) still does not flag bioengineering', () => {
    const result = analyzeIngredients('gmo free product', [], 2);
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(false);
  });

  test('regression guard — a real bioengineering disclosure still correctly flags', () => {
    const result = analyzeIngredients('contains a bioengineered food ingredient, sea salt', [], 2);
    const flag = result.flags.find(f => f.category === 'bioengineering');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('regression guard — bare "gmo" as a real disclosure still correctly flags bioengineering', () => {
    const result = analyzeIngredients('gmo corn syrup, sea salt', [], 2);
    const flag = result.flags.find(f => f.category === 'bioengineering');
    expect(flag).toBeDefined();
    expect(flag.matchedIngredient).toBe('gmo');
  });

  // ── Issue 2: manufacturer address / facility-statement stripping ─────────

  test('"Manufactured by: [company] [address]\\n" is stripped and does not leak into unverifiedIngredients', () => {
    const result = analyzeIngredients(
      'salt, sugar. Manufactured by: Foo Corp, 123 Main St., Springfield, IL 62704\nolive oil',
      [], 2
    );
    expect(result.unverifiedIngredients.some(t => t.includes('Foo Corp'))).toBe(false);
    expect(result.unverifiedIngredients.some(t => t.includes('Springfield'))).toBe(false);
  });

  test('regression guard — "Manufactured by:" with NO following newline is left unstripped rather than risk swallowing real ingredients that follow it', () => {
    // Deliberate, documented trade-off: no end-of-string fallback for this
    // pattern, since a real ingredient could otherwise be silently consumed.
    const result = analyzeIngredients(
      'salt, sugar. Manufactured by: Foo Corp, real ingredient placeholder one, real ingredient placeholder two',
      [], 2
    );
    expect(result.unverifiedIngredients).toContain('real ingredient placeholder one');
    expect(result.unverifiedIngredients).toContain('real ingredient placeholder two');
  });

  test('"THIS PRODUCT IS MADE IN A [...] FACILITY [...]." is stripped and does not leak into unverifiedIngredients', () => {
    const result = analyzeIngredients(
      'salt, sugar. THIS PRODUCT IS MADE IN A SOY-FREE, PEANUT-FREE FACILITY DOES NOT PROCESS NUTS.',
      [], 2
    );
    expect(result.unverifiedIngredients).toHaveLength(0);
  });

  test('regression guard — "produced in a facility" (existing pattern) is unaffected by the new "made in a" pattern', () => {
    const result = analyzeIngredients(
      'almonds, canola oil. Produced in a facility that processes peanuts and soy.',
      [], 2
    );
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(result.unverifiedIngredients).toHaveLength(0);
  });

  test('regression guard — "manufactured on a line" (existing pattern) is unaffected by the new "manufactured by" pattern', () => {
    const result = analyzeIngredients(
      'almonds, canola oil. Manufactured on a line that processes peanuts and soy.',
      [], 2
    );
    expect(result.flags.some(f => f.category === 'seed_oils')).toBe(true);
    const nonSeedOilFlags = result.flags.filter(f => f.category !== 'seed_oils' && f.category !== 'gluten_grains');
    expect(nonSeedOilFlags).toHaveLength(0);
  });

  // ── Full combined reproduction ────────────────────────────────────────────

  test('exact reproduction — Guava Toasted Snack Crackers: no conventional_eggs flag, no facility/address garbage in unverifiedIngredients, only real flags remain', () => {
    const ingredients =
      'GUAVA PUREE\nYELLOW CORN FLOUR \nDARK BROWN SUGAR \nYELLOW CORN MEAL \nOLIVE OIL \nSEA SALT ' +
      '\nROSEMARY EXTRACT (for freshness) Manufactured by: CRAIZE SNACKS INC 6903 N.E. 3rd. Ave., Miami, FL 33138 ' +
      '\nTHIS PRODUCT IS MADE IN A SOY-FREE, PEANUT-FREE, EGG-FREE, MILK-FREE FACILITY DOES NOT PROCESS NUTS, ' +
      'OTHER THAN COCONUT. \nMAY CONTAIN SESAME.';
    const result = analyzeIngredients(ingredients, [], 2);

    // The false conventional_eggs flag is gone.
    expect(result.flags.some(f => f.category === 'conventional_eggs')).toBe(false);

    // Only real, legitimate flags remain (corn flour, sugar, corn meal are
    // genuinely non-organic conventional-crop and gluten-grain ingredients).
    expect(result.flags.every(f =>
      f.category === 'conventional_crops' || f.category === 'gluten_grains'
    )).toBe(true);
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'sugar')).toBe(true);

    // No manufacturer/address/facility garbage anywhere in unverifiedIngredients.
    expect(result.unverifiedIngredients).toHaveLength(0);

    // Verdict is still red — but now only for genuine reasons.
    expect(result.verdict).toBe('red');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 74. Bare "Contains X." allergen statements + "less than X% of the
//     following" qualifier + "(VEGAN):"-style cert-prefix labels
//     — reject-severity false-flag fix (glyphosate_heavy, conventional_crops,
//     conventional_eggs)
// ════════════════════════════════════════════════════════════════════════════

describe('74. Bare-contains allergen statement and cert-prefix false-flag fix', () => {
  const CLEAN_BASE = 'sunflower seeds, dried cranberries, sea salt';

  // ── Highest priority: confirmed reject-severity false-flag terms ─────────
  // Tested WITHOUT a usda-organic label — the unprotected case that matters,
  // since organic clearance was masking this bug in the original repro.

  test('bare "Contains wheat." → no flags, no longer forces RED via glyphosate_heavy', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains wheat.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains barley." → no flags, no longer forces RED via glyphosate_heavy', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains barley.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains rye." → no flags, no longer forces RED via glyphosate_heavy', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains rye.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains oats." → no flags, no longer forces RED via glyphosate_heavy', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains oats.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains soybean." → no flags, no longer forces RED via conventional_crops', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains soybean.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains soybeans." → no flags, no longer forces RED via conventional_crops', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains soybeans.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains egg." → no flags, no longer forces RED via conventional_eggs', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains egg.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  test('bare "Contains eggs." → no flags, no longer forces RED via conventional_eggs', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains eggs.`, [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).not.toBe('red');
  });

  // ── Negative controls — already clean before the fix, must stay clean ────

  test('regression: bare "Contains soy." was already clean, stays clean', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains soy.`, [], 2);
    expect(result.flags).toHaveLength(0);
  });

  test('regression: bare "Contains milk." was already clean (bare "milk" is not a MILK_DERIVED_INGREDIENTS trigger by design), stays clean', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains milk.`, [], 2);
    expect(result.flags).toHaveLength(0);
  });

  test('regression: bare "Contains corn." was already caution-only (gluten_grains, not reject), stays caution-only', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains corn.`, [], 2);
    expect(result.flags.every(f => f.severity === 'caution')).toBe(true);
    expect(result.verdict).not.toBe('red');
  });

  // ── "less than X% of the following" qualifier — must NOT hide real flags ─

  test('qualifier with colon + "the following:" — real reject-severity ingredient after the colon still flags', () => {
    const result = analyzeIngredients(
      'organic oats, organic honey, sea salt. Contains less than 2% of the following: soy lecithin, xanthan gum, natural flavors.',
      ['usda-organic'],
      2
    );
    const flag = result.flags.find(f => f.category === 'natural_flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('qualifier without colon or "the following" (real-world Kraft-style wording) — real reject-severity ingredients after it still flag', () => {
    // Mirrors the exact wording already present in the Kraft Mac & Cheese
    // fixture used elsewhere in this suite: "Contains Less Than 2% of
    // Citric Acid, ... Soybean Oil, Yellow 5, Yellow 6" — no "the
    // following", no colon. An earlier version of this fix only handled
    // the colon form, and its broader bare-contains fallback silently
    // swallowed this entire real ingredient list.
    const result = analyzeIngredients(
      'sunflower seeds, sea salt. Contains less than 2% of citric acid, soybean oil, yellow 5.',
      [],
      2
    );
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'citric acid')).toBe(true);
    expect(result.flags.some(f => f.category === 'seed_oils' && f.matchedIngredient === 'soybean oil')).toBe(true);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'yellow 5')).toBe(true);
  });

  test('the qualifier phrase itself never becomes an unverifiedIngredients token', () => {
    const result = analyzeIngredients(
      'organic oats, organic honey, sea salt. Contains less than 2% of the following: soy lecithin, xanthan gum, natural flavors.',
      ['usda-organic'],
      2
    );
    expect(result.unverifiedIngredients.some(t => /contains|following|less than/i.test(t))).toBe(false);
  });

  // ── Ordering guard — pattern (a) must run before pattern (b) ─────────────

  test('ordering: "Contains less than 2% of the following: milk, wheat." is not eaten whole by the bare-contains pattern — "wheat" still flags, "milk" (not a bare trigger) does not', () => {
    const result = analyzeIngredients(
      'organic quinoa, sea salt. Contains less than 2% of the following: milk, wheat.',
      ['usda-organic'],
      2
    );
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'wheat')).toBe(true);
  });

  // ── "(VEGAN):" cert-prefix label ──────────────────────────────────────────

  test('"(VEGAN): ORGANIC PINTO BEANS, WATER, SEA SALT." — "VEGAN" no longer appears in unverifiedIngredients', () => {
    const result = analyzeIngredients('(VEGAN): ORGANIC PINTO BEANS, WATER, SEA SALT.', [], 2);
    expect(result.unverifiedIngredients).not.toContain('VEGAN');
  });

  test('"(Kosher) Beef Broth, water, salt." — "Kosher" no longer appears in unverifiedIngredients (no colon required)', () => {
    const result = analyzeIngredients('(Kosher) Beef Broth, water, salt.', [], 2);
    expect(result.unverifiedIngredients).not.toContain('Kosher');
  });

  test('regression: an unrelated genuine leading parenthetical is NOT swallowed by the cert-prefix rule', () => {
    // "(Organic)" is deliberately not in the curated cert-word list — a
    // blanket "any leading parenthetical" rule would have caught this too.
    const CERT_PREFIX_RE = /^\(\s*(vegan|kosher|halal|gluten-free|dairy-free|non-gmo|plant-based)\s*\)\s*:?\s*/i;
    expect(CERT_PREFIX_RE.test('(Organic) Coconut Milk, water, sea salt.')).toBe(false);
  });

  // ── Regression: existing colon-form "contains:" stripping unaffected ─────

  test('regression: colon-form "Contains: wheat." still strips correctly (unaffected by the new bare-form patterns)', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains: wheat.`, [], 2);
    expect(result.flags).toHaveLength(0);
  });

  test('regression: colon-form comma-terminated "Contains: tree nuts (coconut)," still strips correctly', () => {
    const result = analyzeIngredients(`${CLEAN_BASE}. Contains: tree nuts (coconut),`, [], 2);
    expect(result.unverifiedIngredients.some(t => /tree nuts|coconut/i.test(t))).toBe(false);
  });

  // ── Regression: bioengineering disclosure survives the bare-contains fix ─

  test('regression: "contains a bioengineered food ingredient" still correctly flags bioengineering', () => {
    const result = analyzeIngredients('contains a bioengineered food ingredient', [], 2);
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(true);
  });

  test('regression: "contains gmo ingredients" (standalone disclosure) still correctly flags bioengineering', () => {
    const result = analyzeIngredients('contains gmo ingredients', [], 2);
    expect(result.flags.some(f => f.category === 'bioengineering')).toBe(true);
  });

  // ── Regression: string-opening "contains X" test-fixture convention ──────
  // Confirms the start-of-string exclusion doesn't just avoid breaking the
  // pre-existing suite — it's a deliberate, load-bearing rule: a real
  // allergen/qualifier disclosure always trails the actual ingredient list,
  // never opens it.

  test('regression: "contains azodicarbonamide" (whole string, additive-as-declaration) still flags — not treated as a throwaway advisory', () => {
    const result = analyzeIngredients('contains azodicarbonamide', [], 2);
    expect(result.verdict).toBe('red');
  });
});

describe("75. stripAllergenAdvisory() — 'contains X% or less of' qualifier phrasing", () => {
  // Real-world bug: the qualifier regex only recognized "contains less than
  // X% of" — a label using "contains X% or less of" instead fell through to
  // the bare-contains greedy fallback, which deleted every real ingredient
  // from "contains" through to the string's final period.

  test('exact repro: "Beef, water, contains 2% or less of salt, sorbitol, ..." — full flag set restored, no ingredients silently deleted', () => {
    const result = analyzeIngredients(
      'Beef, water, contains 2% or less of salt, sorbitol, sodium lactate, natural flavorings, ' +
      'sodium phosphates, hydrolyzed corn protein, paprika, sodium diacetate, sodium erythorbate, sodium nitrite.',
      [],
      2
    );
    const categories = result.flags.map(f => `${f.category}:${f.matchedIngredient}`);
    expect(categories).toEqual(expect.arrayContaining([
      'conventional_crops:sorbitol',
      'natural_flavors:natural flavor',
      'additives:sodium phosphate',
      'additives:hydrolyzed corn protein',
      'additives:sodium diacetate',
      'additives:sodium nitrite',
    ]));
    expect(result.verdict).toBe('red');
  });

  test('colon variant: "contains 2% or less of: salt, sorbitol, ..." — same full flag set restored', () => {
    const result = analyzeIngredients(
      'Beef, water, contains 2% or less of: salt, sorbitol, sodium lactate, natural flavorings, ' +
      'sodium phosphates, hydrolyzed corn protein, paprika, sodium diacetate, sodium erythorbate, sodium nitrite.',
      [],
      2
    );
    const categories = result.flags.map(f => `${f.category}:${f.matchedIngredient}`);
    expect(categories).toEqual(expect.arrayContaining([
      'conventional_crops:sorbitol',
      'natural_flavors:natural flavor',
      'additives:sodium phosphate',
      'additives:hydrolyzed corn protein',
      'additives:sodium diacetate',
      'additives:sodium nitrite',
    ]));
    expect(result.verdict).toBe('red');
  });

  test('regression: "contains less than X% of" qualifier stripping is unchanged', () => {
    const result = analyzeIngredients(
      'organic oats, organic honey, sea salt. Contains less than 2% of the following: soy lecithin, xanthan gum, natural flavors.',
      ['usda-organic'],
      2
    );
    const flag = result.flags.find(f => f.category === 'natural_flavors');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('regression: Kraft-style "Contains less than 2% of citric acid, soybean oil, yellow 5." (no colon, no "the following") is unchanged', () => {
    const result = analyzeIngredients(
      'sunflower seeds, sea salt. Contains less than 2% of citric acid, soybean oil, yellow 5.',
      [],
      2
    );
    expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'citric acid')).toBe(true);
    expect(result.flags.some(f => f.category === 'seed_oils' && f.matchedIngredient === 'soybean oil')).toBe(true);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'yellow 5')).toBe(true);
  });

  test('regression: genuine bare "Contains wheat." advisory sentence still strips correctly (greedy fallback still works for its intended case)', () => {
    const result = analyzeIngredients('sunflower seeds, dried cranberries, sea salt. Contains wheat.', [], 2);
    expect(result.flags).toHaveLength(0);
    expect(result.verdict).toBe('green');
  });

  test('regression: "contains 2% or less of the following, salt" (comma-terminated, no colon) does not leak "the following" as its own unverified token', () => {
    const result = analyzeIngredients('water, contains 2% or less of the following, salt', [], 2);
    expect(result.unverifiedIngredients.some(t => /following/i.test(t))).toBe(false);
  });

  test('regression: "contains one or more of the following" (non-percentage qualifier) is unaffected', () => {
    const result = analyzeIngredients('water, contains one or more of the following, salt', [], 2);
    expect(result.unverifiedIngredients.some(t => /following/i.test(t))).toBe(false);
  });
});

describe('76. ALL_TRIGGERS — meat/dairy corroboration-array suppression from unverifiedIngredients', () => {
  // MEAT_INGREDIENT_TERMS, MEAT_DERIVED_INGREDIENTS, and MILK_DERIVED_INGREDIENTS
  // are now spread into ALL_TRIGGERS (mirroring how FORTIFIED_VITAMINS was added
  // there for the identical reason) so ingredients already corroborated by
  // containsMeatIngredient()/containsMeatDerived()/containsMilkDerived() no
  // longer show up as "unrecognized" in unverifiedIngredients. Display-only —
  // Pass 1 of the unverified-token filter runs entirely independently of
  // flags/verdict calculation, so none of these tests should observe any
  // change to flags or verdict.

  test('"chicken breast" no longer appears in unverifiedIngredients (previously suppressed nowhere despite containsMeatIngredient() === true)', () => {
    const result = analyzeIngredients('chicken breast, water, salt, less than 2% of vinegar, flavorings, dextrose', [], 2);
    expect(result.unverifiedIngredients).not.toContain('chicken breast');
  });

  test('"angus beef" no longer appears in unverifiedIngredients', () => {
    const result = analyzeIngredients('angus beef, water, cultured dextrose, contains less than 2% salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('angus beef');
  });

  test('"whey protein concentrate" no longer appears in unverifiedIngredients (dairy corroboration parity with meat)', () => {
    const result = analyzeIngredients('whey protein concentrate, water, salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('whey protein concentrate');
  });

  test('regression: flags and verdict are completely unaffected by the "chicken breast" fixture — this is a display-only Pass 1 change', () => {
    const result = analyzeIngredients('chicken breast, water, salt, less than 2% of vinegar, flavorings, dextrose', [], 2);
    expect(result.flags.map(f => f.category).sort()).toEqual(
      analyzeIngredients('water, salt, less than 2% of vinegar, flavorings, dextrose', [], 2).flags.map(f => f.category).sort()
    );
    expect(result.verdict).toBe(
      analyzeIngredients('water, salt, less than 2% of vinegar, flavorings, dextrose', [], 2).verdict
    );
  });

  test('regression: flags and verdict are completely unaffected by the "angus beef" fixture', () => {
    const withBeef = analyzeIngredients('angus beef, water, cultured dextrose, contains less than 2% salt', [], 2);
    const withoutBeef = analyzeIngredients('water, cultured dextrose, contains less than 2% salt', [], 2);
    expect(withBeef.flags.map(f => f.category).sort()).toEqual(withoutBeef.flags.map(f => f.category).sort());
    expect(withBeef.verdict).toBe(withoutBeef.verdict);
  });

  test('regression: flags and verdict are completely unaffected by the "whey protein concentrate" fixture', () => {
    const withWhey = analyzeIngredients('whey protein concentrate, water, salt', [], 2);
    const withoutWhey = analyzeIngredients('water, salt', [], 2);
    expect(withWhey.flags.map(f => f.category).sort()).toEqual(withoutWhey.flags.map(f => f.category).sort());
    expect(withWhey.verdict).toBe(withoutWhey.verdict);
  });

  test('regression: "andouille sausage" is now correctly suppressed too (real meat product, already corroborated by containsMeatIngredient())', () => {
    const result = analyzeIngredients('andouille sausage, sea salt', [], 2);
    expect(result.unverifiedIngredients).not.toContain('andouille sausage');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SAFETY NET — drift guards for two recurring bug patterns documented in
// CLAUDE.md:
//   (1) a new reject-severity category added to the engine without a matching
//       handler somewhere downstream (the glyphosate_heavy Node 11b bug,
//       PROMPT_VERSION 24, and the wild-caught Node 5 bug, PROMPT_VERSION 29);
//   (2) an ingredient token ending up in two lists that imply contradictory
//       outcomes — e.g. a "confirmed clean" list and a reject-trigger list
//       (the "chickpea singular/plural correction", PROMPT_VERSION 25, and
//       the still-unfixed WHOLE_FOOD_TOKENS_L2 "dead chickpeas entry" note).
//
// These tests are intentionally data-driven rather than hardcoding "the
// current 9 categories" or "the current N clean tokens" so they keep working
// as new categories/tokens are added in future sessions. No production code
// is exercised differently than it already is — this is read-only
// introspection plus the existing public analyzeIngredients() API.
// ════════════════════════════════════════════════════════════════════════════

describe('SAFETY NET — ConcernCard.jsx CATEGORY_INFO coverage', () => {
  const fs = require('fs');
  const path = require('path');

  /**
   * One isolated trigger per rules-engine category, combined into a single
   * ingredient string. Verified directly (no cross-category interference —
   * each trigger claims its own text span) to produce exactly these 9
   * categories at Level 2: trans_fats, seed_oils, conventional_crops,
   * conventional_eggs, glyphosate_heavy, bioengineering, natural_flavors,
   * additives, gluten_grains.
   */
  const ALL_CATEGORIES_INGREDIENTS =
    'Partially hydrogenated oil, Canola oil, Citric acid, Egg whites, Oats, ' +
    'Bioengineered ingredient, Natural flavors, Yellow 5, Sea salt, Water.';

  /** Reads ConcernCard.jsx as text and extracts CATEGORY_INFO's top-level keys. */
  function getConcernCardCategoryKeys() {
    const filePath = path.join(__dirname, '..', 'components', 'verdict', 'ConcernCard.jsx');
    const source = fs.readFileSync(filePath, 'utf8');
    const startIdx = source.indexOf('const CATEGORY_INFO = {');
    if (startIdx === -1) {
      throw new Error('Could not locate "const CATEGORY_INFO = {" in ConcernCard.jsx — has it been renamed?');
    }
    const endIdx = source.indexOf('\n};', startIdx);
    if (endIdx === -1) {
      throw new Error('Could not locate the closing "};" for CATEGORY_INFO in ConcernCard.jsx.');
    }
    const block = source.slice(startIdx, endIdx);
    const keys = new Set();
    const keyRe = /^\s*([a-zA-Z0-9_]+):\s*\{/gm;
    let m;
    while ((m = keyRe.exec(block)) !== null) keys.add(m[1]);
    return keys;
  }

  test('every category the rules engine emits at Level 2 has a matching CATEGORY_INFO key in ConcernCard.jsx', () => {
    const result = analyzeIngredients(ALL_CATEGORIES_INGREDIENTS, [], 2);
    const emittedCategories = new Set(result.flags.map(f => f.category));

    // Sanity check on the fixture itself — if this ever stops covering a
    // category (e.g. a trigger phrase changes), fail loudly here rather than
    // silently shrinking coverage of the real check below.
    const expectedCategories = [
      'trans_fats', 'seed_oils', 'conventional_crops', 'conventional_eggs',
      'glyphosate_heavy', 'bioengineering', 'natural_flavors', 'additives',
      'gluten_grains',
    ];
    for (const cat of expectedCategories) {
      expect(emittedCategories.has(cat)).toBe(true);
    }

    const categoryInfoKeys = getConcernCardCategoryKeys();
    const missing = [...emittedCategories].filter(cat => !categoryInfoKeys.has(cat));

    if (missing.length > 0) {
      throw new Error(
        `ConcernCard.jsx's CATEGORY_INFO map is missing ${missing.length} categor${missing.length === 1 ? 'y' : 'ies'} ` +
        `emitted by analyzeIngredients(): ${missing.join(', ')}. ` +
        `Add a CATEGORY_INFO entry for each in components/verdict/ConcernCard.jsx.`
      );
    }
  });
});

describe('SAFETY NET — no ingredient token produces contradictory outcomes across lists', () => {
  /**
   * REVIEWED_CLEAN_INGREDIENTS and ALWAYS_IGNORE_INGREDIENTS both represent
   * "this token should never produce a flag" — the former is a display-only
   * unverified-queue suppression list, the latter is masked out of
   * ingredient-level helper checks in scan.js. If either list contains a
   * token that analyzeIngredients() actually flags when scanned on its own,
   * that's a genuine list-content contradiction: the same normalized token is
   * simultaneously "confirmed clean" and a reject/caution trigger. This
   * generalizes the exact check that caught the chickpea singular/plural
   * conflict (PROMPT_VERSION 25) to every entry in both exported lists,
   * rather than relying on catching the next one by hand.
   */
  test('no REVIEWED_CLEAN_INGREDIENTS or ALWAYS_IGNORE_INGREDIENTS token produces a flag when scanned in isolation', () => {
    const conflicts = [];

    for (const token of REVIEWED_CLEAN_INGREDIENTS) {
      const result = analyzeIngredients(token, [], 2);
      if (result.flags.length > 0) {
        const matches = result.flags
          .map(f => `${f.category}(${f.severity}, matched "${f.matchedIngredient}")`)
          .join(', ');
        conflicts.push(`"${token}" is in REVIEWED_CLEAN_INGREDIENTS but analyzeIngredients() flags it: ${matches}`);
      }
    }

    for (const token of ALWAYS_IGNORE_INGREDIENTS) {
      const result = analyzeIngredients(token, [], 2);
      if (result.flags.length > 0) {
        const matches = result.flags
          .map(f => `${f.category}(${f.severity}, matched "${f.matchedIngredient}")`)
          .join(', ');
        conflicts.push(`"${token}" is in ALWAYS_IGNORE_INGREDIENTS but analyzeIngredients() flags it: ${matches}`);
      }
    }

    if (conflicts.length > 0) {
      throw new Error(
        `Found ${conflicts.length} ingredient token(s) that appear in a "never flag" list but are ` +
        `actually flagged by the engine when scanned in isolation:\n` +
        conflicts.map(c => `  - ${c}`).join('\n')
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — bare 'ada' trigger word-boundary guard (PROMPT_VERSION 33)
// ════════════════════════════════════════════════════════════════════════════
//
// Fixes a real false positive surfaced by the "no ingredient token produces
// contradictory outcomes" safety-net test above: the bare 'ada' trigger in
// SYNTHETIC_ADDITIVES (abbreviation for azodicarbonamide) had no
// word-boundary guard, so it substring-matched inside unrelated words.
// "macadamia nuts" (m-a-c-ADA-mia) and "Canada" (C-ADA-...) both produced a
// phantom synthetic-additive reject flag and a false RED verdict with no
// azodicarbonamide anywhere in the product. Fixed with a letter-adjacency
// guard mirroring the existing CONVENTIONAL_EGGS word-boundary check.

describe("SESSION FIX — bare 'ada' trigger word-boundary guard", () => {
  test('"macadamia nuts" no longer triggers a false additives flag', () => {
    const result = analyzeIngredients('Almonds, macadamia nuts, cashews, sea salt.', [], 2);
    expect(result.flags.some(f => f.category === 'additives')).toBe(false);
    expect(result.verdict).not.toBe('red');
  });

  test('a manufacturer statement containing "Canada" no longer triggers a false additives flag', () => {
    const result = analyzeIngredients('Chocolate, sugar, cocoa butter. Product of Canada.', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'ada')).toBe(false);
  });

  test('regression: bare standalone "ADA" (true positive) still correctly flags additives', () => {
    const result = analyzeIngredients('Wheat flour, ADA, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'ada')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('regression: full chemical name "azodicarbonamide" (true positive) still correctly flags additives', () => {
    const result = analyzeIngredients('Wheat flour, azodicarbonamide, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'azodicarbonamide')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('regression: comma-adjacent bare "ADA" (no surrounding spaces) still flags — word boundary is punctuation-aware, not whitespace-only', () => {
    const result = analyzeIngredients('Flour,ADA,salt.', [], 2);
    expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'ada')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — 'oats'/'corn'/'rice' collision-word guards (PROMPT_VERSION 34)
// ════════════════════════════════════════════════════════════════════════════
//
// Fixes three more real false positives from the same "additional findings"
// audit that produced the 'ada' fix above. All three are a short bare
// trigger substring-matching inside one specific, confirmed collision word:
//   - bare 'oats' (GLYPHOSATE_HEAVY, GLUTEN_GRAINS) inside "goats" — e.g.
//     "goat milk", "goats' milk yogurt" — the glyphosate_heavy case is
//     verdict-changing (reject severity, no clearance available on a
//     goat-dairy product with no actual oats).
//   - bare 'corn' (GLUTEN_GRAINS) inside "acorn" — e.g. "acorn squash" —
//     caution-only, does not change verdict.
//   - bare 'rice' (GLUTEN_GRAINS) inside "price" — caution-only, and lower
//     real-world likelihood since ingredients_text is a literal ingredient
//     list, not marketing copy — fixed anyway since it's the same guard.
// Fixed with isImmediatelyPrecededByLetter(), a narrower check than a
// blanket adjacent-letter guard so legitimate matches like 'corn' inside
// "popcorn" (real corn concern) are not broken.

describe("SESSION FIX — 'oats'/'corn'/'rice' collision-word guards", () => {
  test('"goat milk" no longer triggers glyphosate_heavy (fixed via the \'oat milk\' trigger)', () => {
    const result = analyzeIngredients('Goat milk, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.verdict).not.toBe('red');
  });

  test('"goats\' milk yogurt" no longer triggers glyphosate_heavy or gluten_grains (fixed via the bare \'oats\' trigger)', () => {
    const result = analyzeIngredients("Goats' milk yogurt, sea salt.", [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
    expect(result.verdict).not.toBe('red');
  });

  test('regression: bare "oats" as its own ingredient still correctly triggers glyphosate_heavy and gluten_grains', () => {
    const result = analyzeIngredients('Oats, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'oats')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'oats')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('regression: "rolled oats" (longer trigger) still correctly triggers both flags', () => {
    const result = analyzeIngredients('Rolled oats, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'rolled oats')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'rolled oats')).toBe(true);
  });

  test('regression: a real "Oat milk" product still correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Oat milk, cane sugar, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'oat milk')).toBe(true);
  });

  test('"acorn squash" no longer triggers gluten_grains', () => {
    const result = analyzeIngredients('Acorn squash, sea salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  test('regression: bare "corn" as its own ingredient still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Corn, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
  });

  test('regression: "popcorn" still correctly triggers gluten_grains — the guard must not blanket-suppress every letter-adjacent "corn"', () => {
    const result = analyzeIngredients('Popcorn, sea salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
  });

  test('"suggested retail price" no longer triggers anything from the \'rice\' trigger', () => {
    const result = analyzeIngredients('Suggested retail price may vary, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'rice')).toBe(false);
  });

  test('regression: bare "rice" as its own ingredient still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Rice, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'rice')).toBe(true);
  });

  test('regression: "brown rice" (longer trigger) still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Brown rice, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'brown rice')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — allowlist-based redesign of the collision-word guard (PROMPT_VERSION 35)
// ════════════════════════════════════════════════════════════════════════════
//
// Replaces isImmediatelyPrecededByLetter() (a per-letter denylist that
// required hand-confirming one specific collision letter per call site) with
// isPrecededByLetterUnlessAllowlisted() — a strict default (any letter
// immediately before a bare trigger blocks the match) plus a short, explicit
// TRIGGER_ADJACENCY_ALLOWLIST for confirmed-legitimate compounds ('popcorn',
// 'groats'). This automatically closes 'rice'/"licorice" (the urgent fix this
// session), 'corn'/"unicorn", and 'oats'/"coats" — three collisions the
// previous per-letter design could not catch without a new hardcoded letter
// for each one.

describe('SESSION FIX — allowlist-based collision-word guard redesign', () => {
  test('"licorice" no longer triggers gluten_grains via the \'rice\' trigger', () => {
    const result = analyzeIngredients('Licorice, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'rice')).toBe(false);
  });

  test('"licorice root extract" no longer triggers gluten_grains via the \'rice\' trigger', () => {
    const result = analyzeIngredients('Licorice root extract, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'rice')).toBe(false);
  });

  test('"black licorice" no longer triggers gluten_grains via the \'rice\' trigger', () => {
    const result = analyzeIngredients('Black licorice, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'rice')).toBe(false);
  });

  test('regression: real "rice" still correctly triggers gluten_grains after the redesign', () => {
    const result = analyzeIngredients('Rice, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'rice')).toBe(true);
  });

  test('regression: real "brown rice" still correctly triggers gluten_grains after the redesign', () => {
    const result = analyzeIngredients('Brown rice, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'brown rice')).toBe(true);
  });

  test('"unicorn sprinkles" no longer triggers gluten_grains via the \'corn\' trigger (auto-blocked by the new general default, no per-letter enumeration needed)', () => {
    const result = analyzeIngredients('Unicorn sprinkles, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
  });

  test('"coats" no longer triggers glyphosate_heavy or gluten_grains via the \'oats\' trigger (auto-blocked by the new general default)', () => {
    const result = analyzeIngredients('Coats of chocolate, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'oats')).toBe(false);
  });

  test('regression: "popcorn" (allowlisted compound) still correctly triggers gluten_grains via the \'corn\' trigger', () => {
    const result = analyzeIngredients('Popcorn, sea salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
  });

  test('regression: "oat groats" (allowlisted compound) still correctly triggers glyphosate_heavy — the redesign initially broke this until \'groats\' was added to the allowlist', () => {
    const result = analyzeIngredients('Water, oat groats, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'oat groats')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('regression: "goat milk" / "goats\' milk yogurt" still correctly blocked after the redesign (previous session\'s fix)', () => {
    const goatMilk = analyzeIngredients('Goat milk, salt.', [], 2);
    expect(goatMilk.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);

    const goatsMilkYogurt = analyzeIngredients("Goats' milk yogurt, sea salt.", [], 2);
    expect(goatsMilkYogurt.flags.some(f => f.category === 'glyphosate_heavy')).toBe(false);
    expect(goatsMilkYogurt.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  test('regression: "acorn squash" / "suggested retail price" still correctly blocked after the redesign (previous session\'s fix)', () => {
    const acorn = analyzeIngredients('Acorn squash, sea salt, water.', [], 2);
    expect(acorn.flags.some(f => f.category === 'gluten_grains')).toBe(false);

    const price = analyzeIngredients('Suggested retail price may vary, salt.', [], 2);
    expect(price.flags.some(f => f.matchedIngredient === 'rice')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — 'spelt'/'peas'/'hing' collision guards (PROMPT_VERSION 36)
// ════════════════════════════════════════════════════════════════════════════
//
// Fixes three more collisions found by the ongoing bare-trigger audit and
// left unfixed at the time pending review:
//   - bare 'spelt' (GLYPHOSATE_HEAVY reject + GLUTEN_GRAINS caution) inside
//     "misspelt" — verdict-changing.
//   - bare 'peas' (GLYPHOSATE_HEAVY reject) inside "peasant" (e.g. "peasant
//     bread", a real product/style name) — verdict-changing. Unlike every
//     other collision fixed so far, this is a PREFIX collision ("peasant"
//     starts with "peas" — no letter precedes the match, letters follow),
//     the mirror image of oats/corn/rice/spelt's SUFFIX shape. Required
//     extending isAdjacentToLetterUnlessAllowlisted() with an opt-in
//     `checkAfter` parameter — the previous isPrecededByLetterUnlessAllowlisted()
//     name/before-only design could not catch this at all.
//   - bare 'hing' (GLUTEN_GRAINS caution only) inside "something"/"anything"/
//     "everything"/"nothing" — not verdict-changing, but the highest-frequency
//     false positive found across the whole audit series (these are among
//     the most common words in English).
//
// checkAfter defaults to false and is NOT applied to oats/corn/rice/spelt —
// extending the check to their "after" side would have broken real no-space
// label variants like "cornstarch" and "ricecake" (confirmed via direct
// testing), which rely on the suffix-only match to correctly flag.

describe("SESSION FIX — 'spelt'/'peas'/'hing' collision guards", () => {
  test('"misspelt" no longer triggers glyphosate_heavy or gluten_grains via the \'spelt\' trigger', () => {
    const result = analyzeIngredients('Misspelt ingredient list, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'spelt')).toBe(false);
  });

  test('regression: real "spelt" still correctly triggers glyphosate_heavy and gluten_grains', () => {
    const result = analyzeIngredients('Spelt, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'spelt')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'spelt')).toBe(true);
  });

  test('regression: real "spelt flour" still correctly triggers both flags', () => {
    const result = analyzeIngredients('Spelt flour, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'spelt')).toBe(true);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'spelt flour')).toBe(true);
  });

  test('"peasant bread" no longer triggers glyphosate_heavy via the \'peas\' trigger', () => {
    const result = analyzeIngredients('Peasant bread, sugar, salt.', [], 2);
    expect(result.flags.some(f => f.matchedIngredient === 'peas')).toBe(false);
  });

  test('regression: real "peas" still correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Peas, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'peas')).toBe(true);
  });

  test('regression: real "green peas" still correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Green peas, salt.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'green peas')).toBe(true);
  });

  test('regression: "chickpeas" (its own distinct, longer trigger) is unaffected by the \'peas\' guard', () => {
    const result = analyzeIngredients('Chickpeas, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'chickpeas')).toBe(true);
  });

  test.each(['something', 'anything', 'everything', 'nothing'])(
    '"%s" no longer triggers gluten_grains via the \'hing\' trigger',
    (word) => {
      const result = analyzeIngredients(`${word} bagel seasoning, salt.`, [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'hing')).toBe(false);
    }
  );

  test('regression: real "hing" still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Hing, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'hing')).toBe(true);
  });

  test('regression: real "asafoetida" still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Asafoetida, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'asafoetida')).toBe(true);
  });

  test('regression: parenthetical "hing (asafoetida)" still correctly triggers gluten_grains', () => {
    const result = analyzeIngredients('Hing (asafoetida), salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'hing')).toBe(true);
  });

  test('regression: "cornstarch" (no-space label variant) still correctly triggers via bare \'corn\' — confirms checkAfter was NOT applied to corn', () => {
    const result = analyzeIngredients('Cornstarch, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
  });

  test('regression: "ricecake" (no-space label variant) still correctly triggers via bare \'rice\' — confirms checkAfter was NOT applied to rice', () => {
    const result = analyzeIngredients('Ricecake, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'rice')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — systematic bare-trigger audit batch, closing the 4-session
// audit series (PROMPT_VERSION 37)
// ════════════════════════════════════════════════════════════════════════════
//
// A systematic wordlist audit (274,137-word English dictionary) checked every
// bare short trigger in SYNTHETIC_ADDITIVES, GLUTEN_GRAINS, and
// GLYPHOSATE_HEAVY that lacked a word-boundary guard, then verified each hit
// against the real engine to confirm live false positives. This fixes every
// confirmed collision from that audit in one batch:
//
//   Trigger    | List(s)                          | Collision word(s)
//   -----------|-----------------------------------|----------------------------
//   corn       | GLUTEN_GRAINS + CONVENTIONAL_CROPS| corner, cornea, cornet,
//              | (STANDALONE_CORN_RE regex)         | cornice, cornichon, corned,
//              |                                     | scorn, peppercorn,
//              |                                     | cornflower, cornrow(s)
//   malt       | GLYPHOSATE_HEAVY + GLUTEN_GRAINS   | smalt
//   farro      | GLYPHOSATE_HEAVY + GLUTEN_GRAINS   | farrow, farrowing
//   bha        | SYNTHETIC_ADDITIVES                | bhaji, bhajia, sambhar
//   beans      | GLYPHOSATE_HEAVY                   | jellybeans
//   olean      | SYNTHETIC_ADDITIVES                | oleander (carried over
//              |                                     | from an earlier session)
//   rye        | GLYPHOSATE_HEAVY + GLUTEN_GRAINS   | fryer
//   flax       | GLYPHOSATE_HEAVY                   | toadflax
//   miso       | GLUTEN_GRAINS + CONVENTIONAL_CROPS | semisoft
//   hing       | GLUTEN_GRAINS                      | hinge, hinges, hinged
//
// Plus one true-positive regression found and fixed during verification:
// 'corn' inside "sweetcorn" was being incorrectly SUPPRESSED (a false
// negative, not a false positive) since the 'corn' guard was first added two
// sessions ago — added to TRIGGER_ADJACENCY_ALLOWLIST alongside 'popcorn'.
//
// 'corn' uses a DENYLIST (CORN_COLLISION_DENYLIST) rather than
// checkAfter+allowlist, because legitimate PREFIX-shape corn compounds
// (cornbread, cornmeal, cornstarch, cornflakes, corncob, cornstalk,
// cornhusk, cornfield, sweetcorn, popcorn) vastly outnumber genuine
// collisions — enumerating all of them in an allowlist would be far more
// code and risk than denylisting the handful of confirmed-bad words.
//
// wheat/"wheatless" is intentionally NOT in this batch — see the "Pending
// Policy Decisions" section of CLAUDE.md; it needs a different fix
// mechanism (extending isInFreeOrNonContext for "-less" negation, not
// letter-adjacency) and its own dedicated session.

describe('SESSION FIX — systematic bare-trigger audit batch (corn/malt/farro/bha/beans/olean/rye/flax/miso/hing)', () => {
  describe("'corn' — corner/cornea/cornet/cornice/cornichon/corned/scorn/peppercorn/cornflower/cornrow denylist", () => {
    test.each([
      'corner', 'cornea', 'cornet', 'cornice', 'cornichon', 'scorn', 'peppercorn',
    ])('"%s" no longer triggers a false corn flag', (word) => {
      const result = analyzeIngredients(`${word}, salt, water.`, [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
    });

    test('"corned beef" no longer triggers a false corn flag', () => {
      const result = analyzeIngredients('Corned beef, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
    });

    test('"cornflower extract" no longer triggers a false corn flag', () => {
      const result = analyzeIngredients('Cornflower extract, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
    });

    test('"cornrows" no longer triggers a false corn flag', () => {
      const result = analyzeIngredients('Cornrows, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
    });

    test('regression: bare "corn" still correctly triggers conventional_crops and gluten_grains', () => {
      const result = analyzeIngredients('Corn, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'corn')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
    });

    test.each(['cornbread', 'cornmeal', 'cornstarch', 'cornflakes', 'popcorn'])(
      'regression: legitimate corn compound "%s" still correctly triggers',
      (word) => {
        const result = analyzeIngredients(`${word}, salt, water.`, [], 2);
        expect(result.flags.some(f => f.matchedIngredient === 'corn' || f.matchedIngredient === word)).toBe(true);
      }
    );

    test('regression: "sweetcorn" — a true-positive false NEGATIVE found and fixed during this batch\'s verification — now correctly triggers gluten_grains', () => {
      const result = analyzeIngredients('Sweetcorn, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'corn')).toBe(true);
    });

    test('regression: "acorn squash" / "unicorn sprinkles" (previous sessions\' SUFFIX-shape fixes) still correctly blocked', () => {
      const acorn = analyzeIngredients('Acorn squash, sea salt, water.', [], 2);
      expect(acorn.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
      const unicorn = analyzeIngredients('Unicorn sprinkles, sugar, salt.', [], 2);
      expect(unicorn.flags.some(f => f.matchedIngredient === 'corn')).toBe(false);
    });
  });

  describe("'malt' — smalt (extends existing after-only guard to check both sides)", () => {
    test('"smalt" no longer triggers a false glyphosate_heavy or gluten_grains flag', () => {
      const result = analyzeIngredients('Smalt, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'malt')).toBe(false);
    });

    test('regression: bare "malt" still correctly triggers glyphosate_heavy and gluten_grains', () => {
      const result = analyzeIngredients('Malt, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'malt')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'malt')).toBe(true);
    });

    test('regression: "maltodextrin" still correctly does NOT trigger a false malt flag (the original guard\'s purpose)', () => {
      const result = analyzeIngredients('Maltodextrin, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'malt')).toBe(false);
    });

    test('regression: "maltose" still correctly does NOT trigger a false malt flag', () => {
      const result = analyzeIngredients('Maltose, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'malt')).toBe(false);
    });

    test('regression: "barley malt" (its own longer trigger) still correctly triggers', () => {
      const result = analyzeIngredients('Barley malt, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'barley malt')).toBe(true);
    });
  });

  describe("'farro' — farrow/farrowing", () => {
    test('"farrowing crates" no longer triggers a false glyphosate_heavy or gluten_grains flag', () => {
      const result = analyzeIngredients('Farrowing crates, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'farro')).toBe(false);
    });

    test('regression: bare "farro" still correctly triggers glyphosate_heavy and gluten_grains', () => {
      const result = analyzeIngredients('Farro, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'farro')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'farro')).toBe(true);
    });
  });

  describe("'bha' — bhaji/bhajia/sambhar", () => {
    test.each(['bhaji mix', 'bhajia', 'sambhar powder'])(
      '"%s" no longer triggers a false additives flag',
      (text) => {
        const result = analyzeIngredients(`${text}, salt, water.`, [], 2);
        expect(result.flags.some(f => f.matchedIngredient === 'bha')).toBe(false);
      }
    );

    test('regression: bare "BHA" still correctly triggers additives', () => {
      const result = analyzeIngredients('BHA, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'bha')).toBe(true);
    });
  });

  describe("'beans' — jellybeans", () => {
    test('"jellybeans" no longer triggers a false glyphosate_heavy flag', () => {
      const result = analyzeIngredients('Jellybeans, sugar, salt.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'beans')).toBe(false);
    });

    test('regression: "broad beans" / "horse beans" (space-separated, real bean varieties) still correctly trigger', () => {
      const broadBeans = analyzeIngredients('Broad beans, salt, water.', [], 2);
      expect(broadBeans.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
      const horseBeans = analyzeIngredients('Horse beans, salt, water.', [], 2);
      expect(horseBeans.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
    });

    test('regression: "soybeans" still correctly triggers its own conventional_crops flag, unaffected', () => {
      const result = analyzeIngredients('Soybeans, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'soybeans')).toBe(true);
    });
  });

  describe("'olean' — oleander (carried over from an earlier session's audit)", () => {
    test('"oleander extract" no longer triggers a false additives flag', () => {
      const result = analyzeIngredients('Oleander extract, salt.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'olean')).toBe(false);
    });

    test('regression: bare "olean" still correctly triggers additives', () => {
      const result = analyzeIngredients('Olean, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'olean')).toBe(true);
    });

    test('regression: "olestra" (its own longer, separate trigger) still correctly triggers', () => {
      const result = analyzeIngredients('Olestra, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'additives' && f.matchedIngredient === 'olestra')).toBe(true);
    });
  });

  describe("'rye' — fryer", () => {
    test('"fryer chicken" no longer triggers a false glyphosate_heavy or gluten_grains flag', () => {
      const result = analyzeIngredients('Fryer chicken, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'rye')).toBe(false);
    });

    test('regression: bare "rye" still correctly triggers glyphosate_heavy and gluten_grains', () => {
      const result = analyzeIngredients('Rye, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'rye')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'rye')).toBe(true);
    });

    test('regression: "rye flour" (its own longer trigger) still correctly triggers', () => {
      const result = analyzeIngredients('Rye flour, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'rye flour')).toBe(true);
    });
  });

  describe("'flax' — toadflax", () => {
    test('"toadflax extract" no longer triggers a false glyphosate_heavy flag', () => {
      const result = analyzeIngredients('Toadflax extract, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'flax')).toBe(false);
    });

    test('regression: bare "flax" still correctly triggers glyphosate_heavy', () => {
      const result = analyzeIngredients('Flax, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'flax')).toBe(true);
    });

    test('regression: "flaxseed" (its own longer, separate trigger) still correctly triggers', () => {
      const result = analyzeIngredients('Flaxseed, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'flaxseed')).toBe(true);
    });
  });

  describe("'miso' — semisoft (fixed in BOTH its GLUTEN_GRAINS and CONVENTIONAL_CROPS entries)", () => {
    test('"semisoft cheese" no longer triggers a false conventional_crops or gluten_grains flag', () => {
      const result = analyzeIngredients('Semisoft cheese, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'miso')).toBe(false);
    });

    test('regression: bare "miso" still correctly triggers both conventional_crops and gluten_grains', () => {
      const result = analyzeIngredients('Miso, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'miso')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'miso')).toBe(true);
    });

    test('regression: "miso paste" still correctly triggers both categories', () => {
      const result = analyzeIngredients('Miso paste, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'miso')).toBe(true);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'miso')).toBe(true);
    });
  });

  describe("'hing' — hinge/hinges/hinged (PREFIX shape, needs checkAfter like 'peas')", () => {
    test.each(['hinged container', 'door hinges'])(
      '"%s" no longer triggers a false gluten_grains flag',
      (text) => {
        const result = analyzeIngredients(`${text}, salt, water.`, [], 2);
        expect(result.flags.some(f => f.matchedIngredient === 'hing')).toBe(false);
      }
    );

    test('regression: bare "hing" still correctly triggers gluten_grains', () => {
      const result = analyzeIngredients('Hing, salt, water.', [], 2);
      expect(result.flags.some(f => f.category === 'gluten_grains' && f.matchedIngredient === 'hing')).toBe(true);
    });

    test('regression: "asafoetida" (alternative name, separate trigger) still correctly triggers', () => {
      const result = analyzeIngredients('Asafoetida, salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'asafoetida')).toBe(true);
    });

    test('regression: parenthetical "hing (asafoetida)" still correctly triggers both', () => {
      const result = analyzeIngredients('Hing (asafoetida), salt, water.', [], 2);
      expect(result.flags.some(f => f.matchedIngredient === 'hing')).toBe(true);
      expect(result.flags.some(f => f.matchedIngredient === 'asafoetida')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION FIX — false-negative sweep: cowpeas/broadbeans/horsebeans (PROMPT_VERSION 38)
// ════════════════════════════════════════════════════════════════════════════
//
// A systematic false-negative sweep (the mirror image of the bare-trigger
// audit — checking every guarded trigger's dictionary hits for a legitimate
// compound now silently losing its flag, instead of an unrelated word
// gaining one) found three real edible legumes with zero flags: "cowpeas"
// (black-eyed peas), "broadbeans" (fava beans), "horsebeans" (a horse-feed
// bean variety). All three are one-word compounds of bare 'peas'/'beans'
// with a letter immediately before ("cow", "broad", "horse"), silently
// blocked by the SUFFIX-collision guard since it was first added — the
// two-word spaced forms ("black eyed peas", "broad beans", "horse beans")
// were never affected. Fixed via TRIGGER_ADJACENCY_ALLOWLIST, the same
// mechanism as 'popcorn'/'groats'/'sweetcorn'.
//
// 'pease' (an archaic/dialectal form, e.g. "pease pudding") and 'maltol' (a
// synthesized flavor compound, chemically distinct from actual barley malt
// — a genuine policy question, not a confirmed collision bug) were both
// found by the same sweep but are intentionally NOT fixed here — deferred
// alongside wheat/"wheatless" for a future decision.

describe("SESSION FIX — false-negative sweep: cowpeas/broadbeans/horsebeans", () => {
  test('"cowpeas" (one-word form) now correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Cowpeas, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'peas')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('"broadbeans" (one-word form) now correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Broadbeans, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('"horsebeans" (one-word form) now correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Horsebeans, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
    expect(result.verdict).toBe('red');
  });

  test('regression: "black eyed peas" (spaced form) still correctly triggers glyphosate_heavy', () => {
    const result = analyzeIngredients('Black eyed peas, salt, water.', [], 2);
    expect(result.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'peas')).toBe(true);
  });

  test('regression: "broad beans" / "horse beans" (spaced forms) still correctly trigger glyphosate_heavy', () => {
    const broadBeans = analyzeIngredients('Broad beans, salt, water.', [], 2);
    expect(broadBeans.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
    const horseBeans = analyzeIngredients('Horse beans, salt, water.', [], 2);
    expect(horseBeans.flags.some(f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'beans')).toBe(true);
  });

  test('regression: "peasant bread" / "acorn squash" (previous sessions\' collision fixes) still correctly blocked — confirms the allowlist addition did not reopen anything', () => {
    const peasant = analyzeIngredients('Peasant bread, sugar, salt.', [], 2);
    expect(peasant.flags.some(f => f.matchedIngredient === 'peas')).toBe(false);
    const jellybeans = analyzeIngredients('Jellybeans, sugar, salt.', [], 2);
    expect(jellybeans.flags.some(f => f.matchedIngredient === 'beans')).toBe(false);
  });

  test('regression: "chickpeas" / "soybeans" (their own separate, longer triggers) still correctly trigger, unaffected', () => {
    const chickpeas = analyzeIngredients('Chickpeas, salt, water.', [], 2);
    expect(chickpeas.flags.some(f => f.matchedIngredient === 'chickpeas')).toBe(true);
    const soybeans = analyzeIngredients('Soybeans, salt, water.', [], 2);
    expect(soybeans.flags.some(f => f.category === 'conventional_crops' && f.matchedIngredient === 'soybeans')).toBe(true);
  });
});
