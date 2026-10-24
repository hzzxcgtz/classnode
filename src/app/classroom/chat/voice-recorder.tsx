'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { IconKeyboard, IconMicrophone, IconHandClick } from '@tabler/icons-react';
import { AudioRecorderSession, MAX_RECORDING_SECONDS, type RecordingState } from './audio-recorder';
import { bindInputHold } from './input-hold';
import { VoiceGesture } from './voice-gesture';
import styles from './voice-recorder.module.css';

export type InputVoiceStatus = { text: string; cancelling: boolean };

let fallbackRecorder: typeof import('opus-media-recorder').default | undefined;
const supportsOgg = () => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus');
function createFallbackRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder {
  if (!fallbackRecorder) throw new Error('录音组件尚未加载，请重试。');
  const base = '/vendor/opus-media-recorder-0.8.0/';
  return new fallbackRecorder(stream, options, {
    encoderWorkerFactory: () => new Worker(`${base}encoderWorker.umd.js`),
    OggOpusEncoderWasmPath: new URL(`${base}OggOpusEncoder.wasm`, window.location.href).href,
  });
}

function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '请在浏览器中允许使用麦克风，然后重试。';
  if (name === 'NotFoundError') return '没有找到麦克风，请连接麦克风后重试。';
  if (name === 'NotReadableError') return '麦克风暂时无法使用，请检查是否被其他应用占用。';
  return error instanceof Error ? error.message : '录音失败，请重试。';
}

