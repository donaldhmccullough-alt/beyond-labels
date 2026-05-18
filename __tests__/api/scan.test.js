'use strict';

/**
 * __tests__/api/scan.test.js
 *
 * Tests the /api/scan handler directly (no HTTP server required).
 * global.fetch is replaced with a Jest mock for every test so no real
 * network calls are made.  Realistic OFF response fixtures mirror what
 * the actual API returns for these three barcodes:
 *
 *   021000025350  — Kraft Macaroni & Cheese  → expected: RED
 *   013562000228  — Annie's Homegrown         → expected: YELLOW
 *   999999999999  — Not in OFF database       → expected: UNVERIFIED (404)
 *
 * Test suites:
 *   A. Input validation (method, missing barcode, non-digit barcode)
 *   B. Upstream error handling (non-2xx, network failure)
 *   C. Barcode 021000025350 — Kraft (RED verdict)
 *   D. Barcode 013562000228 — Annie's Homegrown (YELLOW verdict)
 *   E. Barcode 999999999999 — Product not in OFF database (UNVERIFIED)
 *   F. Label normalisation (OFF tags → internal certification strings)
 *   G. Response shape — structural contract for all three scenarios
 */

const handler = require('../../pages/api/scan').default;

// ─── Realistic OFF response fixtures ────────────────────────────────────────

/**
 * Kraft Mac & Cheese — 021000025350
 * Triggers all four hard-reject categories:
 *   Cat 1 (seed oil):       soybean oil
 *   Cat 2 (conv. crops):    wheat flour, citric acid
 *   Cat 3 (bioengineering): "contains bioengineered food ingredients"
 *   Cat 4 (additives):      yellow 5, yellow 6
 */
const KRAFT_OFF = {
  status: 1,
  product: {
    product_name: 'Kraft Macaroni & Cheese Dinner Original',
    ingredients_text:
      'ENRICHED MACARONI (WHEAT FLOUR, NIACIN, FERROUS SULFATE, THIAMIN MONONITRATE, ' +
      'RIBOFLAVIN, FOLIC ACID), CHEESE SAUCE MIX (WHEY, MILKFAT, MILK PROTEIN CONCENTRATE, ' +
      'SALT, SODIUM TRIPOLYPHOSPHATE, CONTAINS LESS THAN 2% OF CITRIC ACID, SODIUM PHOSPHATE, ' +
      'LACTIC ACID, CALCIUM PHOSPHATE, SOYBEAN OIL, YELLOW 5, YELLOW 6). ' +
      'CONTAINS BIOENGINEERED FOOD INGREDIENTS.',
    labels_tags: [],
  },
};

/**
 * Annie's Homegrown Shells & White Cheddar — 013562000228
 * USDA Organic clears all Cat 2 conventional crops.
 * Only expected flag: gluten soft-flag (organic wheat is still wheat).
 */
const ANNIES_OFF = {
  status: 1,
  product: {
    product_name: "Annie's Homegrown Shells & White Cheddar",
    ingredients_text:
      'ORGANIC WHEAT FLOUR, ORGANIC WHEY, ORGANIC CHEDDAR CHEESE ' +
      '(ORGANIC PASTEURIZED MILK, CULTURES, SALT, NON-ANIMAL ENZYMES), ' +
      'ORGANIC CORN STARCH, SEA SALT, ORGANIC ANNATTO EXTRACT.',
    labels_tags: [
      'en:usda-organic',
      'en:organic',
      'en:no-artificial-colors',   // brand claim — NOT mapped to a certification
      'en:no-artificial-flavors',  // brand claim — NOT mapped to a certification
    ],
  },
};

/**
 * Barcode 999999999999 — not in OFF database.
 * OFF returns { status: 0 } for unknown barcodes.
 */
const NOT_FOUND_OFF = { status: 0, product: null };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Next.js-compatible request object. */
function makeReq(method = 'POST', body = {}) {
  return { method, body };
}

/**
 * Build a chainable mock response object.
 * After the handler resolves, inspect:
 *   res.statusCode        — the HTTP status set via res.status(n)
 *   res.body              — the object passed to res.json(obj)
 */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data)   { this.body = data;       return this; },
  };
  return res;
}

/**
 * Replace global.fetch for one call with a resolved mock response.
 * @param {object}  responseBody  — the JSON the fake OFF API returns
 * @param {boolean} [ok=true]     — whether the HTTP response is 2xx
 */
function mockFetchOnce(responseBody, ok = true) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok,
    status:     ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(responseBody),
  });
}

