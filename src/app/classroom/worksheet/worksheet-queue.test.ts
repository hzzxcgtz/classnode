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
  dropQueueItem,
  hydrateAnswers,
  isPermanentFailure,
  permanentFailureMessage,
  readQueue,
  replayOrder,
  sessionExpiredMessage,
  upsertQueueItem,
  worksheetQueueKey,
  writeQueue,
  type QueueStorage,
  type SavedAnswerRow,
  type WorksheetQueueItem,
} from './worksheet-queue.ts';

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
const drops = (status: number | null): boolean => classifyFailure(status) === 'permanent';

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
 */
const row = (
  questionId: string,
  value: SavedAnswerRow['value'],
  status = 'submitted',
  isCorrect: boolean | null = null,
): SavedAnswerRow => ({ questionId, value, status, isCorrect });

test('🔴 hydrateAnswers：服务端已保存的作答要填回输入框，并带上状态与得分', () => {
  const hydrated = hydrateAnswers(
    [
      row('q1', { format: 'choice/v1', selected: ['B'] }, 'submitted', false),
      row('q2', { format: 'fill/v1', text: 'H2O' }, 'draft', null),
    ],
    [],
  );

  // ① 输入框：三种格式各自读回它该有的那一个字段
  assert.deepEqual(hydrated.drafts.q1, { selected: 'B', text: '' }, '单选题要回填选中的那一项');
  assert.deepEqual(hydrated.drafts.q2, { selected: '', text: 'H2O' }, '填空题要回填文本');

  // ② 状态：✓ 已提交 / ◐ 作答中 的判据（进度条的分母也吃它）
  assert.equal(hydrated.statuses.q1, 'submitted');
  assert.equal(hydrated.statuses.q2, 'draft');

  // ③ 得分：`isCorrect` 是 `false` ⇒ **0 分**（不是「没判分」）；`null` ⇒ 没判分
  assert.equal(hydrated.scores.q1, 0, '答错了是 0 分，不是 null —— 两者在奖励上不一样');
  assert.equal(hydrated.scores.q2, null, '没判分（draft / 主观题）是 null');

  // ④ `lastSent`：库里**确实有**这一行 ⇒ 学生随后清空它时，必须发一条「清空」出去。
  //    不填的话，服务端那一行会一直留着学生已经删掉的答案，教师看板上看得见。
  assert.deepEqual(hydrated.lastSent.q1, { format: 'choice/v1', selected: ['B'] });
});

test('🔴 hydrateAnswers：队列里那一题**赢** —— 服务端的旧值不得冲掉刚改完还没保存的新答案', () => {
  const hydrated = hydrateAnswers(
    [row('q1', { format: 'choice/v1', selected: ['A'] }, 'submitted', true)],
    [{ questionId: 'q1', value: { format: 'choice/v1', selected: ['C'] }, at: 100 }],
  );

  assert.deepEqual(hydrated.drafts.q1, { selected: 'C', text: '' }, '本地那条更新的作答必须赢');
  // 服务端那一行的状态与得分**也要让位**：本地这次改动马上会被 PUT 拨回 draft
  // 并把 `isCorrect` 清成 null（`routes/worksheets.ts` 的 update 分支）。
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
  );
  assert.deepEqual(hydrated.drafts.q1, { selected: '', text: '' }, '学生删掉的内容不得被服务端顶回来');
  assert.equal(hydrated.statuses.q1, undefined);
  assert.equal(hydrated.scores.q1, undefined);
});

test('hydrateAnswers：服务端「已清空」的行（value 为 null）不得被填成有内容', () => {
  // 库里那一行还在（学生开始作答过又清空了）⇒ `lastSent` 必须是**已定义**的 `null`，
  // 否则学生随后「敲一个再删掉」不会发清空请求，而库里那一行会一直留着。
  const hydrated = hydrateAnswers([row('q1', null, 'draft', null)], []);
  assert.deepEqual(hydrated.drafts.q1, { selected: '', text: '' });
  assert.equal(hydrated.lastSent.q1, null, 'null 是「发过，值是空的」—— 与 undefined（没发过）不是一回事');
});

test('hydrateAnswers：读不出来的坏值不抛，回落成空草稿（渲染路径不许 TypeError）', () => {
  const hydrated = hydrateAnswers([row('q1', { format: '不认识/v9' } as never)], []);
  assert.deepEqual(hydrated.drafts.q1, { selected: '', text: '' });
  assert.equal(hydrated.statuses.q1, 'submitted', '草稿读不出来不该连带把状态也丢掉');
});

test('hydrateAnswers：没作答、队列也空 ⇒ 四张表都是空的（刷新后不凭空多出东西）', () => {
  const hydrated = hydrateAnswers([], []);
  assert.deepEqual(hydrated.drafts, {});
  assert.deepEqual(hydrated.statuses, {});
  assert.deepEqual(hydrated.scores, {});
  assert.deepEqual(hydrated.lastSent, {});
});
