'use client';

export default function Header({ title, onBack, backLabel = 'Back', rightAction }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px 12px',
      background: 'var(--cream)',
      borderBottom: '1px solid var(--cream-dark)',
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }}>
      {onBack ? (
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--amber)', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 0', minHeight: 44 }}>
          ← {backLabel}
        </button>
      ) : <div style={{ width: 60 }} />}
      <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--text-dark)' }}>
        {title}
      </span>
      {rightAction ? rightAction : <div style={{ width: 60 }} />}
    </div>
  );
}
