'use client';
import { useEffect, useRef, useState, useId } from 'react';
import { IconMicrophone, IconRefresh, IconTrash, IconHandClick, IconX } from '@tabler/icons-react';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { getStudentSessionAuthorization } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { VoiceAnswerPlayer, audioTime } from '@/components/voice-answer-player';
import { AudioRecorderSession, type RecordingState } from '../../chat/audio-recorder';
import { prepareAudioCodec, createAudioRecorder } from '../../chat/audio-codec';
import { VoiceGesture } from '../../chat/voice-gesture';
import styles from '../worksheet.module.css';
import { publishWorksheetRecording } from '../worksheet-socket-bus';

type AudioDraft = Extract<AnswerDraft, { kind: 'audio' }>;
type Clip = { blob: Blob; durationMs: number; preview: string };
export function AudioBody({ worksheetId, questionId, draft, onChange, disabled, localOnly, compact = false, onBusyChange }: { worksheetId?: string; questionId?: string; draft: AudioDraft; onChange: (draft: AudioDraft) => void; disabled: boolean; localOnly: boolean; compact?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const instance = useId();
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const [state, setState] = useState<RecordingState>('idle');
  const [supported, setSupported] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [cancelIntent, setCancelIntent] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const gesture = useRef<VoiceGesture | null>(null);
  const startedAt = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const latest = useRef({ onChange, disabled, localOnly });
  latest.current = { onChange, disabled, localOnly };
  useEffect(() => { setSupported(window.isSecureContext === true && typeof navigator.mediaDevices?.getUserMedia === 'function'); }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.preview); }, [clip]);
  const uploadClip = async (next: Clip) => {
    if (uploadController.current || latest.current.disabled || latest.current.localOnly) return;
    const controller = new AbortController(); uploadController.current = controller;
    const timer = setTimeout(() => controller.abort(), 90_000);
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('file', new File([next.blob], '语音作答.ogg', { type: 'audio/ogg' }));
      const response = await fetch(`${getApiBaseUrl()}/api/upload/worksheet-audio`, { method: 'POST', body: form, credentials: 'include', headers: getStudentSessionAuthorization(), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '录音上传失败，请重试');
      if (!controller.signal.aborted && !latest.current.disabled) latest.current.onChange({ kind: 'audio', url: result.url, durationMs: next.durationMs });
    } catch (problem) {
      if (uploadController.current === controller) setError(controller.signal.aborted ? '上传未完成，录音已保留，请重试。' : problem instanceof Error ? problem.message : '录音上传失败，请重试。');
    } finally {
      clearTimeout(timer);
      if (uploadController.current === controller) { uploadController.current = null; setUploading(false); }
    }
  };
  const latestUpload = useRef(uploadClip); latestUpload.current = uploadClip;
  useEffect(() => {
    if (disabled || localOnly || !supported) return;
    let alive = true;
    void prepareAudioCodec().catch(() => {});
    const session = new AudioRecorderSession({
      prepare: prepareAudioCodec,
      getMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true } }),
      createRecorder: createAudioRecorder,
      onState: next => {
        if (!alive) return;
        if (next === 'recording') { startedAt.current = Date.now(); gesture.current?.recordingStarted(); }
        setState(next);
      },
      onReady: blob => {
        if (!alive || !gesture.current?.acceptClip()) return;
        const next = { blob, durationMs: Math.min(300_000, Math.max(500, Date.now() - startedAt.current)), preview: URL.createObjectURL(blob) };
        latest.current.onChange({ kind: 'audio', url: '', durationMs: 0 });
        setClip(next); setCancelIntent(false); void latestUpload.current(next);
      },
      onError: problem => {
        if (!alive) return;
        gesture.current?.cancel(); setCancelIntent(false);
        setError(problem instanceof Error && ['NotAllowedError', 'SecurityError'].includes(problem.name)
          ? '请在 Safari 的网站设置中允许麦克风，再试一次。' : problem instanceof Error ? problem.message : '录音失败，请再试一次。');
      },
    });
    const control = new VoiceGesture({ start: () => { void session.start(); }, stop: () => session.stop(), cancel: () => session.cancel(), hint: setError });
    gesture.current = control;
    const cancel = () => { control.cancel(); setCancelIntent(false); };
    const hidden = () => { if (document.hidden) cancel(); };
    const otherRecording = (event: Event) => { if ((event as CustomEvent).detail !== instance) cancel(); };
    document.addEventListener('worksheet-audio-start', otherRecording);
    window.addEventListener('pagehide', cancel); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('worksheet-audio-start', otherRecording);
      alive = false; control.cancel(); if (gesture.current === control) gesture.current = null;
      uploadController.current?.abort(); uploadController.current = null;
      setState('idle'); setUploading(false); setCancelIntent(false);
      window.removeEventListener('pagehide', cancel); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden);
    };
  }, [disabled, localOnly, supported, instance]);
  useEffect(() => {
    if (state !== 'recording') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.min(300, Math.floor((Date.now() - startedAt.current) / 1000))), 200);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(() => {
    if (state !== 'recording' || !worksheetId || !questionId || disabled || localOnly) return;
    const announce = (recording: boolean) => publishWorksheetRecording({ worksheetId, questionId, recording });
    announce(true);
    const heartbeat = window.setInterval(() => announce(true), 5000);
    return () => { window.clearInterval(heartbeat); announce(false); };
  }, [state, worksheetId, questionId, disabled, localOnly]);
  const begin = (id: number | null, y = 0) => {
    if (disabled || localOnly || uploading || state !== 'idle') return;
    document.dispatchEvent(new CustomEvent('worksheet-audio-start', { detail: instance }));
    setError(''); setCancelIntent(false); setClip(null);
    if (!compact) latest.current.onChange({ kind: 'audio', url: '', durationMs: 0 });
    gesture.current?.begin(id, y);
  };
  const busy = state !== 'idle';
  const hasAudio = Boolean(draft.url || clip);
  const unsettled = busy || uploading || Boolean(clip && !draft.url);
  useEffect(() => { busyCallback.current?.(unsettled); }, [unsettled]);
  useEffect(() => () => busyCallback.current?.(false), []);
  const label = state === 'requesting' ? '正在开启麦克风…' : state === 'stopping' ? '正在整理录音…'
    : state === 'recording' ? cancelIntent ? '松开取消' : tapMode ? '说完了，点击完成' : '松开完成，上滑取消' : tapMode ? '点击开始录音' : compact ? '按住说话' : '按住说出你的想法';
  return <div className={`${styles.voiceAnswer} ${compact ? styles.voiceAnswerCompact : ''}`}>
    {hasAudio && !busy && <VoiceAnswerPlayer compact={compact} key={clip?.preview || draft.url} src={clip?.preview || worksheetAssetUrl(draft.url)} durationMs={clip?.durationMs || draft.durationMs} />}
    {!disabled && (!supported || localOnly) && <p className={styles.voiceNote} title={localOnly ? '学生将在这里录音、试听后提交。' : '请通过 HTTPS 打开课堂，并允许麦克风。'}>{compact ? localOnly ? '语音作答' : '需开启 HTTPS 录音' : localOnly ? '学生将在这里录音、试听后提交。' : '语音作答需要通过 HTTPS 打开课堂，并使用支持录音的浏览器。请联系老师。'}</p>}
    {!disabled && supported && !localOnly && <>
      {(!hasAudio || busy) && <button type="button" className={`${styles.voiceRecordButton} ${state === 'recording' ? styles.voiceRecording : ''} ${cancelIntent ? styles.voiceCancel : ''}`} disabled={uploading || state === 'stopping'}
        onPointerDown={event => { if (tapMode || !event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); begin(event.pointerId, event.clientY); }}
        onPointerMove={event => { if (!tapMode) setCancelIntent(gesture.current?.move(event.pointerId, event.clientY) ?? false); }}
        onPointerUp={event => { if (!tapMode) { gesture.current?.release(event.pointerId); setCancelIntent(false); } }}
        onPointerCancel={event => { gesture.current?.cancelPointer(event.pointerId); setCancelIntent(false); }}
        onLostPointerCapture={event => { if (!tapMode) { gesture.current?.cancelPointer(event.pointerId); setCancelIntent(false); } }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => { if (event.key === 'Escape') gesture.current?.cancel(); if (!tapMode && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) begin(-1); } }}
        onKeyUp={event => { if (!tapMode && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); gesture.current?.release(-1); } }}
        onClick={event => { if (tapMode) { if (state === 'recording') gesture.current?.release(null); else if (state === 'requesting') gesture.current?.cancel(); else begin(null); } else if (event.detail === 0 && state === 'idle') setTapMode(true); }}>
        <IconMicrophone size={24} stroke={1.7} aria-hidden="true" /><strong>{label}</strong>{state === 'recording' && <time>{audioTime(seconds)}</time>}
      </button>}
      <div className={styles.voiceActions}>
        {hasAudio && !busy && <><button type="button" className={styles.voiceAction} aria-label="重新录音" title="重新录音" disabled={uploading} onClick={() => { setTapMode(true); begin(null); }}><IconRefresh size={17} aria-hidden="true" />重新录音</button><button type="button" className={styles.voiceAction} aria-label="删除录音" title="删除录音" disabled={uploading} onClick={() => { setClip(null); setError(''); onChange({ kind: 'audio', url: '', durationMs: 0 }); }}><IconTrash size={17} aria-hidden="true" />{!compact && '删除'}</button></>}
        {!hasAudio && !busy && <button type="button" className={styles.voiceAction} aria-label={tapMode ? '改为按住录音' : '改为点按录音'} title={tapMode ? '改为按住录音' : '改为点按录音'} onClick={() => setTapMode(value => !value)} aria-pressed={tapMode}><IconHandClick size={17} aria-hidden="true" />{!compact && (tapMode ? '改为按住录音' : '改为点按录音')}</button>}
        {busy && <button type="button" className={styles.voiceAction} aria-label="取消录音" title="取消录音" onClick={() => { gesture.current?.cancel(); setCancelIntent(false); }}><IconX size={17} aria-hidden="true" />{!compact && '取消录音'}</button>}
        {uploading && <span role="status">正在保存录音…</span>}
        {clip && !draft.url && !uploading && !busy && <button type="button" className={styles.voiceAction} onClick={() => void uploadClip(clip)}>重试保存</button>}
      </div>
      {!compact && !busy && !error && <p className={styles.voiceNote}>{hasAudio ? draft.url ? '听一听，准备好了就提交本题。' : '录音已保留，保存完成后即可提交。' : '最长 5 分钟，录好后可以试听。'}</p>}
    </>}
    {error && error !== '已取消录音' && <p className={styles.voiceError} role="status">{error}</p>}
    {disabled && !hasAudio && <p className={styles.voiceNote}>暂无语音作答</p>}
  </div>;
}
