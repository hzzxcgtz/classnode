/**
 * M4a · A2 —— 判分：**三态 + 数值得分**（规格 §12「M4 重开了 §3-S」）。
 *
 * 🔴 **为什么这份文件值得这么大**（规格 §14.4）：判分是本项目唯一「错了教师会发现、
 * 但难以定位」的地方 —— 一道题判错**不会有异常、不会有红测试**，只会在看板上表现为
 * 「这道题正确率偏低」，而教师会去怀疑学生。所以每个题型都同时钉三件事：
 * **全对 / 部分给分 / 错**，外加归一化与**形状容错**的边界。
 *
 * 🔴 第二条主线是**「绝不抛」**：判分在提交路径上，一次抛错就是 500，学生看到的是
 * 「提交失败」并重试。而 `data`（库里的 JSON）与 `value`（请求体）都可能有别的形状，
 * 所以每个题型都有一组「value 是 null / 数字 / 数组 / 缺字段」「data 是空 / 缺字段」的用例。
 *
 * ⚠️ 判分口径的三条**统一规则**（写死在实现里，这里逐条钉住）：
 *   1. 「多个组成部分」的题（多选 / 填空多空 / 排序 / 连线 / 归类）**部分正确 = 部分给分**，
 *      唯一的开关是多选题的「漏选算不算」（教师逐题选）。
 *   2. 选了**错的**一律不给部分分 —— 部分给分只奖励「少做了」，不奖励「做错了」。
 *   3. 坏形状（缺字段、类型不对）一律 `incorrect`，**不是** `null` —— `null` 的语义是
 *      「这题型不判分」（主观题），把它用来表示「读不懂」会让看板把一次 500 级的问题
 *      显示成「主观题」。
 */
import { pointsFromSettings } from '../services/worksheet-points-migration.js';
import { test } from 'node:test';

/**
 * ★ 2026-09-25：**可作答的**题型 —— 即 `QUESTION_TYPES` 去掉容器（`task`）。
 *
 * 🔴 本文件那几条遍历测的是**二分法**：「每个题型，要么判分、要么送去 AI 分析」。
 * 而 `task`（任务容器）**两者都不是** —— 它**根本没有作答值**（教师裁定 ①a）。
 * ⇒ 它不该进那两个集合中的任何一个，但**必须被显式地排除**：
 * 直接用 `QUESTION_TYPES` 会让 `task` 从缝里掉进「不判分 ⇒ 那就该送去分析」那一侧，
 * 而那正是这道闸存在的意义（把「没作答值」误判成「主观题」）。
 * ⚠️ 「`task` 两边都不属于」那一条**不在本文件里**（本文件只测那个二分法，
 * 而 `task` 已被 `ANSWERABLE_TYPES` 滤掉、根本不进循环）。它在
 * `worksheet-task.test.ts`：那边用真的 `grade()` 与真的 `isAnalyzableType()`
 * 各钉一次。本条注释原先写的是「下面另有一条用例」—— **本文件里没有那一条**。
 */
