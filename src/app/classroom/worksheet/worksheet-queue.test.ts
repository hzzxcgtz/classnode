/**
 * `worksheet-queue.ts` 的逐条断言 —— 学习单离线队列的**唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/app/classroom/worksheet/worksheet-queue.test.ts
 * ```
 *
 * ⚠️ **能跑到的只有纯逻辑**：本仓没有 jsdom，所以「真断网时那个 `online` 事件有没有
 * 接上」「flush 有没有在提交前跑完」这两件事，这里**一条都断言不了**（它们长在
 * `use-worksheet-answers.ts` 的 effect 里）。本文件管的是另一半：**哪一条该丢、哪一条该留**
 * —— 那一条错了不报错，只会让队列永远重放同一条，或者把学生的作答悄悄扔掉。
 *
 * 下面带 🔴 的几条是**反向断言**：把对应实现改坏，它们必须变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  shouldFlushOnLockChange,
  dropQueueItem,
  hydrateAnswers,
  isPermanentFailure,
  permanentFailureMessage,
  readCorrectBlanks,
  readQueue,
  replayOrder,
  scoreFromWire,
  sessionExpiredMessage,
  upsertQueueItem,
  worksheetQueueKey,
  writeQueue,
  type QueueStorage,
  type SavedAnswerRow,
  type WorksheetQueueItem,
} from './worksheet-queue.ts';
// ⚠️ `import type`：类型擦除会整段删掉它，所以这个**不带 `.ts` 后缀**的相对路径
// 不影响本文件被 `node --test` 直接执行（与 `worksheet-queue.ts` 里那条同源）。
import type { WorksheetQuestionNode } from '../../../lib/types';

// ── 脚手架 ──────────────────────────────────────────────────────────────

/** 内存替身。`setItem` 也记进 `calls`，用来断言「空队列删键」这条。 */
function memoryStorage(seed?: string): QueueStorage & { calls: string[]; raw: () => string | null } {
  let value: string | null = seed ?? null;
  const calls: string[] = [];
  return {
    calls,
    raw: () => value,
    getItem() { calls.push('get'); return value; },
    setItem(_key, next) { calls.push('set'); value = next; },
    removeItem() { calls.push('remove'); value = null; },
  };
}

const item = (questionId: string, at: number, value: WorksheetQueueItem['value'] = null): WorksheetQueueItem =>
  ({ questionId, at, value });

// ── 1. 🔴 永久失败 / 暂时失败的分界（本模块唯一不能含糊的规则）────────────

test('🔴 isPermanentFailure：4xx 是永久（含 409），5xx 与网络错误是暂时', () => {
  // 4xx：服务端说「这条请求本身不该被接受」—— 重放一万次也是同一个答案。
  assert.equal(isPermanentFailure(400), true);
  assert.equal(isPermanentFailure(403), true);
  assert.equal(isPermanentFailure(409), true, '409 是 allowResubmit:false 的那条，必须算永久');
  assert.equal(isPermanentFailure(422), true);
  // 5xx：服务端此刻处理不了，但这条作答没错。
  assert.equal(isPermanentFailure(500), false);
  assert.equal(isPermanentFailure(502), false);
  assert.equal(isPermanentFailure(503), false);
  // 网络错误 / 断网：连状态码都没有，只能算暂时。
  assert.equal(isPermanentFailure(null), false);
});

test('🔴 反向断言：把 5xx 也算成永久 ⇒ 上一条红', () => {
  // 这条不是重复：它钉住的是「>= 400 一刀切」这个最自然的错法。
  // 一刀切之后，服务端重启 / 一次 502 就会**丢掉学生已经写好的作答**。
  const tooBroad = (status: number | null) => status !== null && status >= 400;
  assert.notEqual(tooBroad(503), isPermanentFailure(503));
  assert.notEqual(tooBroad(500), isPermanentFailure(500));
  // ⚠️ 网络错误（null）不是这条反证的判别点：两种写法在它上面**恰好都**是 false。
  // 它的判据在 `readQueue` 那一组（队列留下来 ⇒ 才有重试的机会）。
  assert.equal(tooBroad(null), isPermanentFailure(null));
});

