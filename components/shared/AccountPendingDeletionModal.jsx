'use client';
import { useState } from 'react';

// Extracted for direct testing — same no-rendering-infra reasoning as
// DeleteAccountModal.jsx/isDeleteReady. Kept deliberately simple: just
// formats an ISO timestamp as a human-readable date, with a defensive
// fallback for a missing/invalid value rather than rendering "Invalid Date".
export function formatScheduledDate(scheduledFor) {
  if (!scheduledFor) return '';
  const d = new Date(scheduledFor);
  if (isNaN(d.getTime())) return '';
  // Explicit 'en-US' + timeZone: 'UTC' — deterministic in tests and, more
  // importantly, correct in production regardless of the viewer's local
  // timezone. scheduled_for is stored as midnight UTC; without pinning the
  // display to UTC too, toLocaleDateString() would render the date
  // component of *the viewer's local time*, showing the wrong (previous)
  // calendar day for anyone west of UTC — confirmed directly: this exact
  // bug caused this function's own test to fail when it ran without this
  // option. The real deadline enforced by the cron sweep is unaffected
  // either way (it compares full timestamps, not display strings) — this
  // is a display-only correctness fix.
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Full-screen, blocking interstitial — same fixed-overlay-with-solid-backdrop
// treatment as DisclaimerModal.jsx (no dismiss-without-action affordance;
// per the approved plan, a single "Restore my account" button only, no
// separate decline/sign-out option). Shown from app/page.jsx's
// onAuthStateChange SIGNED_IN handler when GET /api/account/deletion-status
// reports a pending deletion for the account that just signed in.
export default function AccountPendingDeletionModal({ scheduledFor, accessToken, onRestored }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRestore() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/account/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        return;
      }
      onRestored?.();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const formattedDate = formatScheduledDate(scheduledFor);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--cream)',
        borderRadius: '24px 24px 0 0',
        width: '100%',
        maxWidth: 430,
        maxHeight: '88dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Heading */}
        <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
          <p style={{
            fontFamily: 'var(--font-playfair), Georgia, serif',
            fontSize: 22, fontWeight: 700, color: 'var(--text-dark)',
          }}>
            Account Scheduled for Deletion
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-mid)' }}>
            Your account is scheduled for deletion on{' '}
            {formattedDate ? <strong>{formattedDate}</strong> : 'the requested date'} — want to keep it?
          </p>

          {error && (
            <div style={{ background: '#FDEDEC', border: '1px solid #C0392B33', borderRadius: 8, padding: '10px 14px', marginTop: 16, fontSize: 13, color: '#C0392B' }}>
              {error}
            </div>
          )}
        </div>

        {/* CTA */}
        <div style={{ padding: '16px 24px 36px', flexShrink: 0 }}>
          <button
            onClick={handleRestore}
            disabled={loading}
            style={{
              width: '100%', height: 56,
              background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
              color: 'white',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: 17, fontWeight: 700,
              border: 'none', borderRadius: 16,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 4px 16px rgba(212,135,42,0.35)',
            }}
          >
            {loading ? 'Restoring…' : 'Restore my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