const ANSWERABLE_TYPES = QUESTION_TYPES.filter((t) => t !== 'task');
import assert from 'node:assert/strict';
import {
  DEFAULT_POINTS,
  QUESTION_TYPES,
  grade,
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
 * 「全对给几 / 部分给分给几」，单选 2/1 与填空 1/0 的比例在各题之间不可比）。
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
 * 形状容错的统一判据：**绝不抛**，且**绝不给分**（`null` = 没判过，或 `incorrect` + 0 分）。
 *
 * ⚠️ 用 try/catch 而**不是** `assert.doesNotThrow`：后者失败时只有一句「抛了」，
 * 而这里要把题型与被判的作答值一起打出来。
 *
 * ★ 2026-09-25：判据从「一律 `incorrect`」放宽为「**不是 null 就是 incorrect**」——
 * 选择题的答案空着现在是**合法**的（教师裁定：不设答案 = 不用给分），那时
 * `grade()` 回 `null`（与主观题同一条路）。这一条测的从来是**容错**（不抛）与
 * **不给分**；`null` 与 `incorrect` 都满足后者，而「把 `null` 也算合格」不会放过
 * 任何一个「坏形状反而给了分」的情况 —— 那才是这个 helper 存在的理由。
 */
function assertIncorrectWithoutThrow(node: QuestionNode, value: unknown): void {
  let result: GradeResult | null;
  try {
    result = grade(node, value, P);
  } catch (error) {
    assert.fail(`${node.type} 判分抛错了（作答值 ${safeJson(value)}）：${String(error)}`);
  }
  const state = result?.state ?? null;
  assert.ok(state === 'incorrect' || state === null,
    `${node.type} · 作答 ${safeJson(value)}：坏形状只能判错或「没判过」，实际是 ${String(state)}`);
  assert.equal(result?.score ?? 0, 0, `${node.type} · 作答 ${safeJson(value)}：没判过 / 判错 ⇒ 都不给分`);
}

/** 每个可自动判分的题型都要能拿到「坏形状」用例 —— 见文件末尾那条遍历。 */
const GRADED: Record<QuestionType, boolean> = {
  // ★ 2026-09-25：**任务不判分**（教师裁定 ①a：任务只是分组 + 一段说明，作答全在小题上）。
  //    ⇒ `false` 不是「还没填」，是这一格的**答案**。它与 `drawing: false` 同一档，
  //    但理由不同：绘图是「有人工判读、不自动判」，任务是「**根本没有作答值**」。
  task: false,
  'single-choice': true,
  // ★ 2026-09-26：选择填空**判分**（与填空题共用一支 `judgeFillBlank`）。
  'choice-blank': true,
  'true-false': true,
  'multi-choice': true,
  'fill-blank': true,
  'short-answer': false,
  order: true,
  match: true,
  categorize: true,
  // ★ M4b：绘图题**不判分**（规格 §12 裁定 3）—— 与主观题同一档。
  // ⚠️ 这一支会让文件末尾那条「坏形状一律判错」的遍历**跳过** drawing，那是**对的**
  // （不判分就没有「判错」这一档）；它挡不住的那件事 —— 「绘图题会不会被画出三态」——
  // 由下面那条专门的用例（`🔴 绘图题的任何作答值都判不出三态`）补上。
  drawing: false,
};

// ---------------------------------------------------------------------------
// ① 单选 / 判断 —— 只有一个组成部分，**没有部分给分**
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

test('单选：只有一个组成部分 ⇒ 判不出「部分给分」，近似答案一律算错', () => {
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

test('🔴 单选：**没设答案 ⇒ 不判分**（回 null）；设了**两个**才是坏数据 ⇒ 判错', () => {
  // ⚠️ 本条 2026-09-25 **改过**（教师裁定：选择题的答案非必须，不设 = 不用给分）。
  // 原判据把「0 个」与「2 个」当成同一件事、一律判错 —— 而判错的后果是
  // 看板上「正确率 0%」、抽屉里每人都画 ✗，教师会去怀疑学生，不会来怀疑这道题。
  // ⇒ 两者必须分开：0 个是**合法的新形态**（`grade()` 回 null，与主观题同一条路），
  //    2 个以上仍然是坏数据（判错是**响亮**的那条路，见 `judgeSingleChoice` 的注释）。
  const node = (correctKeys: string[]) => question('single-choice', { options: [{ key: 'A' }], correctKeys });
  assert.equal(grade(node([]), { format: 'choice/v1', selected: ['A'] }, P), null, '0 个答案 ⇒ 没判过');
  assertIncorrect(node(['A', 'B']), { format: 'choice/v1', selected: ['A'] });
});

test('🔴 单选：选中项里混进非字符串元素 ⇒ 整体判错（跳过它 = 奖励坏数据）', () => {
  const sc = question('single-choice', { options: [{ key: 'B' }], correctKeys: ['B'] });
  // `['B', 42]` 若按「跳过非字符串」读就成了「只选了 B」⇒ 给分。那是**安静的虚高**。
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', 42] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', ''] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', null] });
});

test('🔴 单选：选中项先**去重** —— `selected: ["B","B"]` 判对（旧实现判错，有意的行为变更）', () => {
  // 旧实现是 `selected.length === 1 && correct.length === 1 && selected[0] === correct[0]`，
  // 所以 `['B','B']` ⇒ `false`。现在是「去重后就是选了 B」⇒ `correct`。
  // 🔴 **方向是松的，这是一处有意的行为变更**（不是实现顺带改掉的）：
  //   ① 学生端那个勾选控件**产生不了**这种值（手搓请求才可达）；
  //   ② 多选那一侧去重是**必须**的（不去重会让 `['A','A']` 在 allow-missing 下凑成满分），
  //      两处得是同一套「作答值是一个集合」的语义，否则同一个形状在两个题型上含义不同。
  // 这条用例的作用就是把这个口径**显式固定下来** —— 否则下一个人会以为它是漏网的 bug。
  const sc = question('single-choice', { options: [{ key: 'A' }, { key: 'B' }], correctKeys: ['B'] });
  assertVerdict(sc, { format: 'choice/v1', selected: ['B', 'B'] }, 'correct', P.full);
  // 但不是「怎么重复都对」：重复一个**错的**仍然错，重复两个不同的仍是「多选 ⇒ 错」。
  assertIncorrect(sc, { format: 'choice/v1', selected: ['A', 'A'] });
  assertIncorrect(sc, { format: 'choice/v1', selected: ['B', 'A', 'B'] });
  // 判断题与单选共用同一个判分器 ⇒ 同一个口径。
  const tf = question('true-false', { correctKeys: ['T'] });
  assertVerdict(tf, { format: 'choice/v1', selected: ['T', 'T'] }, 'correct', P.full);
});

test('🔴 score 是教师填的**绝对值**，不是 0/0.5/1 的比例', () => {
  const tf = question('true-false', { correctKeys: ['T'] });
  const right = { format: 'choice/v1', selected: ['T'] };
  // 同一个判定，三份不同的分值档 ⇒ 三个不同的得分。任何「返回比例」的实现在这里必红。
  assertVerdict(tf, right, 'correct', 1, { full: 1, half: 0 });
  assertVerdict(tf, right, 'correct', 5, { full: 5, half: 2 });
  // ⚠️ ★ M4a/I1：这一行的 `{ full: 0 }` 是**判分层**的输入，不是一处可达状态 ——
  // 写入口之后 `full: 0` 会被拒（400，见 `isRejectedFullPointValue` 与
  // `routes/worksheets.ts` 的 `normalizeNode`），`resolvePoints` 也不会吐出它。
  // 留着它是为了钉住**这一层的边界**：`grade()` 只做算术（score = full），
  // **它不负责守 `full` 的域** —— 守域的是写入口。删掉这条会让人以为判分器会拒 0。
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

test('多选 · 全对才算（all-or-nothing）：漏选是**错**，不是部分给分 —— 这是教师逐题选的', () => {
  const node = multiNode('all-or-nothing');
  assertVerdict(node, { format: 'choice/v1', selected: ['A', 'C'] }, 'correct', P.full);
  assertIncorrect(node, { format: 'choice/v1', selected: ['A'] });          // 漏选
  assertIncorrect(node, { format: 'choice/v1', selected: ['C'] });          // 漏选
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B', 'C'] }); // 多选
  assertIncorrect(node, { format: 'choice/v1', selected: [] });             // 没选
  // 顺序无关：作答值是一个**集合**，`['C','A']` 与 `['A','C']` 是同一个答案。
  assertVerdict(node, { format: 'choice/v1', selected: ['C', 'A'] }, 'correct', P.full);
});

test('多选 · 漏选算部分给分（allow-missing）：漏选且非空 ⇒ partial', () => {
  const node = multiNode('allow-missing');
  assertVerdict(node, { format: 'choice/v1', selected: ['A', 'C'] }, 'correct', P.full);
  assertVerdict(node, { format: 'choice/v1', selected: ['A'] }, 'partial', P.half);
  assertVerdict(node, { format: 'choice/v1', selected: ['C'] }, 'partial', P.half);
});

test('🔴 多选 · 选了错的一律不给部分分（部分给分只奖励「少做了」，不奖励「做错了」）', () => {
  const node = multiNode('allow-missing');
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B'] });       // 漏 C 且多了 B
  assertIncorrect(node, { format: 'choice/v1', selected: ['A', 'B', 'C'] });  // 全选但不全对
  assertIncorrect(node, { format: 'choice/v1', selected: ['B'] });            // 只选了一个错的
  assertIncorrect(node, { format: 'choice/v1', selected: [] });               // 空选 ≠ 漏选
});

test('🔴 多选 · 重复的键先去重 —— 不去重会把「只选了 A」读成「选了两个」而凑成满分', () => {
  const allowMissing = multiNode('allow-missing');
  // `['A','A']` 的真实含义是「只选了 A」= 漏选 ⇒ 部分给分。若按元素个数比较（2 == 2），
  // 它会变成 `correct` —— 一次**没有任何报错**的虚高。
  assertVerdict(allowMissing, { format: 'choice/v1', selected: ['A', 'A'] }, 'partial', P.half);
  assertIncorrect(multiNode('all-or-nothing'), { format: 'choice/v1', selected: ['A', 'A'] });
});

test('🔴 多选 · partialCredit 认不出的值一律按「全对才算」（认不出 ≠ 允许漏选）', () => {
  // 方向是刻意选的：把「认不出」当成「允许漏选」会让一道本该判错的题**静默地给学生半分**，
  // 而教师看不出任何异常（他以为自己选的是「全对才算」）。反过来，认不出的值当成
  // 「不给部分分」，教师至少能看到「我选了算部分给分但分数没给」—— 那是可见的。
  for (const credit of [undefined, null, '', 'ALLOW-MISSING', 'allow-missing ', 'allowMissing', 1, true, {}, []]) {
    assertIncorrect(multiNode(credit), { format: 'choice/v1', selected: ['A'] });
  }
});

test('🔴 多选：**没设答案 ⇒ 不判分**（回 null）；非字符串元素照旧跳过', () => {
  // ⚠️ 本条 2026-09-25 改过：`correctKeys: []` 从「判错」变成「回 null」——
  // 与单选那条同一个裁定（选择题答案非必须）。理由见 `judgeMultiChoice`。
  assert.equal(grade(question('multi-choice', { options: MULTI_OPTIONS, correctKeys: [] }),
    { format: 'choice/v1', selected: ['A'] }, P), null);
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

test('填空（单空）：多列几个可接受答案 —— 任一命中即全对，没有部分给分', () => {
  const node = question('fill-blank', { answers: ['光合作用', '光合作用作用'] });
  assertVerdict(node, { format: 'fill/v1', text: '光合作用作用' }, 'correct', P.full);
  assertIncorrect(node, { format: 'fill/v1', text: '呼吸作用' });
  // 近似答案不是部分给分：单空只有一个组成部分。
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

test('🔴 填空（单空）：只含空白的可接受答案不算答案 —— 学生交空串不得满分', () => {
  // 「洞只关了一半」。审查者实测（修之前）：
  //   `['',  '光合作用']` + 学生 `''`    ⇒ incorrect ✅（空串那半关上了）
  //   `[' ', '光合作用']` + 学生 `''`    ⇒ **correct（满分）** ❌ ← 这一行
  // 根因：`readStrings` 丢的是**空串**，丢不掉**只含空白**的串，而 `normalizeFillText(' ')`
  // 就是 `''` ⇒「学生什么都没填」命中了教师答案表里的那个空白行。
  // ⚠️ `[' ', '光合作用']` **存得进库**：`validateQuestion` 只要求
  // `answers.some((a) => a.trim())` —— 另一个元素非空即通过。
  const node = question('fill-blank', { answers: [' ', '光合作用'] });
  assertIncorrect(node, { format: 'fill/v1', text: '' });
});

test('🔴 填空（单空）：同上 —— 学生交全空白串也不得满分', () => {
  // 审查者实测的那一行：`[' ', '光合作用']` + 学生 `'   '` ⇒ **correct** ❌（修之前）
  // 与上一条**分开**成两个 `test`：`node:test` 在首条断言失败时就中止本 `test`，
  // 一个 `test` 里的两行等于**只测了一行**（反证 ② 踩过这个坑）。
  const node = question('fill-blank', { answers: [' ', '光合作用'] });
  assertIncorrect(node, { format: 'fill/v1', text: '   ' });
  assertIncorrect(node, { format: 'fill/v1', text: '\t' });
});

test('填空（单空）：答案表里只有空白项 ⇒ 没有人能答对；非空白那一档不受影响', () => {
  // 「只有空白」时不能因为 `answers.some(...)` 空数组恒假而**抛**，也不能反过来判对。
  assertIncorrect(question('fill-blank', { answers: [' ', '  '] }), { format: 'fill/v1', text: '' });
  assertIncorrect(question('fill-blank', { answers: [' ', '  '] }), { format: 'fill/v1', text: '光合作用' });
  // 上面的用例不是「把这道题整体判死」—— 同一份答案里非空白的那个照样算对。
  // ⚠️ 这里刻意不数「上面 N 条」：那种数每加一条用例就漂，而拿旧数字当期望值是假绿。
  assertVerdict(question('fill-blank', { answers: [' ', '光合作用'] }),
    { format: 'fill/v1', text: '光合作用' }, 'correct', P.full);
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

test('填空（多空）：有一空对、至少一空错 ⇒ partial（部分给分是**按空**算的）', () => {
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

test('🔴 填空（多空）：只含空白的可接受答案同样不算答案（纵深防御）', () => {
  // ⚠️ **这不是「同一个洞的第二处」**（本条注释曾经这么写，与实情不符）。
  // 多空这一处**在写入口就是堵着的**：`validateQuestion` 的填空题（有 `blanks` 时）
  // 逐个空要求「至少要有一个可接受的答案」，而它的判据是 `answer.trim()` ——
  // 所以 `blanks: [{ answers: [' '] }, …]` **存不进库**（实测：`validateQuestion` 回
  // 「填空题每个空至少要有一个可接受的答案」⇒ 保存路径 400）。单空那一支同理。
  //
  // ⇒ 下面过滤的是**纵深防御**：它挡的是不经过写入口的行 —— 手工改过的库、旧版本落的、
  // 或将来某个绕过 `parseContent` 的写入点。`judgeFillBlank` 两条分支各读一次答案表，
  // 只在单空那一支过滤等于把这条路留给另一支，而它的代价是**满分**：
  // 这里第 1 个空的可接受答案是 `' '`，不过滤的话「第 1 空什么都不填」会被算成对，
  // 于是 `texts: ['', 'CO2']` 拿到满分（而不是 partial 或 incorrect）。
  const node = question('fill-blank', { blanks: [{ answers: [' '] }, { answers: ['CO2'] }] });
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['', 'CO2'] }, 'partial', P.half);
  assertVerdict(node, { format: 'fill-multi/v1', texts: ['   ', 'CO2'] }, 'partial', P.half);
  // 两个空都是空白答案 ⇒ 什么都交都拿不到分（这一空的 `acceptable` 为空 ⇒ 算错）。
  const allBlank = question('fill-blank', { blanks: [{ answers: [' '] }, { answers: ['  '] }] });
  assertIncorrect(allBlank, { format: 'fill-multi/v1', texts: ['', ''] });
  assertIncorrect(allBlank, { format: 'fill-multi/v1', texts: [' ', ' '] });
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

test('连线：教师未配对的左项应留空；学生留空为正确，多连线不算全对', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertVerdict(node, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
  ] }, 'correct', P.full);
  assertVerdict(node, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l3', rightId: 'r3' },
  ] }, 'partial', P.half);
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

test('🔴 连线：一个左项连了两条（一条对一条错）⇒ **partial**（★ 2026-09-28 裁定甲变了这一档）', () => {
  // 🔴 **这条用例是本次改动的见证**：它原来断言的是 `incorrect`。
  //
  // 旧规则（一对一）：某个左项/右项**一共被用到超过一次** ⇒ 用到它的那些线**全不算对**
  // ⇒ l1 被用了两次 ⇒ 那条对的也被作废 ⇒ 0 命中 ⇒ `incorrect`。
  // 新规则（教师裁定「甲」：支持一对多 / 多对一 / 多对多）：**逐条判断对错** ——
  // 一条线对不对只看它自己在不在正确答案里 ⇒ l1→r1 算一条命中 ⇒ `partial`。
  //
  // ⚠️ 这就是那条规则**改变了老题判分**的地方（教师知情并选了甲）：同一种作答，
  //    分数从「0 分」变宽松成「部分给分」。方向是「更公平」，但它确实变了。
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }]);
  const value = { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }] };
  assert.equal(grade(node, value, { full: 2, half: 1 })?.state, 'partial');
});

test('🔴 连线：**一对多**（同一个左项连两个右项）⇒ correct', () => {
  // 教师在勾选矩阵里同一行勾两格 —— 这是本次新增的能力，旧规则会把它判错。
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }]);
  const value = { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }] };
  assert.equal(grade(node, value, { full: 2, half: 1 })?.state, 'correct');
});

