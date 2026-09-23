/**
 * M4a · A2 —— 判分：**三态 + 数值得分**（规格 §12「M4 重开了 §3-S」）。
 *
 * 🔴 **为什么这份文件值得这么大**（规格 §14.4）：判分是本项目唯一「错了教师会发现、
 * 但难以定位」的地方 —— 一道题判错**不会有异常、不会有红测试**，只会在看板上表现为
 * 「这道题正确率偏低」，而教师会去怀疑学生。所以每个题型都同时钉三件事：
 * **全对 / 半对 / 错**，外加归一化与**形状容错**的边界。
 *
 * 🔴 第二条主线是**「绝不抛」**：判分在提交路径上，一次抛错就是 500，学生看到的是
 * 「提交失败」并重试。而 `data`（库里的 JSON）与 `value`（请求体）都可能有别的形状，
 * 所以每个题型都有一组「value 是 null / 数字 / 数组 / 缺字段」「data 是空 / 缺字段」的用例。
 *
 * ⚠️ 判分口径的三条**统一规则**（写死在实现里，这里逐条钉住）：
 *   1. 「多个组成部分」的题（多选 / 填空多空 / 排序 / 连线 / 归类）**部分正确 = 半对**，
 *      唯一的开关是多选题的「漏选算不算」（教师逐题选）。
 *   2. 选了**错的**一律不给部分分 —— 半对只奖励「少做了」，不奖励「做错了」。
 *   3. 坏形状（缺字段、类型不对）一律 `incorrect`，**不是** `null` —— `null` 的语义是
 *      「这题型不判分」（主观题），把它用来表示「读不懂」会让看板把一次 500 级的问题
 *      显示成「主观题」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POINTS,
  QUESTION_TYPES,
  grade,
  pointsFromSettings,
  resolvePoints,
  type GradeResult,
  type GradeState,
  type QuestionNode,
  type QuestionPoints,
  type QuestionType,
} from '../services/worksheet-questions.js';

/**
 * 判分用的分值档。
 *
 * 🔴 刻意用 **2 / 1** 而不是默认的 1 / 0：默认档下 `score` 恰好等于旧布尔的 `Number()`，
 * 于是「把 `state` 当 `score` 用」「忘了乘 `points.full`」「得分写成 0/0.5/1 的比例」
 * 这三种错在这份文件里**全都看不出来**。2 / 1 让它们当场可判。
 */
const P: QuestionPoints = { full: 2, half: 1 };

function question(type: QuestionType, data: Record<string, unknown>): QuestionNode {
  return { id: `q_${type}`, type, prompt: '题干', inputMode: 'keyboard', data, children: [] };
}

/** 报错信息里带上作答值 —— 一条形状用例红了要**当场**知道是哪一条，否则得重跑一遍。 */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 判一条并把 `state` 与 `score` **一起**钉住。
 *
 * 🔴 两个字段都要断：只断 `state` 的话，「三态判对了、得分却写成比例」这种错会一路绿到
 * 看板的数字上 —— 而那正是规格 §12 把 `score` 定成**绝对值**要防的事（教师逐题填的是
 * 「全对给几 / 半对给几」，单选 2/1 与填空 1/0 的比例在各题之间不可比）。
 */
function assertVerdict(
  node: QuestionNode,
  value: unknown,
  state: GradeState,
  score: number,
  points: QuestionPoints = P,
): void {
  const result = grade(node, value, points);
  const label = `${node.type} · 作答 ${safeJson(value)}`;
  // ⚠️ `result?.state`（不是 `result!.state`）：判分返回 `null` 时这里必须**红**，
  //    而不是被断言运算符骗过去。
  assert.equal(result?.state, state, `${label}：state 应为 ${state}`);
  assert.equal(result?.score, score, `${label}：score 应为 ${score}（绝对值，不是比例）`);
}

/** 错 ⇒ 0 分。它出现的次数远多于另外两态，单独给一个断言省得每次抄两个参数。 */
function assertIncorrect(node: QuestionNode, value: unknown, points: QuestionPoints = P): void {
  assertVerdict(node, value, 'incorrect', 0, points);
}

/**
 * 形状容错的统一判据：**绝不抛**，且一律 `incorrect` + 0 分。
 *
 * ⚠️ 用 try/catch 而**不是** `assert.doesNotThrow`：后者失败时只有一句「抛了」，
 * 而这里要把题型与被判的作答值一起打出来。
 */
function assertIncorrectWithoutThrow(node: QuestionNode, value: unknown): void {
  let result: GradeResult | null;
  try {
    result = grade(node, value, P);
  } catch (error) {
    assert.fail(`${node.type} 判分抛错了（作答值 ${safeJson(value)}）：${String(error)}`);
  }
  assert.equal(result?.state, 'incorrect', `${node.type} · 作答 ${safeJson(value)}：坏形状一律判错`);
  assert.equal(result?.score, 0, `${node.type} · 作答 ${safeJson(value)}：判错 ⇒ 0 分`);
}

