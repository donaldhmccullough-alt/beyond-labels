'use strict';

/**
 * lib/scanHelpers.test.js
 *
 * Regression coverage for the maskIgnoredIngredients() word-boundary fix.
 *
 * Root cause: maskIgnoredIngredients() masked every ALWAYS_IGNORE_INGREDIENTS
 * term via plain substring search, with no check for whether the term was
 * embedded inside a larger, unrelated word. Bare 'culture' is a literal
 * 7-character substring of 'cultured' (culture + d) — masking it stripped
 * "cultur" + "e" out of "cultured milk", leaving "       d milk", which no
 * longer contains the MILK_DERIVED_INGREDIENTS trigger 'cultured milk' as a
 * contiguous substring. Same mechanism: bare 'salt' is a substring of
 * 'unsalted'/'salted', corrupting the 'unsalted butter'/'salted butter'
 * triggers. Both silently suppressed conventional_dairy detection for real,
 * non-organic dairy products whose only dairy signal was one of these
 * phrases (confirmed via real barcodes 072830005517 "Medium Cheddar" and
 * 041757026288 "Semisoft Cheese" — see CLAUDE.md for the investigation).
 *
 * Fix: maskIgnoredIngredients() now skips masking a match when the
 * character immediately before or after it is a letter (isLetterAdjacentMatch()),
 * applied generally across every ALWAYS_IGNORE_INGREDIENTS term rather than
 * a one-off carve-out for 'culture'/'salt'.
 *
 * A systematic audit (every ALWAYS_IGNORE_INGREDIENTS term x every trigger
 * phrase in MILK_DERIVED_INGREDIENTS, MEAT_DERIVED_INGREDIENTS,
 * FORTIFIED_VITAMINS, NATURAL_COLORANTS, MEAT_INGREDIENT_TERMS — the full
 * set of lists actually consumed via this function's output — found exactly
 * 6 letter-adjacent collisions, all from 'culture' and 'salt', all covered
 * below. A 7th, structurally different finding (bare 'yeast' legitimately
 * masking the "yeast" component of the FORTIFIED_VITAMINS trigger
 * 'selenium yeast', its only selenium-related trigger) is NOT a
 * letter-adjacency collision — 'yeast' is a genuine standalone word within
 * that trigger phrase, not embedded inside a larger word — so this fix does
 * not and should not resolve it. Deliberately left unfixed and untested
 * here; flagged separately for a future session's own decision (see
 * CLAUDE.md "Pending Policy Decisions").
 */

const {
  maskIgnoredIngredients,
  mapProductCategory,
} = require('./scanHelpers');

const {
  containsMilkDerived,
  containsFortifiedVitamins,
} = require('./rulesEngine');

