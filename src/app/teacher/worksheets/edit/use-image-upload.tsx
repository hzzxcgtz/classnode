'use client';

import {useEffect, useRef, useState, type HTMLAttributes} from 'react';
import {api} from '@/lib/api';
import {EditorIcon} from './editor-icons';

/** Share the same validation, upload lock and file-drop behavior for task and option images. */
export function useImageUpload(scope: string, onComplete: (url: string) => void) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);
  const depth = useRef(0);
  const mounted = useRef(true);
  const latest = useRef({scope, onComplete});
  latest.current = {scope, onComplete};
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const upload = async (file: File) => {
    if (busy.current) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 图片。');
      return;
    }
    const target = scope;
    busy.current = true;
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadWorksheetImage(file);
      // Switching task or deleting a row must not attach its pending upload elsewhere.
      if (mounted.current && latest.current.scope === target) latest.current.onComplete(result.url);
    } catch (cause) {
      if (mounted.current && latest.current.scope === target) setError(cause instanceof Error ? cause.message : '图片上传失败，请重试');
    } finally {
      busy.current = false;
      if (mounted.current) setUploading(false);
    }
  };

  const dropProps: HTMLAttributes<HTMLDivElement> = {
    onDragEnter(event) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      depth.current++;
      if (!busy.current) setDragging(true);
    },
    onDragOver(event) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = busy.current ? 'none' : 'copy';
      if (!busy.current) setDragging(true);
    },
    onDragLeave(event) {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    },
    onDrop(event) {
      if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.files.length) return;
      event.preventDefault(); event.stopPropagation();
      depth.current = 0;
      setDragging(false);
      if (busy.current) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length !== 1) { setError('每次请拖入一张图片。'); return; }
      void upload(files[0]);
    },
  };
  return {uploading, error, dragging, upload, dropProps};
}

export function ImageDropOverlay({label, replacing}: {label: string; replacing: boolean}) {
  return <div className="worksheet-image-drop-overlay" aria-hidden="true">
    <span className="worksheet-image-drop-icon"><EditorIcon kind="photo" size={24} /></span>
    <strong>松开鼠标，{replacing ? '替换' : '上传'}{label}</strong>
    <small>支持 PNG、JPEG、WebP · 每次一张</small>
  </div>;
}
