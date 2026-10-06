/**
 * 撤销栈的**行为**判据（★ 2026-10-06 教师：「流程图要提供撤销/重做功能」）。
 *
 * ⚠️ 这里是**真单元测试**（不是源码级判据）：历史栈是纯函数，本仓没有 jsdom 也不妨碍它。
 * 🔴 每一条都要能被变异抓住 —— 见 Task 1 Step 5。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  emptyHistory,
  flowchartSignature,
  pushHistory,
  redoHistory,
  undoHistory,
} from './worksheet-flowchart-history.ts';

const snap = (tag: string) => ({ tag });

test('push 之后能撤销回上一份', () => {
  const h = pushHistory(emptyHistory<{ tag: string }>(), snap('A'));
  const step = undoHistory(h, snap('B'));
  assert.ok(step);
  assert.equal(step.snapshot.tag, 'A', '撤销要回到压进去的那一份');
  assert.equal(step.history.past.length, 0);
  assert.equal(step.history.future.length, 1, '被撤掉的那一份要进 future，否则重做不了');
});

test('撤销之后能重做', () => {
  const h = pushHistory(emptyHistory<{ tag: string }>(), snap('A'));
  const undone = undoHistory(h, snap('B'));
  assert.ok(undone);
  const redone = redoHistory(undone.history, undone.snapshot);
  assert.ok(redone);
  assert.equal(redone.snapshot.tag, 'B', '重做要回到撤销前那一份');
});

test('新操作清空重做栈', () => {
  const h = pushHistory(emptyHistory<{ tag: string }>(), snap('A'));
  const undone = undoHistory(h, snap('B'));
  assert.ok(undone);
  const after = pushHistory(undone.history, snap('A'));
  assert.equal(after.future.length, 0, '撤销后又做了新操作 ⇒ 原来那条「未来」已经不存在了');
});

test('到上限丢最老的那一份（不是丢最新的）', () => {
  let h = emptyHistory<{ tag: string }>();
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) h = pushHistory(h, snap(`s${i}`));
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[0].tag, 's5', '丢的必须是**最老**的；丢最新的等于撤销键突然失灵');
  assert.equal(h.past[h.past.length - 1].tag, `s${HISTORY_LIMIT + 4}`);
});

test('栈空时撤销返回 null，重做同理', () => {
  assert.equal(undoHistory(emptyHistory<{ tag: string }>(), snap('A')), null);
  assert.equal(redoHistory(emptyHistory<{ tag: string }>(), snap('A')), null);
  assert.equal(canUndo(emptyHistory()), false);
  assert.equal(canRedo(emptyHistory()), false);
});

// ── 指纹：这一节是本次最容易做错的地方（规格 §三）──────────────────────

const node = (over: Record<string, unknown> = {}) => ({
  id: 'n1', position: { x: 10, y: 20 }, data: { label: '处理过程', kind: 'process' }, ...over,
});

test('指纹：选中不算变化 —— 否则点一下框就等于做了一步', () => {
  const before = flowchartSignature([node()], []);
  const after = flowchartSignature([node({ selected: true })], []);
  assert.equal(after, before, 'React Flow 的 onNodesChange 会为「选中」触发；它绝不能进历史');
});

test('指纹：尺寸测量不算变化', () => {
  const before = flowchartSignature([node()], []);
  const after = flowchartSignature([node({ measured: { width: 150, height: 54 } })], []);
  assert.equal(after, before, 'measured 是库量出来的，不是学生的编辑');
});

test('指纹：位置 / 文字 / 连线算变化（反面对照）', () => {
  const base = flowchartSignature([node()], []);
  assert.notEqual(flowchartSignature([node({ position: { x: 11, y: 20 } })], []), base, '挪了 1px 也要算');
  assert.notEqual(flowchartSignature([node({ data: { label: '改了', kind: 'process' } })], []), base, '改了字要算');
  const edge = { id: 'e1', source: 'n1', target: 'n2' };
  assert.notEqual(flowchartSignature([node()], [edge]), base, '多了一条线要算');
});
