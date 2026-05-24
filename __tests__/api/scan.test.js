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

  test('gluten_grains flags are stripped from the L2 response (paywall feature — not shown at any level)', () => {
    // gluten_grains flags are removed before the waterfall runs at L2, matching L1 behaviour.
    const glutenFlags = res.body.flags.filter(f => f.category === 'gluten_grains');
    expect(glutenFlags).toHaveLength(0);
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

// ════════════════════════════════════════════════════════════════════════════
// H. Meat verdict logic (block 26)
//    isMeatProduct detection + L2 conventional_meat flag injection
// ════════════════════════════════════════════════════════════════════════════

describe('H. Meat verdict logic', () => {
  // ── Shared OFF fixture builder ────────────────────────────────────────────

  /** Build a minimal OFF product response with the given categories_tags / labels_tags. */
  function meatOffResp({
    categoriesTags = [],
    labelsTags     = [],
    ingredientsText = 'beef, water, salt',
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     'Test Beef Product',
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── isMeatProduct detection ───────────────────────────────────────────────

  test('isMeat is true for en:beef', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:beef'] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000001', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(true);
  });

  test('isMeat is true for en:chicken', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:chicken'] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000002', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(true);
  });

  test('isMeat is true for en:fish', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:fish'], ingredientsText: 'salmon, water, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000003', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(true);
  });

  test('isMeat is true for en:eggs', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:eggs'], ingredientsText: 'whole eggs' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000004', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(true);
  });

  test('isMeat is true for en:sausages', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:sausages'] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000005', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(true);
  });

  test('isMeat is false for en:breads', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name:     'Bread',
        ingredients_text: 'wheat flour, water, yeast, salt',
        labels_tags:      [],
        categories_tags:  ['en:breads'],
      },
    });
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000006', userLevel: 2 }), res);
    expect(res.body.isMeat).toBe(false);
  });

  // ── L2: meat + no organic → RED, conventional_meat flag ──────────────────

  test('L2 meat + no organic label → verdict is RED', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:beef'], labelsTags: [] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000007', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
  });

  test('L2 meat + no organic label → conventional_meat flag is present', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:beef'], labelsTags: [] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000008', userLevel: 2 }), res);
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  test('L2 meat + no organic label → conventional_meat flag is first in array', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:beef'], labelsTags: [] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000009', userLevel: 2 }), res);
    expect(res.body.flags[0].category).toBe('conventional_meat');
  });

  // ── L2: meat + USDA Organic → no conventional_meat flag ──────────────────

  test('L2 meat + en:usda-organic → no conventional_meat flag', async () => {
    mockFetchOnce(meatOffResp({
      categoriesTags: ['en:beef'],
      labelsTags:     ['en:usda-organic'],
      ingredientsText: 'organic beef, water, sea salt',
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000010', userLevel: 2 }), res);
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeUndefined();
  });

  test('L2 meat + en:usda-organic → verdict is NOT forced red by conventional_meat', async () => {
    mockFetchOnce(meatOffResp({
      categoriesTags: ['en:beef'],
      labelsTags:     ['en:usda-organic'],
      ingredientsText: 'organic beef, water, sea salt',
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000011', userLevel: 2 }), res);
    // Organic beef with no other flags → green or yellow; must not be red from meat check
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── L1: meat → educational caution flag (not the L2 reject) ─────────────

  test('L1 meat + no organic label → conventional_meat flag is caution (not reject)', async () => {
    mockFetchOnce(meatOffResp({ categoriesTags: ['en:beef'], labelsTags: [] }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000012', userLevel: 1 }), res);
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    // L1 always injects an educational caution — never a reject — for meat products.
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// I. Inconclusive verdict — product found, ingredients present, all unrecognized
// ════════════════════════════════════════════════════════════════════════════

/**
 * A product whose entire ingredient list consists of tokens the engine has
 * never seen — no triggers fire, no whole-food tokens clear them, so they all
 * land in unverifiedIngredients at Level 2. Before the inconclusive fix these
 * returned a false 'green' verdict.
 *
 * Seven made-up tokens are used (threshold for inconclusive is > 5) so the
 * proxy check reliably fires. None of the tokens contain any known trigger
 * substring and none appear in WHOLE_FOOD_TOKENS_L2.
 */
const ALL_UNKNOWN_OFF = {
  status: 1,
  product: {
    product_name: 'Mystery Product',
    ingredients_text:
      'zymotrixal, biophenolate, hexamorphite, gluvaxitol, cryomethylane, phytorextrin, neovitriol',
    labels_tags: [],
    categories_tags: [],
  },
};

describe('I — inconclusive verdict: all ingredients unrecognized', () => {
  test('returns verdict: inconclusive (not green) when all ingredient tokens are unrecognized', async () => {
    mockFetchOnce(ALL_UNKNOWN_OFF);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000099', userLevel: 2 }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.verdict).toBe('inconclusive');
  });

  test('inconclusive result has a non-empty unverifiedIngredients array', async () => {
    mockFetchOnce(ALL_UNKNOWN_OFF);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000099', userLevel: 2 }), res);
    expect(res.body.unverifiedIngredients.length).toBeGreaterThan(0);
  });

  test('inconclusive result has flags: []', async () => {
    mockFetchOnce(ALL_UNKNOWN_OFF);
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000099', userLevel: 2 }), res);
    expect(res.body.flags).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// J. Level 1 explicit overrides — gluten suppression + conventional meat caution
// ════════════════════════════════════════════════════════════════════════════

describe('J. Level 1 explicit overrides', () => {
  /** Minimal OFF response builder for L1 override tests. */
  function l1OffResp({
    ingredientsText = 'water, salt',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     'Test Product',
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── Override 1: gluten suppression ────────────────────────────────────────

  test('L1: product with only a gluten flag → verdict is green (gluten suppressed)', async () => {
    // rye triggers gluten_grains only (not conventional_crops) — clean isolation for this test
    mockFetchOnce(l1OffResp({ ingredientsText: 'rye, water, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000101', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags.filter(f => f.category === 'gluten_grains')).toHaveLength(0);
  });

  test('L1: product with gluten AND seed_oils → verdict is yellow (seed oil remains, gluten removed)', async () => {
    // canola oil → seed_oils caution at L1; wheat flour → gluten_grains caution (suppressed)
    mockFetchOnce(l1OffResp({ ingredientsText: 'wheat flour, canola oil, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000102', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(res.body.flags.filter(f => f.category === 'gluten_grains')).toHaveLength(0);
  });

  test('L1: gluten flag is absent from the response flags array after suppression', async () => {
    mockFetchOnce(l1OffResp({ ingredientsText: 'oat flour, water, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000103', userLevel: 1 }), res);
    expect(res.body.flags.some(f => f.category === 'gluten_grains')).toBe(false);
  });

  // ── Override 2: conventional meat caution ─────────────────────────────────

  test('L1: meat product → conventional_meat flag with severity caution', async () => {
    mockFetchOnce(l1OffResp({
      ingredientsText: 'beef, water, salt',
      categoriesTags:  ['en:beef'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000104', userLevel: 1 }), res);
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  test('L1: meat product with clean ingredients → verdict is yellow (caution from meat flag)', async () => {
    mockFetchOnce(l1OffResp({
      ingredientsText: 'beef, water, salt',
      categoriesTags:  ['en:beef'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000105', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('yellow');
  });

  test('L1: non-meat product → no conventional_meat flag', async () => {
    mockFetchOnce(l1OffResp({
      ingredientsText: 'water, salt',
      categoriesTags:  ['en:snacks'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000106', userLevel: 1 }), res);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  test('L1: meat product with reject additives → verdict stays red (caution cannot override reject)', async () => {
    // yellow 5 → additives reject at both levels; meat caution added on top
    mockFetchOnce(l1OffResp({
      ingredientsText: 'beef, yellow 5, salt',
      categoriesTags:  ['en:beef'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000107', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('red');
    // conventional_meat caution is still injected alongside the reject flag
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(true);
  });

  // ── Override independence: additives still red ────────────────────────────

  test('L1: product with only additives → verdict is red (instant red unaffected by L1 logic)', async () => {
    mockFetchOnce(l1OffResp({ ingredientsText: 'water, yellow 5, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000108', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'additives')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// K. Level 2 flags array cleanup — gluten strip + conventional_crops strip
// ════════════════════════════════════════════════════════════════════════════

describe('K. Level 2 flags cleanup', () => {
  /** Minimal OFF response builder for L2 cleanup tests. */
  function l2CleanupOffResp({
    ingredientsText = 'water, salt',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     'Test Product',
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── Fix 1: gluten strip at L2 ─────────────────────────────────────────────

  test('K1: L2 + organic cert + only gluten → verdict GREEN with empty flags array', async () => {
    // rye triggers gluten_grains only; organic cert clears conventional_crops (none here anyway)
    mockFetchOnce(l2CleanupOffResp({
      ingredientsText: 'rye, water, salt',
      labelsTags:      ['en:usda-organic'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000201', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags.filter(f => f.category === 'gluten_grains')).toHaveLength(0);
    expect(res.body.flags).toHaveLength(0);
  });

  test('K2: L2 + no cert + only gluten → verdict RED with empty flags array (non-organic path)', async () => {
    // gluten stripped before waterfall; no cert → non-organic path → RED
    mockFetchOnce(l2CleanupOffResp({ ingredientsText: 'rye, water, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000202', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.filter(f => f.category === 'gluten_grains')).toHaveLength(0);
    expect(res.body.flags).toHaveLength(0);
  });

  test('K3: L2 + gluten AND seed_oils → RED with seed_oils in flags, gluten_grains absent', async () => {
    // canola oil → seed_oils (instant-red); rye → gluten_grains (stripped before waterfall)
    mockFetchOnce(l2CleanupOffResp({ ingredientsText: 'rye, canola oil, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000203', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(res.body.flags.filter(f => f.category === 'gluten_grains')).toHaveLength(0);
  });

  // ── Fix 2: conventional_crops strip for L2 organic products ──────────────

  test('K4: L2 organic product has no conventional_crops flags in response', async () => {
    // USDA organic clears conventional_crops in the engine; Fix 2 ensures no stragglers
    mockFetchOnce(l2CleanupOffResp({
      ingredientsText: 'wheat flour, sea salt',
      labelsTags:      ['en:usda-organic'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000204', userLevel: 2 }), res);
    expect(res.body.flags.filter(f => f.category === 'conventional_crops')).toHaveLength(0);
    expect(res.body.clearedBy).toBe('organic');
  });

  test('K5: L2 non-organic product retains conventional_crops flags (explains the red verdict)', async () => {
    // No cert → conventional_crops flags are kept so the user understands why it is red
    mockFetchOnce(l2CleanupOffResp({ ingredientsText: 'corn starch, sea salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000205', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_crops')).toBe(true);
  });
});