// Restore native fetch after every test so leakage between suites is impossible.
const _originalFetch = global.fetch;
afterEach(() => {
  global.fetch = _originalFetch;
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// A. Input validation
// ════════════════════════════════════════════════════════════════════════════

describe('A. Input validation', () => {
  test('GET request → 405 Method Not Allowed', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/method not allowed/i);
  });

  test('PUT request → 405', async () => {
    const res = makeRes();
    await handler(makeReq('PUT', { barcode: '021000025350' }), res);
    expect(res.statusCode).toBe(405);
  });

  test('missing barcode field → 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/barcode/i);
  });

  test('null barcode → 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { barcode: null }), res);
    expect(res.statusCode).toBe(400);
  });

  test('empty-string barcode → 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '' }), res);
    expect(res.statusCode).toBe(400);
  });

  test('barcode with only non-digit characters → 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '---' }), res);
    expect(res.statusCode).toBe(400);
  });

  test('barcode with hyphens is sanitised and forwarded: "0210-0002-5350" → "021000025350"', async () => {
    mockFetchOnce(KRAFT_OFF);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '0210-0002-5350' }), res);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('021000025350');
    expect(url).not.toContain('-');
  });

  test('barcode with leading zeros is preserved: "021000025350" stays "021000025350"', async () => {
    mockFetchOnce(KRAFT_OFF);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
    expect(res.body.barcode).toBe('021000025350');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Upstream / network error handling
// ════════════════════════════════════════════════════════════════════════════

describe('B. Upstream error handling', () => {
  test('OFF returns non-2xx (e.g. 500) → handler returns 502', async () => {
    mockFetchOnce({}, false); // ok: false
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBeDefined();
  });

  test('502 body includes HTTP status detail', async () => {
    mockFetchOnce({}, false);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
    expect(res.body.detail).toMatch(/500/);
  });

  test('fetch() throws (network down / DNS failure) → 502', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
    expect(res.statusCode).toBe(502);
  });

  test('network error body surfaces the original error message', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
    expect(res.body.detail).toContain('ENOTFOUND');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Barcode 021000025350 — Kraft Mac & Cheese (RED)
// ════════════════════════════════════════════════════════════════════════════

describe('C. Barcode 021000025350 — Kraft Mac & Cheese', () => {
  let res;

  beforeEach(async () => {
    mockFetchOnce(KRAFT_OFF);
    res = makeRes();
    await handler(makeReq('POST', { barcode: '021000025350' }), res);
  });

  test('HTTP 200', () => {
    expect(res.statusCode).toBe(200);
  });

  test('verdict is RED', () => {
    expect(res.body.verdict).toBe('red');
  });

  test('found is true', () => {
    expect(res.body.found).toBe(true);
  });

  test('productName contains "Kraft"', () => {
    expect(res.body.productName).toMatch(/kraft/i);
  });

  test('ingredients field is the original OFF ingredients_text string', () => {
    expect(res.body.ingredients).toMatch(/wheat flour/i);
  });

  test('barcode echoed back verbatim', () => {
    expect(res.body.barcode).toBe('021000025350');
  });

  test('source is "open-food-facts"', () => {
    expect(res.body.source).toBe('open-food-facts');
  });

  test('clearedBy is null (no certifications on the product)', () => {
    expect(res.body.clearedBy).toBeNull();
  });

  test('labelsDetected is empty (no recognised OFF certification tags)', () => {
    expect(res.body.labelsDetected).toEqual([]);
  });

  // ── Category 1: Seed oils ──
  test('flags soybean oil as seed_oils / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'seed_oils' && f.matchedIngredient === 'soybean oil'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── Category 2: Conventional crops ──
  test('flags wheat flour as conventional_crops / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'conventional_crops' && f.matchedIngredient === 'wheat flour'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('flags citric acid as conventional_crops / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'conventional_crops' && f.matchedIngredient === 'citric acid'
    );
    expect(flag).toBeDefined();
  });

  // ── Category 3: Bioengineering ──
  test('flags bioengineered disclosure (exactly one bioengineering flag)', () => {
    const bioFlags = res.body.flags.filter(f => f.category === 'bioengineering');
    expect(bioFlags).toHaveLength(1);
    expect(bioFlags[0].severity).toBe('reject');
    expect(bioFlags[0].matchedIngredient).toContain('bioengineered');
  });

  // ── Category 4: Synthetic additives ──
  test('flags yellow 5 as additives / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'additives' && f.matchedIngredient === 'yellow 5'
    );
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('flags yellow 6 as additives / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'additives' && f.matchedIngredient === 'yellow 6'
    );
    expect(flag).toBeDefined();
  });

  test('all flags from hard categories carry severity "reject"', () => {
    const hardCats = ['seed_oils', 'conventional_crops', 'bioengineering', 'additives'];
    res.body.flags
      .filter(f => hardCats.includes(f.category))
      .forEach(f => expect(f.severity).toBe('reject'));
  });

  test('fetched the correct OFF URL', () => {
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(
      'https://world.openfoodfacts.org/api/v0/product/021000025350.json'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Barcode 013562000228 — Annie's Homegrown (YELLOW)
// ════════════════════════════════════════════════════════════════════════════

describe("D. Barcode 013562000228 — Annie's Homegrown", () => {
  let res;

  beforeEach(async () => {
    mockFetchOnce(ANNIES_OFF);
    res = makeRes();
    await handler(makeReq('POST', { barcode: '013562000228' }), res);
  });

  test('HTTP 200', () => {
    expect(res.statusCode).toBe(200);
  });

  test("verdict is YELLOW (USDA Organic clears hard rejects; wheat triggers gluten soft-flag)", () => {
    expect(res.body.verdict).toBe('yellow');
  });

  test('found is true', () => {
    expect(res.body.found).toBe(true);
  });

  test("productName contains \"Annie's\"", () => {
    expect(res.body.productName).toMatch(/annie/i);
  });

  test('clearedBy is "organic" (en:usda-organic detected on label)', () => {
    expect(res.body.clearedBy).toBe('organic');
  });

  test('labelsDetected includes "usda-organic"', () => {
    expect(res.body.labelsDetected).toContain('usda-organic');
  });

  test('brand-claim tags (no-artificial-colors, no-artificial-flavors) are NOT in labelsDetected', () => {
    expect(res.body.labelsDetected).not.toContain('no-artificial-colors');
    expect(res.body.labelsDetected).not.toContain('no-artificial-flavors');
  });

  test('no seed_oils flags', () => {
    expect(res.body.flags.filter(f => f.category === 'seed_oils')).toHaveLength(0);
  });

  test('no conventional_crops flags (USDA Organic label clears all Cat 2)', () => {
    expect(res.body.flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
  });

  test('no bioengineering flags', () => {
    expect(res.body.flags.filter(f => f.category === 'bioengineering')).toHaveLength(0);
  });

  test('no additives flags', () => {
    expect(res.body.flags.filter(f => f.category === 'additives')).toHaveLength(0);
  });

  test('has gluten caution flags (organic wheat + organic corn starch — prolamin concern survives organic clearance)', () => {
    const glutenFlags = res.body.flags.filter(f => f.category === 'gluten_grains');
    expect(glutenFlags.length).toBeGreaterThanOrEqual(1);
    expect(glutenFlags.every(f => f.severity === 'caution')).toBe(true);
    expect(glutenFlags.some(f => f.matchedIngredient === 'wheat flour')).toBe(true);
  });

  test('zero flags with severity "reject"', () => {
    expect(res.body.flags.filter(f => f.severity === 'reject')).toHaveLength(0);
  });

  test('fetched the correct OFF URL', () => {
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(
      'https://world.openfoodfacts.org/api/v0/product/013562000228.json'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. Barcode 999999999999 — Not in OFF database (UNVERIFIED)
// ════════════════════════════════════════════════════════════════════════════

describe('E. Barcode 999999999999 — product not in OFF database', () => {
  let res;

  beforeEach(async () => {
    mockFetchOnce(NOT_FOUND_OFF);
    res = makeRes();
    await handler(makeReq('POST', { barcode: '999999999999' }), res);
  });

  test('HTTP 404', () => {
    expect(res.statusCode).toBe(404);
  });

  test('verdict is "unverified"', () => {
    expect(res.body.verdict).toBe('unverified');
  });

  test('found is false', () => {
    expect(res.body.found).toBe(false);
  });

  test('productName is null', () => {
    expect(res.body.productName).toBeNull();
  });

  test('ingredients is null', () => {
    expect(res.body.ingredients).toBeNull();
  });

  test('flags array is empty', () => {
    expect(res.body.flags).toEqual([]);
  });

  test('clearedBy is null', () => {
    expect(res.body.clearedBy).toBeNull();
  });

  test('labelsDetected is empty', () => {
    expect(res.body.labelsDetected).toEqual([]);
  });

  test('barcode is echoed back in response', () => {
    expect(res.body.barcode).toBe('999999999999');
  });

  test('source is "open-food-facts"', () => {
    expect(res.body.source).toBe('open-food-facts');
  });

  test('fetched the correct OFF URL', () => {
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(
      'https://world.openfoodfacts.org/api/v0/product/999999999999.json'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. Label normalisation (OFF tags → internal certification strings)
// ════════════════════════════════════════════════════════════════════════════

describe('F. OFF label normalisation', () => {
  test('"en:usda-organic" → "usda-organic"', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'water',
        labels_tags: ['en:usda-organic'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).toContain('usda-organic');
    expect(res.body.clearedBy).toBe('organic');
  });

  test('"en:organic" (generic) also maps to "usda-organic"', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'water',
        labels_tags: ['en:organic'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).toContain('usda-organic');
  });

  test('"en:usda-organic" and "en:organic" together deduplicate to a single "usda-organic" entry', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'water',
        labels_tags: ['en:usda-organic', 'en:organic'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    const usdaEntries = res.body.labelsDetected.filter(l => l === 'usda-organic');
    expect(usdaEntries).toHaveLength(1);
  });

  test('"en:non-gmo-project-verified" → "non-gmo-project-verified"', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'corn starch',
        labels_tags: ['en:non-gmo-project-verified'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).toContain('non-gmo-project-verified');
    expect(res.body.clearedBy).toBe('non-gmo-project-verified');
  });

  test('unmapped brand-claim tags are silently ignored', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'water',
        labels_tags: ['en:no-artificial-flavors', 'en:gluten-free', 'en:kosher'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).toEqual([]);
  });

  test('null labels_tags is handled gracefully (treated as no certifications)', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'water',
        labels_tags: null,
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).toEqual([]);
  });

  // "en:no-gmos" is a self-declared claim, NOT Non-GMO Project Verified.
  // It should NOT be mapped to the third-party certification.
  test('"en:no-gmos" (self-declared) is NOT mapped to "non-gmo-project-verified"', async () => {
    const offResp = {
      status: 1,
      product: {
        product_name: 'Test',
        ingredients_text: 'corn starch, soy lecithin',
        labels_tags: ['en:no-gmos'],
      },
    };
    mockFetchOnce(offResp);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '123456789012' }), res);
    expect(res.body.labelsDetected).not.toContain('non-gmo-project-verified');
    // Conventional crops NOT cleared — corn starch should be flagged
    const cropFlag = res.body.flags.find(
      f => f.category === 'conventional_crops' && f.matchedIngredient === 'corn starch'
    );
    expect(cropFlag).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. Response shape — structural contract
// ════════════════════════════════════════════════════════════════════════════

describe('G. Response shape — structural contract', () => {
  const REQUIRED_FIELDS = [
    'verdict', 'flags', 'clearedBy', 'productName',
    'ingredients', 'barcode', 'source', 'found', 'labelsDetected',
  ];
  const VALID_VERDICTS   = ['red', 'yellow', 'green', 'unverified'];
  const VALID_SEVERITIES = ['reject', 'caution'];

  const scenarios = [
    { label: 'Kraft (red)',      offResp: KRAFT_OFF,      barcode: '021000025350', expectedStatus: 200 },
    { label: "Annie's (yellow)", offResp: ANNIES_OFF,     barcode: '013562000228', expectedStatus: 200 },
    { label: 'Not found',        offResp: NOT_FOUND_OFF,  barcode: '999999999999', expectedStatus: 404 },
  ];

  scenarios.forEach(({ label, offResp, barcode, expectedStatus }) => {
    describe(`scenario: ${label}`, () => {
      let res;

      beforeEach(async () => {
        mockFetchOnce(offResp);
        res = makeRes();
        await handler(makeReq('POST', { barcode }), res);
      });

      test(`HTTP status is ${expectedStatus}`, () => {
        expect(res.statusCode).toBe(expectedStatus);
      });

      test('all required top-level fields are present', () => {
        for (const field of REQUIRED_FIELDS) {
          expect(res.body).toHaveProperty(field);
        }
      });

      test('verdict is one of the four valid values', () => {
        expect(VALID_VERDICTS).toContain(res.body.verdict);
      });

      test('flags is an array', () => {
        expect(Array.isArray(res.body.flags)).toBe(true);
      });

      test('labelsDetected is an array', () => {
        expect(Array.isArray(res.body.labelsDetected)).toBe(true);
      });

      test('clearedBy is a string or null', () => {
        const v = res.body.clearedBy;
        expect(v === null || typeof v === 'string').toBe(true);
      });

      test('source is always "open-food-facts"', () => {
        expect(res.body.source).toBe('open-food-facts');
      });

      test('found is a boolean', () => {
        expect(typeof res.body.found).toBe('boolean');
      });

      test('every flag object has the required shape', () => {
        for (const flag of res.body.flags) {
          expect(typeof flag.category).toBe('string');
          expect(VALID_SEVERITIES).toContain(flag.severity);
          expect(typeof flag.matchedIngredient).toBe('string');
          expect(typeof flag.summary).toBe('string');
        }
      });
    });
  });
});
