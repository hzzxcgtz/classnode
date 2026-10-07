/**
 * 「第几格」的判据（★ 2026-10-07 教师：40 人一起交给智能体）。
 *
 * 🔴 补的是一个**静默**的坑：模型看串格时分会被贴到别人头上，而教师能核对的那张对照表藏在
 *   「查看发送数据」折叠区里 ⇒ 不看就无从核对。这一条把「第几格 · 代号」搬到评分行旁边。
 * ⚠️ 格号**只能**取自载荷条目的序号 —— 另立一套编号必然与联系表对不上（而屏幕上看不出来）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cellLabelOf, cellNumberOf } from './worksheet-analysis-cells.ts';

const ENTRIES = [
  { studentId: 's1', anonLabel: 'User_001' },
  { studentId: 's2', anonLabel: 'User_002' },
  { studentId: 's3', anonLabel: 'User_003' },
];

test('格号就是载荷里的序号 +1（与联系表同一套编号）', () => {
  assert.deepEqual(cellNumberOf(ENTRIES, 's1'), { cell: 1, anonLabel: 'User_001' });
  assert.deepEqual(cellNumberOf(ENTRIES, 's3'), { cell: 3, anonLabel: 'User_003' });
  assert.equal(cellLabelOf(ENTRIES, 's2'), '第 2 格 · User_002');
});

test('⭐ 查不到就回 null —— 宁可不说，也不编一个号', () => {
  // 学生可能已经被移出这份学习单（条目里没有他）：那时编一个号出来，
  // 教师会拿着一个不存在的格子去核对，比不说更坏。
  assert.equal(cellNumberOf(ENTRIES, 'nobody'), null);
  assert.equal(cellLabelOf(ENTRIES, 'nobody'), null);
});
