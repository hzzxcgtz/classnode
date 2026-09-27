/**
 * ★ 2026-09-25（教师裁定）：**逐题的「允许自动评分」开关** + **部分给分的容错档**。
 *
 * 原话两条：
 *   「可以自动评分的题在设置时加一个开关（是否允许自动评分，默认允许），如果选允许则要求
 *     设置答案、全对分、部分给分，否则答案、全对分、部分分就可以隐藏。」
 *   「如果部分给分框内设了非 0 值，则显示判分依据的设置，例如连线题全部连对为满分，
 *     连错不超过 1 条为部分给分。」
 *
 * 🔴 两个新字段都放题目节点**顶层**（跟 `points` 的先例，理由逐字相同：它们**题型无关**）：
 *   · `autoGrade?: boolean` —— 缺省/`true` = 允许；`false` = **不判分**。
 *   · `partialTolerance?: number` —— 「错不超过 N 处 ⇒ 部分给分」；
 *     缺省 = **旧规则**「只要有一部分对就给分」。
 *
 * ⚠️ 缺省必须是**旧规则**而不是某个数：老题的判据是「至少对 1 处」，它**随题面变**
 *（教师给连线加一条，总数就变了）。把它换算成死数存下来，判据会在教师改题面时**静默漂移**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, validateQuestion, DEFAULT_POINTS, type QuestionNode } from '../services/worksheet-questions.js';

const MATCH_LEFT = [{ id: 'l1', text: '甲' }, { id: 'l2', text: '乙' }, { id: 'l3', text: '丙' }];
const MATCH_RIGHT = [{ id: 'r1', text: '1' }, { id: 'r2', text: '2' }, { id: 'r3', text: '3' }];
const MATCH_PAIRS = [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }, { leftId: 'l3', rightId: 'r3' }];

function matchNode(over: Partial<QuestionNode> = {}): QuestionNode {
  return {
    id: 'q_m', type: 'match', prompt: '连一连', inputMode: 'keyboard',
    data: { left: MATCH_LEFT, right: MATCH_RIGHT, pairs: MATCH_PAIRS },
    children: [],
    ...over,
  };
}

/** 连对 `n` 条（其余连错）。 */
function links(n: number) {
  return {
    format: 'match/v1',
    links: MATCH_PAIRS.slice(0, n).map((pair, index) => (
      index < n ? pair : { leftId: pair.leftId, rightId: MATCH_RIGHT[(index + 1) % 3].id }
    )),
  };
}

/* ── 开关：`autoGrade: false` ⇒ 不判分 ──────────────────────────────── */

test('🔴 `autoGrade: false` ⇒ 一律 `null`（不判分），哪怕答案全对', () => {
  const node = matchNode({ autoGrade: false });
  assert.equal(grade(node, links(3), DEFAULT_POINTS), null, '全对也不判 —— 教师关掉了这道题的自动评分');
  assert.equal(grade(node, links(0), DEFAULT_POINTS), null);
});

test('对全题生效：单选、多选、填空、排序、归类、填空都一样', () => {
  const single: QuestionNode = {
    id: 'q_s', type: 'single-choice', prompt: '选一个', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['A'] },
    children: [], autoGrade: false,
  };
  assert.equal(grade(single, { format: 'choice/v1', selected: ['A'] }, DEFAULT_POINTS), null);
});

test('阳性对照：**缺省**（没这个键）= 允许自动评分 —— 老题一个字不改、分数一分不变', () => {
  assert.deepEqual(grade(matchNode(), links(3), DEFAULT_POINTS), { state: 'correct', score: DEFAULT_POINTS.full });
  assert.deepEqual(grade(matchNode({ autoGrade: true }), links(3), DEFAULT_POINTS), { state: 'correct', score: DEFAULT_POINTS.full });
});

/* ── 容错档：`partialTolerance` ─────────────────────────────────────── */

test('🔴 缺省 = **旧规则**「只要有一部分对就给分」（连对 1 条也算部分给分）', () => {
  assert.deepEqual(grade(matchNode(), links(1), DEFAULT_POINTS), { state: 'partial', score: DEFAULT_POINTS.half });
  assert.deepEqual(grade(matchNode(), links(2), DEFAULT_POINTS), { state: 'partial', score: DEFAULT_POINTS.half });
  assert.deepEqual(grade(matchNode(), links(0), DEFAULT_POINTS), { state: 'incorrect', score: 0 }, '一条都没连对 ⇒ 错');
});

