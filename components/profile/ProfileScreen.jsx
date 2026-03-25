'use client';
import { useState, useEffect } from 'react';
import { getProfile, getScanUsage, clearProfile } from '@/lib/userProfile';
import { STAGES } from '@/lib/onboardingData';

export default function ProfileScreen({ onRetakeAssessment }) {
  const [profile, setProfile] = useState(null);
  const [scanUsage, setScanUsage] = useState({ scanCount: 0 });
  const FREE_SCAN_LIMIT = 5;

  useEffect(() => {
    setProfile(getProfile());
    setScanUsage(getScanUsage());
  }, []);

  if (!profile) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-light)', fontSize: 15 }}>Loading profile...</p>
      </div>
    );
  }

  const stage = profile.stage || STAGES[0];
  const stageIndex = STAGES.findIndex(s => s.stage === stage.stage);
  const flags = profile.flags || [];
  const scanPercent = Math.min((scanUsage.scanCount / FREE_SCAN_LIMIT) * 100, 100);

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh', paddingBottom: 40 }}>
      <div style={{ padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--text-dark)' }}>My Profile</span>
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>Your Stage</p>
          <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--amber)', marginBottom: 14 }}>{stage.name}</p>
          <div style={{ position: 'relative', padding: '0 6px' }}>
            <div style={{ position: 'absolute', top: 10, left: 6, right: 6, height: 2, background: 'white' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
              {STAGES.map((s, i) => {
                const isActive = i === stageIndex;
                return (
                  <div key={s.stage} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: isActive ? 'var(--amber)' : 'white', border: isActive ? '3px solid var(--amber)' : '2px solid rgba(0,0,0,0.1)', boxShadow: isActive ? '0 0 0 3px rgba(212,135,42,0.2)' : 'none' }} />
                    <span style={{ fontSize: 8, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--amber)' : 'var(--text-light)', textAlign: 'center', maxWidth: 44, lineHeight: 1.2 }}>{s.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {flags.length > 0 && (
          <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px' }}>Personal Flags</p>
              <button onClick={onRetakeAssessment} style={{ background: 'none', border: 'none', color: 'var(--amber)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Edit</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {flags.map(flag => (
                <span key={flag} style={{ background: 'var(--forest)', color: 'white', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600 }}>{flag}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>Scan Usage</p>
          <p style={{ fontSize: 15, color: 'var(--text-dark)', fontWeight: 600, marginBottom: 10 }}>
            {scanUsage.scanCount} of {FREE_SCAN_LIMIT} free scans used this month
          </p>
          <div style={{ height: 6, background: 'white', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: scanPercent + '%', background: scanPercent >= 100 ? '#C0392B' : 'var(--amber)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>

        <button onClick={() => window.location.href = '/subscribe'} style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 14, cursor: 'pointer', marginBottom: 12 }}>
          Upgrade to Pro — $9.99/mo
        </button>

        <button onClick={onRetakeAssessment} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 14, cursor: 'pointer', padding: '12px 0', minHeight: 44, textDecoration: 'underline' }}>
          Retake assessment
        </button>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-light)' }}>
          Beyond Labels v1.0.0 · Session 6
        </p>
      </div>
    </div>
  );
}
