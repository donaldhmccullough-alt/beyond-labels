import { useState, useEffect, useCallback } from 'react';
import { getSession } from '../../lib/auth';
import { PROMPT_VERSION } from '../../lib/cacheVersion';

// Defensive guard: an auth check that depends on an external SDK call
// (getSession() -> supabase.auth.getSession()) should never be allowed to
// hang the page forever if that call stalls for any reason outside this
// codebase's control (network conditions, the SDK's own session-restore
// initialization, etc.). A stall past SESSION_CHECK_TIMEOUT_MS is treated
// the same as "no session" — redirect home — rather than trusting the call
// to eventually resolve.
const SESSION_CHECK_TIMEOUT_MS = 8000;

function getSessionWithTimeout() {
  return Promise.race([
    getSession(),
    new Promise(resolve => setTimeout(() => resolve(null), SESSION_CHECK_TIMEOUT_MS)),
  ]);
}

/**
 * pages/admin/swap-candidates.jsx — Beyond Labels admin swap-candidate review screen
 *
 * Phase 3b of the swaps system overhaul (July 2026) — builds the actual
 * review UI on top of Phase 3a's schema/auth/discovery-endpoint foundation.
 * Direct-URL-only: there is no nav link to this page anywhere in the
 * regular app UI, by design (see CLAUDE.md "Swaps System").
 *
 * Not tested by rendering — this project has no React rendering test
 * infrastructure (jest.config.js sets testEnvironment: 'node', no
 * @testing-library/react; see the same note on SwapsScreen.jsx). Every
 * piece of non-trivial logic (verification-status determination, form
 * validation, payload shaping, initial-form-state derivation) is pulled out
 * into pure, exported, module-scope functions instead, so it's directly
 * unit-testable — see __tests__/pages/admin/swap-candidates.test.js.
 */

// ── Verification status ─────────────────────────────────────────────────────

export const CACHE_STATUS = {
  CONFIRMED: 'confirmed',                   // >=1 level present, ALL present levels are at the
                                             // current PROMPT_VERSION and currently green
  NO_CACHE: 'no_cache',                     // zero scan_cache levels present at all
  STALE_PROMPT_VERSION: 'stale_prompt_version', // >=1 present level is behind the current PROMPT_VERSION
  NOT_GREEN: 'not_green',                   // every present level is current, but >=1 isn't green
};

/**
 * Determines the ONE overall verification banner state for a candidate,
 * from whatever GET /api/admin/swap-candidates already returned — no
 * additional network call. Checked in priority order: no data at all, then
 * staleness (can't trust ANY of the data if even one level is behind, since
 * a stale row's own verdict/explanation predates the current rules), then
 * whether every (now-confirmed-fresh) level is actually green.
 *
 * "Historically went green" (the scans-table-driven candidate qualification
 * from Phase 3a) and "currently green in scan_cache" are different claims —
 * this function only ever evaluates the latter, since scan_cache is the
 * only source with per-level data at all (the `scans` table has no
 * user_level column — see the Phase 3a endpoint's own comment).
 */
export function getVerificationStatus(candidate, currentPromptVersion = PROMPT_VERSION) {
  const levelEntries = Object.values(candidate?.levels || {});
  if (levelEntries.length === 0) return CACHE_STATUS.NO_CACHE;

  const isStale = levelEntries.some(l => l.promptVersion !== currentPromptVersion);
  if (isStale) return CACHE_STATUS.STALE_PROMPT_VERSION;

  const notGreen = levelEntries.some(l => l.verdict !== 'green');
  if (notGreen) return CACHE_STATUS.NOT_GREEN;

  return CACHE_STATUS.CONFIRMED;
}

export const VERIFICATION_COPY = {
  [CACHE_STATUS.CONFIRMED]: { label: 'Verified current', tone: 'good' },
  [CACHE_STATUS.NO_CACHE]: { label: 'No current scan_cache row — cannot confirm', tone: 'warn' },
  [CACHE_STATUS.STALE_PROMPT_VERSION]: { label: 'Cached under an old PROMPT_VERSION — cannot confirm current status', tone: 'warn' },
  [CACHE_STATUS.NOT_GREEN]: { label: 'Current verdict is no longer green', tone: 'warn' },
};

// ── Certifications ───────────────────────────────────────────────────────────

