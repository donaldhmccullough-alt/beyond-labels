'use client';
import { getProfile } from '@/lib/userProfile';
import { getStageFromScore } from '@/lib/onboardingData';

const STAGE_WATCH_ITEMS = {
  1: [
    'Seed oils — canola, soybean, vegetable oil',
    'High-fructose corn syrup & artificial sweeteners',
    'Artificial dyes and preservatives',
  ],
  2: [
    'Hidden GMO ingredients in packaged foods',
    'Seed oils lurking in "healthy" products',
    'Misleading "natural" label claims',
  ],
  3: [
    'Non-organic conventional crop derivatives',
    'Bioengineering disclosures on packaging',
    'Seed oil infiltration in whole-food brands',
  ],
  4: [
    'Certification claims vs. verified certifications',
    'Supply-chain transparency of local brands',
    'Regenerative vs. conventional sourcing',
  ],
  5: [
    'Emerging seed-oil alternatives',
    'Regenerative certification programs',
    'Community food-sharing legalities',
  ],
};

export default function LaunchScreen({ score, onLaunch }) {
  const stage = getStageFromScore(score);
  const watchItems = STAGE_WATCH_ITEMS[stage.stage] || STAGE_WATCH_ITEMS[1];
  const profile = typeof window !== 'undefined' ? getProfile() : null;
  const flags = profile?.flags || [];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', padding: '40px 24px 32px' }}>
      {/* Leaf icon */}
      <div style={{
        width: 60, height: 60, borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--forest), var(--forest-light))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: 20,
      }}>
        🌿
      </div>

      <h1 style={{
        fontFamily: 'var(--font-playfair), Georgia, serif',
        fontSize: 26, fontWeight: 700, color: 'var(--text-dark)', lineHeight: 1.25, marginBottom: 6,
      }}>
        You're all set as a
      </h1>
      <h2 style={{
        fontFamily: 'var(--font-playfair), Georgia, serif',
        fontSize: 22, fontWeight: 700, color: 'var(--amber)', lineHeight: 1.25, marginBottom: 28,
      }}>
        {stage.name}
      </h2>

      {/* Watch items */}
      <div style={{
        background: 'var(--cream-dark)', borderRadius: 16, padding: '16px 18px', marginBottom: 16,
      }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
          We'll watch for
        </p>
        {watchItems.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < watchItems.length - 1 ? 10 : 0 }}>
            <span style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }}>✓</span>
            <span style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.4 }}>{item}</span>
          </div>
        ))}
      </div>

      {/* Personal flags */}
      {flags.length > 0 && (
        <div style={{
          background: 'var(--blue-flag-bg)', borderRadius: 16, padding: '14px 16px', marginBottom: 16,
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-flag-text)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
            We'll also always flag
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {flags.map(flag => (
              <span key={flag} style={{
                background: 'white', borderRadius: 20, padding: '4px 10px',
                fontSize: 12, fontWeight: 600, color: 'var(--blue-flag-text)',
                border: '1px solid rgba(12,68,124,0.2)',
              }}>
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Launch CTA */}
      <button
        onClick={onLaunch}
        style={{
          width: '100%', height: 60,
          background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
          color: 'white',
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          fontSize: 18, fontWeight: 700,
          border: 'none', borderRadius: 16,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(212,135,42,0.4)',
        }}
      >
        Scan My First Product →
      </button>
    </div>
  );
}
