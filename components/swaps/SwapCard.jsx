'use client';

const CERT_STYLES = {
  'usda-organic': { bg: '#EAFAF1', color: '#27AE60', label: 'USDA Organic' },
  'non-gmo-project-verified': { bg: '#FEF9E7', color: '#D4AC0D', label: 'Non-GMO Verified' },
};

export default function SwapCard({ swap, clearedFlags = [] }) {
  const certList = swap.certifications ? swap.certifications.split(';').map(c => c.trim()).filter(Boolean) : [];
  const whyList = swap.why_it_passes ? swap.why_it_passes.split(';').map(w => w.trim()).filter(Boolean) : [];
  const storeList = swap.where_to_buy ? swap.where_to_buy.split(',').map(s => s.trim()).filter(Boolean) : [];

  return (
    <div style={{ margin: '0 16px 12px', background: 'white', border: '1.5px solid var(--cream-dark)', borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 17, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 2, lineHeight: 1.25 }}>{swap.product_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{swap.brand}</div>
          </div>
          {swap.ai_generated && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', background: 'var(--cream-dark)', borderRadius: 6, padding: '3px 7px', marginLeft: 8, flexShrink: 0 }}>AI</span>
          )}
        </div>

        {certList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {certList.map(cert => {
              const style = CERT_STYLES[cert] || { bg: 'var(--cream-dark)', color: 'var(--text-mid)', label: cert };
              return (
                <span key={cert} style={{ background: style.bg, color: style.color, borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                  {style.label}
                </span>
              );
            })}
          </div>
        )}

        {whyList.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Why it passes</p>
            {whyList.map((reason, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 18, height: 18, background: '#EAFAF1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, color: '#27AE60' }}>✓</div>
                <span style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.45 }}>{reason}</span>
              </div>
            ))}
          </div>
        )}

        {clearedFlags.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Clears</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {clearedFlags.map(flag => (
                <span key={flag} style={{ background: '#EAFAF1', color: 'var(--forest)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>{flag}</span>
              ))}
            </div>
          </div>
        )}

        {storeList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {storeList.slice(0, 3).map((store, i) => (
              <button key={i} style={{ padding: '9px 14px', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: i === 0 ? 'var(--forest)' : 'var(--cream-dark)', color: i === 0 ? 'white' : 'var(--text-dark)', transition: 'all 0.15s' }}>
                {store}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