// Exact-string discipline matching the rest of the app (see CLAUDE.md
// "Adding new swap products") — modeled as checkboxes in the UI rather than
// free text specifically to make an invalid certification string
// unrepresentable.
export const VALID_CERTIFICATIONS = ['usda-organic', 'non-gmo-project-verified'];

// ── Form state ───────────────────────────────────────────────────────────────

/**
 * Derives the approval form's initial values from a candidate — prefers
 * Level 2's data (the stricter, "gold standard" level) when both exist,
 * matching the same infoRow preference already used server-side in the
 * Phase 3a endpoint.
 */
export function buildInitialFormState(candidate) {
  const preferredLevel = candidate?.levels?.[2] || candidate?.levels?.[1] || null;
  return {
    productName: candidate?.productName || '',
    brand: '',
    category: candidate?.productCategory || '',
    subcategory: candidate?.productSubcategory || '',
    whyItPasses: preferredLevel?.explanation?.summary || '',
    usdaOrganic: false,
    nonGmoVerified: false,
    swapLevel: 2,
    purchaseLinks: [{ retailer: '', affiliateUrl: '' }],
  };
}

/** A row is only validated once the admin has started filling it in — a fully blank row is silently ignored, not an error. */
export function validatePurchaseLinks(purchaseLinks) {
  const errors = [];
  (purchaseLinks || []).forEach((link, i) => {
    const hasRetailer = !!(link.retailer && link.retailer.trim());
    const hasUrl = !!(link.affiliateUrl && link.affiliateUrl.trim());
    if (hasRetailer && !hasUrl) errors.push(`Purchase link #${i + 1} is missing an affiliate URL.`);
    if (hasUrl && !hasRetailer) errors.push(`Purchase link #${i + 1} is missing a retailer name.`);
  });
  return errors;
}

export function validateApprovalForm(formState) {
  const errors = [];
  if (!formState?.productName || !formState.productName.trim()) {
    errors.push('Product name is required.');
  }
  if (!formState?.category || !formState.category.trim()) {
    errors.push('Category is required.');
  }
  if (formState?.swapLevel !== 1 && formState?.swapLevel !== 2) {
    errors.push('Swap level must be 1 or 2.');
  }
  if (!formState?.whyItPasses || !formState.whyItPasses.trim()) {
    errors.push('"Why it passes" cannot be empty.');
  }
  errors.push(...validatePurchaseLinks(formState?.purchaseLinks));
  return { valid: errors.length === 0, errors };
}

/**
 * The Approve button's enabled/disabled state. Unconfirmed verification
 * status requires the admin to have explicitly checked the "I'm approving
 * without current verification" box (confirmedUnverified) in addition to
 * the form itself being valid.
 */
export function isApproveEnabled(formState, status, confirmedUnverified) {
  const { valid } = validateApprovalForm(formState);
  if (!valid) return false;
  if (status === CACHE_STATUS.CONFIRMED) return true;
  return !!confirmedUnverified;
}

// ── Payload shaping ──────────────────────────────────────────────────────────

