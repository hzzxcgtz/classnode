import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetBoardAnswerRow, WorksheetQuestionNode } from '@/lib/types';
import {
  QUESTION_TYPE_OPTIONS,
  type QuestionType,
} from '../../../lib/worksheet-questions.ts';
import {
  formatAnswer,
  indexQuestions,
  participantColumnTitle,
  participantUnitLabel,
  questionAggregate,
  questionHeading,
  GRADED_QUESTION_TYPES,
  isGradedType,
  outcomeMarkView,
  questionOutcome,
  statusLabel,
  // ★ 2026-09-28：形态 A 的「该生全貌」与「答题过程」
  formatAgo,
  clearConfirmText,
  inProgressQuestionId,
  participantOverview,
  participantOverviewCells,
  processFacts,
} from './worksheet-drawer-state.ts';

/**
 * 学习单抽屉的判据（形态 A / B）。
 *
 * 每个 describe 对应一条**错了不报错**的规则，报告里的实测输出就是这些用例：
 *   · 主观题没有 ✓/½/✗（并且 `gradeState` / `isCorrect` 被手工改成「对」也一样没有）；
 *   · 未作答的题**不给**「标记已查看」按钮（服务端对它会回 409）；
 *   · 正确率的分母是「已判过的行」，不是参与者数；
 *   · ★ M4a **正确率的分子只数全对**（部分给分进分母不进分子 ⇒ 10 行 4/3/3 是 **40%**）；
 *   · ★ M4a 三档标记以 `gradeState` 为**真源**，`isCorrect` 只在它缺失时兜底；
 *   · ★ E2 **四档在界面上两两可区分**（部分给分是 `½ 部分给分`，既不长得像答错、也不像没判分，
 *     而且**不许**沿用 `◐` —— 那个符号在同一列上已经是「作答中 / 已提交但没有对错」）；
 *   · 「已交 N/M」的分母是参与者数，不是答过的人；
 *   · 量词跟着模式走（高级模式下列的是组）。
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-drawer-state.test.ts
 * ```
 */

function node(over: Partial<WorksheetQuestionNode> & { id: string; type: string }): WorksheetQuestionNode {
  return {
    prompt: '题干',
    inputMode: 'keyboard',
    data: {},
    children: [],
    ...over,
  };
}

const choice = node({
  id: 'q_1', type: 'single-choice', prompt: '光合作用需要哪些条件？',
  data: { options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }], correctKeys: ['B'] },
});
const fill = node({ id: 'q_2', type: 'fill-blank', prompt: '水的化学式是____', data: { answers: ['H2O'] } });
const short = node({ id: 'q_3', type: 'short-answer', prompt: '说说你观察到的现象。' });

function row(over: Partial<WorksheetBoardAnswerRow>): WorksheetBoardAnswerRow {
  return {
    questionId: 'q_1', status: 'draft',
    isCorrect: null, gradeState: null, score: null,
    reviewedAt: null, value: null,
    // ★ 2026-09-28：作答活动三列。默认 `null` = **不知道** —— 这是本助手最诚实的一档：
    // 这些夹具说的是「这一行的作答状态」，而不是「他保存过几次」。要测过程区的用例
    // 必须自己传这三个值（`...over` 允许）。
    createdAt: null, savedAt: null, saveCount: null,
    ...over,
  };
}

/**
 * 造一条**线缆上真会出现、类型却说不会**的行：`gradeState` 是个本地类型没写到的值。
 *
 * 🔴 为什么要留这个口子：`WorksheetBoardAnswerRow.gradeState` 被收窄成了三态联合，而
 * **浏览器里的 bundle 与服务端不保证同一个版本**（服务端将来加第四档时，本地这份类型
 * 根本不知道）。`rowVerdict` 第 3 条分支防的正是这件事，可它**只有绕过类型才验得了** ——
 * 断言不是多余的：把那一支删掉（改成掉回 `isCorrect`）在类型上完全合法、跑起来也不报错，
 * 表现却是「新档被判成答错」。
 */
function wireRow(over: Record<string, unknown>): WorksheetBoardAnswerRow {
  return row(over as Partial<WorksheetBoardAnswerRow>);
}

// ---------------------------------------------------------------------------
// 形态 A · 逐题详情
// ---------------------------------------------------------------------------

test('形态 A：未作答的题「无对错、无按钮、无原答案」', () => {
  const outcome = questionOutcome(choice, undefined);
  assert.equal(outcome.status, 'unanswered');
  assert.equal(outcome.mark, 'none');
  assert.equal(outcome.reviewed, false);
  assert.equal(
    outcome.canReview, false,
    '未作答的题不能给「标记已查看」—— 服务端对它会回 409，那是一个必然失败的按钮',
  );
  assert.equal(outcome.answerText, null);

  // 阴性对照：库里真有一行 `unanswered` 时结论一模一样（不是靠「没有 row」才碰巧对）。
  assert.deepEqual(questionOutcome(choice, row({ status: 'unanswered' })), outcome);
});

test('形态 A：主观题**永远没有对错**，即使库里那行的 isCorrect / gradeState 被改成了「对」', () => {
  const submitted = row({ questionId: 'q_3', status: 'submitted', isCorrect: true, value: { format: 'text/v1', text: '冒泡了' } });
  const outcome = questionOutcome(short, submitted);
  assert.equal(outcome.status, 'submitted', '状态是「已提交」（它确实交了）');
  assert.equal(outcome.mark, 'none', '主观题不该出现 ✓/½/✗ —— 系统根本不知道学生对不对');
  assert.equal(outcome.canReview, true, '主观题照样可以「标记已查看」');
  assert.equal(outcome.answerText, '冒泡了', '原答案照给');

  // ★ M4a 的第二道闸：`isCorrect` 之外，`gradeState` 也被手工写成「对」时同样什么都没有
  //（服务端的 `grade()` 对主观题恒回 null，所以这一行只可能是手改出来的）。
  assert.equal(
    questionOutcome(short, row({ questionId: 'q_3', status: 'submitted', gradeState: 'correct', isCorrect: true })).mark,
    'none',
    '主观题不看 gradeState —— `short-answer` 在注册表里是 graded: false',
  );

  // 阳性对照：同样一行数据换到单选题上**必须**显示对错 —— 否则上面那句只是「什么都不显示」。
  assert.equal(questionOutcome(choice, { ...submitted, questionId: 'q_1', value: { format: 'choice/v1', selected: ['B'] } }).mark, 'correct');
});

test('🔴 形态 A：三档标记读 gradeState —— 部分给分画出自己那一档，既不是「对」也不是「错」', () => {
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'correct', isCorrect: true })).mark,
    'correct',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false })).mark,
    'partial',
    '部分给分落到 wrong 的话，「算进分母却不算对」就看起来是答错了（规格 §12 要它在看板那一侧、即抽屉里画得出来）',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'incorrect', isCorrect: false })).mark,
    'wrong',
    '界面这一档叫 wrong（规格 §12 逐字），不叫服务端的 incorrect',
  );
  // 判据没变的两条：没提交就没有标记（哪怕库里已经有结论），没有结论就是 none。
  assert.equal(questionOutcome(choice, row({ status: 'draft', gradeState: 'correct' })).mark, 'none', '作答中不判有对错');
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: null, isCorrect: null })).mark,
    'none',
    '关闭自动判分时服务端两个字段都给 null ⇒ 退化成「已提交」，不显示 ✗（把「没判」说成「错」是最坏的一种）',
  );
});

