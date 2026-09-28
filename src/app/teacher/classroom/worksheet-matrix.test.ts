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
import { buildWorksheetMatrix, matrixGroups, matrixHeadline, promptLabel, questionTallies, rowTally, uncoveredCount, type CellState } from './worksheet-matrix.ts';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state.ts';

/* ── 造数据 ──────────────────────────────────────────────────────────── */

/** ⚠️ 与 `worksheet-tile-state.test.ts` 的造题助手**逐字同形**（那一个已经能编译，别自己加 cast）。 */
function node(id: string, type = 'single-choice', children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type, prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

/** 一条作答行。⚠️ 只给 `status` —— 对错不在矩阵里（规格 §3.4），所以夹具也不该带它。 */
function row(questionId: string, status: string): WorksheetBoardAnswerRow {
  // ★ 2026-09-28：作答活动三列一律 `null`（= 不知道）—— 矩阵**按规格 §3.4 不编码对错、
  // 也不编码过程**，它只关心 `status`。带上这三列是为了满足类型，不是为了给矩阵用。
  return {
    questionId, status, isCorrect: null, gradeState: null, score: null, reviewedAt: null, value: null,
    createdAt: null, savedAt: null, saveCount: null,
  };
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

test('题号是两级题号（无任务时就是 1..n），题型走注册表的中文名', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1'), node('q2', 'fill-blank')], {});
  assert.deepEqual(rows.map((r) => r.heading), ['1', '2']);
  assert.equal(rows[0].typeLabel, '单选题');
  assert.equal(rows[1].typeLabel, '填空题');
  // ★ M7a：`type` 是**原始题型串**（`typeLabel` 是它的中文名）。矩阵题行上的「分析」入口
  // 靠它判「这题是不是主观题」—— **不能反过来从 `typeLabel` 解**：那是给人看的中文名，
  // 改成「问答题（主观）」就会让判据失效，而**屏幕上一点异常都没有**（只是按钮不见了）。
  // 两条断言放在同一个用例里，是为了让 `type` 与 `typeLabel` 由**同一个夹具**钉住、不会各自漂。
  assert.equal(rows[0].type, 'single-choice');
  assert.equal(rows[1].type, 'fill-blank');
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
    { questionId: 'q1', heading: '1', drafted: 1, submitted: 1, engaged: 2, total: 3 },
  ]);
});

/* ── 5. 🔴 「卡住的那一题」 ─────────────────────────────────────────── */

test('🔴 全班停在第三题（有人交了、有人还在写）、第四题没人动 ⇒ 指向第 3 题（**不是**第 4 题）', () => {
  // 这是本判据存在的全部理由：越靠后、越没人碰的题，「未交」人数越多 ——
  // 那个更自然的判据于是总把**还没讲到的题**报成卡住，而它看起来完全合理。
  const rows = buildWorksheetMatrix(sheet(FRONTIER), FRONTIER_NODES, {});
  const headline = matrixHeadline(questionTallies(rows));
  assert.deepEqual(headline, { kind: 'stuck', questionId: 'q3', heading: '3', tally: 3, total: 4 });
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
  assert.equal(headline.kind === 'stuck' ? headline.heading : '-1', '1');
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

/* ── 6. ★ 独立审查抓出的：屏幕上的那些数字必须**与用例读的是同一个函数** ── */

/**
 * 🔴 起因：审查发现组件在 JSX 里**重新数了一遍**「已交 N/M」
 * （`filter(id => row.cells[id] === 'submitted')`），而被测的 `questionTallies().submitted`
 * **在界面上一次都没被读**。今天两份实现逐字等价 ⇒ 门禁三道全绿；一旦有人改了口径，
 * **测试仍全绿而屏幕上的数字变了**。⇒ 「已交 N/M」必须走同一个函数。
 */
test('★ rowTally：一行的计数与 questionTallies 逐字段一致（屏幕与用例同一个函数）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'draft' }), participant('p2', { q1: 'submitted' }), participant('p3')]),
    [node('q1')],
    {},
  );
  assert.deepEqual(rowTally(rows[0]), questionTallies(rows)[0]);
  assert.equal(rowTally(rows[0]).submitted, 1, '「已交 N/M」的分子就是它');
  assert.equal(rowTally(rows[0]).total, 3, '分母是参与者数');
});