test('permanentFailureMessage：优先用服务端那句，拿不到才回落；409 有专门的一句', () => {
  assert.equal(permanentFailureMessage(409, '老师已设置本题提交后不可修改'), '老师已设置本题提交后不可修改');
  assert.match(permanentFailureMessage(409, null), /不可修改/);
  assert.match(permanentFailureMessage(400, null), /400/);
  // 服务端那句是空串时也算「没有」——空串当消息用就是一句无声的提示。
  assert.match(permanentFailureMessage(400, ''), /400/);
});

// ── 1b. 🔴 401（会话过期）不是永久失败（本模块第二要害）──────────────────

/**
 * 「出队吗」——**唯一**的判据复刻自 `use-worksheet-answers.ts` 的 flush 循环：
 * 只有 `classifyFailure(...) === 'permanent'` 那一支会 `dropQueueItem`。
 *
 * ⚠️ 这里的 `drops` 必须与被测实现共用 `classifyFailure` 本身。若测试自己写一遍
 * `status >= 400`，它就会在实现把 401 归回 permanent 时**照样通过** —— 一条不看实现的假绿。
 */
const drops = (status: number | null, code?: string | null): boolean =>
  classifyFailure(status, code) === 'permanent';

test('🔴 401 不出队（会话过期），409 仍出队（阳性对照）', () => {
  // 401：服务端的学生 token 用**每进程随机**的密钥签（`middleware/student-auth.ts` 的
  // `crypto.randomBytes(32)`）⇒ **服务端每重启一次，所有学生 token 立刻失效**。
  // 也就是说 401 的成因全在服务端，与这道题的答案毫无关系 ——
  // 按「4xx 一律永久」处置就是把学生的作答**真的删掉**，而提示还是说给教师的
  // 「教师会话已失效，请重新登录」（`middleware/auth.ts`）。谎话 + 真丢数据。
  assert.equal(drops(401), false, '会话过期一出队，那条作答就真没了 —— 队列才是唯一的那份');
  assert.equal(classifyFailure(401), 'session-expired');
  // ★ 阳性对照：409（`allowResubmit: false`）是 B3 定下的契约，**必须仍然出队**。
  // 没有这一条，把 `classifyFailure` 改成「永不丢弃」也能让上面那句变绿。
  assert.equal(drops(409), true, '409 必须仍然是永久失败，否则队列会被一条被拒的作答永久堵死');
  assert.equal(drops(400), true);
  assert.equal(drops(403), true);
  // 5xx / 网络错误本来就是暂时，这条顺带钉住「别顺手把 5xx 也归进 permanent」。
  assert.equal(drops(500), false);
  assert.equal(drops(null), false);
});

test('🔴 反向断言：把 401 归回「永久失败」⇒ 上一条红', () => {
  // 这不是重复：它钉住的正是修好之前那段代码的形状 ——「4xx 一律永久」。
  const legacy = (status: number | null): 'permanent' | 'transient' =>
    (status !== null && status >= 400 ? 'permanent' : 'transient');
  assert.equal(legacy(401), 'permanent', '这就是回退后的样子');
  assert.notEqual(legacy(401), classifyFailure(401), '回退 ⇒ 这一条必须红');
  // ⚠️ 409 在回退前后**恰好相同**：它是这条反证的阴性对照 ——
  // 别把「挡住回退」写成「凡 409 都特殊」。
  assert.equal(legacy(409), classifyFailure(409));
});

test('会话过期的提示说「刷新页面」，且**不是**服务端那句说给教师听的话', () => {
  const message = sessionExpiredMessage();
  assert.match(message, /刷新/);
  // ⚠️ 服务端在 401 里给的原话（`middleware/auth.ts`）是「教师会话已失效，请重新登录」。
  // 学生没有教师会话可登，照抄就是把教师那套词安在学生头上。
  assert.doesNotMatch(message, /教师会话|重新登录/);
  // 阳性对照：永久失败那条路的文案**没有被顺手改掉**（409 仍用服务端原话）。
  assert.equal(permanentFailureMessage(409, '老师已设置本题提交后不可修改'), '老师已设置本题提交后不可修改');
});

