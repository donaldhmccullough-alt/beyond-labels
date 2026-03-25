'use client';

const TABS = [
  { id: 'scan', label: 'Scan', icon: '📷' },
  { id: 'verdict', label: 'Verdict', icon: '✓' },
  { id: 'swaps', label: 'Swaps', icon: '↔' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

export default function BottomNav({ activeTab, onTabChange }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 430,
      height: 68,
      background: 'var(--cream)',
      borderTop: '1.5px solid var(--cream-dark)',
      display: 'flex',
      alignItems: 'stretch',
      zIndex: 100,
    }}>
      {TABS.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              padding: '8px 0 10px',
              transition: 'all 0.15s',
              position: 'relative',
            }}
          >
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 32,
                height: 3,
                background: 'var(--amber)',
                borderRadius: '3px 3px 0 0',
              }} />
            )}
            <span style={{ fontSize: 22, lineHeight: 1, color: isActive ? 'var(--amber)' : '#8A8A8A' }}>
              {tab.icon}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: isActive ? 'var(--amber)' : '#8A8A8A',
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
