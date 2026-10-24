import test from 'node:test';
import assert from 'node:assert/strict';
import { readImageAnnotations, writeImageAnnotations } from './image-annotation-session.ts';
import { imageAnnotationPoint, type AnnotationStroke } from './temporary-annotations.ts';

test('图片分别保留批注，清空一张不会影响其他图片', () => {
  const strokes: AnnotationStroke[] = [{ id: 1, tool: 'pen', color: 'red', width: 3, points: [{ x: 30, y: 50 }] }];
  writeImageAnnotations('image-a', strokes);
  assert.deepEqual(readImageAnnotations('image-a'), strokes);
  assert.deepEqual(readImageAnnotations('image-b'), []);
  writeImageAnnotations('image-b', strokes);
  writeImageAnnotations('image-a', []);
  assert.deepEqual(readImageAnnotations('image-a'), []);
  assert.deepEqual(readImageAnnotations('image-b'), strokes);
  writeImageAnnotations('image-b', []);
});

test('不同窗口尺寸和缩放下，图片批注使用相同的归一化坐标', () => {
  for (const width of [240, 720, 1200]) for (const zoom of [.3, 1, 3]) {
    const scale = width / 1000 * zoom;
    const restored = imageAnnotationPoint({ x: 800 + 100 * scale, y: 400 - 50 * scale }, { x: 800, y: 400 }, scale, 0);
    assert.ok(Math.abs(restored.x - 100) < 1e-9);
    assert.ok(Math.abs(restored.y + 50) < 1e-9);
  }
});
