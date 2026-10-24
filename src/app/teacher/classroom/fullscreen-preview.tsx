'use client';

import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fullscreen-preview.module.css';
import { TemporaryAnnotations } from './temporary-annotations';
import { readImageAnnotations, type AnnotationDocument, type AnnotationStroke } from '@/lib/image-annotation-session';
import { useAnnotationStorage } from './annotation-storage';
import type { AnnotationPersistence } from '@/lib/annotation-persistence';

type TextFrame = { content: ReactNode; textSize: number; width: number; height: number; scroll: {top: number; left: number}[] };
const textFrames = new Map<string, TextFrame>();

/** Native modal focus containment; portal keeps the viewer outside clipped worksheet panels. */
type AnnotationTools = {annotationKey?: string; onChange?: (strokes: AnnotationStroke[]) => void};
interface PreviewProps {
  title: string; onClose: () => void; children: ReactNode; controls?: ReactNode; allowAnnotations?: boolean;
  renderAnnotations?: (toolbarHost: HTMLElement | null, tools?: AnnotationTools) => ReactNode;
  controlsLayout?: 'image'; annotationKey?: string; textSize?: number;
}
export function FullscreenPreview(props: PreviewProps) {
  const {session,state} = useAnnotationStorage(props.allowAnnotations ? props.annotationKey : undefined);
  const status = session && <span className={styles.saveStatus} role="status">
    {state.loading ? '正在读取批注…' : state.error ? `${state.ready ? '批注未保存：' : '读取批注失败：'}${state.error}` : state.saving ? '批注保存中…' : state.document ? '批注已保存' : '批注自动保存'}
    {state.error && <button type="button" onClick={() => { if (state.conflict) { if (window.confirm('另一位教师已更新批注。重新读取将替换本窗口尚未保存的修改，是否继续？')) void session.reload(); } else void (state.ready ? session.save() : session.load()); }}>{state.conflict ? '重新读取' : '重试'}</button>}
  </span>;
  return <FullscreenPreviewBody key={session && !state.ready ? 'loading' : state.conflict ? 'conflict' : 'ready'} {...props}
    allowAnnotations={props.allowAnnotations && (!session || state.ready) && !state.conflict}
    storage={session} initialDocument={state.document} storageStatus={status}
    annotationKey={session?.cacheKey ?? props.annotationKey} />;
}
function FullscreenPreviewBody({ title, onClose, children, controls, allowAnnotations = false, renderAnnotations, controlsLayout, annotationKey, textSize = 24, storage, initialDocument, storageStatus }: PreviewProps & {storage: AnnotationPersistence | null; initialDocument: AnnotationDocument | null; storageStatus: ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hasMarks = !!annotationKey && readImageAnnotations(annotationKey).length > 0;
  const [annotating, setAnnotating] = useState(allowAnnotations && hasMarks);
  const [frame, setFrame] = useState<TextFrame | null>(() => !renderAnnotations && annotationKey && hasMarks ? (storage && initialDocument?.frame ? {...initialDocument.frame,content:children} : textFrames.get(annotationKey) ?? null) : null);
  const [frozenContent, setFrozenContent] = useState<ReactNode>(() => frame?.content ?? children);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width: 0, height: 0});
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!annotating || !frame) return;
    if (annotationKey) textFrames.set(annotationKey,frame);
    body.current?.querySelectorAll<HTMLElement>('*').forEach((element, index) => {
      const position = frame.scroll[index];
      if (position) { element.scrollTop = position.top; element.scrollLeft = position.left; }
    });
  }, [annotating, frame, size.width, size.height, annotationKey]);
  const startAnnotations = () => {
    if (!renderAnnotations) {
      const saved = annotationKey && readImageAnnotations(annotationKey).length ? textFrames.get(annotationKey) : undefined;
      const next = saved ?? {
        content: children, textSize, width: content.current?.clientWidth || 1, height: content.current?.clientHeight || 1,
        scroll: [...(body.current?.querySelectorAll<HTMLElement>('*') ?? [])].map(element => ({top: element.scrollTop, left: element.scrollLeft})),
      };
      setFrame(next); setFrozenContent(next.content);
      if (annotationKey) textFrames.set(annotationKey, next);
    }
    setAnnotating(true);
  };
  const saveStrokes = (strokes: AnnotationStroke[]) => {
    storage?.update({version:1,kind:renderAnnotations ? 'image' : 'text',strokes,
      ...(!renderAnnotations && frame ? {frame:{width:frame.width,height:frame.height,scroll:frame.scroll,textSize:frame.textSize}} : {})});
  };
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
    <div ref={content} className={styles.content}>
      <div ref={body} className={styles.previewBody} data-preview-locked={annotating} style={{'--preview-text-size':`${annotating && frame ? frame.textSize : textSize}px`, ...(annotating && frame ? {position:'absolute', width:frame.width, height:frame.height, transformOrigin:'top left', transform:`scale(${size.width / frame.width}, ${size.height / frame.height})`} : {})} as React.CSSProperties}>{annotating && !renderAnnotations ? frozenContent : children}</div>
      {annotating && (renderAnnotations ? renderAnnotations(toolbarHost, {annotationKey,onChange:saveStrokes}) : <TemporaryAnnotations annotationKey={annotationKey} frame={frame ?? undefined} onChange={saveStrokes} toolbarHost={toolbarHost} />)}
    </div>
    {(controls || allowAnnotations) && <footer className={`${styles.controls} ${controlsLayout === 'image' ? styles.imageControls : ''}`}>
      <div ref={setToolbarHost} className={styles.bottomTools}>
        <div className={styles.viewControls} data-preview-locked={annotating} aria-hidden={annotating || undefined}>{controls}</div>
      </div>
        {storageStatus}{allowAnnotations && <button type="button" className={styles.annotationToggle} aria-pressed={annotating} onClick={() => { if (annotating) {setAnnotating(false);setFrozenContent(null);} else startAnnotations(); }} title={annotationKey ? (annotating ? '结束批注，保留已有批注' : '开始批注，恢复已有批注') : (annotating ? '结束后清除本次所有批注' : '固定当前画面，开始临时批注')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5"/></svg>
          {annotating ? '结束批注' : '开始批注'}
        </button>}
    </footer>}
  </dialog>, document.body);
}
