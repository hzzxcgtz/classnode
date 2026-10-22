import test from 'node:test';
import assert from 'node:assert/strict';
import { worksheetPhotoCompressionPlan } from './worksheet-photo-upload.ts';

test('small photos stay original; larger iPad 9 photos retain every pixel', () => {
  assert.equal(worksheetPhotoCompressionPlan(1024 * 1024, 3264, 2448), null);
  assert.deepEqual(worksheetPhotoCompressionPlan(4 * 1024 * 1024, 3264, 2448), { width: 3264, height: 2448, quality: 0.9 });
  assert.deepEqual(worksheetPhotoCompressionPlan(4 * 1024 * 1024, 2448, 3264), { width: 2448, height: 3264, quality: 0.9 });
});
test('very large photos fit a bounded canvas without distortion or upscaling', () => {
  for (const [width, height] of [[8000, 6000], [6000, 8000], [8000, 8000], [12000, 2000]]) {
    const plan = worksheetPhotoCompressionPlan(10 * 1024 * 1024, width, height)!;
    assert.ok(Math.max(plan.width, plan.height) <= 4096);
    assert.ok(plan.width * plan.height <= 12_010_000);
    assert.ok(plan.width <= width && plan.height <= height);
    assert.ok(Math.abs(plan.width / plan.height - width / height) < 0.003);
  }
  assert.equal(worksheetPhotoCompressionPlan(3 * 1024 * 1024, 0, 3000), null);
});
