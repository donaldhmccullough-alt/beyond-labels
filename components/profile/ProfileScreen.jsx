'use client';
import { useState, useEffect } from 'react';
import { getProfile, getScanUsage, clearProfile } from '@/lib/userProfile';
import { STAGES } from '@/lib/onboardingData';

const FREE_SCAN_LIMIT = 15; // CHANGE 3 & 6

export default function ProfileScreen({ onRetakeAssessment, onStartOnboarding }) {
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = no profile
  const [scanUsage, setScanUsage] = useState({ scanCount: 0 });

  useEffect(() => {
    setProfile(getProfile()); // may be null if never onboarded
    setScanUsage(getScanUsage());
  }, []);

  // Still loading
  if (profile === undefined) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse-circle" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const stage = profile?.stage || null;
  const stageIndex = stage ? STAGES.findIndex(s => s.stage === stage.stage) : -1;
  const flags = profile?.flags || [];
  const scanPercent = Math.min((scanUsage.scanCount / FREE_SCAN_LIMIT) * 100, 100);
  const scansRemaining = Math.max(FREE_SCAN_LIMIT - scanUsage.scanCount, 0);
  const hasAssessment = !!profile?.onboardingComplete;

  // Stage X → Stage X+1 coaching note
  const nextStage = stage && stageIndex >= 0 && stageIndex < STAGES.length - 1
    ? STAGES[stageIndex + 1]
    : null;

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--text-dark)' }}>
          My Profile
        </span>
      </div>

      <div style={{ padding: '20px 20px 0' }}>

        {/* ── CHANGE 6: Your Journey section ───────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            Your Journey
          </p>

          {hasAssessment && stage ? (
            <>
              {/* Stage name */}
              <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--amber)', marginBottom: 14 }}>
                {stage.name}
              </p>

              {/* Continuum graphic */}
              <div style={{ position: 'relative', padding: '0 6px', marginBottom: 14 }}>
                <div style={{ position: 'absolute', top: 10, left: 6, right: 6, height: 2, background: 'white' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                  {STAGES.map((s, i) => {
                    const isActive = i === stageIndex;
                    return (
                      <div key={s.stage} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: isActive ? 'var(--amber)' : 'white', border: isActive ? '3px solid var(--amber)' : '2px solid rgba(0,0,0,0.1)', boxShadow: isActive ? '0 0 0 3px rgba(212,135,42,0.2)' : 'none' }} />
                        <span style={{ fontSize: 8, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--amber)' : 'var(--text-light)', textAlign: 'center', maxWidth: 44, lineHeight: 1.2 }}>
                          {s.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pro coaching note */}
              {nextStage && (
                <p style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.5, fontStyle: 'italic', borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 10 }}>
                  Pro members get weekly coaching to move from <strong style={{ color: 'var(--text-mid)' }}>{stage.name}</strong> to <strong style={{ color: 'var(--text-mid)' }}>{nextStage.name}</strong>.
                </p>
              )}
            </>
          ) : (
            /* No assessment taken */
            <>
              <p style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.55, marginBottom: 14 }}>
                Take our 2-minute assessment to discover your food journey stage and get results tailored to where you are.
              </p>
              <button
                onClick={onStartOnboarding}
                style={{ width: '100%', height: 46, background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 10, cursor: 'pointer' }}
              >
                Discover My Stage →
              </button>
            </>
          )}
        </div>

        {/* ── Personal Flags ────────────────────────────────────────────── */}
        {flags.length > 0 && (
          <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Personal Flags
              </p>
              <button
                onClick={onRetakeAssessment}
                style={{ background: 'none', border: 'none', color: 'var(--amber)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Edit
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {flags.map(flag => (
                <span key={flag} style={{ background: 'var(--forest)', color: 'white', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600 }}>
                  {flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Scan Usage — CHANGE 6: 15/month ──────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            Scan Usage
          </p>
          <p style={{ fontSize: 15, color: 'var(--text-dark)', fontWeight: 600, marginBottom: 10 }}>
            {scanUsage.scanCount} of {FREE_SCAN_LIMIT} free scans used this month
          </p>
          <div style={{ height: 6, background: 'white', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: scanPercent + '%', background: scanPercent >= 100 ? '#C0392B' : 'var(--amber)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          {scansRemaining <= 3 && scansRemaining > 0 && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#C0392B', fontWeight: 600 }}>
              Only {scansRemaining} free scan{scansRemaining === 1 ? '' : 's'} left this month.
            </p>
          )}
        </div>

        {/* ── Upgrade CTA ───────────────────────────────────────────────── */}
        <button
          onClick={() => window.location.href = '/subscribe'}
          style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 14, cursor: 'pointer', marginBottom: 12 }}
        >
          Upgrade to Pro — $9.99/mo
        </button>

        {/* ── Retake ────────────────────────────────────────────────────── */}
        <button
          onClick={onRetakeAssessment}
          style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 14, cursor: 'pointer', padding: '12px 0', minHeight: 44, textDecoration: 'underline' }}
        >
          {hasAssessment ? 'Retake assessment' : 'Take the assessment'}
        </button>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-light)' }}>
          Beyond Labels v1.0.0 · Session 7
        </p>
      </div>
    </div>
  );
}