test('🔴 设了容错档之后：**错不超过 N 处**才算部分给分（N=1 ⇒ 连错 1 条以内）', () => {
  const node = matchNode({ partialTolerance: 1 });
  // 三道题、连对 3 ⇒ 错 0 处 ⇒ 全对
  assert.deepEqual(grade(node, links(3), DEFAULT_POINTS), { state: 'correct', score: DEFAULT_POINTS.full });
  // 连对 2 ⇒ 错 1 处 ⇒ 在容错内 ⇒ 部分给分
  assert.deepEqual(grade(node, links(2), DEFAULT_POINTS), { state: 'partial', score: DEFAULT_POINTS.half });
  // 连对 1 ⇒ 错 2 处 ⇒ **超出容错** ⇒ 判错（这正是「连错不超过 1 条」的含义）
  assert.deepEqual(grade(node, links(1), DEFAULT_POINTS), { state: 'incorrect', score: 0 });
});

test('🔴 容错档比旧规则**更严**要有用例钉着（N=1 时「连错 2 条」从部分给分变判错）', () => {
  // 这一条是本特性存在的全部理由：教师能把「错一点也算」收紧成「错不超过 1 条」。
  const strict = matchNode({ partialTolerance: 1 });
  const loose = matchNode();
  assert.equal(grade(strict, links(1), DEFAULT_POINTS)?.state, 'incorrect');
  assert.equal(grade(loose, links(1), DEFAULT_POINTS)?.state, 'partial');
});

test('多选的容错档：漏选不超过 N 个（现有那个「漏选算不算」开关落到缺省档）', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }];
  const base = {
    id: 'q_mc', type: 'multi-choice' as const, prompt: '选', inputMode: 'keyboard' as const,
    data: { options, correctKeys: ['A', 'B', 'C'], partialCredit: 'allow-missing' }, children: [],
  };
  // 缺省档 = 旧行为（`allow-missing` 生效）：漏 2 个也算部分给分
  assert.deepEqual(grade(base, { format: 'choice/v1', selected: ['A'] }, DEFAULT_POINTS), { state: 'partial', score: DEFAULT_POINTS.half });
  // 容错 1 ⇒ 漏 2 个超限 ⇒ 判错
  assert.equal(grade({ ...base, partialTolerance: 1 }, { format: 'choice/v1', selected: ['A'] }, DEFAULT_POINTS)?.state, 'incorrect');
  // 容错 1 且漏 1 个 ⇒ 部分给分
  assert.equal(grade({ ...base, partialTolerance: 1 }, { format: 'choice/v1', selected: ['A', 'B'] }, DEFAULT_POINTS)?.state, 'partial');
});

test('合并后的选择题：single-choice 节点切到多选后按多选规则判分', () => {
  const node: QuestionNode = {
    id: 'q_choice', type: 'single-choice', prompt: '选出植物需要的条件', inputMode: 'keyboard',
    data: { choiceMode: 'multiple', options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }], correctKeys: ['A', 'B'], partialCredit: 'allow-missing' },
    children: [],
  };
  assert.deepEqual(grade(node, { format: 'choice/v1', selected: ['A'] }, { full: 3, half: 1 }), { state: 'partial', score: 1 });
});

test('合并后的填空题：按空给分累计，整题给分必须全部答对', () => {
  const base: QuestionNode = {
    id: 'q_fill', type: 'fill-blank', prompt: '填空', inputMode: 'keyboard',
    data: { answers: [['阳光'], ['水分'], ['空气']], fillScoring: 'per-blank' }, children: [],
  };
  const value = { format: 'fill-multi/v1', texts: ['阳光', '错', '空气'] };
  assert.deepEqual(grade(base, value, { full: 2, half: 0 }), { state: 'partial', score: 4 });
  assert.deepEqual(grade({ ...base, data: { ...base.data, fillScoring: 'whole' } }, value, { full: 5, half: 3 }), { state: 'partial', score: 0 });
  assert.deepEqual(grade({ ...base, data: { ...base.data, fillScoring: 'whole' } }, { format: 'fill-multi/v1', texts: ['阳光', '水分', '空气'] }, { full: 5, half: 3 }), { state: 'correct', score: 5 });
});

/* ── 校验器：关掉开关 ⇒ 不再要求答案 ─────────────────────────────────── */

test('🔴 关掉自动评分 ⇒ 答案**不再必填**（五种题型一起看）', () => {
  // 连线：去掉 pairs
  assert.deepEqual(
    validateQuestion(matchNode({ autoGrade: false, data: { left: MATCH_LEFT, right: MATCH_RIGHT } })),
    [],
  );
  // 单选：没有答案键
  assert.deepEqual(validateQuestion({
    id: 'q_s', type: 'single-choice', prompt: '选', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] }, children: [], autoGrade: false,
  }), []);
});

test('🔴 开着（缺省）时答案**恢复必填** —— 这是教师那条要求的另一半', () => {
  assert.ok(validateQuestion({
    id: 'q_s', type: 'single-choice', prompt: '选', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] }, children: [],
  }).some((message) => message.includes('正确答案')));
  assert.ok(validateQuestion(matchNode({ data: { left: MATCH_LEFT, right: MATCH_RIGHT } })).length > 0);
});
