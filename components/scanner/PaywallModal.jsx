'use client';
export default function PaywallModal({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'var(--cream)', borderRadius: 20, padding: '28px 24px', maxWidth: 360, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h2 style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 22, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 12 }}>Free scans used up</h2>
        <p style={{ fontSize: 15, color: 'var(--text-mid)', lineHeight: 1.55, marginBottom: 24 }}>You've used your 5 free scans this month. Upgrade to Beyond Labels Pro for unlimited scanning.</p>
        <button onClick={() => window.location.href = '/subscribe'} style={{ width: '100%', height: 52, background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 16, border: 'none', borderRadius: 12, cursor: 'pointer', marginBottom: 12 }}>Upgrade — .99/mo</button>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', padding: 12, minHeight: 44, textDecoration: 'underline' }}>Wait until next month</button>
      </div>
    </div>
  );
}