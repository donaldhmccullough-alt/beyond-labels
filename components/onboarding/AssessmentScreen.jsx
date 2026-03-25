'use client';
import { useState } from 'react';
import { QUESTIONS } from '@/lib/onboardingData';

export default function AssessmentScreen({ onComplete, onBack }) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selected, setSelected] = useState(null);

  const question = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  function handleSelect(option) {
    if (selected !== null) return;
    setSelected(option.label);
    const newAnswers = { ...answers, [question.id]: option.score };

    setTimeout(() => {
      if (currentQ < QUESTIONS.length - 1) {
        setCurrentQ(currentQ + 1);
        setSelected(null);
        setAnswers(newAnswers);
      } else {
        const total = Object.values(newAnswers).reduce((s, v) => s + v, 0);
        onComplete(total);
      }
    }, 300);
  }

  function handleBack() {
    if (currentQ === 0) {
      onBack();
    } else {
      setCurrentQ(currentQ - 1);
      setSelected(null);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px 12px',
        background: 'var(--cream)',
        borderBottom: '1px solid var(--cream-dark)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={handleBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            color: 'var(--amber)', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', background: 'none', border: 'none',
            padding: '4px 0', minHeight: 44,
          }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 600 }}>
          {currentQ + 1} of {QUESTIONS.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--cream-dark)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--amber)',
          transition: 'width 0.3s ease',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      {/* Question */}
      <div style={{ flex: 1, padding: '28px 20px 24px', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>
          Question {currentQ + 1}
        </span>
        <h2 style={{
          fontFamily: 'var(--font-playfair), Georgia, serif',
          fontSize: 22, fontWeight: 700,
          color: 'var(--text-dark)', lineHeight: 1.3,
          marginBottom: 24,
        }}>
          {question.text}
        </h2>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {question.options.map((option) => {
            const isSelected = selected === option.label;
            return (
              <button
                key={option.label}
                onClick={() => handleSelect(option)}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: isSelected ? 'rgba(212,135,42,0.12)' : 'var(--cream-dark)',
                  border: isSelected ? '2px solid var(--amber)' : '2px solid transparent',
                  borderRadius: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'all 0.15s',
                  minHeight: 52,
                }}
              >
                <span style={{
                  width: 28, height: 28,
                  borderRadius: '50%',
                  background: isSelected ? 'var(--amber)' : 'white',
                  border: isSelected ? '2px solid var(--amber)' : '2px solid var(--cream-dark)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  color: isSelected ? 'white' : 'var(--text-light)',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}>
                  {option.label}
                </span>
                <span style={{ fontSize: 15, color: 'var(--text-dark)', fontWeight: isSelected ? 600 : 400, lineHeight: 1.35 }}>
                  {option.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