/** 每个可自动判分的题型都要能拿到「坏形状」用例 —— 见文件末尾那条遍历。 */
const GRADED: Record<QuestionType, boolean> = {
  'single-choice': true,
  'true-false': true,
  'multi-choice': true,
  'fill-blank': true,
  'short-answer': false,
  order: true,
  match: true,
  categorize: true,
};

// ---------------------------------------------------------------------------
// ① 单选 / 判断 —— 只有一个组成部分，**没有半对**
// ---------------------------------------------------------------------------

test('🔴 判断题与单选逐字同构：同一条 data 在两个题型下必须给出同一个判定', () => {
  const tf = question('true-false', { correctKeys: ['T'] });
  assertVerdict(tf, { format: 'choice/v1', selected: ['T'] }, 'correct', P.full);
  assertIncorrect(tf, { format: 'choice/v1', selected: ['F'] });

  // 逐字同构的另一半：换成 `single-choice` 后判定不变（规格 §12 的裁定）。
  const sc = question('single-choice', { options: [{ key: 'T' }, { key: 'F' }], correctKeys: ['T'] });
  assertVerdict(sc, { format: 'choice/v1', selected: ['T'] }, 'correct', P.full);
  assertIncorrect(sc, { format: 'choice/v1', selected: ['F'] });
});

test('单选：只有一个组成部分 ⇒ 判不出「半对」，近似答案一律算错', () => {
  const sc = question('single-choice', {
    options: [{ key: 'A' }, { key: 'B' }],
    correctKeys: ['B'],
  });
  assertVerdict(sc, { format: 'choice/v1', selected: ['B'] }, 'correct', P.full);
  // 少选 / 多选 / 空选：全部是 `incorrect`，**不是** `partial` —— 若这里出现 partial，
  // 说明判分把「一个组成部分」也当成了可拆的东西。
  assertIncorrect(sc, { format: 'choice/v1', selected: ['A'] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['A', 'B'] });
  assertIncorrect(sc, { format: 'choice/v1', selected: [] });
});

test('单选：correctKeys 坏掉（0 个或 2 个）时没有人能对 —— 判错，不抛', () => {
  assertIncorrect(question('single-choice', { options: [{ key: 'A' }], correctKeys: [] }),
    { format: 'choice/v1', selected: ['A'] });
  assertIncorrect(question('single-choice', { options: [{ key: 'A' }], correctKeys: ['A', 'B'] }),
    { format: 'choice/v1', selected: ['A'] });
});

test('🔴 单选：选中项里混进非字符串元素 ⇒ 整体判错（跳过它 = 奖励坏数据）', () => {
  const sc = question('single-choice', { options: [{ key: 'B' }], correctKeys: ['B'] });
  // `['B', 42]` 若按「跳过非字符串」读就成了「只选了 B」⇒ 给分。那是**安静的虚高**。
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', 42] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', ''] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', null] });
});

test('🔴 score 是教师填的**绝对值**，不是 0/0.5/1 的比例', () => {
  const tf = question('true-false', { correctKeys: ['T'] });
  const right = { format: 'choice/v1', selected: ['T'] };
  // 同一个判定，三份不同的分值档 ⇒ 三个不同的得分。任何「返回比例」的实现在这里必红。
  assertVerdict(tf, right, 'correct', 1, { full: 1, half: 0 });
  assertVerdict(tf, right, 'correct', 5, { full: 5, half: 2 });
  assertVerdict(tf, right, 'correct', 0, { full: 0, half: 0 });
});

// ---------------------------------------------------------------------------
// ② 多选 —— 三态唯一真正的来源
// ---------------------------------------------------------------------------

const MULTI_OPTIONS = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];

function multiNode(partialCredit: unknown): QuestionNode {
  return question('multi-choice', {
    options: MULTI_OPTIONS,
    correctKeys: ['A', 'C'],
    partialCredit,
  });
}

test('多选 · 全对才算（all-or-nothing）：漏选是**错**，不是半对 —— 这是教师逐题选的', () => {
  const node = multiNode('all-or-nothing');
  assertVerdict(node, { format: 'choice/v1', selected: ['A', 'C'] }, 'correct', P.full);
  assertIncorrect(node, { format: 'choice/v1', selected: ['A'] });          // 漏选
  assertIncorrect(node, { format: 'choice/v1', selected: ['C'] });          // 漏选
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B', 'C'] }); // 多选
  assertIncorrect(node, { format: 'choice/v1', selected: [] });             // 没选
  // 顺序无关：作答值是一个**集合**，`['C','A']` 与 `['A','C']` 是同一个答案。
  assertVerdict(node, { format: 'choice/v1', selected: ['C', 'A'] }, 'correct', P.full);
});