// ── 1c. ★ M5a：课堂锁定（`code: 'answers-locked'`）是**第四档**，不出队 ──────

/**
 * 🔴 **锁定绝不能被归进 `'permanent'`。**
 *
 * 老师在课上按下「锁定作答」之后，学生每一次保存都会吃到
 * `409 { code: 'answers-locked' }`（`routes/worksheets.ts` 的 PUT 门控）。
 * 按 4xx 一律永久处置的后果是**学生在锁定之前写的、还没发出去的作答被静默丢掉** ——
 * 而 `localStorage` 里那份是**唯一**的一份（GC 21）。
 *
 * ⚠️ 必须与下面那条 409 **分开**：`allowResubmit: false` 的 409 同样要出队（重试没用），
 * 而锁定只是**暂时**的 —— 老师会解锁，解锁后队列要继续发。两者状态码相同、
 * 处置相反 ⇒ 判据只能落在 `code` 上。
 */
test('🔴 M5a：锁定的 409 不出队（`code` 是唯一判据）', () => {
  assert.equal(drops(409, 'answers-locked'), false, '一出队，学生锁定前写的东西就真没了');
  assert.equal(classifyFailure(409, 'answers-locked'), 'locked');
});

test('★ M5a：阳性对照 —— 不带 code 的 409 必须仍然出队', () => {
  // 没有这一条，把 `classifyFailure` 改成「凡 409 都保留」也能让上一条变绿，
  // 而那会让一条被永久拒绝的作答把队列永远堵住。
  assert.equal(drops(409), true, '`allowResubmit: false` 那条 409 没有 code，必须仍然出队');
  assert.equal(drops(409, null), true);
});

test('M5a：认不出的 code 不影响原判据（只增不改）', () => {
  assert.equal(classifyFailure(409, 'nobody-knows'), 'permanent', '将来的新 code 不该被这一档吃掉');
  assert.equal(classifyFailure(400, 'answers-locked'), 'locked', 'code 优先于状态码 —— 钉住实现里那句判断的顺序');
  assert.equal(classifyFailure(500, 'answers-locked'), 'locked', '同上：判据排在状态码分支之前');
  // 老客户端不传第二个参数的既有行为逐字不变。
  assert.equal(classifyFailure(401), 'session-expired');
  assert.equal(classifyFailure(null), 'transient');
});

// ── 1d. ★ M5a：锁态**翻转**时该不该立刻试发一次（两个沿都要）──────────────

/**
 * 🔴 **两个沿都要，只有上升沿是漏的。**
 *
 * 上升沿（未锁 → 锁）：救「广播还在路上、队列先到」那一档。
 * 下降沿（锁 → 未锁）：规格 §3.3 逐字写着「队列条目留在 `localStorage`，**解锁后继续重发**」。
 *
 * ⚠️ 少了下降沿的后果**不是**数据丢失（条目还在、刷新/再敲一个字都会发出去），
 * 而是一段**长度不受限的未同步窗口**：学生屏幕上是他刚写的那几个字，而库里是旧的 ——
 * 学生从屏幕上分不清哪部分存住了。那正是规格 §3.3 的修正条款（R6）专门要消灭的那件事。
 */
test('🔴 M5a：锁态翻转**两个沿**都要试发（有积压时）', () => {
  assert.equal(shouldFlushOnLockChange(false, true, 1), true, '上升沿：广播可能还在路上，先试一次');
  assert.equal(shouldFlushOnLockChange(true, false, 1), true, '下降沿：解锁后必须继续重发（规格 §3.3）');
});

test('M5a：没有翻转就不试发（免得每轮渲染都白打一次服务端）', () => {
  assert.equal(shouldFlushOnLockChange(false, false, 3), false);
  assert.equal(shouldFlushOnLockChange(true, true, 3), false);
});

test('M5a：队列空时不试发（没有东西可发）', () => {
  assert.equal(shouldFlushOnLockChange(false, true, 0), false);
  assert.equal(shouldFlushOnLockChange(true, false, 0), false);
});

