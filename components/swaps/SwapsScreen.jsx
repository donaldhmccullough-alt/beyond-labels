'use client';
import { useState, useEffect } from 'react';
import SwapCard from './SwapCard';

export default function SwapsScreen({ scanResult, userLevel = 1, onBack }) {
  const [swaps, setSwaps] = useState([]);
  const [aiSwaps, setAiSwaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const productCategory = scanResult?.productCategory ?? null;
  const flagCategories  = [...new Set((scanResult?.flags || []).map(f => f.category))];

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ userLevel: String(userLevel) });
    if (productCategory) params.set('category', productCategory);

    fetch(`/api/swaps?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.source === 'ai') {
          setSwaps([]);
          setAiSwaps(data.swaps || []);
        } else {
          setSwaps(data.swaps || []);
          setAiSwaps([]);
        }
      })
      .catch(() => setError('Could not load swaps.'))
      .finally(() => setLoading(false));
  }, [productCategory, userLevel]);

  const goodSwaps   = swaps.filter(s => s.tier === 'good');
  const betterSwaps = swaps.filter(s => s.tier === 'better');
  const isLevel1    = userLevel === 1;

  const categoryLabel = productCategory
    ? productCategory.replace('_', ' ')
    : 'products';

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <button onClick={onBack} style={{ color: 'var(--amber)', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 0', minHeight: 44 }}>← Verdict</button>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 18, fontWeight: 700 }}>Cleaner Swaps</span>
        <div style={{ width: 60 }} />
      </div>

      {/* Banner */}
      <div style={{ margin: '16px 16px 0', background: 'linear-gradient(135deg, #3A5A40, #4D7B55)', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24 }}>🌿</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: 0.8, marginBottom: 2, color: 'white' }}>Better Options</div>
          <div style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 16, fontWeight: 700, color: 'white' }}>
            Cleaner {categoryLabel} picks
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '20px 16px' }}>
          {[1, 2].map(i => (
            <div key={i} style={{ margin: '0 0 12px', background: 'white', border: '1.5px solid var(--cream-dark)', borderRadius: 20, padding: 16 }}>
              <div className="shimmer" style={{ height: 20, width: '60%', marginBottom: 8, borderRadius: 6 }} />
              <div className="shimmer" style={{ height: 14, width: '40%', marginBottom: 12, borderRadius: 6 }} />
              <div className="shimmer" style={{ height: 14, width: '80%', borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-light)', fontSize: 14 }}>{error}</p>
        </div>
      ) : (
        <div style={{ paddingTop: 12 }}>

          {/* Level 1: Good + Better sections */}
          {isLevel1 && (
            <>
              {goodSwaps.length > 0 && (
                <>
                  <SectionDivider label="Good Swap" />
                  {goodSwaps.map((swap, i) => (
                    <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
                  ))}
                </>
              )}
              {betterSwaps.length > 0 && (
                <>
                  <SectionDivider label="Better Swap" />
                  {betterSwaps.map((swap, i) => (
                    <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
                  ))}
                </>
              )}
            </>
          )}

          {/* Level 2: flat list */}
          {!isLevel1 && betterSwaps.map((swap, i) => (
            <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
          ))}

          {/* AI fallback */}
          {aiSwaps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <SectionDivider label="AI Suggestions" />
              <div style={{ margin: '0 16px 12px', background: 'rgba(212,135,42,0.08)', borderRadius: 10, padding: '10px 12px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.4 }}>These suggestions are AI-generated and unverified. Always read labels.</p>
              </div>
              {aiSwaps.map((swap, i) => (
                <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {swaps.length === 0 && aiSwaps.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-light)', fontSize: 15 }}>No curated swaps yet for this category.</p>
            </div>
          )}

          {/* Local farm card */}
          <div style={{ margin: '16px 16px 0' }}>
            <SectionDivider label="Local Farm Upgrade" />
            <div style={{ background: 'white', border: '1.5px solid var(--cream-dark)', borderRadius: 20, overflow: 'hidden' }}>
              <div style={{ height: 120, background: 'linear-gradient(135deg, #EAF2EB, #D5E8D6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12, gap: 8 }}>
                <span style={{ fontSize: 28 }}>🌳</span>
                <span style={{ fontSize: 40 }}>🏡</span>
                <span style={{ fontSize: 28 }}>🌳</span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 16, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 4 }}>Find a local farm</div>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>Connect with regenerative farmers near you</div>
                <span style={{ background: 'rgba(212,135,42,0.1)', border: '1px solid rgba(212,135,42,0.3)', color: 'var(--amber)', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Coming Soon</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 16px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
    </div>
  );
}