test('🔴 连线：**多对一**（两个左项连同一个右项）⇒ correct', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' }]);
  const value = { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' }] };
  assert.equal(grade(node, value, { full: 2, half: 1 })?.state, 'correct');
});

test('🔴 连线：**多对多**答全 ⇒ correct；多连一条错线 ⇒ 至多 partial', () => {
  const node = matchNode([
    { leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' },
    { leftId: 'l2', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' },
  ]);
  const all = { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' },
    { leftId: 'l2', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' },
  ] };
  assert.equal(grade(node, all, { full: 2, half: 1 })?.state, 'correct', '四条全对');
  // 多连一条错的：命中仍是 4，但 `links.length` 多于答案 ⇒ **不给全对**
  // （与多选题那条纪律同源：部分给分只奖励「少做」，不奖励「做错」）
  const extra = { format: 'match/v1', links: [...all.links, { leftId: 'l3', rightId: 'r9' }] };
  assert.equal(grade(node, extra, { full: 2, half: 1 })?.state, 'partial', '多连错线 ⇒ 不能全对');
});

test('🔴 连线：同一条线提交两次 ⇒ 算一条命中、但拿不到全对（旧规则是「一条都不算」）', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }]);
  const value = { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r1' }] };
  assert.equal(grade(node, value, { full: 2, half: 1 })?.state, 'partial');
});
test('🔴 连线：links 里含形状不全的元素 ⇒ 整个作答判错', () => {
  // ⚠️ 这里**刻意不是**「丢掉坏元素、剩下的一条仍可判定」（那是本用例的第一版，
  // 按它写的话判分是错的）。审查者探针（正确配对 `[{l1,r1},{l2,r2}]`）：
  //
  //   学生 links = [{l1,r1}, {l2,r2}, {l1}]      → 丢掉第三条 ⇒ 剩下两条**全对** ⇒ `correct`（2 分）
  //   学生 links = [{l1,r1}, {l2,r2}, {l1,r3}]   → 三条都在 ⇒ `partial`（1 分）
  //
  // ⇒ **越残缺的作答反而拿到越高的分**。根因是丢掉的那条线在「一条线只能连一个端点」
  // 这个检测里的那一票也一起消失了 —— 过滤不是忽略噪声，是**改写答案**。
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertIncorrect(node, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l1' },                                  // ← 缺 rightId
  ] });
});