test('多选 · 漏选算半对（allow-missing）：漏选且非空 ⇒ partial', () => {
  const node = multiNode('allow-missing');
  assertVerdict(node, { format: 'choice/v1', selected: ['A', 'C'] }, 'correct', P.full);
  assertVerdict(node, { format: 'choice/v1', selected: ['A'] }, 'partial', P.half);
  assertVerdict(node, { format: 'choice/v1', selected: ['C'] }, 'partial', P.half);
});

test('🔴 多选 · 选了错的一律不给部分分（半对只奖励「少做了」，不奖励「做错了」）', () => {
  const node = multiNode('allow-missing');
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B'] });       // 漏 C 且多了 B
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B', 'C'] });  // 全选但不全对
  assertIncorrect(node, { format: 'choice/v1', selected: ['B'] });            // 只选了一个错的
  assertIncorrect(node, { format: 'choice/v1', selected: [] });               // 空选 ≠ 漏选
});

test('🔴 多选 · 重复的键先去重 —— 不去重会把「只选了 A」读成「选了两个」而凑成满分', () => {
  const allowMissing = multiNode('allow-missing');
  // `['A','A']` 的真实含义是「只选了 A」= 漏选 ⇒ 半对。若按元素个数比较（2 == 2），
  // 它会变成 `correct` —— 一次**没有任何报错**的虚高。
  assertVerdict(allowMissing, { format: 'choice/v1', selected: ['A', 'A'] }, 'partial', P.half);
  assertIncorrect(multiNode('all-or-nothing'), { format: 'choice/v1', selected: ['A', 'A'] });
});

test('🔴 多选 · partialCredit 认不出的值一律按「全对才算」（认不出 ≠ 允许漏选）', () => {
  // 方向是刻意选的：把「认不出」当成「允许漏选」会让一道本该判错的题**静默地给学生半分**，
  // 而教师看不出任何异常（他以为自己选的是「全对才算」）。反过来，认不出的值当成
  // 「不给部分分」，教师至少能看到「我选了算半对但分数没给」—— 那是可见的。
  for (const credit of [undefined, null, '', 'ALLOW-MISSING', 'allow-missing ', 'allowMissing', 1, true, {}, []]) {
    assertIncorrect(multiNode(credit), { format: 'choice/v1', selected: ['A'] });
  }
});

test('多选：correctKeys 坏掉时没有人能对 —— 判错，不抛', () => {
  assertIncorrect(question('multi-choice', { options: MULTI_OPTIONS, correctKeys: [] }),
    { format: 'choice/v1', selected: ['A'] });
  // 非字符串元素是**教师的**坏数据，跳过它们（与作答值那一侧相反）——
  // 教师少填一个答案不该让学生拿不到分，但学生交上来的垃圾必须整体判错。
  const withJunk = question('multi-choice', {
    options: MULTI_OPTIONS,
    correctKeys: [42, 'A', null, 'C'],
    partialCredit: 'allow-missing',
  });
  assertVerdict(withJunk, { format: 'choice/v1', selected: ['A', 'C'] }, 'correct', P.full);
  assertVerdict(withJunk, { format: 'choice/v1', selected: ['A'] }, 'partial', P.half);
});

// ---------------------------------------------------------------------------
// ③ 填空 · 单空（M3 形状，判分口径逐字沿用）
// ---------------------------------------------------------------------------

test('填空（单空）：归一化沿用 M3 —— trim / 全角→半角 / 连续空白折成一个空格', () => {
  const node = question('fill-blank', { answers: ['光合作用'] });
  assertVerdict(node, { format: 'fill/v1', text: '光合作用' }, 'correct', P.full);
  assertVerdict(node, { format: 'fill/v1', text: '  光合作用  ' }, 'correct', P.full);

  const ascii = question('fill-blank', { answers: ['ABC'] });
  assertVerdict(ascii, { format: 'fill/v1', text: 'ＡＢＣ' }, 'correct', P.full); // 全角→半角

  const spaced = question('fill-blank', { answers: ['光合 作用'] });
  assertVerdict(spaced, { format: 'fill/v1', text: '光合   作用' }, 'correct', P.full);
  assertVerdict(spaced, { format: 'fill/v1', text: '光合\t作用' }, 'correct', P.full);
});

test('🔴 填空（单空）：大小写仍然敏感 —— 化学式必须区分（规格 §3-T）', () => {
  // ⚠️ 这里用 `CO2` / `co2`（规格 §3-T 自己的例子）。用中文写这条断言是**无效对照**：
  //    中文没有大小写，`'光合作用'.toLowerCase() === '光合作用'` 恒为真。
  const co2 = question('fill-blank', { answers: ['CO2'] });
  assertVerdict(co2, { format: 'fill/v1', text: 'CO2' }, 'correct', P.full);
  assertIncorrect(co2, { format: 'fill/v1', text: 'co2' });
  assertIncorrect(co2, { format: 'fill/v1', text: 'Co2' });
});

