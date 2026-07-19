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
const { parseExplanationResponse, buildUserMessage } = require('../../pages/api/explain');

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
