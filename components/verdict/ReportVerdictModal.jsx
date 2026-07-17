'use client';
import { useState } from 'react';
import { getSession } from '@/lib/auth';
import { markScanReported } from '@/lib/verdictReports';

const REASONS = [
  { value: 'wrong_verdict', label: 'The verdict seems wrong' },
  { value: 'missing_ingredient', label: 'An ingredient is missing or mislabeled' },
  { value: 'confusing_explanation', label: 'The explanation was confusing' },
  { value: 'other', label: 'Something else' },
];

// No sign-in is required to submit a report — this modal never blocks on a
// missing user. getSession() is best-effort: when a session exists, its
// access token is sent so the server can attach a user_id; when it doesn't
// (or lib/supabase.js's client is null), the report is still submitted,
// just anonymously.
export default function ReportVerdictModal({ scanResult, userLevel, onClose }) {
  const [reason, setReason] = useState(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!reason) return;
    setLoading(true);
    try {
      const session = await getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/reports/verdict', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          barcode: scanResult?.barcode,
          productName: scanResult?.productName,
          verdict: scanResult?.verdict,
          flags: scanResult?.flags,
          userLevel,
          reason,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Something went wrong. Please try again.');
        return;
      }
      if (scanResult?.barcode) markScanReported(scanResult.barcode);
      setSuccess(true);
      setTimeout(() => onClose?.(), 1500);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, background: 'var(--cream-dark)', borderRadius: 2, margin: '16px auto 0', flexShrink: 0 }} />

        {/* Heading */}
        <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
          <p style={{
            fontFamily: 'var(--font-playfair), Georgia, serif',
            fontSize: 22, fontWeight: 700, color: 'var(--text-dark)',
          }}>
            Report an Issue
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {success ? (
            <p style={{ fontSize: 14, color: 'var(--forest)', fontWeight: 600, textAlign: 'center', padding: '20px 0' }}>
              ✓ Thanks — we'll look into it.
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                {REASONS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      background: reason === r.value ? 'var(--cream-dark)' : 'transparent',
                      border: '1.5px solid ' + (reason === r.value ? 'var(--amber)' : 'var(--cream-dark)'),
                      borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                      cursor: 'pointer', minHeight: 44, textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: '2px solid ' + (reason === r.value ? 'var(--amber)' : 'var(--text-light)'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {reason === r.value && (
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber)' }} />
                      )}
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--text-dark)', fontWeight: reason === r.value ? 600 : 500 }}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <textarea
                  placeholder="Anything else you want us to know? (optional)"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%', border: '1.5px solid var(--cream-dark)', borderRadius: 10,
                    padding: '12px 14px', fontSize: 14, background: 'white', color: 'var(--text-dark)',
                    outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                    fontFamily: 'var(--font-inter), system-ui, sans-serif',
                  }}
                />
              </div>

              {error && (
                <div style={{ background: '#FDEDEC', border: '1px solid #C0392B33', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#C0392B' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!reason || loading}
                style={{
                  width: '100%', height: 52,
                  background: (!reason || loading)
                    ? '#D1C9BC'
                    : 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
                  color: (!reason || loading) ? '#9A8260' : 'white',
                  fontFamily: 'var(--font-inter), system-ui, sans-serif',
                  fontSize: 16, fontWeight: 700,
                  border: 'none', borderRadius: 14,
                  cursor: (!reason || loading) ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  boxShadow: (!reason || loading) ? 'none' : '0 4px 16px rgba(212,135,42,0.35)',
                }}
              >
                {loading ? 'Submitting...' : 'Submit Report'}
              </button>

              <button
                type="button"
                onClick={onClose}
                style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', minHeight: 44, textDecoration: 'underline' }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