test('🔴 形态 A：gradeState 与 isCorrect 打架时以 gradeState 为准（它是真源，另一个是派生）', () => {
  // 部分给分那一行**必然**是 `isCorrect: false`（那个布尔的语义已收窄为「全对」）——
  // 光看布尔值，它与「答错」长得一模一样，这正是要加 gradeState 这一列的原因。
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false })).mark,
    'partial',
    '部分给分的 isCorrect 是 false ⇒ 读布尔值会把部分给分说成答错',
  );
  // 反过来也一样：库里 isCorrect 是脏的（true）也不改结论 —— 两张表打架时真源只有一个。
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'incorrect', isCorrect: true })).mark,
    'wrong',
  );
});

test('🔴 形态 A：gradeState 缺失时 isCorrect 兜底（回填没跑到的旧行），认不出的值不猜', () => {
  // ⚠️ 这两行是**兜底**不是第二条路：A1 的启动期回填已把 M3 旧行的 gradeState 补齐，
  // 所以它只在「回填没跑到」时生效。删掉它不会让任何用例变红，
  // 表现是「升级当天所有历史作答的标记消失」。
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: true })).mark,
    'correct',
    'gradeState 为 null ⇒ 退到 isCorrect（旧行）',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: false })).mark,
    'wrong',
    '旧行里没有「部分给分」这个概念（M4a 才有）⇒ false 只能落 incorrect，猜成 partial 是编的',
  );
  // 🔴 认不出的新档 ⇒ 什么都不画。**不**掉回 isCorrect：一个 false 会把新档说成「答错」，
  // 而「没有标记」至少是一句真话（系统没给出这一档）。
  assert.equal(
    questionOutcome(choice, wireRow({ status: 'submitted', gradeState: 'exempt', isCorrect: false })).mark,
    'none',
    '类型没写到的档位不许猜 —— 猜错的方向是把「不知道」说成「错」',
  );
});

test('形态 A：客观题的标记只认「已提交 + 有一份判分结论」，作答中一概不判', () => {
  // ★ M4a：这一组走的是 `rowVerdict` 的**兜底**那一支（`gradeState` 为 null、只有 isCorrect）。
  // 上面那条用例把三态与优先级都钉住了，这里保留的是「判据的边界」这一层：
  assert.equal(questionOutcome(choice, row({ status: 'draft', isCorrect: true })).mark, 'none', '作答中不判对错');
  assert.equal(questionOutcome(choice, row({ status: 'submitted', isCorrect: false })).mark, 'wrong');
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: null })).mark, 'none',
    '关闭自动判分时服务端给 null ⇒ 退化成「已提交」，不显示 ✗（把「没判」说成「错」是最坏的一种）',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: false })).status, 'submitted',
    '没有 ✓/½/✗ 不代表状态栏空着',
  );
});

test('形态 A：「已查看」按钮的状态由 reviewedAt 决定，作答过才有按钮', () => {
  const reviewed = questionOutcome(choice, row({ status: 'submitted', isCorrect: true, reviewedAt: '2026-09-23T02:00:00.000Z' }));
  assert.equal(reviewed.reviewed, true);
  assert.equal(reviewed.canReview, true, '已看过的题仍给按钮（重复点=刷新「最后查看时间」，服务端就是这么写的）');

  const fresh = questionOutcome(choice, row({ status: 'submitted', isCorrect: true }));
  assert.equal(fresh.reviewed, false);
  assert.equal(fresh.canReview, true);

  // 作答中也能标记已查看：服务端只要求「这一行在不在」，draft 那一行是在的。
  assert.equal(questionOutcome(choice, row({ status: 'draft', value: { format: 'choice/v1', selected: ['A'] } })).canReview, true);
});

test('形态 A：原答案的读法 —— 单选给选项文字，读不出来时退回 key；填空问答给原文', () => {
  assert.equal(formatAnswer(choice, { format: 'choice/v1', selected: ['B'] }), 'B. 阳光');
  // 选项对不上（题被改过 / 上个版本的值）⇒ 退回 key 本身，**不显示空白**（空白像是没选）。
  assert.equal(formatAnswer(choice, { format: 'choice/v1', selected: ['Z'] }), 'Z');
  assert.equal(formatAnswer(fill, { format: 'fill/v1', text: 'H2O' }), 'H2O');
  assert.equal(formatAnswer(short, { format: 'text/v1', text: '  叶片上有气泡  ' }), '叶片上有气泡');
  // 读不出来的形状一律 null，不抛（渲染路径上一次 TypeError 会让整个抽屉白屏）。
  assert.equal(formatAnswer(fill, null), null);
  assert.equal(formatAnswer(fill, { format: 'ink/v1', strokes: [] }), null);
  assert.equal(formatAnswer(short, { format: 'text/v1', text: '   ' }), null, '全空白等于没写');
  // 单选没选任何项 ⇒ null。
  assert.equal(formatAnswer(choice, { format: 'choice/v1', selected: [] }), null);
});

test('🔴 形态 A：排序 / 连线 / 归类的原答案 —— 条目型过去一律显示「未作答」', () => {
  // 🔴 起因：`formatAnswer` 的 kind 分派只认 `text` / `fill` 两族，而 `draftFromValue`
  //    明明把 `order` / `match` / `categorize` 三支都读了回来 ⇒ 那三种落进最后那个 `''`
  //    ⇒ `null` ⇒ 抽屉把**答过**的学生显示成「未作答」。
  //    ⇒ 与 M4b 那条同一个形状的缺陷：**学生写的东西在教师眼里不存在**。
  // 排版的依据**不是** `answer` 里键的顺序（那是学生的点击顺序，逐人不同、看着像随机），
  // 而是**题目条目的顺序** —— 与学生屏幕上那一栏 / 那一列长得一样，教师横着比也稳。
  const orderNode = node({
    id: 'q_6', type: 'order',
    data: { items: [{ id: 'i1', text: '苹果' }, { id: 'i2', text: '香蕉' }, { id: 'i3', text: '梨' }] },
  });
  assert.equal(
    formatAnswer(orderNode, { format: 'order/v1', order: ['i1', 'i2', 'i3'] }),
    '苹果 → 香蕉 → 梨',
  );
  // 学生排成另一个顺序 ⇒ 显示的就是**他排的那个**（不是题目的顺序）
  assert.equal(
    formatAnswer(orderNode, { format: 'order/v1', order: ['i3', 'i1', 'i2'] }),
    '梨 → 苹果 → 香蕉',
  );

  const matchNode = node({
    id: 'q_7', type: 'match',
    data: {
      left: [{ id: 'l1', text: '苹果' }, { id: 'l2', text: '香蕉' }],
      right: [{ id: 'r1', text: '红色' }, { id: 'r2', text: '黄色' }],
    },
  });
  // ⚠️ 传进去的 `links` **故意不是左栏顺序**：显示要按左栏重排。
  assert.equal(
    formatAnswer(matchNode, {
      format: 'match/v1',
      links: [{ leftId: 'l2', rightId: 'r2' }, { leftId: 'l1', rightId: 'r1' }],
    }),
    '苹果 — 红色；香蕉 — 黄色',
  );

  const categorizeNode = node({
    id: 'q_8', type: 'categorize',
    data: {
      items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '狗' }, { id: 'i3', text: '鹰' }],
      zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
    },
  });
  assert.equal(
    formatAnswer(categorizeNode, { format: 'categorize/v1', assignment: { i3: 'z2', i1: 'z1', i2: 'z1' } }),
    '哺乳类：猫、狗；鸟类：鹰',
    '按**框**归组（不是逐条列「猫→哺乳类」），框的顺序是题目的，不是值的',
  );
  // 🔴 一个框里**一个条目都没有** ⇒ 那个框不出现（不是「鸟类：（空）」）；
  //    而**没被归类的条目必须说出来** —— 少了它，教师会以为学生把 3 条都归完了。
  assert.equal(
    formatAnswer(categorizeNode, { format: 'categorize/v1', assignment: { i1: 'z1', i2: 'z1' } }),
    '哺乳类：猫、狗；未归类：鹰',
  );

  // 边界：三种「一条都没有」⇒ null（= 未作答），不是空串。
  assert.equal(formatAnswer(orderNode, { format: 'order/v1', order: [] }), null);
  assert.equal(formatAnswer(matchNode, { format: 'match/v1', links: [] }), null);
  assert.equal(formatAnswer(categorizeNode, { format: 'categorize/v1', assignment: {} }), null);
  // 读不出来的形状不抛（渲染路径上一次 TypeError 会让整个抽屉白屏）
  assert.equal(formatAnswer(orderNode, null), null);
  assert.equal(formatAnswer(matchNode, 'x'), null);
});

