# Browser audio encoder assets

Vendored unchanged from the npm package `opus-media-recorder@0.8.0` (MIT and bundled codec licenses in LICENSE.md).
Source: https://github.com/kbumsik/opus-media-recorder

Files: encoderWorker.umd.js and OggOpusEncoder.wasm. The main recorder is dynamically bundled from the pinned npm dependency. Keep these assets in sync when updating that dependency. They are copied by Next static export and distributed with ClassNode; recording never needs a third-party CDN.

To refresh: copy these two files and LICENSE.md from node_modules/opus-media-recorder to this directory, review upstream licenses, update the versioned URL in voice-recorder.tsx, and test Ogg/Opus encoding and the Coze audio-only request again.
