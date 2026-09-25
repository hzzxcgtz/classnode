/**
 * `worksheet-matrix.ts` 的逐条断言 —— **矩阵的唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-matrix.test.ts
 * ```
 *
 * ⚠️ 本仓**没有 jsdom**：矩阵长什么样、粘性表头对不对、色块分不分得清，这里**一条都断言不了**。
 * 本文件管的是另一半 —— 「哪一格是什么状态」「哪一题卡住」：**那一条错了不报错**，
 * 只会让教师讲错题、或对着一道还没讲到的题讲十分钟。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetBoardAnswerRow, WorksheetBoardParticipant, WorksheetBoardWorksheet, WorksheetQuestionNode } from '@/lib/types';
import { buildWorksheetMatrix, matrixHeadline, questionTallies, type CellState } from './worksheet-matrix.ts';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state.ts';

/* ── 造数据 ──────────────────────────────────────────────────────────── */

/** ⚠️ 与 `worksheet-tile-state.test.ts` 的造题助手**逐字同形**（那一个已经能编译，别自己加 cast）。 */
function node(id: string, type = 'single-choice', children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type, prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

/** 一条作答行。⚠️ 只给 `status` —— 对错不在矩阵里（规格 §3.4），所以夹具也不该带它。 */
function row(questionId: string, status: string): WorksheetBoardAnswerRow {
  return { questionId, status, isCorrect: null, gradeState: null, score: null, reviewedAt: null, value: null };
}

/** 一个参与者。`cells` 里没有的题 = 他这一题没有任何行（= 未答）。 */
function participant(participantId: string, cells: Record<string, string> = {}): WorksheetBoardParticipant {
  return {
    participantId,
    name: `参与者${participantId}`,
    kind: 'student',
    groupName: null,
    answerRows: Object.entries(cells).map(([questionId, status]) => row(questionId, status)),
  };
}

function sheet(participants: WorksheetBoardParticipant[]): WorksheetBoardWorksheet {
  return { id: 'w1', title: '光合作用实验', participants };
}

/** 广播那一路（键 = 参与者 id，与 `worksheetProgress` 同一个键空间）。 */
function live(cells: Record<string, Record<string, 'draft' | 'submitted'>>): Record<string, ParticipantWorksheetProgress> {
  const out: Record<string, ParticipantWorksheetProgress> = {};
  for (const [participantId, cellMap] of Object.entries(cells)) {
    out[participantId] = { cells: cellMap, lastQuestionId: null, lastAt: 0 };
  }
  return out;
}

/** 只取某一题的某一格 —— 断言里读起来最短。 */
function cell(rows: ReturnType<typeof buildWorksheetMatrix>, questionId: string, participantId: string): CellState | undefined {
  return rows.find((r) => r.questionId === questionId)?.cells[participantId];
}

/* ── 1. 一格的三档 ──────────────────────────────────────────────────── */

test('三档：REST 的 draft ⇒ draft、submitted ⇒ submitted、没有行 ⇒ unanswered', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'draft', q2: 'submitted' })]),
    [node('q1'), node('q2'), node('q3')],
    {},
  );
  assert.equal(cell(rows, 'q1', 'p1'), 'draft');
  assert.equal(cell(rows, 'q2', 'p1'), 'submitted');
  assert.equal(cell(rows, 'q3', 'p1'), 'unanswered', '没有那行 = 未答，不是「不知道」');
});

test('REST 里认不出的 status ⇒ unanswered（不编第四种颜色）', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1', { q1: 'nobody-knows' })]), [node('q1')], {});
  assert.equal(cell(rows, 'q1', 'p1'), 'unanswered');
});

/* ── 2. 🔴 合并规则：广播赢 ─────────────────────────────────────────── */

test('🔴 广播赢：同一格两边都有值时，取广播那一个', () => {
  // REST 是**上一次拉取时**的快照；广播是**本地更新的那一次动作**。
  // 与学伴端 `hydrateAnswers` 的「队列赢」逐字同源。
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [node('q1')],
    live({ p1: { q1: 'draft' } }),
  );
  assert.equal(cell(rows, 'q1', 'p1'), 'draft', '学生重交了/又改了 ⇒ 广播那次更新，REST 是旧的');
});

