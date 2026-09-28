import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetQuestionNode } from '@/lib/types';
import { DEFAULT_PROMPT_STYLE } from '../../../lib/worksheet-prompt-marks.ts';
import { questionStats, showsAgentAnalysis, type StatsRow } from './worksheet-question-stats.ts';

/**
 * 「按题统计与分析」的判据（规格 `specs/2026-09-28-按题统计与分析.md`）。
 *
 * 🔴 这一层每一条错了都**不报错**，只会让教师看到一句**错的结论** —— 然后照着它去讲题：
 *   · 把草稿算进分布 ⇒ 数字一直跳，而教师以为那是全班的最终答案；
 *   · 本地重算判分 ⇒ 与服务的容差/多答案规则分叉（本文件**不许**出现这种算法）；
 *   · 百分比写不出分母 ⇒ 「63% 选了 B」，而分母是谁没人知道（本仓反复栽在这上面）；
 *   · 中位数把「不知道」（旧行的 NULL）当成 0 ⇒ 「平均用时 0 秒」。
 */

function node(type: string, data: Record<string, unknown> = {}, over: Partial<WorksheetQuestionNode> = {}): WorksheetQuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [], ...over };
}

/** 作答行。默认**已交**（分布只数已交的，所以夹具默认值就是它）。 */
function row(over: Partial<StatsRow> = {}): StatsRow {
  return {
    participantId: 'p', participantName: '张三',
    status: 'submitted', isCorrect: null, gradeState: null, value: null,
    createdAt: null, savedAt: null, saveCount: null,
    ...over,
  };
}

const CHOICE = ['A', 'B', 'C'].map((key) => ({ key, text: `选项${key}` }));

/* ── 🔴 分母与口径 ──────────────────────────────────────────────────── */

/**
 * 🔴 **草稿不算进分布。** 它还在变 —— 混进去会让屏幕上的数字一直跳，
 * 而教师会以为那是全班的最终答案。
 */
test('🔴 只数「已交」的行：草稿不进分布，但算进「还没交」的名单', () => {
  const stats = questionStats(
    node('single-choice', { options: CHOICE, correctKeys: ['B'] }),
    [
      row({ value: { format: 'choice/v1', selected: ['B'] } }),
      row({ participantName: '李四', status: 'draft', value: { format: 'choice/v1', selected: ['A'] } }),
      row({ participantName: '王五', status: 'unanswered' }),
    ],
  );
  assert.equal(stats.submitted, 1, '只有那一条已交');
  const bars = stats.distribution?.kind === 'options' ? stats.distribution.bars : [];
  assert.equal(bars.filter((bar) => bar.label.startsWith('A')).length && bars.filter((bar) => bar.label.startsWith('A'))[0].count, 0,
    '🔴 草稿里选了 A，但 A 的计数必须是 0（草稿不进分布）');
  assert.deepEqual(stats.process.notSubmitted, ['李四', '王五'], '没交的名单要含「作答中」与「未作答」两种');
});

/**
 * 🔴 **正确率的分母是「已判过的行」，不是参与者数、也不是已交人数。**
 * 拿已交人数当分母，一份只判了一半的卷子会显示一个凭空变小的正确率。
 */
test('🔴 正确率的分母是「已判过的行」；没判分的人不进分母', () => {
  const stats = questionStats(
    node('single-choice', { options: CHOICE, correctKeys: ['B'] }),
    [
      row({ gradeState: 'correct' }),
      row({ gradeState: 'incorrect' }),
      // 关了自动判分 / 主观题 ⇒ 这一行没有判分结论
      row({ gradeState: null, isCorrect: null }),
      row({ status: 'draft' }),
    ],
  );
  assert.equal(stats.accuracy, 50, '2 人判过、1 人对 ⇒ 50%（已交 3 人里有 1 人没判，不进分母）');
  assert.equal(stats.noVerdict, 1);
});

/**
 * 🔴 **判分档只读行里的 `gradeState`，本地绝不重算。**
 * 这条用例的形状就是「本地重算会分叉」的那一种：一条**多选**行，服务端判成 `partial`
 * （漏选，容差规则），而本地按「选的都对了」会判成对 —— 屏幕上就会凭空多一个全对。
 */
test('🔴 判分档读服务端的 gradeState（多选漏选是 partial，本地不许算成「对」）', () => {
  const stats = questionStats(
    node('multi-choice', { options: CHOICE, correctKeys: ['A', 'B'], partialCredit: 'allow-missing' }),
    [
      row({ gradeState: 'partial', isCorrect: false, value: { format: 'choice/v1', selected: ['A'] } }),
      row({ gradeState: 'correct', isCorrect: true, value: { format: 'choice/v1', selected: ['A', 'B'] } }),
    ],
  );
  assert.equal(stats.partial, 1, '🔴 漏选必须是部分给分，不是全对');
  assert.equal(stats.correct, 1);
  assert.equal(stats.accuracy, 50);
});

