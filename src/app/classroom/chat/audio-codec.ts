let fallback: typeof import('opus-media-recorder').default | undefined;
export const supportsOgg = () => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus');
export async function prepareAudioCodec() {
  if (!supportsOgg()) fallback = (await import('opus-media-recorder')).default;
}
export function createAudioRecorder(stream: MediaStream): MediaRecorder {
  const options = { mimeType: 'audio/ogg;codecs=opus', audioBitsPerSecond: 32_000 };
  if (supportsOgg()) return new MediaRecorder(stream, options);
  if (!fallback) throw new Error('录音组件尚未加载，请重试。');
  const base = '/vendor/opus-media-recorder-0.8.0/';
  let worker: Worker | undefined;
  const recorder = new fallback(stream, options, {
    encoderWorkerFactory: () => { worker = new Worker(`${base}encoderWorker.umd.js`); return worker; },
    OggOpusEncoderWasmPath: new URL(`${base}OggOpusEncoder.wasm`, window.location.href).href,
  });
  let started = false;
  recorder.addEventListener('start', () => { started = true; }, { once: true });
  const stop = recorder.stop.bind(recorder);
  recorder.stop = () => {
    try { stop(); } finally {
      // Stopping before WASM loads cannot produce a final chunk. The owner has
      // cancelled this session; don't leave an uninitialized worker behind.
      if (!started) worker?.terminate();
    }
  };
  return recorder;
}
