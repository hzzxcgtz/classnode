import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DRAWING_BACKGROUND,
  DRAWING_BACKGROUND_PRESETS,
  drawingModesFor,
  readDrawingBackground,
  readDrawingExtensions,
  readDrawingTool,
} from './worksheet-drawing.ts';

const drawing = (data: Record<string, unknown> = {}) => ({ type: 'drawing', data });

test('旧绘图题默认只有自由绘图 + 点阵底图', () => {
  assert.deepEqual(readDrawingExtensions(drawing()), []);
  assert.equal(readDrawingTool(drawing()), 'free');
  assert.deepEqual(drawingModesFor(drawing()), ['free']);
  // ⊘ 2026-10-06（教师）：「背景默认应该是点阵图」——这一条原来断言的是
  //   `{ preset: 'blank', url: null }`（列表第一位）。默认值**有意**改了，所以这里跟着改：
  //   没挑过背景的作图题现在给点阵（便于定位与对齐），空白仍是一个**可选**档。
  assert.deepEqual(readDrawingBackground(drawing()), {
    preset: 'dot-grid',
    url: '/worksheet/drawing-backgrounds/dot-grid.svg',
  });
});

test('旧版多选配置仍能读取，但迁移为第一个合法的单选工具', () => {
  const node = drawing({ drawingExtensions: ['flowchart', 'math', 'math', 'unknown', 3, 'mind-map'] });
  assert.deepEqual(readDrawingExtensions(node), ['math', 'mind-map', 'flowchart']);
  assert.equal(readDrawingTool(node), 'math');
  assert.deepEqual(drawingModesFor(node), ['math']);
});

test('新版作图工具严格单选，非法值回落到基础绘图', () => {
  for (const tool of ['free', 'math', 'mind-map', 'flowchart'] as const) {
    assert.equal(readDrawingTool(drawing({ drawingTool: tool })), tool);
    assert.deepEqual(drawingModesFor(drawing({ drawingTool: tool })), [tool]);
  }
  assert.equal(readDrawingTool(drawing({ drawingTool: 'unknown' })), 'free');
});

test('旧底图选择全部归一为点阵；只有数学作图接受安全的图片底图', () => {
  for (const preset of DRAWING_BACKGROUND_PRESETS) {
    assert.deepEqual(readDrawingBackground(drawing({ drawingBackgroundPreset: preset.value })), {
      preset: 'dot-grid',
      url: '/worksheet/drawing-backgrounds/dot-grid.svg',
    });
  }
  assert.deepEqual(readDrawingBackground(drawing({
    drawingTool: 'math',
    drawingBackgroundPreset: 'custom',
    drawingBackgroundImageUrl: '/uploads/chat/chat-123e4567-e89b-12d3-a456-426614174000.png',
  })), {
    preset: 'custom',
    url: '/uploads/chat/chat-123e4567-e89b-12d3-a456-426614174000.png',
  });
  assert.deepEqual(readDrawingBackground(drawing({
    drawingTool: 'math', drawingBackgroundPreset: 'custom', drawingBackgroundImageUrl: 'https://example.com/tracker.png',
  })), { preset: 'dot-grid', url: '/worksheet/drawing-backgrounds/dot-grid.svg' });
  assert.equal(readDrawingBackground(drawing({
    drawingTool: 'flowchart', drawingBackgroundPreset: 'custom',
    drawingBackgroundImageUrl: '/uploads/chat/chat-123e4567-e89b-12d3-a456-426614174000.png',
  })).preset, 'dot-grid');
});

test('★ 2026-10-06（教师）：「背景默认应该是点阵图」', () => {
  // 没挑过（字段缺席 / 认不出的值）⇒ 点阵；**不是**第一位那个「空白」。
  assert.equal(readDrawingBackground({ type: 'drawing', data: {} }).preset, 'dot-grid');
  assert.equal(readDrawingBackground({ type: 'drawing', data: { drawingBackgroundPreset: 'no-such' } }).preset, 'dot-grid');
  assert.equal(DEFAULT_DRAWING_BACKGROUND, 'dot-grid');
  // 点阵有图可贴（否则学生会看到一个「点阵」但其实是纯白）。
  assert.match(String(readDrawingBackground({ type: 'drawing', data: {} }).url), /dot-grid\.svg$/);
  // 历史选择也统一归一，教师端不再提供背景预设选择器。
  assert.equal(readDrawingBackground({ type: 'drawing', data: { drawingBackgroundPreset: 'blank' } }).preset, 'dot-grid');
  assert.equal(readDrawingBackground({ type: 'drawing', data: { drawingBackgroundPreset: 'coordinate' } }).preset, 'dot-grid');
});
