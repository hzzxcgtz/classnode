const MIN_RECORDING_MS = 500;
export const CANCEL_DISTANCE = 64;

/** Gesture intent is independent of asynchronous permission and encoder callbacks. */
export class VoiceGesture {
  private active: { id: number | null; y: number; cancel: boolean; started: number | null } | null = null;
  private sendOnReady = false;
  private actions: {
    start: () => void;
    stop: () => void;
    cancel: () => void;
    hint: (text: string) => void;
    now?: () => number;
  };
  constructor(actions: VoiceGesture['actions']) { this.actions = actions; }
  begin(id: number | null, y = 0) {
    if (this.active || this.sendOnReady) return false;
    this.active = { id, y, cancel: false, started: null };
    this.actions.start();
    return true;
  }
  recordingStarted() { if (this.active) this.active.started = this.now(); }
  move(id: number, y: number) {
    if (!this.active || this.active.id !== id) return false;
    this.active.cancel = this.active.y - y >= CANCEL_DISTANCE;
    return this.active.cancel;
  }
  release(id: number | null) {
    const gesture = this.active;
    if (!gesture || gesture.id !== id) return;
    this.active = null;
    if (gesture.cancel || gesture.started === null || this.now() - gesture.started < MIN_RECORDING_MS) {
      this.actions.cancel();
      this.actions.hint(gesture.cancel ? '已取消录音' : gesture.started === null ? '录音尚未开始，请允许麦克风后再试一次' : '说话时间太短，请再试一次');
      return;
    }
    this.sendOnReady = true;
    this.actions.stop();
  }
  acceptClip() {
    // The five-minute timer can finish while the finger is still down.
    const active = this.active;
    const send = this.sendOnReady || !!(active && !active.cancel && active.started !== null && this.now() - active.started >= MIN_RECORDING_MS);
    this.active = null;
    this.sendOnReady = false;
    return send;
  }
  cancel() {
    this.active = null;
    this.sendOnReady = false;
    this.actions.cancel();
  }
  cancelPointer(id: number) { if (this.active?.id === id) this.cancel(); }
  private now() { return this.actions.now?.() ?? Date.now(); }
}