test('★ M5a 反证：只认上升沿（也就是修好之前那段代码）⇒ 下降沿那条必红', () => {
  // 这就是那个 bug 的形状：`isLocked && !wasLocked && …`
  const risingEdgeOnly = (wasLocked: boolean, isLocked: boolean, pendingCount: number): boolean =>
    isLocked && !wasLocked && pendingCount > 0;
  assert.equal(risingEdgeOnly(false, true, 1), true, '上升沿两种写法一样');
  assert.notEqual(risingEdgeOnly(true, false, 1), shouldFlushOnLockChange(true, false, 1),
    '下降沿必须能区分出「修好了」与「没修」');
});

// ── 2. 队列的增删与覆盖 ─────────────────────────────────────────────────

test('同题只留一条：后一次作答覆盖前一次', () => {
  const first = upsertQueueItem([], { questionId: 'q1', value: { format: 'fill/v1', text: '光合' }, at: 100 });
  const second = upsertQueueItem(first, { questionId: 'q1', value: { format: 'fill/v1', text: '光合作用' }, at: 200 });
  assert.equal(second.length, 1);
  assert.deepEqual(second[0].value, { format: 'fill/v1', text: '光合作用' });
  assert.equal(second[0].at, 200);
});

test('不同题各留一条；出队只摘掉点名的那一道', () => {
  let items = upsertQueueItem([], item('q1', 100));
  items = upsertQueueItem(items, item('q2', 200));
  items = upsertQueueItem(items, item('q3', 300));
  assert.deepEqual(items.map((row) => row.questionId), ['q1', 'q2', 'q3']);

  const after = dropQueueItem(items, 'q2');
  assert.deepEqual(after.map((row) => row.questionId), ['q1', 'q3']);
  // 不改原数组（React 的 state 更新依赖这一点）。
  assert.equal(items.length, 3);
});

test('🔴 replayOrder：按 at 升序，而不是数组顺序', () => {
  // 构造出「数组顺序与动手顺序相反」的局面：同题覆盖是「先删后加」，
  // 被覆盖的那一条会跑到数组末尾，而它其实是最早动手的。
  const items = [item('q9', 300), item('q1', 100), item('q5', 200)];
  assert.deepEqual(replayOrder(items).map((row) => row.questionId), ['q1', 'q5', 'q9']);
  // 不改原数组。
  assert.deepEqual(items.map((row) => row.questionId), ['q9', 'q1', 'q5']);
});

// ── 3. 存储的读写与容错 ─────────────────────────────────────────────────

test('writeQueue：队列空 ⇒ 删键，不留一条 [] 在存储里', () => {
  const storage = memoryStorage();
  writeQueue(storage, 'k', [item('q1', 1)]);
  assert.ok(storage.raw());
  writeQueue(storage, 'k', []);
  assert.equal(storage.raw(), null);
  assert.deepEqual(storage.calls, ['set', 'remove']);
});

test('readQueue：坏 JSON / 不是数组 ⇒ 空队列，不抛', () => {
  assert.deepEqual(readQueue(memoryStorage('{不是 JSON'), 'k'), []);
  assert.deepEqual(readQueue(memoryStorage('{"a":1}'), 'k'), []);
  assert.deepEqual(readQueue(memoryStorage(), 'k'), []);
});

test('🔴 readQueue：坏条目被丢掉，**同一条队列里的好条目必须留下**', () => {
  const payload = JSON.stringify([
    { questionId: 'q1', value: { format: 'text/v1', text: '甲' }, at: 100 },
    { questionId: '', at: 200 },            // 题号空 ⇒ 丢
    { questionId: 'q3', at: 'soon' },        // at 不是数 ⇒ 丢
    null,                                    // 不是对象 ⇒ 丢
    { questionId: 'q5', value: null, at: 500 },
  ]);
  const items = readQueue(memoryStorage(payload), 'k');
  // **丢一条坏行不该把同一名学生还没发出去的其它作答一起作废** —— 这是本节的要害。
  assert.deepEqual(items.map((row) => row.questionId), ['q1', 'q5']);
});

