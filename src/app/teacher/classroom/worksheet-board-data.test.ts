import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetBoard, WorksheetBoardAnswerRow } from '../../../lib/types';
import { applyLiveRows, mergeProgress, restProgress, type LiveRowPatch } from './worksheet-board-data.ts';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state.ts';

/**
 * 把**历史读端点的快照**换算成看板格子的进度（`ParticipantWorksheetProgress`）。
 *
 * 🔴 这个文件是「第 1 条（格子失忆）」的修法本体：格子此前只吃广播，所以教师刷新一次
 * 页面全班就掉回「还没收到作答」。换成「REST 当底 + 广播当增量」之后，底这一份就由
 * 本函数产出 —— 而它每一条错了都**不报错**，只会让格子上那几个字说错话。
 *
 * ── 最要紧的一条：跨时钟相减（★ 2026-09-28）────────────────────────────
 * 作答行上的 `savedAt` 是**服务端**时间，而看板判「停住了」用的是**浏览器**时钟
 * （`now - lastAt`，那只 30 秒「会走的表」也是浏览器时钟）。
 *
 * 🔴 直接把服务端时间戳塞进 `lastAt` 会**静默**算错：教师那台机器的时钟若偏了 5 分钟，
 * 一个刚刚在答题的学生会立刻显示成「停住了 5 分钟」，而屏幕上没有任何东西像坏了。
 *
 * 修法：`serverNow` 与 `savedAt` **都是服务端时间** ⇒ 相减得到的**时长**与两个时钟的
 * 偏差无关；再把这个时长从**浏览器**的收报时刻往回推，就把它换算进了浏览器时钟。
 * 全程只做减法，不需要知道两边的时区或偏差。
 */

const TABLE = new Date('2026-09-28T12:00:00.000Z');

function row(over: Partial<WorksheetBoardAnswerRow> & { questionId: string }): WorksheetBoardAnswerRow {
  return {
    status: 'draft', isCorrect: null, gradeState: null, score: null,
    reviewedAt: null, value: null,
    createdAt: null, savedAt: null, saveCount: null,
    ...over,
  };
}

function board(
  answerRows: WorksheetBoardAnswerRow[],
  serverNow: string | null = TABLE.toISOString(),
): WorksheetBoard {
  return {
    classroomId: 'c1',
    serverNow,
    worksheets: [{
      id: 'w1',
      title: '光合作用',
      participants: [{ participantId: 'p1', name: '花荣', kind: 'student', groupName: null, answerRows }],
    }],
  };
}

/**
 * 🔴 **本文件最重要的一条**：两个时钟差了好几个小时（服务端 2026-09-28、浏览器
 * `1_700_000_000_000` 是 2023 年），而结论必须**逐字不变**。
 *
 * 这正是「直接塞时间戳」那种写法会挂的地方 —— 而它挂起来是静默的（只是屏幕上多一个
 * 「停住了」），所以必须有一条用例专门钉它。
 */
test('🔴 跨时钟：服务端与浏览器时钟差了好几年，换算出来的「距上次保存」仍是 5 分钟', () => {
  const BROWSER_NOW = 1_700_000_000_000;              // 2023 年（浏览器时钟）
  const savedAt = new Date(TABLE.getTime() - 5 * 60 * 1000).toISOString(); // 服务端：12:00 之前的 5 分钟

  const progress = restProgress(board([row({ questionId: 'q1', savedAt })]), BROWSER_NOW);

  const lastAt = progress.p1.lastAt;
  assert.notEqual(lastAt, null, 'savedAt 在场 ⇒ lastAt 必须算得出来');
  // 🔴 判据不是「lastAt 等于某个具体数」，而是**换算回浏览器时钟之后，那个差值仍然是 5 分钟**。
  assert.equal(
    BROWSER_NOW - lastAt!,
    5 * 60 * 1000,
    '🔴 距上次保存必须是 5 分钟 —— 把服务端时间戳直接当 lastAt 会让这个数变成「负数十年」',
  );
  // 阳性对照：这个数**落在浏览器时钟的尺度上**（分钟级），而不是一个服务端时间戳
  // （那会与 BROWSER_NOW 差几十年）。少了它，「把服务端时间戳直接当 lastAt」那种写法
  // 有可能因为两边都是大整数而在上面那条减法里**碰巧**凑出个看起来像的差值。
  // ⚠️ 不断言「小于阈值」：这一条恰好**等于** 5 分钟，而阈值是「**严格大于**才算停住了」
  //（那条边界由 `worksheet-tile-state.test.ts` 单独钉着，别在这里重复它的口径）。
  assert.ok(
    Math.abs(BROWSER_NOW - lastAt!) < 60 * 60 * 1000,
    '换算结果必须是「分钟级」的 —— 与服务端时间戳直接相减会得到几十年（1.7e12 量级）',
  );
});

