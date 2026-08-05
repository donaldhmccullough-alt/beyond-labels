'use strict';

/**
 * __tests__/api/explain.test.js
 *
 * Tests the standalone /api/explain endpoint directly (no HTTP server
 * required). This endpoint previously had ZERO test coverage anywhere in
 * the codebase — added as part of the fix for the raw-JSON-in-summary bug
 * (see CLAUDE.md changelog). VerdictScreen never calls this endpoint
 * directly (per CLAUDE.md — explanations are always returned inline from
 * /api/scan), but it shares the exact same parseExplanationResponse()
 * parsing logic, so it needs the same regression coverage.
 *
 * Test suites:
 *   A. parseExplanationResponse() — direct unit tests of the shared helper
 *   B. Handler — input validation
 *   C. Handler — Claude response parsing (clean / fenced / truncated)
 */

const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

const handler = require('../../pages/api/explain').default;
const { parseExplanationResponse, buildUserMessage, SYSTEM_PROMPT } = require('../../pages/api/explain');

function makeReq(method = 'POST', body = {}) {
  return { method, body };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data)   { this.body = data;       return this; },
  };
  return res;
}

// ════════════════════════════════════════════════════════════════════════════
// A. parseExplanationResponse() — direct unit tests
// ════════════════════════════════════════════════════════════════════════════

describe('A. parseExplanationResponse()', () => {
  test('A1: clean, well-formed JSON parses directly', () => {
    const result = parseExplanationResponse('{"summary":"Clean.","details":{}}');
    expect(result).toEqual({ summary: 'Clean.', details: {} });
  });

  test('A2: JSON wrapped in a ```json markdown fence, with a valid closing brace, recovers via regex', () => {
    const result = parseExplanationResponse(
      '```json\n{"summary":"Has issues.","details":{"seed_oils":"Sina here — canola oil."}}\n```'
    );
    expect(result).toEqual({
      summary: 'Has issues.',
      details: { seed_oils: 'Sina here — canola oil.' },
    });
  });

  test('A3: genuinely truncated response with no closing brace at all → returns null, not the raw text', () => {
    // Exact production reproduction shape.
    const result = parseExplanationResponse(
      '```json\n{\n  "summary": "This product has three significant issues: safflower oil (a seed oil that drives inflammation), conventional grain ingredients (grown with pesticides and GMO'
    );
    expect(result).toBeNull();
  });

  test('A4: a complete but internally-invalid JSON span (unescaped quote) → returns null, does not throw', () => {
    const result = parseExplanationResponse('{"summary": "She said "hello" to me.", "details": {}}');
    expect(result).toBeNull();
  });

  test('A5: leading/trailing prose around a complete JSON block still recovers via regex', () => {
    const result = parseExplanationResponse(
      'Here is the explanation:\n{"summary":"Fine.","details":{}}\nLet me know if you need more.'
    );
    expect(result).toEqual({ summary: 'Fine.', details: {} });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A2. buildUserMessage() — clearedBy: 'organic' + verdict: 'red' (Phase B)
//
// This combination did not exist before the L2 tree flag-injection change
// (Part 2/3): previously an instant-red flag always discarded clearedBy to
// null, so buildUserMessage() never had to reason about an organic-cleared
// product that was also red. Confirms the new combination routes through the
// same "Flagged categories" branch as any other flagged product — clearedBy
// is only ever consulted in flagsSection's "no flags" branches, which never
// apply here since flags is non-empty.
// ════════════════════════════════════════════════════════════════════════════

describe("A2. buildUserMessage() — clearedBy: 'organic' + verdict: 'red'", () => {
  test('flags present + clearedBy "organic" + verdict "red" → routes through the normal "Flagged categories" branch, not a cert/cleared-specific one', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'additives', severity: 'reject', matchedIngredient: 'red 40', summary: 'x' }],
      'Test Product',
      'organic oats, folic acid, cyanocobalamin, red 40',
      2,
      'organic',
      null
    );
    expect(message).toContain('Flagged categories:');
    expect(message).toContain('additives (reject): found "red 40"');
    // None of the "no flags" branch strings should appear — confirms clearedBy
    // is not accidentally routing this into the cert_unconfirmed/default-yellow/
    // pure_water text despite being 'organic'.
    expect(message).not.toContain('could not confirm USDA organic certification');
    expect(message).not.toContain('pure water product');
    expect(message).not.toContain('did not meet Level 2 certification standards');
  });

  test('same combination but with a second flagged category (fortified_vitamins alongside additives) → both appear, still via the normal branch', () => {
    const message = buildUserMessage(
      'red',
      [
        { category: 'additives', severity: 'reject', matchedIngredient: 'red 40', summary: 'x' },
        { category: 'fortified_vitamins', severity: 'caution', matchedIngredient: '', summary: 'y' },
      ],
      'Test Product',
      'organic oats, folic acid, cyanocobalamin, red 40',
      2,
      'organic',
      null
    );
    expect(message).toContain('Flagged categories:');
    expect(message).toContain('additives (reject)');
    expect(message).toContain('fortified_vitamins (caution)');
  });

  test('regression: clearedBy "organic" + verdict "green" + zero flags (the ordinary organic-clean case) is unaffected', () => {
    const message = buildUserMessage('green', [], 'Test Product', 'organic oats, organic honey, sea salt', 2, 'organic', null);
    expect(message).toContain('No concerning ingredients found — product passed all checks.');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A3. buildUserMessage() — conventional_eggs note wording
//
// Reworded July 2026 (Joel-voice certification-framing audit) — certification
// is now framed as "a reasonable starting point," not proof/guarantee, and
// the old "the meaningful alternative" phrasing was dropped. Presence check
// only, not a snapshot — buildUserMessage() output feeds a live Claude call,
// so there's no way to assert Claude's actual generated wording, only the
// instruction text this function hands it. See CLAUDE.md's "Joel-voice
// certification-framing audit" entry for the full before/after.
// ════════════════════════════════════════════════════════════════════════════

describe('A3. buildUserMessage() — conventional_eggs note wording', () => {
  test('conventional_eggs note frames certification as a starting point, not proof', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'conventional_eggs', severity: 'reject', matchedIngredient: 'eggs', summary: 'x' }],
      'Test Product',
      'eggs, salt, water',
      2,
      null,
      null
    );
    expect(message).toContain('reasonable starting point');
    expect(message).toContain('not proof of it');
  });

  test('conventional_eggs note no longer contains the old "meaningful alternative" phrasing', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'conventional_eggs', severity: 'reject', matchedIngredient: 'eggs', summary: 'x' }],
      'Test Product',
      'eggs, salt, water',
      2,
      null,
      null
    );
    expect(message).not.toContain('the meaningful alternative');
  });

  test('conventional_eggs note is not injected for unrelated categories', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil', summary: 'x' }],
      'Test Product',
      'canola oil, salt',
      2,
      null,
      null
    );
    expect(message).not.toContain('reasonable starting point');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A4. buildUserMessage() — conventional_dairy note wording
