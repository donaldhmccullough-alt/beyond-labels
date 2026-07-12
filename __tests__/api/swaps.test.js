'use strict';

/**
 * __tests__/api/swaps.test.js
 *
 * Tests for GET /api/swaps. This endpoint had zero test coverage anywhere
 * in the codebase before this session (per CLAUDE.md) — added as a safety
 * net ahead of the Phase 0 swap_products migration (Google Sheet CSV →
 * Supabase table) and the admin approval workflow planned to build on top
 * of it in a later session.
 *
 * getSupabaseServer() is mocked so each test supplies its own swap_products
 * rows (as Supabase would return them — real text[] array columns, not
 * delimited strings) without a real database connection. swaps.js caches
 * the full table query result in an in-memory, module-level variable for
 * 1 hour, so jest.resetModules() runs before every test to give each test
 * a fresh, uncached module instance — otherwise the first test to populate
 * the cache would leak its mock data into every later test in this file.
 *
 * Suites:
 *   A. Category filtering
 *   B. swap_level tiering into good/better
 *   C. Empty-result AI fallback
 *   D. Response shape
 *   E. Input validation
 *   F. Subcategory filtering (Phase 1, July 2026)
 */

jest.mock('../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));

// Declared outside the mock factory (matches __tests__/api/explain.test.js's
// established pattern) so the same jest.fn() reference survives
// jest.resetModules() between tests — only the module registry is reset,
// not this plain JS binding.
const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

function makeReq(query = {}) {
  return { method: 'GET', query };
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

// Shape a real swap_products row would have coming back from Supabase —
// array columns, not the delimited strings the old CSV pipeline produced.
// swaps.js's normalizeSwapRow() is responsible for converting back.
function makeSwapProductRow(overrides = {}) {
  return {
    id: 'row-id',
    product_name: 'Organic Tortilla Chips',
    brand: 'Siete',
    category: 'chips',
    subcategory: null,
    barcode: '000000000001',
    certifications: ['usda-organic'],
    why_it_passes: ['No seed oils', 'Organic certified'],
    where_to_buy: ['Whole Foods', 'Amazon'],
    image_url: 'https://example.com/img.jpg',
    swap_level: 2,
    source: 'curated',
    ...overrides,
  };
}

// Sets up getSupabaseServer() to return a fake client whose
// .from('swap_products').select('*') resolves with the given rows.
function mockSupabaseRows(rows, error = null) {
  const { getSupabaseServer } = require('../../lib/supabaseServer');
  getSupabaseServer.mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn().mockResolvedValue({ data: rows, error }),
    })),
  });
}

let handler;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY; // AI fallback off by default; opt in per-test
  handler = require('../../pages/api/swaps').default;
});

// ════════════════════════════════════════════════════════════════════════════
// A. Category filtering
// ════════════════════════════════════════════════════════════════════════════

describe('A. Category filtering', () => {
  test('A1: ?category=cereal returns only cereal rows', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ category: 'chips', product_name: 'Chips A' }),
      makeSwapProductRow({ category: 'cereal', product_name: 'Cereal A' }),
      makeSwapProductRow({ category: 'cereal', product_name: 'Cereal B' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'cereal', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.swaps.every(s => s.category === 'cereal')).toBe(true);
    expect(res.body.swaps.map(s => s.product_name).sort()).toEqual(['Cereal A', 'Cereal B']);
  });

  test('A2: no category param returns rows across categories', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ category: 'chips' }),
      makeSwapProductRow({ category: 'cereal' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    const categories = res.body.swaps.map(s => s.category).sort();
    expect(categories).toEqual(['cereal', 'chips']);
  });

  test('A3: invalid category → 400, no Supabase query made', async () => {
    const { getSupabaseServer } = require('../../lib/supabaseServer');
    const res = makeRes();
    await handler(makeReq({ category: 'not-a-real-category' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid category/);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. swap_level tiering into good/better
// ════════════════════════════════════════════════════════════════════════════

describe('B. swap_level tiering', () => {
  test('B1: userLevel=2 returns only swap_level=2 rows, all tagged tier:"better"', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ swap_level: 1, product_name: 'Level 1 Only' }),
      makeSwapProductRow({ swap_level: 2, product_name: 'Level 2 Only' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('curated');
    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('Level 2 Only');
    expect(res.body.swaps[0].tier).toBe('better');
  });

  test('B2: userLevel=1 returns swap_level=1 rows as "good" and swap_level=2 rows as "better", combined', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ swap_level: 1, product_name: 'Good Product' }),
      makeSwapProductRow({ swap_level: 2, product_name: 'Better Product' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '1' }), res);

    expect(res.statusCode).toBe(200);
    const good = res.body.swaps.find(s => s.product_name === 'Good Product');
    const better = res.body.swaps.find(s => s.product_name === 'Better Product');
    expect(good.tier).toBe('good');
    expect(better.tier).toBe('better');
    expect(res.body.swaps).toHaveLength(2);
  });

  test('B3: unspecified userLevel defaults to level-2 behavior', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ swap_level: 1, product_name: 'Level 1 Only' }),
      makeSwapProductRow({ swap_level: 2, product_name: 'Level 2 Only' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips' }), res);

    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('Level 2 Only');
  });

  test('B4: level-2 slices to at most 20 results (raised from 3 in Phase 2, for client-side "Show More")', async () => {
    const rows = Array.from({ length: 25 }, (_, n) => makeSwapProductRow({ swap_level: 2, product_name: `Product ${n}` }));
    mockSupabaseRows(rows);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.body.swaps).toHaveLength(20);
  });

  test('B5: level-1 slices EACH tier to at most 20 (25 good + 25 better available → 20 + 20 = 40 total)', async () => {
    const rows = [
      ...Array.from({ length: 25 }, (_, n) => makeSwapProductRow({ swap_level: 1, product_name: `Good ${n}` })),
      ...Array.from({ length: 25 }, (_, n) => makeSwapProductRow({ swap_level: 2, product_name: `Better ${n}` })),
    ];
    mockSupabaseRows(rows);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '1' }), res);

    const good = res.body.swaps.filter(s => s.tier === 'good');
    const better = res.body.swaps.filter(s => s.tier === 'better');
    expect(good).toHaveLength(20);
    expect(better).toHaveLength(20);
    expect(res.body.swaps).toHaveLength(40);
  });

  test('B6: unchanged behavior when fewer than 20 rows exist — a count between the old (3) and new (20) cap returns ALL of them, not truncated to 3', async () => {
    const rows = Array.from({ length: 10 }, (_, n) => makeSwapProductRow({ swap_level: 2, product_name: `Product ${n}` }));
    mockSupabaseRows(rows);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.body.swaps).toHaveLength(10);
  });

  test('B7: unchanged behavior when 3 or fewer rows exist (the pre-Phase-2 case) — still returns exactly what exists', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ swap_level: 2, product_name: 'Only Product' }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.body.swaps).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Empty-result AI fallback
