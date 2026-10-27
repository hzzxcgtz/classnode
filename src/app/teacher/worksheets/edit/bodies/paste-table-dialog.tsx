'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** 自带焦点范围的粘贴窗，不读取剪贴板，粘贴由用户主动完成。 */
export function PasteTableDialog({ value, error, busy, returnFocusRef, onChange, onClose, onConfirm }: {
  value: string;
  error: string;
  busy: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const returnTarget = returnFocusRef.current;
    inputRef.current?.focus();
    return () => { if (returnTarget?.isConnected) returnTarget.focus(); else if (previous?.isConnected) previous.focus(); };
  }, [returnFocusRef]);
  return <>
    <div className="modal-overlay" onClick={onClose} />
    <div ref={dialogRef} className="worksheet-editor-dialog teacher-editor-dialog worksheet-editor-paste-table-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-table-title" aria-describedby="paste-table-help" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const fields = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') ?? []);
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h3 id="paste-table-title">粘贴表格</h3>
      <p id="paste-table-help">从 Excel 或 Word 复制表格，再粘贴到下方。</p>
      <textarea ref={inputRef} className="input" rows={7} aria-label="粘贴表格内容" placeholder="在这里粘贴表格" value={value} onChange={event => onChange(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <div className="worksheet-editor-paste-table-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn btn-primary" disabled={busy || !value.trim()} onClick={onConfirm}>使用这张表格</button></div>
    </div>
  </>;
}
