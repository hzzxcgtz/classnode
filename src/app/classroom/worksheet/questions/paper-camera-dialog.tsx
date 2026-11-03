'use client';

import { useEffect, useRef, useState } from 'react';
import { detectPaper, type Corners } from '@/lib/paper-crop';
import styles from '../worksheet.module.css';

export function PaperCameraDialog({onCapture, onFallback, onCancel}: {
  onCapture: (file: File) => void;
  onFallback: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(false);
  const [ratio, setRatio] = useState(0);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const preview = video.current;
    if (!element || !preview) return;
    element.showModal();
    let closed = false;
    let stream: MediaStream | undefined;
    active.current = true;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1440}},
        });
        if (closed) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        for (const track of stream.getVideoTracks()) {
          track.onended = () => {
            setCorners(null);
            setError('相机已断开，可以使用系统相机或选择照片。');
          };
        }
        preview.srcObject = stream;
        await preview.play();
      } catch {
        stream?.getTracks().forEach(track => track.stop());
        if (!closed) setError('无法打开实时相机，可以使用系统相机或选择照片。');
      }
    })();

    const sample = document.createElement('canvas');
    const context = sample.getContext('2d', {willReadFrequently: true});
    const timer = window.setInterval(() => {
      const {videoWidth: width, videoHeight: height} = preview;
      if (!context || !width || !height || preview.readyState < 2 || preview.paused || document.hidden) return;
      const scale = 320 / Math.max(width, height);
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      if (sample.width !== w) sample.width = w;
      if (sample.height !== h) sample.height = h;
      try {
        context.drawImage(preview, 0, 0, w, h);
        setCorners(detectPaper(context.getImageData(0, 0, w, h)));
      } catch { setCorners(null); }
    }, 200);

    return () => {
      closed = true;
      active.current = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      preview.srcObject = null;
      element.close();
    };
  }, []);

  const capture = async () => {
    const preview = video.current;
    if (!preview || preview.readyState < 2 || capturing) return;
    setCapturing(true);
    try {
      const scale = Math.min(1, 2000 / Math.max(preview.videoWidth, preview.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('相机画面不可用');
      context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
      if (!active.current) return;
      if (!blob || blob.type !== 'image/jpeg') throw new Error('照片编码失败');
      onCapture(new File([blob], '作答照片.jpg', {type: blob.type}));
    } catch {
      if (active.current) setError('拍照失败，可以使用系统相机或选择照片。');
    } finally {
      if (active.current) setCapturing(false);
    }
  };

  return <dialog ref={dialog} className={styles.photoCropDialog} aria-label="拍摄作答照片"
    onCancel={event => {event.preventDefault(); onCancel();}}>
    <h2>拍摄作答照片</h2>
    <p role="status">{error || (!ratio ? '正在打开相机…' : corners ? '已识别纸张，保持画面稳定后拍照。' : '请让整张纸进入画面，尽量避开阴影。')}</p>
    <div className={styles.paperCameraFrame} style={{width: ratio ? `min(100%, ${52 * ratio}vh)` : undefined}}>
      <video ref={video} autoPlay muted playsInline
        onResize={event => {
          const {videoWidth, videoHeight} = event.currentTarget;
          if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight);
        }}
        onLoadedMetadata={event => {
          const {videoWidth, videoHeight} = event.currentTarget;
          if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight);
        }} />
      {Boolean(ratio) && !error && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {corners ? <polygon points={corners.map(point => `${point.x * 100},${point.y * 100}`).join(' ')} /> :
          <rect x="9" y="9" width="82" height="82" />}
      </svg>}
    </div>
    <div className={styles.photoCropActions}>
      <button type="button" className={`btn btn-ghost ${styles.photoCropAction}`} onClick={onCancel}>取消</button>
      <button type="button" className={`btn btn-secondary ${styles.photoCropAction}`} onClick={() => {dialog.current?.close(); onFallback();}}>系统拍照或选图</button>
      <button type="button" className={`btn btn-primary ${styles.photoCropAction}`} disabled={!ratio || capturing || Boolean(error)} onClick={() => void capture()}>{capturing ? '正在拍照…' : '拍照'}</button>
    </div>
  </dialog>;
}
