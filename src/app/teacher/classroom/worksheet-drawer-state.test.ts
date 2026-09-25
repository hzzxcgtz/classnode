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
} from './worksheet-drawer-state.ts';

/**
 * 学习单抽屉的判据（形态 A / B）。
 *
 * 每个 describe 对应一条**错了不报错**的规则，报告里的实测输出就是这些用例：
 *   · 主观题没有 ✓/½/✗（并且 `gradeState` / `isCorrect` 被手工改成「对」也一样没有）；
 *   · 未作答的题**不给**「标记已查看」按钮（服务端对它会回 409）；
 *   · 正确率的分母是「已判过的行」，不是参与者数；
 *   · ★ M4a **正确率的分子只数全对**（半对进分母不进分子 ⇒ 10 行 4/3/3 是 **40%**）；
 *   · ★ M4a 三档标记以 `gradeState` 为**真源**，`isCorrect` 只在它缺失时兜底；
 *   · ★ E2 **四档在界面上两两可区分**（半对是 `½ 半对`，既不长得像答错、也不像没判分，
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

test('🔴 形态 A：三档标记读 gradeState —— 半对画出自己那一档，既不是「对」也不是「错」', () => {
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'correct', isCorrect: true })).mark,
    'correct',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false })).mark,
    'partial',
    '半对落到 wrong 的话，「算进分母却不算对」就看起来是答错了（规格 §12 要它在看板那一侧、即抽屉里画得出来）',
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
  // 半对那一行**必然**是 `isCorrect: false`（那个布尔的语义已收窄为「全对」）——
  // 光看布尔值，它与「答错」长得一模一样，这正是要加 gradeState 这一列的原因。
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false })).mark,
    'partial',
    '半对的 isCorrect 是 false ⇒ 读布尔值会把半对说成答错',
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
    '旧行里没有「半对」这个概念（M4a 才有）⇒ false 只能落 incorrect，猜成 partial 是编的',
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
// 是「半对必须画得出来」。这一段判据原本写在 `worksheet-drawer.tsx` 的 JSX 里，
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

/** 一个长相「像不像」另一个 —— 拿教师真能看见的那三样（符号 / 词 / 颜色）比。 */
function look(view: { glyph: string; label: string; color: string }): string {
  return `${view.glyph}|${view.label}|${view.color}`;
}

test('🔴 四档判分结论在界面上两两可区分 —— 半对既不长得像答错，也不长得像没判分', () => {
  const correct = outcomeMarkView('correct', 'submitted');
  const partial = outcomeMarkView('partial', 'submitted');
  const wrong = outcomeMarkView('wrong', 'submitted');
  // 没有判分结论的那一档取「已提交」来比 —— 它是最容易被误认成半对的那一个
  //（E2 之前半对画的就是它）。
  const none = outcomeMarkView('none', 'submitted');

  const looks = [correct, partial, wrong, none].map(look);
  assert.equal(new Set(looks).size, 4, `四档里有两档长得一模一样：${looks.join(' / ')}`);

  // 逐对点名 —— 上面那一条只说得清「有重复」，说不出是哪一对。
  assert.notEqual(
    look(partial), look(wrong),
    '半对画成答错 —— 「算进分母却不算对」（规格 §12）就变成了一句假话',
  );
  assert.notEqual(
    look(partial), look(none),
    '半对画成「没判分」—— 这正是 E2 之前的样子，教师看不出这道题被扣了分',
  );
  assert.notEqual(
    look(partial), look(correct),
    '半对画成答对 —— 正确率的分子里没有它，那是另一句假话',
  );
  assert.notEqual(look(wrong), look(none), '「答错」与「没判分」是两件事：一个系统知道，一个系统不知道');

  // 三档判分结论同字号同字重（并排扫视时才是一组），差别只在符号、词与颜色。
  // ⚠️ 这条改坏了的表现是「半对比答对矮半头」—— 教师会把它读成次要信息，而不是一个扣分结论。
  assert.deepEqual(
    [correct, partial, wrong].map((view) => view.emphasis), ['verdict', 'verdict', 'verdict'],
    '三档判分结论必须是同一个强调档',
  );
  assert.equal(partial.glyph, '½', '半对的符号');
  assert.equal(partial.label, '半对');
});

test('🔴 半对的符号**不能**是 ◐ —— 它在同一列上已经带了两个别的意思', () => {
  const partial = outcomeMarkView('partial', 'submitted');
  assert.notEqual(
    partial.glyph, '◐',
    '◐ 在同一个抽屉列表里已经是「◐ 作答中」与「◐ 已提交」（没有对错的那一支），' +
    '而规格 §7.3 的图例逐字写着「◐ = 作答中 / 已提交但没有对错」—— 再拿它当半对，' +
    '同一列上就有三种含义，「画得出来」也就落空了（得逐行读字才分得清）',
  );
  // 阴性对照：◐ 确实还在用（用在那两处状态词上）—— 否则上面那条断言可以靠「删掉 ◐」蒙过去。
  assert.equal(outcomeMarkView('none', 'draft').glyph, '◐');
  assert.equal(outcomeMarkView('none', 'submitted').glyph, '◐');
});

