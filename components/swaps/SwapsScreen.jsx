'use client';
import { useState, useEffect } from 'react';
import SwapCard from './SwapCard';

// Fallback product-category mapping for when a scan has no OFF-tagged
// productCategory (see mapProductCategory() in lib/scanHelpers.js) — keyed
// on the scan's top flag instead. Module-scope (not defined inside the
// component) so it's a plain, testable data structure — see
// __tests__/components/SwapsScreen.test.js.
//
// conventional_meat -> 'meat' (fixed July 2026, Phase 1 of the swaps
// overhaul): meat became a real swap category with real swap_products rows
// in Phase 0 (migrateSwapsFromSheet.js); before that fix this entry was
// `null`, meaning any scan whose only signal was a conventional_meat flag
// and no OFF productCategory dead-ended to the "Local Farm Upgrade" card
// with zero curated or AI swaps shown, even though real meat swaps existed.
export const FLAG_CATEGORY_MAP = {
  trans_fats:          'condiments',
  seed_oils:           'snacks',
  conventional_crops:  'snacks',
  bioengineering:      'snacks',
  natural_flavors:     'snacks',
  synthetic_additives: 'snacks',
  gluten_grains:       'cereal',
  conventional_meat:   'meat',
};

// "Show More" expansion (Phase 2 of the swaps overhaul, July 2026) — GET
// /api/swaps now returns up to 20 rows per tier (raised from 3, see
// pages/api/swaps.js) instead of just 3, so the full pool a user could ever
// expand into is already sitting in `swaps` state after the one fetch.
// INITIAL_VISIBLE_SWAPS/getVisibleSwaps/shouldShowExpandButton are pure,
// module-scope functions (same reasoning as FLAG_CATEGORY_MAP above) so
// this logic has direct unit test coverage without rendering the component
// — see __tests__/components/SwapsScreen.test.js.
export const INITIAL_VISIBLE_SWAPS = 3;

export function getVisibleSwaps(items, expanded) {
  return expanded ? items : items.slice(0, INITIAL_VISIBLE_SWAPS);
}

// Never shown for AI-generated results (source === 'ai') — per design,
// "Show More" only ever expands an already-fetched curated pool. This is
// also naturally true today since the AI path never populates `swaps` (see
// the fetch handler below), but is asserted explicitly here rather than
// relied on as a side effect, so it stays correct if that coupling ever
// changes.
export function shouldShowExpandButton(items, expanded, source) {
  return source !== 'ai' && !expanded && items.length > INITIAL_VISIBLE_SWAPS;
}

export default function SwapsScreen({ scanResult, userLevel = 1, onBack }) {
  const [swaps, setSwaps] = useState([]);
  const [aiSwaps, setAiSwaps] = useState([]);
  const [source, setSource] = useState('curated');
  const [goodExpanded, setGoodExpanded] = useState(false);
  const [betterExpanded, setBetterExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const productCategory    = scanResult?.productCategory ?? null;
  const productSubcategory = scanResult?.productSubcategory ?? null;
  const flagCategories     = [...new Set((scanResult?.flags || []).map(f => f.category))];

  const topFlag         = (scanResult?.flags || [])[0]?.category ?? null;
  const fallbackCategory = topFlag ? (FLAG_CATEGORY_MAP[topFlag] ?? null) : null;
  const resolvedCategory = productCategory ?? fallbackCategory;

  useEffect(() => {
    setLoading(true);
    setError(null);
    // A fresh fetch means a fresh pool — any previous expansion no longer
    // applies to it.
    setGoodExpanded(false);
    setBetterExpanded(false);
    const params = new URLSearchParams({ userLevel: String(userLevel) });
    if (resolvedCategory) params.set('category', resolvedCategory);
    // Only meaningful alongside a real productCategory — the flag-derived
    // fallbackCategory has no corresponding subcategory signal.
    if (productCategory && productSubcategory) params.set('subcategory', productSubcategory);

    fetch(`/api/swaps?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        setSource(data.source);
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
  }, [resolvedCategory, productCategory, productSubcategory, userLevel]);

  const goodSwaps   = swaps.filter(s => s.tier === 'good');
  const betterSwaps = swaps.filter(s => s.tier === 'better');
  const visibleGoodSwaps   = getVisibleSwaps(goodSwaps, goodExpanded);
  const visibleBetterSwaps = getVisibleSwaps(betterSwaps, betterExpanded);
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
                  {visibleGoodSwaps.map((swap, i) => (
                    <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
                  ))}
                  {shouldShowExpandButton(goodSwaps, goodExpanded, source) && (
                    <ShowMoreButton onClick={() => setGoodExpanded(true)} />
                  )}
                </>
              )}
              {betterSwaps.length > 0 && (
                <>
                  <SectionDivider label="Better Swap" />
                  {visibleBetterSwaps.map((swap, i) => (
                    <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
                  ))}
                  {shouldShowExpandButton(betterSwaps, betterExpanded, source) && (
                    <ShowMoreButton onClick={() => setBetterExpanded(true)} />
                  )}
                </>
              )}
            </>
          )}

          {/* Level 2: flat list (uses the "better" tier state — Level 2 never renders a "good" tier at all) */}
          {!isLevel1 && (
            <>
              {visibleBetterSwaps.map((swap, i) => (
                <SwapCard key={i} swap={swap} clearedFlags={flagCategories} />
              ))}
              {shouldShowExpandButton(betterSwaps, betterExpanded, source) && (
                <ShowMoreButton onClick={() => setBetterExpanded(true)} />
              )}
            </>
          )}

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

// Matches the header "← Verdict" back button's text-link style (amber,
// 600 weight, transparent background, no border) — the app's existing
// pattern for a tappable text link, reused here rather than introducing a
// new visual treatment.
function ShowMoreButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: 'calc(100% - 32px)', margin: '0 16px 16px',
        color: 'var(--amber)', fontSize: 14, fontWeight: 600, textAlign: 'center',
        cursor: 'pointer', background: 'none', border: 'none', padding: '10px 0', minHeight: 44,
      }}
    >
      Show More
    </button>
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
