export const INPUT_HOLD_MS = 400;

/** Delay microphone access so an ordinary tap can still focus the empty text field. */
export function bindInputHold(input: HTMLTextAreaElement, actions: {
  available: () => boolean;
  begin: (id: number, y: number) => boolean;
  move: (id: number, y: number) => void;
  release: (id: number) => void;
  cancel: (id: number) => void;
}) {
  let press: { id: number; x: number; y: number; recording: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const cancel = () => {
    clearTimer();
    if (press?.recording) actions.cancel(press.id);
    press = null;
  };
  const down = (event: PointerEvent) => {
    if (press || !event.isPrimary || event.button !== 0 || input.value || input.disabled || input.readOnly || !actions.available()) return;
    // Focus on a short release instead, so a hold does not first open the iPad keyboard.
    event.preventDefault();
    suppressClick = false;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, recording: false };
    input.setPointerCapture(event.pointerId);
    timer = setTimeout(() => {
      timer = undefined;
      if (!press || input.value || !actions.available()) { cancel(); return; }
      input.blur();
      suppressClick = true;
      press.recording = actions.begin(press.id, press.y);
    }, INPUT_HOLD_MS);
  };
  const move = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    if (press.recording) actions.move(press.id, event.clientY);
    else if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) cancel();
  };
  const up = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    const previous = press;
    clearTimer(); press = null;
    if (previous.recording) actions.release(previous.id);
    else if (!suppressClick) input.focus();
  };
  const lost = (event: PointerEvent) => { if (press?.id === event.pointerId) cancel(); };
  const menu = (event: Event) => { if (press || suppressClick) event.preventDefault(); };
  const click = (event: Event) => { if (suppressClick) { event.preventDefault(); input.blur(); suppressClick = false; } };
  const hidden = () => { if (document.hidden) cancel(); };
  input.addEventListener('pointerdown', down);
  input.addEventListener('pointermove', move);
  input.addEventListener('pointerup', up);
  input.addEventListener('pointercancel', lost);
  input.addEventListener('lostpointercapture', lost);
  input.addEventListener('contextmenu', menu);
  input.addEventListener('click', click);
  input.addEventListener('input', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    cancel();
    input.removeEventListener('pointerdown', down);
    input.removeEventListener('pointermove', move);
    input.removeEventListener('pointerup', up);
    input.removeEventListener('pointercancel', lost);
    input.removeEventListener('lostpointercapture', lost);
    input.removeEventListener('contextmenu', menu);
    input.removeEventListener('click', click);
    input.removeEventListener('input', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('pagehide', cancel);
    document.removeEventListener('visibilitychange', hidden);
  };
}