test('🔴 形态 A：多选给「键. 文字」，判断只给那个字（**不印 T / F**）', () => {
  // 与上游那条同一个缺陷：`node.type === 'single-choice'` 是唯一的选项型分支，
  // 多选与判断落到最后那条只认 `text` / `fill` 的三元链 ⇒ `null` ⇒ 「未作答」。
  const multi = node({
    id: 'q_9', type: 'multi-choice',
    data: {
      options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }, { key: 'C', text: '土壤' }],
      correctKeys: ['A', 'B'],
    },
  });
  // ⚠️ 故意给一个**乱序**的 selection：显示按**选项表**的顺序走（与排序/连线/归类同一条：
  // 学生的点击顺序逐人不同，教师横着比会以为每个人选得都不一样）。
  assert.equal(formatAnswer(multi, { format: 'choice/v1', selected: ['C', 'A'] }), 'A. 水；C. 土壤');
  // 选中的 key 不在选项表里（题被改过 / 上个版本的值）⇒ 退回 key 本身，与单选同一条纪律
  assert.equal(formatAnswer(multi, { format: 'choice/v1', selected: ['A', 'Z'] }), 'A. 水；Z');
  assert.equal(formatAnswer(multi, { format: 'choice/v1', selected: [] }), null, '一个都没选 ⇒ 未作答');

  // 🔴 判断题**不存 `options`**（规格 §12：`data` 里只有 `correctKeys`）⇒ 这里要走
  //    `TRUE_FALSE_OPTIONS` 那一份常量。用 `readOptions(node)` 会读回空表，于是每个学生
  //    都「退回 key 本身」，抽屉里印出 `T` / `F` 两个字母 —— 对教师没有意义。
  const tf = node({ id: 'q_10', type: 'true-false', data: { correctKeys: ['T'] } });
  assert.equal(formatAnswer(tf, { format: 'choice/v1', selected: ['T'] }), '对');
  assert.equal(formatAnswer(tf, { format: 'choice/v1', selected: ['F'] }), '错');
  assert.equal(formatAnswer(tf, { format: 'choice/v1', selected: [] }), null, '没选 ⇒ 未作答');
  // 读不出来的形状不抛（渲染路径上一次 TypeError 会让整个抽屉白屏）
  assert.equal(formatAnswer(tf, null), null);
  assert.equal(formatAnswer(multi, null), null);
});

