'use client';

// Content is structured so section headings render distinctly from body text.
const CONTENT = [
  { type: 'paragraph', text: "Beyond Labels is built by people who believe transparency matters — including about your data. Here is exactly what we collect and why." },

  { type: 'heading', text: "What we collect:" },
  { type: 'bullet', text: "Your email address — only if you create an account, used solely to save your preferences and scan history across devices." },
  { type: 'bullet', text: "Your scan history — the products you scan and their verdicts, stored so you can reference them later." },
  { type: 'bullet', text: "Your food journey preferences — your level setting and onboarding responses, used to personalize your results." },

  { type: 'heading', text: "What we do not collect:" },
  { type: 'paragraph', text: "No location data. No device identifiers. No browsing history. No payment information. No third-party tracking, analytics, or advertising pixels of any kind." },

  { type: 'heading', text: "Third parties:" },
  { type: 'bullet', text: "Supabase handles account storage and authentication. Google and Apple OAuth are available as sign-in options — if you use them, their standard privacy policies apply." },
  { type: 'bullet', text: "Open Food Facts receives only a barcode number when you scan a product. They are a nonprofit crowdsourced food database." },
  { type: 'bullet', text: "Anthropic receives ingredient text to generate your scan analysis. No personally identifying information is ever sent." },

  { type: 'paragraph', text: "We will never sell your data. Ever." },
  { type: 'paragraph', text: "A formal Privacy Policy is coming soon." },
];

export default function PrivacyPromiseModal({ onClose }) {
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
            Our Privacy Promise
          </p>
          <div style={{ height: 1, background: 'var(--cream-dark)', marginTop: 16 }} />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {CONTENT.map((item, i) => {
            const isLast = i === CONTENT.length - 1;
            if (item.type === 'heading') {
              return (
                <p key={i} style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--text-dark)',
                  marginTop: i === 0 ? 0 : 20, marginBottom: 8,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  {item.text}
                </p>
              );
            }
            if (item.type === 'bullet') {
              return (
                <p key={i} style={{
                  fontSize: 14, lineHeight: 1.7, color: 'var(--text-mid)',
                  marginBottom: isLast ? 0 : 8,
                  paddingLeft: 16,
                  position: 'relative',
                }}>
                  <span style={{ position: 'absolute', left: 2 }}>•</span>
                  {item.text}
                </p>
              );
            }
            // paragraph
            return (
              <p key={i} style={{
                fontSize: 14, lineHeight: 1.7, color: 'var(--text-mid)',
                marginBottom: isLast ? 0 : 16,
              }}>
                {item.text}
              </p>
            );
          })}
        </div>

        {/* CTA */}
        <div style={{ padding: '16px 24px 36px', flexShrink: 0 }}>
          <button
            onClick={onClose}
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
