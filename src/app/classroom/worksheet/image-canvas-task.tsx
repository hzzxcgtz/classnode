'use client';

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconArrowBackUp, IconCamera, IconCheck, IconInfoCircle, IconPhoto, IconStar, IconX } from '@tabler/icons-react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { api } from '@/lib/api';
import { canvasMatchChoices, canvasMatchSource, checkCanvasMatchAttempt, readCanvasMatch, canvasAnswerLabel, canvasAnswerMode, canvasChoiceFill, deskReviewSettings, canvasRegionNode, CANVAS_STAR_LIMIT, canvasRecordingStyle, canvasRectStyle, canvasWidgetStyle, CANVAS_STAR_LABEL, usesCanvasAnswers, type CanvasMatchChoice, type CanvasWidget, type WorksheetImageCanvas } from '@/lib/worksheet-image-canvas';
import type { WorksheetQuestionNode } from '@/lib/types';
import { emptyDraftFor, type AnswerDraft } from '@/lib/worksheet-answer-value';
import { INK_DEFAULT_COLOR, INK_DEFAULT_WIDTH, textSizeForWidth } from '@/lib/worksheet-ink';
import { AudioBody } from './questions/audio-body';
import { InkCanvas } from './ink-canvas';
import { DeskRatingInput } from './desk-rating';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import type { RenderCanvasPhotoTrigger } from './questions';
import styles from './worksheet.module.css';
import canvasStyles from './image-canvas-task.module.css';

function CanvasHint({ widget }: { widget: CanvasWidget }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return <>
    <button type="button" className={`${canvasStyles.hintButton} ${styles.imageCanvasButton}`} style={canvasWidgetStyle(widget)}
      aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(value => !value)}>
      <IconInfoCircle size={17} aria-hidden="true" /><span>{widget.label || '查看提示'}</span>
    </button>
    <div id={detailId} hidden={!open} className={canvasStyles.hintDetail}
      style={{ top: `${widget.y + widget.height}%`, left: `clamp(0px, ${widget.x}%, 100% - 220px)`, color: widget.textColor }}>
      {widget.detail || widget.label || '暂无说明'}
    </div>
  </>;
}

type MatchDragBox = { choiceId: string; x: number; y: number; width: number; height: number };
type MatchGesture = MatchDragBox & { pointerId: number; offsetX: number; offsetY: number; moved: boolean };

type InputRenderer = (node: WorksheetQuestionNode, draft: AnswerDraft | undefined, onChange: (draft: AnswerDraft) => void,
  onBusyChange?: (busy: boolean) => void, renderCanvasPhotoTrigger?: RenderCanvasPhotoTrigger) => ReactNode;

