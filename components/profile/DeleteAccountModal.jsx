'use client';
import { useState } from 'react';
import { signIn, signOut } from '@/lib/auth';

const DELETE_CONFIRMATION_TEXT = 'DELETE';

// Extracted for direct testing — this project has no React rendering test
// infrastructure (testEnvironment: 'node', no @testing-library/react), same
// reasoning as ConcernCard.jsx/getFallbackSummary and
// SwapsScreen.jsx/FLAG_CATEGORY_MAP.
export function isDeleteReady(password, confirmText) {
  return Boolean(password) && confirmText === DELETE_CONFIRMATION_TEXT;
}

// Unlike ChangePasswordModal, this needs to be hard to trigger by accident —
// both a re-entered password AND a typed "DELETE" confirmation are required
// before the submit button is even enabled, not just before the action
// actually runs.
export default function DeleteAccountModal({ user, onClose, onSignOut }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const ready = isDeleteReady(password, confirmText);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!ready) return;
    setLoading(true);
    try {
      const { data, error: verifyError } = await signIn(user.email, password);
      if (verifyError) {
        setError('Current password is incorrect.');
        return;
      }
      const token = data?.session?.access_token;
      if (!token) {
        setError('Something went wrong. Please try again.');
        return;
      }
      const res = await fetch('/api/account/request-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        return;
      }
      // Deletion is now scheduled server-side — sign out unconditionally
      // from here, mirroring ProfileScreen.jsx's own handleSignOut():
      // signOut()'s local-fallback path (a network failure during the
      // sign-out call itself) never fires Supabase's SIGNED_OUT event, so
      // tell the parent directly rather than relying solely on the async
      // onAuthStateChange listener.
      await signOut();
      onSignOut?.();
      onClose?.();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%', height: 48, border: '1.5px solid var(--cream-dark)', borderRadius: 10,
    padding: '0 14px', fontSize: 15, background: 'white', color: 'var(--text-dark)',
    outline: 'none', boxSizing: 'border-box',
  };

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
            fontSize: 22, fontWeight: 700, color: '#C0392B',
          }}>
            Delete Account
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-mid)', marginBottom: 16 }}>
            Your account will be scheduled for deletion in 14 days. You can restore it any time before
            then by signing back in. After 14 days, your account is permanently deleted and cannot be
            recovered.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <input
                type="password"
                placeholder="Current password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
                autoComplete="current-password"
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder={`Type "${DELETE_CONFIRMATION_TEXT}" to confirm`}
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                style={inputStyle}
                autoComplete="off"
              />
            </div>

            {error && (
              <div style={{ background: '#FDEDEC', border: '1px solid #C0392B33', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#C0392B' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!ready || loading}
              style={{
                width: '100%', height: 52,
                background: '#C0392B',
                color: 'white',
                fontFamily: 'var(--font-inter), system-ui, sans-serif',
                fontSize: 16, fontWeight: 700,
                border: 'none', borderRadius: 14,
                cursor: (!ready || loading) ? 'default' : 'pointer',
                opacity: (!ready || loading) ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? 'Deleting...' : 'Delete My Account'}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', minHeight: 44, textDecoration: 'underline' }}
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