describe('maskIgnoredIngredients() word-boundary fix', () => {
  describe('letter-adjacent collisions no longer corrupt MILK_DERIVED_INGREDIENTS triggers', () => {
    const cases = [
      ['cultured milk', 'cultured milk, salt, enzymes'],
      ['cultured pasteurized milk', 'cultured pasteurized milk, salt'],
      ['cultured lowfat milk', 'cultured lowfat milk, salt'],
      ['cultured butter', 'cultured butter, salt'],
      ['unsalted butter', 'unsalted butter, cocoa'],
      ['salted butter', 'salted butter, cocoa'],
    ];

    test.each(cases)('%s survives masking intact and still matches its trigger', (trigger, text) => {
      const masked = maskIgnoredIngredients(text.toLowerCase());
      expect(masked).toContain(trigger);
      expect(containsMilkDerived(masked)).toBe(true);
    });
  });

  describe('real production repro strings', () => {
    test('Medium Cheddar (barcode 072830005517) — "CULTURED MILK, SALT, ENZYMES, ANNATTO (COLOR)" now flags conventional_dairy', () => {
      const raw = 'CULTURED MILK, SALT, ENZYMES, ANNATTO (COLOR)';
      const masked = maskIgnoredIngredients(raw.toLowerCase());
      expect(masked).toContain('cultured milk');
      expect(containsMilkDerived(masked)).toBe(true);
    });

    test('Semisoft Cheese / Bel (barcode 041757026288) — "PASTEURIZED CULTURED MILK, SALT, QUEST MICROBIAL ENZYMES..." now flags conventional_dairy despite the garbled trailing OCR text', () => {
      const raw = "PASTEURIZED CULTURED MILK, SALT, QUEST MICROBIAL ENZYMES CONTAINS: MILK COMMEN BEL BRANDS USA, CHICAGO,UCT OF FRANCE 1-800-27 PERISHABLE KEEP REFRIGERATIO C TRACYCLE FRTICIPATION LIMITED bel for ally good";
      const masked = maskIgnoredIngredients(raw.toLowerCase());
      expect(masked).toContain('cultured milk');
      expect(containsMilkDerived(masked)).toBe(true);
    });

    test('regression guard: Whole Milk Mozzarella (072830001762) — already-working "pasteurized milk" trigger is unaffected by this fix', () => {
      const raw = 'PASTEURIZED MILK, SALT, CHEESE CULTURES, ENZYMES.';
      const masked = maskIgnoredIngredients(raw.toLowerCase());
      expect(containsMilkDerived(masked)).toBe(true);
    });

    test('regression guard: Light String Cheese (046100007174) — already-working "reduced fat milk" trigger is unaffected by this fix', () => {
      const raw = 'Pasteurized reduced fat milk, cheese culture, salt, enzymes, vitamin a palmitate.';
      const masked = maskIgnoredIngredients(raw.toLowerCase());
      expect(containsMilkDerived(masked)).toBe(true);
    });
  });

  describe('genuinely standalone occurrences are still masked correctly (no over-correction)', () => {
    test('bare "culture" standalone (e.g. "cheese culture") is still masked', () => {
      const masked = maskIgnoredIngredients('cheese culture, salt, enzymes'.toLowerCase());
      expect(masked).not.toContain('culture');
      expect(masked).toContain('cheese');
    });

    test('bare "salt" standalone is still masked', () => {
      const masked = maskIgnoredIngredients('milk, salt, enzymes'.toLowerCase());
      expect(masked).not.toMatch(/\bsalt\b/);
    });

    test('"cheese cultures" (plural, its own longer ignore-term) is still masked whole', () => {
      const masked = maskIgnoredIngredients('pasteurized milk, salt, cheese cultures, enzymes.'.toLowerCase());
      expect(masked).not.toContain('cultures');
      // The already-working 'pasteurized milk' trigger must remain intact.
      expect(masked).toContain('pasteurized milk');
    });

    test('word-boundary check does not block masking at the very start/end of the string', () => {
      // 'salt' at the very start of the string (no character before it at all)
      // and 'enzymes' at the very end (no character after it at all) must
      // still mask normally — isLetterAdjacentMatch() must treat "no
      // character" as "not a letter", not throw or misbehave at string edges.
      const masked = maskIgnoredIngredients('salt, milk, enzymes'.toLowerCase());
      expect(masked).not.toMatch(/\bsalt\b/);
      expect(masked.trimEnd()).not.toMatch(/enzymes$/);
    });
  });

  describe('known, deliberately unresolved finding from the Step 1 audit (not fixed by this change)', () => {
    test('bare "yeast" still corrupts FORTIFIED_VITAMINS trigger "selenium yeast" — different bug shape (standalone word, not letter-adjacent), tracked separately, not addressed by this fix', () => {
      const raw = 'organic wheat, selenium yeast, water';
      const masked = maskIgnoredIngredients(raw.toLowerCase());
      // This assertion documents CURRENT (still-incorrect) behavior on
      // purpose — see CLAUDE.md "Pending Policy Decisions". If this test
      // starts failing because someone fixed the underlying issue, update
      // this test (don't just delete it) to assert the corrected behavior.
      expect(containsFortifiedVitamins(masked)).toBe(false);
      expect(containsFortifiedVitamins(raw.toLowerCase())).toBe(true);
    });
  });
});

describe('CATEGORY_TAG_MAP — en:milk-substitutes added to top-level beverages list', () => {
  // Already present in SUBCATEGORY_TAG_MAP.beverages's plant_milk group since
  // the Phase 1 subcategory session, but never added at the top-level
  // CATEGORY_TAG_MAP — a product carrying only this tag (not
  // en:plant-based-milk-alternatives) never reached mapProductCategory() at
  // all. Confirmed real via a direct OFF lookup during the null-category
  // audit: Almond Breeze Unsweetened Vanilla almondmilk (041570054161)
  // carries en:milk-substitutes and en:dairy-substitutes but not
  // en:plant-based-milk-alternatives. See CLAUDE.md for the investigation.

  test('a product carrying only en:milk-substitutes (no other beverages tag) now maps to product_category: beverages', () => {
    expect(mapProductCategory(['en:milk-substitutes'])).toBe('beverages');
  });

  test('real repro shape — en:dairy-substitutes + en:milk-substitutes + en:plant-based-foods-and-beverages (Almond Breeze\'s actual tag set) maps to beverages', () => {
    expect(mapProductCategory([
      'en:plant-based-foods-and-beverages',
      'en:plant-based-foods',
      'en:dairy-substitutes',
      'en:milk-substitutes',
    ])).toBe('beverages');
  });

  test('regression guard — a product with no beverages tag at all is still unaffected (returns null)', () => {
    expect(mapProductCategory(['en:snacks'])).toBe('snacks');
    expect(mapProductCategory(['en:not-a-real-tag'])).toBe(null);
  });
});
