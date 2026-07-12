import type { ChangeEvent, RefObject } from 'react';

interface AgentLogoFieldProps {
  inputRef: RefObject<HTMLInputElement | null>;
  preview: string | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

export function AgentLogoField({ inputRef, preview, onChange, onRemove }: AgentLogoFieldProps) {
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative' }}>
        <button type="button" aria-label="选择智能体头像" onClick={() => inputRef.current?.click()} style={{
          width: 56, height: 56, borderRadius: 12,
          background: preview ? `url(${preview}) center/cover no-repeat` : '#f1f4f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', overflow: 'hidden', padding: 0,
          border: '2px dashed #d0d5dd',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#d0d5dd'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          {!preview && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          )}
        </button>
        <input type="file" ref={inputRef} accept="image/*" onChange={onChange} style={{ display: 'none' }} />
        <button type="button" onClick={() => inputRef.current?.click()} style={{
          position: 'absolute', bottom: -6, right: -6,
          width: 20, height: 20, borderRadius: '50%',
          background: '#2563eb', color: 'white', border: '2px solid white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: "0.75rem", lineHeight: 1,
          padding: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        }} title="上传头像" aria-label="上传智能体头像">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        {preview && (
          <button type="button" onClick={onRemove} style={{
            position: 'absolute', top: -5, right: -5,
            width: 18, height: 18, borderRadius: '50%',
            background: '#ef4444', color: 'white', border: '2px solid white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: "0.563rem", lineHeight: 1,
            padding: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
          }} title="移除头像" aria-label="移除智能体头像">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