test('🔴 连线：形状乱七八糟的 links（null / 数字 / 字符串 / 缺字段）⇒ 整体判错，不抛', () => {
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: [null, 42, { leftId: 'l1' }, 'x'] });
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, null] });
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: [{ leftId: 'l1', rightId: '' }] });
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: undefined });
  assertIncorrectWithoutThrow(node, { format: 'match/v1', links: 'x' });
});

test('🔴 连线：同一条线换成形状**齐全**的错线 ⇒ partial（这就是上面那条的对照）', () => {
  // 与上面同一种作答，只把第三条从「形状不全」换成「两边齐全、连错了」：
  // 它现在**参与**重复端检测 ⇒ 0 < 1，`incorrect` < `partial`。
  // ⇒ 有了这条对照，上面那条「坏元素整体判错」才是在**纠正顺序**，而不是「一刀切」。
  const node = matchNode([{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }]);
  assertVerdict(node, { format: 'match/v1', links: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
    { leftId: 'l1', rightId: 'r3' },                   // ← 两边齐全，但 l1 被连了两次
  ] }, 'partial', P.half);
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
  // ★ 2026-09-25：任务的「一份合法数据」= **一个装着小题的容器**。
  //    ⚠️ 里面必须**真的有**一道小题：`VALIDATORS['task']` 会把空任务判为不合法
  //    （一个空任务在界面上是一块空白，学生端会渲染出只有标题、没东西可答的一段）。
  //    ⚠️ `inputMode` 对任务是**无意义**的（它没有作答控件），但它是 `QuestionNode` 的必填字段
  //    ⇒ 这里给 `'keyboard'` 只是为了满足形状，别把它读成「任务用键盘作答」。
  task: { id: 'q_task', type: 'task', prompt: '', data: {}, inputMode: 'keyboard', children: [question('single-choice', { options: MULTI_OPTIONS, correctKeys: ['A'] })] },
  'single-choice': question('single-choice', { options: MULTI_OPTIONS, correctKeys: ['A'] }),
  // ★ 2026-09-26：选择填空的合法数据 = 每空一份答案 + 待选词（词数 ≥ 空数）。
  'choice-blank': question('choice-blank', { answers: [['阳光'], ['水分']], choices: ['阳光', '水分', '空气'] }),
  'true-false': question('true-false', { correctKeys: ['T'] }),
  'multi-choice': multiNode('allow-missing'),
  'fill-blank': question('fill-blank', { answers: ['光合作用'] }),
  'short-answer': question('short-answer', {}),
  order: orderNode(ORDER_ITEMS, ['i2', 'i1', 'i3']),
  match: matchNode([{ leftId: 'l1', rightId: 'r1' }]),
  categorize: categorizeNode({ i1: 'z1' }),
  // ★ M4b：绘图题的合法数据就是空对象（教师没有答案要配）。
  drawing: question('drawing', {}),
};

