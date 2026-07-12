'use strict';

/**
 * __tests__/components/SwapsScreen.test.js
 *
 * SwapsScreen.jsx is a 'use client' React component and this project has no
 * React rendering test infrastructure (jest.config.js sets
 * testEnvironment: 'node', no @testing-library/react) — so this file does
 * NOT render the component, and never will as long as that's true. It only
 * imports plain, module-scope functions/data extracted specifically to make
 * pieces of the component's logic testable without rendering — see the
 * comment above each export in SwapsScreen.jsx. That's a deliberate,
 * repeated pattern in this file, not a one-off: FLAG_CATEGORY_MAP (Phase 1)
 * and getVisibleSwaps()/shouldShowExpandButton() (Phase 2, "Show More") are
 * both handled this way. Anything that can only be verified by actually
 * rendering — e.g. that tapping the real "Show More" button calls
 * setGoodExpanded(true), or that the button's JSX only appears under the
 * right conditions — is NOT covered here and would need a real rendering
 * setup (jsdom + @testing-library/react) to test; that's out of scope for
 * this session per the "skip rather than force something fragile" guidance.
 *
 * Importing the module is still safe under testEnvironment: 'node' — the
 * component function body (which uses useState/useEffect/JSX) is never
 * invoked, only defined; module-scope evaluation is just the plain
 * functions/objects below.
 */

const {
  FLAG_CATEGORY_MAP,
  INITIAL_VISIBLE_SWAPS,
  getVisibleSwaps,
  shouldShowExpandButton,
} = require('../../components/swaps/SwapsScreen');

describe('FLAG_CATEGORY_MAP (SwapsScreen.jsx fallback category mapping)', () => {
  test('conventional_meat maps to "meat" (Phase 1 fix, July 2026 — was null, dead-ending to no swaps)', () => {
    expect(FLAG_CATEGORY_MAP.conventional_meat).toBe('meat');
  });

  test('every other existing mapping is unchanged', () => {
    expect(FLAG_CATEGORY_MAP).toMatchObject({
      trans_fats:          'condiments',
      seed_oils:           'snacks',
      conventional_crops:  'snacks',
      bioengineering:      'snacks',
      natural_flavors:     'snacks',
      synthetic_additives: 'snacks',
      gluten_grains:       'cereal',
    });
  });

  test('no entry maps to null anymore', () => {
    for (const [flagCategory, mappedCategory] of Object.entries(FLAG_CATEGORY_MAP)) {
      expect(mappedCategory).not.toBeNull();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// "Show More" expansion (Phase 2 of the swaps overhaul, July 2026)
// ════════════════════════════════════════════════════════════════════════════

describe('INITIAL_VISIBLE_SWAPS', () => {
  test('is 3 — the number of items shown before "Show More" is tapped', () => {
    expect(INITIAL_VISIBLE_SWAPS).toBe(3);
  });
});

describe('getVisibleSwaps(items, expanded)', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('not expanded → returns only the first 3 items', () => {
    expect(getVisibleSwaps(items, false)).toEqual(['a', 'b', 'c']);
  });

  test('expanded → returns all items, not just the first 3', () => {
    expect(getVisibleSwaps(items, true)).toEqual(items);
  });

  test('not expanded, 3 or fewer items → returns all of them unchanged (no truncation below the threshold)', () => {
    expect(getVisibleSwaps(['a', 'b'], false)).toEqual(['a', 'b']);
  });

  test('empty array, either expanded state → returns an empty array', () => {
    expect(getVisibleSwaps([], false)).toEqual([]);
    expect(getVisibleSwaps([], true)).toEqual([]);
  });
});

describe('shouldShowExpandButton(items, expanded, source)', () => {
  const fourItems = ['a', 'b', 'c', 'd'];
  const threeItems = ['a', 'b', 'c'];

  test('more than 3 items, not expanded, curated source → true', () => {
    expect(shouldShowExpandButton(fourItems, false, 'curated')).toBe(true);
  });

  test('already expanded → false, even with more than 3 items (one-way expand, no collapse-back UI needed)', () => {
    expect(shouldShowExpandButton(fourItems, true, 'curated')).toBe(false);
  });

  test('3 or fewer items, not expanded → false (nothing to expand into)', () => {
    expect(shouldShowExpandButton(threeItems, false, 'curated')).toBe(false);
  });

  test('AI-generated source → always false, even with more than 3 items and not expanded', () => {
    expect(shouldShowExpandButton(fourItems, false, 'ai')).toBe(false);
  });

  test('AI source combined with already-expanded and few items → still false (every condition independently fails)', () => {
    expect(shouldShowExpandButton(threeItems, true, 'ai')).toBe(false);
  });
});