test('🔴 readQueue：清空标记（value: null）必须活着穿过存储', () => {
  // 它被读成 undefined 的话，重放时那一题会被**跳过**（而不是清空），
  // 学生删掉的内容会留在服务端 —— 一次静默的「没反应」。
  const items = readQueue(memoryStorage(JSON.stringify([item('q1', 100, null)])), 'k');
  assert.equal(items.length, 1);
  assert.equal(items[0].value, null);
});

test('读-写往返无损（含三种格式与清空标记）', () => {
  const original: WorksheetQueueItem[] = [
    { questionId: 'q1', value: { format: 'choice/v1', selected: ['B'] }, at: 1 },
    { questionId: 'q2', value: { format: 'fill/v1', text: '光合作用' }, at: 2 },
    { questionId: 'q3', value: { format: 'text/v1', text: '因为…所以…' }, at: 3 },
    { questionId: 'q4', value: null, at: 4 },
  ];
  const storage = memoryStorage();
  writeQueue(storage, 'k', original);
  assert.deepEqual(readQueue(storage, 'k'), original);
});

// ── 4. 键的维度 ─────────────────────────────────────────────────────────

test('🔴 队列键同时含课堂与参与者：换学生 / 换课堂就是另一条队列', () => {
  const base = worksheetQueueKey('c1', 'p1');
  assert.notEqual(base, worksheetQueueKey('c1', 'p2'), '同一台 iPad 上换学生必须换队列');
  assert.notEqual(base, worksheetQueueKey('c2', 'p1'), '同一个学生进另一个课堂必须换队列');
  assert.equal(base, worksheetQueueKey('c1', 'p1'), '同键必须稳定（否则下一次挂载读不回来）');
  assert.match(base, /^worksheet-queue:c1:p1$/);
});

// ── 5. 🔴 服务端回读的水合（「做了一半刷新，做好的题没了」）──────────────

/**
 * 这一段钉的是本模块**最新**的一处要害：服务端已经有了这名学生的作答
 * （`GET /api/worksheets/:id/answers`），刷新后必须把它填回输入框。
 *
 * 三条不变量，每条一个用例：
 *   ① 服务端那一行 ⇒ 输入框有内容、状态芯片对、得分也在（奖励因此撑得过刷新）；
 *   ② 🔴 **队列赢** —— 队列里那一题有**更新的、还没发出去的**改动，服务端的旧值
 *      绝不能覆盖它。这一条错了的表现是「学生刚改完，一刷新又变回旧答案」。
 *   ③ 队列里的「清空」标记（`value: null`）同样赢过服务端的旧值。
 *
 * ★ 三条都是**反向断言**：把 `hydrateAnswers` 里的合并顺序改坏（先队列后服务端），
 * ② 与 ③ 立刻变红。
 *
 * ★ M4a/D1：`hydrateAnswers` 多了第三个入参（题目树）。理由写在它的 JSDoc 上 ——
 * 输入态是**逐题型**的形状，读回时必须与题目当下的样子对齐（空数 / 条目表）。
 * 所以下面的脚手架里有几个最小题目节点，与 `src/lib/worksheet-answer-value.test.ts`
 * 那批是同一套形状（两边不必逐字相同：那边测的是形状本身，这边只借它把水合跑起来）。
 */
const row = (
  questionId: string,
  value: SavedAnswerRow['value'],
  status = 'submitted',
  isCorrect: boolean | null = null,
  score: number | null = null,
): SavedAnswerRow => ({ questionId, value, status, isCorrect, score });

const qNode = (id: string, type: string, data: Record<string, unknown> = {}): WorksheetQuestionNode =>
  ({ id, type, prompt: '题干', inputMode: 'keyboard', data, children: [] });

const CHOICE_OPTIONS = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }];
const choiceNode = (id: string) => qNode(id, 'single-choice', { options: CHOICE_OPTIONS });
const fillNode = (id: string) => qNode(id, 'fill-blank', { answers: ['H2O'] });
const orderNode = (id: string) => qNode(id, 'order', {
  items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }],
  correctOrder: ['i2', 'i1'],
});

