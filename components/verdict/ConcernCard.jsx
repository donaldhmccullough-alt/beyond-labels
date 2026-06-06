'use client';
import { useState } from 'react';

const CATEGORY_INFO = {
  trans_fats:          { icon: '⛔', label: 'Trans Fats' },
  seed_oils:           { icon: '🫙', label: 'Seed Oils' },
  conventional_crops:  { icon: '🌽', label: 'Conventional Crops' },
  bioengineering:      { icon: '🧬', label: 'Bioengineering' },
  natural_flavors:     { icon: '🍃', label: 'Natural Flavors' },
  additives:           { icon: '🧪', label: 'Additives' },
  synthetic_additives: { icon: '🧪', label: 'Additives' },
  gluten_grains:       { icon: '🌾', label: 'Gluten Grains' },
  glyphosate_heavy:    { icon: '☠️', label: 'High Glyphosate Risk' },
  conventional_meat:   { icon: '🥩', label: 'Conventional Meat' },
  conventional_dairy:  { icon: '🥛', label: 'Conventional Dairy' },
  conventional_eggs:   { icon: '🥚', label: 'Conventional Eggs', description: 'Eggs from conventionally raised hens, which may be exposed to pesticide-laden feed and crowded conditions.' },
  fortified_vitamins:  { icon: '💊', label: 'Synthetic Fortification', description: 'Synthetic vitamins and minerals added back after industrial processing strips naturally occurring nutrients — a sign of heavily refined ingredients.' },
  natural_colorants:   { icon: '🎨', label: 'Natural Colorants', description: 'Plant-derived colorants (annatto, beet juice, beta-carotene, etc.) that indicate the product required color correction after processing.' },
  olive_oil_adulteration: { icon: '🫒', label: 'Olive Oil Quality', description: 'Olive oil is one of the most frequently adulterated foods on the market — even certified organic bottles are sometimes cut with cheaper oils. Worth sourcing from a brand you trust.' },
};

export default function ConcernCard({ category, flags, explanation }) {
  const [open, setOpen] = useState(false);
  const info = CATEGORY_INFO[category] || { icon: '⚠️', label: category };
  const severity = flags.some(f => f.severity === 'reject') ? 'red' : 'yellow';
  const severityColors = { red: '#C0392B', yellow: '#D4AC0D' };
  const bgColors = { red: 'rgba(192,57,43,0.06)', yellow: 'rgba(212,172,13,0.06)' };

  return (
    <div style={{ margin: '0 16px 10px', background: 'white', border: '1.5px solid var(--cream-dark)', borderRadius: 16, overflow: 'hidden' }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}>
        <div style={{ fontSize: 20, flexShrink: 0, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: bgColors[severity] }}>
          {info.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 2 }}>{info.label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.4 }}>{flags.length} ingredient{flags.length > 1 ? 's' : ''} flagged</div>
        </div>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: severityColors[severity], flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: severityColors[severity], transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--cream-dark)' }}>
          <div style={{ paddingTop: 12 }}>
            {flags.map((f, i) => (
              <span key={i} style={{ display: 'inline-block', background: bgColors[severity], borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 600, color: severityColors[severity], marginRight: 6, marginBottom: 6 }}>{f.matchedIngredient}</span>
            ))}
          </div>
          {explanation && <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)', paddingTop: 8 }}>{explanation}</p>}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-light)', fontWeight: 500 }}>
            <span>📚</span><span>Beyond Labels methodology</span>
          </div>
        </div>
      )}
    </div>
  );
}
