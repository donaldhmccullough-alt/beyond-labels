'use strict';

/**
 * __tests__/components/VerdictScreen.test.js
 *
 * Direct unit tests of getUnverifiedCopy(), exported from VerdictScreen.jsx —
 * this project has no React rendering test infrastructure
 * (jest.config.js sets testEnvironment: 'node', no @testing-library/react;
 * same situation as ConcernCard.jsx/getFallbackSummary and
 * SwapsScreen.jsx/FLAG_CATEGORY_MAP), so <VerdictScreen> itself is never
 * rendered here — only the copy-selection logic is tested directly.
 *
 * Context: a dedicated egg-copy tier was added for the unverifiedReason ===
 * 'no_ingredients' case, gated on productCategory === 'eggs' — the
 * swap-category signal computed server-side via mapProductCategory(), the
 * same real-OFF-tag-derived data isMeat itself is built from. Before this,
 * a pure egg carton with no ingredient data on file got either the
 * (egg-inappropriate) meat-specific copy or the generic fallback, depending
 * on whether the MEAT_CATEGORIES en:eggs removal had shipped yet — see
 * CLAUDE.md for both changelog entries.
 */

const { getUnverifiedCopy } = require('../../components/verdict/VerdictScreen');

const EGG_COPY =
  "Joel here — we don't have enough information to tell you how these hens were raised, and honestly, " +
  "no label on a carton fully answers that either. Your best bet is a local farm or producer you can " +
  "actually ask questions of — someone who can tell you what their hens eat and how much room they have " +
  "to roam. If you are shopping labels, a certified organic or pasture-raised carton is a reasonable " +
  "starting point, but treat it as a data point, not a guarantee. You have the power to choose eggs " +
  "from a source you trust.";

describe('getUnverifiedCopy() — egg copy tier (productCategory === "eggs")', () => {
  test('no_ingredients + productCategory "eggs" → the finalized egg copy, at L1', () => {
    expect(getUnverifiedCopy('no_ingredients', false, 1, 'eggs')).toBe(EGG_COPY);
  });

  test('no_ingredients + productCategory "eggs" → the finalized egg copy, at L2 (copy is not level-differentiated)', () => {
    expect(getUnverifiedCopy('no_ingredients', false, 2, 'eggs')).toBe(EGG_COPY);
  });

  test('egg copy takes priority over the meat branches in the (currently unreachable in real use) case where isMeat is also true', () => {
    expect(getUnverifiedCopy('no_ingredients', true, 1, 'eggs')).toBe(EGG_COPY);
    expect(getUnverifiedCopy('no_ingredients', true, 2, 'eggs')).toBe(EGG_COPY);
  });

  test('regression guard — a real meat product (productCategory "meat", not "eggs") still gets the L1 meat-specific copy', () => {
    const copy = getUnverifiedCopy('no_ingredients', true, 1, 'meat');
    expect(copy).toBe(
      "We couldn't find the ingredient list for this product. Flip the package over and read the label before buying — skip it if you see any synthetic chemicals, artificial additives, artificial flavors, or preservatives."
    );
    expect(copy).not.toBe(EGG_COPY);
  });

  test('regression guard — a real meat product (productCategory "meat", not "eggs") still gets the L2 meat-specific copy', () => {
    const copy = getUnverifiedCopy('no_ingredients', true, 2, 'meat');
    expect(copy).toBe(
      "We couldn't find this product in our database. Look for the USDA Organic seal before buying, and use your best judgment on quality — grass-fed and grass-finished, pasture-raised, or sourced from a farm you trust is always the better choice."
    );
    expect(copy).not.toBe(EGG_COPY);
  });

  test('regression guard — a non-meat, non-egg product still gets the generic no_ingredients fallback', () => {
    const copy = getUnverifiedCopy('no_ingredients', false, 2, null);
    expect(copy).toBe(
      "We found this product but it has no ingredient data on file. We can't screen what we can't see — check the label directly."
    );
    expect(copy).not.toBe(EGG_COPY);
  });

  test('regression guard — omitting productCategory entirely (pre-existing 3-arg call sites) is unaffected — falls through exactly as before', () => {
    expect(getUnverifiedCopy('no_ingredients', true, 1)).toBe(
      "We couldn't find the ingredient list for this product. Flip the package over and read the label before buying — skip it if you see any synthetic chemicals, artificial additives, artificial flavors, or preservatives."
    );
    expect(getUnverifiedCopy('no_ingredients', false, 2)).toBe(
      "We found this product but it has no ingredient data on file. We can't screen what we can't see — check the label directly."
    );
  });

  test('regression guard — the final "couldn\'t identify" fallback (verdict unverified but not no_ingredients) is unaffected, including for productCategory "eggs"', () => {
    const copy = getUnverifiedCopy('not_found', false, 2, 'eggs');
    expect(copy).toBe(
      "We couldn't identify this product. Try scanning again — if it still doesn't work, it may not be in our database yet."
    );
    expect(copy).not.toBe(EGG_COPY);
  });
});
