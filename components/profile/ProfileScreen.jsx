'use client';
// ─────────────────────────────────────────────────────────────────────────────
// MVP_MODE: set to false to restore Pro upgrade CTA and Pro coaching mentions
// ─────────────────────────────────────────────────────────────────────────────
const MVP_MODE = true;

import { useState, useEffect, useRef } from 'react';
import { getProfile, getScanUsage, clearProfile } from '@/lib/userProfile';
import { signOut, getSupabaseScanCountThisMonth, getSupabaseScanHistory } from '@/lib/auth';
import { STAGES } from '@/lib/onboardingData';
import { supabase } from '@/lib/supabase';
import { getUserLevel } from '@/lib/userLevel';
import { PROMPT_VERSION } from '@/lib/cacheVersion';
import { formatTime, createHistoryTapHandler } from '@/lib/scanHistory';
import DisclaimerModal from '@/components/shared/DisclaimerModal';
import PrivacyPromiseModal from '@/components/shared/PrivacyPromiseModal';

const FREE_SCAN_LIMIT = 15;

export default function ProfileScreen({ user, userLevel = 1, onLevelChange, onRetakeAssessment, onStartOnboarding, onSignIn, onSignOut, onViewVerdict }) {
  const [profile, setProfile] = useState(undefined);
  const [scanUsage, setScanUsage] = useState({ scanCount: 0 });
  const [scanHistory, setScanHistory] = useState([]);
  const [signingOut, setSigningOut] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showPrivacyPromise, setShowPrivacyPromise] = useState(false);
  // Scan history tap state
  // tapInFlightRef is the authoritative guard — a ref is synchronous and survives
  // unmount/remount without React 18 concurrent mode timing issues.
  // loadingBarcode state is kept only for the visual indicator (opacity / "…").
  const tapInFlightRef = useRef(false);
  const [loadingBarcode, setLoadingBarcode] = useState(null);
  const [missBarcode, setMissBarcode] = useState(null);

  useEffect(() => {
    async function load() {
      setProfile(getProfile()); // local profile (stage/flags)
      if (user?.id) {
        const count = await getSupabaseScanCountThisMonth(user.id);
        setScanUsage({ scanCount: count });
        const history = await getSupabaseScanHistory(user.id, 20);
        setScanHistory(history.map(r => ({
          productName: r.product_name,
          verdict: r.verdict,
          timestamp: r.scanned_at,
          barcode: r.barcode,
        })));
      } else {
        setScanUsage(getScanUsage());
        const { getScanHistory } = await import('@/lib/userProfile');
        setScanHistory(getScanHistory().slice(0, 10));
      }
    }
    load();
  }, [user]);

  async function handleSignOut() {
    setSigningOut(true);
    // Wipe displayed data immediately — don't wait for the effect re-run.
    // This eliminates any flash of previous user's history during the transition.
    setScanHistory([]);
    setScanUsage({ scanCount: 0 });
    try {
      await signOut();
      clearProfile();
    } finally {
      setSigningOut(false);
      // signOut() guarantees the local Supabase session is cleared even when the
      // server-side revoke fails (see lib/auth.js) — but that fallback path never
      // fires Supabase's own SIGNED_OUT event, so don't wait on the async
      // onAuthStateChange listener to update the parent's `user` state. Tell it
      // directly, every time, regardless of whether the network round-trip
      // succeeded.
      onSignOut?.();
    }
  }

  const handleHistoryItemTap = createHistoryTapHandler({
    supabase,
    userLevel,
    promptVersion: PROMPT_VERSION,
    onResult: onViewVerdict,
    tapInFlightRef,
    setLoadingBarcode,
    setMissBarcode,
  });

  const vc = { red: '#C0392B', yellow: '#D4AC0D', green: '#27AE60', unverified: '#9A8260' };

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
  const nextStage = stage && stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
  const avatarLetter = user?.email ? user.email[0].toUpperCase() : null;

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--text-dark)' }}>
          My Profile
        </span>
      </div>

      <div style={{ padding: '20px 20px 0' }}>

        {/* ── Auth section ─────────────────────────────────────────────── */}
        {user ? (
          /* Signed-in user card */
          <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: 'white', fontSize: 20, fontWeight: 700 }}>{avatarLetter}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
              <p style={{ fontSize: 12, color: 'var(--forest)', fontWeight: 600 }}>✓ Synced across devices</p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{ background: 'none', border: '1px solid var(--cream-dark)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', minHeight: 36, whiteSpace: 'nowrap' }}
            >
              {signingOut ? '...' : 'Sign Out'}
            </button>
          </div>
        ) : (
          /* Anonymous sign-in nudge */
          <div style={{ background: 'linear-gradient(135deg, #FFF8F0, #FAF0E0)', borderRadius: 16, padding: 16, marginBottom: 16, border: '1.5px solid rgba(212,135,42,0.2)' }}>
            <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 15, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 4 }}>
              Save your history
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.5, marginBottom: 14 }}>
              Create a free account to sync your stage, scan history, and personal flags across all your devices.
            </p>
            <button
              onClick={onSignIn}
              style={{ width: '100%', height: 46, background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            >
              Sign In / Create Account
            </button>
          </div>
        )}

        {/* ── Your Journey ─────────────────────────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            Your Journey
          </p>

          {hasAssessment && stage ? (
            <>
              <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--amber)', marginBottom: 14 }}>
                {stage.name}
              </p>
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
              {/* MVP_MODE: Pro coaching note hidden.
                  To restore: remove MVP_MODE check below.
              {!MVP_MODE && nextStage && (
                <p style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.5, fontStyle: 'italic', borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 10 }}>
                  Pro members get weekly coaching to move from <strong style={{ color: 'var(--text-mid)' }}>{stage.name}</strong> to <strong style={{ color: 'var(--text-mid)' }}>{nextStage.name}</strong>.
                </p>
              )}
              */}
            </>
          ) : (
            /* MVP_MODE: simplified — just show the CTA, no Pro mention */
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

        {/* ── Scan Usage ───────────────────────────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>Scan Usage</p>
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
          {!user && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-light)', lineHeight: 1.4 }}>
              💡 <button onClick={onSignIn} style={{ background: 'none', border: 'none', color: 'var(--amber)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Sign in</button> to save your scan history across devices.
            </p>
          )}
        </div>

        {/* ── Scan History ─────────────────────────────────────────────── */}
        {scanHistory.length > 0 && (
          <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 15, fontWeight: 600, color: 'var(--text-dark)', marginBottom: 10 }}>
              Scan History {user ? '(last 20)' : '(last 10)'}
            </p>
            {scanHistory.map((item, i) => {
              const isLoading = loadingBarcode === item.barcode;
              const isMiss    = missBarcode === item.barcode;
              return (
                <div key={i}>
                  <div
                    onClick={() => handleHistoryItemTap(item)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      paddingTop: 10, paddingBottom: 10,
                      borderBottom: (!isMiss && i < scanHistory.length - 1) ? '1px solid rgba(0,0,0,0.07)' : 'none',
                      cursor: item.barcode ? 'pointer' : 'default',
                      opacity: isLoading ? 0.5 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: vc[item.verdict] || '#9A8260' }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.productName}
                    </span>
                    {isLoading ? (
                      <span style={{ fontSize: 11, color: 'var(--text-light)', flexShrink: 0 }}>…</span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-light)', flexShrink: 0 }}>
                        {formatTime(item.timestamp)}
                      </span>
                    )}
                  </div>
                  {isMiss && (
                    <p style={{
                      fontSize: 12, color: 'var(--text-light)', fontStyle: 'italic',
                      padding: '0 0 10px 22px',
                      borderBottom: i < scanHistory.length - 1 ? '1px solid rgba(0,0,0,0.07)' : 'none',
                    }}>
                      Scan this product again to see the full report.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Strictness Level ─────────────────────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Strictness Level</p>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.5, marginBottom: 12 }}>
            Level 1 flags seed oils, GMO crops, and natural flavors as caution (yellow) rather than avoid (red), making results less overwhelming while you build habits.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { level: 1, label: 'Level 1', sub: 'Building awareness' },
              { level: 2, label: 'Level 2', sub: 'Label-conscious' },
            ].map(({ level, label, sub }) => {
              const active = userLevel === level;
              return (
                <button
                  key={level}
                  onClick={() => onLevelChange && onLevelChange(level)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: 12,
                    border: active ? '2px solid var(--amber)' : '2px solid rgba(0,0,0,0.08)',
                    background: active ? 'rgba(212,135,42,0.08)' : 'white',
                    cursor: 'pointer',
                    textAlign: 'center',
                    minHeight: 44,
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--amber)' : 'var(--text-dark)', marginBottom: 2 }}>{label}</p>
                  <p style={{ fontSize: 11, color: active ? 'var(--amber)' : 'var(--text-light)', lineHeight: 1.3 }}>{sub}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Upgrade CTA ───────────────────────────────────────────────── */}
        {/* MVP_MODE: active upgrade button hidden; showing disabled Coming Soon.
            To restore: remove MVP_MODE check, restore the amber button below.
        {!MVP_MODE && (
          <button
            onClick={() => window.location.href = '/subscribe'}
            style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 14, cursor: 'pointer', marginBottom: 12 }}
          >
            Upgrade to Pro — $9.99/mo
          </button>
        )}
        */}
        <button
          disabled
          style={{ width: '100%', height: 52, background: '#D5CFC8', color: '#A09A93', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 14, cursor: 'not-allowed', marginBottom: 12, opacity: 0.7 }}
        >
          Pro — Coming Soon
        </button>

        <button
          onClick={onRetakeAssessment}
          style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 14, cursor: 'pointer', padding: '12px 0', minHeight: 44, textDecoration: 'underline' }}
        >
          {hasAssessment ? 'Retake assessment' : 'Take the assessment'}
        </button>

        {/* ── Legal & Privacy ───────────────────────────────────────── */}
        <div style={{ background: 'var(--cream-dark)', borderRadius: 16, padding: '4px 0', marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', padding: '12px 16px 8px' }}>
            Legal &amp; Privacy
          </p>

          {/* Disclaimer */}
          <button
            onClick={() => setShowDisclaimer(true)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '0 16px', minHeight: 48, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-dark)', fontWeight: 500 }}>Disclaimer</span>
            <span style={{ fontSize: 16, color: 'var(--text-light)' }}>›</span>
          </button>

          {/* Our Privacy Promise */}
          <button
            onClick={() => setShowPrivacyPromise(true)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '0 16px', minHeight: 48, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-dark)', fontWeight: 500 }}>Our Privacy Promise</span>
            <span style={{ fontSize: 16, color: 'var(--text-light)' }}>›</span>
          </button>

          {/* Privacy Policy — Coming Soon */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '0 16px', minHeight: 48 }}>
            <span style={{ fontSize: 14, color: 'var(--text-light)' }}>Privacy Policy</span>
            <span style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 600, background: 'rgba(0,0,0,0.06)', borderRadius: 6, padding: '2px 7px' }}>Coming Soon</span>
          </div>

          {/* Terms of Service — Coming Soon */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '0 16px', minHeight: 48 }}>
            <span style={{ fontSize: 14, color: 'var(--text-light)' }}>Terms of Service</span>
            <span style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 600, background: 'rgba(0,0,0,0.06)', borderRadius: 6, padding: '2px 7px' }}>Coming Soon</span>
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--text-light)' }}>
          Beyond Labels v1.0.0-beta
        </p>
      </div>

      {showDisclaimer && <DisclaimerModal onAccept={() => setShowDisclaimer(false)} />}
      {showPrivacyPromise && <PrivacyPromiseModal onClose={() => setShowPrivacyPromise(false)} />}
    </div>
  );
}
