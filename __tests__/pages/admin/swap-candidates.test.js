'use strict';

/**
 * __tests__/pages/admin/swap-candidates.test.js
 *
 * Direct unit tests of the pure functions exported from
 * pages/admin/swap-candidates.jsx — this project has no React rendering
 * test infrastructure (jest.config.js sets testEnvironment: 'node', no
 * @testing-library/react; same situation as SwapsScreen.jsx/SwapsScreen.test.js
 * in Phase 1/2), so the actual <CandidateCard>/<SwapCandidatesAdminPage>
 * components are never rendered here — only the extracted logic
 * (verification-status determination, form validation, payload shaping,
 * initial-form-state derivation) is tested directly.
 *
 * lib/auth.js is mocked because importing the real module constructs a
 * real Supabase client at module-load time (lib/supabase.js's
 * `export const supabase = makeClient();`) using whatever
 * NEXT_PUBLIC_SUPABASE_URL/ANON_KEY next/jest's env loading picks up from
 * .env.local — harmless on its own (no network call fires from
 * construction alone) but unnecessary and avoidable for tests that only
 * touch this page's pure functions, none of which call getSession() or
 * anything else from lib/auth.
 *
 * Suites:
 *   A. getVerificationStatus() — all 4 states
 *   B. validatePurchaseLinks()
 *   C. validateApprovalForm()
 *   D. isApproveEnabled()
 *   E. buildApprovePayload()
 *   F. buildRejectPayload()
 *   G. buildInitialFormState()
 */

jest.mock('../../../lib/auth', () => ({
  getSession: jest.fn(),
}));

const {
  CACHE_STATUS,
  getVerificationStatus,
  VALID_CERTIFICATIONS,
  validatePurchaseLinks,
  validateApprovalForm,
  isApproveEnabled,
  buildApprovePayload,
  buildRejectPayload,
  buildInitialFormState,
} = require('../../../pages/admin/swap-candidates');

const CURRENT_PROMPT_VERSION = 43;

