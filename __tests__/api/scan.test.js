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

  // ── Category 2: Glyphosate-heavy crops (wheat flour moved from conventional_crops) ──
  test('flags wheat flour as glyphosate_heavy / reject', () => {
    const flag = res.body.flags.find(
      f => f.category === 'glyphosate_heavy' && f.matchedIngredient === 'wheat flour'
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

  // ── L2 organic path: fortified vitamins → yellow + flag ───────────────────

  test('L2 organic + fortified vitamins → verdict is YELLOW', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name:     'Organic Enriched Test',
        ingredients_text: 'water, riboflavin, folic acid',
        labels_tags:      ['en:usda-organic'],
        categories_tags:  [],
      },
    });
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000013', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
  });

  test('L2 organic + fortified vitamins → flags contains exactly one fortified_vitamins caution flag', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name:     'Organic Enriched Test',
        ingredients_text: 'water, riboflavin, folic acid',
        labels_tags:      ['en:usda-organic'],
        categories_tags:  [],
      },
    });
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000014', userLevel: 2 }), res);
    const fortifiedFlags = res.body.flags.filter(f => f.category === 'fortified_vitamins');
    expect(fortifiedFlags).toHaveLength(1);
    expect(fortifiedFlags[0].severity).toBe('caution');
  });

  // ── L2 organic path: natural colorants → yellow + flag ────────────────────

  test('L2 organic + natural colorants → verdict is YELLOW', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name:     'Organic Colored Test',
        ingredients_text: 'water, annatto extract',
        labels_tags:      ['en:usda-organic'],
        categories_tags:  [],
      },
    });
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000015', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
  });

  test('L2 organic + natural colorants → flags contains exactly one natural_colorants caution flag', async () => {
    mockFetchOnce({
      status: 1,
      product: {
        product_name:     'Organic Colored Test',
        ingredients_text: 'water, annatto extract',
        labels_tags:      ['en:usda-organic'],
        categories_tags:  [],
      },
    });
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000016', userLevel: 2 }), res);
    const colorantFlags = res.body.flags.filter(f => f.category === 'natural_colorants');
    expect(colorantFlags).toHaveLength(1);
    expect(colorantFlags[0].severity).toBe('caution');
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
    // rice flour triggers gluten_grains only — rye now also fires GLYPHOSATE_HEAVY so can't be used here
    mockFetchOnce(l1OffResp({ ingredientsText: 'rice flour, water, salt' }));
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
    // rye triggers GLUTEN_GRAINS (stripped at L2) + GLYPHOSATE_HEAVY (cleared by usda-organic)
    // → no flags remain → organic sub-tree → GREEN
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

  test('K2: L2 + no cert + only gluten → verdict YELLOW with empty flags array (default node)', async () => {
    // rice flour triggers gluten_grains only — rye also fires GLYPHOSATE_HEAVY; use rice flour
    // for clean isolation. Gluten stripped before tree; no cert, no other triggers
    // → falls through to default node (step 14) → YELLOW with empty flags
    mockFetchOnce(l2CleanupOffResp({ ingredientsText: 'rice flour, water, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000202', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
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

// ════════════════════════════════════════════════════════════════════════════
// L. Universal L2 decision tree — 15 integration scenarios
//    Tests each node of the new decision tree independently.
// ════════════════════════════════════════════════════════════════════════════

describe('L. Universal L2 decision tree', () => {
  /** Minimal OFF response builder for Suite L tests. */
  function l2TreeOffResp({
    ingredientsText = 'water, salt',
    labelsTags      = [],
    categoriesTags  = [],
    productName     = 'Test Product',
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── L1: pistachios + salt → YELLOW (default node) ─────────────────────────

  test('L1: pistachios + salt → YELLOW (default node — no cert, no conventional trigger)', async () => {
    // Pistachios are not in CONVENTIONAL_CROPS; salt is in the ignore list.
    // No cert, no meat/dairy/egg/bio triggers → falls to default node → YELLOW.
    mockFetchOnce(l2TreeOffResp({ ingredientsText: 'pistachios, salt' }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000301', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.flags).toHaveLength(0);
  });

  // ── L2: conventional sausage → RED at conventional meat node ──────────────

  test('L2: conventional sausage (no organic) → RED with conventional_meat reject flag', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'beef, pork, water, salt, spices',
      categoriesTags:  ['en:sausages'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000302', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── L3: conventional milk → RED at conventional dairy node ───────────────

  test('L3: "whole milk" (no organic cert) → RED with conventional_dairy flag', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'whole milk, vitamin d',
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000303', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    const flag = res.body.flags.find(f => f.category === 'conventional_dairy');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── L4: non-organic cheese → RED at conventional dairy node ──────────────

  test('L4: "cheese, salt" (no organic cert) → RED with conventional_dairy flag', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'cheese, salt',
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000304', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_dairy')).toBe(true);
  });

  // ── L5: non-organic eggs → RED at conventional meat node (egg-derived) ─────

  test('L5: "eggs, salt" (no organic cert, no meat category tag) → RED with conventional_eggs flag via engine detection (Node 8b)', async () => {
    // Product has egg ingredients but no en:eggs category tag — the engine detects
    // conventional_eggs and Node 8b fires. conventional_meat should NOT be present.
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'eggs, salt',
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000305', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_eggs')).toBe(true);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── L6: organic beef → GREEN (organic path, no fortification/colorant/olive oil) ─

  test('L6: organic beef (usda-organic, no other concerns) → GREEN', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'organic beef, water, sea salt',
      labelsTags:      ['en:usda-organic'],
      categoriesTags:  ['en:beef'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000306', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags).toHaveLength(0);
    expect(res.body.clearedBy).toBe('organic');
  });

  // ── L7: organic + olive oil → YELLOW with oliveCaveat: true ──────────────

  test('L7: organic product with olive oil → YELLOW with oliveCaveat: true', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'organic olive oil, water',
      labelsTags:      ['en:usda-organic'],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000307', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.oliveCaveat).toBe(true);
    expect(res.body.flags.some(f => f.category === 'olive_oil_adulteration')).toBe(true);
  });

  // ── L8: organic + fortified vitamins → YELLOW ────────────────────────────

  test('L8: organic product with riboflavin (fortified) → YELLOW with fortified_vitamins flag', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'organic wheat flour, riboflavin, folic acid',
      labelsTags:      ['en:usda-organic'],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000308', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.flags.some(f => f.category === 'fortified_vitamins')).toBe(true);
  });

  // ── L9: wild-caught seafood → GREEN ──────────────────────────────────────

  test('L9: wild-caught salmon (en:wild-caught label, en:salmon category) → GREEN', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'wild-caught salmon, water, salt',
      labelsTags:      ['en:wild-caught'],
      categoriesTags:  ['en:salmon'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000309', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('wild-caught');
  });

  // ── L10: farmed seafood → RED ─────────────────────────────────────────────

  test('L10: salmon with no wild-caught label → RED with conventional_meat flag', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'salmon, water, salt',
      labelsTags:      [],
      categoriesTags:  ['en:salmon'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000310', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(true);
  });

  // ── L11: bioengineered disclosure → RED at bioengineering node ────────────

  test('L11: bioengineered disclosure (no cert, no conventional crops) → RED at bioengineering node', async () => {
    // Only a bioengineering disclosure — no conventional_crops flags — so the tree
    // reaches step 11 rather than step 10.
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'contains bioengineered food ingredients',
      labelsTags:      [],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000311', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'bioengineering')).toBe(true);
  });

  // ── L12: glyphosate-free certified → YELLOW ──────────────────────────────

  test('L12: glyphosate-free certified (pistachios, no other cert) → YELLOW at glyphosate-free node', async () => {
    // Pistachios not in CONVENTIONAL_CROPS, so the tree reaches step 12.
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'pistachios, sea salt',
      labelsTags:      ['en:glyphosate-free'],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000312', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.clearedBy).toBe('glyphosate-free');
  });

  // ── L13: non-GMO certified → YELLOW ──────────────────────────────────────

  test('L13: non-GMO certified (corn starch) → YELLOW at non-GMO node (step 7 fires before conventional_crops step 10)', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'corn starch, water, salt',
      labelsTags:      ['en:non-gmo-project-verified'],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000313', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.clearedBy).toBe('non-gmo-project-verified');
  });

  // ── L14: game meat → GREEN ────────────────────────────────────────────────

  test('L14: game meat (en:game-meats, no cert) → GREEN (wild-harvested by nature)', async () => {
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'venison, water, salt',
      labelsTags:      [],
      categoriesTags:  ['en:game-meats'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000314', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── L15: salt + water only → YELLOW (ignore list working, default node) ───

  test('L15: "salt, water" (no cert, no triggers) → YELLOW with empty flags (ignore list prevents false positives)', async () => {
    // Salt and water are both in ALWAYS_IGNORE_INGREDIENTS; after masking there
    // are no ingredient signals and no cert → default node → YELLOW, not RED.
    mockFetchOnce(l2TreeOffResp({
      ingredientsText: 'salt, water',
      labelsTags:      [],
      categoriesTags:  [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000315', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.flags).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M. Cache version — PROMPT_VERSION contract
// ════════════════════════════════════════════════════════════════════════════

describe('M. PROMPT_VERSION', () => {
  test('PROMPT_VERSION is 21 (v21: allergen advisory stripping, yogurt culture ignore list, flag deduplication)', () => {
    // Import from lib/cacheVersion — never from pages/api/explain.js
    const { PROMPT_VERSION } = require('../../lib/cacheVersion');
    expect(PROMPT_VERSION).toBe(21);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// N. Wild-caught detection — product name signals + farmed exclusions
//    Tests the detectWildCaught() helper wired into Node 5 of the L2 tree.
// ════════════════════════════════════════════════════════════════════════════

describe('N. Wild-caught detection', () => {
  /** Minimal OFF response builder for Suite N tests. */
  function wildCaughtOffResp({
    productName     = 'Test Fish Product',
    ingredientsText = 'fish, water, salt',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── N1: product name detection (no OFF label) ─────────────────────────────

  test('N1: "Wild-Caught Pacific Cod" (name signal only, no OFF label) → GREEN, clearedBy "wild-caught"', async () => {
    mockFetchOnce(wildCaughtOffResp({
      productName:     'Wild-Caught Pacific Cod Fillets',
      ingredientsText: 'cod, water, salt',
      categoriesTags:  ['en:cod'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000401', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('wild-caught');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── N2: name detection when OFF has no seafood category tag ──────────────

  test('N2: "Wild Caught Alaskan Salmon" (name signal, no OFF seafood category) → GREEN', async () => {
    // Product has no en:salmon/en:seafood category in OFF — wild-caught is
    // detected purely from the product name, not from the category or label.
    mockFetchOnce(wildCaughtOffResp({
      productName:     'Wild Caught Alaskan Salmon',
      ingredientsText: 'salmon, water, salt',
      categoriesTags:  [],  // deliberately no seafood category
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000402', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('wild-caught');
  });

  // ── N3: farmed exclusion — "farm-raised" in product name → RED ───────────

  test('N3: "Farm-Raised Atlantic Salmon" → RED with conventional_meat flag (farmed exclusion fires)', async () => {
    // "farm-raised" in product name causes detectWildCaught to return false.
    // isSeafood = true (en:salmon) → Node 5b → RED with conventional_meat.
    mockFetchOnce(wildCaughtOffResp({
      productName:     'Farm-Raised Atlantic Salmon',
      ingredientsText: 'atlantic salmon, water, salt',
      categoriesTags:  ['en:salmon'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000403', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('reject');
  });

  // ── N4: seed oil short-circuits the tree before wild-caught node ──────────

  test('N4: wild-caught salmon WITH canola oil → RED for seed_oils, no conventional_meat flag', async () => {
    // Nodes 1–3 (seed_oils instant-red) fire before Node 5.
    // The product would be wild-caught, but the seed oil catches it first.
    mockFetchOnce(wildCaughtOffResp({
      productName:     'Wild-Caught Salmon in Canola Oil',
      ingredientsText: 'salmon, canola oil, salt',
      categoriesTags:  ['en:salmon'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000404', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'seed_oils')).toBe(true);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// O. cert_unconfirmed — all-organic ingredient prefix detection
//    Tests the allIngredientsPrefixedOrganic() check that sets
//    unverifiedReason = 'cert_unconfirmed' for YELLOW products where every
//    non-trivial ingredient starts with "organic" but no USDA cert tag is
//    present in the OFF database.
// ════════════════════════════════════════════════════════════════════════════

describe('O. cert_unconfirmed', () => {
  /** Minimal OFF response builder for Suite O tests. */
  function certOffResp({
    productName     = 'Test Product',
    ingredientsText = '',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── O1: single-ingredient organic product, no cert tag → cert_unconfirmed ──

  test('O1: "Organic pumpkin." no cert tag → verdict yellow, unverified_reason cert_unconfirmed', async () => {
    mockFetchOnce(certOffResp({
      productName:     'Organic Pumpkin',
      ingredientsText: 'Organic pumpkin.',
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000501', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.unverifiedReason).toBe('cert_unconfirmed');
    expect(res.body.clearedBy).toBeNull();
  });

  // ── O2: multi-ingredient all-organic with trivial water, no cert → cert_unconfirmed

  test('O2: "Organic sweet corn, water." no cert → cert_unconfirmed (water is trivial, excluded)', async () => {
    mockFetchOnce(certOffResp({
      productName:     'Organic Sweet Corn',
      ingredientsText: 'Organic sweet corn, water.',
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000502', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.unverifiedReason).toBe('cert_unconfirmed');
  });

  // ── O3: mixed organic / non-organic ingredients → NOT cert_unconfirmed ─────

  test('O3: "Organic carrots, cashews" — cashews not prefixed → NOT cert_unconfirmed', async () => {
    mockFetchOnce(certOffResp({
      productName:     'Organic Carrot Snack',
      ingredientsText: 'Organic carrots, cashews.',
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000503', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    // unverifiedReason should be null — not every ingredient is "organic"-prefixed
    expect(res.body.unverifiedReason).toBeNull();
  });

  // ── O4: all-organic ingredients WITH usda-organic label → NOT cert_unconfirmed

  test('O4: "Organic pumpkin." WITH usda-organic label → green, NOT cert_unconfirmed', async () => {
    mockFetchOnce(certOffResp({
      productName:     'Organic Pumpkin',
      ingredientsText: 'Organic pumpkin.',
      labelsTags:      ['en:usda-organic'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000504', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('organic');
    expect(res.body.unverifiedReason).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P. conventional_eggs — own category, separate from conventional_meat
//    Tests that egg ingredients in non-meat products produce a conventional_eggs
//    flag (not conventional_meat), organic prefix clears the flag, a product
//    with both meat and eggs gets both flags, and dairy detection is unaffected.
// ════════════════════════════════════════════════════════════════════════════

describe('P. conventional_eggs', () => {
  /** Minimal OFF response builder for Suite P tests. */
  function eggsOffResp({
    productName     = 'Test Product',
    ingredientsText = '',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── P1: non-meat product with eggs + no cert → conventional_eggs, no conventional_meat

  test('P1: pasta with eggs, no cert, no meat category → conventional_eggs RED, no conventional_meat flag', async () => {
    // Ravioli / pasta-type product: egg ingredient present, no USDA organic cert,
    // not in a MEAT_CATEGORIES tag. Should get conventional_eggs, NOT conventional_meat.
    mockFetchOnce(eggsOffResp({
      productName:     'Fresh Pasta Ravioli',
      ingredientsText: 'semolina flour, eggs, water, salt',
      labelsTags:      [],
      categoriesTags:  ['en:pasta', 'en:fresh-pasta'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000601', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_eggs')).toBe(true);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── P2: "organic eggs" in ingredient text → no conventional_eggs flag ─────

  test('P2: "organic eggs" as ingredient (no cert tag) → no conventional_eggs flag', async () => {
    // The isPrecededByOrganic() guard in the engine should clear egg terms
    // that appear with an "organic" prefix in the ingredient text.
    mockFetchOnce(eggsOffResp({
      productName:     'Organic Egg Noodles',
      ingredientsText: 'organic wheat flour, organic eggs, water',
      labelsTags:      [],
      categoriesTags:  ['en:pasta'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000602', userLevel: 2 }), res);
    expect(res.body.flags.some(f => f.category === 'conventional_eggs')).toBe(false);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── P3: product with both eggs and meat (isMeat=true) → both flags present ─

  test('P3: chicken broth product with eggs → both conventional_meat (injected) and conventional_eggs (engine) in flags', async () => {
    // Product has a meat OFF category (en:broths) AND egg in ingredients.
    // Node 8 fires first (isConventionalMeat=true) and injects conventional_meat.
    // The engine's conventional_eggs flag should still be present in the array.
    mockFetchOnce(eggsOffResp({
      productName:     'Chicken Noodle Soup',
      ingredientsText: 'chicken broth, egg noodles, eggs, chicken, salt',
      labelsTags:      [],
      categoriesTags:  ['en:broths', 'en:soups'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000603', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(true);
    expect(res.body.flags.some(f => f.category === 'conventional_eggs')).toBe(true);
  });

  // ── P4: product with dairy ingredients but no eggs → conventional_dairy fires, conventional_eggs does not

  test('P4: product with dairy but no eggs → conventional_dairy fires, conventional_eggs does NOT fire', async () => {
    // Node 8b (conventional_eggs) is skipped — no egg flags from engine.
    // Node 9 (conventional_dairy via containsMilkDerived) fires correctly.
    // Note: bare "milk" is not in MILK_DERIVED_INGREDIENTS (avoids false positives
    // like "almond milk") — use "whole milk" which IS a compound dairy trigger.
    mockFetchOnce(eggsOffResp({
      productName:     'Cream of Mushroom Soup',
      ingredientsText: 'water, mushrooms, whole milk, heavy cream, salt',
      labelsTags:      [],
      categoriesTags:  ['en:soups'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000604', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_dairy')).toBe(true);
    expect(res.body.flags.some(f => f.category === 'conventional_eggs')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Q. detectWildCaught — standalone "wild" word signal (v18 extension)
//    Tests the two new positive signals added to detectWildCaught():
//    (3) standalone "wild" in product name, (4) standalone "wild" in ingredients.
//    Farmed exclusions must still override all positive signals.
// ════════════════════════════════════════════════════════════════════════════

describe('Q. detectWildCaught — standalone wild signal', () => {
  /** Minimal OFF response builder for Suite Q tests. */
  function wildOffResp({
    productName     = 'Test Fish Product',
    ingredientsText = 'fish, water, salt',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── Q1: "ALBACORE WILD TUNA" — standalone "wild" in product name ──────────

  test('Q1: "ALBACORE WILD TUNA" — standalone "wild" in product name → GREEN, clearedBy wild-caught', async () => {
    mockFetchOnce(wildOffResp({
      productName:     'ALBACORE WILD TUNA',
      ingredientsText: 'albacore tuna, water, salt',
      categoriesTags:  ['en:tuna'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000701', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('wild-caught');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── Q2: "Wild Pink Salmon" with "Wild pink salmon" in ingredients ─────────

  test('Q2: "Wild Pink Salmon" with "Wild pink salmon" in ingredients → GREEN', async () => {
    // Signal fires via both product name (signal 3) and ingredients (signal 4).
    mockFetchOnce(wildOffResp({
      productName:     'Wild Pink Salmon',
      ingredientsText: 'Wild pink salmon, salt',
      categoriesTags:  ['en:salmon'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000702', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('wild-caught');
  });

  // ── Q3: "Wild Berry Jam" — "wild" in non-seafood product name → not affected

  test('Q3: "Wild Berry Jam" (non-seafood, isMeat=false) → detectWildCaught irrelevant; no conventional_meat flag', async () => {
    // detectWildCaught would return true for this product, but that only matters
    // at Node 5 of the L2 tree which only fires when the tree hasn't already exited.
    // A non-meat, non-seafood product with no cert and no concerning ingredients
    // reaches Node 14 (default yellow) — not flagged as conventional_meat.
    mockFetchOnce(wildOffResp({
      productName:     'Wild Berry Jam',
      ingredientsText: 'strawberries, sugar, pectin',
      categoriesTags:  ['en:jams'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000703', userLevel: 2 }), res);
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── Q4: "wild" in product name but "astaxanthin" in ingredients → farmed exclusion

  test('Q4: "Wild Salmon" but ingredients contain "astaxanthin" → farmed exclusion wins, RED', async () => {
    // astaxanthin is a synthetic pigment used to colour farmed salmon;
    // its presence takes precedence over the "wild" name signal.
    mockFetchOnce(wildOffResp({
      productName:     'Wild Salmon Fillet',
      ingredientsText: 'salmon, astaxanthin, salt',
      categoriesTags:  ['en:salmon'],
      labelsTags:      [],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000704', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R. Pure-water GREEN path (v19)
//    Tests allIngredientsAreWaterSafe() + clearedBy 'pure_water' upgrade.
//    Natural mineral water/spring water/artesian water can't hold USDA organic
//    cert — organic cert is inapplicable to geological water sources.
//    Default YELLOW (Node 14) is wrong for these products; they should be GREEN.
// ════════════════════════════════════════════════════════════════════════════

describe('R. Pure-water GREEN path', () => {
  /** Minimal OFF response builder for Suite R tests. */
  function waterOffResp({
    productName     = 'Test Water Product',
    ingredientsText = '',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── R1: artesian water with minerals → GREEN, clearedBy 'pure_water' ──────

  test('R1: artesian water + natural minerals → GREEN, clearedBy "pure_water", flags empty', async () => {
    // Real-world ingredient text for "Natural Artesian Water" that triggered the bug.
    // All tokens (water, silica, calcium, magnesium, bicarbonates) are in
    // WATER_SAFE_INGREDIENTS, so the post-waterfall check upgrades YELLOW → GREEN.
    mockFetchOnce(waterOffResp({
      productName:     'Natural Artesian Water',
      ingredientsText: 'Water, silica, calcium, magnesium, bicarbonates',
      labelsTags:      [],
      categoriesTags:  ['en:waters'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000801', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('pure_water');
    expect(res.body.flags).toHaveLength(0);
  });

  // ── R2: plain sparkling water → GREEN ────────────────────────────────────

  test('R2: sparkling water + carbon dioxide → GREEN, clearedBy "pure_water"', async () => {
    mockFetchOnce(waterOffResp({
      productName:     'Sparkling Mineral Water',
      ingredientsText: 'sparkling water, carbon dioxide',
      labelsTags:      [],
      categoriesTags:  ['en:waters'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000802', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.clearedBy).toBe('pure_water');
  });

  // ── R3: water + natural flavor → RED (instant-red fires first) ────────────

  test('R3: water + natural flavor → RED (natural_flavors instant-red fires before water-safe check)', async () => {
    // "natural flavor" triggers the natural_flavors instant-red at L2 Nodes 1–3.
    // verdict is set to RED before the post-waterfall check ever runs.
    // Verifies that the pure-water path does not rescue products with concerning ingredients.
    mockFetchOnce(waterOffResp({
      productName:     'Flavored Water',
      ingredientsText: 'water, natural flavor',
      labelsTags:      [],
      categoriesTags:  ['en:waters'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000803', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('red');
    expect(res.body.flags.some(f => f.category === 'natural_flavors')).toBe(true);
    expect(res.body.clearedBy).toBeNull();
  });

  // ── R4: coconut water → stays YELLOW (not in WATER_SAFE_INGREDIENTS) ──────

  test('R4: coconut water (not in WATER_SAFE_INGREDIENTS) → YELLOW, no pure_water clearance', async () => {
    // "coconut water" is not a geological water source and is not in the
    // WATER_SAFE_INGREDIENTS set. The pure-water check returns false, and the
    // product stays at default YELLOW (Node 14).
    mockFetchOnce(waterOffResp({
      productName:     'Pure Coconut Water',
      ingredientsText: 'coconut water',
      labelsTags:      [],
      categoriesTags:  ['en:coconut-waters'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000804', userLevel: 2 }), res);
    expect(res.body.verdict).toBe('yellow');
    expect(res.body.clearedBy).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S. L1 seafood / game-meat / dairy overrides
// ════════════════════════════════════════════════════════════════════════════

describe('S. L1 seafood / game-meat / dairy overrides', () => {
  /** Minimal OFF response builder for Suite S tests. */
  function s1OffResp({
    productName     = 'Test Product',
    ingredientsText = 'water, salt',
    labelsTags      = [],
    categoriesTags  = [],
  } = {}) {
    return {
      status: 1,
      product: {
        product_name:     productName,
        ingredients_text: ingredientsText,
        labels_tags:      labelsTags,
        categories_tags:  categoriesTags,
      },
    };
  }

  // ── S1: wild-caught seafood → GREEN, no conventional_meat flag ───────────

  test('S1: L1 wild-caught seafood → GREEN, no conventional_meat flag injected', async () => {
    // en:wild-caught-fish normalises to "wild-caught" in labelsDetected.
    // detectWildCaught() returns true → mirror L2 node 5 → skip injection.
    mockFetchOnce(s1OffResp({
      productName:     'Wild Caught Salmon',
      ingredientsText: 'wild salmon, sea salt',
      labelsTags:      ['en:wild-caught-fish'],
      categoriesTags:  ['en:fish'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000901', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── S2: farmed seafood (no wild signal) → YELLOW + conventional_meat caution

  test('S2: L1 farmed seafood → YELLOW, conventional_meat caution flag injected', async () => {
    // "Atlantic Salmon Fillet" triggers the "atlantic salmon" farmed exclusion in
    // detectWildCaught(), and there are no wild signals → returns false.
    // Falls through to the else branch → inject conventional_meat caution.
    mockFetchOnce(s1OffResp({
      productName:     'Atlantic Salmon Fillet',
      ingredientsText: 'atlantic salmon, salt',
      labelsTags:      [],
      categoriesTags:  ['en:fish'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000902', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('yellow');
    const flag = res.body.flags.find(f => f.category === 'conventional_meat');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  // ── S3: game meat → GREEN, no conventional_meat flag ─────────────────────

  test('S3: L1 game meat (en:game-meats) → GREEN, no conventional_meat flag injected', async () => {
    // Game meat categories mirror L2 node 6 — wild-harvested by nature, no cert needed.
    mockFetchOnce(s1OffResp({
      productName:     'Venison Steak',
      ingredientsText: 'venison, salt',
      labelsTags:      [],
      categoriesTags:  ['en:game-meats'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000903', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('green');
    expect(res.body.flags.some(f => f.category === 'conventional_meat')).toBe(false);
  });

  // ── S4: dairy product, no usda-organic → YELLOW + conventional_dairy caution

  test('S4: L1 dairy (whole milk, no cert) → GREEN upgraded to YELLOW, conventional_dairy caution flag', async () => {
    // "whole milk, salt" — engine finds no triggers → green.
    // Override 3 detects whole milk via containsMilkDerived() and injects caution → yellow.
    mockFetchOnce(s1OffResp({
      productName:     'Fresh Whole Milk',
      ingredientsText: 'whole milk, salt',
      labelsTags:      [],
      categoriesTags:  ['en:dairy'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000904', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('yellow');
    const flag = res.body.flags.find(f => f.category === 'conventional_dairy');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });

  // ── S5: dairy product, with usda-organic → no conventional_dairy flag ────

  test('S5: L1 dairy + usda-organic → no conventional_dairy flag injected', async () => {
    // USDA Organic cert is present → l1HasOrganic = true → dairy check skipped.
    mockFetchOnce(s1OffResp({
      productName:     'Organic Whole Milk',
      ingredientsText: 'organic whole milk, salt',
      labelsTags:      ['en:usda-organic'],
      categoriesTags:  ['en:dairy'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000905', userLevel: 1 }), res);
    expect(res.body.flags.some(f => f.category === 'conventional_dairy')).toBe(false);
  });

  // ── S6: RED product with dairy → verdict stays RED, conventional_dairy caution added

  test('S6: L1 RED product with dairy → verdict stays RED, conventional_dairy caution flag present', async () => {
    // yellow 5 → additives (reject) → RED. Dairy override injects caution on top
    // but cannot downgrade RED — verdict must stay red.
    mockFetchOnce(s1OffResp({
      productName:     'Chocolate Pudding',
      ingredientsText: 'whole milk, yellow 5, salt',
      labelsTags:      [],
      categoriesTags:  ['en:desserts'],
    }));
    const res = makeRes();
    await handler(makeReq('POST', { barcode: '000000000906', userLevel: 1 }), res);
    expect(res.body.verdict).toBe('red');
    const flag = res.body.flags.find(f => f.category === 'conventional_dairy');
    expect(flag).toBeDefined();
    expect(flag.severity).toBe('caution');
  });
});
