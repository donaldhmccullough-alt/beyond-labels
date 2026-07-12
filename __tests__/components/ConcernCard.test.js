'use strict';

/**
 * __tests__/components/ConcernCard.test.js
 *
 * Direct unit tests of getFallbackSummary(), exported from ConcernCard.jsx —
 * this project has no React rendering test infrastructure
 * (jest.config.js sets testEnvironment: 'node', no @testing-library/react;
 * same situation as SwapsScreen.jsx/FLAG_CATEGORY_MAP), so the actual
 * <ConcernCard> component is never rendered here — only the extracted
 * fallback-selection logic is tested directly.
 *
 * Context: when the AI-generated explanation for a category is missing
 * (explanation?.details?.[cat] is undefined — whether because the whole AI
 * explanation call failed, or just this one category's entry is absent for
 * some other reason), ConcernCard now falls back to the rules engine's own
 * flag.summary text instead of rendering nothing. See CLAUDE.md for the
 * investigation that surfaced this (the "Nutty Buddy Creme Pies" 7-category
 * null-explanation row).
 */

const { getFallbackSummary } = require('../../components/verdict/ConcernCard');

function makeFlag(overrides = {}) {
  return {
    category: 'conventional_crops',
    severity: 'reject',
    matchedIngredient: 'sugar',
    summary: 'Contains conventional "sugar" — likely sourced from GE crops or grown with heavy synthetic pesticide and herbicide use.',
    ...overrides,
  };
}

describe('getFallbackSummary()', () => {
  test('single flag: returns its summary', () => {
    const flags = [makeFlag()];
    expect(getFallbackSummary(flags)).toBe(flags[0].summary);
  });

  test('multiple flags in one category: returns the first flag\'s summary, not a joined/repeated list', () => {
    const flags = [
      makeFlag({ matchedIngredient: 'sugar', summary: 'Contains conventional "sugar" — likely sourced from GE crops.' }),
      makeFlag({ matchedIngredient: 'riboflavin', summary: 'Contains conventional "riboflavin" — likely sourced from GE crops.' }),
      makeFlag({ matchedIngredient: 'corn', summary: 'Contains conventional "corn" — over 90% of US field corn is GE.' }),
    ];
    const result = getFallbackSummary(flags);
    expect(result).toBe(flags[0].summary);
    // Confirms this is a single sentence, not a concatenation of all three —
    // stacking near-duplicate template sentences (one per matched
    // ingredient) would read as repetitive noise for high-flag categories
    // like conventional_crops, which can carry a dozen+ flags.
    expect(result).not.toContain(flags[1].summary);
    expect(result).not.toContain(flags[2].summary);
  });

  test('a flag with no summary field returns null, not undefined or an empty string', () => {
    const flags = [makeFlag({ summary: undefined })];
    expect(getFallbackSummary(flags)).toBeNull();
  });

  test('a flag with an empty-string summary returns null (falsy fallback)', () => {
    const flags = [makeFlag({ summary: '' })];
    expect(getFallbackSummary(flags)).toBeNull();
  });

  test('empty flags array returns null', () => {
    expect(getFallbackSummary([])).toBeNull();
  });

  test('undefined flags returns null (defensive — should not throw)', () => {
    expect(getFallbackSummary(undefined)).toBeNull();
  });
});

describe('ConcernCard explanation-vs-fallback selection (the `explanation || getFallbackSummary(flags)` logic)', () => {
  // ConcernCard itself isn't rendered (no React test infra), but its
  // selection logic is a one-line expression — mirror it directly here so
  // the three real-world scenarios this task asked for are covered without
  // needing rendering infrastructure.
  function selectDisplayExplanation(explanation, flags) {
    return explanation || getFallbackSummary(flags);
  }

  test('AI explanation present for this category: fallback is NOT used, even though flags also have summaries', () => {
    const flags = [makeFlag()];
    const aiExplanation = 'Sina here — this conventional sugar likely comes from GE sugar beets...';
    expect(selectDisplayExplanation(aiExplanation, flags)).toBe(aiExplanation);
  });

  test('AI explanation missing for this category (whole explanation object is null): falls back to flag.summary', () => {
    const flags = [makeFlag()];
    expect(selectDisplayExplanation(undefined, flags)).toBe(flags[0].summary);
  });

  test('AI explanation object exists overall, but this specific category\'s details entry is absent: same fallback applies', () => {
    // Mirrors VerdictScreen.jsx passing explanation?.details?.[cat] down —
    // from ConcernCard's perspective this looks identical to the
    // whole-explanation-null case: its own `explanation` prop is undefined
    // either way, so the same fallback logic covers both scenarios with no
    // special-casing needed.
    const flags = [makeFlag({ category: 'additives', matchedIngredient: 'tbhq', summary: 'Contains "tbhq" — a synthetic additive with documented links to adverse health effects.' })];
    const explanationDetailsForThisCategory = undefined; // details.additives was never set
    expect(selectDisplayExplanation(explanationDetailsForThisCategory, flags)).toBe(flags[0].summary);
  });

  test('multiple flags, no AI explanation: fallback renders sensibly as one representative sentence', () => {
    const flags = [
      makeFlag({ matchedIngredient: 'cottonseed oil', summary: 'Contains "cottonseed oil" — a refined seed oil.' }),
      makeFlag({ matchedIngredient: 'soybean oil', summary: 'Contains "soybean oil" — a refined seed oil.' }),
      makeFlag({ matchedIngredient: 'palm kernel oil', summary: 'Contains "palm kernel oil" — a refined seed oil.' }),
    ];
    const result = selectDisplayExplanation(null, flags);
    expect(result).toBe(flags[0].summary);
    expect(typeof result).toBe('string');
  });
});
