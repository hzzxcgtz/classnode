'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { IconArrowsMove, IconPhoto, IconPlus, IconResize, IconTrash } from '@tabler/icons-react';
import { api } from '@/lib/api';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import {
  CANVAS_WIDGET_LABELS, CANVAS_WIDGET_LIMIT, canvasAnswerLabel, canvasRectStyle, moveCanvasRect, newCanvasWidget, readImageCanvas,
  resizeCanvasRect, type CanvasRect, type CanvasWidget, type CanvasWidgetKind, type WorksheetImageCanvas,
} from '@/lib/worksheet-image-canvas';
import type { WorksheetQuestionNode } from '@/lib/types';
import styles from './image-canvas-editor.module.css';

type Mode = WorksheetQuestionNode['inputMode'];
const MODES = ['photo', 'audio', 'keyboard', 'handwriting'] as const;
type Drag = { widget: CanvasWidget; x: number; y: number; width: number; height: number; resize: boolean };

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('无法读取上传的底图，请换一张图片。'));
    image.src = worksheetAssetUrl(url);
  });
}

export function ImageCanvasEditor({ node, onChange, onModeChange }: {
  node: WorksheetQuestionNode;
  onChange: (patch: Record<string, unknown>) => void;
  onModeChange: (mode: Mode) => void;
}) {
  const canvas = readImageCanvas(node.data.imageCanvas);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef<CanvasRect | null>(null);
  const currentCanvas = useRef(canvas);
  currentCanvas.current = canvas;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRect, setActiveRect] = useState<CanvasRect | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<CanvasWidgetKind>('label');
  const selected = canvas?.widgets.find(widget => widget.id === selectedId);
  const save = (next: WorksheetImageCanvas) => onChange({ imageCanvas: next });
  const replace = (widget: CanvasWidget) => {
    const current = currentCanvas.current;
    if (current) save({ ...current, widgets: current.widgets.map(item => item.id === widget.id ? widget : item) });
  };

  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      const { url } = await api.uploadWorksheetImage(file);
      const size = await imageSize(url);
      const widgets = currentCanvas.current?.widgets ?? [newCanvasWidget('answer')];
      save({ url, ...size, widgets });
      setSelectedId(widgets.find(widget => widget.kind === 'answer')?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传底图失败，请重试。');
    } finally { setUploading(false); }
  }

  function start(event: PointerEvent<HTMLButtonElement>, widget: CanvasWidget, resize = false) {
    if (uploading || !event.isPrimary || event.button !== 0) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(widget.id);
    drag.current = { widget, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, resize };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = (event.clientX - gesture.x) * 100 / gesture.width;
    const dy = (event.clientY - gesture.y) * 100 / gesture.height;
    live.current = gesture.resize ? resizeCanvasRect(gesture.widget, dx, dy) : moveCanvasRect(gesture.widget, dx, dy);
    setActiveRect(live.current);
  }

  function stop(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const gesture = drag.current;
    const rect = live.current;
    drag.current = null;
    live.current = null;
    setActiveRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && gesture && rect) replace({ ...gesture.widget, ...rect });
  }

  return <section className={styles.editor} aria-label="整图排版">
    <header className={styles.header}>
      <div><h4>整图排版</h4><p>上传排好版的底图，再把控件放到预留位置。底图按原比例显示。</p></div>
      <label className={styles.upload}>
        <IconPhoto size={18} aria-hidden="true" />{uploading ? '正在上传…' : canvas ? '更换底图' : '上传整图'}
        <input aria-label="上传任务底图" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload(file);
        }} />
      </label>
    </header>
    {canvas && <fieldset className={styles.fields} disabled={uploading}>
      <div className={styles.toolbar}>
        <select className="input" value={kind} aria-label="控件类型" onChange={event => setKind(event.target.value as CanvasWidgetKind)}>
          <option value="label">文字标签</option><option value="hint">点击提示</option>
          {!canvas.widgets.some(widget => widget.kind === 'answer') && <option value="answer">作答区</option>}
        </select>
        <button type="button" className="btn btn-primary" disabled={canvas.widgets.length >= CANVAS_WIDGET_LIMIT} onClick={() => {
          if (kind === 'answer' && canvas.widgets.some(widget => widget.kind === 'answer')) return;
          const widget = newCanvasWidget(kind, canvas.widgets.length);
          save({ ...canvas, widgets: [...canvas.widgets, widget] });
          setSelectedId(widget.id);
          if (kind === 'answer') setKind('label');
        }}><IconPlus size={17} aria-hidden="true" />添加控件</button>
        <button type="button" className="btn btn-secondary" onClick={() => {
          if (window.confirm('移除底图和上面的控件？可用编辑器的撤销恢复。')) onChange({ imageCanvas: undefined });
        }}>移除底图</button>
      </div>
      <div ref={stage} className={styles.stage}>
        <img src={worksheetAssetUrl(canvas.url)} width={canvas.width} height={canvas.height} alt="任务底图" draggable={false} />
        {canvas.widgets.map(widget => {
          const active = selectedId === widget.id;
          return <div className={styles.widget} data-selected={active} data-kind={widget.kind} key={widget.id}
            style={canvasRectStyle(active && activeRect ? activeRect : widget)}>
            <button type="button" className={styles.move} aria-pressed={active}
              aria-label={`移动${widget.label || CANVAS_WIDGET_LABELS[widget.kind]}`}
              onClick={() => setSelectedId(widget.id)} onPointerDown={event => start(event, widget)} onPointerMove={move}
              onPointerUp={event => stop(event, true)} onPointerCancel={event => stop(event, false)}
              onLostPointerCapture={event => { if (drag.current) stop(event, false); }}
              onKeyDown={event => {
                const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                if (dx || dy) { event.preventDefault(); replace({ ...widget, ...moveCanvasRect(widget, dx, dy) }); }
              }}>
              <IconArrowsMove size={15} aria-hidden="true" />
              <span>{widget.label || (widget.kind === 'answer' ? canvasAnswerLabel(node.inputMode) : CANVAS_WIDGET_LABELS[widget.kind])}</span>
            </button>
            {active && <button type="button" className={styles.resize} aria-label="调整控件大小"
              onPointerDown={event => start(event, widget, true)} onPointerMove={move}
              onPointerUp={event => stop(event, true)} onPointerCancel={event => stop(event, false)}
              onLostPointerCapture={event => { if (drag.current) stop(event, false); }}
              onKeyDown={event => {
                const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                if (dx || dy) { event.preventDefault(); replace({ ...widget, ...resizeCanvasRect(widget, dx, dy) }); }
              }}><IconResize size={15} aria-hidden="true" /></button>}
          </div>;
        })}
      </div>
      {selected && <div className={styles.properties}>
        <label>控件文字<input className="input" maxLength={100} value={selected.label}
          placeholder={selected.kind === 'answer' ? canvasAnswerLabel(node.inputMode) : CANVAS_WIDGET_LABELS[selected.kind]}
          onChange={event => replace({ ...selected, label: event.target.value })} /></label>
        {selected.kind === 'answer' && <label>作答方式<select className="input" value={node.inputMode} onChange={event => onModeChange(event.target.value as Mode)}>
          {MODES.map(mode => <option value={mode} key={mode}>{canvasAnswerLabel(mode)}</option>)}
        </select></label>}
        {selected.kind === 'hint' && <label>点开后显示<textarea className="input" rows={2} maxLength={600}
          value={selected.detail} onChange={event => replace({ ...selected, detail: event.target.value })} /></label>}
        <button className="btn btn-secondary" type="button" onClick={() => save({ ...canvas, widgets: canvas.widgets.filter(widget => widget.id !== selected.id) })}>
          <IconTrash size={16} aria-hidden="true" />删除控件</button>
      </div>}
      <p>拖动控件可移动位置，拖右下角可调整大小。点击顶栏「预览」检查 iPad 横屏和竖屏。</p>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
