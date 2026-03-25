'use client';
import { getStageFromScore, STAGES } from '@/lib/onboardingData';

export default function RevealScreen({ score, onNext }) {
  const stage = getStageFromScore(score);
  const stageIndex = STAGES.findIndex(s => s.stage === stage.stage);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', padding: '40px 24px 32px' }}>
      {/* Stage label */}
      <span style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-light)',
        textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8,
      }}>
        Your Food Journey Stage
      </span>
      <h1 style={{
        fontFamily: 'var(--font-playfair), Georgia, serif',
        fontSize: 30, fontWeight: 700, color: 'var(--text-dark)', lineHeight: 1.2, marginBottom: 6,
      }}>
        {stage.name}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 28 }}>
        Your score: <strong style={{ color: 'var(--amber)' }}>{score}</strong> out of 49
      </p>

      {/* Continuum graphic */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ position: 'relative', padding: '0 8px' }}>
          {/* Line */}
          <div style={{
            position: 'absolute',
            top: 12, left: 8, right: 8,
            height: 2,
            background: 'var(--cream-dark)',
          }} />
          {/* Dots */}
          <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
            {STAGES.map((s, i) => {
              const isActive = i === stageIndex;
              return (
                <div key={s.stage} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: isActive ? 'var(--amber)' : 'white',
                    border: isActive ? '3px solid var(--amber)' : '2px solid var(--cream-dark)',
                    boxShadow: isActive ? '0 0 0 4px rgba(212,135,42,0.2)' : 'none',
                    transition: 'all 0.3s',
                  }} />
                  <span style={{
                    fontSize: 9, fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--amber)' : 'var(--text-light)',
                    textAlign: 'center', maxWidth: 55, lineHeight: 1.2,
                  }}>
                    {s.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stage message */}
      <div style={{
        background: 'var(--cream-dark)', borderRadius: 16, padding: '20px',
        marginBottom: 'auto',
      }}>
        <p style={{
          fontSize: 15, color: 'var(--text-mid)', lineHeight: 1.65,
          fontStyle: 'italic',
        }}>
          "{stage.message}"
        </p>
        <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-light)' }}>
          — Sina & Joel
        </p>
      </div>

      <div style={{ height: 24 }} />

      {/* CTA */}
      <button
        onClick={onNext}
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
        }}
      >
        Personalize a little more →
      </button>
    </div>
  );
}