//
// Reworded July 2026 (Joel-voice certification-framing audit), same stance
// as conventional_eggs (A3 above) — certification is now framed as "a
// reasonable starting point," not proof/guarantee, and the old "the
// meaningful alternative" phrasing was dropped from the base [Dairy note].
// The Level 1-specific dairy note (a separate, tone/emotional-management
// note, not a certification-framing one) was deliberately left unchanged —
// see CLAUDE.md's "Joel-voice certification-framing audit" entry for the
// full before/after and the reasoning for leaving the L1 note alone.
//
// Reworded again in a later session (PROMPT_VERSION 44→45, accuracy/tone
// feedback pass): "synthetic hormones" removed (hormone use is primarily a
// beef-cattle practice — rBST/rBGH use in dairy cows has declined
// significantly and is not standard practice), and bare "grass-fed" →
// "grass-fed and grass-finished" (a bare "grass-fed" label alone does not
// guarantee meaningful pasture time; only "100%"/"grass-finished" variants
// carry real meaning).
// ════════════════════════════════════════════════════════════════════════════

describe('A4. buildUserMessage() — conventional_dairy note wording', () => {
  test('conventional_dairy note frames certification as a starting point, not proof', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'conventional_dairy', severity: 'caution', matchedIngredient: '', summary: 'x' }],
      'Test Product',
      'milk, salt, water',
      2,
      null,
      null
    );
    expect(message).toContain('reasonable starting point');
    expect(message).toContain('not proof of it');
  });

  test('conventional_dairy note no longer contains the old "the signal that a farmer chose" / "meaningful alternative" phrasing', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'conventional_dairy', severity: 'caution', matchedIngredient: '', summary: 'x' }],
      'Test Product',
      'milk, salt, water',
      2,
      null,
      null
    );
    expect(message).not.toContain('the signal that a farmer chose');
    expect(message).not.toContain('the meaningful alternative');
  });

  test('conventional_dairy note is not injected for unrelated categories', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil', summary: 'x' }],
      'Test Product',
      'canola oil, salt',
      2,
      null,
      null
    );
    expect(message).not.toContain('reasonable starting point');
  });

  test('Level 1 dairy note is byte-unchanged by the certification-framing rework', () => {
    const message = buildUserMessage(
      'yellow',
      [{ category: 'conventional_dairy', severity: 'caution', matchedIngredient: '', summary: 'x' }],
      'Test Product',
      'milk, salt, water',
      1,
      null,
      null
    );
    expect(message).toContain(
      "[Level 1 dairy note: this is an awareness item — organic dairy is one of the most impactful food swaps available, but conventional dairy is extremely common. Frame organic dairy as a step to take when ready, not a reason to feel bad about today's choices. Use especially gentle, encouraging language.]"
    );
  });

  test('conventional_dairy note no longer mentions synthetic hormones, and uses "grass-fed and grass-finished" not bare "grass-fed"', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'conventional_dairy', severity: 'caution', matchedIngredient: '', summary: 'x' }],
      'Test Product',
      'milk, salt, water',
      2,
      null,
      null
    );
    expect(message).not.toContain('synthetic hormones');
    expect(message).toContain('GMO feed and antibiotics');
    expect(message).toContain('grass-fed and grass-finished certification');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A5. buildUserMessage() — glyphosate_heavy note wording
