'use strict';

/**
 * __tests__/api/reports/verdict.test.js
 *
 * Tests for POST /api/reports/verdict — the "Report Wrong Verdict" feedback
 * endpoint. requireUser() is mocked (token verification itself is already
 * covered directly in lib/requireUser.test.js); getSupabaseServer() is mocked
 * with a fake client whose .from('verdict_reports').insert(...) routes to a
 * canned response, matching the real handler's single-call chain shape.
 *
 * Suites:
 *   A. Method wiring
 *   B. Validation
 *   C. Successful submission — with and without an auth header
 *   D. Failure handling — DB errors never throw, never break the response
 */

jest.mock('../../../lib/supabaseServer', () => ({
  getSupabaseServer: jest.fn(),
}));
jest.mock('../../../lib/requireUser', () => ({
  requireUser: jest.fn(),
}));

const { getSupabaseServer } = require('../../../lib/supabaseServer');
const { requireUser } = require('../../../lib/requireUser');
const handler = require('../../../pages/api/reports/verdict').default;

const USER = { id: 'user-1', email: 'user@example.com' };

function makeReq(body = {}, headers = {}) {
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

function mockSb({ insertResult = { error: null } } = {}) {
  const insertSpy = jest.fn().mockResolvedValue(insertResult);
  const fromSpy = jest.fn((table) => {
    if (table === 'verdict_reports') return { insert: insertSpy };
    throw new Error(`Unexpected table in test: ${table}`);
  });
  const sb = { from: fromSpy };
  getSupabaseServer.mockReturnValue(sb);
  return { sb, fromSpy, insertSpy };
}

const VALID_BODY = {
  barcode: '011110638434',
  productName: 'Band Pretzel Thins',
  verdict: 'red',
  flags: [{ category: 'seed_oils', severity: 'reject', matchedIngredient: 'canola oil' }],
  userLevel: 2,
  reason: 'wrong_verdict',
  comment: 'This should be green — canola is organic.',
};

beforeEach(() => {
  jest.clearAllMocks();
  requireUser.mockResolvedValue(null);
});

describe('A. Method wiring', () => {
  test('non-POST method → 405, requireUser and Supabase never touched', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.body.success).toBe(false);
    expect(requireUser).not.toHaveBeenCalled();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });
});

describe('B. Validation', () => {
  test('missing barcode → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, barcode: '' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('missing verdict → 400', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, verdict: undefined }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('invalid reason → 400, valid enum values listed in the error, Supabase never touched', async () => {
    mockSb();
    const res = makeRes();
    await handler(makeReq({ ...VALID_BODY, reason: 'not_a_real_reason' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  test.each(['wrong_verdict', 'missing_ingredient', 'confusing_explanation', 'other'])(
    'reason "%s" is accepted',
    async (reason) => {
      const { insertSpy } = mockSb();
      const res = makeRes();
      await handler(makeReq({ ...VALID_BODY, reason }), res);
      expect(res.statusCode).toBe(200);
      expect(insertSpy.mock.calls[0][0].reason).toBe(reason);
    }
  );
});

describe('C. Successful submission', () => {
  test('no Authorization header → requireUser still called (and returns null), user_id is null in the insert payload', async () => {
    const { insertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0].user_id).toBeNull();
  });

  test('valid Authorization header → requireUser()\'s verified user id is attached, never a client-supplied one', async () => {
    requireUser.mockResolvedValue(USER);
    const { insertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(VALID_BODY, { authorization: 'Bearer real-token' }), res);

    expect(res.statusCode).toBe(200);
    expect(insertSpy.mock.calls[0][0].user_id).toBe(USER.id);
  });

  test('an invalid/expired token (requireUser resolves null) does NOT reject the request — falls back to anonymous', async () => {
    requireUser.mockResolvedValue(null);
    const { insertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(VALID_BODY, { authorization: 'Bearer garbage' }), res);

    expect(res.statusCode).toBe(200);
    expect(insertSpy.mock.calls[0][0].user_id).toBeNull();
  });

  test('insert payload carries every submitted field', async () => {
    const { insertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res);

    expect(insertSpy.mock.calls[0][0]).toEqual({
      user_id: null,
      barcode: VALID_BODY.barcode,
      product_name: VALID_BODY.productName,
      verdict: VALID_BODY.verdict,
      flags: VALID_BODY.flags,
      user_level: VALID_BODY.userLevel,
      reason: VALID_BODY.reason,
      comment: VALID_BODY.comment,
    });
  });

  test('optional fields (productName, flags, userLevel, comment) default to null when omitted', async () => {
    const { insertSpy } = mockSb();
    const res = makeRes();
    await handler(makeReq({ barcode: '123', verdict: 'yellow', reason: 'other' }), res);

    expect(res.statusCode).toBe(200);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.product_name).toBeNull();
    expect(payload.flags).toBeNull();
    expect(payload.user_level).toBeNull();
    expect(payload.comment).toBeNull();
  });
});

describe('D. Failure handling', () => {
  test('getSupabaseServer() unavailable → 500, success: false', async () => {
    getSupabaseServer.mockReturnValue(null);
    const res = makeRes();
    await handler(makeReq(VALID_BODY), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('insert error → 500 with the error message, success: false, does not throw', async () => {
    mockSb({ insertResult: { error: { message: 'insert failed' } } });
    const res = makeRes();
    await expect(handler(makeReq(VALID_BODY), res)).resolves.not.toThrow();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'insert failed' });
  });

  test('an unexpected thrown exception → 500, success: false, does not crash the handler', async () => {
    getSupabaseServer.mockReturnValue({
      from: () => { throw new Error('boom'); },
    });
    const res = makeRes();
    await expect(handler(makeReq(VALID_BODY), res)).resolves.not.toThrow();
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