test('🔴 每个题型在抽屉里都「有话说」—— 没有哪个题型会静默地回 null', () => {
  // 这条网的由来：排序 / 连线 / 归类 / 多选 / 判断**五个**题型同时缺分支，而它们的表现
  // 一模一样 —— **静默回 `null`**，屏幕上就是「未作答」。没有任何东西会红，
  // 所以这五个是一起被发现的，不是一个个报出来的。
  // ⇒ 判据挂在新题型**清单**（`QUESTION_TYPE_OPTIONS`）上：将来加第 10 个题型，
  //    忘了给 `formatAnswer` 补分支时**这一条会红**，而不是等教师上课时发现。
  const samples: Record<string, { node: WorksheetQuestionNode; value: unknown }> = {
    'single-choice': {
      node: node({ id: 's1', type: 'single-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } }),
      value: { format: 'choice/v1', selected: ['A'] },
    },
    'true-false': {
      node: node({ id: 's2', type: 'true-false', data: { correctKeys: ['T'] } }),
      value: { format: 'choice/v1', selected: ['T'] },
    },
    'multi-choice': {
      node: node({ id: 's3', type: 'multi-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } }),
      value: { format: 'choice/v1', selected: ['A'] },
    },
    'fill-blank': {
      node: node({ id: 's4', type: 'fill-blank', data: { answers: ['H2O'] } }),
      value: { format: 'fill/v1', text: 'H2O' },
    },
    'short-answer': {
      node: node({ id: 's5', type: 'short-answer' }),
      value: { format: 'text/v1', text: '光合作用' },
    },
    order: {
      node: node({ id: 's6', type: 'order', data: { items: [{ id: 'i1', text: '苹果' }] } }),
      value: { format: 'order/v1', order: ['i1'] },
    },
    match: {
      node: node({ id: 's7', type: 'match', data: { left: [{ id: 'l1', text: '苹果' }], right: [{ id: 'r1', text: '红色' }] } }),
      value: { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }] },
    },
    categorize: {
      node: node({ id: 's8', type: 'categorize', data: { items: [{ id: 'i1', text: '猫' }], zones: [{ id: 'z1', label: '哺乳类' }] } }),
      value: { format: 'categorize/v1', assignment: { i1: 'z1' } },
    },
    // ⚠️ 画布题**故意**让 `answerText` 是 `null`（笔迹不是文字）⇒ 它的「话」在 `ink` 上，
    //    由 `InkPreview` 画出来。下面那条断言两个都认，正是为了它。
    // ★ 2026-09-26：选择填空的样本 —— 它与填空题**同形**（`texts` 每空一格），
    // 所以抽屉里「学生答了什么」的画法与填空一致。
    'choice-blank': {
      node: node({ id: 's10', type: 'choice-blank' }),
      value: { format: 'fill-multi/v1', texts: ['阳光', '水分'] },
    },
    drawing: {
      node: node({ id: 's9', type: 'drawing', inputMode: 'handwriting' }),
      value: {
        format: 'drawing/v1',
        canvas: { w: 320, h: 240 },
        strokes: [{ color: '#1f2937', width: 0.016, points: [[0.5, 0.5]] as [number, number][] }],
      },
    },
  };

  for (const option of QUESTION_TYPE_OPTIONS) {
    const sample = samples[option.value];
    assert.ok(sample, `题型 \`${option.value}\` 没有样本 —— 新增题型时必须在这里补一行`);
    const outcome = questionOutcome(sample.node, row({ status: 'submitted', value: sample.value }));
    assert.ok(
      outcome.answerText !== null || outcome.ink !== null,
      `题型 \`${option.value}\` 在抽屉里既没有文字、也没有画 ⇒ 教师看到的是「未作答」`,
    );
  }
  // 样本表不许比清单**多**（删掉一个题型之后留下的孤儿样本会掩盖它已经不存在）
  assert.equal(Object.keys(samples).length, QUESTION_TYPE_OPTIONS.length);
});

test('🔴 形态 M4b：笔迹作答 —— answerText 回 null，但 ink 非空（抽屉不许说「未作答」）', () => {
  // ⚠️ 两个助手是既有的：`node({id, type, …})`（单对象）与 `row({status, value, …})`，
  //    **不是** `node('drawing')` 那种形状 —— 照该文件既有的调用写。
  const drawing = node({ id: 'q_9', type: 'drawing', inputMode: 'handwriting' });
  const value = {
    format: 'drawing/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ color: '#1f2937', width: 0.016, points: [[0.5, 0.5]] as [number, number][] }],
  };
  const outcome = questionOutcome(drawing, row({ questionId: 'q_9', status: 'submitted', value }));
  assert.equal(outcome.answerText, null, '笔迹不是文字');
  assert.equal(outcome.ink?.strokes.length, 1, '★ 但笔迹必须在（否则抽屉把画了画的学生显示成未作答）');
  assert.equal(outcome.mark, 'none', '★ 不判分 ⇒ none，**不是 wrong**（裁定 3：none 不得画成答错）');
  // 未作答的行不许画出空画布。
  // 🔴 传的必须是**同一份 ink 值**（终审 I3）：传 `value: null` 的话 `readInkValue(null)`
  //    本来就是 `null`，把 `questionOutcome` 里那句 `status === 'unanswered' ?` 整段删掉
  //    这条断言**照样绿**（实测 22/22 —— 一条测不到它所声称守卫的假绿）。
  assert.equal(
    questionOutcome(drawing, row({ questionId: 'q_9', status: 'unanswered', value })).ink,
    null,
  );
  // 教师把题型改回键盘之后，学生之前交的那幅画仍然显示得出来（只认 format，不看题型）
  const backToKeyboard = node({ id: 'q_9', type: 'short-answer' });
  assert.equal(questionOutcome(backToKeyboard, row({ questionId: 'q_9', status: 'submitted', value })).ink?.strokes.length, 1);
});

test('🔴 形态 M4b：教师把**已被键盘作答**的题改成「手写」⇒ 学生写过的字照样显示（不许说未作答）', () => {
  // 🔴 这是终审 ①（Critical）的**症状**：改那道题的「作答方式」**不动库里那一行** ——
  //    值仍是 `text/v1`，而题目此刻是手写 ⇒ `draftFromValue` 曾经有一句
  //    `if (isInkNode(node)) return empty;`（R2）**先于** kind 分派生效 ⇒ 回空 ink 态 ⇒
  //    `formatAnswer` 的三元链只认 `text` / `fill` ⇒ `null` ⇒ **抽屉把那个学生显示成
  //    「未作答」**。那一句守卫已按 R18 撤掉。
  // 🔴 反证：把 `if (isInkNode(node)) return empty;` 加回 `src/lib/worksheet-answer-value.ts`
  //    的 `draftFromValue` ⇒ 本条变红（`answerText` 变回 `null`）。
  const stillKeyboardValue = { format: 'text/v1', text: '光合作用' };
  const typedThenHandwriting = node({ id: 'q_8', type: 'short-answer', inputMode: 'handwriting' });
  const outcome = questionOutcome(
    typedThenHandwriting,
    row({ questionId: 'q_8', status: 'submitted', value: stillKeyboardValue }),
  );
  assert.equal(outcome.status, 'submitted', '值仍是那份提交过的作答 —— 学生自己没有任何变化');
  assert.equal(outcome.answerText, '光合作用', '★ 文字值 + 手写节点 ⇒ 原答案必须读得出来');
  assert.equal(outcome.ink, null, '它不是笔迹 ⇒ 抽屉不该画空画布');
  // 对照组（**同一个节点、只是值换成笔迹**）：`answerText` 回 null 而 `ink` 有东西 ——
  // 两件事各读各的，谁也不顶替谁。
  const inkValue = {
    format: 'ink/v1',
    canvas: { w: 320, h: 160 },
    strokes: [{ color: '#1f2937', width: 0.016, points: [[0.5, 0.5]] as [number, number][] }],
  };
  const inkOutcome = questionOutcome(
    typedThenHandwriting,
    row({ questionId: 'q_8', status: 'submitted', value: inkValue }),
  );
  assert.equal(inkOutcome.answerText, null);
  assert.equal(inkOutcome.ink?.strokes.length, 1);
});

test('状态标签：三态各一个词，与看板方格阵同一组', () => {
  assert.equal(statusLabel('unanswered'), '未作答');
  assert.equal(statusLabel('draft'), '作答中');
  assert.equal(statusLabel('submitted'), '已提交');
});

// ---------------------------------------------------------------------------
// 「画成什么样」：四档判分结论在界面上必须两两可区分（E2）
//
// 🔴 这一节存在的理由：E2 之前 `'partial'` 落到「没有对错」那一支，画出的是「◐ 已提交」
// —— 一句话是真的（它确实交了），但它与「系统没判分」**完全不可区分**，而 §12 的要求
// 是「部分给分必须画得出来」。这一段判据原本写在 `worksheet-drawer.tsx` 的 JSX 里，
// 那里**没有任何回归网**（本仓没有前端测试框架，`node --test` 加载不了 JSX）——
// 把它改成与 `'wrong'` 一模一样不会有任何东西变红。所以搬到这里来。
// ---------------------------------------------------------------------------

/**
 * 一道题**最终画出来**的那一小块 —— 把「判据」（`questionOutcome`）与「长相」
 * （`outcomeMarkView`）两段接起来。JSX 里就是这个顺序，一行都不多。
 */
function viewOf(question: WorksheetQuestionNode, answerRow?: WorksheetBoardAnswerRow | undefined) {
  const outcome = questionOutcome(question, answerRow);
  return outcomeMarkView(outcome.mark, outcome.status);
}

/** 一个长相「像不像」另一个 —— 拿教师真能看见的那三样（图标 / 词 / 颜色）比。 */
function look(view: { icon: string; label: string; color: string }): string {
  return `${view.icon}|${view.label}|${view.color}`;
}

test('🔴 四档判分结论在界面上两两可区分 —— 部分给分既不长得像答错，也不长得像没判分', () => {
  const correct = outcomeMarkView('correct', 'submitted');
  const partial = outcomeMarkView('partial', 'submitted');
  const wrong = outcomeMarkView('wrong', 'submitted');
  // 没有判分结论的那一档取「已提交」来比 —— 它是最容易被误认成部分给分的那一个
  //（E2 之前部分给分画的就是它）。
  const none = outcomeMarkView('none', 'submitted');

  const looks = [correct, partial, wrong, none].map(look);
  assert.equal(new Set(looks).size, 4, `四档里有两档长得一模一样：${looks.join(' / ')}`);

  // 逐对点名 —— 上面那一条只说得清「有重复」，说不出是哪一对。
  assert.notEqual(
    look(partial), look(wrong),
    '部分给分画成答错 —— 「算进分母却不算对」（规格 §12）就变成了一句假话',
  );
  assert.notEqual(
    look(partial), look(none),
    '部分给分画成「没判分」—— 这正是 E2 之前的样子，教师看不出这道题被扣了分',
  );
  assert.notEqual(
    look(partial), look(correct),
    '部分给分画成答对 —— 正确率的分子里没有它，那是另一句假话',
  );
  assert.notEqual(look(wrong), look(none), '「答错」与「没判分」是两件事：一个系统知道，一个系统不知道');

  // 三档判分结论同字号同字重（并排扫视时才是一组），差别只在符号、词与颜色。
  // ⚠️ 这条改坏了的表现是「部分给分比答对矮半头」—— 教师会把它读成次要信息，而不是一个扣分结论。
  assert.deepEqual(
    [correct, partial, wrong].map((view) => view.emphasis), ['verdict', 'verdict', 'verdict'],
    '三档判分结论必须是同一个强调档',
  );
  assert.equal(partial.icon, 'partial', '部分给分的图标');
  assert.equal(partial.label, '部分给分');
});

test('🔴 部分给分、作答中、无结论已提交使用不同的语义图标', () => {
  const partial = outcomeMarkView('partial', 'submitted');
  assert.equal(partial.icon, 'partial');
  assert.equal(outcomeMarkView('none', 'draft').icon, 'drafting');
  assert.equal(outcomeMarkView('none', 'submitted').icon, 'submitted');
});

test('🔴 没有判分结论的那一档既不像「答错」也不像「部分给分」（未作答 / 作答中 / 已提交 三种状态）', () => {
  const verdictIcons = ['correct', 'partial', 'retry'];
  for (const status of ['unanswered', 'draft', 'submitted'] as const) {
    const view = outcomeMarkView('none', status);
    assert.ok(
      !verdictIcons.includes(view.icon),
      `状态「${status}」在系统根本没判分时画出了判分图标「${view.icon}」—— ` +
      '把「不知道」说成「对 / 部分给分 / 错」是本任务最要防的一类假象',
    );
    assert.ok(
      ['未作答', '作答中', '已提交'].includes(view.label),
      `状态「${status}」的词必须是状态词，不是判分词：${view.label}`,
    );
  }
  // 三态各有各的词（别把三种状态压成一句）。
  const labels = (['unanswered', 'draft', 'submitted'] as const).map((status) => outcomeMarkView('none', status).label);
  assert.equal(new Set(labels).size, 3);
});

test('🔴 端到端（纯函数这一段）：各判分与进度状态映射到统一图标', () => {
  const partialView = viewOf(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false }));
  assert.equal(partialView.icon, 'partial');
  assert.equal(partialView.label, '部分给分');

  assert.equal(viewOf(choice, row({ status: 'submitted', gradeState: 'correct', isCorrect: true })).icon, 'correct');
  assert.equal(viewOf(choice, row({ status: 'submitted', gradeState: 'incorrect', isCorrect: false })).icon, 'retry');

  // 主观题**永远没有对错** ⇒ 哪怕库里那一行写着 `partial` 也不画 ½
  //（`short-answer` 在注册表里是 `graded: false`，它走的是「没有对错」那一支）。
  assert.equal(
    viewOf(short, row({ questionId: 'q_3', status: 'submitted', gradeState: 'partial' })).icon, 'submitted',
  );
  assert.equal(viewOf(choice, undefined).icon, 'unanswered');
});

