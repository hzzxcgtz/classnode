import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenQuestions, grade, normalizeFillText, stripAnswers, type QuestionNode, type WorksheetContent } from '../services/worksheet-questions.js';

const choice: QuestionNode = { id: 'q1', type: 'single-choice', prompt: '…', inputMode: 'keyboard',
  data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] }, children: [] };
const fill: QuestionNode = { id: 'q2', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
  data: { answers: ['光合作用', '光合作用作用'] }, children: [] };
const short: QuestionNode = { id: 'q3', type: 'short-answer', prompt: '…', inputMode: 'keyboard',
  data: {}, children: [] };

test('单选：选中正确键即对，多选不给分', () => {
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['B'] }), true);
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['A'] }), false);
  assert.equal(grade(choice, { format: 'choice/v1', selected: ['A', 'B'] }), false);
  assert.equal(grade(choice, { format: 'choice/v1', selected: [] }), false);
});

test('填空：任一可接受答案即对', () => {
  assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用' }), true);
  assert.equal(grade(fill, { format: 'fill/v1', text: '光合作用作用' }), true);
  assert.equal(grade(fill, { format: 'fill/v1', text: '呼吸作用' }), false);
});

test('归一化：去首尾空格、全角转半角、折叠连续空格', () => {
  assert.equal(normalizeFillText('  光合作用  '), '光合作用');
  assert.equal(normalizeFillText('ＡＢＣ'), 'ABC');
  assert.equal(normalizeFillText('光合  作用'), '光合 作用');
  assert.equal(normalizeFillText('光合\t作用'), '光合 作用');
});

test('🔴 归一化不做大小写不敏感 —— 化学式必须区分', () => {
  // 用规格 §3-T 自己的例子（`CO2` / `co2`）。
  //
  // ⚠️ 原 brief 此处写的是 `grade(fill, { format: 'fill/v1', text: '光合作用'.toLowerCase() })`，
  // 但中文没有大小写，`'光合作用'.toLowerCase() === '光合作用'` 恒为真，所以 `fill` 的
  // `answers` 必然命中、`grade` 必然返回 `true` —— 那条断言在任何实现下都不可能为 `false`
  // （除非把大小写归一掉，而那正是规格 §3-T 明令禁止的）。改用有大小写的字符串，
  // 这条测试才真的在验证「不做大小写归一」。
  const co2: QuestionNode = { id: 'q4', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: ['CO2'] }, children: [] };
  assert.equal(grade(co2, { format: 'fill/v1', text: 'CO2' }), true);
  assert.equal(grade(co2, { format: 'fill/v1', text: 'co2' }), false);
});

test('问答题永远不判分', () => {
  assert.equal(grade(short, { format: 'text/v1', text: '随便' }), null);
});

test('🔴 填空题：answers 里的非字符串元素不得让判分抛错', () => {
  // data 是 `Record<string, unknown>`、内容来自库里的 JSON，任何手工改过的行都可能混进
  // 非字符串元素。触发条件是「某个非字符串元素**之前没有元素命中**」—— 所以
  // `['光合作用', 42]` 恰好不炸（先命中了），`[42, '光合作用']` 才炸。三条都钉住。
  const withNumber: QuestionNode = { id: 'q5', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [42, '光合作用'] }, children: [] };
  assert.equal(grade(withNumber, { format: 'fill/v1', text: '光合作用' }), true, '非字符串元素应被跳过，不得抛错');

  const withNull: QuestionNode = { id: 'q6', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [null, '光合作用'] }, children: [] };
  assert.equal(grade(withNull, { format: 'fill/v1', text: '光合作用' }), true);

  const withObject: QuestionNode = { id: 'q7', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [{}, '光合作用'] }, children: [] };
  assert.equal(grade(withObject, { format: 'fill/v1', text: '光合作用' }), true);

  const withArray: QuestionNode = { id: 'q8', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [['光合作用'], '光合作用'] }, children: [] };
  assert.equal(grade(withArray, { format: 'fill/v1', text: '光合作用' }), true);

  // 全是非字符串时退化为「不匹配」，而不是抛错
  const allJunk: QuestionNode = { id: 'q9', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: [42, null] }, children: [] };
  assert.equal(grade(allJunk, { format: 'fill/v1', text: '光合作用' }), false);
});

test('flattenQuestions 深度优先展开（含嵌套 children）', () => {
  const mk = (id: string, children: QuestionNode[] = []): QuestionNode =>
    ({ id, type: 'short-answer', prompt: '…', inputMode: 'keyboard', data: {}, children });
  // 树形：a ─┬─ b ── c
  //         └─ d
  //       e
  const c = mk('c');
  const b = mk('b', [c]);
  const d = mk('d');
  const a = mk('a', [b, d]);
  const e = mk('e');
  const content: WorksheetContent = { schemaVersion: 1, nodes: [a, e] };
  assert.deepEqual(flattenQuestions(content).map(n => n.id), ['a', 'b', 'c', 'd', 'e']);
});

test('🔴 stripAnswers 递归剥掉子节点的答案，且原对象未被改动', () => {
  const childFill: QuestionNode = { id: 'p1c1', type: 'fill-blank', prompt: '…', inputMode: 'keyboard',
    data: { answers: ['光合作用'], explanation: '子节点解析' }, children: [] };
  const parentChoice: QuestionNode = { id: 'p1', type: 'single-choice', prompt: '…', inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] },
    children: [childFill] };
  const content: WorksheetContent = { schemaVersion: 1, nodes: [parentChoice] };
  // 原件快照：剥答案必须是纯函数式的，比对用它。
  const snapshot = structuredClone(content);

  const stripped = stripAnswers(content);
  const strippedChild = stripped.nodes[0].children[0];
  assert.deepEqual(stripped.nodes[0].data, { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] },
    '父节点：答案剥掉、非答案数据保留');
  assert.deepEqual(strippedChild.data, {}, '子节点：answers 与 explanation 也必须被剥掉');
  assert.equal(strippedChild.id, childFill.id, '子节点本身保留（只剥 data 里的答案键）');
  assert.ok(!JSON.stringify(stripped).includes('correctKeys'), '整棵树都不得残留 correctKeys');
  assert.ok(!JSON.stringify(stripped).includes('光合作用'), '整棵树都不得残留答案');

  assert.deepEqual(content, snapshot, '原对象（含子节点）不得被就地改动');
});

test('🔴 stripAnswers 剥掉答案，且不改原对象', () => {
  const content: WorksheetContent = { schemaVersion: 1, nodes: [choice, fill, short] };
  const stripped = stripAnswers(content);
  const json = JSON.stringify(stripped);
  assert.ok(!json.includes('correctKeys'), 'correctKeys 必须被剥掉');
  assert.ok(!json.includes('answers'), 'answers 必须被剥掉');
  assert.equal(JSON.stringify(content).includes('correctKeys'), true, '原对象不得被改动');
  assert.equal(stripped.nodes.length, 3, '题数与题序不变');
  assert.equal(stripped.nodes[0].prompt, choice.prompt, '题干保留');
});