export function ImageCanvasTask({ canvas, node, draft, disabled, worksheetId, previewOnly, getGeneration, onBusyChange, onChange, children }: {
  canvas: WorksheetImageCanvas;
  node: WorksheetQuestionNode;
  draft: AnswerDraft | undefined;
  disabled: boolean;
  worksheetId?: string;
  previewOnly?: boolean;
  getGeneration?: () => string;
  onBusyChange?: (busy: boolean) => void;
  onChange: (draft: AnswerDraft) => void;
  children: InputRenderer;
}) {
  const composite = usesCanvasAnswers(node);
  const targets = canvas.widgets.filter(widget => widget.mode === 'region-match');
  const choices = canvasMatchChoices(canvas);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<MatchGesture | null>(null);
  const suppressClick = useRef(false);
  const check = useRef<AbortController | null>(null);
  const canAnswer = useRef(!disabled);
  canAnswer.current = !disabled;
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const busyRegions = useRef(new Set<string>());
  const setBusy = useCallback((id: string, busy: boolean) => {
    const previous = busyRegions.current.size > 0;
    if (busy) busyRegions.current.add(id);
    else busyRegions.current.delete(id);
    const next = busyRegions.current.size > 0;
    if (next !== previous) busyCallback.current?.(next);
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<MatchDragBox | null>(null);
  const [pending, setPending] = useState(false);
  const [focusedTarget, setFocusedTarget] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ x: number; y: number; text: string; attempt: number; correct?: boolean } | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const attempts = useRef(0);
  const latest = useRef(draft);
  latest.current = draft;
  function update(id: string, part: AnswerDraft) {
    const previous = latest.current;
    const next: AnswerDraft = composite
      ? { kind: 'image-canvas', answers: { ...(previous?.kind === 'image-canvas' ? previous.answers : {}), [id]: part } }
      : part;
    latest.current = next;
    onChange(next);
  }

  useEffect(() => () => {
    if (check.current) {
      check.current.abort();
      setBusy('match', false);
    }
  }, [setBusy]);

  useEffect(() => {
    if (!feedback) return;
    if (feedback.correct !== true) {
      feedbackRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const timeout = window.setTimeout(() => {
      setFeedback(current => current === feedback ? null : current);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  function matchResult(id: string) {
    const part = latest.current?.kind === 'image-canvas' ? latest.current.answers[id] : undefined;
    return part?.kind === 'canvas-match' ? part : null;
  }

  function targetAt(x: number, y: number) {
    const target = document.elementsFromPoint(x, y).find(
      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
        && element.hasAttribute('data-match-target') && Boolean(stage.current?.contains(element)),
    );
    return target?.dataset.matchTarget;
  }

  async function place(choiceId: string, targetId: string | null, missAnchor?: { x: number; y: number }) {
    if (disabled || check.current || matchResult(choiceId)?.correct) return;
    const target = targets.find(item => item.id === targetId);
    const anchor = target ? { x: target.x + target.width / 2, y: target.y + target.height } : missAnchor;
    if (!anchor) return;
    const generation = getGeneration?.() ?? '0:0';
    const attempt = ++attempts.current;
    const controller = new AbortController();
    check.current = controller;
    setPending(true);
    setBusy('match', true);
    setFeedback(null);
    try {
      const raw = previewOnly ? checkCanvasMatchAttempt(targets, choiceId, targetId)
        : worksheetId ? await api.checkWorksheetMatch(worksheetId, node.id, choiceId, targetId, generation, controller.signal) : null;
      if (controller.signal.aborted || !canAnswer.current || (getGeneration?.() ?? '0:0') !== generation) return;
      if (targetId === null && raw?.correct === false && typeof raw.feedback === 'string') {
        setFeedback({ ...anchor, attempt, text: raw.feedback, correct: false });
        return;
      }
      const result = readCanvasMatch(raw);
      if (!result) throw new Error('配对区域已变更，请刷新学习单');
      update(choiceId, { kind: 'canvas-match', targetId: result.targetId, targetNumber: result.targetNumber,
        correct: result.correct, feedback: result.feedback });
      setSelected(result.correct ? null : choiceId);
      const text = choices.find(choice => choice.id === choiceId)?.text;
      setFeedback({ ...anchor, attempt, text: `${text ? `${text} · ` : ''}${result.feedback}`, correct: result.correct });
    } catch (error) {
      if (!controller.signal.aborted && canAnswer.current && (getGeneration?.() ?? '0:0') === generation) {
        setFeedback({ ...anchor, attempt, text: error instanceof Error && !(error instanceof TypeError) ? error.message : '暂时无法判断，请重试。' });
      }
    } finally {
      check.current = null;
      if (!controller.signal.aborted) {
        setPending(false);
        setBusy('match', false);
      }
    }
  }

  function moveChoice(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.moved = true;
    setSelected(current.choiceId);
    setDragging({
      choiceId: current.choiceId,
      x: event.clientX - current.offsetX,
      y: event.clientY - current.offsetY,
      width: current.width,
      height: current.height,
    });
  }

  function endChoice(event: PointerEvent<HTMLButtonElement>, drop: boolean) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDragging(null);
    if (!current.moved) return;
    suppressClick.current = true;
    if (!drop || !canAnswer.current || check.current) return;
    const targetId = targetAt(event.clientX, event.clientY);
    if (targetId) {
      void place(current.choiceId, targetId);
      return;
    }
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    void place(current.choiceId, null, {
      x: Math.max(0, Math.min(100, (event.clientX - bounds.left) * 100 / bounds.width)),
      y: Math.max(0, Math.min(100, (event.clientY - bounds.top) * 100 / bounds.height)),
    });
  }

  function renderChip(choice: CanvasMatchChoice) {
    return <span className={canvasStyles.matchChip} style={{ backgroundColor: canvasChoiceFill(choice), color: choice.textColor }}>
      {choice.text}{matchResult(choice.id)?.correct === false && <span className={canvasStyles.matchRetry} aria-hidden="true">待重试</span>}
    </span>;
  }

  function renderChoice(choice: CanvasMatchChoice, index: number) {
    const result = matchResult(choice.id);
    if (result?.correct) return null;
    return <button key={choice.id} type="button" className={`${canvasStyles.matchChoice} ${styles.imageCanvasButton}`}
      style={canvasRectStyle(canvasMatchSource(choice, index))}
      aria-label={choice.text} aria-pressed={selected === choice.id} disabled={disabled || pending}
      data-dragging={dragging?.choiceId === choice.id}
      title={result?.feedback}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        const chip = event.currentTarget.firstElementChild;
        if (!chip) return;
        const bounds = chip.getBoundingClientRect();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          choiceId: choice.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
          offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, width: bounds.width, height: bounds.height,
        };
      }}
      onPointerMove={moveChoice} onPointerUp={event => endChoice(event, true)}
      onPointerCancel={event => endChoice(event, false)} onLostPointerCapture={event => endChoice(event, false)}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        setSelected(current => current === choice.id ? null : choice.id);
      }}>{renderChip(choice)}</button>;
  }

  const draggedChoice = dragging && choices.find(choice => choice.id === dragging.choiceId);

  return <>
    {choices.length > 0 && <span className="sr-only" role="status">{pending ? '正在判断…'
        : feedback ? `${feedback.correct === true ? '配对正确。' : feedback.correct === false ? '再试一次。' : ''}${feedback.text}`
          : selected && focusedTarget ? `当前区域 ${focusedTarget}` : ''}</span>}
    {/* Keep viewport coordinates outside the transformed preview and classroom panels. */}
    {dragging && draggedChoice && createPortal(
      <span className={canvasStyles.matchGhost} data-match-ghost aria-hidden="true"
        style={{ left: dragging.x, top: dragging.y, width: dragging.width, height: dragging.height }}>
        {renderChip(draggedChoice)}
      </span>, document.body,
    )}
    <div ref={stage} className={canvasStyles.stage}>
      <img className={canvasStyles.background} src={worksheetAssetUrl(canvas.url)} alt={node.prompt || '任务底图'}
        width={canvas.width} height={canvas.height} draggable={false} />
      {canvas.widgets.map(widget => {
        if (widget.kind === 'label') return <span key={widget.id} className={canvasStyles.label}
          style={canvasWidgetStyle(widget)}>{widget.label}</span>;
        if (widget.kind === 'hint') return <CanvasHint key={widget.id} widget={widget} />;
        const mode = canvasAnswerMode(node, widget);
        if (mode === 'region-match') {
          const number = targets.findIndex(target => target.id === widget.id) + 1;
          const placed = choices.find(choice => {
            const result = matchResult(choice.id);
            return result?.correct && result.targetId === widget.id;
          });
          return <button key={widget.id} type="button" className={`${canvasStyles.matchTarget} ${styles.imageCanvasButton}`}
            style={{ ...canvasRectStyle(widget), borderRadius: widget.matchShape === 'ellipse' ? '50%' : undefined }}
            data-match-target={widget.id} disabled={disabled || pending}
            aria-label={`区域 ${number}${placed ? `，${placed.text}` : ''}`}
            onFocus={() => setFocusedTarget(number)}
            onBlur={() => setFocusedTarget(null)} onClick={() => { setFocusedTarget(null); if (selected) void place(selected, widget.id); }}>
            {placed && <span className={canvasStyles.matchMarker} style={{ backgroundColor: canvasChoiceFill(placed), color: placed.textColor }}>{placed.text}</span>}
          </button>;
        }
        const region = canvasRegionNode(node, widget);
        const part = composite ? draft?.kind === 'image-canvas' ? draft.answers[widget.id] : undefined : draft;
        return <CanvasAnswerRegion key={`${widget.id}:${mode}`} widget={widget} mode={mode}
          node={region} draft={part} disabled={disabled} worksheetId={worksheetId} previewOnly={Boolean(previewOnly)}
          onChange={next => update(widget.id, next)} setBusy={setBusy}>
          {(busy, trigger) => children(region, part, next => update(widget.id, next), busy, trigger)}
        </CanvasAnswerRegion>;
      })}
      {choices.length > 0 && <div role="group" aria-label="配对词语">{choices.map(renderChoice)}</div>}
      {feedback && <div key={feedback.attempt} ref={feedbackRef} className={canvasStyles.matchFeedback}
        data-correct={feedback.correct}
        style={{ top: `${feedback.y}%`, left: `clamp(min(100px, 26%), ${feedback.x}%, max(100% - 100px, 74%))` }}>
        {feedback.correct ? <IconCheck size={16} aria-hidden="true" /> : <IconInfoCircle size={16} aria-hidden="true" />}
        <span aria-hidden="true">{feedback.correct === false && <strong>再试一次</strong>}{feedback.text}</span>
        <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.matchFeedbackClose}`} aria-label="关闭配对提示"
          onClick={() => setFeedback(null)}><IconX size={14} aria-hidden="true" /></button>
      </div>}
    </div>
    {!canvas.widgets.some(widget => widget.kind === 'answer') && node.type !== 'image-canvas' && children(node, draft, onChange)}
  </>;
}

function CanvasAnswerRegion({ widget, mode, node, draft, disabled, worksheetId, previewOnly, onChange, setBusy, children }: {
  widget: CanvasWidget;
  mode: string;
  node: WorksheetQuestionNode;
  draft: AnswerDraft | undefined;
  disabled: boolean;
  worksheetId?: string;
  previewOnly: boolean;
  onChange: (draft: AnswerDraft) => void;
  setBusy: (id: string, busy: boolean) => void;
  children: (busy: (busy: boolean) => void, trigger: RenderCanvasPhotoTrigger) => ReactNode;
}) {
  const busy = useCallback((value: boolean) => setBusy(`region:${widget.id}`, value), [setBusy, widget.id]);
  const ratingDialog = useRef<HTMLDialogElement>(null);
  const [hoveredStars, setHoveredStars] = useState<number | null>(null);
  const review = deskReviewSettings(node);
  const label = widget.label || canvasAnswerLabel(mode, Boolean(review));
  const part = draft ?? emptyDraftFor(node);
  const recording = mode === 'audio' || mode === 'peer-audio';
  const currentStars = part.kind === 'canvas-stars' ? part.stars : 0;

  return <div className={canvasStyles.answerSlot} data-mode={mode} data-recording={recording} style={recording ? canvasRecordingStyle(widget) : canvasWidgetStyle(widget)}>
    {mode === 'star-rating' && <div className={canvasStyles.starChoices} role="group" aria-label={label} onPointerLeave={() => setHoveredStars(null)}>
      {Array.from({ length: widget.maxStars ?? CANVAS_STAR_LIMIT }, (_, index) => {
        const stars = index + 1;
        return <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.starChoice}`} key={stars}
          aria-label={`${stars} 颗星`} aria-pressed={currentStars === stars} disabled={disabled}
          onPointerEnter={event => { if (!disabled && event.pointerType === 'mouse') setHoveredStars(stars); }}
          onClick={() => onChange({ kind: 'canvas-stars', stars, maxStars: widget.maxStars ?? CANVAS_STAR_LIMIT })}>
          <RewardIcon kind="star" state={stars <= ((!disabled && hoveredStars) || currentStars) ? 'earned' : 'empty'} size={28} />
        </button>;
      })}
    </div>}
    {mode === 'keyboard' && <textarea className={canvasStyles.linedInput} aria-label={label}
      placeholder={label} value={part.kind === 'text' ? part.text : ''} disabled={disabled} rows={1}
      onChange={event => onChange({ kind: 'text', text: event.currentTarget.value })} />}
    {mode === 'handwriting' && part.kind === 'ink' && <>
      {widget.label && !disabled && !part.strokes.length && !part.texts?.length &&
        <span className={canvasStyles.inkPrompt} aria-hidden="true">{widget.label}</span>}
      <InkCanvas box={part.box} strokes={part.strokes} texts={part.texts ?? []}
        inlineLabel={label} hint="" disabled={disabled} tool="pen" width={INK_DEFAULT_WIDTH} color={INK_DEFAULT_COLOR}
        textSize={textSizeForWidth(INK_DEFAULT_WIDTH)} selected={null} onSelect={() => {}}
        onChange={next => onChange({ kind: 'ink', ...next })} />
      {!disabled && part.strokes.length > 0 && <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.slotAction}`}
        aria-label="撤销一笔" onClick={() => onChange({ ...part, strokes: part.strokes.slice(0, -1) })}>
        <IconArrowBackUp size={17} aria-hidden="true" />
      </button>}
    </>}
    {mode === 'photo' && children(busy, ({ openCamera, openFile, openPreview, photoUrl, disabled: photoDisabled, uploading, error }) => <>
      <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.photoMain}`}
        aria-label={photoUrl ? `查看照片：${label}` : label} disabled={!photoUrl && (photoDisabled || disabled)}
        onClick={photoUrl ? openPreview : openCamera}>
        {photoUrl ? <img src={photoUrl} alt="作答照片" /> : <><IconCamera size={20} aria-hidden="true" /><span>{uploading ? '正在上传…' : label}</span></>}
      </button>
      {!photoDisabled && !disabled && <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.slotAction}`}
        aria-label={photoUrl ? '更换作答照片' : '从相册选图'} title={photoUrl ? '更换作答照片' : '从相册选图'} onClick={openFile}>
        <IconPhoto size={18} aria-hidden="true" />
      </button>}
      {!photoDisabled && !disabled && photoUrl && <button type="button"
        className={`${styles.imageCanvasButton} ${canvasStyles.photoRemove}`} aria-label="移除作答照片"
        onClick={() => onChange({ kind: 'photo', url: '' })}>移除</button>}
      {error && <p className={canvasStyles.photoError} role="alert">{error}</p>}
    </>)}
    {recording && part.kind === 'audio' && <>
      <div className={canvasStyles.audioSlot} data-rating={Boolean(review && part.url)} role="group" aria-label={label}>
        <AudioBody worksheetId={worksheetId} questionId={node.id} draft={part} disabled={disabled} localOnly={previewOnly}
          compact inlineCanvas promptLabel={widget.label} onChange={onChange} onBusyChange={busy} />
      </div>
      {review && part.url && <>
        <button type="button" className={`${styles.imageCanvasButton} ${canvasStyles.slotAction}`}
          aria-label={CANVAS_STAR_LABEL} onClick={() => ratingDialog.current?.showModal()}>
          <IconStar size={16} aria-hidden="true" />{part.deskRating ? `${part.deskRating.stars} 星` : '评星'}
        </button>
        <dialog ref={ratingDialog} className={canvasStyles.ratingDialog} aria-label={CANVAS_STAR_LABEL}>
          <DeskRatingInput draft={part} settings={review} disabled={disabled} onChange={deskRating => {
            onChange({ ...part, deskRating });
            ratingDialog.current?.close();
          }} />
          <button type="button" className={`btn btn-secondary ${styles.imageCanvasButton}`}
            onClick={() => ratingDialog.current?.close()}>返回任务</button>
        </dialog>
      </>}
    </>}
  </div>;
}
