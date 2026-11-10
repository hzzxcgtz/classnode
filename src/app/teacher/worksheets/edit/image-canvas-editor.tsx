'use client';

import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { IconCamera, IconCheck, IconHandClick, IconInfoCircle, IconKeyboard, IconLayersIntersect, IconMicrophone, IconPhoto, IconPhotoUp, IconPuzzle, IconRotate, IconStar, IconTrash, IconTypography, IconWriting, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { EvaluationRequirementsField } from './evaluation-settings';
import { api } from '@/lib/api';
import { prepareWorksheetPhoto } from '@/lib/worksheet-photo-upload';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import {
  CANVAS_LINE_STYLES, CANVAS_MATCH_FEEDBACK, CANVAS_PROPORTIONAL_EDGES, CANVAS_RESIZE_EDGES, CANVAS_STAR_LABEL, CANVAS_STAR_LIMIT, CANVAS_WIDGET_LABELS, CANVAS_WIDGET_LIMIT, canvasAnswerMode, canvasChoiceColor, canvasChoiceFill, canvasRecordingStyle, canvasWidgetStyle, moveCanvasRect,
  canvasMatchChoices, canvasMatchSource, canvasRectStyle, newCanvasWidget, readImageCanvas, resizeCanvasRect, resizeCanvasRectProportionally, type CanvasAnswerMode, type CanvasRect, type CanvasResizeEdge,
  supportsCanvasAiReview, type CanvasWidget, type CanvasWidgetKind, type WorksheetImageCanvas,
} from '@/lib/worksheet-image-canvas';
import type { WorksheetQuestionNode } from '@/lib/types';
import styles from './image-canvas-editor.module.css';
import recordingStyles from '@/app/classroom/worksheet/worksheet.module.css';

const SETTINGS = [{ id: 'content', label: '内容' }, { id: 'appearance', label: '外观' }, { id: 'evaluation', label: '评价' }] as const;
type SettingsPanel = typeof SETTINGS[number]['id'];
type Mode = WorksheetQuestionNode['inputMode'];
const MODES = [
  { value: 'photo', label: '拍照上传', Icon: IconCamera },
  { value: 'audio', label: '语音录入', Icon: IconMicrophone },
  { value: 'keyboard', label: '键盘输入', Icon: IconKeyboard },
  { value: 'handwriting', label: '手写输入', Icon: IconWriting },
  { value: 'star-rating', label: CANVAS_STAR_LABEL, Icon: IconStar },
  { value: 'region-match', label: '拖拽配对', Icon: IconPuzzle },
] as const;
const LINE_LABELS = { solid: '实线', dashed: '虚线', dotted: '点线', double: '双线', none: '无边框' };
const DEFAULT_COLORS = {
  answer: { borderColor: '#91b8a6', backgroundColor: '#edfaf3' },
  label: { borderColor: 'transparent', backgroundColor: '#ffffff' },
  hint: { borderColor: '#8aaac4', backgroundColor: '#f0f7fd' },
};
const MAX_BACKGROUND_BYTES = 300 * 1024;
const RESIZE_LABELS = { nw: '左上', n: '上', ne: '右上', e: '右', se: '右下', s: '下', sw: '左下', w: '左' };
const PALETTE = ['#ffffff', '#f0f7fd', '#edfaf3', '#fff5da', '#ffe6df', '#efe5fa', '#d6e9f8', '#8aaac4',
  '#91b8a6', '#3c729d', '#2c7459', '#ba593e', '#7c53a0', '#24384d'];
type Drag = { widget: CanvasWidget; x: number; y: number; width: number; height: number; edge?: CanvasResizeEdge; source?: CanvasRect };
type NameLocation = 'widget' | 'source' | 'layer';

function makeMatchWidget(widget: CanvasWidget): CanvasWidget {
  const id = newCanvasWidget('answer').id;
  return { ...widget, mode: 'region-match', matchConfig: { id, text: widget.label, ...CANVAS_MATCH_FEEDBACK },
    label: '', borderStyle: 'dashed', backgroundColor: 'transparent' };
}

function newEvaluation(mode: CanvasAnswerMode): CanvasWidget['canvasEvaluation'] {
  return supportsCanvasAiReview(mode) ? { mode: 'ai', criteria: '' } : undefined;
}

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
  const editor = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef<CanvasRect | null>(null);
  const currentCanvas = useRef(canvas);
  currentCanvas.current = canvas;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<{ id: string; location: NameLocation } | null>(null);
  const [activeRect, setActiveRect] = useState<CanvasRect | null>(null);
  const [largeFile, setLargeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);
  const [settings, setSettings] = useState<SettingsPanel>('content');
  const selected = canvas?.widgets.find(widget => widget.id === selectedId);
  const selectedMode = selected?.kind === 'answer' ? canvasAnswerMode(node, selected) : undefined;
  const canEvaluate = selectedMode !== undefined && supportsCanvasAiReview(selectedMode);
  const collectOnly = selectedMode === 'star-rating' || selectedMode === 'region-match';
  const panel = !canEvaluate && settings === 'evaluation' ? 'content' : settings;
  const widgetCount = canvas?.widgets.length ?? 0;
  const atLimit = widgetCount >= CANVAS_WIDGET_LIMIT;
  const modeOption = (widget: CanvasWidget) => MODES.find(mode => mode.value === canvasAnswerMode(node, widget));
  const widgetTypeName = (widget: CanvasWidget) => widget.mode === 'peer-audio' ? '同桌录音与评星（旧版）'
    : widget.kind === 'answer' ? modeOption(widget)?.label ?? '作答区' : CANVAS_WIDGET_LABELS[widget.kind];
  const matchRegions = canvas?.widgets.filter(widget => widget.mode === 'region-match') ?? [];
  const matchChoices = canvas ? canvasMatchChoices(canvas) : [];
  const widgetName = (widget: CanvasWidget) => widget.matchConfig?.text.trim() || widget.label.trim() || widgetTypeName(widget);
  const matchNumber = (widget: CanvasWidget) => matchRegions.findIndex(region => region.id === widget.id) + 1;
  const widgetIcon = (widget: CanvasWidget) => widget.kind === 'answer' ? modeOption(widget)?.Icon ?? IconKeyboard
    : widget.kind === 'hint' ? IconInfoCircle : IconTypography;

  useLayoutEffect(() => {
    const pane = viewport.current;
    if (!pane) return;
    const center = () => { pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) / 2; };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [zoom, canvas?.url]);

  function selectWidget(id: string | null) {
    setSelectedId(id);
    if (id && !editor.current?.contains(document.activeElement)) editor.current?.focus({ preventScroll: true });
  }
  const save = (next: WorksheetImageCanvas) => onChange({ imageCanvas: next });
  const replace = (widget: CanvasWidget) => {
    const current = currentCanvas.current;
    if (current) save({ ...current, widgets: current.widgets.map(item => item.id === widget.id ? widget : item) });
  };

  function editName(widget: CanvasWidget, location: NameLocation) {
    selectWidget(widget.id);
    setNameEdit({ id: widget.id, location });
  }

  function nameInput(widget: CanvasWidget, location: NameLocation) {
    if (nameEdit?.id !== widget.id || nameEdit.location !== location) return null;
    const matching = widget.mode === 'region-match';
    return <input className={`${styles.nameInput} ${location === 'source' ? styles.sourceName : ''}`}
      aria-label={matching ? '修改配对词语' : '修改控件文字'} maxLength={100}
      defaultValue={matching ? widget.matchConfig?.text : widget.label}
      placeholder={matching ? '配对词语' : widgetTypeName(widget)}
      ref={input => { if (input && document.activeElement !== input) { input.focus({ preventScroll: true }); input.select(); } }}
      onBlur={event => {
        setNameEdit(null);
        const current = currentCanvas.current?.widgets.find(item => item.id === widget.id);
        if (!current) return;
        const text = event.currentTarget.value;
        if (current.mode === 'region-match' && current.matchConfig) {
          if (current.matchConfig.text !== text) replace({ ...current, matchConfig: { ...current.matchConfig, text } });
        } else if (current.label !== text) replace({ ...current, label: text });
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
        event.stopPropagation();
        event.preventDefault();
        if (event.key === 'Escape') setNameEdit(null);
        else event.currentTarget.blur();
      }} />;
  }

  function changeEvaluationImages(id: string, update: (images: string[]) => string[]) {
    const widget = currentCanvas.current?.widgets.find(item => item.id === id);
    if (!widget || !supportsCanvasAiReview(canvasAnswerMode(node, widget))) return;
    const evaluation = widget.canvasEvaluation;
    replace({ ...widget, canvasEvaluation: { ...evaluation, mode: 'ai', criteria: evaluation?.criteria ?? '',
      evaluationImages: update(evaluation?.evaluationImages ?? []) } });
  }

  function addWidget(kind: CanvasWidgetKind, mode?: CanvasAnswerMode) {
    if (!canvas || atLimit) return;
    const base = { ...newCanvasWidget(kind, canvas.widgets.length), ...(mode ? { mode, canvasEvaluation: newEvaluation(mode) } : {}) };
    const widget = mode === 'region-match' ? makeMatchWidget(base) : base;
    if (audioRegion(widget)) widget.height = Math.min(16, Math.max(5, widget.width * canvas.width / (canvas.height * 4.2)));
    save({ ...canvas, widgets: [...canvas.widgets, widget] });
    selectWidget(widget.id);
    if (mode && supportsCanvasAiReview(mode)) setSettings('evaluation');
  }

  function removeWidget(id: string) {
    if (!canvas) return;
    save({ ...canvas, widgets: canvas.widgets.filter(widget => widget.id !== id) });
    if (selectedId === id) selectWidget(null);
  }

  async function upload(file: File, compress = false) {
    setUploading(true);
    setError('');
    try {
      const image = compress ? await prepareWorksheetPhoto(file, MAX_BACKGROUND_BYTES) : file;
      if (image.size > MAX_BACKGROUND_BYTES) throw new Error('无法把这张底图压缩到 300 KB，请换一张图片。');
      const { url } = await api.uploadWorksheetImage(image);
      const size = await imageSize(url);
      const previous = currentCanvas.current;
      const widgets = previous?.widgets ?? [];
      save({ ...previous, url, ...size, widgets });
      selectWidget(widgets.some(widget => widget.id === selectedId) ? selectedId : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传底图失败，请重试。');
    } finally { setUploading(false); }
  }

  function audioRegion(widget: CanvasWidget) {
    const mode = canvasAnswerMode(node, widget);
    return widget.kind === 'answer' && (mode === 'audio' || mode === 'peer-audio');
  }

  function resize(widget: CanvasWidget, dx: number, dy: number, edge: CanvasResizeEdge) {
    return audioRegion(widget) ? resizeCanvasRectProportionally(widget, dx, dy, edge) : resizeCanvasRect(widget, dx, dy, edge);
  }

  function start(event: PointerEvent<HTMLButtonElement>, widget: CanvasWidget, edge?: CanvasResizeEdge, source?: CanvasRect) {
    if (uploading || !event.isPrimary || event.button !== 0) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectWidget(widget.id);
    drag.current = { widget, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, edge, source };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = (event.clientX - gesture.x) * 100 / gesture.width;
    const dy = (event.clientY - gesture.y) * 100 / gesture.height;
    live.current = gesture.edge ? resize(gesture.widget, dx, dy, gesture.edge) : moveCanvasRect(gesture.source ?? gesture.widget, dx, dy);
    setActiveRect(live.current);
  }

  function stop(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const gesture = drag.current;
    const rect = live.current;
    drag.current = null;
    live.current = null;
    setActiveRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && gesture && rect) {
      if (gesture.source && gesture.widget.matchConfig) {
        replace({ ...gesture.widget, matchConfig: { ...gesture.widget.matchConfig, source: rect } });
      } else replace({ ...gesture.widget, ...rect });
    }
  }

  const uploadControl = <label className={`${styles.upload} ${!canvas ? styles.uploadPrimary : ''}`} data-busy={uploading}>
    <IconPhotoUp size={17} aria-hidden="true" />{uploading ? '正在上传…' : canvas ? '更换底图' : '上传底图'}
    <input aria-label="上传任务底图" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || Boolean(largeFile)} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      setError('');
      if (file.size > MAX_BACKGROUND_BYTES) setLargeFile(file);
      else void upload(file);
    }} />
  </label>;

  return <section ref={editor} tabIndex={-1} className={styles.editor} aria-label="图文题排版" onKeyDown={event => {
    if (event.key === 'Escape') {
      if (largeFile) { event.stopPropagation(); setLargeFile(null); }
      else if (selectedId) { event.stopPropagation(); selectWidget(null); }
      return;
    }
    if (!selected || uploading || largeFile || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing
      || event.ctrlKey || event.altKey || event.metaKey || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    event.preventDefault();
    event.stopPropagation();
    removeWidget(selected.id);
  }}>
    <header className={styles.header}>
      <div className={styles.editorHeading}>
        <span className={styles.editorMark}><IconLayersIntersect size={21} stroke={1.7} aria-hidden="true" /></span>
        <div><h4>图文题排版</h4><p>在底图上安排作答区、文字和提示</p></div>
      </div>
      {canvas && <div className={styles.fileActions}>
        {uploadControl}
        <button type="button" className={styles.iconButton} title="移除底图" aria-label="移除底图" disabled={uploading || Boolean(largeFile)} onClick={() => {
          if (window.confirm('移除底图和上面的控件？可用编辑器的撤销恢复。')) {
            onChange({ imageCanvas: undefined });
            selectWidget(null);
            setZoom(100);
          }
        }}><IconTrash size={17} aria-hidden="true" /></button>
      </div>}
    </header>
    {largeFile && <div className={styles.uploadPrompt} role="group" aria-label="底图压缩确认">
      <div role="status"><strong>这张底图超过 300 KB</strong>
        <p>原图约 {Math.ceil(largeFile.size / 1024).toLocaleString()} KB，是否压缩后上传？</p></div>
      <div className={styles.promptActions}>
        <button type="button" className="btn btn-secondary" onClick={() => setLargeFile(null)}>取消上传</button>
        <button type="button" className="btn btn-primary" onClick={() => { setLargeFile(null); void upload(largeFile, true); }}>自动压缩并上传</button>
      </div>
    </div>}
    {!canvas && <div className={styles.emptyCanvas}>
      <IconPhoto size={34} stroke={1.5} aria-hidden="true" />
      <strong>先上传一张任务底图</strong>
      <p>选择 PNG、JPEG 或 WebP 图片。上传后可在图上添加作答区。</p>
      {uploadControl}
    </div>}
    {canvas && <fieldset className={styles.fields} disabled={uploading || Boolean(largeFile)}>
      <div className={styles.toolbar}>
        <div className={styles.toolGroup} role="group" aria-label="添加作答区">
          <span className={styles.groupLabel}>添加作答区</span>
          {MODES.map(({ value, label, Icon }) => <button type="button" className={styles.tool} key={value}
            disabled={atLimit} onClick={() => addWidget('answer', value)}>
            <Icon size={17} stroke={1.7} aria-hidden="true" />{label}
          </button>)}
        </div>
        <div className={styles.toolGroup} role="group" aria-label="其他控件">
          <span className={styles.groupLabel}>辅助控件</span>
          <button type="button" className={styles.tool} disabled={atLimit} onClick={() => addWidget('label')}>
            <IconTypography size={17} stroke={1.7} aria-hidden="true" />文字标签
          </button>
        </div>
      </div>
      <div className={styles.workspace}>
        <div className={styles.canvasPane}>
          <div className={styles.canvasHeader}>
            <div className={styles.canvasTitle}><strong>底图</strong><span>{canvas.width} × {canvas.height} 像素</span></div>
            <div className={styles.zoom} role="group" aria-label="画布缩放">
              <button type="button" className={styles.iconButton} aria-label="缩小底图" title="缩小底图" disabled={zoom === 50}
                onClick={() => setZoom(zoom - 25)}><IconZoomOut size={17} aria-hidden="true" /></button>
              <button type="button" className={styles.zoomValue} aria-label="恢复适合窗口" title="恢复适合窗口"
                onClick={() => setZoom(100)}>{zoom}%</button>
              <button type="button" className={styles.iconButton} aria-label="放大底图" title="放大底图" disabled={zoom === 200}
                onClick={() => setZoom(zoom + 25)}><IconZoomIn size={17} aria-hidden="true" /></button>
            </div>
          </div>
          <div ref={viewport} className={styles.viewport} onClick={event => {
            if (event.target === event.currentTarget) selectWidget(null);
          }}>
            <div className={styles.fit} style={{ width: `${zoom}%`, maxWidth: Math.min(720, 460 * canvas.width / canvas.height) * zoom / 100 }}>
              <div ref={stage} className={styles.stage}>
                <img src={worksheetAssetUrl(canvas.url)} width={canvas.width} height={canvas.height} alt="任务底图" draggable={false} onClick={() => selectWidget(null)} />
                {canvas.widgets.map(widget => {
                  const active = selectedId === widget.id;
                  const Icon = widgetIcon(widget);
                  const recording = audioRegion(widget);
                  const rect = active && activeRect && !drag.current?.source ? activeRect : widget;
                  return <div className={styles.widget} data-selected={active} data-kind={widget.kind} data-mode={widget.mode}
                    data-recording={recording} key={widget.id}
                    style={recording ? canvasRecordingStyle(widget, rect) : canvasWidgetStyle(widget, rect)}>
                    {nameInput(widget, 'widget') ?? <button type="button" className={styles.move} aria-pressed={active}
                      aria-label={`移动${widget.label || CANVAS_WIDGET_LABELS[widget.kind]}`}
                      onDoubleClick={() => editName(widget, 'widget')}
                      onFocus={() => selectWidget(widget.id)} onClick={() => selectWidget(widget.id)} onPointerDown={event => start(event, widget)} onPointerMove={move}
                      onPointerUp={event => stop(event, true)} onPointerCancel={event => stop(event, false)}
                      onLostPointerCapture={event => { if (drag.current) stop(event, false); }}
                      onKeyDown={event => {
                        const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                        const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                        if (dx || dy) { event.preventDefault(); replace({ ...widget, ...moveCanvasRect(widget, dx, dy) }); }
                      }}>
                      {widget.mode === 'star-rating' ? Array.from({ length: widget.maxStars ?? CANVAS_STAR_LIMIT }, (_, i) => <RewardIcon key={i} kind="star" size={22} />)
                        : recording ? <span className={recordingStyles.canvasVoiceButtons} aria-hidden="true">
                        <span className={recordingStyles.canvasVoiceMain}><IconMicrophone size={17} /><span>{widget.label || '按住录音'}</span></span>
                        <span className={recordingStyles.canvasVoiceSwitch} title="切换为点按录音"><IconHandClick size={16} /></span>
                      </span> : <>
                        {widget.kind !== 'label' && <Icon size={17} stroke={1.7} aria-hidden="true" />}
                        <span>{widget.mode === 'region-match' ? `区域 ${matchNumber(widget)}${widget.matchConfig?.text ? ` · ${widget.matchConfig.text}` : ''}` : widgetName(widget)}</span>
                      </>}
                    </button>}
                    {active && (recording ? CANVAS_PROPORTIONAL_EDGES : CANVAS_RESIZE_EDGES).map(edge => <button key={edge} type="button" className={styles.resize} data-edge={edge}
                      aria-label={`从${RESIZE_LABELS[edge]}调整控件大小`}
                      onPointerDown={event => start(event, widget, edge)} onPointerMove={move}
                      onPointerUp={event => stop(event, true)} onPointerCancel={event => stop(event, false)}
                      onLostPointerCapture={event => { if (drag.current) stop(event, false); }}
                      onKeyDown={event => {
                        const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                        const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                        if (dx || dy) { event.preventDefault(); replace({ ...widget, ...resize(widget, dx, dy, edge) }); }
                      }} />)}
                  </div>;
                })}
                {matchChoices.map((choice, index) => {
                  const widget = matchRegions.find(region => region.matchConfig?.id === choice.id);
                  if (!widget?.matchConfig) return null;
                  const source = canvasMatchSource(choice, index);
                  const moving = drag.current?.source && drag.current.widget.id === widget.id;
                  const input = nameInput(widget, 'source');
                  if (input) return <div key={choice.id} className={styles.matchSource} style={canvasRectStyle(source)}>{input}</div>;
                  return <button type="button" key={choice.id} className={styles.matchSource}
                    style={canvasRectStyle(moving && activeRect ? activeRect : source)}
                    aria-label={`移动候选词 ${choice.text}`} aria-pressed={selectedId === widget.id}
                    onDoubleClick={() => editName(widget, 'source')}
                    onFocus={() => selectWidget(widget.id)} onPointerDown={event => start(event, widget, undefined, source)}
                    onPointerMove={move} onPointerUp={event => stop(event, true)}
                    onPointerCancel={event => stop(event, false)} onLostPointerCapture={event => { if (drag.current) stop(event, false); }}
                    onKeyDown={event => {
                      const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                      const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                      if (dx || dy) {
                        event.preventDefault();
                        replace({ ...widget, matchConfig: { ...widget.matchConfig!, source: moveCanvasRect(source, dx, dy) } });
                      }
                    }}><span style={{ backgroundColor: canvasChoiceFill(choice), color: choice.textColor }}>{choice.text}</span></button>;
                })}
              </div>
            </div>
          </div>
          <p className={styles.canvasFooter}>拖动控件调整位置，拖控点调整大小，双击修改文字。</p>
        </div>
        <aside className={styles.inspector} aria-label="控件设置">
          <div className={styles.inspectorHeader}>
            <h5>控件列表</h5>
            <span className={styles.count} aria-live="polite">{widgetCount} / {CANVAS_WIDGET_LIMIT}</span>
          </div>
          {canvas.widgets.length > 0 ? <ul className={styles.layers}>
            {canvas.widgets.map(widget => {
              const Icon = widgetIcon(widget);
              return <li key={widget.id}>
                {nameInput(widget, 'layer') ?? <button type="button" className={styles.layer} aria-pressed={selectedId === widget.id} onClick={() => selectWidget(widget.id)}
                  onDoubleClick={() => editName(widget, 'layer')}>
                  <Icon size={16} stroke={1.7} aria-hidden="true" />
                  <span>{widgetTypeName(widget)}{widgetName(widget) !== widgetTypeName(widget) ? ` · ${widgetName(widget)}` : ''}</span>
                </button>}
              </li>;
            })}
          </ul> : <div className={styles.emptyInspector}>
            <IconLayersIntersect size={22} stroke={1.6} aria-hidden="true" />
            <strong>还没有控件</strong>
            <p>从上方添加作答区或辅助控件。</p>
          </div>}
          {selected ? <div className={styles.properties}>
            <div className={styles.settingsHeading}>
              <h5>控件设置</h5>
              <div className={styles.settingsActions}>
                <button type="button" className={`${styles.iconButton} ${styles.delete}`} aria-label="删除选中控件" title="删除选中控件（Delete）" onClick={() => removeWidget(selected.id)}>
                  <IconTrash size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.settingsTabs} role="group" aria-label="控件设置分类">
              {SETTINGS.filter(item => item.id !== 'evaluation' || canEvaluate).map(item =>
                <button type="button" key={item.id} aria-pressed={panel === item.id} onClick={() => setSettings(item.id)}>{item.label}</button>)}
            </div>
            <div className={styles.settingsBody}>
              {panel === 'content' && <>
                {selected.mode !== 'region-match' && <label className={styles.propertyField}>控件文字<input className="input" maxLength={100} value={selected.label}
                  placeholder={widgetTypeName(selected)}
                  onChange={event => replace({ ...selected, label: event.target.value })} /></label>}
                {selected.kind === 'answer' && <label className={styles.propertyField}>作答方式
                  <select className="input" aria-label="作答方式" value={canvasAnswerMode(node, selected)} onChange={event => {
                    const mode = event.target.value as CanvasAnswerMode;
                    if (mode === 'region-match') replace(makeMatchWidget(selected));
                    else if (mode === 'star-rating') replace({ ...selected, mode, maxStars: selected.deskReview?.maxStars ?? CANVAS_STAR_LIMIT,
                      label: selected.matchConfig?.text ?? selected.label });
                    else if (mode === 'peer-audio' || selected.mode) replace({ ...selected, mode, label: selected.matchConfig?.text ?? selected.label,
                      canvasEvaluation: selected.canvasEvaluation?.mode === 'ai' ? selected.canvasEvaluation : newEvaluation(mode) });
                    else {
                      onModeChange(mode);
                      replace({ ...selected, canvasEvaluation: selected.canvasEvaluation?.mode === 'ai' ? selected.canvasEvaluation : newEvaluation(mode) });
                    }
                  }}>
                    {selected.mode === 'peer-audio' && <option value="peer-audio">同桌录音与评星（旧版）</option>}
                    {MODES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>}
                {collectOnly && <p className={styles.matchHelp}>记录全班作答，供教师查看和分析。</p>}
                {selected.mode === 'region-match' && selected.matchConfig && <>
                  <p className={styles.matchHelp}>拖动底图上的词语设置起点，拖动区域 {matchNumber(selected)} 设置正确目标。</p>
                  <label className={styles.propertyField}>配对词语
                    <input className="input" maxLength={100} value={selected.matchConfig.text} placeholder="例如：珊瑚"
                      onChange={event => replace({ ...selected, matchConfig: { ...selected.matchConfig!, text: event.target.value } })} />
                  </label>
                  <label className={styles.propertyField}>区域形状
                    <select className="input" value={selected.matchShape ?? 'rectangle'}
                      onChange={event => replace({ ...selected, matchShape: event.target.value === 'ellipse' ? 'ellipse' : 'rectangle' })}>
                      <option value="rectangle">矩形</option><option value="ellipse">椭圆</option>
                    </select>
                  </label>
                  {(['correct', 'incorrect'] as const).map(outcome =>
                    <MatchFeedbackField key={`${selected.id}:${outcome}`} outcome={outcome} value={selected.matchConfig![outcome]}
                      onChange={value => replace({ ...selected, matchConfig: { ...selected.matchConfig!, [outcome]: value } })} />)}
                </>}
                {selected.mode === 'star-rating' && <label className={styles.propertyField}>最多几颗星
                  <select className="input" value={selected.maxStars ?? CANVAS_STAR_LIMIT}
                    onChange={event => replace({ ...selected, maxStars: Number(event.target.value) })}>
                    {Array.from({ length: CANVAS_STAR_LIMIT }, (_, i) => <option key={i} value={i + 1}>{i + 1} 颗星</option>)}
                  </select>
                </label>}
                {audioRegion(selected) && <p className={styles.matchHelp}>录音区可从四角等比例缩放。</p>}
                {selected.mode === 'peer-audio' && <>
                  <button type="button" className="btn btn-secondary" onClick={() => replace({ ...selected,
                    mode: 'star-rating', maxStars: selected.deskReview?.maxStars ?? 3,
                  })}>改用星级评价</button>
                  <label className={styles.propertyField}>评星上限
                    <select className="input" value={selected.deskReview?.maxStars ?? 3}
                      onChange={event => replace({ ...selected, deskReview: {
                        maxStars: event.target.value === '5' ? 5 : 3, instruction: selected.deskReview?.instruction ?? '',
                      } })}>
                      <option value={3}>三星评价</option><option value={5}>五星评价</option>
                    </select>
                  </label>
                  <label className={styles.propertyField}>评星提示<textarea className="input" rows={2} maxLength={600}
                    value={selected.deskReview?.instruction ?? ''} onChange={event => replace({ ...selected,
                      deskReview: { maxStars: selected.deskReview?.maxStars ?? 3, instruction: event.target.value },
                    })} /></label>
                </>}
                {selected.kind === 'hint' && <label className={styles.propertyField}>点开后显示<textarea className="input" rows={2} maxLength={600}
                  value={selected.detail} onChange={event => replace({ ...selected, detail: event.target.value })} /></label>}
              </>}
              {panel === 'evaluation' && <>
                <EvaluationRequirementsField key={selected.id} label="本区 AI 评价要求"
                  exampleMode={selectedMode === 'photo' || selectedMode === 'audio' || selectedMode === 'handwriting' ? selectedMode : 'keyboard'}
                  images={selected.canvasEvaluation?.evaluationImages ?? []}
                  onImagesUploaded={urls => changeEvaluationImages(selected.id, images => [...new Set([...images, ...urls])].slice(0, 6))}
                  onRemove={url => changeEvaluationImages(selected.id, images => images.filter(image => image !== url))}>
                  {id => <textarea id={id} className="input" rows={4} maxLength={4000} aria-required="true"
                    value={selected.canvasEvaluation?.mode === 'ai' ? selected.canvasEvaluation.criteria : ''}
                    placeholder="写下希望 AI 关注本区作答的哪些表现。"
                    onChange={event => replace({ ...selected, canvasEvaluation: {
                      ...selected.canvasEvaluation, mode: 'ai', criteria: event.target.value,
                    } })} />}
                </EvaluationRequirementsField>
                {node.type === 'image-canvas' && <p className={styles.matchHelp}>
                  学生提交整题后，AI 按各区标准评价，结果统一显示在题目下方。请在学习单设置中选择分析智能体。
                </p>}
              </>}
              {panel === 'appearance' && <CanvasAppearance widget={selected}
                recording={audioRegion(selected)} onChange={replace} />}
            </div>
          </div> : widgetCount > 0 && <p className={styles.selectHint}>选中一个控件即可编辑。</p>}
        </aside>
      </div>
    </fieldset>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}

function MatchFeedbackField({ outcome, value, onChange }: {
  outcome: keyof typeof CANVAS_MATCH_FEEDBACK;
  value: string;
  onChange: (value: string) => void;
}) {
  const [editingEmpty, setEditingEmpty] = useState(false);
  return <label className={styles.propertyField}>
    {outcome === 'correct' ? '拖对时的反馈' : '拖错时的反馈'}
    <textarea className="input" rows={2} maxLength={600}
      value={editingEmpty || value.trim() ? value : CANVAS_MATCH_FEEDBACK[outcome]}
      onChange={event => {
        const next = event.target.value;
        setEditingEmpty(!next.trim());
        onChange(next);
      }}
      onBlur={() => setEditingEmpty(false)} />
  </label>;
}

function AppearanceColor({ name, current, transparent = true, onChange }: {
  name: string;
  current: string;
  transparent?: boolean;
  onChange: (color: string) => void;
}) {
  const selected = current.toLowerCase();
  const swatches = [...new Set([...(transparent ? ['transparent'] : []), ...PALETTE, selected])];
  return <>
    <div className={styles.colorSummary}>
      <strong>{name}</strong>
      <label className={styles.colorPicker}>
        <span data-transparent={selected === 'transparent'} style={{ backgroundColor: selected }} aria-hidden="true" />
        {selected === 'transparent' ? '透明' : selected.toUpperCase()}
        <input type="color" aria-label={`自定义${name}`} value={selected === 'transparent' ? '#8aaac4' : selected}
          onChange={event => onChange(event.target.value)} />
      </label>
    </div>
    <div className={styles.palette} role="group" aria-label={name}>
      {swatches.map(swatch => <button key={swatch} type="button" data-transparent={swatch === 'transparent'} style={{ backgroundColor: swatch }}
        aria-label={swatch === 'transparent' ? '透明' : swatch} aria-pressed={selected === swatch}
        onClick={() => onChange(swatch)}>
        {selected === swatch && <IconCheck size={12} stroke={2.5} aria-hidden="true" />}
      </button>)}
    </div>
  </>;
}

function CanvasAppearance({ widget, recording, onChange }: {
  widget: CanvasWidget;
  recording: boolean;
  onChange: (widget: CanvasWidget) => void;
}) {
  const candidate = widget.matchConfig;
  const defaults = recording ? { borderColor: '#b9d2c4', backgroundColor: '#edf5f0' } : DEFAULT_COLORS[widget.kind];
  const border = widget.borderColor ?? defaults.borderColor;
  const fill = candidate ? canvasChoiceColor(candidate) : widget.backgroundColor ?? defaults.backgroundColor;
  const text = widget.textColor ?? (recording ? '#365e4d' : candidate ? '#244d71' : '#193852');
  const line = widget.borderStyle ?? 'solid';
  const changed = Boolean(widget.borderStyle || widget.borderColor || widget.backgroundColor || widget.textColor || candidate?.color);
  return <div className={styles.appearance}>
    <div className={styles.appearanceHead}>
      <strong>控件样式</strong>
      <button type="button" className={styles.resetStyle} disabled={!changed} onClick={() => onChange({
        ...widget, borderColor: undefined, backgroundColor: undefined, borderStyle: undefined, textColor: undefined,
        ...(candidate ? { matchConfig: { ...candidate, color: undefined } } : {}),
      })}><IconRotate size={14} aria-hidden="true" />恢复默认</button>
    </div>
    <div className={styles.appearanceSection}>
      <AppearanceColor name="文字" current={text} transparent={false} onChange={color => onChange({ ...widget, textColor: color })} />
    </div>
    <div className={styles.appearanceSection}>
      <AppearanceColor name="框色" current={border} onChange={color => onChange({ ...widget, borderColor: color })} />
    </div>
    <div className={styles.appearanceSection}>
      <AppearanceColor name="底色" current={fill} onChange={color => onChange(candidate
        ? { ...widget, matchConfig: { ...candidate, color } }
        : { ...widget, backgroundColor: color })} />
    </div>
    <div className={styles.appearanceSection}>
      <div className={styles.colorSummary}><strong>框线</strong></div>
      <div className={styles.lineStyles} role="group" aria-label="框线线型">
        {CANVAS_LINE_STYLES.map(style => <button type="button" key={style} aria-pressed={line === style}
          onClick={() => onChange({ ...widget, borderStyle: style })}>
          <i data-line={style} aria-hidden="true" />{LINE_LABELS[style]}
        </button>)}
      </div>
    </div>
  </div>;
}