test('阳性对照：服务端说「刚保存过」⇒ 换算回浏览器时钟也是 0 分钟（不是几十年）', () => {
  const BROWSER_NOW = 1_700_000_000_000;
  const progress = restProgress(board([row({ questionId: 'q1', savedAt: TABLE.toISOString() })]), BROWSER_NOW);
  assert.equal(BROWSER_NOW - progress.p1.lastAt!, 0, '刚刚保存 ⇒ 距上次保存 0');
});

test('lastQuestionId 取 savedAt **最大的那一行**，不是数组里的最后一个', () => {
  const older = new Date(TABLE.getTime() - 60_000).toISOString();
  const newer = new Date(TABLE.getTime() - 1_000).toISOString();
  // ⚠️ 故意的顺序：**新的那一行排在前面**。按数组顺序取会得到 q2，而那是错的。
  const progress = restProgress(board([
    row({ questionId: 'q1', status: 'submitted', savedAt: newer }),
    row({ questionId: 'q2', status: 'draft', savedAt: older }),
  ]), 1_700_000_000_000);
  assert.equal(progress.p1.lastQuestionId, 'q1', '取的是最近保存的那一题');
  assert.equal(1_700_000_000_000 - progress.p1.lastAt!, 1_000, 'lastAt 也跟着那一行走');
});

test('cells 收 draft / submitted；认不出的状态**丢掉**（不猜）', () => {
  const progress = restProgress(board([
    row({ questionId: 'q1', status: 'draft' }),
    row({ questionId: 'q2', status: 'submitted' }),
    row({ questionId: 'q3', status: 'unanswered' }),
    row({ questionId: 'q4', status: '看起来像新的状态' }),
  ]), 1_700_000_000_000);
  // ⚠️ `unanswered` 是**有行但没动**，它在格子上与「没有行」长得一样（都是灰的），
  // 所以这里丢掉它是对的 —— 格子只编码「作答中 / 已提交」两种已知状态。
  assert.deepEqual(progress.p1.cells, { q1: 'draft', q2: 'submitted' });
});

/**
 * 🔴 **「不知道」必须留在「不知道」那一档。**
 *
 * 旧行的 `savedAt` 是 `null`（那一列上线之前落库的行，`ensureWorksheetAnswerColumns`
 * 刻意不回填）。三种写法都是错的，而且都不报错：
 *   · 当成「刚刚」（`lastAt = 现在`）⇒ 永远不报「停住了」；
 *   · 当成一个数（`now - null` = `now`）⇒ **立刻**报「停住了」，教师去救一个不需要救的人；
 *   · 拿**浏览器的**收报时刻去减服务端时间戳 ⇒ 上面那条跨时钟的错。
 * 所以：`lastAt = null`。
 */
test('🔴 savedAt 全是 null（旧行）⇒ lastAt 必须是 null，但 cells 照常给', () => {
  const progress = restProgress(board([
    row({ questionId: 'q1', status: 'draft' }),
    row({ questionId: 'q2', status: 'submitted' }),
  ]), 1_700_000_000_000);
  assert.equal(progress.p1.lastAt, null, '🔴 不知道多久没动了 —— 不许编一个数');
  assert.equal(progress.p1.lastQuestionId, null, '同样不知道「最后一次是哪一题」');
  assert.deepEqual(progress.p1.cells, { q1: 'draft', q2: 'submitted' }, '但「哪几题答过」是知道的，照给');
});

/**
 * 🔴 旧服务端、或字段被中间层剥掉时：`serverNow` 不在 ⇒ **不许**退化成
 * 「拿浏览器的收报时刻去减服务端的 savedAt」。那条路在时钟有偏差时会静默算错，
 * 而这里的正确做法只有一个：置 `null`（不编）。
 */
test('🔴 serverNow 缺失或读不出来 ⇒ lastAt 是 null（**不许**拿浏览器时钟去减服务端时间戳）', () => {
  const savedAt = new Date(TABLE.getTime() - 5 * 60 * 1000).toISOString();
  for (const serverNow of [null, '', '不是时间']) {
    const progress = restProgress(board([row({ questionId: 'q1', savedAt })], serverNow), 1_700_000_000_000);
    assert.equal(progress.p1.lastAt, null, `serverNow=${JSON.stringify(serverNow)} 时必须置 null，不许猜`);
  }
});

