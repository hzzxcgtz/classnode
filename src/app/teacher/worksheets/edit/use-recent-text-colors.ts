'use client';
import { useEffect, useState } from 'react';
import { recentTextColors, pushRecentTextColor } from '@/lib/worksheet-recent-colors';
const KEY = 'classnode:worksheet:recent-text-colors:v1';
const EVENT = 'classnode-recent-text-colors';
let fallback: string[] = [];
function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) fallback = recentTextColors(JSON.parse(raw));
  } catch { /* Browser preferences are optional. */ }
  return fallback;
}
export function rememberTextColor(color: string): void {
  fallback = pushRecentTextColor(read(), color);
  try { window.localStorage.setItem(KEY, JSON.stringify(fallback)); } catch { /* Keep this session's choices. */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useRecentTextColors(): string[] {
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setColors(read());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  return colors;
}
