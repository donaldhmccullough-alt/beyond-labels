'use client';
import { useState } from 'react';
import { signIn, updatePassword } from '@/lib/auth';

// Supabase's updateUser({ password }) works off the already-active signed-in
// session — it doesn't itself require re-entering the current password. We
// verify it here anyway (via a signIn() call, the same mechanism the sign-in
// form already uses) as a UX/security safeguard against changing the password
// from an already-unlocked device without knowing it.
export default function ChangePasswordModal({ user, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: verifyError } = await signIn(user.email, currentPassword);
      if (verifyError) {
        setError('Current password is incorrect.');
        return;
      }
      const { error: updateError } = await updatePassword(newPassword);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setSuccess(true);
      setTimeout(() => onClose?.(), 1500);
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
            fontSize: 22, fontWeight: 700, color: 'var(--text-dark)',
          }}>
            Change Password
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {success ? (
            <p style={{ fontSize: 14, color: 'var(--forest)', fontWeight: 600, textAlign: 'center', padding: '20px 0' }}>
              ✓ Password updated successfully.
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <input
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="current-password"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <input
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div style={{ background: '#FDEDEC', border: '1px solid #C0392B33', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#C0392B' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', height: 52,
                  background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
                  color: 'white',
                  fontFamily: 'var(--font-inter), system-ui, sans-serif',
                  fontSize: 16, fontWeight: 700,
                  border: 'none', borderRadius: 14,
                  cursor: 'pointer',
                  opacity: loading ? 0.7 : 1,
                  boxShadow: '0 4px 16px rgba(212,135,42,0.35)',
                }}
              >
                {loading ? 'Updating...' : 'Update Password'}
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
