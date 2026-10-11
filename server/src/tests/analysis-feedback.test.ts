import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysisFeedback, readAnalysisFeedback, mergeAnalysisFeedback, feedbackInstruction } from '../services/analysis-feedback.js';
const entries = [{ studentId: 'a', anonLabel: '张伟#1' }, { studentId: 'b', anonLabel: '张伟#2' }];
const raw = (data: unknown) => `### 整体情况\n部分同学需要巩固。\n<classnode-feedback>${JSON.stringify(data)}</classnode-feedback>`;

test('完整标签区分同名学生，人数去重，逐生建议与评分无关', () => {
  const parsed = parseAnalysisFeedback(raw({ groups: [{ id: 'g1', students: ['张伟#2', '张伟#2'] }], students: [{ student: '张伟#2', advice: '比较两条边。' }, { student: '张伟#1', advice: '先检查单位。' }] }), entries);
  assert.deepEqual(parsed.feedback.groups, [{ id: 'g1', studentIds: ['b'] }]);
  assert.deepEqual(parsed.feedback.students.map(row => row.studentId), ['b', 'a']);
  assert.deepEqual(parsed.feedback.missing, []);
  assert.ok(!parsed.narrative.includes('classnode-feedback'));
  assert.match(feedbackInstruction(entries), /与 AI 评分开关无关/);
});

test('不猜只返回姓名的身份，不接受名单外成员或重复组标识', () => {
  const parsed = parseAnalysisFeedback(raw({ groups: [{ id: 'g1', students: ['张伟#1', '陌生人#4'] }, { id: 'g2', students: ['张伟#1'] }, { id: 'g2', students: ['张伟#2'] }], students: [{ student: '张伟', advice: '加油' }, { student: '陌生人#4', advice: '加油' }] }), entries);
  assert.deepEqual(parsed.feedback.groups, []);
  assert.deepEqual(parsed.feedback.students, []);
  assert.deepEqual(parsed.feedback.missing, ['a', 'b']);
});

test('重复反馈不取任意一条，缺失、坏 JSON 或重复机器块保留报告并标明缺失', () => {
  const text = raw({ students: [{ student: '张伟#1', advice: '甲' }, { student: '张伟#1', advice: '乙' }] });
  assert.deepEqual(parseAnalysisFeedback(text, entries).feedback.students, []);
  for (const body of ['报告', '报告<classnode-feedback>{bad}</classnode-feedback>', text + text]) {
    const parsed = parseAnalysisFeedback(body, entries);
    assert.deepEqual(parsed.feedback.missing, ['a', 'b']);
    assert.ok(!parsed.narrative.includes('classnode-feedback'));
  }
});

test('读取时过滤不属于当前题目的名单；历史评分保持兼容', () => {
  const feedback = parseAnalysisFeedback(raw({ groups: [{ id: 'g1', students: ['张伟#1', '张伟#2'] }], students: [{ student: '张伟#1', advice: '检查单位。' }, { student: '张伟#2', advice: '比较边长。' }] }), entries).feedback;
  const stored = { scores: [], analysisFeedback: feedback };
  const read = readAnalysisFeedback(stored, ['a'])!;
  assert.deepEqual(read.groups, []);
  assert.deepEqual(read.students.map(row => row.studentId), ['a']);
  assert.equal(readAnalysisFeedback({ scores: [] }, ['a']), null);
});

test('补跑保留全班报告名单，只合入指定学生建议；全量重跑丢弃旧名单及未返回建议', () => {
  const old = parseAnalysisFeedback(raw({ groups: [{ id: 'g1', students: ['张伟#1'] }], students: [{ student: '张伟#1', advice: '旧建议' }] }), entries).feedback;
  const next = parseAnalysisFeedback(raw({ groups: [{ id: 'g2', students: ['张伟#2'] }], students: [{ student: '张伟#2', advice: '新建议' }] }), [entries[1]]).feedback;
  const merged = mergeAnalysisFeedback(old, next, ['a', 'b'], true);
  assert.deepEqual(merged.groups, old.groups);
  assert.deepEqual(merged.students.map(row => row.studentId), ['a', 'b']);
  const replaced = mergeAnalysisFeedback(old, next, ['a', 'b'], false);
  assert.deepEqual(replaced.groups, next.groups);
  assert.deepEqual(replaced.missing, ['a']);
});

test('裸 JSON 名单区兼容解析，机器数据不进入正文', () => {
  const parsed = parseAnalysisFeedback('核心结论\n正文\n\n### 典型表现对应名单\n{"groups":[{"id":"g1","students":["张伟#2"]}]}\n<classnode-scores>{"scores":[]}</classnode-scores>', entries);
  assert.deepEqual(parsed.feedback.groups, [{id:'g1',studentIds:['b']}]);
  assert.equal(parsed.narrative, '核心结论\n正文\n\n<classnode-scores>{"scores":[]}</classnode-scores>');
});