test('★ promptLabel：空题干的那句文案只在这一处', () => {
  assert.equal(promptLabel('光合作用需要什么？'), '光合作用需要什么？');
  assert.equal(promptLabel('   '), '（这道题的题干还没写）', '全是空白也算空');
  assert.equal(promptLabel(''), '（这道题的题干还没写）');
});

test('★ uncoveredCount：没有任何一份学习单的参与者数，且**钳在 0**', () => {
  const one = sheet([participant('p1'), participant('p2')]);
  assert.equal(uncoveredCount(5, [one]), 3, '5 人里只有 2 人有学习单 ⇒ 3 人没有');
  assert.equal(uncoveredCount(2, [one]), 0, '全都有 ⇒ 0');
  // ⚠️ 负数是**可能**的（两个快照取自不同时刻）—— 钳在 0，屏幕上不许出现「另有 -1 个」。
  assert.equal(uncoveredCount(1, [one]), 0);
  assert.equal(uncoveredCount(0, []), 0);
});

/* ── 7. ★ 只信「本次快照之后」到达的广播 ─────────────────────────────── */

/**
 * 🔴 起因：审查发现「广播赢」在 socket 断线重连后**永久**压住更新的 REST 数据 ——
 * 断线期间学生提交了，广播丢了，30 秒后 REST 明确说 `submitted`，而 `live` 里那条
 * 断线前的 `draft` 照样赢 ⇒ 那一格**永远**停在琥珀，直到教师手动刷新页面。
 *
 * 修法是给「广播赢」加一个**可信下界**：`liveTrustedAfter`（= 本次快照的发起时刻）。
 * 一个参与者的广播若**全部早于**这个时刻，那 REST 那份一定不比它旧
 * （REST 是在那一刻之后才读的库）⇒ 丢开 live、用 REST。
 *
 * ⚠️ 判据用的是 `ParticipantWorksheetProgress.lastAt`（= 广播**到达浏览器**的时刻，
 * `page.tsx` 用 `Date.now()` 写的）。它与下界都是**浏览器时钟**，所以两端之间的
 * 服务器 / 浏览器时钟偏差**在比较中相消** —— 这也是为什么不改用服务端时间。
 */
test('★ liveTrustedAfter：早于快照的广播**不再赢**（断线重连后的陈旧 live）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [node('q1')],
    live({ p1: { q1: 'draft' } }),
    // 广播是 t=100 到的，而快照是 t=200 发起的 ⇒ 这条广播一定早于快照读到的库。
    200,
  );
  // ⚠️ live 的 lastAt 默认是 0（见 `live()` 助手）⇒ 一定 <= 200。
  assert.equal(cell(rows, 'q1', 'p1'), 'submitted', '陈旧 live 不许赢');
});

test('★ liveTrustedAfter：晚于快照的广播**照样赢**', () => {
  const old = live({ p1: { q1: 'draft' } });
  old.p1.lastAt = 300;   // 快照 t=200 之后才到
  const rows = buildWorksheetMatrix(sheet([participant('p1', { q1: 'submitted' })]), [node('q1')], old, 200);
  assert.equal(cell(rows, 'q1', 'p1'), 'draft', '快照之后到的广播更新，必须赢');
});

test('不传 liveTrustedAfter ⇒ 老行为（全信 live），既有用例与调用点不受影响', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1', { q1: 'submitted' })]), [node('q1')], live({ p1: { q1: 'draft' } }));
  assert.equal(cell(rows, 'q1', 'p1'), 'draft');
});