/* ── 选项族 ─────────────────────────────────────────────────────────── */

test('★ 单选：逐选项计数，正确项标绿', () => {
  const stats = questionStats(
    node('single-choice', { options: CHOICE, correctKeys: ['B'] }),
    [
      row({ value: { format: 'choice/v1', selected: ['B'] } }),
      row({ value: { format: 'choice/v1', selected: ['A'] } }),
      row({ value: { format: 'choice/v1', selected: ['A'] } }),
    ],
  );
  assert.equal(stats.distribution?.kind, 'options');
  const bars = stats.distribution?.kind === 'options' ? stats.distribution.bars : [];
  assert.deepEqual(bars, [
    { label: 'A. 选项A', count: 2, correct: false },
    { label: 'B. 选项B', count: 1, correct: true },
    { label: 'C. 选项C', count: 0, correct: false },
  ]);
  // 单选没有「组合」那张表（组合恒等于选项本身）。
  assert.deepEqual(stats.distribution?.kind === 'options' ? stats.distribution.combos : null, []);
});

/**
 * 🔴 **多选的组合 key 必须排序。** 不排的话 `AB` 与 `BA` 会算成两组，
 * 而教师在屏幕上看到同一个组合被拆成两行 —— 「3 人选了 AB，2 人选了 BA」。
 */
test('🔴 多选：选项顺序不同但组合相同 ⇒ 算同一组', () => {
  const stats = questionStats(
    node('multi-choice', { options: CHOICE, correctKeys: ['A', 'B'] }),
    [
      row({ value: { format: 'choice/v1', selected: ['A', 'B'] } }),
      row({ value: { format: 'choice/v1', selected: ['B', 'A'] } }),
    ],
  );
  const combos = stats.distribution?.kind === 'options' ? stats.distribution.combos : [];
  assert.deepEqual(combos, [{ label: 'AB', count: 2 }], '🔴 两种点选顺序是同一个组合');
});

/** 🔴 判断题**不存 `options`** ⇒ 必须走 `TRUE_FALSE_OPTIONS`，否则一个选项都数不出来。 */
test('🔴 判断题：选项来自常量（`data` 里没有 options）', () => {
  const stats = questionStats(node('true-false', { correctKeys: ['T'] }), [
    row({ value: { format: 'choice/v1', selected: ['T'] } }),
    row({ value: { format: 'choice/v1', selected: ['F'] } }),
  ]);
  const bars = stats.distribution?.kind === 'options' ? stats.distribution.bars : [];
  assert.equal(bars.length, 2, '对 / 错两个选项都要在');
  assert.equal(bars[0].count, 1);
  assert.equal(bars[1].count, 1);
});

/* ── 填空 ───────────────────────────────────────────────────────────── */

function fillNode(blanks: number, answers: unknown): WorksheetQuestionNode {
  const mark = '{填空域}';
  return node('fill-blank', {
    answers,
    promptRuns: Array.from({ length: blanks }, (_, index) => ({
      start: index * mark.length, end: (index + 1) * mark.length, ...DEFAULT_PROMPT_STYLE, blank: `t${index + 1}`,
    })),
  }, { prompt: mark.repeat(blanks) });
}

test('★ 填空：逐空计数 — trim 前后空白，但不合并大小写', () => {
  const stats = questionStats(fillNode(1, [['H2O']]), [
    row({ value: { format: 'fill/v1', text: 'H2O', texts: ['H2O'] } }),
    row({ value: { format: 'fill/v1', text: '  H2O  ', texts: ['  H2O  '] } }),
    row({ value: { format: 'fill/v1', text: 'h2o', texts: ['h2o'] } }),
  ]);
  const blanks = stats.distribution?.kind === 'blanks' ? stats.distribution.blanks : [];
  assert.deepEqual(blanks[0].bars, [
    { label: 'H2O', count: 2 },
    // 🔴 「H2O」与「h2o」算**两种** —— 合并需要「什么是同一个答案」的规则，
    //    而那正是本模块拒绝的那类判据（它是判分，不是计数）。
    { label: 'h2o', count: 1 },
  ]);
  assert.equal(blanks[0].distinct, 2);
});

test('★ 填空：留空**不算一种写法**（不计数），但也没被算成答案', () => {
  const stats = questionStats(fillNode(1, [['H2O']]), [
    row({ value: { format: 'fill/v1', text: 'H2O', texts: ['H2O'] } }),
    row({ value: { format: 'fill/v1', text: '', texts: ['   '] } }),
  ]);
  const blanks = stats.distribution?.kind === 'blanks' ? stats.distribution.blanks : [];
  assert.deepEqual(blanks[0].bars, [{ label: 'H2O', count: 1 }], '留空不进 bars');
  assert.equal(blanks[0].distinct, 1);
});

