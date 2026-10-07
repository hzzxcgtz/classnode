/**
 * ★ 2026-10-07（教师：「查一下第 11 题为什么会重复保存」）——
 * **发布闸**：这一次内容变了没有。
 *
 * 🔴 没有这道闸时的自激环（构造上成立，已在源码里逐条追过）：
 *   ① 流程图画板的发布 effect 依赖里有 `onChange`；
 *   ② `onChange`（`drawing-tool-body.tsx` 的 `update`）身份取决于 `drawingDocument.image`；
 *   ③ 抓图**每次都上传一个新文件、拿一个新 URL**（`uploadDrawingRaster` 不去重）⇒ `image` 变
 *      ⇒ `onChange` 换身份 ⇒ **effect 重跑**；
 *   ④ 而 effect 里**无条件**调 `onChange(...)`（一次保存）**和** `scheduleRaster()`（又一次抓图）。
 *   ⇒ 自激：每约 1 秒一次保存 + 一次上传。而学生端**所有题目同时挂载**
 *     （`worksheet-panel.tsx` 把整列题都渲染出来）⇒ **每一块挂着的流程图都在跑这个环**，
 *     与学生在哪一题上画**无关**。
 *   ⇒ 教师看到的就是「学生在第 12 题上画，第 11 题一直保存」。
 *
 * ⚠️ 思维导图那一档**不犯**这个毛病：它的发布挂在库的事件上（`operation` / `changeDirection` /
 *   `expandNode`），只在学生动手时发生 —— 事件驱动，不是「每次渲染都发」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowPayloadSignature, shouldPublishFlow } from './worksheet-flowchart-publish.ts';

test('🔴 同一份内容连发两次 ⇒ 第二次**不发**（这就是那道闸）', () => {
  const signature = flowPayloadSignature({ nodes: [{ id: 'n1' }], edges: [] });
  assert.equal(shouldPublishFlow(signature, signature), false,
    '内容没变还发 ⇒ 与「抓图回来 ⇒ onChange 换身份 ⇒ effect 重跑」构成自激环');
});

test('★ 内容变了 ⇒ 发（别把真改动也一起挡掉）', () => {
  const before = flowPayloadSignature({ nodes: [{ id: 'n1' }], edges: [] });
  const after = flowPayloadSignature({ nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [] });
  assert.equal(shouldPublishFlow(before, after), true);
});

test('★ 首帧（还没有上一份）⇒ 发 —— 首帧要抓快照（底稿靠它进教师那一格）', () => {
  assert.equal(shouldPublishFlow(null, flowPayloadSignature({ nodes: [], edges: [] })), true);
});

test('签名的粒度是**内容**，不是对象身份（每次渲染都会造新对象）', () => {
  assert.equal(
    flowPayloadSignature({ nodes: [{ id: 'n1' }], edges: [] }),
    flowPayloadSignature({ nodes: [{ id: 'n1' }], edges: [] }),
    '换了个对象、内容一样 ⇒ 签名必须一样（否则那道闸形同虚设）',
  );
});