test('广播兜底：REST 有、广播没有 ⇒ 用 REST（刷新之后广播是空的）', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1', { q1: 'submitted' })]), [node('q1')], {});
  assert.equal(cell(rows, 'q1', 'p1'), 'submitted');
});

test('广播里那一格的值认不出 ⇒ 回落到 REST，不是 unanswered', () => {
  // 类型上不可能，但线上是自由字符串。**回落**而不是当未答 —— 后者会把学生已经交掉的题画成没动。
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [node('q1')],
    live({ p1: { q1: 'weird' as 'draft' } }),
  );
  assert.equal(cell(rows, 'q1', 'p1'), 'submitted');
});

test('🔴 广播里有列外的参与者 ⇒ 不凭空造一格（列的真实来源只有 REST）', () => {
  // 课中途加入的学生：REST 那份（上一次拉的）里没有他，而他的广播已经到了。
  // 两边各造一套「谁在班里」必然分叉 ⇒ 这一格**不存在**，等下一轮 30 秒重拉给他一列。
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1')], live({ p999: { q1: 'draft' } }));
  assert.equal(rows[0].cells.p999, undefined);
  assert.deepEqual(Object.keys(rows[0].cells), ['p1']);
});

/* ── 3. 🔴 行的轴 = 题目树（不是「有人答过的题」的并集）────────────── */

test('🔴 全班都没动过的题**仍在行里**（行轴是题目树，不是答过的题的并集）', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1', { q1: 'draft' })]), [node('q1'), node('q2'), node('q3')], {});
  assert.deepEqual(rows.map((r) => r.questionId), ['q1', 'q2', 'q3']);
});

test('🔴 嵌套子题也算题（与看板格子、抽屉三处同一把尺子）', () => {
  // `content` 是树，服务端算「整卷交齐」时数的是拍平后的题数（`worksheet-tile-state.ts` 逐字）。
  // 只看顶层 ⇒ 子题整行消失，而那些题的作答在屏幕上一个字都不出现。
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1', 'single-choice', [node('q1a', 'fill-blank')]), node('q2')], {});
  assert.deepEqual(rows.map((r) => r.questionId), ['q1', 'q1a', 'q2']);
});

test('题号是 0-based 的拍平序（与 `worksheetTileState` 的 `index` 同源），题型走注册表的中文名', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1'), node('q2', 'fill-blank')], {});
  assert.deepEqual(rows.map((r) => r.index), [0, 1]);
  assert.equal(rows[0].typeLabel, '单选题');
  assert.equal(rows[1].typeLabel, '填空题');
});

test('题目树为空 ⇒ 零行（调用方走「这份学习单还没有题目」那条空态）', () => {
  assert.deepEqual(buildWorksheetMatrix(sheet([participant('p1')]), [], {}), []);
});

/* ── 3b. 🔴 能区分两种口径的夹具 ────────────────────────────────────── */

/**
 * 🔴 这个夹具是**刻意设计**的：它让「已作答最多」与「未交最多」指向**不同**的题。
 *
 * 形状（4 个参与者 / 4 道题）：
 *   q1 全班交齐 · q2 全班交齐 · **q3 两人交了、一人在写、一人没动** · q4 没人动
 *
 * ⇒ 已作答：q3 = 3、q4 = 0          ⇒「已作答最多」指向 **q3**（前沿）
 * ⇒ 未交：  q3 = 2、q4 = 4          ⇒「未交最多」指向 **q4**（还没讲到的题）
 *
 * ⚠️ **最初的夹具（q3 全班都是草稿、q1/q2 全交）区分不开这两种口径** ——
 * 那时 q3 的未交数与 q4 **并列最大**，并列取最靠前，两个判据都回 q3，
 * 于是「反证」什么都没证。夹具必须让前沿那一题的**未交数严格更小**（因为有人交了）。
 */
