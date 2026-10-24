'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FullscreenPreview } from './fullscreen-preview';
import { TemporaryAnnotations } from './temporary-annotations';
import styles from './fullscreen-preview.module.css';
import { useImageRotation } from '@/components/use-image-rotation';
import { ImageRotationControls } from '@/components/image-rotation-controls';

function imageTarget(src: string) {
  try { const url = new URL(src, window.location.href); url.searchParams.delete('orientation'); return url.pathname + url.search; } catch { return src; }
}
const clampZoom = (value: number) => Math.max(.3, Math.min(15, value));
export function ClassroomImagePreview({ src, onClose, allowAnnotations = false }: { src: string; onClose: () => void; allowAnnotations?: boolean }) {
  const rotation = useImageRotation(src);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imageWidth, setImageWidth] = useState(1000);
  const imageObserver = useRef<ResizeObserver | null>(null);
  const imageRef = useCallback((element: HTMLImageElement | null) => {
    imageObserver.current?.disconnect();
    if (!element) return;
    const measure = () => { if (element.clientWidth) setImageWidth(element.clientWidth); };
    measure();
    imageObserver.current = new ResizeObserver(measure); imageObserver.current.observe(element);
  }, []);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  useEffect(() => {
    const element = stage;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(value => clampZoom(value + (event.deltaY > 0 ? -.12 : .12)));
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [stage]);
  return <FullscreenPreview allowAnnotations={allowAnnotations} annotationKey={imageTarget(src)} title="学生图片" onClose={onClose} controlsLayout={allowAnnotations ? 'image' : undefined}
    renderAnnotations={(toolbarHost, tools) => <TemporaryAnnotations key={src} annotationKey={tools?.annotationKey ?? imageTarget(src)} onChange={tools?.onChange} toolbarHost={toolbarHost} imageView={{zoom, coordinateScale: imageWidth / 1000, offset, angle: rotation.angle, onZoom: change => setZoom(value => clampZoom(value + change)), onPan: setOffset, onFit: () => {setZoom(1);setOffset({x:0,y:0});}}} />}
    controls={<>
    <button type="button" onClick={() => setZoom(value => clampZoom(value - .2))} disabled={zoom <= .3} aria-label="缩小图片">−</button>
    <input aria-label="图片缩放" type="range" min="30" max="1500" step="10" value={Math.round(zoom * 100)} onChange={event => setZoom(Number(event.target.value) / 100)} />
    <button type="button" onClick={() => setZoom(value => clampZoom(value + .2))} disabled={zoom >= 15} aria-label="放大图片">＋</button>
    <output>{Math.round(zoom * 100)}%</output>
    <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>适应窗口</button>
    <ImageRotationControls rotation={rotation} />
    <span className={styles.hint}>拖动图片移动 · 滚轮缩放 · Esc 关闭</span>
  </>}>
    <div ref={setStage} className={styles.stage} data-dragging={dragging}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        setOffset({ x: current.offsetX + event.clientX - current.x, y: current.offsetY + event.clientY - current.y });
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <img ref={imageRef} src={rotation.source} alt="学生上传的图片" draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation.angle}deg)` }} />
    </div>
  </FullscreenPreview>;
}
