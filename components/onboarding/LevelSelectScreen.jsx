'use client';

export default function LevelSelectScreen({ onComplete }) {
  const cards = [
    {
      level: 1,
      title: 'Building awareness',
      body: "I'm just starting to pay attention to what's in my food.",
      icon: '🌱',
    },
    {
      level: 2,
      title: 'Already label-conscious',
      body: 'I already read labels and avoid things like GMOs and artificial additives.',
      icon: '🔍',
    },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', padding: '40px 20px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 26, fontWeight: 700, color: 'var(--text-dark)', lineHeight: 1.25, marginBottom: 10 }}>
          Where are you on your food journey?
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-mid)', lineHeight: 1.6 }}>
          This helps us set the right level of detail for your scan results.
        </p>
      </div>

      {/* Level cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 'auto' }}>
        {cards.map(({ level, title, body, icon }) => (
          <button
            key={level}
            onClick={() => onComplete(level)}
            style={{
              background: 'white',
              border: '2px solid var(--cream-dark)',
              borderRadius: 18,
              padding: '20px 18px',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              transition: 'border-color 0.15s, box-shadow 0.15s',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              minHeight: 44,
            }}
          >
            <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{icon}</span>
            <div>
              <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 17, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 6 }}>
                {title}
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.55 }}>{body}</p>
            </div>
          </button>
        ))}
      </div>

      <p style={{ textAlign: 'center', marginTop: 28, fontSize: 12, color: 'var(--text-light)', lineHeight: 1.5 }}>
        You can change this anytime in your profile.
      </p>
    </div>
  );
}
