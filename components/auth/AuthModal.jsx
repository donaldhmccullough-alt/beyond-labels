'use client';
import { useState } from 'react';
import { signIn, signUp, signInWithGoogle, signInWithApple } from '@/lib/auth';

export default function AuthModal({ onClose, onSuccess, defaultTab = 'signin' }) {
  const [tab, setTab] = useState(defaultTab); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const fn = tab === 'signup' ? signUp : signIn;
      const { data, error: authError } = await fn(email, password);
      if (authError) { setError(authError.message); return; }
      if (tab === 'signup' && data?.user && !data.session) {
        // Email confirmation required
        setSuccessMsg('Check your email to confirm your account, then sign in.');
        return;
      }
      onSuccess?.(data?.user || data?.session?.user);
      onClose?.();
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setLoading(true);
    const { error: authError } = await signInWithGoogle();
    if (authError) { setError(authError.message); setLoading(false); }
    // OAuth redirects — modal will close naturally on return
  }

  async function handleApple() {
    setError('');
    setLoading(true);
    const { error: authError } = await signInWithApple();
    if (authError) { setError(authError.message); setLoading(false); }
  }

  const tabStyle = (t) => ({
    flex: 1, height: 40, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
    borderRadius: 10, transition: 'all 0.15s',
    background: tab === t ? 'var(--amber)' : 'transparent',
    color: tab === t ? 'white' : 'var(--text-light)',
  });

  const inputStyle = {
    width: '100%', height: 48, border: '1.5px solid var(--cream-dark)', borderRadius: 10,
    padding: '0 14px', fontSize: 15, background: 'white', color: 'var(--text-dark)',
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,36,22,0.55)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 0' }}>
      {/* Bottom sheet */}
      <div style={{ background: 'var(--cream)', borderRadius: '24px 24px 0 0', padding: '24px 24px 40px', width: '100%', maxWidth: 430, boxShadow: '0 -8px 40px rgba(0,0,0,0.18)' }}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, background: 'var(--cream-dark)', borderRadius: 2, margin: '0 auto 20px' }} />

        {/* Heading */}
        <h2 style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 22, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 6, textAlign: 'center' }}>
          {tab === 'signup' ? 'Create your account' : 'Welcome back'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-light)', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
          Save your history, sync across devices, and access your stage anywhere.
        </p>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--cream-dark)', borderRadius: 12, padding: 4, marginBottom: 20 }}>
          <button style={tabStyle('signin')} onClick={() => { setTab('signin'); setError(''); setSuccessMsg(''); }}>Sign In</button>
          <button style={tabStyle('signup')} onClick={() => { setTab('signup'); setError(''); setSuccessMsg(''); }}>Create Account</button>
        </div>

        {/* Social buttons */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{ width: '100%', height: 48, background: 'white', border: '1.5px solid var(--cream-dark)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600, color: 'var(--text-dark)', marginBottom: 10, opacity: loading ? 0.6 : 1 }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>

        <button
          onClick={handleApple}
          disabled={loading}
          style={{ width: '100%', height: 48, background: '#000', border: 'none', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', fontSize: 15, fontWeight: 600, color: 'white', marginBottom: 18, opacity: loading ? 0.6 : 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 814 1000" fill="white"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 490 29.5 383.9 33.4 279.4c1.3-26 8.9-51.4 22.4-74.9 18.7-32.8 45.2-45.8 76.8-48.7 26.3-2.3 49.7 16.5 70.6 25.2 19.3 8 44.3 27.8 52.7 60.3L139 259.5z"/></svg>
          Continue with Apple
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-light)', fontWeight: 600 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
        </div>

        {/* Email / password form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="email"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <div style={{ background: '#FDEDEC', border: '1px solid #C0392B33', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#C0392B' }}>
              {error}
            </div>
          )}
          {successMsg && (
            <div style={{ background: '#EAFAF1', border: '1px solid #27AE6033', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#1E8449' }}>
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s' }}
          >
            {loading ? 'Please wait...' : tab === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Cancel */}
        <button
          onClick={onClose}
          style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', minHeight: 44, textDecoration: 'underline' }}
        >
          Continue without signing in
        </button>

        <p style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'var(--text-light)', lineHeight: 1.5 }}>
          By signing in you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
