'use strict';

/**
 * scripts/goldenMaster/captureSnapshot.js
 *
 * Stage 1 of the L1/L2 unification project: runs every input from
 * scripts/goldenMaster/inputs.json through the CURRENT, unmodified
 * pages/api/scan.js handler — the real analyzeIngredients() call, the real
 * L1 override block, and the real L2 universal decision tree, exactly as
 * they exist today — and records the full output for each as ground truth.
 *
 * This file is NOT run with plain `node` — pages/api/scan.js (like the rest
 * of this codebase's lib/ and pages/ trees) uses ES module import/export
 * syntax that only Next.js's own bundler or Jest's next/jest transform can
 * parse; a bare `require()` from plain Node fails with a module-resolution
 * error (extension-less imports aren't valid Node ESM). Rather than port/
 * duplicate scan.js's L1/L2 logic by hand (risking transcription drift from
 * the real thing — exactly the kind of subtle bug this snapshot exists to
 * catch), this script is executed THROUGH Jest so it gets the same working
 * transform pipeline the existing test suite already relies on, without
 * requiring any change to jest.config.js — `--testMatch` is passed on the
 * command line for this one invocation only:
 *
 *   npx jest --testMatch "**\/scripts/goldenMaster/captureSnapshot.js" --runInBand
 *
 * No real Supabase or Anthropic calls are made: SUPABASE_SERVICE_ROLE_KEY
 * and ANTHROPIC_API_KEY are never set in this environment (confirmed —
 * __tests__/api/scan.test.js's own comments document that these env vars
 * are always absent under Jest), so getSupabaseServer() naturally returns
 * null (every scan_cache/unverified_ingredients write path is gated on
 * `if (sb) {...}`) and fetchExplanation() short-circuits to null before
 * constructing a client. The @anthropic-ai/sdk mock below is an extra,
 * defensive safety net — not strictly required — so that even if that
 * assumption were ever wrong, no real network call could happen.
 */

const fs = require('fs');
const path = require('path');

// Defensive-only: never actually invoked, since ANTHROPIC_API_KEY is never
// set in this environment and fetchExplanation() short-circuits before
// constructing a client. Mirrors the same mock already used in
// __tests__/api/scan.test.js.
const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

const handler = require('../../pages/api/scan').default;

const inputsPath = path.join(__dirname, 'inputs.json');
const snapshotPath = path.join(__dirname, 'snapshot-baseline.json');

const testCases = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));

function makeReq(method, body) {
  return { method, body };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  return res;
}

function mockFetchOnce(responseBody) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(responseBody),
  });
}

/** Fields captured in the snapshot, per the Stage 1 spec. */
const OUTPUT_FIELDS = [
  'verdict',
  'flags',
  'clearedBy',
  'unverifiedIngredients',
  'isMeat',
  'oliveCaveat',
  'unverifiedReason',
  'productCategory',
];

test('capture golden master snapshot of current L1/L2 decision logic', async () => {
  const results = [];
  let barcodeCounter = 900000000000;

  for (const testCase of testCases) {
    const barcode = String(barcodeCounter++);

    const offResponse = {
      status: 1,
      product: {
        product_name: testCase.productName,
        ingredients_text: testCase.ingredientText,
        labels_tags: testCase.productLabels ?? [],
        categories_tags: testCase.categoriesTags ?? [],
      },
    };

    mockFetchOnce(offResponse);
    const res = makeRes();
    await handler(makeReq('POST', { barcode, userLevel: testCase.userLevel }), res);

    const output = {};
    for (const field of OUTPUT_FIELDS) {
      output[field] = res.body ? res.body[field] : undefined;
    }

    results.push({
      id: testCase.id,
      description: testCase.description,
      input: {
        ingredientText: testCase.ingredientText,
        productLabels: testCase.productLabels ?? [],
        categoriesTags: testCase.categoriesTags ?? [],
        productName: testCase.productName,
        userLevel: testCase.userLevel,
      },
      output,
    });
  }

  fs.writeFileSync(snapshotPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalCases: results.length,
    results,
  }, null, 2));

  // Sanity assertion so this still behaves as a valid Jest test — every
  // case must have produced a real response (not a crashed/undefined one).
  expect(results.length).toBe(testCases.length);
  expect(results.every(r => r.output.verdict !== undefined)).toBe(true);

  // eslint-disable-next-line no-console
  console.log(`Captured ${results.length} snapshot entries -> ${snapshotPath}`);
}, 120000);
