'use client';

export default function LoadingSpinner({ size = 40, color = 'var(--amber)' }) {
  return (
    <div style={{
      width: size,
      height: size,
      border: '3px solid rgba(0,0,0,0.1)',
      borderTopColor: color,
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes spin{to{transform:rotate(360deg);}}' }} />
    </div>
  );
}