test('🔴 没有判分结论的那一档既不像「答错」也不像「半对」（未作答 / 作答中 / 已提交 三种状态）', () => {
  const verdictGlyphs = ['✓', '½', '✗'];
  for (const status of ['unanswered', 'draft', 'submitted'] as const) {
    const view = outcomeMarkView('none', status);
    assert.ok(
      !verdictGlyphs.includes(view.glyph),
      `状态「${status}」在系统根本没判分时画出了判分符号「${view.glyph}」—— ` +
      '把「不知道」说成「对 / 半对 / 错」是本任务最要防的一类假象',
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

test('🔴 端到端（纯函数这一段）：库里判成半对的那一行，画出来是「½ 半对」而不是「✗ 答错」', () => {
  const partialView = viewOf(choice, row({ status: 'submitted', gradeState: 'partial', isCorrect: false }));
  assert.equal(partialView.glyph, '½');
  assert.equal(partialView.label, '半对');

  // 同一条管线上的另外两档各就各位 —— 否则上面那两行可以靠「所有档都画 ½」蒙过去。
  assert.equal(viewOf(choice, row({ status: 'submitted', gradeState: 'correct', isCorrect: true })).glyph, '✓');
  assert.equal(viewOf(choice, row({ status: 'submitted', gradeState: 'incorrect', isCorrect: false })).glyph, '✗');

  // 主观题**永远没有对错** ⇒ 哪怕库里那一行写着 `partial` 也不画 ½
  //（`short-answer` 在注册表里是 `graded: false`，它走的是「没有对错」那一支）。
  assert.equal(
    viewOf(short, row({ questionId: 'q_3', status: 'submitted', gradeState: 'partial' })).glyph, '◐',
  );
  // 一次都没动过的题：`─ 未作答`，不许是任何判分符号。
  assert.equal(viewOf(choice, undefined).glyph, '─');
});

// ---------------------------------------------------------------------------
// 形态 B · 按题聚合
// ---------------------------------------------------------------------------

test('🔴 形态 B：正确率是「全对才算对」—— 10 行 4 全对 / 3 半对 / 3 错 = **40%**，不是 70%', () => {
  const rows: Array<WorksheetBoardAnswerRow | undefined> = [];
  const submit = (gradeState: 'correct' | 'partial' | 'incorrect'): void => {
    // 半对那一行的 `isCorrect` 按规格 §12 只能是 false（那个布尔的语义已收窄为「全对」）——
    // 所以这一组数据里，**光看 isCorrect 根本分不出半对与答错**，这正是本用例的意义。
    rows.push(row({ status: 'submitted', gradeState, isCorrect: gradeState === 'correct' }));
  };
  for (let i = 0; i < 4; i += 1) submit('correct');
  for (let i = 0; i < 3; i += 1) submit('partial');
  for (let i = 0; i < 3; i += 1) submit('incorrect');

  const aggregate = questionAggregate(rows);
  assert.equal(aggregate.graded, 10, '半对**进分母**（分母是「已判过的行」，三档都算判过）');
  assert.equal(aggregate.correct, 4, '半对**不进分子**');
  assert.equal(
    aggregate.accuracy, 40,
    '把分子写成「非 incorrect 即算对」会得到 70%（7/10）—— 半对被算成了对，教师看到的正确率凭空变高',
  );

  // 🔴 反面对照：同一组数据把 3 行半对**改判**成答错，正确率必须**一模一样**（40%）。
  // 这是「半对既不算对、也不算得比错更差」那句话的实测形状 —— 顺带证明上面那个 40
  // 不是碰巧（它只由 4 与分母 10 决定）。
  const allOrNothing = rows.map((item) => (
    item && item.gradeState === 'partial'
      ? row({ status: 'submitted', gradeState: 'incorrect', isCorrect: false })
      : item
  ));
  assert.equal(questionAggregate(allOrNothing).accuracy, 40);
});

test('★ 形态 B：全是半对 ⇒ 正确率 **0**（进了分母、一个也没进分子），不是「—」', () => {
  const allPartial = questionAggregate([
    row({ status: 'submitted', gradeState: 'partial', isCorrect: false }),
    row({ status: 'submitted', gradeState: 'partial', isCorrect: false }),
  ]);
  assert.equal(allPartial.graded, 2, '半对不是「没判过」—— 它进分母');
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
  const { questions, indexOf } = indexQuestions(nodes);
  assert.deepEqual(questions.map((q) => q.id), ['q_1', 'q_2', 'q_3', 'q_4'], '嵌套的题也要在（服务端算「整卷交齐」时数它）');
  assert.equal(questionHeading(choice, indexOf('q_1')), '1. 单选题');
  assert.equal(questionHeading(questions[3], indexOf('q_4')), '4. 填空题');
  // 题已被教师删掉 / 改过 id ⇒ 查不到下标，**不编题号**，只给题型。
  assert.equal(indexOf('已经不在的题'), -1);
  assert.equal(questionHeading(choice, -1), '单选题');
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
// 而「半对在格子上画得出来」恰恰是 E2 核清掉的那个 §7.2 违规。
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

    // ★ M4a：半对那一档**也**要同进同出，而且比另外两档更要紧 ——
    // 它是唯一「算进分母却不算对」的行（规格 §12），抽屉里少了它就只能看起来像答错。
    const partialRow = row({ questionId: 'q_x', status: 'submitted', gradeState: 'partial', isCorrect: false });
    assert.equal(questionAggregate([partialRow, partialRow]).graded, 2, '半对也进分母');
    assert.equal(
      questionOutcome(node({ id: 'q_x', type: option.value }), partialRow).mark,
      'partial',
      `题型「${option.value}」被判成半对，抽屉里却没画出半对档 —— ` +
      '它会看起来像答错（或像没判分），两句话都是假的',
    );
  }
});