test('一行作答都没有的参与者：cells 空、lastQuestionId 与 lastAt 都是 null', () => {
  const progress = restProgress(board([]), 1_700_000_000_000);
  assert.deepEqual(progress.p1, { cells: {}, lastQuestionId: null, lastAt: null });
});

test('多个参与者各算各的（键是 participantId）', () => {
  const b = board([]);
  b.worksheets[0].participants.push({
    participantId: 'p2', name: '李四', kind: 'student', groupName: null,
    answerRows: [row({ questionId: 'q9', status: 'submitted', savedAt: TABLE.toISOString() })],
  });
  const progress = restProgress(b, 1_700_000_000_000);
  assert.deepEqual(Object.keys(progress).sort(), ['p1', 'p2']);
  assert.deepEqual(progress.p1.cells, {});
  assert.deepEqual(progress.p2.cells, { q9: 'submitted' });
});

/* ── mergeProgress：广播与快照谁赢 ────────────────────────────────────── */

const P = (
  cells: Record<string, 'draft' | 'submitted'>,
  lastQuestionId: string | null,
  lastAt: number | null,
): ParticipantWorksheetProgress => ({ cells, lastQuestionId, lastAt });

/**
 * 🔴 **下界（`snapshotAt`）是这一对函数里最容易漏的一件东西**，而漏了它
 * 屏幕上看起来完全正常 —— 只是那几格**永远**停在旧状态，直到教师手动刷新。
 *
 * 场景（矩阵那边实测过的那个）：教师这台机器的 socket 断线了 5 分钟，期间学生提交了；
 * 重连后 30 秒重拉，REST 明确说 `submitted`，而 `live` 里断线前那条 `draft` 还在。
 * 没有下界 ⇒ 琥珀永远不褪。
 */
test('🔴 广播在快照**发起之前**到达 ⇒ 不采信它，用 REST（否则那一格永远停在旧状态）', () => {
  const SNAPSHOT_AT = 1_000_000;
  const merged = mergeProgress(
    { p1: P({ q1: 'submitted' }, 'q1', SNAPSHOT_AT) },
    { p1: P({ q1: 'draft' }, 'q1', SNAPSHOT_AT - 5_000) },   // 断线前收到的那条
    SNAPSHOT_AT,
  );
  assert.deepEqual(merged.p1.cells, { q1: 'submitted' }, '陈旧的那条广播不许赢');
  assert.equal(merged.p1.lastQuestionId, 'q1');
});

test('阳性对照：广播在快照**发起之后**到达 ⇒ 广播赢（那是更新的一次动作）', () => {
  const SNAPSHOT_AT = 1_000_000;
  const merged = mergeProgress(
    { p1: P({ q1: 'draft' }, 'q1', SNAPSHOT_AT) },
    { p1: P({ q1: 'submitted', q2: 'draft' }, 'q2', SNAPSHOT_AT + 1) },
    SNAPSHOT_AT,
  );
  assert.deepEqual(merged.p1.cells, { q1: 'submitted', q2: 'draft' });
  assert.equal(merged.p1.lastQuestionId, 'q2', '「正在做第几题」也要跟着广播走');
});

test('边界：广播恰好**等于**下界 ⇒ 不采信（`>` 不是 `>=`）', () => {
  const SNAPSHOT_AT = 1_000_000;
  const merged = mergeProgress(
    { p1: P({ q1: 'submitted' }, 'q1', SNAPSHOT_AT) },
    { p1: P({ q1: 'draft' }, 'q1', SNAPSHOT_AT) },
    SNAPSHOT_AT,
  );
  assert.deepEqual(merged.p1.cells, { q1: 'submitted' });
});

test('🔴 广播里出现快照之外的参与者 ⇒ **不造列**（两边各造一套「谁在班里」必然分叉）', () => {
  const merged = mergeProgress(
    { p1: P({}, null, null) },
    { p1: P({ q1: 'draft' }, 'q1', 2_000_000), p_new: P({ q1: 'draft' }, 'q1', 2_000_000) },
    1_000_000,
  );
  assert.deepEqual(Object.keys(merged), ['p1'], '课中途加入的人等下一轮 30 秒重拉');
});

