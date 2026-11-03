import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareAnalysisImageUpload } from '../services/analysis-image-upload.js';

test('rendered photo upload becomes smaller WebP without changing dimensions or source', async () => {
  const pixels = Buffer.alloc(768 * 1024 * 3);
  let seed = 12345;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = 180 + (seed >>> 28);
  }
  const png = await sharp(pixels, { raw: { width: 768, height: 1024, channels: 3 } }).png().toBuffer();
  const original = Buffer.from(png);
  const result = await prepareAnalysisImageUpload(png);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.extension, 'webp');
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 768);
  assert.equal(metadata.height, 1024);
  assert.ok(result.buffer.length < png.length * 0.95);
  assert.deepEqual(png, original);
});

test('tiny input never grows during upload preparation', async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  const result = await prepareAnalysisImageUpload(png);
  if (result.extension === 'png') assert.equal(result.buffer, png);
  else assert.ok(result.buffer.length < png.length * 0.95);
});

test('encoding failure retains the supplied buffer', async () => {
  const png = Buffer.from('invalid image');
  assert.deepEqual(await prepareAnalysisImageUpload(png), { buffer: png, extension: 'png' });
});
