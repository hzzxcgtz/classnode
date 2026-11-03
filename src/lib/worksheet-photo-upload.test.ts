import test from 'node:test';
import assert from 'node:assert/strict';
import { worksheetPhotoCompressionPlan } from './worksheet-photo-upload.ts';

test('small photos stay original; iPad photos use 1600px quality 70', () => {
  assert.equal(worksheetPhotoCompressionPlan(100 * 1024, 3264, 2448), null);
  assert.deepEqual(worksheetPhotoCompressionPlan(4 * 100 * 1024, 3264, 2448), { width: 1600, height: 1200, quality: 0.7 });
  assert.deepEqual(worksheetPhotoCompressionPlan(4 * 1024 * 1024, 2448, 3264), { width: 1200, height: 1600, quality: 0.7 });
});
test('very large photos fit a bounded canvas without distortion or upscaling', () => {
  for (const [width, height] of [[8000, 6000], [6000, 8000], [8000, 8000], [12000, 2000]]) {
    const plan = worksheetPhotoCompressionPlan(10 * 1024 * 1024, width, height)!;
    assert.ok(Math.max(plan.width, plan.height) <= 1600);
    assert.ok(plan.width * plan.height <= 2_560_000);
    assert.ok(plan.width <= width && plan.height <= height);
    assert.ok(Math.abs((plan.width / plan.height) / (width / height) - 1) < 0.003);
  }
  assert.deepEqual(worksheetPhotoCompressionPlan(500 * 1024, 800, 600), {width:800,height:600,quality:0.7});
  assert.deepEqual(worksheetPhotoCompressionPlan(1024 * 1024, 3264, 2448), {width:1600,height:1200,quality:0.7});
  assert.equal(worksheetPhotoCompressionPlan(3 * 1024 * 1024, 0, 3000), null);
});