/* ── 排序 ───────────────────────────────────────────────────────────── */

test('★ 排序：逐位统计「有几个人排在这一位」，并列出最常见的顺序', () => {
  const stats = questionStats(
    node('order', {
      items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }],
      correctOrder: ['i1', 'i2'],
    }),
    [
      row({ value: { format: 'order/v1', order: ['i1', 'i2'] } }),
      row({ value: { format: 'order/v1', order: ['i2', 'i1'] } }),
    ],
  );
  const dist = stats.distribution?.kind === 'order' ? stats.distribution : null;
  assert.deepEqual(dist?.positions, [{ index: 0, hits: 1 }, { index: 1, hits: 1 }]);

  // 🔴 那两条并列（各 1 人）⇒ 次序由**文本排序**定，而我要断言的是**稳定**，
  // 不是某个具体顺序（`localeCompare` 里「乙」<「甲」是按码点 —— 第一版我按常识
  // 猜了「甲」在前，于是红了；而红得对：那条断言把「稳定」写成了「按我猜的顺序」）。
  assert.deepEqual(
    [...(dist?.topOrders ?? [])].map((bar) => bar.label).sort(),
    ['乙 → 甲', '甲 → 乙'],
    '两种顺序都要在',
  );
  const again = questionStats(
    node('order', {
      items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }],
      correctOrder: ['i1', 'i2'],
    }),
    [
      row({ value: { format: 'order/v1', order: ['i1', 'i2'] } }),
      row({ value: { format: 'order/v1', order: ['i2', 'i1'] } }),
    ],
  );
  assert.deepEqual(
    again.distribution?.kind === 'order' ? again.distribution.topOrders : null,
    dist?.topOrders,
    '🔴 同样的输入必须给出**同样的次序** —— 否则屏幕上那几行每刷新一次就换一个位置',
  );
});

/* ── 连线 / 归类（矩阵）─────────────────────────────────────────────── */

test('🔴 连线：同一个人重复连同一对只算一次；对错由 `pairs` 判定（纯集合）', () => {
  const stats = questionStats(
    node('match', {
      left: [{ id: 'l1', text: '水' }, { id: 'l2', text: '二氧化碳' }],
      right: [{ id: 'r1', text: 'H2O' }, { id: 'r2', text: 'CO2' }],
      pairs: [{ leftId: 'l1', rightId: 'r1' }],
    }),
    [
      row({ value: { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }, { leftId: 'l1', rightId: 'r2' }] } }),
      row({ value: { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] } }),
    ],
  );
  const dist = stats.distribution?.kind === 'match' ? stats.distribution : null;
  assert.deepEqual(
    [...(dist?.cells ?? [])].sort((a, b) => a.colId.localeCompare(b.colId)),
    [
      { rowId: 'l1', colId: 'r1', count: 1, correct: true },
      { rowId: 'l1', colId: 'r2', count: 1, correct: false },
    ],
    '🔴 那两条重复的「l1→r2」只算 1 人（否则矛盾作答会把自己的票数翻倍）',
  );
});

test('🔴 归类：放进了**不存在的框**的条目不计（教师改题删了那个框）', () => {
  const stats = questionStats(
    node('categorize', {
      items: [{ id: 'i1', text: '猫' }],
      zones: [{ id: 'z1', label: '哺乳类' }],
      placement: { i1: 'z1' },
    }),
    [
      row({ value: { format: 'categorize/v1', assignment: { i1: 'z1' } } }),
      row({ value: { format: 'categorize/v1', assignment: { i1: '已经删掉的框' } } }),
    ],
  );
  const dist = stats.distribution?.kind === 'categorize' ? stats.distribution : null;
  assert.deepEqual(dist?.cells, [{ rowId: 'i1', colId: 'z1', count: 1, correct: true }],
    '🔴 不存在的框在矩阵上没有列，计进去会凭空多出一个画不出来的格子');
});

/* ── 问答 / 绘图 ────────────────────────────────────────────────────── */

test('★ 问答：字数**分档**，且按档位的自然顺序排（不按人数降序）', () => {
  const stats = questionStats(node('short-answer'), [
    row({ value: { format: 'text/v1', text: '短' } }),
    row({ value: { format: 'text/v1', text: 'x'.repeat(50) } }),
    row({ value: { format: 'text/v1', text: 'x'.repeat(50) } }),
  ]);
  const lengths = stats.distribution?.kind === 'text' ? stats.distribution.lengths : [];
  assert.deepEqual(lengths.map((bar) => bar.label), ['空', '1–10 字', '11–30 字', '31–60 字', '60 字以上']);
  assert.equal(lengths[3].count, 2, '50 字落在 31–60 档');
});

/* ── 过程统计（教师批准保留）────────────────────────────────────────── */