//
// Reworded July 2026 (Joel-voice certification-framing audit) — same stance
// as conventional_eggs (A3) and conventional_dairy (A4): certification is
// now framed as "a reasonable starting point," not proof/guarantee, and the
// old "the signal to look for" phrasing was dropped. No Level 1-specific
// note exists for this category (confirmed absent — unlike dairy's A4) — see
// CLAUDE.md's "Joel-voice certification-framing audit" entry for the full
// before/after and the newly-discovered lib/rulesEngine.js fallback-summary
// surface (tested separately in lib/rulesEngine.test.js, describe block 79).
// ════════════════════════════════════════════════════════════════════════════

describe('A5. buildUserMessage() — glyphosate_heavy note wording', () => {
  test('glyphosate_heavy note frames certification as a starting point, not proof', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'glyphosate_heavy', severity: 'reject', matchedIngredient: 'oats', summary: 'x' }],
      'Test Product',
      'oats, salt, water',
      2,
      null,
      null
    );
    expect(message).toContain('reasonable starting point');
    expect(message).toContain('not proof of it');
  });

  test('glyphosate_heavy note no longer contains the old "the signal to look for" phrasing', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'glyphosate_heavy', severity: 'reject', matchedIngredient: 'oats', summary: 'x' }],
      'Test Product',
      'oats, salt, water',
      2,
      null,
      null
    );
    expect(message).not.toContain('the signal to look for');
  });

  test('glyphosate_heavy note is not injected for unrelated categories', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil', summary: 'x' }],
      'Test Product',
      'canola oil, salt',
      2,
      null,
      null
    );
    expect(message).not.toContain('reasonable starting point pointing toward a farm that skipped this practice');
  });

  test('no Level 1-specific glyphosate_heavy note exists (confirmed absent, unlike dairy)', () => {
    const message = buildUserMessage(
      'yellow',
      [{ category: 'glyphosate_heavy', severity: 'caution', matchedIngredient: 'oats', summary: 'x' }],
      'Test Product',
      'oats, salt, water',
      1,
      null,
      null
    );
    expect(message).not.toContain('Level 1 glyphosate');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A6. buildUserMessage() — trans_fats note wording
//
// Added July 2026 — trans_fats is Sina's category, not Joel's, so this is the
// first non-Joel voice-accuracy fix this session (see CLAUDE.md). Confirmed
// during investigation that TRANS_FATS's bare "hydrogenated" trigger matches
// 11 of 12 real scan_cache rows (vs. 1 for "fully hydrogenated" and 0 for any
// other pattern) — since the FDA's partially-hydrogenated-oil ban completed
// in 2023 with no remaining exceptions, bare "hydrogenated" with no qualifier
// most often means fully hydrogenated oil today, not a meaningful trans fat
// source. This note branches on catFlags content: any qualified trigger
// ("partially hydrogenated"/"margarine"/"shortening") gets the unhedged,
// definite-trans-fat instruction; catFlags containing ONLY bare
// "hydrogenated" gets the hedged instruction instead. A real live cached
// explanation (barcode 075706151011) already asserts the ban has "loopholes"
// and "grandfathered" exceptions remaining — factually wrong per a live FDA
// source check — hence the explicit "Do not describe the ban as having
// active loopholes..." instruction below.
// ════════════════════════════════════════════════════════════════════════════

describe('A6. buildUserMessage() — trans_fats note wording', () => {
  test('bare "hydrogenated"-only match gets the hedged instruction', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'trans_fats', severity: 'reject', matchedIngredient: 'hydrogenated', summary: 'x' }],
      'Test Product',
      'peanuts, hydrogenated rapeseed oil, salt',
      2,
      null,
      null
    );
    expect(message).toContain('bare "hydrogenated" with no qualifier');
    expect(message).toContain('fully hydrogenated oil');
    expect(message).toContain('not a meaningful trans fat source');
  });

  test('bare "hydrogenated"-only match explicitly forbids describing the ban as having active loopholes', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'trans_fats', severity: 'reject', matchedIngredient: 'hydrogenated', summary: 'x' }],
      'Test Product',
      'peanuts, hydrogenated rapeseed oil, salt',
      2,
      null,
      null
    );
    expect(message).toContain('Do not describe the ban as having active loopholes');
    expect(message).toContain('fully complete with no exceptions remaining');
  });

  test('"partially hydrogenated" match gets the unhedged, definite-trans-fat instruction — not the hedge', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'trans_fats', severity: 'reject', matchedIngredient: 'partially hydrogenated', summary: 'x' }],
      'Test Product',
      'vegetable shortening (partially hydrogenated soybean oil)',
      2,
      null,
      null
    );
    expect(message).toContain('real trans fat source');
    expect(message).not.toContain('bare "hydrogenated" with no qualifier');
    expect(message).not.toContain('fully hydrogenated oil');
  });

  test('"margarine" match gets the unhedged instruction', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'trans_fats', severity: 'reject', matchedIngredient: 'margarine', summary: 'x' }],
      'Test Product',
      'flour, margarine, sugar',
      2,
      null,
      null
    );
    expect(message).toContain('real trans fat source');
    expect(message).not.toContain('bare "hydrogenated" with no qualifier');
  });

  test('"shortening" match gets the unhedged instruction', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'trans_fats', severity: 'reject', matchedIngredient: 'shortening', summary: 'x' }],
      'Test Product',
      'flour, shortening, sugar',
      2,
      null,
      null
    );
    expect(message).toContain('real trans fat source');
    expect(message).not.toContain('bare "hydrogenated" with no qualifier');
  });

  test('mixed case (shortening + partially hydrogenated + bare hydrogenated all present, like real barcode 075706151011) gets ONLY the qualified-case instruction, not the hedged one', () => {
    const message = buildUserMessage(
      'red',
      [
        { category: 'trans_fats', severity: 'reject', matchedIngredient: 'shortening', summary: 'x' },
        { category: 'trans_fats', severity: 'reject', matchedIngredient: 'partially hydrogenated', summary: 'x' },
        { category: 'trans_fats', severity: 'reject', matchedIngredient: 'hydrogenated', summary: 'x' },
      ],
      'HOLY PEPPERONI PEPPERONI PIZZA',
      'vegetable shortening {partially hydrogenated soybean oil & cottonseed oil}, hydrogenated cotton seed oil',
      2,
      null,
      null
    );
    expect(message).toContain('real trans fat source');
    expect(message).not.toContain('bare "hydrogenated" with no qualifier');
    expect(message).not.toContain('fully hydrogenated oil');
  });

  test('trans_fats note is not injected for unrelated categories', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil', summary: 'x' }],
      'Test Product',
      'canola oil, salt',
      2,
      null,
      null
    );
    expect(message).not.toContain('Trans fat note');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A7. SYSTEM_PROMPT — new conventional_crops paragraph