// ---------------------------------------------------------------------------
// 形态 B · 按题聚合
// ---------------------------------------------------------------------------

test('🔴 形态 B：正确率是「全对才算对」—— 10 行 4 全对 / 3 部分给分 / 3 错 = **40%**，不是 70%', () => {
  const rows: Array<WorksheetBoardAnswerRow | undefined> = [];
  const submit = (gradeState: 'correct' | 'partial' | 'incorrect'): void => {
    // 部分给分那一行的 `isCorrect` 按规格 §12 只能是 false（那个布尔的语义已收窄为「全对」）——
    // 所以这一组数据里，**光看 isCorrect 根本分不出部分给分与答错**，这正是本用例的意义。
    rows.push(row({ status: 'submitted', gradeState, isCorrect: gradeState === 'correct' }));
  };
  for (let i = 0; i < 4; i += 1) submit('correct');
  for (let i = 0; i < 3; i += 1) submit('partial');
  for (let i = 0; i < 3; i += 1) submit('incorrect');

  const aggregate = questionAggregate(rows);
  assert.equal(aggregate.graded, 10, '部分给分**进分母**（分母是「已判过的行」，三档都算判过）');
  assert.equal(aggregate.correct, 4, '部分给分**不进分子**');
  assert.equal(
    aggregate.accuracy, 40,
    '把分子写成「非 incorrect 即算对」会得到 70%（7/10）—— 部分给分被算成了对，教师看到的正确率凭空变高',
  );

  // 🔴 反面对照：同一组数据把 3 行部分给分**改判**成答错，正确率必须**一模一样**（40%）。
  // 这是「部分给分既不算对、也不算得比错更差」那句话的实测形状 —— 顺带证明上面那个 40
  // 不是碰巧（它只由 4 与分母 10 决定）。
  const allOrNothing = rows.map((item) => (
    item && item.gradeState === 'partial'
      ? row({ status: 'submitted', gradeState: 'incorrect', isCorrect: false })
      : item
  ));
  assert.equal(questionAggregate(allOrNothing).accuracy, 40);
});

test('★ 形态 B：全是部分给分 ⇒ 正确率 **0**（进了分母、一个也没进分子），不是「—」', () => {
  const allPartial = questionAggregate([
    row({ status: 'submitted', gradeState: 'partial', isCorrect: false }),
    row({ status: 'submitted', gradeState: 'partial', isCorrect: false }),
  ]);
  assert.equal(allPartial.graded, 2, '部分给分不是「没判过」—— 它进分母');
  assert.equal(
    allPartial.accuracy, 0,
    '0% 与 null 是两句不同的话：这句是「一道全对的都没有」（是真的），null 才是「没有已判过的行」',
  );

  // 阴性对照：一行都没判过时仍然是 null（界面显示「—」），别把上面那个 0 说成通用结论。
  assert.equal(questionAggregate([row({ status: 'submitted', gradeState: null, isCorrect: null })]).accuracy, null);
});

test('形态 B：「已交 N/M」的分母是**参与者数**，正确率的分母是**已判过的行数**', () => {
  const aggregate = questionAggregate([
    row({ status: 'submitted', isCorrect: true }),
    row({ status: 'submitted', isCorrect: false }),
    row({ status: 'draft' }),
    undefined,                                   // 一次都没动过的人
  ]);
  assert.equal(aggregate.total, 4, '分母是「该答这道题的人」，含没作答的那一个');
  assert.equal(aggregate.submitted, 2);
  assert.equal(aggregate.graded, 2, '作答中那一行不参与正确率');
  assert.equal(aggregate.accuracy, 50);

  // 🔴 反例对照：拿 submitted 当分母会得到同一个数（2/4 里 1 对 = 50%）——
  //    所以下面这条**必须**换一组数据才看得出差别。
  const halfGraded = questionAggregate([
    row({ status: 'submitted', isCorrect: true }),
    row({ status: 'submitted', isCorrect: null }),   // 关闭自动判分 / 主观题
    undefined,
  ]);
  assert.equal(halfGraded.submitted, 2);
  assert.equal(halfGraded.graded, 1);
  assert.equal(
    halfGraded.accuracy, 100,
    '分母是 1（只有一行判过）⇒ 100%，不是 1/2=50% —— 拿已交人数当分母会凭空造出「一半答错」',
  );
});

test('形态 B：没有一行判过对错 ⇒ 正确率是 null（界面显示「—」），不是 0%', () => {
  const subjective = questionAggregate([
    row({ questionId: 'q_3', status: 'submitted', isCorrect: null }),
    row({ questionId: 'q_3', status: 'submitted', isCorrect: null }),
  ]);
  assert.equal(subjective.accuracy, null, '主观题没有正确率 —— 0% 是一句假话');
  assert.equal(subjective.submitted, 2, '但它照样有「已交 2/2」');

  const nobody = questionAggregate([undefined, undefined]);
  assert.equal(nobody.accuracy, null, '一个人都没交时也不能是 0%（那是「都答错了」的意思）');
  assert.equal(nobody.submitted, 0);
  assert.equal(nobody.total, 2);
});

test('形态 B：量词跟着模式走 —— 全是组就说「个组」，否则说「人」', () => {
  assert.equal(participantUnitLabel(['group', 'group']), '个组');
  assert.equal(participantUnitLabel(['student', 'student']), '人');
  // 混着的时候按「人」说：一间课堂里两种参与者同时存在不是第一批的形态，
  // 真出现时含糊一点比谎称「都是组」安全。
  assert.equal(participantUnitLabel(['group', 'student']), '人');
  assert.equal(participantUnitLabel([]), '人', '空数组不能说「0 个组」——那是编的');
  assert.equal(participantColumnTitle(['group']), '各组作答', '规格 §7.3：标题写「作答」不写「答案」');
  assert.equal(participantColumnTitle(['student']), '各人作答');
});

// ---------------------------------------------------------------------------
// 题号与题目索引
// ---------------------------------------------------------------------------

