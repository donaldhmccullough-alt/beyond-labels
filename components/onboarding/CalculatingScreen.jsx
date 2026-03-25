'use client';
import { useEffect } from 'react';

export default function CalculatingScreen({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--cream)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      gap: 28,
    }}>
      <div className="pulse-circle" />
      <h2 style={{
        fontFamily: 'var(--font-playfair), Georgia, serif',
        fontSize: 22, fontWeight: 700,
        color: 'var(--text-dark)', lineHeight: 1.3,
        textAlign: 'center', maxWidth: 280,
      }}>
        Sina and Joel are reading your results...
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-light)', textAlign: 'center' }}>
        Personalizing your experience
      </p>
    </div>
  );
}
