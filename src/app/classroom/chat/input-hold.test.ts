import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInputHold, INPUT_HOLD_MS } from './input-hold.ts';

test('empty input distinguishes typing, holding, movement and interruptions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'window', { value: page, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  class Input extends EventTarget {
    value = ''; disabled = false; readOnly = false; focused = 0;
    focus() { this.focused++; }
    blur() {}
    setPointerCapture() {}
  }
  const input = new Input();
  const calls: string[] = [];
  const cleanup = bindInputHold(input as unknown as HTMLTextAreaElement, {
    available: () => true, begin: () => { calls.push('begin'); return true; },
    move: () => calls.push('move'), release: () => calls.push('release'), cancel: () => calls.push('cancel'),
  });
  t.after(() => { cleanup(); Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document'); });
  const pointer = (type: string, y = 100) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: y });
    input.dispatchEvent(event); return event;
  };
  await t.test('tap focuses input without starting microphone', () => {
    pointer('pointerdown'); t.mock.timers.tick(INPUT_HOLD_MS - 1); pointer('pointerup');
    t.mock.timers.tick(10); assert.deepEqual(calls, []); assert.equal(input.focused, 1);
  });
  await t.test('hold starts once and release survives implicit capture loss', () => {
    pointer('pointerdown'); t.mock.timers.tick(INPUT_HOLD_MS); pointer('pointermove', 20);
    pointer('pointerup'); pointer('lostpointercapture');
    assert.deepEqual(calls.splice(0), ['begin', 'move', 'release']);
    assert.equal(input.focused, 1);
  });
  await t.test('editing existing text retains native pointer behavior', () => {
    input.value = '已有文字'; assert.equal(pointer('pointerdown').defaultPrevented, false);
    t.mock.timers.tick(INPUT_HOLD_MS); assert.deepEqual(calls, []); input.value = '';
  });
  await t.test('movement before threshold abandons recording', () => {
    pointer('pointerdown'); pointer('pointermove', 80); t.mock.timers.tick(INPUT_HOLD_MS); pointer('pointerup');
    assert.deepEqual(calls, []);
  });
  await t.test('pointer cancellation and page hiding cannot leave a delayed microphone request', () => {
    pointer('pointerdown'); pointer('pointercancel'); t.mock.timers.tick(INPUT_HOLD_MS);
    pointer('pointerdown'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(INPUT_HOLD_MS);
    assert.deepEqual(calls, []); doc.hidden = false;
    pointer('pointerdown'); t.mock.timers.tick(INPUT_HOLD_MS); pointer('pointercancel');
    assert.deepEqual(calls.splice(0), ['begin', 'cancel']);
  });
});
