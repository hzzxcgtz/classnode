import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_KEYS,
  QUESTION_TYPES,
  flattenQuestions,
  grade,
  normalizeFillText,
  stripAnswers,
  type QuestionNode,
  type QuestionType,
  type WorksheetContent,
} from '../services/worksheet-questions.js';

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

// ---------------------------------------------------------------------------
// ⑥ 答案键的**泄漏门**（规格 §5.4 第一条）
// ---------------------------------------------------------------------------

/**
 * 每个题型 `data` 里的键，以及它是「答案」还是「给学生看的」。
 *
 * 🔴 这个 Record **同时是编译期门**：`QuestionType` 多一个成员而这里没补样本时，
 * `tsc` 直接报错（`pnpm test` 先编译再跑，所以题型加漏了连测试都跑不起来）。
 */
interface AnswerKeyAudit {
  /** 该题型 `data` 里**会出现**的全部键（每条都必须被下面两个数组恰好覆盖一次）。 */
  data: Record<string, unknown>;
  /** 属于答案的键：必须 ∈ `ANSWER_KEYS`，剥离时必须消失。 */
  answerKeys: string[];
  /** 属于学生的键：必须 ∉ `ANSWER_KEYS`，剥离后必须原样留下。 */
  safeKeys: string[];
}

const ANSWER_KEY_AUDIT: Record<QuestionType, AnswerKeyAudit> = {
  'single-choice': {
    data: { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'], explanation: '光合作用需要光' },
    answerKeys: ['correctKeys', 'explanation'],
    safeKeys: ['options'],
  },
  'fill-blank': {
    data: { answers: ['光合作用'], explanation: '见课本 P42' },
    answerKeys: ['answers', 'explanation'],
    safeKeys: [],
  },
  'short-answer': {
    data: { explanation: '参考答案要点：光照、CO₂、水' },
    answerKeys: ['explanation'],
    safeKeys: [],
  },
};

/**
 * 🔴 **每个题型的答案键都必须 ∈ `ANSWER_KEYS`**。
 *
 * 为什么需要这条：`ANSWER_KEYS` 是一张**黑名单**，而 `normalizeNode` 把 `data`
 * **原样透传** —— 没被列进去的键会不声不响地跟着 `student-view` 发给学生。
 * 今天三种题型的答案键恰好都被覆盖到了，但这是一次**巧合**：规格 §5.4 自己的措辞
 * 是单数的 `answer`，而代码里是复数的 `answers`。M4 加一种答案键叫 `answer` 的题型，
 * 泄漏会**静默**发生，且没有任何编译期检查、没有任何既有测试会红。
 *
 * ⚠️ 这条门只能保证「**已声明**的答案键都在表里」——它挡不住「加了答案键却**不声明**」。
 * 真正的根治是改成 allowlist 投影（按题型列出安全键），那需要另一个决定，不在本批。
 * 所以它是**回归门**，不是证明。
 */
test('🔴 每个题型的答案键都必须 ∈ ANSWER_KEYS（黑名单漏一个 = 静默泄漏给学生）', () => {
  for (const type of QUESTION_TYPES) {
    const audit = ANSWER_KEY_AUDIT[type];
    assert.ok(audit, `题型「${type}」没有登记答案键样本 —— 新增题型时必须在 ANSWER_KEY_AUDIT 里补一条`);

    const allKeys = Object.keys(audit.data).sort();
    const declared = [...audit.answerKeys, ...audit.safeKeys].sort();
    assert.deepEqual(declared, allKeys,
      `题型「${type}」的样本里每个键都要被声明成「答案」或「给学生」之一（多一个或少一个都说明样本与代码脱节了）`);

    for (const key of audit.answerKeys) {
      assert.ok((ANSWER_KEYS as readonly string[]).includes(key),
        `题型「${type}」的答案键「${key}」不在 ANSWER_KEYS 里 ⇒ student-view 会把它原样下发给学生（规格 §5.4）`);
    }
    for (const key of audit.safeKeys) {
      assert.ok(!(ANSWER_KEYS as readonly string[]).includes(key),
        `题型「${type}」把「${key}」声明成给学生看的，但它却在 ANSWER_KEYS 里 ⇒ 会被一起剥掉，学生拿到残缺的题`);
    }

    // 行为对照：把样本做成一道真题跑一遍**真实的剥离链路**（只比键名的话，一个
    // 「stripAnswers 什么都不删」的实现也能让上面全绿）。
    const node: QuestionNode = {
      id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard',
      data: { ...audit.data }, children: [],
    };
    const stripped = stripAnswers({ schemaVersion: 1, nodes: [node] });
    assert.deepEqual(Object.keys(stripped.nodes[0].data).sort(), [...audit.safeKeys].sort(),
      `题型「${type}」剥离后剩下的键必须正好是 safeKeys —— 多了是漏剥（泄漏），少了是多剥（学生拿到残缺的题）`);
  }
});