test('🔴 hydrateAnswers：服务端已保存的作答要填回输入框，并带上状态与得分', () => {
  const hydrated = hydrateAnswers(
    [
      row('q1', { format: 'choice/v1', selected: ['B'] }, 'submitted', false),
      row('q2', { format: 'fill/v1', text: 'H2O' }, 'draft', null),
    ],
    [],
    [choiceNode('q1'), fillNode('q2')],
  );

  // ① 输入框：每个格式各自读回它该有的那一个字段（形状是**逐题型**的）
  assert.deepEqual(hydrated.drafts.q1, { kind: 'choice', selected: ['B'] }, '单选题要回填选中的那一项');
  assert.deepEqual(hydrated.drafts.q2, { kind: 'fill', texts: ['H2O'] }, '填空题要回填文本');

  // ② 状态：✓ 已提交 / ◐ 作答中 的判据（进度条的分母也吃它）
  assert.equal(hydrated.statuses.q1, 'submitted');
  assert.equal(hydrated.statuses.q2, 'draft');

  // ③ 得分：`isCorrect` 是 `false` ⇒ **0 分**（不是「没判分」）；`null` ⇒ 没判分
  //    ⚠️ 这一行是**旧行兜底**：`score` 为 `null` 时回落到 `isCorrect`。
  assert.equal(hydrated.scores.q1, 0, '答错了是 0 分，不是 null —— 两者在奖励上不一样');
  assert.equal(hydrated.scores.q2, null, '没判分（draft / 主观题）是 null');
  // ★ 新行：`score` 是绝对值（教师逐题填的那个数），**优先于** `isCorrect`。
  const scored = hydrateAnswers(
    [row('q1', { format: 'choice/v1', selected: ['B'] }, 'submitted', true, 4)],
    [],
    [choiceNode('q1')],
  );
  assert.equal(scored.scores.q1, 4, '有 score 就用 score（4 分不是 1 分）');

  // ④ `lastSent`：库里**确实有**这一行 ⇒ 学生随后清空它时，必须发一条「清空」出去。
  //    不填的话，服务端那一行会一直留着学生已经删掉的答案，教师看板上看得见。
  assert.deepEqual(hydrated.lastSent.q1, { format: 'choice/v1', selected: ['B'] });
});

test('🔴 hydrateAnswers：队列里那一题**赢** —— 服务端的旧值不得冲掉刚改完还没保存的新答案', () => {
  const hydrated = hydrateAnswers(
    [row('q1', { format: 'choice/v1', selected: ['A'] }, 'submitted', true)],
    [{ questionId: 'q1', value: { format: 'choice/v1', selected: ['C'] }, at: 100 }],
    [choiceNode('q1')],
  );

  assert.deepEqual(hydrated.drafts.q1, { kind: 'choice', selected: ['C'] }, '本地那条更新的作答必须赢');
  // 服务端那一行的状态与得分**也要让位**：本地这次改动马上会被 PUT 拨回 draft
  // 并把 `isCorrect` / `score` 清成 null（`routes/worksheets.ts` 的 update 分支）。
  // 留着它们，界面会一边显示「✓ 已提交 / ⭐」一边让学生继续改 —— 一句关于他自己的谎话。
  assert.equal(hydrated.statuses.q1, undefined, '本地有未保存改动 ⇒ 不得沿用服务端的「已提交」');
  assert.equal(hydrated.scores.q1, undefined, '本地有未保存改动 ⇒ 不得沿用服务端的判分');
  // ⚠️ `lastSent` 刻意**不填**：这一条还没被服务端确认过，我们不知道库里那行在不在
  // —— 理由与 `use-worksheet-answers.ts` 里那段「刻意不填 lastSent」逐字相同。
  assert.equal(hydrated.lastSent.q1, undefined);
});

test('🔴 hydrateAnswers：队列里的「清空」也要赢过服务端的旧值', () => {
  const hydrated = hydrateAnswers(
    [row('q1', { format: 'fill/v1', text: '光合作用' }, 'submitted', true)],
    // `value: null` 是「学生把这一题删干净了」的标记，不是「没有值」
    [{ questionId: 'q1', value: null, at: 100 }],
    [fillNode('q1')],
  );
  assert.deepEqual(hydrated.drafts.q1, { kind: 'fill', texts: [''] }, '学生删掉的内容不得被服务端顶回来');
  assert.equal(hydrated.statuses.q1, undefined);
  assert.equal(hydrated.scores.q1, undefined);
});

