/**
 * 「第几格」的判据（★ 2026-10-07 教师：40 人一起交给智能体）。
 *
 * 🔴 补的是一个**静默**的坑：模型看串格时分会被贴到别人头上，而教师能核对的那张对照表藏在
 *   「查看发送数据」折叠区里 ⇒ 不看就无从核对。这一条把「第几格 · 代号」搬到评分行旁边。
 * ⚠️ 格号**只能**取自载荷条目的序号 —— 另立一套编号必然与联系表对不上（而屏幕上看不出来）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cellLabelOf, cellNumberOf, localizeLegacyLabels } from './worksheet-analysis-cells.ts';

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

/*
  ★ 2026-10-07（教师：标签改用「姓名 + 学号」）——
  老结果里的伪名（`User_00X`）仍要换回真名；但**朴素子串替换不能再用**了：
  标签现在是真名，而真名可能是**别人姓名或正文的子串** ⇒ 静默改错文字。
*/
const BOTH = [
  { studentId: 's1', anonLabel: '张伟#7' },
  { studentId: 's2', anonLabel: '李四#12' },
];
const NAMES = new Map([['s1', '张伟'], ['s2', '李四']]);
const nameOf = (studentId: string) => NAMES.get(studentId) ?? null;

test('★ 老结果里的 User_00X 换回真名', () => {
  assert.equal(
    localizeLegacyLabels('User_001 把第 2 空填成了「氧气」，User_002 少写一步。', BOTH, nameOf),
    '张伟 把第 2 空填成了「氧气」，李四 少写一步。',
  );
});

test('🔴 反面对照：真名出现在正文里**不许**被替换（新结果里标签就是真名）', () => {
  const text = '新结果里已经是真名：张伟#7 的思路很清楚。张伟还提到了「张伟式写法」。';
  assert.equal(
    localizeLegacyLabels(text, BOTH, nameOf), text,
    '朴素子串替换会把正文里恰好出现的「张伟」也当成标签改掉 —— 而它现在是别人的真名',
  );
});

test('读不出真名时原样返回（宁可不说，也不改错）', () => {
  assert.equal(localizeLegacyLabels('User_001 没交', BOTH, () => null), 'User_001 没交');
  assert.equal(localizeLegacyLabels(null, BOTH, nameOf), null);
  assert.equal(localizeLegacyLabels('', BOTH, nameOf), '', '空串照旧是空串');
});