test('题号一律由题目树算，**绝不**拿 answerRows 的下标当题号', () => {
  const nodes = [choice, fill, { ...short, children: [node({ id: 'q_4', type: 'fill-blank', prompt: '嵌套题' })] }];
  const { questions, headingOf } = indexQuestions(nodes);
  assert.deepEqual(questions.map((q) => q.id), ['q_1', 'q_2', 'q_3', 'q_4'], '嵌套的题也要在（服务端算「整卷交齐」时数它）');
  assert.equal(questionHeading(choice, headingOf('q_1')), '1. 单选题');
  assert.equal(questionHeading(questions[3], headingOf('q_4')), '4. 填空题');
  // 题已被教师删掉 / 改过 id ⇒ 查不到题号，**不编一个**，只给题型。
  assert.equal(headingOf('已经不在的题'), null);
  assert.equal(questionHeading(choice, null), '单选题');
});

test('🔴 任务不是一道题：它不进题目清单、也不占题号（抽屉里不会多一行）', () => {
  const inTask = node({ id: 't1', type: 'task', prompt: '任务一', children: [choice, fill] });
  const { questions, headingOf, items } = indexQuestions([inTask, short]);
  assert.deepEqual(questions.map((q) => q.id), ['q_1', 'q_2', 'q_3'], '任务自己不许出现在抽屉的题目清单里');
  assert.deepEqual(items.map((item) => item.heading), ['任务一 · 1', '任务一 · 2', '3']);
  assert.equal(questionHeading(choice, headingOf('q_1')), '任务一 · 1. 单选题');
  assert.equal(headingOf('t1'), null, '任务没有题号 —— 它不是一道题');
});

test('🔴 嵌套的子题：题号按任务内重排算，不再整体后移', () => {
  const nodes = [node({ id: 't1', type: 'task', prompt: '任务一', children: [
    choice,
    { ...short, children: [node({ id: 'q_4', type: 'fill-blank', prompt: '嵌套题' })] },
  ] })];
  const { headingOf } = indexQuestions(nodes);
  assert.equal(headingOf('q_1'), '任务一 · 1');
  assert.equal(headingOf('q_4'), '任务一 · 3');
});

// ---------------------------------------------------------------------------
// 题型 × 判分：`GRADED_QUESTION_TYPES` 是派生的 —— 但**派生出来的结论**要单独钉住
// ---------------------------------------------------------------------------

/**
 * 一份**独立写出来**的期望值：哪些题型有对错。
 *
 * 🔴 为什么还要抄这一份「第二处」：`GRADED_QUESTION_TYPES` 现在是从
 * `QUESTION_TYPE_OPTIONS` 的 `graded` 那一格**派生**的，所以「派生得对不对」不再是
 * 一个可以断言的问题（它恒等于自己）。真正要挡的是**那一格填错了** ——
 * 比如顺手把 `multi-choice` 写成 `graded: false`。
 * 派生消掉的是「漏改」，消不掉「改错」；这一份就是后者。
 *
 * `Record<QuestionType, boolean>` ⇒ 题型清单加一个成员而这里没补，`tsc` 直接红。
 */
const EXPECTED_GRADED: Record<QuestionType, boolean> = {
  'single-choice': true,
  'true-false': true,
  'multi-choice': true,
  'fill-blank': true,
  order: true,
  match: true,
  categorize: true,
  // ★ 2026-09-26：选择填空**判分**（与填空题共用判分器）。
  'choice-blank': true,
  'short-answer': false,
  // ★ M4b：`drawing: false` **是有意的决定，不是补测试** —— 手写 / 绘图不参与自动判分
  // （规格 §12 裁定 3）。这一格决定了看板抽屉里画不画 ✓/½/✗。
  // ⊘ 2026-09-24（E1）：这一句原写作「服务端 `JUDGES` 里没有它」—— **B1 之后它不成立了**：
  //   服务端 `JUDGES.drawing` 有它，处置是**恒回 `() => null`**（与 `'short-answer': () => null`
  //   逐字同一个处置，见 `server/src/services/worksheet-questions.ts` 的 `JUDGES` 表），
  //   而 `judge()` 里还**多**一条闸：见到 ink 值（`ink/v1` / `drawing/v1`）就短路回 `null`。
  //   两条是**独立**的闸，各管一半：一条管「题型就是绘图题」（值被手改成别的形状时也挡得住），
  //   一条管「值是 ink」（教师把作答方式改回键盘之后仍然挡得住 —— 那时题型不再是 `drawing`）。
  //   ⇒ 「`JUDGES` 里没有它」这句话今天读起来像「服务端没为绘图题做任何事」，而真相是
  //   服务端做了两件事、只是**都不判分**。留着它是一个给下一个人抄的模板。
  drawing: false,
};

test('🔴 每个题型的 graded 标记都要与「它判不判分」的决策一致', () => {
  for (const option of QUESTION_TYPE_OPTIONS) {
    assert.equal(
      option.graded,
      EXPECTED_GRADED[option.value],
      `题型「${option.value}」的 graded 标记不对 —— 看板会不会画 ✓/½/✗ 由它决定`,
    );
    assert.equal(isGradedType(option.value), option.graded, 'isGradedType 必须与那一格同源');
  }

  // 派生关系本身：`GRADED_QUESTION_TYPES` 必须就是我们期望的那些题型。
  // 这条同时防止它某天被改回「并列的第二份白名单」。
  assert.deepEqual(
    [...GRADED_QUESTION_TYPES].sort(),
    QUESTION_TYPE_OPTIONS.filter((option) => EXPECTED_GRADED[option.value]).map((option) => option.value).sort(),
  );
});

