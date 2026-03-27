'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Inner component — useSearchParams must be inside a Suspense boundary
function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('confirming'); // 'confirming' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function handleCallback() {
      // 1. Check for error params from Supabase
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      if (error) {
        setErrorMsg(errorDescription || error);
        setStatus('error');
        return;
      }

      if (!supabase) {
        // No Supabase configured — just redirect home
        setStatus('success');
        setTimeout(() => router.replace('/'), 1500);
        return;
      }

      // 2. PKCE code exchange (OAuth and newer email flows)
      const code = searchParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setErrorMsg(exchangeError.message);
          setStatus('error');
          return;
        }
        setStatus('success');
        setTimeout(() => router.replace('/'), 2000);
        return;
      }

      // 3. Email OTP token_hash flow (most common for email confirmation in Supabase v2)
      const tokenHash = searchParams.get('token_hash');
      const type = searchParams.get('type') || 'signup';
      if (tokenHash) {
        const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (otpError) {
          setErrorMsg(otpError.message);
          setStatus('error');
          return;
        }
        setStatus('success');
        setTimeout(() => router.replace('/'), 2000);
        return;
      }

      // 4. Hash-fragment tokens — supabase-js picks these up automatically via getSession()
      //    (used in older implicit-flow email confirmations)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setStatus('success');
        setTimeout(() => router.replace('/'), 2000);
        return;
      }

      // 5. Nothing usable in the URL
      setErrorMsg('No confirmation token found. The link may have expired — please sign up again.');
      setStatus('error');
    }

    handleCallback();
  }, [searchParams, router]);

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        {/* Logo / brand */}
        <div style={styles.leaf}>🌿</div>
        <div style={styles.brand}>Beyond Labels</div>
        <div style={styles.byline}>by Sina &amp; Joel</div>

        {status === 'confirming' && (
          <>
            <div style={styles.pulseWrap}>
              <div style={styles.pulse} />
            </div>
            <p style={styles.heading}>Confirming your email…</p>
            <p style={styles.sub}>Just a moment</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={styles.checkmark}>✓</div>
            <p style={styles.heading}>Your email is confirmed —<br />welcome to Beyond Labels</p>
            <p style={styles.sub}>Taking you to the app in a moment…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={styles.errorIcon}>!</div>
            <p style={styles.heading}>Something went wrong</p>
            <p style={{ ...styles.sub, color: '#C0392B', marginBottom: 24 }}>{errorMsg}</p>
            <a href="/" style={styles.btn}>← Back to Beyond Labels</a>
          </>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse-amber {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap');
      `}} />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  screen: {
    minHeight: '100dvh',
    background: '#FAF6EF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: 24,
    padding: '40px 32px',
    maxWidth: 380,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 40px rgba(44,36,22,0.1)',
  },
  leaf: { fontSize: 40, marginBottom: 8 },
  brand: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontSize: 26,
    fontWeight: 700,
    color: '#2C2416',
    marginBottom: 4,
  },
  byline: { fontSize: 13, color: '#9A8260', marginBottom: 32 },
  pulseWrap: { display: 'flex', justifyContent: 'center', marginBottom: 24 },
  pulse: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#D4872A',
    animation: 'pulse-amber 2s ease-in-out infinite',
  },
  checkmark: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#3A5A40',
    color: 'white',
    fontSize: 28,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#C0392B',
    color: 'white',
    fontSize: 28,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  heading: {
    fontFamily: '"Playfair Display", Georgia, serif',
    fontSize: 20,
    fontWeight: 700,
    color: '#2C2416',
    lineHeight: 1.35,
    marginBottom: 10,
  },
  sub: { fontSize: 14, color: '#9A8260', lineHeight: 1.6, marginBottom: 8 },
  btn: {
    display: 'inline-block',
    background: '#D4872A',
    color: 'white',
    borderRadius: 12,
    padding: '13px 28px',
    fontWeight: 700,
    fontSize: 15,
    textDecoration: 'none',
  },
};

// ── Page export — wraps inner component in Suspense for useSearchParams ────────
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={styles.screen}>
        <div style={styles.card}>
          <div style={styles.leaf}>🌿</div>
          <div style={styles.brand}>Beyond Labels</div>
          <div style={styles.byline}>by Sina &amp; Joel</div>
          <div style={{ ...styles.pulseWrap, marginTop: 32 }}>
            <div style={styles.pulse} />
          </div>
          <p style={styles.heading}>Confirming your email…</p>
        </div>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