test('hydrateAnswers：服务端「已清空」的行（value 为 null）不得被填成有内容', () => {
  // 库里那一行还在（学生开始作答过又清空了）⇒ `lastSent` 必须是**已定义**的 `null`，
  // 否则学生随后「敲一个再删掉」不会发清空请求，而库里那一行会一直留着。
  const hydrated = hydrateAnswers([row('q1', null, 'draft', null)], [], [fillNode('q1')]);
  assert.deepEqual(hydrated.drafts.q1, { kind: 'fill', texts: [''] });
  assert.equal(hydrated.lastSent.q1, null, 'null 是「发过，值是空的」—— 与 undefined（没发过）不是一回事');
});

test('hydrateAnswers：读不出来的坏值不抛，回落成空输入态（渲染路径不许 TypeError）', () => {
  const hydrated = hydrateAnswers([row('q1', { format: '不认识/v9' } as never)], [], [fillNode('q1')]);
  assert.deepEqual(hydrated.drafts.q1, { kind: 'fill', texts: [''] });
  assert.equal(hydrated.statuses.q1, 'submitted', '草稿读不出来不该连带把状态也丢掉');
});

test('hydrateAnswers：没作答、队列也空 ⇒ 四张表都是空的（刷新后不凭空多出东西）', () => {
  const hydrated = hydrateAnswers([], [], [choiceNode('q1')]);
  assert.deepEqual(hydrated.drafts, {});
  assert.deepEqual(hydrated.statuses, {});
  assert.deepEqual(hydrated.scores, {});
  assert.deepEqual(hydrated.lastSent, {});
});

test('🔴 hydrateAnswers：内容里已经没有的题**整行跳过**（读出来也没有地方画它）', () => {
  // 教师删掉了那道题、作答行还留在库里。塞进 `drafts` 只会让「这份图里有几个键」
  // 与「屏幕上有几道题」不再对应，而面板只渲染 `content` 里有的题。
  const hydrated = hydrateAnswers(
    [row('q9', { format: 'choice/v1', selected: ['A'] }, 'submitted', true)],
    [{ questionId: 'q9', value: { format: 'choice/v1', selected: ['A'] }, at: 1 }],
    [choiceNode('q1')],
  );
  assert.equal(hydrated.drafts.q9, undefined);
  assert.equal(hydrated.statuses.q9, undefined);
  assert.equal(hydrated.scores.q9, undefined);
  assert.equal(hydrated.lastSent.q9, undefined);
});

test('🔴 hydrateAnswers：排序题的旧作答按题目当下的条目表**补齐 / 裁掉**', () => {
  // 教师删了一个条目、又加了一个：旧作答里那个 id 必须消失（否则画成一个没有文字的条目），
  // 新条目必须补上（否则那一列里永远看不到它）。
  const hydrated = hydrateAnswers(
    [row('q1', { format: 'order/v1', order: ['i9', 'i2'] }, 'draft', null)],
    [],
    [orderNode('q1')],
  );
  assert.deepEqual(hydrated.drafts.q1, { kind: 'order', order: ['i2', 'i1'] });
});

// ── 6. 🔴 得分从线缆上读回来（新行读 `score`，旧行兜底 `isCorrect`）──────

/**
 * ★ M4a/D1：`scoreFromWire` 的入参从「线缆上的 `isCorrect`」换成了**整行**。
 *
 * 🔴 两件事同时成立才叫对：
 *   · **新行**拿教师逐题填的**绝对值**（`score`，规格 §12）；
 *   · **旧行**（A1 只回填了 `gradeState`，`score` 刻意没回填）靠 `isCorrect` 兜底 ——
 *     没有兜底 ⇒ 升级后所有历史作答的奖励**凭空消失**，而学生看到的只是「星星不见了」。
 *
 * ⚠️ 这里刻意**不**用 `row()` 脚手架：那一个的字段顺序（`isCorrect` 在前）会把
 * 「到底读了哪个键」这件事藏起来。直接写字面量，让两条路径一眼可见。
 */
