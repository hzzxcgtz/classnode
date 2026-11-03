'use client';

import { IconAdjustments, IconCamera, IconCheck, IconCrop, IconPhoto, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { detectPaper, photoCanvas, straightenPaper, validCorners, type Corners } from '@/lib/paper-crop';
import styles from '../worksheet.module.css';

const inset: Corners = [{x:.04,y:.04},{x:.96,y:.04},{x:.96,y:.96},{x:.04,y:.96}];
const cornerNames = ['左上角', '右上角', '右下角', '左下角'];

function usePhotoUrl(file: File | null) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function PhotoCropDialog({file, onConfirm, onCancel, onRetake}: {
  file: File;
  onConfirm: (file: File, needsWebp?: boolean) => void;
  onCancel: () => void;
  onRetake: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const url = usePhotoUrl(file);
  const [corners, setCorners] = useState<Corners>(inset);
  const [message, setMessage] = useState('正在识别纸张边缘…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cropped, setCropped] = useState<File | null>(null);
  const croppedUrl = usePhotoUrl(cropped);
  const croppedCanvas = useRef<HTMLCanvasElement | null>(null);

  const encode = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(null), 8000);
    try { canvas.toBlob(blob => { window.clearTimeout(timer); resolve(blob); }, type, quality); }
    catch (error) { window.clearTimeout(timer); reject(error); }
  });
  const makeFile = (blob: Blob) => new File([blob], file.name.replace(/\.[^.]*$/, '') + (blob.type === 'image/webp' ? '-裁切.webp' : '-裁切.jpg'), {type: blob.type});

  const confirmCrop = async () => {
    if (!cropped || busy) return;
    setBusy(true);
    let webp: Blob | null = null;
    try {
      if (croppedCanvas.current) webp = await encode(croppedCanvas.current, 'image/webp', .7);
    } catch { /* The teacher server can encode WebP from the preview JPEG. */ }
    if (webp?.type === 'image/webp' && webp.size) onConfirm(makeFile(webp), false);
    else onConfirm(cropped, true);
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLElement>('h2')?.focus();
    return () => element?.close();
  }, []);
  const detect = () => {
    if (ready || !image.current) return;
    let detected: Corners | null = null;
    try {
      const {canvas, context} = photoCanvas(image.current, 384);
      detected = detectPaper(context.getImageData(0, 0, canvas.width, canvas.height));
    } catch { /* Manual adjustment remains available. */ }
    if (detected) setCorners(detected);
    setMessage(detected ? '已找到纸张边缘，可以拖动四角微调。' : '没有找到清晰的纸张边缘，请拖动四角框住纸张。');
    setReady(true);
    if (detected) void preview(detected);
  };
  const preview = async (selection = corners) => {
    if (!image.current || busy) return;
    setBusy(true);
    try {
      const canvas = straightenPaper(image.current, selection);
      const blob = await encode(canvas, 'image/jpeg', .94);
      if (!blob || blob.type !== 'image/jpeg') throw new Error('无法生成裁切照片');
      croppedCanvas.current = canvas;
      setCropped(makeFile(blob));
    } catch { setMessage('裁切失败，请调整四角或使用原图。'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className={`${styles.photoCropDialog} ${styles.photoCropReview}`} aria-label="裁切作答照片" onCancel={event => {event.preventDefault(); if (!busy) onCancel();}}>
    <header className={styles.photoCropHeader}>
      <span className={styles.photoCropBadge} aria-hidden="true"><IconCrop size={22} /></span>
      <div>
        <h2 tabIndex={-1}>{cropped ? '确认作答照片' : '调整裁切范围'}</h2>
        <p role="status">{cropped ? '检查文字和图形是否完整。' : message}</p>
      </div>
      <button type="button" className={styles.photoCropClose} aria-label="取消裁切" disabled={busy} onClick={onCancel}><IconX size={20} /></button>
    </header>
    <div className={styles.photoCropStage}>
    {cropped ? <img className={styles.photoCropResult} src={croppedUrl || undefined} alt="裁切后的照片" /> :
      <div className={styles.photoCropFrame} ref={frame}>
        <img ref={image} src={url || undefined} alt="待裁切照片" onLoad={detect} onError={() => setMessage('无法预览这张照片，可以使用原图或重新拍照。')} />
        {ready && <>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={corners.map(p => `${p.x*100},${p.y*100}`).join(' ')} />
          </svg>
          {corners.map((point, i) => <button key={i} type="button" className={styles.photoCropHandle} aria-label={cornerNames[i]} disabled={busy}
            style={{left:`${point.x*100}%`,top:`${point.y*100}%`}}
            onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={e => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId) || !frame.current) return;
              const rect = frame.current.getBoundingClientRect();
              const clamp = (n: number) => Math.max(0, Math.min(1, n));
              const next = [...corners] as Corners;
              next[i] = {x:clamp((e.clientX-rect.left)/rect.width),y:clamp((e.clientY-rect.top)/rect.height)};
              if (validCorners(next)) setCorners(next);
            }}
            onKeyDown={e => {
              const delta: Record<string, [number, number]> = {ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]};
              if (!delta[e.key]) return;
              e.preventDefault();
              const [dx,dy] = delta[e.key];
              const next = [...corners] as Corners;
              next[i] = {x:Math.max(0,Math.min(1,point.x+dx)),y:Math.max(0,Math.min(1,point.y+dy))};
              if (validCorners(next)) setCorners(next);
            }} />)}
        </>}
      </div>}
    </div>
    <footer className={styles.photoCropFooter}>
      {cropped ? <button type="button" className={styles.photoCropPrimary} disabled={busy} onClick={() => void confirmCrop()}><IconCheck size={19} />确认上传</button>
        : <button type="button" className={styles.photoCropPrimary} disabled={!ready || busy} onClick={() => void preview()}><IconCrop size={19} />{busy ? '正在裁切…' : '预览裁切'}</button>}
      <div className={styles.photoCropSecondary}>
        <button type="button" className={styles.photoCropLink} disabled={busy} onClick={() => {
          dialog.current?.close();
          onRetake();
        }}><IconCamera size={18} />重新拍摄</button>
        {cropped && <button type="button" className={styles.photoCropLink} disabled={busy} onClick={() => setCropped(null)}><IconAdjustments size={18} />调整四角</button>}
        <button type="button" className={styles.photoCropLink} disabled={busy} onClick={() => onConfirm(file)}><IconPhoto size={18} />使用原图</button>
      </div>
    </footer>
  </dialog>;
}
