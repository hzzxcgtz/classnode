'use client';
import { useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconMicrophone, IconRefresh } from '@tabler/icons-react';
import styles from './voice-answer.module.css';

export function audioTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
/** Same player for student drafts, submitted answers and teacher review. */
export function VoiceAnswerPlayer({ src, durationMs, title = '我的语音作答', compact = false }: { src: string; durationMs: number; title?: string; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(durationMs / 1000);
  const [error, setError] = useState('');
  useEffect(() => {
    setPlaying(false); setPosition(0); setLength(durationMs / 1000); setError(''); pendingSeek.current = null;
    const element = audio.current;
    return () => element?.pause();
  }, [src, durationMs]);
  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) { element.pause(); return; }
    document.querySelectorAll('audio').forEach(other => { if (other !== element) other.pause(); });
    try { await element.play(); setError(''); } catch { setError('暂时无法播放，请重试。'); }
  };
  const progress = <input type="range" className={compact ? styles.compactProgress : undefined} min={0} max={Math.max(length, 1)} step={0.1} value={Math.min(position, Math.max(length, 1))} aria-label="语音播放进度"
    onChange={event => {
      const next = Number(event.target.value);
      setPosition(next); pendingSeek.current = next;
      const element = audio.current;
      if (!element) return;
      if (element.readyState > 0) { try { element.currentTime = next; pendingSeek.current = null; } catch { /* Retry after metadata. */ } }
      else element.load();
    }}/>;
  return <div className={`${styles.player} ${compact ? styles.compact : ''}`} aria-label={title}>
    <audio ref={audio} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)} onEnded={() => setPlaying(false)}
      onLoadedMetadata={() => { const element = audio.current; const value = element?.duration; if (value && Number.isFinite(value)) setLength(value); if (element && pendingSeek.current !== null) { try { const next = Math.min(pendingSeek.current, value && Number.isFinite(value) ? value : length); element.currentTime = next; setPosition(next); pendingSeek.current = null; } catch { /* Keep pending until media can seek. */ } } }}
      onError={() => { setPlaying(false); setError('录音暂时无法读取，请检查网络后重试。'); }} />
    <button type="button" className={styles.play} onClick={() => void toggle()} aria-label={playing ? '暂停语音' : '播放语音'}>
      {playing ? <IconPlayerPauseFilled size={22} aria-hidden="true" /> : <IconPlayerPlayFilled size={22} aria-hidden="true" />}
    </button>
    {compact ? <>{progress}<span className={styles.compactTime}>{audioTime(position)} / {audioTime(length)}</span></> : <div className={styles.track}>
      <div className={styles.trackHeader}><strong><IconMicrophone size={16} aria-hidden="true" />{title}</strong><span>{audioTime(position)} / {audioTime(length)}</span></div>
      {progress}
    </div>}
    {error && <div className={styles.error} role="status">{error}<button type="button" onClick={() => { audio.current?.load(); void toggle(); }}><IconRefresh size={15} aria-hidden="true" />重试</button></div>}
  </div>;
}