/**
 * 🔴 **旧行的三列是 `NULL`，含义是「不知道」** —— 不许当成 0 收进样本，
 * 否则「平均用时 0 秒」会变成一句假话。
 */
test('🔴 过程统计：三列为 NULL 的行**不进样本**（不许当成 0）', () => {
  const stats = questionStats(node('short-answer'), [
    row({ createdAt: null, savedAt: null, saveCount: null }),
    row({ createdAt: '2026-09-28T12:00:00.000Z', savedAt: '2026-09-28T12:02:00.000Z', saveCount: 4 }),
  ]);
  assert.equal(stats.process.medianMs, 120000, '只知道那一条 ⇒ 中位数就是它（120 秒）');
  assert.equal(stats.process.medianSaves, 4);

  const unknown = questionStats(node('short-answer'), [row({})]);
  assert.equal(unknown.process.medianMs, null, '🔴 全都不知道 ⇒ null（界面整段不显示），不是 0');
  assert.equal(unknown.process.medianSaves, null);
});

/* ── 文字说明 ───────────────────────────────────────────────────────── */

/**
 * 🔴 **每个数字都要写得出分母**：本仓反复栽在分母口径上，而这一屏的文字
 * 是教师**照着讲题**的依据。
 */
test('🔴 文字说明：每个百分比都写得出分母（「已交 N 人里…」）', () => {
  const stats = questionStats(
    node('single-choice', { options: CHOICE, correctKeys: ['B'] }),
    [
      row({ gradeState: 'correct', value: { format: 'choice/v1', selected: ['B'] } }),
      row({ gradeState: 'incorrect', value: { format: 'choice/v1', selected: ['A'] } }),
      row({ status: 'draft' }),
    ],
  );
  const all = stats.insights.map((insight) => insight.text).join(' | ');
  assert.match(all, /3 人中已交 2 人/, `「已交 N/M」要出现：${all}`);
  assert.match(all, /已判 2 人/, `正确率的分母要说出来：${all}`);
});

/**
 * 🔴 **本地不解释原因。** 「他们混淆了 A 和 B」那种话是**智能体**该说的（规格 §6.2）；
 * 本地一旦开始解释就是在编。这条用例钉的是措辞里不许出现解释性的词。
 */
test('🔴 文字说明不解释原因（只陈述算得出来的事实）', () => {
  const stats = questionStats(
    node('single-choice', { options: CHOICE, correctKeys: ['B'] }),
    [row({ value: { format: 'choice/v1', selected: ['A'] } })],
  );
  const all = stats.insights.map((insight) => insight.text).join(' | ');
  for (const forbidden of ['可能', '因为', '说明他们', '混淆', '建议讲', '原因是']) {
    assert.ok(!all.includes(forbidden), `🔴 「${forbidden}」是解释，不是事实：${all}`);
  }
});

test('★ 主观题：**不说正确率**，并指路给智能体', () => {
  const stats = questionStats(node('short-answer'), [
    row({ value: { format: 'text/v1', text: '我看到了冒泡' } }),
  ]);
  const all = stats.insights.map((insight) => insight.text).join(' | ');
  assert.equal(stats.accuracy, null, '主观题没有正确率');
  // ⚠️ 判据是「**文案里有没有一个百分比**」，不是「有没有『正确率』这三个字」——
  //    代码里那句「不统计正确率」恰恰含这三个字，而它说的正是**没有**。
  //    （第一版就是这么错的：子串判据分不出「算了」与「说明没算」。）
  assert.ok(!all.includes('%'), `不许编一个百分比出来：${all}`);
  assert.match(all, /不统计正确率/, '要明说这一题不统计正确率');
  assert.match(all, /智能体/, '要指路给智能体那一块');
});

/* ── 智能体解读那一块给谁看（★ 教师：「非问答题，非绘图题，这部分要隐藏」）── */

/**
 * 🔴 客观题**本来就判分** —— 看板那四格与「本题统计」已经把「他答得怎么样」回答完了。
 * 再交给智能体读一遍，教师看到的会是一句「这道题不是主观题」（服务端的拒绝理由），
 * 而那在这一屏上只是噪声。
 */
test('🔴 智能体解读只给主观题（问答题 / 绘图题）', () => {
  assert.equal(showsAgentAnalysis({ type: 'short-answer' }), true);
  assert.equal(showsAgentAnalysis({ type: 'drawing' }), true);

  // 客观题一个都不给 —— 包括「手写填空题」：手写只是**作答方式**，它照样按答案判分。
  for (const type of ['single-choice', 'multi-choice', 'true-false', 'fill-blank', 'choice-blank', 'order', 'match', 'categorize']) {
    assert.equal(showsAgentAnalysis({ type }), false, `${type} 是客观题，不该出现智能体那一块`);
  }
});
