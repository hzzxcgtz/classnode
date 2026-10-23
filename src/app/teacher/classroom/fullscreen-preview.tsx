'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fullscreen-preview.module.css';
import { TemporaryAnnotations } from './temporary-annotations';

/** Native modal focus containment; portal keeps the viewer outside clipped worksheet panels. */
export function FullscreenPreview({ title, onClose, children, controls, allowAnnotations = false, renderAnnotations, controlsLayout }: {
  title: string; onClose: () => void; children: ReactNode; controls?: ReactNode; allowAnnotations?: boolean; renderAnnotations?: (toolbarHost: HTMLElement | null) => ReactNode; controlsLayout?: 'image';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [annotating, setAnnotating] = useState(false);
  const [frozenContent, setFrozenContent] = useState<ReactNode>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!annotating) return;
    const endOnResize = () => { setAnnotating(false); setFrozenContent(null); };
    const blockWheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); };
    const element = dialog.current;
    if (!renderAnnotations) element?.addEventListener('wheel', blockWheel, {capture:true, passive:false});
    window.addEventListener('resize', endOnResize);
    window.addEventListener('orientationchange', endOnResize);
    return () => {
      element?.removeEventListener('wheel', blockWheel, true);
      window.removeEventListener('resize', endOnResize);
      window.removeEventListener('orientationchange', endOnResize);
    };
  }, [annotating, renderAnnotations]);
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
    onCancel={event => { event.preventDefault(); if (annotating) {setAnnotating(false);setFrozenContent(null);} else closeRef.current(); }}
    onKeyDown={event => {
      if (event.key === 'Tab') {
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(item => !item.closest('[data-preview-locked="true"]') && getComputedStyle(item).visibility !== 'hidden');
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (annotating && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key) && !(renderAnnotations && event.target instanceof HTMLInputElement && event.target.type === 'range') && !(event.key === ' ' && event.target instanceof Element && event.target.closest('button'))) event.preventDefault();
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (annotating) {setAnnotating(false);setFrozenContent(null);} else closeRef.current(); } }}>
    <header className={styles.header}>
      <h2 id={titleId}>{title}</h2>
      <div className={styles.headerActions}>
      <button type="button" className={styles.close} onClick={onClose} aria-label="关闭全屏预览" title="关闭（Esc）"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
    </header>
    <div className={styles.content}>
      <div className={styles.previewBody} data-preview-locked={annotating}>{annotating && !renderAnnotations ? frozenContent : children}</div>
      {annotating && (renderAnnotations ? renderAnnotations(toolbarHost) : <TemporaryAnnotations toolbarHost={toolbarHost} />)}
    </div>
    {(controls || allowAnnotations) && <footer className={`${styles.controls} ${controlsLayout === 'image' ? styles.imageControls : ''}`}>
      <div ref={setToolbarHost} className={styles.bottomTools}>
        <div className={styles.viewControls} data-preview-locked={annotating} aria-hidden={annotating || undefined}>{controls}</div>
      </div>
        {allowAnnotations && <button type="button" className={styles.annotationToggle} aria-pressed={annotating} onClick={() => { if (annotating) {setAnnotating(false);setFrozenContent(null);} else {setFrozenContent(children);setAnnotating(true);} }} title={annotating ? '结束后清除本次所有批注' : '固定当前画面，开始临时批注'}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5"/></svg>
          {annotating ? '结束批注' : '开始批注'}
        </button>}
    </footer>}
  </dialog>, document.body);
}
