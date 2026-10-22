'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';

const UPDATED = 'classnode-image-orientation-updated';
const versions = new Map<string, string>();
/** One entry point for local saves and room-scoped socket updates. */
export function publishImageOrientationUpdated(data: {url: string; version: string}) {
  if (!data || typeof data.url !== 'string' || !/^\/uploads\/chat\/chat-[0-9a-f-]+\.(png|jpg|webp)$/i.test(data.url) || typeof data.version !== 'string' || !/^[a-f0-9]{64}$/.test(data.version)) return;
  versions.set(data.url, data.version);
  window.dispatchEvent(new CustomEvent(UPDATED, {detail:data}));
}
function imagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (![window.location.origin, new URL(getApiBaseUrl() || '/', window.location.origin).origin].includes(parsed.origin)) return null;
    return /^\/uploads\/chat\/chat-[0-9a-f-]+\.(png|jpg|webp)$/i.test(parsed.pathname) ? parsed.pathname : null;
  } catch { return null; }
}
function versioned(url: string, version?: string): string {
  if (!version) return url;
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.set('orientation', version);
  return parsed.href;
}
/** Refresh thumbnails within this browser when their underlying image was rotated. */
export function useRotatedImageSource(url: string) {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    const path = imagePath(url);
    setVersion(path ? versions.get(path) : undefined);
    const updated = (event: Event) => {
      const data = (event as CustomEvent<{url: string; version: string}>).detail;
      if (data.url === path) setVersion(data.version);
    };
    window.addEventListener(UPDATED, updated);
    return () => window.removeEventListener(UPDATED, updated);
  }, [url]);
  return versioned(url, version);
}
export function useImageRotation(url: string | null) {
  const path = imagePath(url);
  const [version, setVersion] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [angle, setAngle] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const source = useRotatedImageSource(url || '');
  useEffect(() => {
    setVersion(undefined); setAngle(0); setMessage(''); setError('');
    if (!path) return;
    let cancelled = false; setLoading(true);
    void api.getImageOrientation(path).then(data => {
      if (cancelled) return;
      setVersion(data.version); publishImageOrientationUpdated(data);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '暂时无法读取图片方向'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);
  useEffect(() => {
    const updated = (event: Event) => {
      const data = (event as CustomEvent<{url: string; version: string}>).detail;
      if (data.url === path) setVersion(data.version);
    };
    window.addEventListener(UPDATED, updated);
    return () => window.removeEventListener(UPDATED, updated);
  }, [path]);
  const rotate = async (degrees: -90 | 90) => {
    if (!path || !version || busy || loading) return;
    setBusy(true); setAngle(degrees); setError(''); setMessage('正在保存方向…');
    try {
      const result = await api.saveImageOrientation(path, degrees, version);
      setVersion(result.version); publishImageOrientationUpdated(result);
      setMessage('方向已保存');
    } catch(e) { setMessage(''); setError(e instanceof Error ? e.message : '方向保存失败，请重试'); }
    finally { setAngle(0); setBusy(false); }
  };
  return { source, angle, busy, loading, message, error, supported: !!path, canRotate: !!version && !loading && !busy, rotate };
}
