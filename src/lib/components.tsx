import { useEffect, type CSSProperties } from 'react';

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

type ToastType = 'success' | 'error' | 'info';

const TOAST_BG: Record<ToastType, string> = {
  success: '#065f46',
  error: '#991b1b',
  info: '#1e293b',
};

export function Toast({ msg, type, onClose }: { msg: string; type?: ToastType; onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return;
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [msg]);
  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999,
      padding: '10px 24px', borderRadius: 10,
      background: TOAST_BG[type || 'success'],
      color: 'white', fontSize: 14, fontWeight: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {type === 'success' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      )}
      {msg}
      {onClose && (
        <button onClick={onClose} style={{ marginLeft: 8, flexShrink: 0, width: 20, height: 20, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 0, lineHeight: 1, fontSize: 12 }}>×</button>
      )}
    </div>
  );
}
