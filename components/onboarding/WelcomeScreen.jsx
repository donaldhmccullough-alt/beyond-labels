'use client';

export default function WelcomeScreen({ onBegin, onSkip }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--cream)',
      display: 'flex',
      flexDirection: 'column',
      padding: '0',
    }}>
      {/* Logo bar */}
      <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Amber leaf SVG */}
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 4C10 4 5 8 5 14C5 18 8 21 12 22C12 22 11 18 13 15C15 12 19 11 23 12C23 8 19 4 14 4Z" fill="#D4872A"/>
          <path d="M12 22C14 22 16 21 17 19C15 20 13 19 12 17C11 15 12 13 13 12C11 13 9 16 9 19C9 20 10 22 12 22Z" fill="#F0A83C"/>
          <line x1="13" y1="22" x2="13" y2="26" stroke="#D4872A" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 17, fontWeight: 700, color: 'var(--text-dark)' }}>
          Beyond Labels
        </span>
      </div>

      {/* Inner content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 24px 32px' }}>
        {/* Hero art block */}
        <div style={{
          marginTop: 20,
          height: 180,
          background: 'linear-gradient(135deg, #3A5A40 0%, #2D4A33 60%, #1E3226 100%)',
          borderRadius: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(circle at 80% 20%, rgba(212,135,42,0.18) 0%, transparent 50%)',
          }} />
          <span style={{ fontSize: 52, zIndex: 1 }}>🌱</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: '2.5px', textTransform: 'uppercase', zIndex: 1 }}>
            Know What's Really In Your Food
          </span>
        </div>

        {/* Host pills */}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <span style={{
            background: '#EAF2EB', border: '1px solid rgba(58,90,64,0.2)',
            borderRadius: 20, padding: '6px 12px',
            fontSize: 13, fontWeight: 600, color: 'var(--forest)'
          }}>Sina McCullough, PhD</span>
          <span style={{
            background: '#EAF2EB', border: '1px solid rgba(58,90,64,0.2)',
            borderRadius: 20, padding: '6px 12px',
            fontSize: 13, fontWeight: 600, color: 'var(--forest)'
          }}>Joel Salatin</span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontFamily: 'var(--font-playfair), Georgia, serif',
          fontSize: 27, fontWeight: 700,
          color: 'var(--text-dark)', lineHeight: 1.2,
          marginTop: 18,
        }}>
          Where are you on your food journey?
        </h1>

        {/* Subtext */}
        <p style={{ fontSize: 15, color: 'var(--text-mid)', lineHeight: 1.55, marginTop: 10 }}>
          Take 2 minutes to personalize your experience.
        </p>

        {/* Spacer */}
        <div style={{ flex: 1, minHeight: 20 }} />

        {/* CTA */}
        <button
          onClick={onBegin}
          style={{
            width: '100%', height: 56,
            background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
            color: 'white',
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            fontSize: 17, fontWeight: 700,
            border: 'none', borderRadius: 16,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 4px 16px rgba(212,135,42,0.35)',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          Let's Begin →
        </button>

        {/* Skip link */}
        <button
          onClick={onSkip}
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-light)', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', padding: '14px 0 0',
            textAlign: 'center', width: '100%',
            minHeight: 44,
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
