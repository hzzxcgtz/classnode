'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fullscreen-preview.module.css';

/** Native modal focus containment; portal keeps the viewer outside clipped worksheet panels. */
export function FullscreenPreview({ title, onClose, children, controls }: {
  title: string; onClose: () => void; children: ReactNode; controls?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && typeof element.showModal === 'function') element.showModal();
    else {
      element?.setAttribute('open', '');
    }
    // Keep initial focus inside the preview without highlighting an action.
    element?.focus({ preventScroll: true });
    return () => {
      if (element && typeof element.close === 'function') element.close();
      else element?.removeAttribute('open');
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onKeyDown={event => {
      if (event.key === 'Tab') {
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); } }}>
    <header className={styles.header}>
      <h2 id={titleId}>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label="关闭全屏预览" title="关闭（Esc）"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </header>
    {children}
    {controls && <footer className={styles.controls}>{controls}</footer>}
  </dialog>, document.body);
}
