'use strict';

/**
 * __tests__/api/admin/swap-candidates.test.js
 *
 * Tests for GET /api/admin/swap-candidates (Phase 3a of the swaps overhaul —
 * foundation only, no admin UI or approve/reject action yet).
 *
 * requireAdmin() is mocked so most tests can focus purely on the endpoint's
 * own query/filtering logic without re-exercising token verification —
 * that's already covered directly in lib/requireAdmin.test.js. Suite A here
 * verifies the endpoint actually wires requireAdmin() into a 401 response,
 * using the real (unmocked-for-that-test) rejection path.
 *
 * getSupabaseServer() is mocked with a fake client whose .from(table) routes
 * to canned {data, error} results per table, matching the real handler's
 * exact query shape for each of the four tables it touches: scans,
 * swap_products, swap_candidate_reviews, scan_cache.
 *
 * Suites:
 *   A. Admin auth wiring (401 handling)
 *   B. Distinct-scanner threshold (>= 3)
 *   C. swap_products exclusion
 *   D. swap_candidate_reviews exclusion
 *   E. Multi-level scan_cache join
 *   F. Response shape / early-return edge cases
 *   G. Error handling
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../lib/requireAdmin', () => ({
  requireAdmin: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const { requireAdmin } = require('../../../lib/requireAdmin');
const handler = require('../../../pages/api/admin/swap-candidates').default;

const ADMIN_USER = { id: 'admin-1', email: 'admin@beyondlabels.example' };

function makeReq(headers = { authorization: 'Bearer admin-token' }) {
  return { method: 'GET', headers };
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

/** One green-scan row as the `scans` table would return it. */
function scanRow(barcode, userId) {
  return { barcode, user_id: userId };
}

/** One scan_cache row as the table would return it. */
function cacheRow(overrides = {}) {
  return {
    barcode: 'B1',
    user_level: 2,
    verdict: 'green',
    product_name: 'Test Product',
    product_category: 'condiments',
    product_subcategory: null,
    explanation: { summary: 'Clean.', details: {} },
    prompt_version: 42,
    ...overrides,
  };
}

function mockSb({ scans = [], swapProducts = [], reviews = [], scanCache = [], scansError = null } = {}) {
  const fromSpy = jest.fn((table) => {
    switch (table) {
      case 'scans':
        return { select: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: scans, error: scansError }) })) };
      case 'swap_products':
        return { select: jest.fn().mockResolvedValue({ data: swapProducts, error: null }) };
      case 'swap_candidate_reviews':
        return { select: jest.fn().mockResolvedValue({ data: reviews, error: null }) };
      case 'scan_cache':
        return { select: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: scanCache, error: null }) })) };
      default:
        throw new Error(`Unexpected table in test: ${table}`);
    }
  });
  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN_USER);
});

// ════════════════════════════════════════════════════════════════════════════
// A. Admin auth wiring
// ════════════════════════════════════════════════════════════════════════════

