'use strict';

/**
 * __tests__/api/admin/swap-candidates/review.test.js
 *
 * Tests for POST /api/admin/swap-candidates/review (Phase 3b of the swaps
 * overhaul — the action half of the admin review workflow).
 *
 * requireAdmin() is mocked so most tests focus on the endpoint's own
 * insert/validation logic — token verification itself is already covered
 * directly in lib/requireAdmin.test.js. getSupabaseServer() is mocked with a
 * fake client whose .from(table) routes to canned responses per table,
 * matching the real handler's exact chain shape for each table it touches.
 *
 * Suites:
 *   A. Admin auth wiring
 *   B. Input validation
 *   C. Reject flow
 *   D. Approve flow
 *   E. Partial-failure handling (compensating delete)
 */

jest.mock('../../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../../lib/requireAdmin', () => ({
  requireAdmin: jest.fn(),
}));

const { getSupabaseServer } = require('../../../../lib/supabaseServer');
const { requireAdmin } = require('../../../../lib/requireAdmin');
const handler = require('../../../../pages/api/admin/swap-candidates/review').default;

const ADMIN_USER = { id: 'admin-1', email: 'admin@beyondlabels.example' };

function makeReq(body, headers = { authorization: 'Bearer admin-token' }) {
  return { method: 'POST', headers, body };
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

function mockSb({
  swapInsertResult = { data: { id: 'swap-1' }, error: null },
  reviewInsertResult = { error: null },
  deleteResult = { error: null },
} = {}) {
  const singleSpy = jest.fn().mockResolvedValue(swapInsertResult);
  const selectSpy = jest.fn(() => ({ single: singleSpy }));
  const swapInsertSpy = jest.fn(() => ({ select: selectSpy }));
  const deleteEqSpy = jest.fn().mockResolvedValue(deleteResult);
  const swapDeleteSpy = jest.fn(() => ({ eq: deleteEqSpy }));
  const reviewInsertSpy = jest.fn().mockResolvedValue(reviewInsertResult);

  const fromSpy = jest.fn((table) => {
    if (table === 'swap_products') return { insert: swapInsertSpy, delete: swapDeleteSpy };
    if (table === 'swap_candidate_reviews') return { insert: reviewInsertSpy };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, swapInsertSpy, reviewInsertSpy, swapDeleteSpy, deleteEqSpy };
}

function validApprovePayload(overrides = {}) {
  return {
    barcode: '000000000001',
    decision: 'approved',
    product_name: 'Test Product',
    brand: 'Test Brand',
    category: 'condiments',
    subcategory: null,
    why_it_passes: ['No synthetic additives.'],
    certifications: ['usda-organic'],
    purchase_links: [{ retailer: 'Whole Foods', affiliate_url: 'https://wf.example.com' }],
    swap_level: 2,
    confirmedCurrent: true,
    ...overrides,
  };
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
    const { fromSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  test('A2: non-POST method → 405 before requireAdmin is consulted', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, body: {} }, res);

    expect(res.statusCode).toBe(405);
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  test('A3: valid admin → request proceeds past the auth gate', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Input validation
// ════════════════════════════════════════════════════════════════════════════

describe('B. Input validation', () => {
  test('B1: missing barcode → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq({ decision: 'rejected' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/barcode/);
  });

  test('B2: invalid decision value → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq({ barcode: 'B1', decision: 'maybe' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/decision/);
  });

  test('B3: approved with missing product_name → 400, no writes attempted', async () => {
    const { fromSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ product_name: '' })), res);

    expect(res.statusCode).toBe(400);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  test('B4: approved with missing category → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ category: '' })), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  test('B5: approved with an invalid swap_level → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ swap_level: 3 })), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/swap_level/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Reject flow
// ════════════════════════════════════════════════════════════════════════════

describe('C. Reject flow', () => {
  test('C1: inserts swap_candidate_reviews with decision "rejected" and the reason as note', async () => {
    const { reviewInsertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq({ barcode: 'B1', decision: 'rejected', reason: 'Too niche for the catalog.' }), res);

    expect(res.statusCode).toBe(200);
    expect(reviewInsertSpy).toHaveBeenCalledWith({
      barcode: 'B1',
      decision: 'rejected',
      note: 'Too niche for the catalog.',
    });
  });

  test('C2: reject with no reason → note is null', async () => {
    const { reviewInsertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq({ barcode: 'B1', decision: 'rejected' }), res);

    expect(reviewInsertSpy).toHaveBeenCalledWith({
      barcode: 'B1',
      decision: 'rejected',
      note: null,
    });
  });

  test('C3: reject never touches swap_products', async () => {
    const { fromSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq({ barcode: 'B1', decision: 'rejected', reason: 'No.' }), res);

    const queriedTables = fromSpy.mock.calls.map(c => c[0]);
    expect(queriedTables).not.toContain('swap_products');
  });

  test('C4: swap_candidate_reviews insert failure on reject → 500', async () => {
    mockSb({ reviewInsertResult: { error: { message: 'insert failed' } } });
    const res = makeRes();
    await handler(makeReq({ barcode: 'B1', decision: 'rejected' }), res);

    expect(res.statusCode).toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Approve flow
// ════════════════════════════════════════════════════════════════════════════

describe('D. Approve flow', () => {
  test('D1: inserts swap_products with source "scan_approved" and the submitted fields', async () => {
    const { swapInsertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(200);
    expect(swapInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      product_name: 'Test Product',
      brand: 'Test Brand',
      category: 'condiments',
      barcode: '000000000001',
      certifications: ['usda-organic'],
      why_it_passes: ['No synthetic additives.'],
      purchase_links: [{ retailer: 'Whole Foods', affiliate_url: 'https://wf.example.com' }],
      swap_level: 2,
      source: 'scan_approved',
    }));
  });

  test('D2: inserts swap_candidate_reviews with decision "approved" and swap_product_id set to the new row\'s id', async () => {
    const { reviewInsertSpy } = mockSb({ swapInsertResult: { data: { id: 'new-swap-id' }, error: null } });
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ confirmedCurrent: true })), res);

    expect(reviewInsertSpy).toHaveBeenCalledWith({
      barcode: '000000000001',
      decision: 'approved',
      swap_product_id: 'new-swap-id',
      note: null,
    });
  });

  test('D3: confirmedCurrent: false → review note is "approved without current scan_cache verification"', async () => {
    const { reviewInsertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ confirmedCurrent: false })), res);

    expect(reviewInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      note: 'approved without current scan_cache verification',
    }));
  });

  test('D4: successful approve returns the new swapProductId in the response', async () => {
    mockSb({ swapInsertResult: { data: { id: 'abc-123' }, error: null } });
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.body).toEqual({ success: true, decision: 'approved', swapProductId: 'abc-123' });
  });

  test('D5: barcode is always taken from the top-level request field, not any nested value', async () => {
    const { swapInsertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload({ barcode: '999999999999' })), res);

    expect(swapInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ barcode: '999999999999' }));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. Partial-failure handling (compensating delete)
// ════════════════════════════════════════════════════════════════════════════

describe('E. Partial-failure handling', () => {
  test('E1: swap_products insert fails → 500, swap_candidate_reviews is never attempted', async () => {
    const { reviewInsertSpy } = mockSb({ swapInsertResult: { data: null, error: { message: 'insert failed' } } });
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(500);
    expect(reviewInsertSpy).not.toHaveBeenCalled();
  });

  test('E2: swap_candidate_reviews insert fails after a successful swap_products insert → the swap_products row is deleted (compensating action), response is 500', async () => {
    const { swapDeleteSpy, deleteEqSpy } = mockSb({
      swapInsertResult: { data: { id: 'orphan-id' }, error: null },
      reviewInsertResult: { error: { message: 'review insert failed' } },
    });
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(500);
    expect(swapDeleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteEqSpy).toHaveBeenCalledWith('id', 'orphan-id');
  });

  test('E3: no orphaned row is left when everything succeeds — delete is never called', async () => {
    const { swapDeleteSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(validApprovePayload()), res);

    expect(res.statusCode).toBe(200);
    expect(swapDeleteSpy).not.toHaveBeenCalled();
  });
});