export function VoiceRecorder({ enabled, mode, onModeChange, onSend, inputRef, onInputStatus }: {
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onInputStatus?: (status: InputVoiceStatus) => void;
  enabled: boolean;
  mode: boolean;
  onModeChange: (voice: boolean) => void;
  onSend: (file: File, signal: AbortSignal) => Promise<void>;
}) {
  const [state, setState] = useState<RecordingState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState('');
  const [cancelIntent, setCancelIntent] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const [failedClip, setFailedClip] = useState<Blob | null>(null);
  const [sending, setSending] = useState(false);
  const sendController = useRef<AbortController | null>(null);
  const gesture = useRef<VoiceGesture | null>(null);
  const latestSend = useRef(onSend);
  latestSend.current = onSend;

  const send = useCallback(async (blob: Blob) => {
    if (sendController.current) return;
    const controller = new AbortController();
    sendController.current = controller;
    setSending(true);
    setHint('');
    setFailedClip(blob);
    try {
      await latestSend.current(new File([blob], '学生录音.ogg', { type: 'audio/ogg' }), controller.signal);
      if (!controller.signal.aborted) { setFailedClip(null); setHint(''); }
    } catch (problem) {
      if (!controller.signal.aborted) setHint(problem instanceof Error ? problem.message : '语音发送失败，请重试');
    } finally {
      if (sendController.current === controller) { sendController.current = null; setSending(false); }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const prepare = async () => {
      if (!supportsOgg()) fallbackRecorder = (await import('opus-media-recorder')).default;
    };
    // Warm the codec while the voice input is visible, without requesting microphone access.
    if (mode) void prepare().catch(() => {});
    const recorder = new AudioRecorderSession({
      prepare,
      getMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true } }),
      createRecorder: stream => {
        const options = { mimeType: 'audio/ogg;codecs=opus', audioBitsPerSecond: 32_000 };
        return supportsOgg() ? new MediaRecorder(stream, options) : createFallbackRecorder(stream, options);
      },
      onState: next => {
        if (!alive) return;
        if (next === 'recording') gesture.current?.recordingStarted();
        setState(next);
      },
      onReady: blob => {
        setCancelIntent(false);
        if (gesture.current?.acceptClip()) void send(blob);
      },
      onError: problem => { gesture.current?.cancel(); setCancelIntent(false); setHint(microphoneError(problem)); },
    });
    const control = new VoiceGesture({
      start: () => { void recorder.start(); }, stop: () => recorder.stop(),
      cancel: () => recorder.cancel(), hint: setHint,
    });
    gesture.current = control;
    const interrupt = () => {
      control.cancel();
      setCancelIntent(false);
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('blur', interrupt);
    return () => {
      alive = false;
      control.cancel();
      if (gesture.current === control) gesture.current = null;
      sendController.current?.abort();
      sendController.current = null;
      setSending(false);
      setState('idle');
      setCancelIntent(false);
      setFailedClip(null);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('blur', interrupt);
    };
  }, [enabled, mode, send]);

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    setSeconds(0);
    let frame = 0;
    const tick = () => {
      setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - started) / 1000)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  function begin(id: number | null, y = 0) {
    if (!enabled || sending || failedClip || state !== 'idle') return false;
    setHint('');
    setCancelIntent(false);
    if (!window.isSecureContext) { setHint('录音需要 HTTPS，或在本机通过 localhost 打开'); return false; }
    if (!navigator.mediaDevices?.getUserMedia) { setHint('当前浏览器不支持录音，请使用 Safari 或 Chrome'); return false; }
    return gesture.current?.begin(id, y) ?? false;
  }
  const inputActions = useRef({ begin, enabled, sending, failedClip, state });
  inputActions.current = { begin, enabled, sending, failedClip, state };
  useEffect(() => {
    const input = inputRef?.current;
    if (!enabled || mode || !input) return;
    return bindInputHold(input, {
      available: () => { const current = inputActions.current; return current.enabled && !current.sending && !current.failedClip && current.state === 'idle'; },
      begin: (id, y) => inputActions.current.begin(id, y),
      move: (id, y) => setCancelIntent(gesture.current?.move(id, y) ?? false),
      release: id => { gesture.current?.release(id); setCancelIntent(false); },
      cancel: id => { gesture.current?.cancelPointer(id); setCancelIntent(false); },
    });
  }, [enabled, mode, inputRef]);

  const busy = state !== 'idle' || sending;
  const label = sending ? '正在发送语音…' : state === 'requesting' ? '正在开启麦克风…' : state === 'stopping' ? '正在准备发送…' : state === 'recording' ? (cancelIntent ? '松开取消' : mode && tapMode ? '说完了，点击发送' : '松开发送，上滑取消') : tapMode ? '点击开始录音' : '按住说话';
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  useEffect(() => {
    onInputStatus?.({
      text: !mode && busy ? `${label}${state === 'recording' ? ` ${duration}` : ''}` : '',
      cancelling: !mode && state === 'recording' && cancelIntent,
    });
    return () => onInputStatus?.({ text: '', cancelling: false });
  }, [mode, busy, label, state, duration, cancelIntent, onInputStatus]);

  const actionableHint = hint && hint !== '已取消录音' && hint !== '说话时间太短，请再试一次';
  const cancellableRecording = (tapMode || !mode) && (state === 'recording' || state === 'requesting');
  const showFeedback = actionableHint || failedClip || sending || cancellableRecording;

  return <>
    <button type="button" className={styles.modeToggle} disabled={!enabled || busy}
      onClick={() => { setHint(''); onModeChange(!mode); }} aria-label={mode ? '切换到文字输入' : '切换到语音输入'} title={mode ? '文字输入' : '语音输入'}>
      {mode ? <IconKeyboard size={24} stroke={1.7} aria-hidden="true" /> : <IconMicrophone size={24} stroke={1.7} aria-hidden="true" />}
    </button>
    {mode && <div className={styles.voiceInput}>
      <button type="button" className={`${styles.holdButton} ${state === 'recording' ? styles.recording : ''} ${cancelIntent ? styles.cancel : ''}`}
        disabled={!enabled || sending || state === 'stopping' || !!failedClip}
        onPointerDown={event => {
          if (tapMode || event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          begin(event.pointerId, event.clientY);
        }}
        onPointerMove={event => { if (!tapMode && event.isPrimary) setCancelIntent(gesture.current?.move(event.pointerId, event.clientY) ?? false); }}
        onPointerUp={event => { if (!tapMode) { gesture.current?.release(event.pointerId); setCancelIntent(false); } }}
        onPointerCancel={event => { if (!tapMode) { gesture.current?.cancelPointer(event.pointerId); setCancelIntent(false); } }}
        onLostPointerCapture={event => { if (!tapMode) { gesture.current?.cancelPointer(event.pointerId); setCancelIntent(false); } }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.key === 'Escape') { gesture.current?.cancel(); setCancelIntent(false); }
          if (!tapMode && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (!event.repeat) begin(-1); }
        }}
        onKeyUp={event => { if (!tapMode && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); gesture.current?.release(-1); } }}
        onClick={event => {
          if (tapMode) {
            if (state === 'recording') gesture.current?.release(null);
            else if (state === 'requesting') gesture.current?.cancel();
            else begin(null);
          } else if (event.detail === 0 && state === 'idle') setTapMode(true);
        }} aria-label={label}>
        <span>{label}</span>{state === 'recording' && <time>{duration}</time>}
      </button>
      <button type="button" className={styles.recordingMode} disabled={!enabled || busy || !!failedClip}
        aria-label={tapMode ? '改为按住说话' : '改为点按录音'} title={tapMode ? '按住说话' : '点按录音，适合长段讲述'} aria-pressed={tapMode}
        onClick={() => { setTapMode(value => !value); setHint(''); }}>
        <IconHandClick size={22} stroke={1.7} aria-hidden="true" />
      </button>
    </div>}
    {showFeedback && <div className={styles.inputFeedback}>
      <div className={styles.caption}>
        {actionableHint && <span role="status">{hint}</span>}
        {cancellableRecording && <button type="button" onClick={() => { gesture.current?.cancel(); setHint('已取消录音'); }}>取消录音</button>}
        {sending && <button type="button" onClick={() => { sendController.current?.abort(); setHint('已停止发送，可重试'); }}>取消发送</button>}
        {failedClip && !sending && <><button type="button" disabled={!enabled} onClick={() => void send(failedClip)}>重试发送</button><button type="button" onClick={() => { setFailedClip(null); setHint(''); }}>删除录音</button></>}
      </div>
    </div>}
  </>;
}