test('填空（单空）：多列几个可接受答案 —— 任一命中即全对，没有半对', () => {
  const node = question('fill-blank', { answers: ['光合作用', '光合作用作用'] });
  assertVerdict(node, { format: 'fill/v1', text: '光合作用作用' }, 'correct', P.full);
  assertIncorrect(node, { format: 'fill/v1', text: '呼吸作用' });
  // 近似答案不是半对：单空只有一个组成部分。
  assertIncorrect(node, { format: 'fill/v1', text: '光合' });
});

test('🔴 填空（单空）：answers 里的非字符串元素跳过、不抛（M3 的边界，不许弱化）', () => {
  // 触发条件是「某个非字符串元素**之前没有元素命中**」—— `[42, '光合作用']` 才炸，
  // `['光合作用', 42]` 恰好不炸。两种顺序都要钉住。
  for (const junk of [42, null, undefined, {}, [], true]) {
    assertVerdict(
      question('fill-blank', { answers: [junk, '光合作用'] }),
      { format: 'fill/v1', text: '光合作用' }, 'correct', P.full,
    );
    assertVerdict(
      question('fill-blank', { answers: ['光合作用', junk] }),
      { format: 'fill/v1', text: '光合作用' }, 'correct', P.full,
    );
  }
  // 全是非字符串 ⇒ 退化为「没有人能答对」，而不是抛错。
  assertIncorrect(question('fill-blank', { answers: [42, null] }), { format: 'fill/v1', text: '光合作用' });
  assertIncorrect(question('fill-blank', { answers: [] }), { format: 'fill/v1', text: '光合作用' });
});

// ---------------------------------------------------------------------------
// ④ 填空 · 多空（M4a 新形状：答案在第二层 `data.blanks[*].answers`）
// ---------------------------------------------------------------------------

const MULTI_BLANKS = [{ answers: ['H2O', '水'] }, { answers: ['CO2'] }];

test('填空（多空）：全空都对 ⇒ correct', () => {
  const node = question('fill-blank', { blanks: MULTI_BLANKS });
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['H2O', 'CO2'] }, 'correct', P.full);
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['水', 'CO2'] }, 'correct', P.full);
  // 归一化在多空里同样生效（逐个空各自归一化）。
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['  Ｈ２Ｏ ', 'CO2'] }, 'correct', P.full);
});

test('填空（多空）：有一空对、至少一空错 ⇒ partial（半对是**按空**算的）', () => {
  const node = question('fill-blank', { blanks: MULTI_BLANKS });
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['H2O', 'O2'] }, 'partial', P.half);
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['X', 'CO2'] }, 'partial', P.half);
  // 少交一个空 ⇒ 缺的那一空算错（`['H2O']` 的第一个空对、第二个空缺失）。
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['H2O'] }, 'partial', P.half);
});

test('填空（多空）：全错 / 全空 ⇒ incorrect', () => {
  const node = question('fill-blank', { blanks: MULTI_BLANKS });
  assertIncorrect(node, { format: 'fill-multi/v1', texts: ['X', 'O2'] });
  assertIncorrect(node, { format: 'fill-multi/v1', texts: [] });
  assertIncorrect(node, { format: 'fill-multi/v1', texts: ['', ''] });
});

test('🔴 填空（多空）：空数组 blanks（教师建了题但没填空）⇒ incorrect，**不抛**', () => {
  // `blanks.every(...)` 在空数组上恒真 —— 少了这条守卫，一道**没有任何空**的题
  // 会拿到满分，且没有任何报错。
  const node = question('fill-blank', { blanks: [] });
  assertIncorrectWithoutThrow(node, { format: 'fill-multi/v1', texts: [] });
  assertIncorrectWithoutThrow(node, { format: 'fill-multi/v1', texts: ['随便'] });
});

test('填空（多空）：blanks 里的坏元素算那一空错，不抛', () => {
  const node = question('fill-blank', { blanks: [null, { answers: ['CO2'] }] });
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['随便', 'CO2'] }, 'partial', P.half);
  const noAnswers = question('fill-blank', { blanks: [{ answers: [42] }, { answers: ['CO2'] }] });
  assertVerdict(noAnswers, { format: 'fill-multi/v1', texts: ['随便', 'CO2'] }, 'partial', P.half);
});

// ---------------------------------------------------------------------------
// ⑤ 排序 —— 位置判据
// ---------------------------------------------------------------------------

const ORDER_ITEMS = [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }, { id: 'i3', text: '丙' }];

function orderNode(items: Array<{ id: string; text: string }>, correctOrder: string[]): QuestionNode {
  return question('order', { items, correctOrder });
}

