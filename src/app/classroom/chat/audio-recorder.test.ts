import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioRecorderSession } from './audio-recorder.ts';

test('cancelling while the encoder loads never prompts for microphone permission later', async () => {
  let finish!: () => void;
  const session = new AudioRecorderSession({
    prepare: () => new Promise<void>(resolve => { finish = resolve; }),
    getMedia: async () => { assert.fail('cancelled encoder must not request microphone'); },
    createRecorder: () => { throw new Error('must not construct recorder'); },
    onState: () => {}, onReady: () => assert.fail('must not publish audio'), onError: () => assert.fail('cancellation is not an error'),
  });
  const pending = session.start();
  session.cancel(); finish(); await pending;
});

function fixture(getMedia?: () => Promise<MediaStream>, failCreation = false) {
  const states: string[] = [];
  const clips: Blob[] = [];
  const errors: unknown[] = [];
  let released = 0;
  const track = { stop: () => { released++; }, onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const recorder = {
    state: 'inactive', mimeType: 'audio/webm',
    onstart: null as null | (() => void),
    ondataavailable: null as null | ((event: { data: Blob }) => void),
    onstop: null as null | (() => void), onerror: null as null | (() => void),
    start() { this.state = 'recording'; this.onstart?.(); },
    stop() { this.state = 'inactive'; },
  };
  const session = new AudioRecorderSession({
    getMedia: getMedia || (async () => stream),
    createRecorder: () => { if (failCreation) throw new Error('unsupported encoder'); return recorder as unknown as MediaRecorder; },
    onState: state => states.push(state), onReady: blob => clips.push(blob), onError: error => errors.push(error),
  });
  return { session, recorder, stream, states, clips, errors, released: () => released };
}

test('late microphone permission after cancellation releases tracks and never starts recording', async () => {
  let resolve!: (stream: MediaStream) => void;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.session.start();
  f.session.cancel();
  resolve(f.stream);
  await pending;
  assert.equal(f.released(), 1);
  assert.equal(f.recorder.state, 'inactive');
  assert.deepEqual(f.states, ['requesting', 'idle']);
});

test('stop releases microphone immediately but retains the final encoded chunk for playback', async () => {
  const f = fixture();
  await f.session.start();
  f.recorder.ondataavailable?.({ data: new Blob(['first']) });
  f.session.stop();
  assert.equal(f.released(), 1);
  f.recorder.ondataavailable?.({ data: new Blob(['last']) });
  f.recorder.onstop?.();
  assert.equal(await f.clips[0].text(), 'firstlast');
  assert.equal(f.clips[0].type, 'audio/webm');
  assert.equal(f.states[f.states.length - 1], 'idle');
});

test('cancellation invalidates queued completion and never publishes a discarded clip', async () => {
  const f = fixture();
  await f.session.start();
  const lateStop = f.recorder.onstop;
  const lateChunk = f.recorder.ondataavailable;
  f.session.cancel();
  lateChunk?.({ data: new Blob(['discarded']) });
  lateStop?.();
  assert.equal(f.released(), 1);
  assert.equal(f.clips.length, 0);
  assert.equal(f.recorder.state, 'inactive');
});

test('recorder construction failure releases already acquired microphone', async () => {
  const f = fixture(undefined, true);
  await f.session.start();
  assert.equal(f.released(), 1);
  assert.equal(f.errors.length, 1);
  assert.equal(f.states[f.states.length - 1], 'idle');
});

test('empty output reports failure rather than publishing an unplayable recording', async () => {
  const f = fixture();
  await f.session.start();
  f.session.stop();
  f.recorder.onstop?.();
  assert.equal(f.clips.length, 0);
  assert.equal(f.errors.length, 1);
});

test('device interruption discards unfinished audio instead of automatically sending it', async () => {
  const f = fixture();
  await f.session.start();
  f.recorder.ondataavailable?.({ data: new Blob(['unfinished speech']) });
  const lateStop = f.recorder.onstop;
  f.stream.getAudioTracks()[0].onended?.(new Event('ended'));
  lateStop?.();
  assert.equal(f.clips.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.released(), 1);
});

test('encoder initialization does not display recording until the actual start event', async () => {
  const f = fixture();
  f.recorder.start = function () { this.state = 'recording'; };
  await f.session.start();
  assert.equal(f.states[f.states.length - 1], 'requesting');
  const lateStart = f.recorder.onstart;
  f.session.cancel(); lateStart?.();
  assert.equal(f.states[f.states.length - 1], 'idle');
  assert.equal(f.released(), 1);
});
