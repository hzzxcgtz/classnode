import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAWING_DOCUMENT_MAX_CHARS,
  drawingDocumentIsEmpty,
  keepsDrawingDocument,
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

/*
  ★ 2026-10-07（教师）：「如果教师设置了初始化图，学生在打开这一题开始作图前，绘图区域应该是
  有内容的，但在**监控面板里，教师的预设图都没有显示出来**」。

  🔴 根因是**两条判据叠在一起**，两条都把「学生自己那份是空的」当成了「没东西可看」：
     · `update` 里：文档空 ⇒ 整份 `drawing`（**连快照一起**）丢掉；
     · `updateImage` 里：`data === undefined` 直接 return ⇒ 第一张快照进不来。
   而底稿按设计**本来就不在学生的 `data` 里**（`subtractFlowchart` 剥掉了，「底稿不算他的作答」✓），
   却实实在在地画在**快照**上（快照画的是「底稿 + 学生画的」）。
*/
test('★ 有底稿、学生还没动笔 ⇒ 这一份**要交**（否则教师的预设图看不到）', () => {
  const image = '/uploads/chat/chat-3f2a1c9e-8b7d-4e5f-9a1b-2c3d4e5f6a7b.png';
  const starterOnly = { tool: 'flowchart' as const, data: { nodes: [], edges: [] }, image };
  assert.equal(drawingDocumentIsEmpty(starterOnly), true, '前提：学生自己那份确实是空的（底稿不算他的作答）');
  assert.equal(keepsDrawingDocument(starterOnly), true, '但有快照 ⇒ 要交 —— 那张图就是教师看到的整张画');
  // 反面对照：没底稿也没动笔 ⇒ 仍然算空（不然「只是打开了这道题」会被算成「作答中」）。
  assert.equal(keepsDrawingDocument({ tool: 'flowchart', data: { nodes: [], edges: [] } }), false, '没快照也没画 ⇒ 不交');
  // 学生画了东西 ⇒ 交（老行为，别被这次改动碰坏）。
  assert.equal(keepsDrawingDocument({ tool: 'flowchart', data: { nodes: [{ id: 'n1' }], edges: [] } }), true, '画了东西就要交');
  // 四种工具都按同一套判据（`free` 用 paths、`math` 用 elements、导图看 nodeData.children）。
  assert.equal(keepsDrawingDocument({ tool: 'free', data: { paths: [] }, image }), true, '基础绘图同理');
  assert.equal(keepsDrawingDocument({ tool: 'math', data: { elements: [] }, image }), true, '数学作图同理');
  assert.equal(
    keepsDrawingDocument({ tool: 'mind-map', data: { nodeData: { topic: '中心主题', children: [] } }, image }),
    true,
    '思维导图同理',
  );
});