test('排序：逐位全同 ⇒ correct', () => {
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  assertVerdict(node, { format: 'order/v1', order: ['i2', 'i1', 'i3'] }, 'correct', P.full);
});

test('排序：至少 1 个位置对、但不是全对 ⇒ partial', () => {
  // ⚠️ 「第 0 位对」与「第 1 位对」分成**两条用例**，不是一个 `test` 里的两行断言：
  // `node:test` 在第一条失败时就会中止这个 `test`，一个 `test` 里的第二条断言等于
  // **没被测到**。判分是本项目「错了难以定位」的那一处，位置的边界要各自可观测。
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  assertVerdict(node, { format: 'order/v1', order: ['i2', 'i3', 'i1'] }, 'partial', P.half); // 只有第 0 位对
});

test('排序：只有中间一位对 ⇒ partial', () => {
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  assertVerdict(node, { format: 'order/v1', order: ['i3', 'i1', 'i2'] }, 'partial', P.half); // 只有第 1 位对
});

test('排序：长度不足时位置判据下不可能全对，至多 partial（真实 UI 不会交，但必须不抛）', () => {
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  assertVerdict(node, { format: 'order/v1', order: ['i2', 'i1'] }, 'partial', P.half);
});

test('排序：一个位置都不对 ⇒ incorrect', () => {
  // 两个条目时「全错」才构造得出来（三个条目里 0 个位置对是可能的，但两条目最清楚）。
  const two = orderNode([{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }], ['i2', 'i1']);
  assertIncorrect(two, { format: 'order/v1', order: ['i1', 'i2'] });
  assertIncorrect(two, { format: 'order/v1', order: [] });
  assertIncorrect(two, { format: 'order/v1', order: ['x', 'y'] });
});

test('🔴 排序：条目顺序与正确顺序一致时，「学生原封不动提交」必须得 correct', () => {
  // 这条同时证明两件事：
  //   ① 判分只在**同一个坐标系**里比位置，不做任何「纠正」；
  //   ② `validateQuestion` 那条「items 与 correctOrder 相同 ⇒ 拒绝」的编辑期校验
  //      **不是多余的** —— 少了它，一道学生什么都不做就满分的题会一路存进库里。
  //      （那条校验在 `worksheet-validate-m4.test.ts`，这里只用判分把后果钉住。）
  const degenerate = orderNode([{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }], ['i1', 'i2']);
  assertVerdict(degenerate, { format: 'order/v1', order: ['i1', 'i2'] }, 'correct', P.full);
});

test('🔴 排序：order 里混进非字符串元素 ⇒ 整体判错（过滤会把位置错开）', () => {
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  assertIncorrect(node, { format: 'order/v1', order: ['i2', 42, 'i3'] });
  assertIncorrect(node, { format: 'order/v1', order: ['i2', '', 'i3'] });
});

test('排序：correctOrder 坏掉 / 缺字段 ⇒ 判错，不抛', () => {
  assertIncorrectWithoutThrow(orderNode(ORDER_ITEMS, []), { format: 'order/v1', order: ['i1', 'i2', 'i3'] });
  assertIncorrectWithoutThrow(question('order', { items: ORDER_ITEMS }),
    { format: 'order/v1', order: ['i1', 'i2', 'i3'] });
});

// ---------------------------------------------------------------------------
// ⑥ 连线 —— 键名分工：教师侧 `data.pairs` / 学生侧 `links`
// ---------------------------------------------------------------------------

const MATCH_LEFT = [{ id: 'l1', text: '甲' }, { id: 'l2', text: '乙' }, { id: 'l3', text: '丙' }];
const MATCH_RIGHT = [{ id: 'r1', text: 'A' }, { id: 'r2', text: 'B' }, { id: 'r3', text: 'C' }];

function matchNode(pairs: Array<{ leftId: string; rightId: string }>): QuestionNode {
  return question('match', { left: MATCH_LEFT, right: MATCH_RIGHT, pairs });
}

test('连线：全部配对正确 ⇒ correct', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  const links = [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }];
  assertVerdict(node, { format: 'match/v1', links }, 'correct', P.full);
  // 顺序无关：`links` 是**一组**连法，不是一条链。
  assertVerdict(node, { format: 'match/v1', links: [...links].reverse() }, 'correct', P.full);
});

test('连线：至少一对正确 ⇒ partial；一对都不对 ⇒ incorrect', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  // ⚠️ 构造里**刻意不含重复的两端**：一条对、一条错，两种口径下都必然是 partial。
  // 含重复的情形（`[{l1,r1},{l2,r1}]`）留给下面那条专门的用例 ——
  // 那里的期望值取决于「哪一条不算对」，别把它混进「基础三态」这条最简单的用例里。
  assertVerdict(node, { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r3' }] },
    'partial', P.half);
  assertIncorrect(node, { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }, { leftId: 'l2', rightId: 'r1' }] });
  assertIncorrect(node, { format: 'match/v1', links: [] });
});

