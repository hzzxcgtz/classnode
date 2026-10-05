import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAWING_DOCUMENT_MAX_CHARS,
  readDrawingDocument,
} from './worksheet-drawing-document.ts';

test('第三方绘图文档只接受四种工具，并复制可序列化数据', () => {
  const data = { nodes: [{ id: 'n1', label: '观察' }] };
  const parsed = readDrawingDocument({ tool: 'flowchart', data });
  assert.deepEqual(parsed, { tool: 'flowchart', data });
  assert.notEqual(parsed?.data, data);
  assert.equal(readDrawingDocument({ tool: 'unknown', data: {} }), null);
  assert.equal(readDrawingDocument({ tool: 'free' }), null);
});

test('第三方绘图文档拒绝不可序列化或超过上限的数据', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(readDrawingDocument({ tool: 'free', data: circular }), null);
  assert.equal(readDrawingDocument({
    tool: 'free',
    data: { text: 'x'.repeat(DRAWING_DOCUMENT_MAX_CHARS + 1) },
  }), null);
});