// ⚠️ 这条的**名字**于 2026-09-24 改过（原为「分母与**格子**必须同进同出…也要在**格子上**画标记」）。
// 改名的理由与 §12 那句字面更正是同一件事：标记画在**抽屉里**、不在方格阵上（规格 §7.2）。
// 留着旧名字是一个**给下一个人抄的模板** —— F1 的验收项正要从这类句子写起，
// 而「部分给分在格子上画得出来」恰恰是 E2 核清掉的那个 §7.2 违规。
// 代价如实记：E1 报告里引用的那条名册（「分母与格子同进同出」）与本文件不再逐字相同。
test('🔴 分母与抽屉里的标记必须同进同出：能判分的题型既要进正确率的分母，也要在抽屉里画标记', () => {
  const rows: Array<WorksheetBoardAnswerRow | undefined> = [
    row({ questionId: 'q_x', status: 'submitted', isCorrect: false }),
    row({ questionId: 'q_x', status: 'submitted', isCorrect: true }),
  ];

  for (const option of QUESTION_TYPE_OPTIONS) {
    const outcome = questionOutcome(node({ id: 'q_x', type: option.value }), rows[0]);

    if (!EXPECTED_GRADED[option.value]) {
      assert.equal(outcome.mark, 'none', `题型「${option.value}」不判分，抽屉里就不该有标记`);
      continue;
    }

    // 这正是那份并列白名单漏改时的症状：服务端判了分、`isCorrect` 非空
    // ⇒ 下面这个分母把它算进去，而抽屉里什么都不画 —— 全程无报错。
    assert.equal(questionAggregate(rows).graded, 2, '分母读的是判分结论非空，与题型无关');
    assert.notEqual(
      outcome.mark,
      'none',
      `题型「${option.value}」已经被判了分（进了分母），抽屉里却不画标记 —— ` +
      '这就是「新题型算进正确率、抽屉里没有 ✓」那个静默不一致',
    );

    // ★ M4a：部分给分那一档**也**要同进同出，而且比另外两档更要紧 ——
    // 它是唯一「算进分母却不算对」的行（规格 §12），抽屉里少了它就只能看起来像答错。
    const partialRow = row({ questionId: 'q_x', status: 'submitted', gradeState: 'partial', isCorrect: false });
    assert.equal(questionAggregate([partialRow, partialRow]).graded, 2, '部分给分也进分母');
    assert.equal(
      questionOutcome(node({ id: 'q_x', type: option.value }), partialRow).mark,
      'partial',
      `题型「${option.value}」被判成部分给分，抽屉里却没画出部分给分档 —— ` +
      '它会看起来像答错（或像没判分），两句话都是假的',
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   ★ 2026-09-28：形态 A 的「该生全貌」与「答题过程」
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 全貌那一行的**六档必须互斥、且加起来正好是题数**。
 *
 * 🔴 为什么它值得一条用例：这一行是教师**一眼看过去**的结论，而它错了不报错 ——
 * 少了哪一档、或者两档数了同一道题，屏幕上只是「数字有点怪」，没有人会去核对。
 * 六档之和 ≠ 总题数，就是「有一道题被数了两次或被漏掉了」的**唯一**可观测信号。
 */
test('★ 总览：六档互斥且恰好覆盖每一道题（和必须等于题数）', () => {
  const nodes = [
    node({ id: 'q1', type: 'single-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } }),
    node({ id: 'q2', type: 'single-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } }),
    node({ id: 'q3', type: 'single-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } }),
    node({ id: 'q4', type: 'short-answer' }),
    node({ id: 'q5', type: 'fill-blank', data: { answers: ['H2O'] } }),
  ];
  const rows = [
    row({ questionId: 'q1', status: 'submitted', gradeState: 'correct', score: 2 }),
    row({ questionId: 'q2', status: 'submitted', gradeState: 'partial', score: 1 }),
    row({ questionId: 'q3', status: 'submitted', gradeState: 'incorrect', score: 0 }),
    row({ questionId: 'q4', status: 'submitted', gradeState: null, score: null }),
    row({ questionId: 'q5', status: 'draft' }),
    // q6 不存在；q5 之后没有第 6 题 ⇒ 未作答那一档是 0
  ];
  const view = participantOverview(nodes, rows, { style: 'star' });
  assert.deepEqual(
    {
      correct: view.correct, partial: view.partial, wrong: view.wrong,
      noVerdict: view.noVerdict, draft: view.draft, unanswered: view.unanswered,
    },
    { correct: 1, partial: 1, wrong: 1, noVerdict: 1, draft: 1, unanswered: 0 },
  );
  assert.equal(
    view.correct + view.partial + view.wrong + view.noVerdict + view.draft + view.unanswered,
    nodes.length,
    '🔴 六档之和必须正好是题数 —— 不等就是有题被数了两次或漏掉了',
  );

  // 🔴 主观题（q4）：**不进 ✓ 也不进 ✗**，它自己一档。
  // 把它算进 correct 是「把不知道说成对」，算进 wrong 是「把不知道说成错」。
  assert.equal(view.noVerdict, 1, '主观题落在「没有对错」那一档');
});

test('★ 总览：未作答的题进 unanswered（不是 draft）', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' }), node({ id: 'q2', type: 'single-choice' })];
  const view = participantOverview(nodes, [row({ questionId: 'q1', status: 'draft' })], { style: 'star' });
  assert.equal(view.unanswered, 1, 'q2 一行都没有 ⇒ 未作答');
  assert.equal(view.draft, 1);
});

test('★ 总览：认不出的 gradeState 落「没有对错」那一档（不猜）', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice', data: { options: [{ key: 'A', text: '水' }], correctKeys: ['A'] } })];
  const view = participantOverview(nodes, [row({ questionId: 'q1', status: 'submitted', gradeState: 'future' as never })], { style: 'star' });
  assert.equal(view.noVerdict, 1, '🔴 认不出的档**不许**猜成对或错');
  assert.equal(view.correct + view.wrong, 0);
});

test('★ 总览：奖励 = 各题得分之和；没判分的题记 0（不是记成「答错」）', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' }), node({ id: 'q2', type: 'single-choice' }), node({ id: 'q3', type: 'single-choice' })];
  const view = participantOverview(nodes, [
    row({ questionId: 'q1', status: 'submitted', gradeState: 'correct', score: 3 }),
    row({ questionId: 'q2', status: 'submitted', gradeState: 'partial', score: 1 }),
    row({ questionId: 'q3', status: 'submitted', gradeState: null, score: null }),
  ], { style: 'star' });
  assert.equal(view.reward, 4, '3 + 1 + 0（没判分记 0）');
  assert.equal(view.rewardKnown, true);
  // ⚠️ star 档的符号是 `★`（`REWARD_STYLE_OPTIONS` 里的 `symbol`），不是 emoji 的 ⭐ ——
  // 这条断言第一版就是在这里红的（我按印象写成了 ⭐，而代码是对的）。
  assert.equal(view.rewardText, '★×4', '符号档画成 ★×N 而不是 +N 分');

  // 阳性对照：**分数档**画的是另一种形状。少了它，「永远画 ★×N」那种实现也能让上面那条绿。
  const points = participantOverview(nodes, [
    row({ questionId: 'q1', status: 'submitted', gradeState: 'correct', score: 3 }),
    row({ questionId: 'q2', status: 'submitted', gradeState: 'partial', score: 1 }),
    row({ questionId: 'q3', status: 'submitted', gradeState: null, score: null }),
  ], { style: 'points' });
  assert.equal(points.reward, 4);
  assert.equal(points.rewardText, '+4 分', '分数档画成 +N 分');
});

test('★ 总览：奖励为 0 时**照样给文字**（「答了 4 题拿 0 个」与「还没答」是两件事）', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' })];
  const view = participantOverview(nodes, [], { style: 'star' });
  assert.equal(view.reward, 0);
  assert.equal(view.rewardKnown, true);
  assert.equal(view.rewardText, '★×0', '0 也要画出来，不是留空');
  // 分数档同理（`rewardTotalText` 对 0 回 `null`，所以那一支要自己兜 —— 漏了的话
  // 分数档的「0」会整个不显示，而星档照常显示，两种样式在同一个位置长得不一样）。
  assert.equal(
    participantOverview(nodes, [], { style: 'points' }).rewardText,
    '+0 分',
    '分数档的 0 也要画出来',
  );
});

test('🔴 总览：settings 还没加载到（scale 为 null）⇒ rewardKnown=false，界面画「—」而不是 0', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' })];
  const view = participantOverview(nodes, [row({ questionId: 'q1', status: 'submitted', gradeState: 'correct', score: 2 })], null);
  assert.equal(view.rewardKnown, false, '🔴 不知道样式时**不许**显示 0 —— 学生会以为他一分没得');
  assert.equal(view.reward, 2, '但那个数本身算得出来（它不依赖样式）');
});

/* ── 过程事实（第 3 条）──────────────────────────────────────────────── */

test('★ 过程事实：三列齐 ⇒ 三个都在，且「距今」用的是**服务端对服务端**的差', () => {
  const SERVER_NOW = Date.parse('2026-09-28T12:00:00.000Z');
  const facts = processFacts(row({
    createdAt: '2026-09-28T11:48:00.000Z',
    savedAt: '2026-09-28T11:59:20.000Z',
    saveCount: 3,
  }), SERVER_NOW);
  assert.equal(facts.startedAgoMs, 12 * 60 * 1000, '首次作答 12 分钟前');
  assert.equal(facts.savedAgoMs, 40 * 1000, '最近一次保存 40 秒前');
  assert.equal(facts.saveCount, 3);
});

/**
 * 🔴 **旧行三列全 null ⇒ 三段全部「不知道」**，界面整段不显示。
 * 不许拿浏览器的 `Date.now()` 去减服务端的时间戳（跨时钟，静默算错 ——
 * 与 `worksheet-board-data.ts` 里那条同源），也不许编一个 0（「刚刚保存过」是假话）。
 */
test('🔴 过程事实：三列是 null ⇒ 三段全是 null（不知道），不许编', () => {
  const SERVER_NOW = Date.parse('2026-09-28T12:00:00.000Z');
  const facts = processFacts(row({}), SERVER_NOW);
  assert.deepEqual(facts, { startedAgoMs: null, savedAgoMs: null, saveCount: null });
});

test('🔴 过程事实：serverNow 读不出来 ⇒ 时间那两段 null，但 saveCount 照给（它不需要时钟）', () => {
  const facts = processFacts(row({
    createdAt: '2026-09-28T11:48:00.000Z', savedAt: '2026-09-28T11:59:20.000Z', saveCount: 3,
  }), Number.NaN);
  assert.equal(facts.startedAgoMs, null);
  assert.equal(facts.savedAgoMs, null);
  assert.equal(facts.saveCount, 3, '次数没有时钟也能说');
});

test('★ 「多久以前」的取整：59 秒说「刚刚」、60 秒说「1 分钟前」', () => {
  assert.equal(formatAgo(0), '刚刚');
  assert.equal(formatAgo(59_000), '刚刚');
  assert.equal(formatAgo(60_000), '1 分钟前');
  assert.equal(formatAgo(90_000), '1 分钟前', '向下取整：1 分 30 秒是「1 分钟前」');
  assert.equal(formatAgo(12 * 60_000), '12 分钟前');
  assert.equal(formatAgo(59 * 60_000), '59 分钟前');
  assert.equal(formatAgo(60 * 60_000), '1 小时前');
  assert.equal(formatAgo(3 * 60 * 60_000), '3 小时前');
  assert.equal(formatAgo(23 * 60 * 60_000), '23 小时前');
  assert.equal(formatAgo(24 * 60 * 60_000), '1 天前');
  assert.equal(formatAgo(50 * 60 * 60_000), '2 天前');
});

/* ── 该展开哪一题（第 3 条的落点判据）───────────────────────────────── */

test('★ 默认展开：多题作答中时，展开**最近保存过**的那一道', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' }), node({ id: 'q2', type: 'single-choice' }), node({ id: 'q3', type: 'single-choice' })];
  // ⚠️ 故意的顺序：q1 的时间戳比 q2 新，但它在题序上靠前 —— 两种口径在这里会分叉。
  const got = inProgressQuestionId(nodes, [
    row({ questionId: 'q1', status: 'draft', savedAt: '2026-09-28T12:00:00.000Z' }),
    row({ questionId: 'q2', status: 'draft', savedAt: '2026-09-28T11:00:00.000Z' }),
    row({ questionId: 'q3', status: 'submitted' }),
  ]);
  assert.equal(got, 'q1', '取最近保存的那一道（与格子上「正在做第 N 题」同源）');
});

test('★ 默认展开：一道都没在作答 ⇒ 一题都不展开（null）', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' }), node({ id: 'q2', type: 'single-choice' })];
  assert.equal(
    inProgressQuestionId(nodes, [row({ questionId: 'q1', status: 'submitted' })]),
    null,
  );
});

/**
 * 🔴 有 draft 但**没有任何时间戳**（旧行）时，退到「题序最靠前的那一道」——
 * 那是一个**可解释**的猜测（他是从前往后做的），而不是随便挑一题。
 * 编一个「他正在做第 3 题」会让教师去讲一道这个学生根本没在做的题。
 */
test('🔴 默认展开：draft 没有 savedAt（旧行）⇒ 退到题序最靠前的那一道，不编', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' }), node({ id: 'q2', type: 'single-choice' }), node({ id: 'q3', type: 'single-choice' })];
  const got = inProgressQuestionId(nodes, [
    row({ questionId: 'q2', status: 'draft' }),
    row({ questionId: 'q3', status: 'draft' }),
  ]);
  assert.equal(got, 'q2', '题序最靠前（q1 没动过，不算）');
});

test('★ 默认展开：作答行里有题目树里已经没有的题（教师改单删了）⇒ 不被它带偏', () => {
  const nodes = [node({ id: 'q1', type: 'single-choice' })];
  const got = inProgressQuestionId(nodes, [
    row({ questionId: 'gone', status: 'draft', savedAt: '2026-09-28T23:00:00.000Z' }),
    row({ questionId: 'q1', status: 'draft', savedAt: '2026-09-28T11:00:00.000Z' }),
  ]);
  assert.equal(got, 'q1', '🔴 只认还在这份学习单里的题 —— 展开一道屏幕上不存在的题会是一片空白');
});

/* ── 清除的确认文案（第 4 条）─────────────────────────────────────────── */

test('★ 确认文案：说「有作答记录」而不是「共 N 题」，且不列「未作答」那一档', () => {
  const text = clearConfirmText('花荣', '秋天的雨', [
    row({ questionId: 'q1', status: 'submitted' }),
    row({ questionId: 'q2', status: 'submitted' }),
    row({ questionId: 'q3', status: 'draft' }),
  ], 0, null);
  assert.match(text, /共 3 题有作答记录：2 题已提交、1 题作答中/, text);
  assert.match(text, /秋天的雨/);
  assert.match(text, /花荣/);
  assert.match(text, /不可撤销/, '🔴 破坏性操作必须写明不可撤销');
  // ⚠️ 学习单可能一共 7 题，但这里**只**说「3 题有作答记录」——
  // 说成「共 3 题」会让教师以为这份单只有 3 题。
  assert.ok(!/共 3 题：/.test(text), '不许写成「共 N 题」');
});

test('★ 确认文案：奖励为 0 时**不提**奖励那一句；不为 0 时要提，并说清它为什么归零', () => {
  const rows = [row({ questionId: 'q1', status: 'submitted', score: 2 })];
  const zero = clearConfirmText('花荣', '秋天的雨', rows, 0, '★×0');
  assert.ok(!zero.includes('奖励'), '0 的时候提奖励是废话，而且会让教师以为他刚才有过奖励');

  const some = clearConfirmText('花荣', '秋天的雨', rows, 6, '★×6');
  assert.match(some, /奖励（★×6）由判分派生，会一并归零/, '🔴 教师一定会问「奖励清不清」，这句话就是回答');
});

test('★ 确认文案：一行作答都没有时如实说，不印一串 0', () => {
  const text = clearConfirmText('花荣', '秋天的雨', [], 0, null);
  assert.match(text, /还没有任何作答记录/, text);
  assert.ok(!/共 0 题/.test(text), '「共 0 题：0 题已提交」是噪声');
});

/**
 * 🔴 **本仓没有前端测试框架，所以「key 唯一」这条 React 的硬要求只能在这里钉。**
 *
 * 实测事故（2026-09-28，教师点开看板的学生卡片时）：全貌那一行第一版把 key 写成**符号**，
 * 而 `◐` 出现了两次（「已提交但没有对错」与「作答中」）⇒ React 报
 * `Encountered two children with the same key, '◐'`，后果是那两个子节点
 * **被漏掉或重复渲染**（React 明说这个行为不受支持）。
 */
test('🔴 全貌六格的 key 与语义图标必须唯一', () => {
  const cells = participantOverviewCells(
    participantOverview([node({ id: 'q1', type: 'single-choice' })], [], { style: 'star' }),
  );
  assert.equal(cells.length, 6);
  const keys = cells.map((cell) => cell.key);
  assert.equal(new Set(keys).size, keys.length, `key 不许重复：${keys.join(', ')}`);
  const icons = cells.map((cell) => cell.icon);
  assert.equal(new Set(icons).size, icons.length, `图标语义不许重复：${icons.join(', ')}`);
  assert.deepEqual(icons, ['correct', 'partial', 'retry', 'submitted', 'drafting', 'unanswered']);
  // 六格的 key 与顺序是屏幕上读得到的那一份，改动要是有意的。
  assert.deepEqual(keys, ['correct', 'partial', 'wrong', 'noVerdict', 'draft', 'unanswered']);
});
