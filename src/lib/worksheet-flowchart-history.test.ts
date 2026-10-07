/**
 * 撤销栈的**行为**判据（★ 2026-10-06 教师：「流程图要提供撤销/重做功能」）。
 *
 * ⚠️ 这里是**真单元测试**（不是源码级判据）：历史栈是纯函数，本仓没有 jsdom 也不妨碍它。
 * 🔴 每一条都要能被变异抓住 —— 见 Task 1 Step 5。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_KEYS_LIMIT,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  clearAllHistories,
  emptyHistory,
  flowchartSignature,
  loadHistory,
  pushHistory,
  redoHistory,
  saveHistory,
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

/*
  ★ 2026-10-07（教师）：「线上文字……**贴着线拖**」。
  🔴 指纹是「这一步算不算变化」的**唯一**判据（见那条变化检测 effect）——
     漏了偏移这一项，学生拖完标签松手**一步都不会记**（按撤销退回去的是上一步，
     看着像「撤销失灵」）。这与绕行点当年那条是同一个坑。
*/
test('指纹：标签的偏移算变化 —— 拖了标签必须能撤销', () => {
  const edge = (data: Record<string, number>) => [{ id: 'e1', source: 'n1', target: 'n2', label: '是', data }];
  const base = flowchartSignature([node()], edge({ labelDX: 10, labelDY: -20 }));
  assert.notEqual(
    flowchartSignature([node()], edge({ labelDX: 30, labelDY: -20 })),
    base,
    '往右挪了 20px 却没进指纹 ⇒ 这一次拖动不会记进撤销栈',
  );
  assert.notEqual(
    flowchartSignature([node()], edge({ labelDX: 10, labelDY: -20, routeX: 99 })),
    base,
    '绕行点也要算（老规矩，这里顺手一起钉住）',
  );
  assert.equal(flowchartSignature([node()], edge({ labelDX: 10, labelDY: -20 })), base, '同样的数据要得到同样的指纹');
});

// ── 跨挂载存活的历史（★ 2026-10-06 教师在真机上发现全屏问题之后加的）──────────

test('按 key 存的历史，换个实例也读得回来 —— 这是「切全屏不丢撤销」的全部依据', () => {
  clearAllHistories();
  const h = pushHistory(emptyHistory<{ tag: string }>(), snap('A'));
  saveHistory('q_1', h);
  // ⚠️ 换一个「实例」（这里只是再调一次）去读 —— 模拟画板被 portal 重挂之后重新挂载。
  assert.equal(loadHistory<{ tag: string }>('q_1').past.length, 1, '存进去的必须能读回来');
  clearAllHistories();
});

test('没存过的 key 拿到空历史 —— 不是 undefined', () => {
  clearAllHistories();
  const fresh = loadHistory<{ tag: string }>('never-saved');
  assert.deepEqual(fresh, { past: [], future: [] });
});

test('不同的 key 互不干扰 —— 一份学习单里两道题不能共用一条历史', () => {
  clearAllHistories();
  saveHistory('q_1', pushHistory(emptyHistory<{ tag: string }>(), snap('A')));
  saveHistory('q_2', emptyHistory<{ tag: string }>());
  assert.equal(loadHistory<{ tag: string }>('q_1').past.length, 1);
  assert.equal(loadHistory<{ tag: string }>('q_2').past.length, 0, 'q_2 不该看到 q_1 的历史');
  clearAllHistories();
});

test('key 太多时丢最久没用过的那个 —— 这张表活到页面卸载为止，必须有盖子', () => {
  clearAllHistories();
  for (let i = 0; i < HISTORY_KEYS_LIMIT + 2; i += 1) {
    saveHistory(`q_${i}`, pushHistory(emptyHistory<{ tag: string }>(), snap(`s${i}`)));
  }
  assert.equal(loadHistory<{ tag: string }>('q_0').past.length, 0, '最老的 q_0 应当已被丢掉');
  assert.equal(loadHistory<{ tag: string }>(`q_${HISTORY_KEYS_LIMIT + 1}`).past.length, 1, '最新的还在');
  // 阳性对照：**中间**那个也得在 —— 否则「丢最老」写成「清空」也能过上面两条。
  assert.equal(loadHistory<{ tag: string }>('q_3').past.length, 1, 'q_3 不该被连累');
  clearAllHistories();
});
