'use client';
// ─────────────────────────────────────────────────────────────────────────────
// MVP_MODE: set to false to restore personal flag badges and quiz nudge banners
// ─────────────────────────────────────────────────────────────────────────────
const MVP_MODE = true;

import { useState, useEffect } from 'react';
import { getProfile, getTotalScans, shouldShowNudge, markNudgeDismissed } from '@/lib/userProfile';
import { formatTime } from '@/lib/scanHistory';
import rulesEngine from '@/lib/rulesEngine';
import ConcernCard from './ConcernCard';

const { LEVEL_1_YELLOW_CATEGORIES } = rulesEngine;

// MVP_MODE: FLAG_KEYWORDS kept in place for when personal flags are re-enabled
const FLAG_KEYWORDS = {
  'Gluten / celiac': ['wheat', 'gluten', 'barley', 'rye', 'malt', 'spelt', 'kamut'],
  'Dairy / lactose': ['milk', 'lactose', 'whey', 'casein', 'cheese', 'butter', 'cream', 'dairy', 'lactalbumin'],
  'Eggs': ['egg', 'albumin', 'mayonnaise', 'ovalbumin'],
  'Tree nuts / peanuts': ['almond', 'cashew', 'walnut', 'pecan', 'peanut', 'hazelnut', 'pistachio', 'macadamia'],
  'Shellfish / fish': ['shrimp', 'crab', 'lobster', 'fish', 'salmon', 'tuna', 'anchovy', 'tilapia', 'cod'],
  'Soy': ['soy', 'soybean', 'tofu', 'edamame', 'miso', 'tempeh', 'soya'],
  'Nightshades': ['tomato', 'potato', 'pepper', 'eggplant', 'paprika', 'cayenne', 'chili'],
  'Corn (all sources)': ['corn', 'maize', 'dextrose', 'maltodextrin', 'hominy', 'grits'],
  'Added sugars': ['sugar', 'sucrose', 'fructose', 'syrup', 'honey', 'agave', 'molasses', 'dextrose'],
  'Alcohol-derived': ['alcohol', 'ethanol', 'vanilla extract', 'wine', 'beer', 'spirits'],
  'Vegan': ['milk', 'egg', 'meat', 'beef', 'pork', 'chicken', 'fish', 'gelatin', 'honey', 'whey', 'casein', 'lard'],
};

function getUnverifiedCopy(unverifiedReason, isMeat, userLevel) {
  if (unverifiedReason === 'no_ingredients' && isMeat && userLevel === 1) {
    return "We couldn't find the ingredient list for this product. Flip the package over and read the label before buying — skip it if you see any synthetic chemicals, artificial additives, artificial flavors, or preservatives.";
  }
  if (unverifiedReason === 'no_ingredients' && isMeat && userLevel === 2) {
    return "We couldn't find this product in our database. Look for the USDA Organic seal before buying, and use your best judgment on quality — grass-fed, pasture-raised, or sourced from a farm you trust is always the better choice.";
  }
  if (unverifiedReason === 'no_ingredients') {
    return "We found this product but it has no ingredient data on file. We can't screen what we can't see — check the label directly.";
  }
  return "We couldn't identify this product. Try scanning again — if it still doesn't work, it may not be in our database yet.";
}

