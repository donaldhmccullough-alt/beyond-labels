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
const { parseExplanationResponse } = require('../../pages/api/explain');

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
});
