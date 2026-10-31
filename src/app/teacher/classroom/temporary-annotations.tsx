'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { annotationHit, annotationPath, imageAnnotationPoint, type AnnotationPoint, type AnnotationStroke } from '@/lib/temporary-annotations';
import styles from './temporary-annotations.module.css';
import { readImageAnnotations, writeImageAnnotations } from '@/lib/image-annotation-session';

const COLORS = [{name:'红色',value:'#ef4444'},{name:'蓝色',value:'#2563eb'},{name:'绿色',value:'#16a34a'},{name:'黄色',value:'#eab308'}];
export type Tool = 'pen' | 'highlight' | 'eraser';

export interface AnnotationImageView {
  zoom: number; coordinateScale?: number; offset: AnnotationPoint; angle: number;
  onZoom: (change: number) => void; onPan: (offset: AnnotationPoint) => void; onFit: () => void;
}
/** Text strokes are disposable; image strokes can be restored by their image key. */
export function TemporaryAnnotations({ toolbarHost, imageView, annotationKey, frame, onChange, shared, hideToolbar = false }: { shared?: {tool: Tool; color: string; thick?: boolean; width?: number; visible: boolean; moving: boolean; clear: number}; hideToolbar?: boolean; toolbarHost: HTMLElement | null; imageView?: AnnotationImageView; annotationKey?: string; frame?: {width: number; height: number}; onChange?: (strokes: AnnotationStroke[]) => void }) {
  const [panel, setPanel] = useState<'settings' | null>(null);
  const floating = useRef<HTMLElement>(null);
  const [localMoving, setMoving] = useState(false);
  const [size, setSize] = useState({width: 0, height: 0});
  const pan = useRef<{pointer: number; x: number; y: number; offset: AnnotationPoint} | null>(null);
  const [localTool, setTool] = useState<Tool>('pen');
  const [localColor, setColor] = useState(COLORS[0].value);
  const [localThick, setThick] = useState(false);
  const [localVisible, setVisible] = useState(true);
  const moving = shared?.moving ?? localMoving;
  const tool = shared?.tool ?? localTool;
  const color = shared?.color ?? localColor;
  const thick = shared?.thick ?? localThick;
  const visible = shared?.visible ?? localVisible;
  const clearCommand = shared?.clear ?? 0;
  const lastClear = useRef(clearCommand);
  useEffect(() => { if (lastClear.current !== clearCommand) { lastClear.current = clearCommand; setStrokes([]); setPast([]); } }, [clearCommand]);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>(() => annotationKey ? readImageAnnotations(annotationKey) : []);
  const [active, setActive] = useState<AnnotationStroke | null>(null);
  const [past, setPast] = useState<AnnotationStroke[][]>([]);
  const current = useRef(strokes); current.current = strokes;
  const gesture = useRef<{ pointer: number; before: AnnotationStroke[]; stroke: AnnotationStroke | null } | null>(null);
  const nextId = useRef(strokes.reduce((max, stroke) => Math.max(max, stroke.id), 0));
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => {
    if (annotationKey) writeImageAnnotations(annotationKey, strokes);
    change.current?.(strokes);
  }, [annotationKey, strokes]);
  const coordinateZoom = imageView ? imageView.zoom * (imageView.coordinateScale ?? 1) : 1;
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef(imageView); viewRef.current = imageView;
  const isImage = !!imageView;
  useLayoutEffect(() => {
    if (!svg.current) return;
    const element = svg.current;
    const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!isImage || !svg.current) return;
    const element = svg.current;
    const wheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); viewRef.current?.onZoom(event.deltaY > 0 ? -.12 : .12); };
    element.addEventListener('wheel', wheel, {passive: false});
    return () => element.removeEventListener('wheel', wheel);
  }, [isImage]);
  useEffect(() => {
    if (!panel) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !floating.current?.contains(event.target)) setPanel(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [panel]);
  const remember = (before: AnnotationStroke[]) => setPast(previous => [...previous.slice(-49), before]);
  const pointOf = (event: PointerEvent<SVGSVGElement>): AnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) * (frame ? frame.width / rect.width : 1), y: (event.clientY - rect.top) * (frame ? frame.height / rect.height : 1) };
    return imageView ? imageAnnotationPoint(point, {x: rect.width / 2 + imageView.offset.x, y: rect.height / 2 + imageView.offset.y}, coordinateZoom, imageView.angle) : point;
  };
  const erase = (point: AnnotationPoint) => {
    const before = current.current;
    const hit = [...before].reverse().find(stroke => annotationHit(stroke, point, 10 / coordinateZoom));
    if (!hit) return;
    const after = before.filter(stroke => stroke.id !== hit.id);
    current.current = after; setStrokes(after);
  };
  const finish = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    if (pan.current?.pointer === event.pointerId) {
      if (cancelled) imageView?.onPan(pan.current.offset);
      pan.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const drawing = gesture.current;
    if (!drawing || drawing.pointer !== event.pointerId) return;
    gesture.current = null;
    if (cancelled) { current.current = drawing.before; setStrokes(drawing.before); }
    else if (drawing.stroke) {
      remember(drawing.before);
      const after = [...drawing.before, drawing.stroke]; current.current = after; setStrokes(after);
    } else if (current.current !== drawing.before) remember(drawing.before);
    setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const undo = () => {
    if (!past.length) return;
    const before = past[past.length - 1]; current.current = before; setStrokes(before); setPast(past.slice(0,-1));
  };
  return <>
    <svg ref={svg} viewBox={frame ? `0 0 ${frame.width} ${frame.height}` : undefined} preserveAspectRatio="none" className={styles.canvas} aria-label="临时批注画布" role="img" data-tool={moving ? 'move' : tool}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || gesture.current) return;
        event.preventDefault(); event.stopPropagation();
        if (moving && !imageView) return;
        if (moving && imageView) {
          pan.current = {pointer: event.pointerId, x: event.clientX, y: event.clientY, offset: imageView.offset};
          event.currentTarget.setPointerCapture(event.pointerId); return;
        }
        setVisible(true);
        const point = pointOf(event);
        const stroke: AnnotationStroke | null = tool === 'eraser' ? null : {
          id: ++nextId.current, tool, color, width: (shared?.width !== undefined ? shared.width * (tool === 'highlight' ? 4 : 1) : (tool === 'highlight' ? (thick ? 28 : 16) : (thick ? 6 : 3))) / coordinateZoom, points: [point],
        };
        gesture.current = { pointer: event.pointerId, before: current.current, stroke };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (stroke) setActive(stroke); else erase(point);
      }}
      onPointerMove={event => {
        const panning = pan.current;
        if (panning && panning.pointer === event.pointerId) {
          event.preventDefault(); imageView?.onPan({x: panning.offset.x + event.clientX - panning.x, y: panning.offset.y + event.clientY - panning.y}); return;
        }
        const drawing = gesture.current;
        if (!drawing || drawing.pointer !== event.pointerId) return;
        event.preventDefault();
        const point = pointOf(event);
        if (!drawing.stroke) { erase(point); return; }
        const points = drawing.stroke.points, last = points[points.length - 1];
        if (Math.hypot(point.x-last.x, point.y-last.y) < 1.5 || points.length >= 10000) return;
        drawing.stroke = {...drawing.stroke, points: [...points, point]}; setActive(drawing.stroke);
      }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event,true)}
      onLostPointerCapture={event => { if (gesture.current || pan.current) finish(event,true); }}>
      <g transform={imageView ? `translate(${size.width/2 + imageView.offset.x} ${size.height/2 + imageView.offset.y}) scale(${coordinateZoom}) rotate(${imageView.angle})` : undefined} style={{visibility:visible?'visible':'hidden'}} pointerEvents="none">
        {[...strokes, ...(active ? [active] : [])].map(stroke => <path key={stroke.id} data-annotation-stroke="" d={annotationPath(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeOpacity={stroke.tool==='highlight' ? 0.3 : 1} strokeLinecap="round" strokeLinejoin="round" />)}
      </g>
    </svg>
    {!hideToolbar && <aside ref={floating} className={styles.floating} aria-label="批注绘图工具" onKeyDownCapture={event => {
      if (event.key === 'Escape' && panel) {event.preventDefault();event.stopPropagation();setPanel(null);floating.current?.querySelector<HTMLButtonElement>(`button[data-panel="${panel}"]`)?.focus();}
    }}>
      <div className={styles.rail} style={{maxHeight: Math.max(44, size.height - 24)}} role="toolbar" aria-label={imageView ? "图片批注常用工具" : "文字批注常用工具"} aria-orientation="vertical">
        {imageView && <button type="button" aria-pressed={moving} aria-label="移动图片" title="移动图片" onClick={()=>{setMoving(value=>!value);setPanel(null);}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v18M3 12h18m-12-6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/></svg><span>移动</span>
        </button>}
        <ToolButton label="画笔" selected={!moving && tool==='pen'} onClick={()=>{setMoving(false);setTool('pen');setPanel(null);}} kind="pen" />
        <ToolButton label="荧光笔" selected={!moving && tool==='highlight'} onClick={()=>{setMoving(false);setTool('highlight');setPanel(null);}} kind="highlight" />
        <ToolButton label="整笔擦除" selected={!moving && tool==='eraser'} onClick={()=>{setMoving(false);setTool('eraser');setPanel(null);}} kind="eraser" />
        <button type="button" disabled={!past.length} onClick={undo} title="撤销">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 5-6 5 6 5M3 10h10a7 7 0 0 1 0 14" transform="translate(0 -2)"/></svg><span>撤销</span>
        </button>
        <button type="button" data-panel="settings" aria-expanded={panel==='settings'} aria-label="画笔设置" title="颜色与粗细" onClick={()=>setPanel(value=>value==='settings'?null:'settings')}>
          <i className={styles.currentColor} style={{background:color}}/><span>设置</span>
        </button>
        <button type="button" aria-label="清空批注" title="清空批注" disabled={!strokes.length} onClick={()=>{remember(strokes);current.current=[];setStrokes([]);setPanel(null);}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>清空</span>
        </button>
        <button type="button" aria-label={visible?'隐藏批注':'显示批注'} title={visible?'隐藏批注':'显示批注'} aria-pressed={!visible} onClick={()=>{setVisible(value=>!value);setPanel(null);}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!visible&&<path d="m3 3 18 18"/>}</svg><span>{visible?'隐藏':'显示'}</span>
        </button>
      </div>
      {panel && <div className={styles.flyout} role="group" aria-label="画笔设置面板">
          <div className={styles.panelLabel}>颜色</div>
          <div className={styles.palette}>{COLORS.map(item=><button key={item.value} type="button" aria-label={item.name} title={item.name} aria-pressed={color===item.value} onClick={()=>setColor(item.value)}><i style={{background:item.value}}/></button>)}</div>
          <div className={styles.panelLabel}>粗细</div>
          <div className={styles.palette}><button type="button" aria-label="细笔" aria-pressed={!thick} onClick={()=>setThick(false)}>细</button><button type="button" aria-label="粗笔" aria-pressed={thick} onClick={()=>setThick(true)}>粗</button></div>
      </div>}
    </aside>}
    {imageView && toolbarHost && createPortal(<div className={styles.imageNavigation} role="toolbar" aria-label="图片查看工具">
      <button type="button" aria-label="缩小图片" disabled={imageView.zoom<=.3} onClick={()=>imageView.onZoom(-.2)}>−</button>
      <input aria-label="图片缩放" type="range" min="30" max="1500" step="10" value={Math.round(imageView.zoom*100)} onChange={event=>imageView.onZoom(Number(event.target.value)/100-imageView.zoom)} />
      <output aria-label="图片缩放比例">{Math.round(imageView.zoom*100)}%</output>
      <button type="button" aria-label="放大图片" disabled={imageView.zoom>=15} onClick={()=>imageView.onZoom(.2)}>＋</button>
      <button type="button" onClick={imageView.onFit}>适应窗口</button>
    </div>,toolbarHost)}
  </>;
}
function ToolButton({label,selected,onClick,kind}:{label:string;selected:boolean;onClick:()=>void;kind:Tool}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={selected} onClick={onClick}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind==='eraser'?<><path d="m14 3 7 7-10 11H5l-3-4L14 3Z"/><path d="m7 11 7 7M11 21h10"/></>:kind==='highlight'?<><path d="m13 3 8 8-9 9-8-8 9-9ZM4 12l-2 7 3 3 7-2M12 6l6 6M2 22h9"/></>:<><path d="m16 3 5 5L8 21H3v-5L16 3Z"/><path d="m13 6 5 5"/></>}
    </svg>{label}
  </button>;
}