const FRONTIER = [
  participant('p1', { q1: 'submitted', q2: 'submitted', q3: 'submitted' }),
  participant('p2', { q1: 'submitted', q2: 'submitted', q3: 'submitted' }),
  participant('p3', { q1: 'submitted', q2: 'submitted', q3: 'draft' }),
  participant('p4', { q1: 'submitted', q2: 'submitted' }),
];
const FRONTIER_NODES = [node('q1'), node('q2'), node('q3'), node('q4')];

/* ── 4. 逐题计数 ────────────────────────────────────────────────────── */

test('计数：drafted / submitted / engaged / total 四样，分母是参与者数', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'draft' }), participant('p2', { q1: 'submitted' }), participant('p3')]),
    [node('q1')],
    {},
  );
  assert.deepEqual(questionTallies(rows), [
    { questionId: 'q1', index: 0, drafted: 1, submitted: 1, engaged: 2, total: 3 },
  ]);
});

/* ── 5. 🔴 「卡住的那一题」 ─────────────────────────────────────────── */

test('🔴 全班停在第三题（有人交了、有人还在写）、第四题没人动 ⇒ 指向第 3 题（**不是**第 4 题）', () => {
  // 这是本判据存在的全部理由：越靠后、越没人碰的题，「未交」人数越多 ——
  // 那个更自然的判据于是总把**还没讲到的题**报成卡住，而它看起来完全合理。
  const rows = buildWorksheetMatrix(sheet(FRONTIER), FRONTIER_NODES, {});
  const headline = matrixHeadline(questionTallies(rows));
  assert.deepEqual(headline, { kind: 'stuck', questionId: 'q3', index: 2, tally: 3, total: 4 });
});

test('🔴 阴性对照：全班一道题都没动 ⇒ not-started，**不是** stuck 在第 1 题', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1'), participant('p2')]), [node('q1'), node('q2')], {});
  assert.deepEqual(matrixHeadline(questionTallies(rows)), { kind: 'not-started' });
});

test('全部交齐 ⇒ all-submitted（「已交 < 参与者数」的题一道都不剩）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' }), participant('p2', { q1: 'submitted' })]),
    [node('q1')],
    {},
  );
  assert.deepEqual(matrixHeadline(questionTallies(rows)), { kind: 'all-submitted' });
});

test('参与者数为 0 ⇒ no-participants；一道题都没有 ⇒ no-questions', () => {
  const noPeople = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1')], {});
  // p1 存在但还没作答 ⇒ 这是 not-started；真正的「没有人」要 participant 为空。
  assert.deepEqual(matrixHeadline(questionTallies(noPeople)), { kind: 'not-started' });
  const empty = buildWorksheetMatrix(sheet([]), [node('q1')], {});
  assert.deepEqual(matrixHeadline(questionTallies(empty)), { kind: 'no-participants' });
  const noQuestions = buildWorksheetMatrix(sheet([participant('p1')]), [], {});
  assert.deepEqual(matrixHeadline(questionTallies(noQuestions)), { kind: 'no-questions' });
});

test('并列时取**最靠前**的那一题', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'draft', q3: 'draft' })]),
    [node('q1'), node('q2'), node('q3')],
    {},
  );
  const headline = matrixHeadline(questionTallies(rows));
  assert.equal(headline.kind === 'stuck' ? headline.index : -1, 0);
});

test('★ 反证：「未交最多」会把还没讲到的题报成卡住 —— 钉住两种口径的差别', () => {
  // 这就是那个更自然、也更错的判据：它数的是「还差几个人交」，于是**越靠后、越没人碰的题
  // 越是第一名**。在这个夹具上它指向 q4（未交 4），而实现必须指向 q3（未交 2、已作答 3）。
  const rows = buildWorksheetMatrix(sheet(FRONTIER), FRONTIER_NODES, {});
  const tallies = questionTallies(rows);
  const wrong = tallies
    .filter((t) => t.submitted < t.total)
    .reduce((best, t) => (t.total - t.submitted > best.total - best.submitted ? t : best));
  assert.equal(wrong.questionId, 'q4', '这就是「未交最多」的样子');
  const right = matrixHeadline(tallies);
  assert.equal(right.kind === 'stuck' ? right.questionId : null, 'q3');
  assert.notEqual(wrong.questionId, right.kind === 'stuck' ? right.questionId : null);
});
