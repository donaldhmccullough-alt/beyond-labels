'use strict';

/**
 * __tests__/scripts/backfillSwapProductSubcategories.test.js
 *
 * Direct unit tests of classify() from scripts/backfillSwapProductSubcategories.js
 * — the keyword-matching logic used to best-effort classify existing
 * swap_products rows. Requiring the script does NOT trigger a live Supabase
 * call: main() only runs when the file is executed directly via `node`
 * (require.main === module guard), never when required as a module.
 *
 * Covers the follow-up session's four fixes:
 *   A. plant_milk keyword detection (beverages)
 *   B. the 6 redesigned bread subcategories
 *   C. chips defaulting to 'other' on zero keyword matches
 *   D. the dairy milk/yogurt tie-break rule (prefers yogurt)
 */

const { classify } = require('../../scripts/backfillSwapProductSubcategories');

// ════════════════════════════════════════════════════════════════════════════
// A. plant_milk keyword detection
// ════════════════════════════════════════════════════════════════════════════

describe('A. beverages:plant_milk detection', () => {
  test.each([
    ['Malk Organics Oat Milk', ''],
    ['Elmhurst 1925 Oat Milk', ''],
    ['Silk Almond Milk', ''],
    ['Almond Breeze Unsweetened Almond Milk', ''],
    ['Original Soy Milk', ''],
    ['REBBL Organic Coconut Milk Elixir', ''],
    ['Cashew Milk Unsweetened', ''],
    ['Macadamia Milk Original', ''],
    ['Generic Plant Milk', ''],
    ['Elmhurst Non-Dairy Milk', ''],
    ['Califia Farms Oat Barista Blend', 'Califia Farms'],
  ])('"%s" (brand: %s) → plant_milk', (productName, brand) => {
    expect(classify('beverages', productName, brand)).toBe('plant_milk');
  });

  test('"oatmilk" (no space) still matches', () => {
    expect(classify('beverages', 'Planet Oat Extra Creamy Oatmilk', '')).toBe('plant_milk');
  });

  test('a real dairy milk product filed under beverages does NOT match plant_milk (no plant qualifier)', () => {
    expect(classify('beverages', 'Organic Valley Grassmilk Whole Milk', 'Organic Valley')).toBeNull();
  });

  test('unrelated beverage (coconut water, not coconut milk) does not match plant_milk', () => {
    expect(classify('beverages', 'Harmless Harvest Organic Coconut Water', 'Harmless Harvest')).toBeNull();
  });

  test('existing beverages subcategories still work unaffected by the plant_milk addition', () => {
    expect(classify('beverages', 'Classic Cola Soda', '')).toBe('soda');
    expect(classify('beverages', '100% Orange Juice', '')).toBe('juice');
    expect(classify('beverages', 'Sparkling Water', '')).toBe('sparkling_water');
    expect(classify('beverages', 'Ground Coffee', '')).toBe('coffee_tea');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Redesigned bread subcategories
// ════════════════════════════════════════════════════════════════════════════

describe('B. bread subcategory redesign (sprouted_grain, gluten_free, keto_low_carb, sandwich, bagels_muffins, tortillas_wraps)', () => {
  test('sprouted_grain: "Sprouted 7 Grain Bread"', () => {
    expect(classify('bread', 'Sprouted 7 Grain Bread', 'Simply Nature')).toBe('sprouted_grain');
  });

  test('gluten_free: "Gluten Free" phrase form', () => {
    expect(classify('bread', 'Gluten Free Multigrain Bread', 'Trader Joe\'s')).toBe('gluten_free');
  });

  test('gluten_free: hyphenated "Gluten-Free" phrase also matches', () => {
    expect(classify('bread', 'Gluten-Free Whole Grain Bread', '')).toBe('gluten_free');
  });

  test('gluten_free: bare "GF" abbreviation matches as a standalone word', () => {
    expect(classify('bread', 'GF Classic White Bread', '')).toBe('gluten_free');
  });

  test('gluten_free: "gf" is a word-boundary match, not substring — embedded inside another word does not false-positive', () => {
    // "Wagfield" contains the literal substring "gf" but not as a standalone
    // word — \bgf\b must not match here, and no other bread keyword group
    // matches this name either, so the whole thing resolves to null.
    expect(classify('bread', 'Wagfield Bakery Bread', '')).toBeNull();
  });

  test('bagels_muffins no longer matches bare "bun" (redesigned from bagels_buns this session) — "Hamburger Buns" alone now resolves to null', () => {
    expect(classify('bread', 'Hamburger Buns', 'Aldi')).toBeNull();
  });

  test('keto_low_carb: "Original Keto Bread"', () => {
    expect(classify('bread', 'Original Keto Bread', 'Base Culture')).toBe('keto_low_carb');
  });

  test('keto_low_carb: "Low Carb White Bread"', () => {
    expect(classify('bread', 'Low Carb White Bread', 'Higher Harvest')).toBe('keto_low_carb');
  });

  test('keto_low_carb: hyphenated "low-carb" also matches', () => {
    expect(classify('bread', 'Low-Carb Linseed Bread', '')).toBe('keto_low_carb');
  });

  test('sandwich: "White Sandwich Bread"', () => {
    expect(classify('bread', 'White Sandwich Bread', 'Great Value')).toBe('sandwich');
  });

  test('sandwich: "loaf" keyword', () => {
    expect(classify('bread', 'Classic White Loaf', '')).toBe('sandwich');
  });

  test('bagels_muffins: "English Muffins"', () => {
    expect(classify('bread', 'Original English Muffins', 'Great Value')).toBe('bagels_muffins');
  });

  test('bagels_muffins: bare "Bagels"', () => {
    expect(classify('bread', 'Everything Bagels', 'Great Value')).toBe('bagels_muffins');
  });

  test('tortillas_wraps: "Flour Tortillas" (unchanged from before this session)', () => {
    expect(classify('bread', 'Homestyle Flour Tortillas', 'Trader Joe\'s')).toBe('tortillas_wraps');
  });

  test('tortillas_wraps: "wrap"', () => {
    expect(classify('bread', 'Soft Flour Tortilla Wraps', '')).toBe('tortillas_wraps');
  });

  test('a plain bread name with no matching keyword stays null (bread has NO no-match default, unlike chips)', () => {
    expect(classify('bread', "Dave's Killer Bread Organic 21 Whole Grains", "Dave's Killer Bread")).toBeNull();
  });

  test('the old retired subcategory values ("sliced" alone, "bagels_buns") are no longer produced', () => {
    // "Sliced" alone (no "sandwich"/"loaf") still resolves via the 'sandwich'
    // group's own "sliced" keyword — confirming the OLD bucket name "sliced"
    // itself is never returned, only the new "sandwich" bucket.
    expect(classify('bread', 'White Sliced Bread', '')).toBe('sandwich');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. chips defaults to 'other' on zero keyword matches
// ════════════════════════════════════════════════════════════════════════════

describe('C. chips → "other" default on zero matches', () => {
  test('a chips product matching none of tortilla/potato/veggie defaults to "other"', () => {
    expect(classify('chips', 'Barnana Organic Plantain Chips', 'Barnana')).toBe('other');
  });

  test('real tortilla/potato/veggie matches are unaffected by the new default', () => {
    expect(classify('chips', 'Organic Tortilla Chips', '')).toBe('tortilla');
    expect(classify('chips', 'Classic Potato Chips', '')).toBe('potato');
    expect(classify('chips', 'Garden Veggie Chips', '')).toBe('veggie');
  });

  test('an ambiguous chips match (two keyword groups) still stays null, NOT "other" — the default only applies to ZERO matches', () => {
    expect(classify('chips', 'Potato and Veggie Tortilla Chips', '')).toBeNull();
  });

  test('the "other" default is NOT applied to any other category — dairy/meat/beverages/bread all still return null on zero matches', () => {
    expect(classify('dairy', 'Generic Dairy Product', '')).toBeNull();
    expect(classify('meat', 'Generic Meat Product', '')).toBeNull();
    expect(classify('beverages', 'Generic Beverage', '')).toBeNull();
    expect(classify('bread', 'Generic Bread Product', '')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. dairy milk/yogurt tie-break rule
// ════════════════════════════════════════════════════════════════════════════

describe('D. dairy milk/yogurt tie-break (prefers yogurt)', () => {
  test.each([
    "Siggi's Plain Whole Milk Yogurt",
    'Chobani Plain Whole Milk Yogurt',
    'Stonyfield Organic Whole Milk Yogurt',
    "Nancy's Organic Whole Milk Yogurt",
  ])('"%s" matches both milk and yogurt → resolves to yogurt, not null', (productName) => {
    expect(classify('dairy', productName, '')).toBe('yogurt');
  });

  test('milk alone (no yogurt keyword) still resolves to milk, unaffected by the tie-break', () => {
    expect(classify('dairy', 'Whole Milk', 'Organic Valley')).toBe('milk');
  });

  test('yogurt alone (no milk keyword) still resolves to yogurt directly, not via the tie-break path', () => {
    expect(classify('dairy', 'Plain Greek Yogurt', '')).toBe('yogurt');
  });

  test('the tie-break is specific to milk+yogurt — a cheese+butter ambiguous match still stays null', () => {
    // Constructed name that plausibly matches both cheese and butter keyword
    // groups, to confirm the tie-break rule does not generalize beyond the
    // one documented milk/yogurt case.
    expect(classify('dairy', 'Cheese and Butter Spread', '')).toBeNull();
  });
});