test('🔴 scoreFromWire：有 `score` 就用 `score`（绝对值），一个字节都不换算', () => {
  assert.equal(scoreFromWire({ score: 2, isCorrect: false }), 2, '部分给分 2 分：不许因为 isCorrect=false 变成 0');
  assert.equal(scoreFromWire({ score: 0, isCorrect: false }), 0);
  assert.equal(scoreFromWire({ score: 5, isCorrect: true }), 5);
  assert.equal(scoreFromWire({ score: 0.5, isCorrect: true }), 0.5, 'M4b 的部分得分走这条');
  assert.equal(scoreFromWire({ score: -3 }), -3, '负分照收：判据是「是不是数」，不是「是不是正数」');
});

test('🔴 scoreFromWire：旧行没有 `score` ⇒ 用 `isCorrect` 兜底（否则历史奖励凭空消失）', () => {
  // 升级前落库的行长这样：只有 `isCorrect`。少了这两行，全班的历史星星一次全没。
  assert.equal(scoreFromWire({ isCorrect: true }), 1);
  assert.equal(scoreFromWire({ isCorrect: false }), 0);
  assert.equal(scoreFromWire({ isCorrect: null }), null, '没判分是 null，不是 0');
  assert.equal(scoreFromWire({}), null);
  // ⚠️ `score` 坏掉（不是有限数）时也走兜底，而不是把坏值当分用。
  assert.equal(scoreFromWire({ score: null, isCorrect: true }), 1);
  assert.equal(scoreFromWire({ score: Number.NaN, isCorrect: true }), 1, 'NaN 会让累计变成 NaN');
  assert.equal(scoreFromWire({ score: Number.POSITIVE_INFINITY, isCorrect: true }), 1, 'Infinity 会让累计变成 Infinity');
  assert.equal(scoreFromWire({ score: '3', isCorrect: false }), 0, '字符串不是数 ⇒ 兜底');
});

test('🔴 scoreFromWire：读不出来的东西一律 `null`（**不是** 0）', () => {
  // `undefined`（`.json()` 失败）当成 0 是把一次读不出来的响应变成「答错了」——
  // 静默地把学生判错，而他屏幕上只是少了一颗星。
  assert.equal(scoreFromWire(undefined), null);
  assert.equal(scoreFromWire(null), null);
  assert.equal(scoreFromWire({}), null);
  assert.equal(scoreFromWire({ isCorrect: undefined }), null);
  assert.equal(scoreFromWire(1), null, '整行是数字 ⇒ 拿不到 `score` 键 ⇒ null');
  assert.equal(scoreFromWire('true'), null);
  assert.equal(scoreFromWire([{ score: 3 }]), null, '数组不是「整行」');
  // 阳性对照：`false` 必须是 **0**（答错），与上面那些 `null` 不是一回事。
  assert.notEqual(scoreFromWire({ isCorrect: false }), null);
});

/* ── 答错时要展示的正确答案（★ 2026-09-27）────────────────────────────────── */

test('🔴 `readCorrectBlanks`：只收**整数下标 + 字符串值**，坏格子丢掉、不猜', () => {
  // 渲染路径上的消毒（与 `wrongBlankIndexes` 同一条纪律）：一次 TypeError 就是一整片白屏，
  // 而白屏的学生会以为「老师没布置」。
  assert.deepEqual(readCorrectBlanks({ 0: '氧气', 2: '阳光' }), { 0: '氧气', 2: '阳光' });
  assert.deepEqual(readCorrectBlanks({ 0: '氧气', x: '阳光' }), { 0: '氧气' }, '非整数下标');
  assert.deepEqual(readCorrectBlanks({ 0: 42 }), {}, '值不是字符串');
  assert.deepEqual(readCorrectBlanks(null), {});
  assert.deepEqual(readCorrectBlanks([ 'A' ]), {}, '数组不是那个形状');
  assert.deepEqual(readCorrectBlanks('A'), {}, '标量也不是');
});

test('🔴 认不出的形状回**空对象**（不是 undefined）—— 调用方按「空 = 没什么可展示」读', () => {
  const empty = readCorrectBlanks(undefined);
  assert.deepEqual(empty, {});
  assert.equal(typeof empty, 'object');
});