export function buildApprovePayload(barcode, formState, status) {
  const whyItPasses = (formState.whyItPasses || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const certifications = [
    formState.usdaOrganic ? 'usda-organic' : null,
    formState.nonGmoVerified ? 'non-gmo-project-verified' : null,
  ].filter(Boolean);

  const purchaseLinks = (formState.purchaseLinks || [])
    .filter(l => l.retailer?.trim() && l.affiliateUrl?.trim())
    .map(l => ({ retailer: l.retailer.trim(), affiliate_url: l.affiliateUrl.trim() }));

  return {
    barcode,
    decision: 'approved',
    product_name: formState.productName.trim(),
    brand: formState.brand?.trim() || null,
    category: formState.category.trim(),
    subcategory: formState.subcategory?.trim() || null,
    why_it_passes: whyItPasses,
    certifications,
    purchase_links: purchaseLinks,
    swap_level: formState.swapLevel,
    confirmedCurrent: status === CACHE_STATUS.CONFIRMED,
  };
}

export function buildRejectPayload(barcode, reason) {
  return {
    barcode,
    decision: 'rejected',
    reason: reason && reason.trim() ? reason.trim() : null,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SwapCandidatesAdminPage() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decided, setDecided] = useState({}); // barcode -> 'approved' | 'rejected'

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // getSession() lives inside this same try/catch, not before it — a
        // version of this effect that called getSession() ahead of the try
        // block would let any rejection there become a silent unhandled
        // promise rejection: no redirect, no error state, `loading` stuck
        // at `true` forever. getSessionWithTimeout() (above) additionally
        // guards against getSession() itself never settling.
        const session = await getSessionWithTimeout();
        if (!session?.access_token) {
          // Plain full-page redirect (window.location), not next/router's
          // client-side navigation: this page is under Pages Router, but
          // the redirect target (/) is rendered by App Router, and
          // router.replace() crossing that boundary was observed to stall
          // rather than complete in manual testing. A hard navigation
          // sidesteps that soft-navigation path entirely and is a
          // perfectly reasonable cost for a rare, security-relevant
          // redirect on an admin-only page — this is the right choice on
          // its own merits regardless of the exact mechanism behind that
          // observation.
          window.location.href = '/';
          return;
        }

        const res = await fetch('/api/admin/swap-candidates', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.status === 401) {
          window.location.href = '/';
          return;
        }
        const data = await res.json();
        if (!cancelled) setCandidates(data.candidates || []);
      } catch {
        if (!cancelled) setError('Could not load swap candidates.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleDecided = useCallback((barcode, decision) => {
    setDecided(prev => ({ ...prev, [barcode]: decision }));
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: 'var(--text-dark, #2C2416)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Swap Candidates</h1>
      <p style={{ fontSize: 13, color: 'var(--text-light, #9A8260)', marginBottom: 20 }}>
        Admin only. Products scanned green by 3+ distinct users, not yet a swap or already reviewed.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'var(--red-flag, #C0392B)' }}>{error}</p>}

      {!loading && !error && candidates.length === 0 && (
        <p style={{ color: 'var(--text-light, #9A8260)' }}>No candidates right now.</p>
      )}

      {candidates.map(candidate => (
        <CandidateCard
          key={candidate.barcode}
          candidate={candidate}
          decided={decided[candidate.barcode]}
          onDecided={decision => handleDecided(candidate.barcode, decision)}
        />
      ))}
    </div>
  );
}

