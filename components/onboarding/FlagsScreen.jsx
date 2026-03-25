'use client';
import { useState } from 'react';

const FLAG_OPTIONS = [
  'Gluten / celiac',
  'Dairy / lactose',
  'Eggs',
  'Tree nuts / peanuts',
  'Shellfish / fish',
  'Soy',
  'Nightshades',
  'Corn (all sources)',
  'Added sugars',
  'Alcohol-derived',
  'Kosher',
  'Halal',
  'Vegan',
];

export default function FlagsScreen({ onComplete }) {
  const [selected, setSelected] = useState([]);

  function toggleFlag(flag) {
    setSelected(prev =>
      prev.includes(flag) ? prev.filter(f => f !== flag) : [...prev, flag]
    );
  }

  function handleNone() {
    onComplete([]);
  }

  function handleReady() {
    onComplete(selected);
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', padding: '32px 24px' }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-light)',
        textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8,
      }}>
        Personal Flags
      </span>
      <h2 style={{
        fontFamily: 'var(--font-playfair), Georgia, serif',
        fontSize: 24, fontWeight: 700, color: 'var(--text-dark)', lineHeight: 1.25, marginBottom: 8,
      }}>
        Anything we should always flag for you?
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.5, marginBottom: 24 }}>
        We'll highlight these ingredients in every scan result.
      </p>

      {/* Flag grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        {FLAG_OPTIONS.map(flag => {
          const isSelected = selected.includes(flag);
          return (
            <button
              key={flag}
              onClick={() => toggleFlag(flag)}
              style={{
                padding: '10px 6px',
                background: isSelected ? 'var(--forest)' : 'var(--cream-dark)',
                border: isSelected ? '2px solid var(--forest)' : '2px solid transparent',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                color: isSelected ? 'white' : 'var(--text-mid)',
                textAlign: 'center',
                lineHeight: 1.3,
                transition: 'all 0.15s',
                minHeight: 44,
              }}
            >
              {flag}
            </button>
          );
        })}
      </div>

      {/* None button */}
      <button
        onClick={handleNone}
        style={{
          width: '100%', padding: '14px',
          background: 'none',
          border: '1.5px solid var(--cream-dark)',
          borderRadius: 12,
          cursor: 'pointer',
          fontSize: 14, fontWeight: 600, color: 'var(--text-light)',
          marginBottom: 12,
          minHeight: 48,
          transition: 'all 0.15s',
        }}
      >
        None of these
      </button>

      <div style={{ flex: 1 }} />

      {/* Ready CTA */}
      <button
        onClick={handleReady}
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
        I'm ready to scan →
      </button>
    </div>
  );
}
