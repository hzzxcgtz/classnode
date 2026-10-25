export const MAX_RECORDING_SECONDS = 5 * 60;

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping';

/** Owns the microphone, including permission requests that resolve after cancellation. */
export class AudioRecorderSession {
  private generation = 0;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: RecordingState = 'idle';
  private options: {
    prepare?: () => Promise<void>;
    getMedia: () => Promise<MediaStream>;
    createRecorder: (stream: MediaStream) => MediaRecorder;
    onState: (state: RecordingState) => void;
    onReady: (blob: Blob) => void;
    onError: (error: unknown) => void;
  };

  constructor(options: AudioRecorderSession['options']) { this.options = options; }

  private update(state: RecordingState) { this.state = state; this.options.onState(state); }

  private release() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
  }

  async start() {
    if (this.state !== 'idle') return;
    const generation = ++this.generation;
    this.update('requesting');
    try {
      if (this.options.prepare) await this.options.prepare();
      if (generation !== this.generation) return;
      const stream = await this.options.getMedia();
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const recorder = this.options.createRecorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (generation === this.generation && event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        this.release();
        this.recorder = null;
        this.update('idle');
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        if (blob.size) this.options.onReady(blob);
        else this.options.onError(new Error('没有录到声音，请重新录音'));
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.cancel();
        this.options.onError(new Error('录音中断，请重新录音'));
      };
      stream.getAudioTracks().forEach(track => { track.onended = () => {
        this.cancel();
        this.options.onError(new Error('录音被设备中断，请重新录音'));
      }; });
      recorder.onstart = () => {
        if (generation !== this.generation || this.state !== 'requesting') return;
        if (this.timer) clearTimeout(this.timer);
        this.update('recording');
        this.timer = setTimeout(() => this.stop(), MAX_RECORDING_SECONDS * 1000);
      };
      this.timer = setTimeout(() => {
        if (generation !== this.generation || this.state !== 'requesting') return;
        this.cancel();
        this.options.onError(new Error('录音启动超时，请重新试一次'));
      }, 15_000);
      recorder.start(250);
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      this.options.onError(error);
    }
  }

  stop() {
    if (this.state !== 'recording' || !this.recorder) return;
    this.update('stopping');
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.release();
    } catch (error) { this.cancel(); this.options.onError(error); }
  }

  cancel() {
    ++this.generation;
    if (this.recorder) {
      this.recorder.onstart = null;
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      try { if (this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* Release tracks even if the device failed. */ }
    }
    this.recorder = null;
    this.release();
    this.update('idle');
  }
}
