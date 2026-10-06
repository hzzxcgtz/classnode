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

test('★ 位图快照（`image`）：形状对就带上，形状不对就**丢掉它、保作答**', () => {
  const url = '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png';
  const data = { nodes: [{ id: 'n1' }] };
  assert.deepEqual(readDrawingDocument({ tool: 'flowchart', data, image: url }), { tool: 'flowchart', data, image: url });
  // ⚠️ 没有 image 时**不许**凭空造一个 `image: undefined` 的键（那会让「有没有快照」
  //    在序列化之后变得看不出来，也会让对拍/比较逻辑多出一处差别）。
  assert.equal('image' in (readDrawingDocument({ tool: 'flowchart', data }) ?? {}), false);
  // 🔴 形状不对时丢的是**快照**，不是整份作答：真源是 `data`，
  //    为一张可选的图把学生的作答判成「读不出来」是本末倒置。
  for (const bad of ['/etc/passwd', 'https://example.com/x.png', 42, null]) {
    const parsed = readDrawingDocument({ tool: 'flowchart', data, image: bad });
    assert.deepEqual(parsed, { tool: 'flowchart', data }, `形状不对的 image 应当被丢掉：${String(bad)}`);
  }
  // 上传接口也可能给 `.jpeg`（`detectSafeImage` 认它）—— 别在这一侧又把它拒了。
  assert.ok(readDrawingDocument({ tool: 'free', data, image: '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.jpeg' }));
});