function makeCandidate(overrides = {}) {
  return {
    barcode: '000000000001',
    distinctScanCount: 5,
    productName: 'Test Product',
    productCategory: 'condiments',
    productSubcategory: null,
    levels: {
      2: { verdict: 'green', explanation: { summary: 'Clean product.', details: {} }, promptVersion: CURRENT_PROMPT_VERSION },
    },
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A. getVerificationStatus() — all 4 states
// ════════════════════════════════════════════════════════════════════════════

describe('A. getVerificationStatus()', () => {
  test('A1: CONFIRMED — a present level at the current prompt version, verdict green', () => {
    const candidate = makeCandidate({
      levels: { 2: { verdict: 'green', explanation: null, promptVersion: CURRENT_PROMPT_VERSION } },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.CONFIRMED);
  });

  test('A2: CONFIRMED — both L1 and L2 present, current prompt version, both green', () => {
    const candidate = makeCandidate({
      levels: {
        1: { verdict: 'green', explanation: null, promptVersion: CURRENT_PROMPT_VERSION },
        2: { verdict: 'green', explanation: null, promptVersion: CURRENT_PROMPT_VERSION },
      },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.CONFIRMED);
  });

  test('A3: NO_CACHE — zero levels present', () => {
    const candidate = makeCandidate({ levels: {} });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.NO_CACHE);
  });

  test('A4: NO_CACHE — levels is missing entirely from the candidate object', () => {
    const candidate = makeCandidate();
    delete candidate.levels;
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.NO_CACHE);
  });

  test('A5: STALE_PROMPT_VERSION — the only present level is behind the current prompt version', () => {
    const candidate = makeCandidate({
      levels: { 2: { verdict: 'green', explanation: null, promptVersion: 40 } },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.STALE_PROMPT_VERSION);
  });

  test('A6: STALE_PROMPT_VERSION — L2 is current but L1 is stale (any stale level triggers it)', () => {
    const candidate = makeCandidate({
      levels: {
        1: { verdict: 'green', explanation: null, promptVersion: 40 },
        2: { verdict: 'green', explanation: null, promptVersion: CURRENT_PROMPT_VERSION },
      },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.STALE_PROMPT_VERSION);
  });

  test('A7: NOT_GREEN — current prompt version, but verdict has drifted to yellow', () => {
    const candidate = makeCandidate({
      levels: { 2: { verdict: 'yellow', explanation: null, promptVersion: CURRENT_PROMPT_VERSION } },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.NOT_GREEN);
  });

  test('A8: NOT_GREEN — current prompt version, verdict drifted to red', () => {
    const candidate = makeCandidate({
      levels: { 1: { verdict: 'red', explanation: null, promptVersion: CURRENT_PROMPT_VERSION } },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.NOT_GREEN);
  });

  test('A9: staleness takes priority over not-green — a stale AND non-green level reports STALE, not NOT_GREEN', () => {
    const candidate = makeCandidate({
      levels: { 2: { verdict: 'red', explanation: null, promptVersion: 40 } },
    });
    expect(getVerificationStatus(candidate, CURRENT_PROMPT_VERSION)).toBe(CACHE_STATUS.STALE_PROMPT_VERSION);
  });

  test('A10: defaults currentPromptVersion to the real PROMPT_VERSION constant when omitted', () => {
    const candidate = makeCandidate({
      levels: { 2: { verdict: 'green', explanation: null, promptVersion: CURRENT_PROMPT_VERSION } },
    });
    expect(getVerificationStatus(candidate)).toBe(CACHE_STATUS.CONFIRMED);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. validatePurchaseLinks()
// ════════════════════════════════════════════════════════════════════════════

describe('B. validatePurchaseLinks()', () => {
  test('B1: a fully blank row is silently ignored, not an error', () => {
    expect(validatePurchaseLinks([{ retailer: '', affiliateUrl: '' }])).toEqual([]);
  });

  test('B2: a complete row is valid', () => {
    expect(validatePurchaseLinks([{ retailer: 'Whole Foods', affiliateUrl: 'https://example.com' }])).toEqual([]);
  });

  test('B3: retailer filled, URL blank → one error', () => {
    const errors = validatePurchaseLinks([{ retailer: 'Whole Foods', affiliateUrl: '' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/missing an affiliate URL/);
  });

  test('B4: URL filled, retailer blank → one error', () => {
    const errors = validatePurchaseLinks([{ retailer: '', affiliateUrl: 'https://example.com' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/missing a retailer name/);
  });

  test('B5: empty array → no errors', () => {
    expect(validatePurchaseLinks([])).toEqual([]);
  });

  test('B6: undefined → no errors, does not throw', () => {
    expect(validatePurchaseLinks(undefined)).toEqual([]);
  });

  test('B7: multiple rows report one error per invalid row, indexed 1-based', () => {
    const errors = validatePurchaseLinks([
      { retailer: 'Good', affiliateUrl: 'https://good.com' },
      { retailer: 'Bad', affiliateUrl: '' },
      { retailer: '', affiliateUrl: '' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('#2');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. validateApprovalForm()
// ════════════════════════════════════════════════════════════════════════════

function validForm(overrides = {}) {
  return {
    productName: 'Test Product',
    brand: 'Test Brand',
    category: 'condiments',
    subcategory: '',
    whyItPasses: 'No synthetic additives.',
    usdaOrganic: true,
    nonGmoVerified: false,
    swapLevel: 2,
    purchaseLinks: [],
    ...overrides,
  };
}

describe('C. validateApprovalForm()', () => {
  test('C1: a fully valid form passes with zero errors', () => {
    expect(validateApprovalForm(validForm())).toEqual({ valid: true, errors: [] });
  });

  test('C2: missing product name is invalid', () => {
    const { valid, errors } = validateApprovalForm(validForm({ productName: '' }));
    expect(valid).toBe(false);
    expect(errors).toContain('Product name is required.');
  });

  test('C3: whitespace-only product name is invalid', () => {
    const { valid } = validateApprovalForm(validForm({ productName: '   ' }));
    expect(valid).toBe(false);
  });

  test('C4: missing category is invalid', () => {
    const { errors } = validateApprovalForm(validForm({ category: '' }));
    expect(errors).toContain('Category is required.');
  });

  test('C5: swapLevel other than 1 or 2 is invalid', () => {
    const { errors } = validateApprovalForm(validForm({ swapLevel: 3 }));
    expect(errors).toContain('Swap level must be 1 or 2.');
  });

  test('C6: missing "why it passes" is invalid', () => {
    const { errors } = validateApprovalForm(validForm({ whyItPasses: '' }));
    expect(errors).toContain('"Why it passes" cannot be empty.');
  });

  test('C7: an invalid purchase link row surfaces its own error alongside form errors', () => {
    const { valid, errors } = validateApprovalForm(validForm({
      purchaseLinks: [{ retailer: 'Whole Foods', affiliateUrl: '' }],
    }));
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('affiliate URL'))).toBe(true);
  });

  test('C8: multiple missing fields all get reported, not just the first', () => {
    const { errors } = validateApprovalForm(validForm({ productName: '', category: '', whyItPasses: '' }));
    expect(errors).toHaveLength(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. isApproveEnabled()
// ════════════════════════════════════════════════════════════════════════════

describe('D. isApproveEnabled()', () => {
  test('D1: valid form + CONFIRMED status → enabled regardless of the checkbox', () => {
    expect(isApproveEnabled(validForm(), CACHE_STATUS.CONFIRMED, false)).toBe(true);
  });

  test('D2: valid form + unconfirmed status + checkbox NOT checked → disabled', () => {
    expect(isApproveEnabled(validForm(), CACHE_STATUS.STALE_PROMPT_VERSION, false)).toBe(false);
  });

  test('D3: valid form + unconfirmed status + checkbox checked → enabled', () => {
    expect(isApproveEnabled(validForm(), CACHE_STATUS.STALE_PROMPT_VERSION, true)).toBe(true);
  });

  test('D4: invalid form + CONFIRMED status → still disabled (form validity always required)', () => {
    expect(isApproveEnabled(validForm({ productName: '' }), CACHE_STATUS.CONFIRMED, false)).toBe(false);
  });

  test('D5: invalid form + unconfirmed status + checkbox checked → still disabled', () => {
    expect(isApproveEnabled(validForm({ category: '' }), CACHE_STATUS.NO_CACHE, true)).toBe(false);
  });

  test('D6: NOT_GREEN and NO_CACHE both require the checkbox exactly like STALE_PROMPT_VERSION does', () => {
    expect(isApproveEnabled(validForm(), CACHE_STATUS.NOT_GREEN, false)).toBe(false);
    expect(isApproveEnabled(validForm(), CACHE_STATUS.NOT_GREEN, true)).toBe(true);
    expect(isApproveEnabled(validForm(), CACHE_STATUS.NO_CACHE, false)).toBe(false);
    expect(isApproveEnabled(validForm(), CACHE_STATUS.NO_CACHE, true)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. buildApprovePayload()
// ════════════════════════════════════════════════════════════════════════════

describe('E. buildApprovePayload()', () => {
  test('E1: shapes a complete, correct payload from a valid form', () => {
    const payload = buildApprovePayload('000000000001', validForm({
      whyItPasses: 'No synthetic additives.\nNo seed oils.',
      usdaOrganic: true,
      nonGmoVerified: true,
      purchaseLinks: [{ retailer: 'Whole Foods', affiliateUrl: 'https://wf.example.com' }],
    }), CACHE_STATUS.CONFIRMED);

    expect(payload).toEqual({
      barcode: '000000000001',
      decision: 'approved',
      product_name: 'Test Product',
      brand: 'Test Brand',
      category: 'condiments',
      subcategory: null,
      why_it_passes: ['No synthetic additives.', 'No seed oils.'],
      certifications: ['usda-organic', 'non-gmo-project-verified'],
      purchase_links: [{ retailer: 'Whole Foods', affiliate_url: 'https://wf.example.com' }],
      swap_level: 2,
      confirmedCurrent: true,
    });
  });

  test('E2: confirmedCurrent is false when status is not CONFIRMED', () => {
    const payload = buildApprovePayload('000000000001', validForm(), CACHE_STATUS.STALE_PROMPT_VERSION);
    expect(payload.confirmedCurrent).toBe(false);
  });

  test('E3: an incomplete purchase-link row is dropped from the payload, not sent partially', () => {
    const payload = buildApprovePayload('000000000001', validForm({
      purchaseLinks: [
        { retailer: 'Whole Foods', affiliateUrl: 'https://wf.example.com' },
        { retailer: 'Incomplete', affiliateUrl: '' },
      ],
    }), CACHE_STATUS.CONFIRMED);
    expect(payload.purchase_links).toEqual([{ retailer: 'Whole Foods', affiliate_url: 'https://wf.example.com' }]);
  });

  test('E4: empty brand/subcategory become null, not empty strings', () => {
    const payload = buildApprovePayload('000000000001', validForm({ brand: '  ', subcategory: '  ' }), CACHE_STATUS.CONFIRMED);
    expect(payload.brand).toBeNull();
    expect(payload.subcategory).toBeNull();
  });

  test('E5: neither certification checked → empty certifications array, not omitted', () => {
    const payload = buildApprovePayload('000000000001', validForm({ usdaOrganic: false, nonGmoVerified: false }), CACHE_STATUS.CONFIRMED);
    expect(payload.certifications).toEqual([]);
  });

  test('E6: certification values match VALID_CERTIFICATIONS exactly', () => {
    const payload = buildApprovePayload('000000000001', validForm({ usdaOrganic: true, nonGmoVerified: true }), CACHE_STATUS.CONFIRMED);
    for (const cert of payload.certifications) {
      expect(VALID_CERTIFICATIONS).toContain(cert);
    }
  });

  test('E7: whyItPasses blank lines are filtered out, not preserved as empty strings', () => {
    const payload = buildApprovePayload('000000000001', validForm({ whyItPasses: 'Reason one.\n\n\nReason two.\n' }), CACHE_STATUS.CONFIRMED);
    expect(payload.why_it_passes).toEqual(['Reason one.', 'Reason two.']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. buildRejectPayload()
// ════════════════════════════════════════════════════════════════════════════

describe('F. buildRejectPayload()', () => {
  test('F1: with a reason', () => {
    expect(buildRejectPayload('000000000001', 'Not a good fit for the catalog.')).toEqual({
      barcode: '000000000001',
      decision: 'rejected',
      reason: 'Not a good fit for the catalog.',
    });
  });

  test('F2: no reason (undefined) → reason is null, not undefined or empty string', () => {
    expect(buildRejectPayload('000000000001', undefined)).toEqual({
      barcode: '000000000001',
      decision: 'rejected',
      reason: null,
    });
  });

  test('F3: whitespace-only reason → null', () => {
    expect(buildRejectPayload('000000000001', '   ')).toEqual({
      barcode: '000000000001',
      decision: 'rejected',
      reason: null,
    });
  });

  test('F4: reason is trimmed', () => {
    expect(buildRejectPayload('000000000001', '  Too niche.  ').reason).toBe('Too niche.');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. buildInitialFormState()
// ════════════════════════════════════════════════════════════════════════════

describe('G. buildInitialFormState()', () => {
  test('G1: pre-fills productName/category/subcategory from the candidate', () => {
    const candidate = makeCandidate({ productName: 'Ranch Dressing', productCategory: 'condiments', productSubcategory: null });
    const form = buildInitialFormState(candidate);
    expect(form.productName).toBe('Ranch Dressing');
    expect(form.category).toBe('condiments');
    expect(form.subcategory).toBe('');
  });

  test('G2: prefers Level 2\'s explanation summary when both levels exist', () => {
    const candidate = makeCandidate({
      levels: {
        1: { verdict: 'yellow', explanation: { summary: 'L1 summary.', details: {} }, promptVersion: CURRENT_PROMPT_VERSION },
        2: { verdict: 'green', explanation: { summary: 'L2 summary.', details: {} }, promptVersion: CURRENT_PROMPT_VERSION },
      },
    });
    expect(buildInitialFormState(candidate).whyItPasses).toBe('L2 summary.');
  });

  test('G3: falls back to Level 1\'s explanation when only Level 1 exists', () => {
    const candidate = makeCandidate({
      levels: { 1: { verdict: 'green', explanation: { summary: 'L1 only.', details: {} }, promptVersion: CURRENT_PROMPT_VERSION } },
    });
    expect(buildInitialFormState(candidate).whyItPasses).toBe('L1 only.');
  });

  test('G4: no levels at all → whyItPasses defaults to an empty string, not undefined', () => {
    const candidate = makeCandidate({ levels: {} });
    expect(buildInitialFormState(candidate).whyItPasses).toBe('');
  });

  test('G5: brand always starts empty — there is no cached brand data to pre-fill from', () => {
    expect(buildInitialFormState(makeCandidate()).brand).toBe('');
  });

  test('G6: starts with exactly one blank purchase-link row', () => {
    const form = buildInitialFormState(makeCandidate());
    expect(form.purchaseLinks).toEqual([{ retailer: '', affiliateUrl: '' }]);
  });

  test('G7: defaults swapLevel to 2', () => {
    expect(buildInitialFormState(makeCandidate()).swapLevel).toBe(2);
  });

  test('G8: both certification checkboxes default to false', () => {
    const form = buildInitialFormState(makeCandidate());
    expect(form.usdaOrganic).toBe(false);
    expect(form.nonGmoVerified).toBe(false);
  });
});