test('🔴 形状容错：value 是 null / 数字 / 字符串 / 数组 / 缺字段 ⇒ 一律判错，绝不抛', () => {
  const junkValues: unknown[] = [null, undefined, 0, 42, '', 'abc', true, [], ['B'], { selected: 'B' }, {}, { format: 'choice/v1' }];
  for (const type of ANSWERABLE_TYPES) {
    if (!GRADED[type]) continue;
    for (const value of junkValues) {
      assertIncorrectWithoutThrow(SAMPLE_NODES[type], value);
    }
  }
});

test('🔴 形状容错：data 是空对象 / 缺字段 / 根本不是对象 ⇒ 绝不抛，且绝不给分', () => {
  // `data: null` 这一条是最要命的：`node.data.correctKeys` 会在 `null` 上抛
  // `Cannot read properties of null` —— 提交路径上的一次抛错就是 500。
  for (const type of ANSWERABLE_TYPES) {
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
  for (const type of ANSWERABLE_TYPES) {
    const result = grade(SAMPLE_NODES[type], { format: 'text/v1', text: 'x' }, P);
    if (GRADED[type]) {
      assert.ok(result !== null, `题型「${type}」应当参与判分，却返回了 null`);
    } else {
      assert.equal(result, null, `题型「${type}」不参与判分，应返回 null（null 才是「没判分」）`);
    }
  }
});

// ---------------------------------------------------------------------------
// ⑧.1 ★ M4b：手写 / 绘图**不参与判分**（规格 §12 裁定 3）—— 两条独立的闸
// ---------------------------------------------------------------------------
//
// 🔴 为什么是**两条**：判「作答值是 ink」与判「题型是 drawing」管的是两件不同的事 ——
//   · 教师把作答模式从手写改回键盘之后，那道题**不再是 drawing**，而学生库里那份
//     ink 值还在 ⇒ 挡住它的是**值**那一闸；
//   · 值被手改成别的形状（或某个旧客户端发来 `{ text: … }`）时，挡住它的是**题型**那一闸。
// 少任何一条，那一侧就会静默地掉进判分器 —— 而判分器对 ink 值一个判分字段都读不到，
// 于是**每一幅画都被判成「✗ 答错」**，并计进正确率的分母。

test('🔴 绘图题的任何作答值都判不出三态（不判分，不是判错）', () => {
  const node = question('drawing', {});
  for (const value of [null, 0, {}, { format: 'ink/v1' }, { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] }]) {
    assert.equal(grade(node, value, P), null, `绘图题不该有判定：${JSON.stringify(value)}`);
  }
});

