'use client';
// /app/auth/confirm/page.jsx
// Handles the Supabase "Confirm signup" email link for older-style token flows.
// Supabase sometimes routes through /auth/confirm with a token_hash + type param.
// We immediately forward to /auth/callback which has the full handler.
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ConfirmRedirector() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Forward all query params to the canonical callback handler
    const params = searchParams.toString();
    router.replace(`/auth/callback${params ? '?' + params : ''}`);
  }, [searchParams, router]);

  return null;
}

const screenStyle = {
  minHeight: '100dvh',
  background: '#FAF6EF',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
};
const cardStyle = {
  background: 'white',
  borderRadius: 24,
  padding: '40px 32px',
  maxWidth: 380,
  width: '100%',
  textAlign: 'center',
  boxShadow: '0 8px 40px rgba(44,36,22,0.1)',
};
const pulseStyle = {
  width: 56, height: 56, borderRadius: '50%',
  background: '#D4872A', margin: '0 auto 24px',
  animation: 'pulse-amber 2s ease-in-out infinite',
};

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={null}>
      <div style={screenStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🌿</div>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 26, fontWeight: 700, color: '#2C2416', marginBottom: 4 }}>
            Beyond Labels
          </div>
          <div style={{ fontSize: 13, color: '#9A8260', marginBottom: 32 }}>by Sina &amp; Joel</div>
          <div style={pulseStyle} />
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 18, fontWeight: 700, color: '#2C2416' }}>
            Checking your confirmation…
          </p>
          <p style={{ fontSize: 13, color: '#9A8260', marginTop: 8 }}>Just a moment</p>
        </div>
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes pulse-amber {
            0%, 100% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.2); opacity: 1; }
          }
        `}} />
      </div>
      <ConfirmRedirector />
    </Suspense>
  );
}
