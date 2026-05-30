import type { CSSProperties } from 'react';

export function ErrorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function FieldError({ message, style }: { message: string; style?: CSSProperties }) {
  if (!message) return null;
  return (
    <div style={{
      fontSize: 12, color: '#ef4444', marginTop: 4,
      display: 'flex', alignItems: 'center', gap: 4,
      ...style,
    }}>
      <ErrorIcon />
      {message}
    </div>
  );
}