function CandidateCard({ candidate, decided, onDecided }) {
  const status = getVerificationStatus(candidate);
  const copy = VERIFICATION_COPY[status];

  const [form, setForm] = useState(() => buildInitialFormState(candidate));
  const [confirmedUnverified, setConfirmedUnverified] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  async function postReview(payload) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const session = await getSession();
      const res = await fetch('/api/admin/swap-candidates/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      onDecided(payload.decision);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function updatePurchaseLink(index, key, value) {
    setForm(prev => {
      const links = [...prev.purchaseLinks];
      links[index] = { ...links[index], [key]: value };
      return { ...prev, purchaseLinks: links };
    });
  }

  function addPurchaseLink() {
    setForm(prev => ({ ...prev, purchaseLinks: [...prev.purchaseLinks, { retailer: '', affiliateUrl: '' }] }));
  }

  function removePurchaseLink(index) {
    setForm(prev => ({ ...prev, purchaseLinks: prev.purchaseLinks.filter((_, i) => i !== index) }));
  }

  if (decided) {
    return (
      <div style={{ margin: '0 0 16px', padding: 16, borderRadius: 12, border: '1.5px solid var(--cream-dark, #F2EBD9)', background: 'white' }}>
        <strong>{candidate.productName || candidate.barcode}</strong> — {decided}.
      </div>
    );
  }

  const { valid: formValid, errors: formErrors } = validateApprovalForm(form);
  const approveEnabled = isApproveEnabled(form, status, confirmedUnverified) && !submitting;

  return (
    <div style={{ margin: '0 0 20px', padding: 16, borderRadius: 12, border: '1.5px solid var(--cream-dark, #F2EBD9)', background: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{candidate.productName || '(no cached product name)'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-light, #9A8260)' }}>Barcode: {candidate.barcode} · {candidate.distinctScanCount} distinct scanners</div>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        {[1, 2].map(level => candidate.levels?.[level] && (
          <span key={level} style={{ display: 'inline-block', marginRight: 8, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: 'var(--cream-dark, #F2EBD9)' }}>
            L{level}: {candidate.levels[level].verdict}
          </span>
        ))}
      </div>

      <div
        style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600,
          background: copy.tone === 'good' ? '#EAFAF1' : '#FEF9E7',
          color: copy.tone === 'good' ? '#27AE60' : '#B8860B',
        }}
      >
        {copy.label}
      </div>

      <label style={fieldLabelStyle}>Brand</label>
      <input style={inputStyle} value={form.brand} onChange={e => updateField('brand', e.target.value)} placeholder="No cached brand data — enter manually" />

      <label style={fieldLabelStyle}>Product name</label>
      <input style={inputStyle} value={form.productName} onChange={e => updateField('productName', e.target.value)} />

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={fieldLabelStyle}>Category</label>
          <input style={inputStyle} value={form.category} onChange={e => updateField('category', e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabelStyle}>Subcategory</label>
          <input style={inputStyle} value={form.subcategory} onChange={e => updateField('subcategory', e.target.value)} />
        </div>
      </div>

      <label style={fieldLabelStyle}>Why it passes (one reason per line)</label>
      <textarea style={{ ...inputStyle, minHeight: 80 }} value={form.whyItPasses} onChange={e => updateField('whyItPasses', e.target.value)} />

      <label style={fieldLabelStyle}>Certifications</label>
      <div style={{ marginBottom: 8 }}>
        <label style={{ marginRight: 16, fontSize: 13 }}>
          <input type="checkbox" checked={form.usdaOrganic} onChange={e => updateField('usdaOrganic', e.target.checked)} /> USDA Organic
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={form.nonGmoVerified} onChange={e => updateField('nonGmoVerified', e.target.checked)} /> Non-GMO Verified
        </label>
      </div>

      <label style={fieldLabelStyle}>Swap level</label>
      <select style={inputStyle} value={form.swapLevel} onChange={e => updateField('swapLevel', Number(e.target.value))}>
        <option value={1}>1 — Good</option>
        <option value={2}>2 — Better</option>
      </select>

      <label style={fieldLabelStyle}>Purchase links</label>
      {form.purchaseLinks.map((link, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder="Retailer" value={link.retailer} onChange={e => updatePurchaseLink(i, 'retailer', e.target.value)} />
          <input style={{ ...inputStyle, flex: 2 }} placeholder="Affiliate URL" value={link.affiliateUrl} onChange={e => updatePurchaseLink(i, 'affiliateUrl', e.target.value)} />
          <button type="button" onClick={() => removePurchaseLink(i)} style={smallButtonStyle}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={addPurchaseLink} style={{ ...smallButtonStyle, marginBottom: 12 }}>+ Add link</button>

      {status !== CACHE_STATUS.CONFIRMED && (
        <label style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={confirmedUnverified} onChange={e => setConfirmedUnverified(e.target.checked)} />
          {' '}I'm approving without current verification
        </label>
      )}

      {!formValid && formErrors.length > 0 && (
        <ul style={{ color: 'var(--red-flag, #C0392B)', fontSize: 12, marginBottom: 8 }}>
          {formErrors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {submitError && <p style={{ color: 'var(--red-flag, #C0392B)', fontSize: 12 }}>{submitError}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={!approveEnabled}
          onClick={() => postReview(buildApprovePayload(candidate.barcode, form, status))}
          style={{ ...primaryButtonStyle, opacity: approveEnabled ? 1 : 0.5, cursor: approveEnabled ? 'pointer' : 'not-allowed' }}
        >
          Approve
        </button>
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Rejection reason (optional)"
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
        />
        <button
          type="button"
          disabled={submitting}
          onClick={() => postReview(buildRejectPayload(candidate.barcode, rejectReason))}
          style={secondaryButtonStyle}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

const fieldLabelStyle = { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-light, #9A8260)', margin: '10px 0 4px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--cream-dark, #F2EBD9)', fontSize: 14 };
const smallButtonStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--cream-dark, #F2EBD9)', background: 'white', cursor: 'pointer', fontSize: 12 };
const primaryButtonStyle = { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--amber, #D4872A)', color: 'white', fontWeight: 700, fontSize: 14 };
const secondaryButtonStyle = { padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--red-flag, #C0392B)', background: 'white', color: 'var(--red-flag, #C0392B)', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
