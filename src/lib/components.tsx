import { useEffect, useState, type CSSProperties } from 'react';

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
    <div role="alert" style={{
      fontSize: "0.75rem", color: '#ef4444', marginTop: 4,
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
  }, [msg, onClose]);
  return (
    <div role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'} style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999,
      padding: '10px 24px', borderRadius: 10,
      background: TOAST_BG[type || 'success'],
      color: 'white', fontSize: "0.875rem", fontWeight: 500,
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
        <button onClick={onClose} aria-label="关闭提示" style={{ marginLeft: 8, flexShrink: 0, width: 20, height: 20, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 0, lineHeight: 1, fontSize: "0.75rem" }}>×</button>
      )}
    </div>
  );
}

// ============ 通用翻页组件 ============
export function Pagination({
  current, total, pageSize = 20, pageSizeOptions = [10, 20, 50, 100],
  onChange, onPageSizeChange,
}: {
  current: number;
  total: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jumpValue, setJumpValue] = useState('');

  if (totalPages <= 1) return null;

  const btn: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 32, height: 32, padding: '0 8px',
    borderRadius: 6, border: '1px solid #e2e8f0',
    background: 'white', color: '#475569', cursor: 'pointer',
    fontSize: "0.75rem", fontWeight: 500, fontFamily: 'inherit',
    transition: 'all 0.1s',
  };
  const btnDisabled: CSSProperties = { ...btn, opacity: 0.4, cursor: 'not-allowed' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      padding: '12px 0',
    }}>
      <button style={current === 1 ? btnDisabled : btn}
        disabled={current === 1}
        onClick={() => { onChange(1); setJumpValue(''); }}
        title="首页">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
      </button>
      <button style={current === 1 ? btnDisabled : btn}
        disabled={current === 1}
        onClick={() => { onChange(current - 1); setJumpValue(''); }}
        title="上一页">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>

      <span style={{ fontSize: "0.75rem", color: '#94a3b8', margin: '0 4px', whiteSpace: 'nowrap' }}>
        {current} / {totalPages}
      </span>

      <button style={current === totalPages ? btnDisabled : btn}
        disabled={current === totalPages}
        onClick={() => { onChange(current + 1); setJumpValue(''); }}
        title="下一页">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button style={current === totalPages ? btnDisabled : btn}
        disabled={current === totalPages}
        onClick={() => { onChange(totalPages); setJumpValue(''); }}
        title="尾页">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
        <input value={jumpValue} onChange={e => setJumpValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const p = parseInt(jumpValue);
              if (p >= 1 && p <= totalPages) { onChange(p); setJumpValue(''); }
            }
          }}
          placeholder="页码"
          style={{
            width: 52, height: 32, padding: '0 8px', boxSizing: 'border-box',
            borderRadius: 6, border: '1px solid #e2e8f0', fontSize: "0.75rem",
            textAlign: 'center', outline: 'none', fontFamily: 'inherit',
          }} />
        <button style={btn} onClick={() => {
          const p = parseInt(jumpValue);
          if (p >= 1 && p <= totalPages) { onChange(p); setJumpValue(''); }
        }}>跳转</button>
      </div>

      {onPageSizeChange && (
        <select value={pageSize} onChange={e => { onPageSizeChange(Number(e.target.value)); onChange(1); setJumpValue(''); }}
          style={{
            marginLeft: 8, height: 28, padding: '0 6px',
            borderRadius: 6, border: '1px solid #e2e8f0', fontSize: "0.75rem",
            background: 'white', color: '#475569', outline: 'none', cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
          {pageSizeOptions.map(s => (
            <option key={s} value={s}>每页 {s} 条</option>
          ))}
        </select>
      )}
      <span style={{ fontSize: "0.688rem", color: '#94a3b8', marginLeft: 8, whiteSpace: 'nowrap' }}>
        共 {total} 条
      </span>
    </div>
  );
}
