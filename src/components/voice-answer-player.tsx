'use client';
import { useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconMicrophone, IconRefresh } from '@tabler/icons-react';
import styles from './voice-answer.module.css';

export function audioTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
/** Same player for student drafts, submitted answers and teacher review. */
export function VoiceAnswerPlayer({ src, durationMs, title = '我的语音作答' }: { src: string; durationMs: number; title?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(durationMs / 1000);
  const [error, setError] = useState('');
  useEffect(() => {
    setPlaying(false); setPosition(0); setLength(durationMs / 1000); setError('');
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
  return <div className={styles.player} aria-label={title}>
    <audio ref={audio} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)} onEnded={() => setPlaying(false)}
      onLoadedMetadata={() => { const value = audio.current?.duration; if (value && Number.isFinite(value)) setLength(value); }}
      onError={() => { setPlaying(false); setError('录音暂时无法读取，请检查网络后重试。'); }} />
    <button type="button" className={styles.play} onClick={() => void toggle()} aria-label={playing ? '暂停语音' : '播放语音'}>
      {playing ? <IconPlayerPauseFilled size={22} aria-hidden="true" /> : <IconPlayerPlayFilled size={22} aria-hidden="true" />}
    </button>
    <div className={styles.track}>
      <div className={styles.trackHeader}><strong><IconMicrophone size={16} aria-hidden="true" />{title}</strong><span>{audioTime(position)} / {audioTime(length)}</span></div>
      <input type="range" min={0} max={Math.max(length, 1)} step={0.1} value={Math.min(position, Math.max(length, 1))} aria-label="语音播放进度"
        onChange={event => { if (audio.current) { try { audio.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } catch { /* Wait for metadata. */ } } }} />
    </div>
    {error && <div className={styles.error} role="status">{error}<button type="button" onClick={() => { audio.current?.load(); void toggle(); }}><IconRefresh size={15} aria-hidden="true" />重试</button></div>}
  </div>;
}