test('🔴 闸二：**任何题型**收到 ink 作答值都判不出三态（`format` 是判据，题型不是）', () => {
  // ⚠️ 这条盯的是「教师把手写改回键盘」那一半 —— 用一个**会判分**的题型（填空题）
  // 装一个 ink 值。没有 `judge()` 开头那条短路时，`judgeFillBlank` 读 `value.text`
  // 读到 `undefined` ⇒ 回 `'incorrect'`，也就是把一幅手写的字判成答错。
  const node = question('fill-blank', { answers: ['光合作用'] });
  const inkValues = [
    { format: 'ink/v1', canvas: { w: 320, h: 160 }, strokes: [{ color: '#1f2937', width: 0.016, points: [[0.1, 0.2]] }] },
    { format: 'drawing/v1', canvas: { w: 320, h: 240 }, strokes: [] },
  ];
  for (const value of inkValues) {
    assert.equal(grade(node, value, P), null, `ink 值不该有判定：${JSON.stringify(value)}`);
  }
  // 对照（**同一道题、同一条路径**）：非 ink 的坏形状仍然照常判错 —— 短路只对 ink 生效，
  // 它不是「把判分器关掉」。
  assert.equal(grade(node, { format: 'text/v1' }, P)?.state, 'incorrect');
  assert.equal(grade(node, null, P)?.state, 'incorrect');
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

test('pointsFromSettings：读 rewardStep（全对档）与 halfStep（部分给分档）', () => {
  assert.deepEqual(pointsFromSettings({ rewardStep: 3 }), { full: 3, half: 0 });
  assert.deepEqual(pointsFromSettings({ rewardStep: 2, halfStep: 1 }), { full: 2, half: 1 });
  assert.deepEqual(pointsFromSettings({ halfStep: 1 }), { full: 1, half: 1 });
  // 越界的档回落（负数是笔误，不是「0 分」）：
  assert.deepEqual(pointsFromSettings({ rewardStep: -1, halfStep: -1 }), DEFAULT_POINTS);
});

test('🔴 pointsFromSettings：`full` 的域是 1..99（0 不算数）、`half` 是 0..99 —— 与那个四选一故意不一致', () => {
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
  // ★ M4a/I1（2026-09-24 终审的限定复查带出）：**`rewardStep: 0` 不是「全对 0 分」。**
  // `REWARD_STEPS` 只约束**写入口**（`normalizeSettings`），管不到手工改过的行 ——
  // 原先本函数走宽的 `normalizePointValue`（0..99），会把 `rewardStep: 0` 原样吐成
  // `{full: 0}` ⇒ `resolvePoints` ⇒ `grade(答对)` = `{state:'correct', score:0}` ⇒
  // **I1 那四个观测原样回来**（学生画红叉、教师画绿勾、正确率算全对、奖励 +0）。
  // ⇒ 现在 `full` 也过 `isUsableFullPointValue`，不在域里就回落 `DEFAULT_POINTS.full`。
  // 反证：把 `pointsFromSettings` 的 `full` 改回 `normalizePointValue(source.rewardStep, …)`
  // ⇒ **本用例变红**（2026-09-24 实测：1 条红、其余 475 绿 —— 三行断言在同一个用例里，
  // 而 `node:test` 在第一条断言就停，所以红的是**一条用例**而不是三条）。
  assert.deepEqual(pointsFromSettings({ rewardStep: 0 }), { full: 1, half: 0 }, '0 落回默认档 1，不是「答对 0 分」');
  assert.deepEqual(pointsFromSettings({ rewardStep: 0.4 }), { full: 1, half: 0 }, '取整到 0 的同样落回（与 normalizePoints 同一把尺子）');
  assert.deepEqual(pointsFromSettings({ rewardStep: 0, halfStep: 2 }), { full: 1, half: 2 }, '只动全对档，部分给分那一档不受影响');
  // ⚠️ 反过来：**部分给分档的 0 必须原样保留** —— 它是「不给部分分」，是 §12 裁定 3 的默认档，
  // 也是 `shouldWarnZeroHalfCredit` 那条提示的地基。把这一行改红就是把两个域又合并了。
  assert.deepEqual(pointsFromSettings({ rewardStep: 3, halfStep: 0 }), { full: 3, half: 0 });
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
  assertVerdict(node, value, 'partial', 0, { full: 1, half: 0 }); // 部分给分档填 0 ⇒ partial 但 0 分
});