test('live 的 lastAt 是 null（不知道什么时候到的）⇒ 一律不信，用 REST', () => {
  const SNAPSHOT_AT = 1_000_000;
  const merged = mergeProgress(
    { p1: P({ q1: 'submitted' }, 'q1', SNAPSHOT_AT) },
    { p1: P({ q1: 'draft' }, 'q1', null) },
    SNAPSHOT_AT,
  );
  assert.deepEqual(merged.p1.cells, { q1: 'submitted' });
});

test('广播里没有这个参与者 ⇒ 用 REST（没收到广播 ≠ 把这一格清空）', () => {
  const merged = mergeProgress({ p1: P({ q1: 'submitted' }, 'q1', 5) }, {}, 1_000_000);
  assert.deepEqual(merged.p1.cells, { q1: 'submitted' });
});

/* ── applyLiveRows：把广播的内容逐行补进快照（抽屉读这一份）────────────── */

const patch = (over: Partial<LiveRowPatch> & { lastArrivedAt: number | null }) => ({
  status: 'draft' as const, value: null, valueOmitted: false, savedAt: null, saveCount: null,
  ...over,
});

test('★ 按行打补丁：广播那一行被更新，其余行**一个字都不动**', () => {
  const b = board([
    row({ questionId: 'q1', status: 'draft', value: { format: 'text/v1', text: '旧' } }),
    row({ questionId: 'q2', status: 'draft', value: { format: 'text/v1', text: '别动我' } }),
  ]);
  const out = applyLiveRows(b, {
    p1: { q1: patch({ status: 'submitted', value: { format: 'text/v1', text: '新' }, lastArrivedAt: 2_000_000, saveCount: 3 }) },
  }, 1_000_000);
  const rows = out.worksheets[0].participants[0].answerRows;
  assert.equal(rows[0].status, 'submitted', 'q1 跟着广播走');
  assert.deepEqual(rows[0].value, { format: 'text/v1', text: '新' }, '内容也要跟着走（乙档的意义）');
  assert.equal(rows[0].saveCount, 3);
  assert.deepEqual(rows[1], b.worksheets[0].participants[0].answerRows[1], 'q2 一个字都不许动');
});

test('🔴 下界同源：广播早于快照 ⇒ 不打补丁（否则格子与抽屉会各说各话）', () => {
  const b = board([row({ questionId: 'q1', status: 'submitted', value: { format: 'text/v1', text: '快照里的' } })]);
  const out = applyLiveRows(b, {
    p1: { q1: patch({ status: 'draft', value: { format: 'text/v1', text: '陈旧的' }, lastArrivedAt: 999_000 }) },
  }, 1_000_000);
  assert.equal(out.worksheets[0].participants[0].answerRows[0].status, 'submitted', '陈旧广播不许赢');
  assert.deepEqual(out.worksheets[0].participants[0].answerRows[0].value, { format: 'text/v1', text: '快照里的' });
});

/**
 * 🔴 **`valueOmitted` 不许把快照里的内容抹掉。**
 * 那会把「内容较大，没有随广播下发」变成「他什么都没写」—— 而这两种在屏幕上
 * 长得一模一样（都是空白），意思却相反。快照里那一份（可能略旧）至少是真的。
 */
test('🔴 valueOmitted：保留快照里的内容，不覆盖成 null', () => {
  const b = board([row({ questionId: 'q1', status: 'draft', value: { format: 'text/v1', text: '快照里有一份' }, saveCount: 1 })]);
  const out = applyLiveRows(b, {
    p1: { q1: patch({ value: null, valueOmitted: true, saveCount: 2, lastArrivedAt: 2_000_000 }) },
  }, 1_000_000);
  const got = out.worksheets[0].participants[0].answerRows[0];
  assert.deepEqual(got.value, { format: 'text/v1', text: '快照里有一份' }, '🔴 内容照旧，不许被 null 顶掉');
  assert.equal(got.saveCount, 2, '但次数/时间照常更新（它们不超限）');
});

test('🔴 广播里有快照之外的行 ⇒ 不造行（会指向一个屏幕上不存在的题）', () => {
  const b = board([row({ questionId: 'q1' })]);
  const out = applyLiveRows(b, {
    p1: { gone: patch({ lastArrivedAt: 2_000_000, value: 'x' }) },
  }, 1_000_000);
  assert.equal(out.worksheets[0].participants[0].answerRows.length, 1, '不造行');
});

test('快照里没有这个参与者 ⇒ 原样返回（不造人）', () => {
  const b = board([row({ questionId: 'q1' })]);
  const out = applyLiveRows(b, { p_new: { q1: patch({ lastArrivedAt: 2_000_000 }) } }, 1_000_000);
  assert.deepEqual(out, b);
});