test('🔴 连线：重复连同一个右项 —— 那一条不算对，且**不抛**', () => {
  // 「一条左项只能连一个右项」是连线题的题面约束（`validateQuestion` 用
  // `isCompleteMatching` 把它钉在**教师那一侧**）。学生交上来两条汇到同一个右项的连法
  // 时，那两条里没有一条是可信的 —— 判分不能因为「右项 r3 出现过」就给 l2 记一次对。
  //
  // ⚠️ 两个左项的情形（一条对、一条重复）在不同口径下会给出 `partial` 或 `incorrect`；
  // 这里用**三个左项**构造，让「重复的那条不算对」在两种口径下都落到同一档：
  // l1→r1 对、l2→r3 与 l3→r3 重复（r3 被用了两次）⇒ 只剩 1 对 ⇒ partial。
  const node = matchNode([
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l3', rightId: 'r3' },
  ]);
  const links = [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r3' },
    { leftId: 'l3', rightId: 'r3' }, // r3 被连了两次
  ];
  assertVerdict(node, { format: 'match/v1', links }, 'partial', P.half);

  // 同一对连法重复提交：也不该被算两次（它只可能命中同一个正确配对一次）。
  assertVerdict(node, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l3', rightId: 'r3' },
  ] }, 'partial', P.half);

  // 一条左项被连到两个右项时，**不能**因为它同时含有正确的那条就给满分：
  // 学生画了三条线（l1→r1 对、l2→r2 对、l1→r3 错），l1 那一端是矛盾的。
  const extra = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertVerdict(extra, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l1', rightId: 'r3' },
  ] }, 'partial', P.half);
});

test('连线：形状不全的 links 元素被丢掉，剩下的一条仍可判定（不抛）', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: [null, 42, { leftId: 'l1' }, 'x'] });
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: undefined });
});

test('连线：pairs 坏掉 / 缺字段 ⇒ 判错，不抛', () => {
  assertIncorrectWithoutThrow(matchNode([]), { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] });
  assertIncorrectWithoutThrow(question('match', { left: MATCH_LEFT, right: MATCH_RIGHT }),
    { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] });
});

// ---------------------------------------------------------------------------
// ⑦ 归类 —— 键名分工：教师侧 `data.placement` / 学生侧 `assignment`
// ---------------------------------------------------------------------------

const CAT_ITEMS = [{ id: 'i1', text: '猫' }, { id: 'i2', text: '狗' }, { id: 'i3', text: '麻雀' }];

function categorizeNode(placement: Record<string, unknown>): QuestionNode {
  return question('categorize', {
    items: CAT_ITEMS,
    zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
    placement,
  });
}