describe('A. Admin auth wiring', () => {
  test('A1: requireAdmin() resolves null → 401, no Supabase queries made', async () => {
    requireAdmin.mockResolvedValue(null);
    const { fromSpy } = mockSb({});
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  test('A2: requireAdmin() resolves a user → request proceeds (200, not 401)', async () => {
    mockSb({ scans: [] });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
  });

  test('A3: non-GET method → 405 before requireAdmin is even consulted', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(405);
    expect(requireAdmin).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Distinct-scanner threshold (>= 3)
// ════════════════════════════════════════════════════════════════════════════

describe('B. Distinct-scanner threshold', () => {
  test('B1: exactly 2 distinct users (just under) → excluded', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2')],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toEqual([]);
  });

  test('B2: exactly 3 distinct users (just at the threshold) → included', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [cacheRow({ barcode: 'B1' })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].barcode).toBe('B1');
    expect(res.body.candidates[0].distinctScanCount).toBe(3);
  });

  test('B3: the same user scanning the same barcode repeatedly counts once, not per-scan', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u1'), scanRow('B1', 'u1'), scanRow('B1', 'u2')],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    // Only 2 distinct users despite 4 scan rows — still under threshold.
    expect(res.body.candidates).toEqual([]);
  });

  test('B4: rows with a null user_id (anonymous scans) never contribute to the distinct count', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', null), scanRow('B1', null)],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toEqual([]);
  });

  test('B5: distinct counts are tracked independently per barcode', async () => {
    mockSb({
      scans: [
        scanRow('QUALIFIES', 'u1'), scanRow('QUALIFIES', 'u2'), scanRow('QUALIFIES', 'u3'),
        scanRow('TOO_FEW', 'u1'), scanRow('TOO_FEW', 'u2'),
      ],
      scanCache: [cacheRow({ barcode: 'QUALIFIES' })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const barcodes = res.body.candidates.map(c => c.barcode);
    expect(barcodes).toEqual(['QUALIFIES']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. swap_products exclusion
// ════════════════════════════════════════════════════════════════════════════

describe('C. swap_products exclusion', () => {
  test('C1: a barcode already present in swap_products is excluded even if it clears the threshold', async () => {
    mockSb({
      scans: [scanRow('ALREADY_A_SWAP', 'u1'), scanRow('ALREADY_A_SWAP', 'u2'), scanRow('ALREADY_A_SWAP', 'u3')],
      swapProducts: [{ barcode: 'ALREADY_A_SWAP' }],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toEqual([]);
  });

  test('C2: swap_products rows with a null barcode do not accidentally exclude anything', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      swapProducts: [{ barcode: null }, { barcode: null }],
      scanCache: [cacheRow({ barcode: 'B1' })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. swap_candidate_reviews exclusion
// ════════════════════════════════════════════════════════════════════════════

describe('D. swap_candidate_reviews exclusion', () => {
  test('D1: a barcode already reviewed with decision "approved" is excluded (never resurfaces)', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      reviews: [{ barcode: 'B1', decision: 'approved' }],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toEqual([]);
  });

  test('D2: a barcode already reviewed with decision "rejected" is excluded (never resurfaces)', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      reviews: [{ barcode: 'B1', decision: 'rejected' }],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. Multi-level scan_cache join
// ════════════════════════════════════════════════════════════════════════════

describe('E. Multi-level scan_cache join', () => {
  test('E1: a candidate with both L1 and L2 scan_cache rows shows both in `levels`', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [
        cacheRow({ barcode: 'B1', user_level: 1, verdict: 'yellow' }),
        cacheRow({ barcode: 'B1', user_level: 2, verdict: 'green' }),
      ],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const candidate = res.body.candidates[0];
    expect(candidate.levels[1].verdict).toBe('yellow');
    expect(candidate.levels[2].verdict).toBe('green');
  });

  test('E2: a candidate with only an L2 scan_cache row shows only levels[2], not a fabricated levels[1]', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [cacheRow({ barcode: 'B1', user_level: 2 })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const candidate = res.body.candidates[0];
    expect(candidate.levels[2]).toBeDefined();
    expect(candidate.levels[1]).toBeUndefined();
  });

  test('E3: product_name/category/subcategory are attached from the scan_cache join', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [cacheRow({
        barcode: 'B1', user_level: 2,
        product_name: 'Primal Kitchen Ranch Dressing',
        product_category: 'condiments',
        product_subcategory: null,
      })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const candidate = res.body.candidates[0];
    expect(candidate.productName).toBe('Primal Kitchen Ranch Dressing');
    expect(candidate.productCategory).toBe('condiments');
    expect(candidate.productSubcategory).toBeNull();
  });

  test('E4: a candidate barcode with NO scan_cache row at all still appears, with product info null and an empty levels object', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const candidate = res.body.candidates[0];
    expect(candidate.productName).toBeNull();
    expect(candidate.levels).toEqual({});
  });

  test('E5: explanation is passed through per level, not stripped', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [cacheRow({ barcode: 'B1', user_level: 2, explanation: { summary: 'A clean pick.', details: {} } })],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.candidates[0].levels[2].explanation).toEqual({ summary: 'A clean pick.', details: {} });
  });

  test('E6: promptVersion is passed through per level (Phase 3b — needed for the admin UI\'s verification-status banner)', async () => {
    mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      scanCache: [
        cacheRow({ barcode: 'B1', user_level: 1, prompt_version: 40 }),
        cacheRow({ barcode: 'B1', user_level: 2, prompt_version: 42 }),
      ],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    const candidate = res.body.candidates[0];
    expect(candidate.levels[1].promptVersion).toBe(40);
    expect(candidate.levels[2].promptVersion).toBe(42);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. Response shape / early-return edge cases
// ════════════════════════════════════════════════════════════════════════════

describe('F. Response shape / early-return edge cases', () => {
  test('F1: zero candidates after the threshold filter → { candidates: [] }, and swap_products/reviews/scan_cache are never queried', async () => {
    const { fromSpy } = mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2')], // only 2, under threshold
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ candidates: [] });
    const queriedTables = fromSpy.mock.calls.map(call => call[0]);
    expect(queriedTables).toEqual(['scans']);
  });

  test('F2: zero candidates remain after exclusion filtering → scan_cache is never queried', async () => {
    const { fromSpy } = mockSb({
      scans: [scanRow('B1', 'u1'), scanRow('B1', 'u2'), scanRow('B1', 'u3')],
      swapProducts: [{ barcode: 'B1' }],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body).toEqual({ candidates: [] });
    const queriedTables = fromSpy.mock.calls.map(call => call[0]);
    expect(queriedTables).not.toContain('scan_cache');
  });

  test('F3: zero green scans at all → { candidates: [] }', async () => {
    mockSb({ scans: [] });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body).toEqual({ candidates: [] });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. Error handling
// ════════════════════════════════════════════════════════════════════════════

describe('G. Error handling', () => {
  test('G1: scans query error → 500', async () => {
    mockSb({ scansError: { message: 'connection refused' } });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/scans query failed/);
  });

  test('G2: Supabase client unavailable → 500, distinct from the 401 auth failure', async () => {
    getSupabaseServer.mockReturnValue(null);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
  });
});
