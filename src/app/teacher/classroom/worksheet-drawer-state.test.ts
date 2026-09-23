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
  questionOutcome,
  statusLabel,
} from './worksheet-drawer-state.ts';

/**
 * 学习单抽屉的判据（形态 A / B）。
 *
 * 每个 describe 对应一条**错了不报错**的规则，报告里的实测输出就是这些用例：
 *   · 主观题没有 ✓/✗（并且 `isCorrect` 被手工改成 true 也一样没有）；
 *   · 未作答的题**不给**「标记已查看」按钮（服务端对它会回 409）；
 *   · 正确率的分母是「已判过的行」，不是参与者数；
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

test('形态 A：主观题**永远没有对错**，即使库里那行的 isCorrect 被改成了 true', () => {
  const submitted = row({ questionId: 'q_3', status: 'submitted', isCorrect: true, value: { format: 'text/v1', text: '冒泡了' } });
  const outcome = questionOutcome(short, submitted);
  assert.equal(outcome.status, 'submitted', '状态是「已提交」（它确实交了）');
  assert.equal(outcome.mark, 'none', '主观题不该出现 ✓/✗ —— 系统根本不知道学生对不对');
  assert.equal(outcome.canReview, true, '主观题照样可以「标记已查看」');
  assert.equal(outcome.answerText, '冒泡了', '原答案照给');

  // 阳性对照：同样一行数据换到单选题上**必须**显示对错 —— 否则上面那句只是「什么都不显示」。
  assert.equal(questionOutcome(choice, { ...submitted, questionId: 'q_1', value: { format: 'choice/v1', selected: ['B'] } }).mark, 'correct');
});

test('形态 A：客观题的对错只认「已提交 + isCorrect 是真布尔值」', () => {
  assert.equal(questionOutcome(choice, row({ status: 'draft', isCorrect: true })).mark, 'none', '作答中不判对错');
  assert.equal(questionOutcome(choice, row({ status: 'submitted', isCorrect: false })).mark, 'wrong');
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: null })).mark, 'none',
    '关闭自动判分时服务端给 null ⇒ 退化成「已提交」，不显示 ✗（把「没判」说成「错」是最坏的一种）',
  );
  assert.equal(
    questionOutcome(choice, row({ status: 'submitted', isCorrect: false })).status, 'submitted',
    '没有 ✓/✗ 不代表状态栏空着',
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

test('状态标签：三态各一个词，与看板方格阵同一组', () => {
  assert.equal(statusLabel('unanswered'), '未作答');
  assert.equal(statusLabel('draft'), '作答中');
  assert.equal(statusLabel('submitted'), '已提交');
});

// ---------------------------------------------------------------------------
// 形态 B · 按题聚合
// ---------------------------------------------------------------------------

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
};

test('🔴 每个题型的 graded 标记都要与「它判不判分」的决策一致', () => {
  for (const option of QUESTION_TYPE_OPTIONS) {
    assert.equal(
      option.graded,
      EXPECTED_GRADED[option.value],
      `题型「${option.value}」的 graded 标记不对 —— 看板会不会画 ✓/◐/✗ 由它决定`,
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

test('🔴 分母与格子必须同进同出：能判分的题型既要进正确率的分母，也要在格子上画标记', () => {
  const rows: Array<WorksheetBoardAnswerRow | undefined> = [
    row({ questionId: 'q_x', status: 'submitted', isCorrect: false }),
    row({ questionId: 'q_x', status: 'submitted', isCorrect: true }),
  ];

  for (const option of QUESTION_TYPE_OPTIONS) {
    const outcome = questionOutcome(node({ id: 'q_x', type: option.value }), rows[0]);

    if (!EXPECTED_GRADED[option.value]) {
      assert.equal(outcome.mark, 'none', `题型「${option.value}」不判分，格子上就不该有标记`);
      continue;
    }

    // 这正是那份并列白名单漏改时的症状：服务端判了分、`isCorrect` 非空
    // ⇒ 下面这个分母把它算进去，而格子上什么都不画 —— 全程无报错。
    assert.equal(questionAggregate(rows).graded, 2, '分母读的是 isCorrect 非空，与题型无关');
    assert.notEqual(
      outcome.mark,
      'none',
      `题型「${option.value}」已经被判了分（进了分母），格子上却不画标记 —— ` +
      '这就是「新题型算进正确率、格子上没有 ✓」那个静默不一致',
    );
  }
});
