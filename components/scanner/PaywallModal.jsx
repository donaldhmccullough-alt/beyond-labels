'use client';
export default function PaywallModal({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'var(--cream)', borderRadius: 20, padding: '28px 24px', maxWidth: 360, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>

        {/* CHANGE 3: Updated headline */}
        <h2 style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 22, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 12 }}>
          You've used your 15 free scans this month
        </h2>

        {/* CHANGE 3: Updated body copy */}
        <p style={{ fontSize: 15, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 24 }}>
          Beyond Labels Pro gives you unlimited scanning, full swap recommendations, weekly coaching challenges, and a guided path from where you are to where you want to be.
        </p>

        {/* CHANGE 3: Updated button text */}
        <button
          onClick={() => window.location.href = '/subscribe'}
          style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 16, border: 'none', borderRadius: 12, cursor: 'pointer', marginBottom: 12 }}
        >
          Upgrade to Pro — $9.99/mo
        </button>

        {/* CHANGE 3: Updated secondary button text */}
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', padding: 12, minHeight: 44, textDecoration: 'underline', display: 'block', width: '100%' }}
        >
          Remind me next month
        </button>

        {/* CHANGE 5: Additional perks line */}
        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-light)', lineHeight: 1.6, borderTop: '1px solid var(--cream-dark)', paddingTop: 14 }}>
          Pro members also unlock: weekly Home Remake challenges, Sina's recipe library, and local farm connections near you.
        </p>
      </div>
    </div>
  );
}
