import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceGesture } from './voice-gesture.ts';

function fixture() {
  let now = 1000;
  const calls: string[] = [];
  const hints: string[] = [];
  const gesture = new VoiceGesture({
    now: () => now, start: () => calls.push('start'), stop: () => calls.push('stop'),
    cancel: () => calls.push('cancel'), hint: text => hints.push(text),
  });
  return { gesture, calls, hints, advance: () => { now += 1000; } };
}
test('release sends once even when implicit pointer capture loss follows pointerup', () => {
  const f = fixture(); f.gesture.begin(1, 200); f.gesture.recordingStarted(); f.advance();
  f.gesture.release(1); f.gesture.cancelPointer(1);
  assert.deepEqual(f.calls, ['start', 'stop']);
  assert.equal(f.gesture.acceptClip(), true);
  assert.equal(f.gesture.acceptClip(), false);
});
test('release while permission is pending cancels and never sends late audio', () => {
  const f = fixture(); f.gesture.begin(1); f.gesture.release(1);
  f.gesture.recordingStarted();
  assert.deepEqual(f.calls, ['start', 'cancel']);
  assert.equal(f.gesture.acceptClip(), false);
});
test('slide up cancels; sliding back down restores send intent', () => {
  const f = fixture(); f.gesture.begin(1, 200); f.gesture.recordingStarted(); f.advance();
  assert.equal(f.gesture.move(1, 120), true); f.gesture.release(1);
  assert.equal(f.gesture.acceptClip(), false);
  f.gesture.begin(2, 200); f.gesture.recordingStarted(); f.advance();
  f.gesture.move(2, 100); assert.equal(f.gesture.move(2, 190), false);
  f.gesture.release(2); assert.equal(f.gesture.acceptClip(), true);
});
test('short taps and interrupted touches discard audio instead of sending', () => {
  const f = fixture(); f.gesture.begin(1); f.gesture.recordingStarted(); f.gesture.release(1);
  assert.equal(f.gesture.acceptClip(), false);
  f.gesture.begin(2); f.gesture.recordingStarted(); f.advance(); f.gesture.cancelPointer(2);
  assert.equal(f.gesture.acceptClip(), false);
});
test('tap recording supports explicit finish, and timer completion respects cancel intent', () => {
  const f = fixture(); f.gesture.begin(null); f.gesture.recordingStarted(); f.advance();
  f.gesture.release(null); assert.equal(f.gesture.acceptClip(), true);
  f.gesture.begin(3, 200); f.gesture.recordingStarted(); f.advance();
  assert.equal(f.gesture.acceptClip(), true);
  f.gesture.begin(4, 200); f.gesture.recordingStarted(); f.advance(); f.gesture.move(4, 100);
  assert.equal(f.gesture.acceptClip(), false);
});
