'use client';

const PARAGRAPHS = [
  "The Beyond Labels app is an educational tool created by Sina McCullough, PhD and Joel Salatin to help you understand what's in your food. Sina McCullough holds a PhD in Nutrition and is not a medical doctor.",
  "The information provided in this app — including ingredient flags, verdicts, and product commentary — reflects the Beyond Labels methodology and is intended for educational purposes only. It is not medical advice, and it is not intended to diagnose, treat, prevent, mitigate, or cure any medical or psychological condition.",
  "Do not make changes to your diet, medication, or lifestyle based solely on information provided in this app. Always consult a qualified healthcare professional before making decisions that affect your health.",
  "The ingredient flagging in this app reflects the views and standards of Sina McCullough, PhD and Joel Salatin, and does not represent the positions of the FDA, USDA, or any other regulatory body.",
  "Hands Off My Food, LLC, Sina McCullough, PhD, Polyface, Inc., and Joel Salatin specifically disclaim any liability, loss, or risk — personal or otherwise — that may be incurred as a direct or indirect consequence of your use of this app or application of its contents.",
  "By continuing, you acknowledge that you have read this disclaimer and agree to use this app for educational purposes only.",
];

export default function DisclaimerModal({ onAccept }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--cream)',
        borderRadius: '24px 24px 0 0',
        width: '100%',
        maxWidth: 430,
        maxHeight: '88dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Heading */}
        <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
          <p style={{
            fontFamily: 'var(--font-playfair), Georgia, serif',
            fontSize: 22, fontWeight: 700, color: 'var(--text-dark)',
          }}>
            Disclaimer
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {PARAGRAPHS.map((p, i) => (
            <p key={i} style={{
              fontSize: 14, lineHeight: 1.7, color: 'var(--text-mid)',
              marginBottom: i < PARAGRAPHS.length - 1 ? 16 : 0,
            }}>
              {p}
            </p>
          ))}
        </div>

        {/* CTA */}
        <div style={{ padding: '16px 24px 36px', flexShrink: 0 }}>
          <button
            onClick={onAccept}
            style={{
              width: '100%', height: 56,
              background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
              color: 'white',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: 17, fontWeight: 700,
              border: 'none', borderRadius: 16,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(212,135,42,0.35)',
            }}
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
