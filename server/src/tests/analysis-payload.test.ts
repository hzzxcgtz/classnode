/**
 * ★ M7a：载荷的**选择**（谁进来）与**形态**（是文档还是联系表）。
 *
 * 🔴 这里每一条错了都**不报错**，只会让教师看到一份缺人的名单 —— 所以逐条钉。
 * 三条最要命的（都在 Review Focus 里）：
 *   · 零份已提交（教师最可能踩：全班还没交就点开了）
 *   · 形状认不出的作答被**静默过滤**（后果是 covered 说 12 而文档只有 8 段）
 *   · 混杂（教师中途改过作答方式）被当成单一形态 ⇒ 笔迹条目整批消失
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  payloadKindOf, selectAnalyzeEntries, type Participant, type RawAnswer,
} from '../services/analysis-payload.js';

const ink = (strokes: number) => ({
  format: 'ink/v1',
  canvas: { w: 320, h: 240 },
  strokes: Array.from({ length: strokes }, () => ({ points: [[0, 0], [1, 1]], width: 0.01, color: '#111111' })),
});
const people: Participant[] = [
  { participantId: 'p1', name: '张三' },
  { participantId: 'p2', name: '李四' },
  { participantId: 'p3', name: '王五' },
];
const row = (participantId: string, status: string, value: unknown): RawAnswer =>
  ({ participantId, questionId: 'q1', status, value });

test('只收 status === "submitted"，未作答与草稿都不进载荷', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'text/v1', text: '甲' }),
    row('p2', 'draft', { format: 'text/v1', text: '写到一半' }),
    row('p3', 'unanswered', null),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => e.studentId), ['p1']);
  assert.equal(entries[0].kind, 'text');
  assert.equal(entries[0].text, '甲');
  assert.equal(entries[0].displayName, '张三');
});

test('🔴 零份已提交 ⇒ 空数组（不抛、不造一条假的）', () => {
  assert.deepEqual(selectAnalyzeEntries([], people, 'q1'), []);
  assert.deepEqual(
    selectAnalyzeEntries([row('p1', 'draft', { format: 'text/v1', text: 'x' })], people, 'q1'), []);
});

test('顺序按 studentId 升序，与入参顺序无关（模型会说「第 3 格」，顺序必须可复现）', () => {
  const answers = [
    row('p3', 'submitted', { format: 'text/v1', text: '丙' }),
    row('p1', 'submitted', { format: 'text/v1', text: '甲' }),
    row('p2', 'submitted', { format: 'text/v1', text: '乙' }),
  ];
  assert.deepEqual(selectAnalyzeEntries(answers, people, 'q1').map((e) => e.studentId), ['p1', 'p2', 'p3']);
  assert.deepEqual(
    selectAnalyzeEntries([...answers].reverse(), people, 'q1').map((e) => e.studentId), ['p1', 'p2', 'p3']);
});

test('🔴 形状认不出的作答必须以 unknown 留在载荷里（静默过滤会让 covered 与格子数对不上）', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'choice/v1', selected: ['a'] }),   // 题型被改过，旧值还在
    row('p2', 'submitted', 'not-an-object'),
    row('p3', 'submitted', null),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => [e.studentId, e.kind]),
    [['p1', 'unknown'], ['p2', 'unknown'], ['p3', 'unknown']]);
});

test('笔迹的格式判据是 format（与 judge() 同一条），不是题型', () => {
  const [entry] = selectAnalyzeEntries([row('p1', 'submitted', ink(2))], people, 'q1');
  assert.equal(entry.kind, 'ink');
  assert.equal(entry.ink?.strokes.length, 2);
  assert.equal(entry.ink?.canvas.w, 320);
});

test('🔴 笔迹值形状坏掉（canvas 不是数 / strokes 不是数组）⇒ unknown 而不是抛', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'ink/v1', canvas: { w: 'x', h: 240 }, strokes: [] }),
    row('p2', 'submitted', { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: 'nope' }),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => e.kind), ['unknown', 'unknown']);
});

test('文本值为空串仍然算 text（空白是学生的作答，不是「认不出」）', () => {
  const [entry] = selectAnalyzeEntries([row('p1', 'submitted', { format: 'text/v1', text: '' })], people, 'q1');
  assert.equal(entry.kind, 'text');
  assert.equal(entry.text, '');
});

test('只收这一道题的作答行（同一份学习单里别的题不进载荷）', () => {
  const entries = selectAnalyzeEntries([
    { participantId: 'p1', questionId: 'q2', status: 'submitted', value: { format: 'text/v1', text: '别题' } },
  ], people, 'q1');
  assert.deepEqual(entries, []);
});

test('参与者名单里查不到的作答行被丢掉（脏数据不抛）', () => {
  assert.deepEqual(selectAnalyzeEntries([row('ghost', 'submitted', { format: 'text/v1', text: 'x' })], people, 'q1'), []);
});

test('形态：全文字 ⇒ text · 全笔迹 ⇒ image · 混杂 ⇒ mixed · 全 unknown/空 ⇒ text', () => {
  const t = (id: string) => ({ studentId: id, displayName: id, kind: 'text' as const, text: 'x' });
  const i = (id: string) => ({ studentId: id, displayName: id, kind: 'ink' as const, ink: ink(1) as never });
  const u = (id: string) => ({ studentId: id, displayName: id, kind: 'unknown' as const });
  assert.equal(payloadKindOf([t('a'), t('b')]), 'text');
  assert.equal(payloadKindOf([i('a'), i('b')]), 'image');
  assert.equal(payloadKindOf([t('a'), i('b')]), 'mixed');
  assert.equal(payloadKindOf([i('a'), t('b')]), 'mixed', '顺序反过来也是 mixed');
  assert.equal(payloadKindOf([u('a')]), 'text', '全认不出时至少给一份文档，把那几条说出来');
  assert.equal(payloadKindOf([]), 'text', '零份作答时给空文档，不给一张空格子图');
});

test('🔴 混杂时不许把笔迹丢掉：mixed 是必须的（教师中途改过作答方式）', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'text/v1', text: '键盘答的' }),
    row('p2', 'submitted', ink(3)),
  ], people, 'q1');
  assert.equal(payloadKindOf(entries), 'mixed');
  assert.deepEqual(entries.map((e) => e.kind), ['text', 'ink']);
  assert.equal(entries.length, 2, '混杂时两条都要在 —— 丢一条就是「已交 2 人」而只有一条内容');
});