//
// Added in an accuracy/tone feedback session (PROMPT_VERSION 44→45).
// conventional_crops previously had no dedicated paragraph in SYSTEM_PROMPT
// at all — it relied only on the general Joel-voice guidance, which had no
// certification-framing language to get wrong (or right). The new paragraph
// covers: organic-accuracy (certification is about inputs — no synthetic
// pesticides/GMO seed — not proof of regenerative practices, no-till, or
// cover cropping), the "no fillers or synthetic additives" alternative
// standard, wheat's GMO exclusion (no commercially grown GMO wheat exists in
// the U.S. — unlike corn, soy, and sugar beets), hedged origin/practice
// language, and Joel's "When shopping in the grocery store, choose
// organic..." shopping-guidance signature. Presence-check only — SYSTEM_PROMPT
// is a static template literal, not a function of inputs like
// buildUserMessage(), so these assert directly against the constant.
// ════════════════════════════════════════════════════════════════════════════

describe('A7. SYSTEM_PROMPT — new conventional_crops paragraph', () => {
  test('includes the organic-accuracy distinction: inputs, not regenerative practices', () => {
    expect(SYSTEM_PROMPT).toContain('For conventional_crops:');
    expect(SYSTEM_PROMPT).toContain('organic certification is about inputs, not practices');
    expect(SYSTEM_PROMPT).toContain('not proof of regenerative farming, no-till, or cover cropping');
  });

  test('includes the "no fillers or synthetic additives" alternative standard, not the old "minimal fillers" framing', () => {
    expect(SYSTEM_PROMPT).toContain('no fillers or synthetic additives');
    expect(SYSTEM_PROMPT).not.toContain('minimal fillers');
  });

  test('wheat is excluded from GMO language — described only as conventionally grown/sprayed, never GMO', () => {
    expect(SYSTEM_PROMPT).toContain('wheat has no commercially grown GMO variety in the U.S.');
    expect(SYSTEM_PROMPT).toContain('never as GMO');
  });

  test('the wheat exception is explicitly conditional on wheat being among this flag\'s matched ingredients, not a blanket aside', () => {
    // Reworded in a follow-up session: the original phrasing folded the wheat
    // exception into the same sentence as the general GMO-seed claim ("...aside
    // from wheat...are typically grown from GMO seed as well"), with no signal
    // that the wheat mention should only appear when wheat is actually flagged.
    // Confirms the instruction is now structurally scoped, not just present.
    expect(SYSTEM_PROMPT).toContain('with one exception: if wheat is among the matched ingredients for this flag');
  });

  test("includes Joel's shopping-store guidance signature", () => {
    expect(SYSTEM_PROMPT).toContain('When shopping in the grocery store, his guidance is to choose organic');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A8. SYSTEM_PROMPT — glyphosate_heavy paragraph (hedging + shopping-phrase)
//
// Reworded in the same session as A7 — origin/practice claims hedged
// ("commonly"/"typically" rather than settled fact about this specific
// product), and the "reasonable starting point" framing replaced with Joel's
// shopping-store guidance signature. Wheat regression-checked per Fix 6: this
// paragraph must keep describing wheat as sprayed/desiccated only, never as
// GMO — confirmed no regression was introduced by this reword.
// ════════════════════════════════════════════════════════════════════════════

describe('A8. SYSTEM_PROMPT — glyphosate_heavy paragraph wording', () => {
  function glyphosateSection() {
    return SYSTEM_PROMPT.slice(
      SYSTEM_PROMPT.indexOf('For glyphosate_heavy:'),
      SYSTEM_PROMPT.indexOf('For conventional_dairy:')
    );
  }

  test('hedges the residue-level claim rather than stating it as settled fact', () => {
    expect(glyphosateSection()).toContain('typically means higher residue levels');
  });

  test('incorporates the shopping-store guidance signature, dropping "reasonable starting point"', () => {
    const section = glyphosateSection();
    expect(section).toContain('When shopping in the grocery store, his guidance is to choose glyphosate-free or certified organic');
    expect(section).not.toContain('reasonable starting point');
  });

  test('regression: wheat is still described only as sprayed/desiccated, never as GMO', () => {
    const section = glyphosateSection();
    expect(section).toContain('wheat');
    expect(section).not.toMatch(/wheat[^.]*GMO/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A9. SYSTEM_PROMPT — conventional_dairy paragraph (hedging + hormones +
//     grass-fed + shopping-phrase)
//
// Distinct from A4 above, which tests buildUserMessage()'s shorter injected
// [Dairy note] — this block tests the full SYSTEM_PROMPT paragraph. Reworded
// in the same session as A7/A8: "synthetic hormones" removed (hormone use is
// primarily a beef-cattle practice, not standard for dairy cows), bare
// "grass-fed" replaced with "grass-fed and grass-finished," origin claims
// hedged, and "reasonable starting point" replaced with the shopping-store
// guidance signature.
// ════════════════════════════════════════════════════════════════════════════

describe('A9. SYSTEM_PROMPT — conventional_dairy paragraph wording', () => {
  function dairySection() {
    return SYSTEM_PROMPT.slice(
      SYSTEM_PROMPT.indexOf('For conventional_dairy:'),
      SYSTEM_PROMPT.indexOf('For conventional_eggs:')
    );
  }

  test('no longer claims dairy cows are treated with synthetic hormones', () => {
    const section = dairySection();
    expect(section).not.toContain('synthetic hormones');
    expect(section).toContain('antibiotics');
  });

  test('uses "grass-fed and grass-finished," not bare "grass-fed," as the qualifying signal', () => {
    const section = dairySection();
    expect(section).toContain('grass-fed and grass-finished');
    expect(section).not.toMatch(/\bgrass-fed dairy\b/);
  });

  test('hedges the farming-practice claim rather than stating it as settled fact', () => {
    expect(dairySection()).toContain('conventional dairy typically means cows fed GMO corn and soy');
  });

  test('incorporates the shopping-store guidance signature', () => {
    expect(dairySection()).toContain('When shopping in the grocery store, his guidance is to choose certified organic or grass-fed and grass-finished dairy');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A10. SYSTEM_PROMPT — conventional_eggs paragraph (hedging + shopping-phrase)
//
// Reworded in the same session as A7-A9. No hormone or grass-fed changes —
// neither term appears in this paragraph ("pasture-raised" is the
// egg-appropriate term and was not in scope for correction).
// ════════════════════════════════════════════════════════════════════════════

describe('A10. SYSTEM_PROMPT — conventional_eggs paragraph wording', () => {
  function eggsSection() {
    return SYSTEM_PROMPT.slice(
      SYSTEM_PROMPT.indexOf('For conventional_eggs:'),
      SYSTEM_PROMPT.indexOf('For olive_oil_adulteration:')
    );
  }

  test('hedges the farming-practice claim rather than stating it as settled fact', () => {
    expect(eggsSection()).toContain('hens are commonly fed GMO grain');
  });

  test('incorporates the shopping-store guidance signature, dropping "reasonable starting point"', () => {
    const section = eggsSection();
    expect(section).toContain('When shopping in the grocery store, his guidance is to choose certified organic or pasture-raised eggs');
    expect(section).not.toContain('reasonable starting point');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A11. SYSTEM_PROMPT — new trans_fats paragraph (GRAS-reversal reframe)
//
// Added in the same session as A7-A10 — targets the "partially
// hydrogenated"/"margarine"/"shortening" branch specifically; bare
// "hydrogenated" is a separate branch handled entirely by the
// buildUserMessage() note tested in A6 above (unchanged by this addition).
// Before this paragraph existed, Claude had nothing category-specific to
// override the general shared-voice GRAS-skepticism line (line 65), producing
// an outdated "GRAS never required long-term research" framing for a case
// where regulators actually revoked GRAS status and banned the ingredient
// outright — the opposite of ongoing lax oversight.
// ════════════════════════════════════════════════════════════════════════════

describe('A11. SYSTEM_PROMPT — new trans_fats paragraph (GRAS-reversal reframe)', () => {
  test('frames the FDA revoking GRAS status and banning partially hydrogenated oils as regulators acting decisively', () => {
    expect(SYSTEM_PROMPT).toContain('revoked their GRAS status in 2015');
    expect(SYSTEM_PROMPT).toContain('banned partially hydrogenated oils outright by 2018');
    expect(SYSTEM_PROMPT).toContain('regulators acting decisively on strong evidence');
  });

  test('explicitly forbids framing this as more of the same lax-GRAS-oversight problem', () => {
    expect(SYSTEM_PROMPT).toContain('not as another example of lax GRAS oversight');
  });

  test('scoped to the qualified triggers only, not bare "hydrogenated"', () => {
    expect(SYSTEM_PROMPT).toContain('not bare "hydrogenated," which is handled separately');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A12. SYSTEM_PROMPT — new conventional_meat paragraph
//
// Added in a follow-up to the A7-A11 session — found during that session's own
// post-implementation testing (not part of Dr. Sina's original feedback list):
// conventional_meat had no dedicated paragraph at all, so a real generated
// explanation for it defaulted to bare "grass-fed" with no steering, since the
// "grass-fed and grass-finished" fix only ever lived in the rarely-shown static
// fallback summary (pages/api/scan.js:292 / lib/verdictEngine.js:172). This
// paragraph is also deliberately scoped to land-animal meat specifically — see
// A13 below and the meatScenario tests in scan.test.js's Suite Z for why: the
// same conventional_meat category also fires for farmed/unlabeled seafood and
// animal-derived gelatin in non-meat products, where feedlot/hormone framing
// would be actively wrong.
// ════════════════════════════════════════════════════════════════════════════

describe('A12. SYSTEM_PROMPT — new conventional_meat paragraph', () => {
  function meatSection() {
    return SYSTEM_PROMPT.slice(
      SYSTEM_PROMPT.indexOf('For conventional_meat:'),
      SYSTEM_PROMPT.indexOf('For glyphosate_heavy:')
    );
  }

  test('includes hormone implants as standard practice for conventional beef cattle specifically (not dairy)', () => {
    const section = meatSection();
    expect(section).toContain('given hormone implants, which remain standard practice for conventional beef cattle specifically');
  });

  test('includes antibiotics and confinement/feedlot framing, hedged', () => {
    const section = meatSection();
    expect(section).toContain('animals commonly raised in confinement or feedlot systems');
    expect(section).toContain('treated with antibiotics as routine practice');
  });

  test('uses "grass-fed and grass-finished," not bare "grass-fed," in the shopping guidance', () => {
    const section = meatSection();
    expect(section).toContain('choose grass-fed and grass-finished or pasture-raised meat from a farm you trust');
    expect(section).not.toMatch(/\bgrass-fed meat\b/);
  });

  test('includes the product-name disambiguation instruction for seafood/gelatin scenarios', () => {
    const section = meatSection();
    expect(section).toContain("If the product name doesn't clearly point to land-animal meat");
    expect(section).toContain('skip the feedlot/hormone specifics');
  });

  test('includes the standard "starting point, not proof" caveat, matching the other conventional_* paragraphs', () => {
    const section = meatSection();
    expect(section).toContain('the label is a starting point, not proof');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// A13. buildUserMessage() — conventional_meat meatScenario note
//
// Added alongside A12 — the second, code-level disambiguation layer. Unlike
// every other per-category note in this function, this one is driven by real
// data set at the flag-injection site in scan.js/verdictEngine.js
// (meatScenario: 'land_animal' | 'seafood' | 'gelatin'), not by the flag's
// category or matchedIngredient alone, since those are identical across all
// three real scenarios (matchedIngredient is always '' for every
// conventional_meat injection). The fourth branch (no meatScenario set) is a
// defensive fallback for any caller not yet updated to set the field —
// verified separately below so the graceful-degradation design is provable,
// not just assumed.
// ════════════════════════════════════════════════════════════════════════════

describe('A13. buildUserMessage() — conventional_meat meatScenario note', () => {
  function messageFor(meatScenario) {
    const flag = { category: 'conventional_meat', severity: 'reject', matchedIngredient: '', summary: 'x' };
    if (meatScenario !== undefined) flag.meatScenario = meatScenario;
    return buildUserMessage('red', [flag], 'Test Product', 'beef, water, salt', 2, null, null);
  }

  test('meatScenario "land_animal" → note confirms the feedlot/hormone framing applies', () => {
    const message = messageFor('land_animal');
    expect(message).toContain('land-animal meat or poultry — the feedlot/hormone framing in the system prompt applies directly');
  });

  test('meatScenario "seafood" → note explicitly forbids feedlot/hormone language', () => {
    const message = messageFor('seafood');
    expect(message).toContain('triggered by farmed or unlabeled seafood, not land-animal meat — do not use feedlot/hormone language');
    expect(message).toContain('wild-caught vs. farmed sourcing');
  });

  test('meatScenario "gelatin" → note explicitly forbids feedlot/hormone language and reframes as gelatin sourcing', () => {
    const message = messageFor('gelatin');
    expect(message).toContain('triggered by animal-derived gelatin in a non-meat product');
    expect(message).toContain('do not use feedlot/hormone language');
    expect(message).toContain('gelatin-sourcing concern');
  });

  test('no meatScenario set → falls back to the product-name disambiguation instruction, not a crash or a false assumption', () => {
    const message = messageFor(undefined);
    expect(message).toContain('check the product name — if it does not clearly indicate land-animal meat');
    expect(message).not.toContain('feedlot/hormone framing in the system prompt applies directly');
  });

  test('the note is not injected for unrelated categories', () => {
    const message = buildUserMessage(
      'red',
      [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil', summary: 'x' }],
      'Test Product',
      'canola oil, salt',
      2,
      null,
      null
    );
    expect(message).not.toContain('Meat note');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Handler — input validation
// ════════════════════════════════════════════════════════════════════════════

describe('B. Handler — input validation', () => {
  test('B1: GET request → 405', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(405);
  });

  test('B2: missing verdict → 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', {}), res);
    expect(res.statusCode).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Handler — Claude response parsing (clean / fenced / truncated)
// ════════════════════════════════════════════════════════════════════════════

describe('C. Handler — Claude response parsing', () => {
  beforeEach(() => {
    mockAnthropicCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('C1: clean, well-formed JSON response → 200 with summary and details preserved', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"summary":"All clear.","details":{}}' }],
    });
    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'green', flags: [], productName: 'Test' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ summary: 'All clear.', details: {} });
  });

  test('C2: JSON wrapped in a ```json markdown fence, with a valid closing brace → 200, still parses correctly', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n{"summary":"Some issues.","details":{"conventional_crops":"Joel here — no cert."}}\n```',
      }],
    });
    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'red', flags: [{ category: 'conventional_crops', severity: 'reject', matchedIngredient: 'sugar' }], productName: 'Test' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      summary: 'Some issues.',
      details: { conventional_crops: 'Joel here — no cert.' },
    });
  });

  test('C3: genuinely truncated response with no closing brace → 502, does NOT surface raw text as the summary', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n{\n  "summary": "This product has three significant issues: safflower oil (a seed oil that drives inflammation), conventional grain ingredients (grown with pesticides and GMO',
      }],
    });
    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'red', flags: [], productName: 'Test' }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBeDefined();
    // The raw truncated text must never leak into the response body anywhere.
    expect(JSON.stringify(res.body)).not.toContain('safflower oil');
    expect(JSON.stringify(res.body)).not.toContain('```json');
  });

  test('C4: max_tokens sent to the Claude API is 2000, not the old 1000', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"summary":"Fine.","details":{}}' }],
    });
    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'green', flags: [], productName: 'Test' }), res);
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2000 })
    );
  });

  // ── Observability logging (console only, never persisted anywhere) ──
  // Mirrors the equivalent tests for fetchExplanation() in scan.test.js's
  // Suite T — see CLAUDE.md's "Nutty Buddy Creme Pies" investigation.

  test('C5: missing API key logs a distinct message before returning 500', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'red', flags: [], productName: 'Test' }), res);

    expect(res.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith('[explain] explanation fetch: missing API key');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test('C6: a thrown exception (network/rate-limit/API error) logs the error object, distinct from the other two cases', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const simulatedError = new Error('simulated rate limit error');
    mockAnthropicCreate.mockRejectedValueOnce(simulatedError);

    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'red', flags: [], productName: 'Test' }), res);

    expect(res.statusCode).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith('[explain] explanation fetch: API error:', simulatedError);

    errorSpy.mockRestore();
  });

  test('C7: an unparseable/truncated response logs category count and flag count — deduped by category, not just the raw flag count', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n{\n  "summary": "truncated mid-generation' }],
    });
    // 4 flags across 3 distinct categories — same shape as scan.test.js's T7,
    // confirming the count is a Set-based dedup by category, not the flag count.
    const flags = [
      { category: 'trans_fats', severity: 'reject', matchedIngredient: 'hydrogenated' },
      { category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil' },
      { category: 'seed_oils', severity: 'reject', matchedIngredient: 'soybean oil' },
      { category: 'conventional_crops', severity: 'reject', matchedIngredient: 'sugar' },
    ];
    const res = makeRes();
    await handler(makeReq('POST', { verdict: 'red', flags, productName: 'Test' }), res);

    expect(res.statusCode).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith(
      '[explain] explanation fetch: unparseable response, category count: 3, flag count: 4'
    );

    errorSpy.mockRestore();
  });
});