test('归类：全部落对 ⇒ correct', () => {
  const node = categorizeNode({ i1: 'z1', i2: 'z1', i3: 'z2' });
  assertVerdict(node, { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z1', i3: 'z2' } }, 'correct', P.full);
});

test('归类：至少一个落对 ⇒ partial；一个都不对 ⇒ incorrect', () => {
  const node = categorizeNode({ i1: 'z1', i2: 'z1', i3: 'z2' });
  assertVerdict(node, { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z2', i3: 'z2' } }, 'partial', P.half);
  assertIncorrect(node, { format: 'categorize/v1', assignment: { i1: 'z2', i2: 'z2', i3: 'z1' } });
  assertIncorrect(node, { format: 'categorize/v1', assignment: {} });
});

test('🔴 归类：有条目没放（缺键）⇒ 那一条算错 —— 学生侧与教师侧两个方向都要钉住', () => {
  // 方向一：**学生的** `assignment` 缺键 ⇒ 那一条算错，剩下的照样给分。
  const node = categorizeNode({ i1: 'z1', i2: 'z1', i3: 'z2' });
  assertVerdict(node, { format: 'categorize/v1', assignment: { i1: 'z1' } }, 'partial', P.half);
  assertVerdict(node, { format: 'categorize/v1', assignment: { i1: 'z1', i3: 'z2' } }, 'partial', P.half);

  // 方向二：**教师的** `placement` 缺键 ⇒ 那一条**没有任何人**能落对（教师建题漏填）。
  // 所以一份「其他都对」的作答只能拿 partial，而**不是** correct。
  // ⚠️ 少了这条，一个漏填的条目会让学生「答对了却拿不到满分」而教师查不出来。
  const missing = categorizeNode({ i1: 'z1', i2: 'z1' }); // i3 没有归属
  assertVerdict(missing, { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z1', i3: 'z2' } },
    'partial', P.half);
});

test('归类：没有条目 / placement 坏掉 ⇒ 判错，不抛（不能真空真给满分）', () => {
  // `items: []` 时 `hit === items.length` 恒真 —— 少了守卫，一道零条目的题会给满分。
  assertIncorrectWithoutThrow(question('categorize', { items: [], zones: [], placement: {} }),
    { format: 'categorize/v1', assignment: {} });
  assertIncorrectWithoutThrow(question('categorize', { items: CAT_ITEMS, zones: [] }),
    { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z1', i3: 'z2' } });
});

test('归类：assignment 里的非字符串值不算「落对」（不抛）', () => {
  const node = categorizeNode({ i1: 'z1', i2: 'z1', i3: 'z2' });
  assertVerdict(node, { format: 'categorize/v1', assignment: { i1: 42, i2: 'z1', i3: 'z2' } }, 'partial', P.half);
  assertIncorrectWithoutThrow(node, { format: 'categorize/v1', assignment: ['z1', 'z1', 'z2'] });
});

// ---------------------------------------------------------------------------
// ⑧ 形状容错（`data` 与 `value` 都来自库里的 JSON / 请求体）
// ---------------------------------------------------------------------------

/** 每个题型的**一份合法数据**（用来把「value 坏掉」与「data 坏掉」分开测）。 */
const SAMPLE_NODES: Record<QuestionType, QuestionNode> = {
  'single-choice': question('single-choice', { options: MULTI_OPTIONS, correctKeys: ['A'] }),
  'true-false': question('true-false', { correctKeys: ['T'] }),
  'multi-choice': multiNode('allow-missing'),
  'fill-blank': question('fill-blank', { answers: ['光合作用'] }),
  'short-answer': question('short-answer', {}),
  order: orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']),
  match: matchNode([{ leftId: 'l1', rightId: 'r1' }]),
  categorize: categorizeNode({ i1: 'z1' }),
};

test('🔴 形状容错：value 是 null / 数字 / 字符串 / 数组 / 缺字段 ⇒ 一律判错，绝不抛', () => {
  const junkValues: unknown[] = [null, undefined, 0, 42, '', 'abc', true, [], ['B'], { selected: 'B' }, {}, { format: 'choice/v1' }];
  for (const type of QUESTION_TYPES) {
    if (!GRADED[type]) continue;
    for (const value of junkValues) {
      assertIncorrectWithoutThrow(SAMPLE_NODES[type], value);
    }
  }
});

test('🔴 形状容错：data 是空对象 / 缺字段 / 根本不是对象 ⇒ 一律判错，绝不抛', () => {
  // `data: null` 这一条是最要命的：`node.data.correctKeys` 会在 `null` 上抛
  // `Cannot read properties of null` —— 提交路径上的一次抛错就是 500。
  for (const type of QUESTION_TYPES) {
    if (!GRADED[type]) continue;
    const blank = question(type, {});
    assertIncorrectWithoutThrow(blank, { format: 'choice/v1', selected: ['A'] });
    assertIncorrectWithoutThrow(blank, { format: 'order/v1', order: ['i1'] });
    assertIncorrectWithoutThrow(blank, { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] });
    assertIncorrectWithoutThrow(blank, { format: 'categorize/v1', assignment: { i1: 'z1' } });
    assertIncorrectWithoutThrow(blank, { format: 'fill-multi/v1', texts: ['x'] });

    for (const data of [null, 42, 'x', [], true]) {
      const broken = { ...SAMPLE_NODES[type], data: data as unknown as Record<string, unknown> };
      assertIncorrectWithoutThrow(broken, { format: 'choice/v1', selected: ['A'] });
    }
  }
});

test('🔴 「参不参与判分」只有两个取值：主观题 ⇒ null，其余题型 ⇒ 一个判定对象', () => {
  for (const type of QUESTION_TYPES) {
    const result = grade(SAMPLE_NODES[type], { format: 'text/v1', text: 'x' }, P);
    if (GRADED[type]) {
      assert.ok(result !== null, `题型「${type}」应当参与判分，却返回了 null`);
    } else {
      assert.equal(result, null, `题型「${type}」不参与判分，应返回 null（null 才是「没判分」）`);
    }
  }
});

// ---------------------------------------------------------------------------
// ⑨ 《学习单级两档》与《逐题优先》（规格 §12 裁定 4）
// ---------------------------------------------------------------------------

test('pointsFromSettings：缺字段 / 坏形状一律回落到 DEFAULT_POINTS', () => {
  for (const settings of [undefined, null, 0, '', 'x', [], [1], true]) {
    assert.deepEqual(pointsFromSettings(settings), DEFAULT_POINTS, `settings=${safeJson(settings)}`);
  }
  assert.deepEqual(pointsFromSettings({}), DEFAULT_POINTS);
  assert.deepEqual(pointsFromSettings({ rewardStyle: 'star' }), DEFAULT_POINTS);
});

test('pointsFromSettings：读 rewardStep（全对档）与 halfStep（半对档）', () => {
  assert.deepEqual(pointsFromSettings({ rewardStep: 3 }), { full: 3, half: 0 });
  assert.deepEqual(pointsFromSettings({ rewardStep: 2, halfStep: 1 }), { full: 2, half: 1 });
  assert.deepEqual(pointsFromSettings({ halfStep: 1 }), { full: 1, half: 1 });
  // 越界的档回落（负数是笔误，不是「0 分」）：
  assert.deepEqual(pointsFromSettings({ rewardStep: -1, halfStep: -1 }), DEFAULT_POINTS);
});

test('🔴 pointsFromSettings：取值域是 0..99，**不是** 1/2/3/5 —— 两者故意不一致', () => {
  // `rewardStep` 在前端那个下拉里今天只有 1 / 2 / 3 / 5 四选一（`REWARD_STEPS`），
  // 而**逐题**的 `points` 不受那个取值域限制（教师可以填 2 或 4）。这个差异是**有意的**：
  // 学习单级是一个四选一的下拉，逐题是两个自由输入框（规格 §12 裁定 4/5）。
  //
  // ⚠️ 所以这里**不能**改成 `normalizeRewardStep` —— 那会让一个库里已有的 `rewardStep: 4`
  // （手工改过 / 将来放宽了取值域）静默变回 1，而教师看到的是「我配的档没生效」。
  assert.deepEqual(pointsFromSettings({ rewardStep: 4 }), { full: 4, half: 0 });
  assert.deepEqual(pointsFromSettings({ rewardStep: 2, halfStep: 4 }), { full: 2, half: 4 });
  // 小数四舍五入（`WorksheetAnswer.score` 是 Float，一个 2.5 会一路走进奖励累计里）。
  assert.deepEqual(pointsFromSettings({ rewardStep: 1.6 }), { full: 2, half: 0 });
});

test('resolvePoints：逐题优先，留空（undefined）才回落学习单级', () => {
  const node = orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']);
  // 没有 `points` ⇒ 整份回落（这正是旧单零迁移的原因）。
  assert.deepEqual(resolvePoints(node, { full: 3, half: 1 }), { full: 3, half: 1 });
  // 有 ⇒ 逐题优先。
  assert.deepEqual(resolvePoints({ ...node, points: { full: 5, half: 2 } }, { full: 3, half: 1 }), { full: 5, half: 2 });
  // 只有一半有效（手工改过的行）：`normalizePoints` 用 DEFAULT_POINTS 补另一半，
  // **不是**用学习单级的那一档 —— 逐题既然填了，它就脱离了学习单级。
  // ⚠️ 那个 `as unknown as` 就是「这一行不是类型系统写出来的」这件事本身：
  // `points` 来自库里的 JSON，`QuestionPoints` 只是编译期的承诺。
  assert.deepEqual(
    resolvePoints({ ...node, points: { full: 5 } as unknown as QuestionPoints }, { full: 3, half: 1 }),
    { full: 5, half: 0 },
  );
  // 两个字段都无效 ⇒ 与「留空」同义，回落。
  assert.deepEqual(
    resolvePoints({ ...node, points: { full: '五', half: null } as unknown as QuestionPoints }, { full: 3, half: 1 }),
    { full: 3, half: 1 },
  );
});

test('resolvePoints：是纯函数 —— 不改 `node.points`，也不改传入的 fallback', () => {
  const node: QuestionNode = { ...orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']), points: { full: 5, half: 2 } };
  const fallback: QuestionPoints = { full: 3, half: 1 };
  const nodeSnapshot = JSON.stringify(node);
  const fallbackSnapshot = JSON.stringify(fallback);

  const resolved = resolvePoints(node, fallback);
  assert.deepEqual(resolved, { full: 5, half: 2 });
  assert.equal(JSON.stringify(node), nodeSnapshot, '逐题分值不得被就地改动');
  assert.equal(JSON.stringify(fallback), fallbackSnapshot, 'fallback 不得被就地改动');
  // 改返回值不该影响 `node.points`（返回的是新对象，不是同一个引用）。
  resolved.full = 99;
  assert.equal(node.points?.full, 5);
});

test('🔴 逐题 × 判分：同一道题在不同的分值档下状态不变、得分跟着走', () => {
  const node = question('multi-choice', { options: MULTI_OPTIONS, correctKeys: ['A', 'C'], partialCredit: 'allow-missing' });
  const value = { format: 'choice/v1', selected: ['A'] };
  assertVerdict(node, value, 'partial', 1, { full: 2, half: 1 });
  assertVerdict(node, value, 'partial', 5, { full: 10, half: 5 });
  assertVerdict(node, value, 'partial', 0, { full: 1, half: 0 }); // 半对档填 0 ⇒ partial 但 0 分
});
