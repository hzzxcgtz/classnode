declare module 'opus-media-recorder' {
  const Recorder: {
    new(stream: MediaStream, options: MediaRecorderOptions, workerOptions: {
      encoderWorkerFactory: () => Worker;
      OggOpusEncoderWasmPath: string;
    }): MediaRecorder;
  };
  export default Recorder;
}
