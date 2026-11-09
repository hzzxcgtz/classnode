'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { IconInfoCircle, IconMicrophone, IconPhoto, IconWriting } from '@tabler/icons-react';
import { canvasAnswerLabel, canvasRectStyle, type CanvasWidget, type WorksheetImageCanvas } from '@/lib/worksheet-image-canvas';
import { isDraftEmpty, type AnswerDraft } from '@/lib/worksheet-answer-value';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import styles from './worksheet.module.css';
import canvasStyles from './image-canvas-task.module.css';

function CanvasHint({ widget }: { widget: CanvasWidget }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return <>
    <button type="button" className={`${canvasStyles.hintButton} ${styles.imageCanvasButton}`} style={canvasRectStyle(widget)}
      aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(value => !value)}>
      <IconInfoCircle size={17} aria-hidden="true" /><span>{widget.label || '查看提示'}</span>
    </button>
    <div id={detailId} hidden={!open} className={canvasStyles.hintDetail}
      style={{ top: `${widget.y + widget.height}%`, left: `clamp(0px, ${widget.x}%, 100% - 220px)` }}>
      {widget.detail || widget.label || '暂无说明'}
    </div>
  </>;
}

export function ImageCanvasTask({ canvas, title, inputMode, deskReview, draft, disabled, children }: {
  canvas: WorksheetImageCanvas;
  title: string;
  inputMode: string;
  deskReview: boolean;
  draft: AnswerDraft | undefined;
  disabled: boolean;
  children: (onBusyChange?: (busy: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const answer = canvas.widgets.find(widget => widget.kind === 'answer');
  const done = draft && !isDraftEmpty(draft);
  const photo = draft?.kind === 'photo' && draft.url ? worksheetAssetUrl(draft.url) : '';
  const label = answer?.label || canvasAnswerLabel(inputMode, deskReview);
  const Icon = inputMode === 'photo' ? IconPhoto : inputMode === 'audio' ? IconMicrophone : IconWriting;

  return <>
    <div className={canvasStyles.stage}>
      <img className={canvasStyles.background} src={worksheetAssetUrl(canvas.url)} alt={title || '任务底图'}
        width={canvas.width} height={canvas.height} draggable={false} />
      {canvas.widgets.map(widget => {
        if (widget.kind === 'label') return <span key={widget.id} className={canvasStyles.label}
          style={canvasRectStyle(widget)}>{widget.label}</span>;
        if (widget.kind === 'hint') return <CanvasHint key={widget.id} widget={widget} />;
        return <button type="button" ref={trigger} key={widget.id}
          className={`${canvasStyles.answer} ${styles.imageCanvasButton}`}
          style={canvasRectStyle(widget)} disabled={disabled && !done}
          aria-label={done ? `查看作答：${label}` : label} onClick={() => {
            dialog.current?.showModal();
            setOpen(true);
          }}>
          {photo ? <img src={photo} alt="作答照片缩略图" /> : <Icon size={24} aria-hidden="true" />}
          <span>{done ? inputMode === 'audio' ? '打开录音' : '查看作答' : label}</span>
        </button>;
      })}
    </div>
    {answer ? <dialog ref={dialog} className={canvasStyles.dialog} aria-labelledby={headingId} onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <header className={canvasStyles.dialogHeader}>
        <h3 id={headingId}>{label}</h3>
        <button type="button" className={`btn btn-secondary ${styles.imageCanvasButton}`}
          disabled={busy} onClick={() => dialog.current?.close()}>{busy ? '正在处理作答…' : '返回任务'}</button>
      </header>
      {open && children(setBusy)}
    </dialog> : children()}
  </>;
}