/* ── 任务制：行轴是**可作答的题**，题号是两级的 ─────────────────────── */

/** 一个任务容器。`prompt` 是它的**标题**（迁移写的就是「任务一」这种），不是说明文字。 */
function task(id: string, prompt: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: 'task', prompt, inputMode: 'keyboard', data: {}, children };
}

/**
 * 🔴 这一条钉的是 §十一 数出来的那个失效：`flattenQuestions` 的**下标当题号**。
 * 任务节点一旦占掉一行，它后面**所有**小题的题号整体后移 —— 教师照着讲就会讲错题，
 * 而且没有任何报错。
 */
test('🔴 任务不占一行；小题的题号带任务前缀', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [task('t1', '任务一', [node('q1'), node('q2')]), task('t2', '任务二', [node('q3')])],
    {},
  );
  assert.deepEqual(rows.map((r) => r.questionId), ['q1', 'q2', 'q3'], '任务不许占一行');
  assert.deepEqual(rows.map((r) => r.heading), ['任务一 · 1', '任务一 · 2', '任务二 · 1']);
});

test('🔴 计数也带同一个题号（`rowTally` 与屏幕上的「已交 N/M」是同一个函数）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [task('t1', '任务一', [node('q1')]), node('q8'), node('q9')],
    {},
  );
  const tallies = questionTallies(rows);
  // ⚠️ 散题自己有**一个**跨全文的计数器（与任务内的计数器是两回事）：
  // 上面这个任务里的 q1 是「任务一 · 1」，而散题从 1 起、彼此接着往下编。
  assert.deepEqual(tallies.map((t) => t.heading), ['任务一 · 1', '1', '2'], '散题不带前缀，自己连续编号');
  assert.deepEqual(tallies.map((t) => t.submitted), [1, 0, 0]);
});

test('🔴 「卡住的是哪一题」用同一份题号 —— 前面有任务时不会指错题', () => {
  // 任务一：q1 有人动过、q2 没人动；任务二：q3 没人动。
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'draft' }), participant('p2', {})]),
    [task('t1', '任务一', [node('q1'), node('q2')]), task('t2', '任务二', [node('q3')])],
    {},
  );
  const headline = matrixHeadline(questionTallies(rows));
  assert.equal(headline.kind, 'stuck');
  assert.equal(headline.questionId, 'q1');
  // ⚠️ 若拿拍平下标当题号，这里会是 `1`（任务占了 0 号）而屏幕上写着「第 1 题」
  //    却指向 q1 —— 巧合对上；把任务放在 q1 之前才暴露。所以再钉一条**前缀**。
  assert.equal(headline.heading, '任务一 · 1');

  const shifted = buildWorksheetMatrix(
    sheet([participant('p1', { q2: 'draft' }), participant('p2', {})]),
    [task('t1', '任务一', [node('q1'), node('q2')]), task('t2', '任务二', [node('q3')])],
    {},
  );
  const shiftedHeadline = matrixHeadline(questionTallies(shifted));
  assert.equal(shiftedHeadline.kind, 'stuck');
  assert.equal(shiftedHeadline.questionId, 'q2');
  assert.equal(shiftedHeadline.heading, '任务一 · 2');
});

test('全都是任务、一个可作答的题都没有 ⇒ 不说「还没有人加入」，说「还没有题目」', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [task('t1', '任务一', [])], {});
  assert.deepEqual(rows, []);
  assert.equal(matrixHeadline(questionTallies(rows)).kind, 'no-questions');
});

/* ── 6. 按任务分块（★ 2026-09-29，教师批图 1）───────────────────────── */

