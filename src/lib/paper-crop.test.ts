import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPaper, validCorners} from './paper-crop.ts';

test('finds a light trapezoidal sheet and leaves a low-contrast photo for manual adjustment', () => {
  const width = 100, height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = 20 - (y - 15) * .1;
      const right = 75 + (y - 15) * .15;
      const tone = y >= 15 && y <= 82 && x >= left && x <= right ? 235 : 55;
      data.set([tone, tone, tone, 255], (y * width + x) * 4);
    }
  }
  const image = {width, height, data} as ImageData;
  const corners = detectPaper(image);
  assert.ok(corners && validCorners(corners));
  assert.ok(Math.abs(corners[0].y - .15) < .03);
  assert.ok(Math.abs(corners[2].y - .82) < .03);
  assert.equal(validCorners([corners[0],corners[2],corners[1],corners[3]]),false);
  data.fill(230);
  assert.equal(detectPaper(image), null);
});