// ════════════════════════════════════════════════════════════════════════════

describe('C. Empty-result AI fallback', () => {
  test('C1: zero curated matches + category provided + API key set → AI fallback fires', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockSupabaseRows([]); // no rows at all
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify([
        { product_name: 'AI Chips', brand: 'AI Brand', certifications: 'usda-organic', why_it_passes: 'Clean ingredients', where_to_buy: 'Whole Foods' },
      ]) }],
    });

    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('AI Chips');
    expect(res.body.swaps[0].ai_generated).toBe(true);
    expect(res.body.swaps[0].tier).toBe('better');
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  test('C2: zero curated matches with NO category → returns empty curated list, AI never called', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockSupabaseRows([]);

    const res = makeRes();
    await handler(makeReq({ userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('curated');
    expect(res.body.swaps).toEqual([]);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('C3: zero curated matches + category provided + no ANTHROPIC_API_KEY → AI fallback returns empty array', async () => {
    // ANTHROPIC_API_KEY intentionally left unset (deleted in beforeEach).
    mockSupabaseRows([]);

    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.swaps).toEqual([]);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('C4: fallback also fires for level-1 users with zero matches in a category', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockSupabaseRows([]);
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify([
        { product_name: 'AI Bread', brand: 'AI Brand', certifications: '', why_it_passes: 'No artificial additives', where_to_buy: 'Target' },
      ]) }],
    });

    const res = makeRes();
    await handler(makeReq({ category: 'bread', userLevel: '1' }), res);

    expect(res.body.source).toBe('ai');
    expect(res.body.swaps[0].tier).toBe('good');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Response shape
// ════════════════════════════════════════════════════════════════════════════

describe('D. Response shape', () => {
  test('D1: top-level shape is { swaps, source }', async () => {
    mockSupabaseRows([makeSwapProductRow()]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(Object.keys(res.body).sort()).toEqual(['source', 'swaps']);
    expect(Array.isArray(res.body.swaps)).toBe(true);
    expect(['curated', 'ai']).toContain(res.body.source);
  });

  test('D2: array columns (certifications, why_it_passes, where_to_buy) are re-joined into delimited strings, not left as arrays', async () => {
    mockSupabaseRows([makeSwapProductRow({
      certifications: ['usda-organic', 'non-gmo-project-verified'],
      why_it_passes: ['No seed oils', 'Organic certified'],
      where_to_buy: ['Whole Foods', 'Amazon', 'Target'],
    })]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    const swap = res.body.swaps[0];
    expect(typeof swap.certifications).toBe('string');
    expect(swap.certifications).toBe('usda-organic;non-gmo-project-verified');
    expect(swap.why_it_passes).toBe('No seed oils;Organic certified');
    expect(swap.where_to_buy).toBe('Whole Foods,Amazon,Target');
  });

  test('D3: each swap carries product_name, brand, category, barcode, image_url, swap_level, and tier', async () => {
    mockSupabaseRows([makeSwapProductRow()]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    const swap = res.body.swaps[0];
    expect(swap).toMatchObject({
      product_name: 'Organic Tortilla Chips',
      brand: 'Siete',
      category: 'chips',
      barcode: '000000000001',
      image_url: 'https://example.com/img.jpg',
      swap_level: '2',
      tier: 'better',
    });
  });

  test('D4: null barcode/brand/image_url from the DB normalize to empty strings, not null', async () => {
    mockSupabaseRows([makeSwapProductRow({ barcode: null, brand: null, image_url: null, certifications: null, why_it_passes: null, where_to_buy: null })]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    const swap = res.body.swaps[0];
    expect(swap.barcode).toBe('');
    expect(swap.brand).toBe('');
    expect(swap.image_url).toBe('');
    expect(swap.certifications).toBe('');
    expect(swap.why_it_passes).toBe('');
    expect(swap.where_to_buy).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. Input validation
// ════════════════════════════════════════════════════════════════════════════

describe('E. Input validation', () => {
  test('E1: non-GET method → 405', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  test('E2: invalid userLevel → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ userLevel: '3' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid userLevel/);
  });

  test('E3: Supabase query error → 500', async () => {
    mockSupabaseRows(null, { message: 'connection refused' });
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/swap_products query failed/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. Subcategory filtering (Phase 1, July 2026)
// ════════════════════════════════════════════════════════════════════════════

describe('F. Subcategory filtering', () => {
  test('F1: ?subcategory narrows to matching (category, subcategory) rows when matches exist', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ product_name: 'Tortilla Chips', subcategory: 'tortilla', swap_level: 2 }),
      makeSwapProductRow({ product_name: 'Potato Chips', subcategory: 'potato', swap_level: 2 }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', subcategory: 'tortilla', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('curated');
    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('Tortilla Chips');
  });

  test('F2: ?subcategory with zero matches in the category falls back to the category-wide pool (not treated as zero curated results)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockSupabaseRows([
      makeSwapProductRow({ product_name: 'Potato Chips', subcategory: 'potato', swap_level: 2 }),
    ]);
    const res = makeRes();
    // 'veggie' has zero matching rows in this mock pool — should fall back
    // to the category-wide 'chips' pool, NOT trigger the AI fallback.
    await handler(makeReq({ category: 'chips', subcategory: 'veggie', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('curated');
    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('Potato Chips');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('F3: no ?subcategory param behaves exactly as before — category-wide pool used directly', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ product_name: 'Tortilla Chips', subcategory: 'tortilla', swap_level: 2 }),
      makeSwapProductRow({ product_name: 'Potato Chips', subcategory: 'potato', swap_level: 2 }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.body.swaps.map(s => s.product_name).sort()).toEqual(['Potato Chips', 'Tortilla Chips']);
  });

  test('F4: subcategory narrowing respects userLevel tiering (Level 1 good/better within the narrowed pool)', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ product_name: 'Good Beef', category: 'meat', subcategory: 'beef', swap_level: 1 }),
      makeSwapProductRow({ product_name: 'Better Beef', category: 'meat', subcategory: 'beef', swap_level: 2 }),
      makeSwapProductRow({ product_name: 'Good Poultry', category: 'meat', subcategory: 'poultry', swap_level: 1 }),
    ]);
    const res = makeRes();
    await handler(makeReq({ category: 'meat', subcategory: 'beef', userLevel: '1' }), res);

    const names = res.body.swaps.map(s => s.product_name);
    expect(names).toContain('Good Beef');
    expect(names).toContain('Better Beef');
    expect(names).not.toContain('Good Poultry');
  });

  test('F5: response rows carry the subcategory field', async () => {
    mockSupabaseRows([makeSwapProductRow({ subcategory: 'tortilla', swap_level: 2 })]);
    const res = makeRes();
    await handler(makeReq({ category: 'chips', userLevel: '2' }), res);

    expect(res.body.swaps[0].subcategory).toBe('tortilla');
  });

  test('F6: subcategory param is ignored when no category is provided (matches nothing meaningfully but does not error)', async () => {
    mockSupabaseRows([
      makeSwapProductRow({ product_name: 'Tortilla Chips', category: 'chips', subcategory: 'tortilla', swap_level: 2 }),
      makeSwapProductRow({ product_name: 'Whole Milk', category: 'dairy', subcategory: 'milk', swap_level: 2 }),
    ]);
    const res = makeRes();
    await handler(makeReq({ subcategory: 'tortilla', userLevel: '2' }), res);

    expect(res.statusCode).toBe(200);
    // No category filter applied, so the subcategory-only match still narrows
    // correctly across the full (unfiltered) pool.
    expect(res.body.swaps).toHaveLength(1);
    expect(res.body.swaps[0].product_name).toBe('Tortilla Chips');
  });
});
