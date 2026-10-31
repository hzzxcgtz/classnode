import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWheelZoomChange } from './image-wheel-zoom.ts';
test('wheel zoom is slow, symmetric, and bounded even for large deltas', () => {
  assert.equal(imageWheelZoomChange(120), -.03);
  assert.equal(imageWheelZoomChange(-120), .03);
  assert.equal(imageWheelZoomChange(100000), -.03);
  assert.equal(imageWheelZoomChange(0), 0);
  assert.equal(imageWheelZoomChange(Number.NaN), 0);
  assert.ok(Math.abs(imageWheelZoomChange(1)) < .001);
});
test('line and page wheel units are normalized before limiting the step', () => {
  assert.equal(imageWheelZoomChange(1, 1), imageWheelZoomChange(16));
  assert.equal(imageWheelZoomChange(1, 2), imageWheelZoomChange(800));
});