test('🔴 每行带上它的任务名与**组内序号**（矩阵按任务分块要用的两格）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1')]),
    [node('q1'), task('t1', '任务一', [node('q2'), node('q3')]), node('q4')],
    {},
  );
  assert.deepEqual(rows.map((r) => r.questionId), ['q1', 'q2', 'q3', 'q4']);
  // 散题那两行的任务名是 `null`（它们不属于任何任务），不是空串 —— 空串当任务名会画出一个空标题行。
  assert.deepEqual(rows.map((r) => r.taskTitle), [null, '任务一', '任务一', null]);
  // ⚠️ 散题那个**跨全文**的计数器：q4 是 `2`，不是它那一段里的第 1 个。
  assert.deepEqual(rows.map((r) => r.label), ['1', '1', '2', '2']);
});

test('🔴 组内序号与两级题号同源（同一行的 `heading` 尾巴就是 `label`）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1')]),
    [task('t1', '任务一', [node('q1'), node('q2')]), node('q3')],
    {},
  );
  for (const row of rows) {
    assert.ok(row.heading === row.label || row.heading.endsWith(` · ${row.label}`), `${row.heading} / ${row.label}`);
  }
});

test('🔴 matrixGroups：任务名**只出现一次**（连续同任务的行合成一组）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1')]),
    [task('t1', '任务一', [node('q1'), node('q2')]), task('t2', '任务二', [node('q3')])],
    {},
  );
  const groups = matrixGroups(rows);
  assert.deepEqual(groups.map((g) => g.taskTitle), ['任务一', '任务二']);
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.questionId)), [['q1', 'q2'], ['q3']]);
  // ⚠️ 行一个都不能丢、也不能重复 —— 上面那两条断言在「漏一行」时可能凑巧还成立。
  assert.equal(groups.reduce((sum, g) => sum + g.rows.length, 0), rows.length);
});

test('🔴 matrixGroups：散题 A、任务一、散题 B ⇒ **三组**（中间隔着任务就不算同一段）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1')]),
    [node('q1'), task('t1', '任务一', [node('q2')]), node('q3')],
    {},
  );
  const groups = matrixGroups(rows);
  assert.deepEqual(groups.map((g) => g.taskTitle), [null, '任务一', null]);
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.questionId)), [['q1'], ['q2'], ['q3']]);
});

test('matrixGroups：全是散题 ⇒ 一组（一个无标题的段头都不画）', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [node('q1'), node('q2')], {});
  const groups = matrixGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].taskTitle, null);
  assert.equal(groups[0].rows.length, 2);
});

test('matrixGroups：没有题 ⇒ 零组（不画一个空的段头）', () => {
  assert.deepEqual(matrixGroups([]), []);
});

test('🔴 matrixGroups：**空任务**不产生段头（它一行都没有）', () => {
  // 教师 2026-09-25 裁定「允许空任务」：编辑器里是一块可以往里加东西的地方。
  // 而矩阵这一侧一个空任务画出来是「一行标题、下面什么都没有」= 渲染坏了的长相。
  const rows = buildWorksheetMatrix(
    sheet([participant('p1')]),
    [task('t0', '空任务', []), task('t1', '任务一', [node('q1')])],
    {},
  );
  assert.deepEqual(matrixGroups(rows).map((g) => g.taskTitle), ['任务一']);
});

test('matrixGroups：标题留空的任务 ⇒ 段头是 `null`（那一行不画标题，与学生端同一口径）', () => {
  const rows = buildWorksheetMatrix(sheet([participant('p1')]), [task('t1', '   ', [node('q1')])], {});
  assert.equal(rows[0].taskTitle, null);
  assert.deepEqual(matrixGroups(rows).map((g) => g.taskTitle), [null]);
});

test('🔴 matrixGroups 与行**同一份状态**（分组不改格子、不改「已交」计数）', () => {
  const rows = buildWorksheetMatrix(
    sheet([participant('p1', { q1: 'submitted' })]),
    [task('t1', '任务一', [node('q1'), node('q2')])],
    {},
  );
  const groups = matrixGroups(rows);
  assert.equal(groups[0].rows[0].cells.p1, 'submitted');
  assert.deepEqual(rowTally(groups[0].rows[0]).submitted, 1);
});
