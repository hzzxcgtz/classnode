import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAWING_BACKGROUND_PRESETS,
  drawingModesFor,
  readDrawingBackground,
  readDrawingExtensions,
  readDrawingTool,
} from './worksheet-drawing.ts';

const drawing = (data: Record<string, unknown> = {}) => ({ type: 'drawing', data });

test('旧绘图题默认只有自由绘图与空白底图', () => {
  assert.deepEqual(readDrawingExtensions(drawing()), []);
  assert.equal(readDrawingTool(drawing()), 'free');
  assert.deepEqual(drawingModesFor(drawing()), ['free']);
  assert.deepEqual(readDrawingBackground(drawing()), { preset: 'blank', url: null });
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

test('内置底图都能读出发布路径，自定义底图只接受安全上传地址', () => {
  for (const preset of DRAWING_BACKGROUND_PRESETS) {
    assert.deepEqual(readDrawingBackground(drawing({ drawingBackgroundPreset: preset.value })), {
      preset: preset.value,
      url: preset.url,
    });
  }
  assert.deepEqual(readDrawingBackground(drawing({
    drawingBackgroundPreset: 'custom',
    drawingBackgroundImageUrl: '/uploads/chat/chat-123e4567-e89b-12d3-a456-426614174000.png',
  })), {
    preset: 'custom',
    url: '/uploads/chat/chat-123e4567-e89b-12d3-a456-426614174000.png',
  });
  assert.deepEqual(readDrawingBackground(drawing({
    drawingBackgroundPreset: 'custom', drawingBackgroundImageUrl: 'https://example.com/tracker.png',
  })), { preset: 'blank', url: null });
});
