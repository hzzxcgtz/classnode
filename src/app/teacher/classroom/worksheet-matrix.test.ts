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
import { buildWorksheetMatrix, type CellState } from './worksheet-matrix.ts';
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