export default function VerdictScreen({ scanResult, userLevel = 1, onSeeSwaps, onBack, onStartOnboarding }) {
  const [explanation, setExplanation] = useState(null);
  const [loadingExplanation, setLoadingExplanation] = useState(false);

  // MVP_MODE: nudge milestone tracking kept but not rendered
  const [nudgeMilestone, setNudgeMilestone] = useState(null);

  const profile = typeof window !== 'undefined' ? getProfile() : null;
  const userFlags = profile?.flags || [];

  // MVP_MODE: nudge logic kept intact, just not shown in UI
  useEffect(() => {
    if (MVP_MODE) return; // skip in MVP
    const total = getTotalScans();
    const milestone = shouldShowNudge(total);
    setNudgeMilestone(milestone);
  }, [scanResult]);

  useEffect(() => {
    if (!scanResult) return;

    // Unverified results have no ingredients — nothing to explain.
    if (scanResult.verdict === 'unverified') return;

    // If the scan result already carries an explanation (cache hit or inline
    // Claude call in /api/scan), use it directly — no need to call /api/explain.
    if (scanResult.explanation) {
      setExplanation(scanResult.explanation);
      setLoadingExplanation(false);
      return;
    }

    setLoadingExplanation(true);
    setExplanation(null);
    fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verdict: scanResult.verdict,
        flags: scanResult.flags,
        productName: scanResult.productName,
        ingredients: scanResult.ingredients,
        userLevel,
        clearedBy: scanResult.clearedBy,
        unverifiedReason: scanResult.unverifiedReason,
      }),
    })
      .then(r => r.json())
      .then(data => setExplanation(data))
      .catch(() => setExplanation(null))
      .finally(() => setLoadingExplanation(false));
  }, [scanResult]);

  if (!scanResult) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ fontSize: 16, color: 'var(--text-light)', textAlign: 'center', marginBottom: 16 }}>No scan result yet. Go scan a product!</p>
        <button onClick={onBack} style={{ background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 12, padding: '12px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>Go to Scanner</button>
      </div>
    );
  }

  const { verdict, flags = [], productName, ingredients, unverifiedIngredients = [], unverifiedReason, isMeat = false } = scanResult;

  const hasLevel1SoftFlags = userLevel === 1 && flags.some(f => f.severity === 'caution' && LEVEL_1_YELLOW_CATEGORIES.has(f.category));
  const verdictColors = { red: '#C0392B', yellow: '#D4AC0D', green: '#27AE60', unverified: '#9A8260', inconclusive: '#D4872A' };
  const verdictBg = { red: '#FDEDEC', yellow: '#FEF9E7', green: '#EAFAF1', unverified: '#F5F5F5', inconclusive: '#FDF6EE' };
  const verdictLabel = { red: 'AVOID', yellow: 'CAUTION', green: 'CLEAN', unverified: 'UNVERIFIED', inconclusive: 'INCONCLUSIVE' };

  const sortedFlags = [...flags].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'reject' ? -1 : 1
  );

  const byCategory = {};
  sortedFlags.forEach(f => {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  });

  // MVP_MODE: personal flag detection kept but not rendered
  const ingredientsLower = (ingredients || '').toLowerCase();
  const triggeredPersonalFlags = userFlags.filter(flag => {
    const keywords = FLAG_KEYWORDS[flag] || [];
    return keywords.some(kw => ingredientsLower.includes(kw));
  });

  const unverifiedCopy = getUnverifiedCopy(unverifiedReason, isMeat, userLevel);

  const tl = [
    { color: '#E74C3C', active: verdict === 'red' },
    { color: '#F1C40F', active: verdict === 'yellow' },
    { color: '#2ECC71', active: verdict === 'green' },
  ];

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <button onClick={onBack} style={{ color: 'var(--amber)', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 0', minHeight: 44 }}>← Scanner</button>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 18, fontWeight: 700 }}>Verdict</span>
        <div style={{ width: 60 }} />
      </div>

      {/* Traffic light + product name */}
      <div style={{ margin: '16px 16px 0', borderRadius: 20, padding: 20, display: 'flex', alignItems: 'center', gap: 16, background: verdictBg[verdict] || verdictBg.unverified, border: '1.5px solid ' + (verdictColors[verdict] || '#ccc') + '33' }}>
        <div style={{ background: '#2C2C2C', borderRadius: 30, padding: '8px 5px', display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', flexShrink: 0 }}>
          {tl.map((dot, i) => (
            <div key={i} style={{ width: 28, height: 28, borderRadius: '50%', background: dot.color, opacity: dot.active ? 1 : 0.2, boxShadow: dot.active ? '0 0 12px ' + dot.color : 'none' }} />
          ))}
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 20, marginBottom: 8, color: 'white', background: verdictColors[verdict] || '#9A8260' }}>
            {verdictLabel[verdict] || verdict}
          </span>
          <div style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 18, fontWeight: 700, color: 'var(--text-dark)', lineHeight: 1.25, marginBottom: 4 }}>
            {productName || 'Unknown Product'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-light)' }}>
                {scanResult.timestamp ? formatTime(scanResult.timestamp) : 'Scanned just now'}
              </div>
        </div>
      </div>

      {/* MVP_MODE: personal flag badges hidden.
          To restore: remove the MVP_MODE check and uncomment this block.
      {!MVP_MODE && triggeredPersonalFlags.length > 0 && (
        <div style={{ margin: '12px 16px 0', background: 'var(--blue-flag-bg)', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-flag-text)', marginBottom: 8 }}>👤 Your personal flags:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {triggeredPersonalFlags.map(flag => (
              <span key={flag} style={{ background: 'white', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--blue-flag-text)', border: '1px solid rgba(12,68,124,0.2)' }}>
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}
      */}

      {/* AI summary / unverified message / inconclusive message */}
      {verdict === 'unverified' ? (
        <div style={{ margin: '12px 16px 0', background: 'var(--cream-dark)', borderRadius: 16, padding: 16, borderLeft: '4px solid ' + (verdictColors[verdict] || '#9A8260') }}>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)' }}>
            {unverifiedCopy}
          </p>
        </div>
      ) : verdict === 'inconclusive' ? (
        <div style={{ margin: '12px 16px 0', background: 'var(--cream-dark)', borderRadius: 16, padding: 16, borderLeft: '4px solid ' + (verdictColors[verdict] || '#D4872A') }}>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)' }}>
            We found this product but couldn't confidently analyze its ingredients — they may be listed in an unfamiliar format or language. Scan again for a fresh attempt, or check the label manually.
          </p>
        </div>
      ) : (
        <div style={{ margin: '12px 16px 0', background: 'var(--cream-dark)', borderRadius: 16, padding: 16, minHeight: 72, borderLeft: '4px solid ' + (verdictColors[verdict] || '#9A8260') }}>
          {loadingExplanation ? (
            <div>
              <div className="shimmer" style={{ height: 16, marginBottom: 8, width: '90%', borderRadius: 6 }} />
              <div className="shimmer" style={{ height: 16, width: '70%', borderRadius: 6 }} />
            </div>
          ) : explanation ? (
            <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)' }}>{explanation.summary}</p>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>Tap a concern card below for details.</p>
          )}
        </div>
      )}

      {/* Concern cards */}
      {Object.keys(byCategory).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: '0 16px 10px', fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 18, fontWeight: 700, color: 'var(--text-dark)' }}>Concerns</p>
          {Object.entries(byCategory).map(([cat, catFlags]) => (
            <ConcernCard key={cat} category={cat} flags={catFlags} explanation={explanation?.details?.[cat]} />
          ))}
        </div>
      )}

      {verdict === 'green' && (
        <div style={{ margin: '16px 16px 0', background: '#EAFAF1', borderRadius: 16, padding: 16, border: '1.5px solid rgba(39,174,96,0.2)' }}>
          <p style={{ fontSize: 15, color: '#27AE60', fontWeight: 600 }}>This product passed all checks!</p>
        </div>
      )}

      {/* Unrecognized Ingredients */}
      {unverifiedIngredients.length > 0 && (
        <div style={{ margin: '16px 16px 0', background: '#F5F5F5', borderRadius: 16, padding: 16, border: '1.5px solid rgba(0,0,0,0.08)' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 6 }}>Unrecognized Ingredients</p>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 12 }}>
            We haven't formed an opinion on the following ingredients yet. As a general rule — if it's not something your grandmother would have had in her kitchen, it's probably not something you want to consume.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unverifiedIngredients.map((ing, i) => (
              <span key={i} style={{ background: 'white', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: 'var(--text-mid)', fontWeight: 500 }}>
                {ing}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Level 1 context note — shown below concern cards */}
      {hasLevel1SoftFlags && (
        <div style={{ margin: '16px 16px 0', background: '#FFF8F0', borderRadius: 12, padding: '10px 14px', border: '1.5px solid rgba(212,135,42,0.2)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>🌱</span>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.5 }}>
            <span style={{ fontWeight: 700, color: 'var(--amber)' }}>Level 1 view:</span> Some caution items here would flag red at Level 2. That's fine — keep building awareness at your own pace.
          </p>
        </div>
      )}

      {/* Swaps CTA / Scan Again */}
      {(verdict === 'unverified' || verdict === 'inconclusive') ? (
        <button onClick={onBack} style={{ margin: '20px 16px 0', width: 'calc(100% - 32px)', padding: 16, background: 'linear-gradient(135deg, #3A5A40, #4D7B55)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 16px rgba(58,90,64,0.3)' }}>
          Scan Again →
        </button>
      ) : (verdict === 'red' || verdict === 'yellow') ? (
        <button onClick={onSeeSwaps} style={{ margin: '20px 16px 0', width: 'calc(100% - 32px)', padding: 16, background: 'linear-gradient(135deg, #3A5A40, #4D7B55)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 4px 16px rgba(58,90,64,0.3)' }}>
          See Cleaner Swaps →
        </button>
      ) : null}

      {/* MVP_MODE: onboarding nudge banner hidden.
          To restore: remove the MVP_MODE check in the useEffect above and
          uncomment this block.
      {!MVP_MODE && nudgeMilestone && (
        <div style={{ margin: '12px 16px 16px', background: 'var(--cream-dark)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid rgba(212,135,42,0.3)' }}>
          <button onClick={() => { if (onStartOnboarding) onStartOnboarding(); }} style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700, color: 'var(--amber)' }}>Want results tailored to your journey?</span>
              {' '}Take our 2-min assessment →
            </span>
          </button>
          <button onClick={() => { markNudgeDismissed(nudgeMilestone); setNudgeMilestone(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 18, lineHeight: 1, padding: '4px 4px', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-label="Dismiss">✕</button>
        </div>
      )}
      */}

      {/* Bottom padding */}
      <div style={{ height: 24 }} />
    </div>
  );
}
