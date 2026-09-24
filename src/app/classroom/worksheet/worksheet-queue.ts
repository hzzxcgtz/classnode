// ⚠️ **相对路径 + `.ts` 后缀**（不是联名路径 `@/…`）：本文件要被 `node --test` 直接跑，
// 而 Node 的类型擦除不认 tsconfig 的 `paths`。`worksheet-editor-core.ts` 里那份纯逻辑核
// 引同一个模块时用的是同一条写法 —— `allowImportingTsExtensions` 已开。
//
// ★ M4a/D1：作答态那两个函数**搬去了 `worksheet-answer-value.ts`**（`worksheet-questions.ts`
// 只是转出它们）。这里直接引那个文件而不是转出口，是为了让依赖方向看得见：
// 本文件 → `worksheet-answer-value.ts`，而不是绕一圈经过题型词汇表。
import {
  draftFromValue,
  emptyDraftFor,
  type AnswerDraft,
  type WorksheetAnswerValue,
} from '../../../lib/worksheet-answer-value.ts';
// `WorksheetQuestionNode` 是**只读类型**：`import type` 会被类型擦除整段删掉，
// 所以它不影响本文件能被 `node --test` 直接执行（`./types` 因此不必带后缀）。
import type { WorksheetQuestionNode } from '../../../lib/types';

/**
 * 作答的**本地队列** —— 学习单模块「最不能出错」的一块（规格 §8.3）。
 *
 * 🔴 **绝不静默丢数据。** 学生答到一半断网、切走模块、把 iPad 锁屏，回来后那条作答
 * 必须还在。所以：本地先落 `localStorage`，再谈发不发得出去。
 *
 * 为什么这一段单独成文件、且**不引 React / DOM / 网络**：它要被 `node --test` 直接跑
 * （`worksheet-queue.test.ts`）。本仓没有前端测试框架，而队列里最容易写错的恰好是纯逻辑
 * ——「哪一条该丢弃、哪一条该留着重试」。这一条错了的症状是**队列永远重放同一条**
 * 或者**学生的作答被悄悄扔掉**，两种都不报错。
 *
 * ⚠️ 存储键里的 `classroomId` / `participantId` 都不是可有可无的：同一台 iPad 上换学生、
 * 同一学生进另一个课堂，是两件每天都会发生的事。少一个维度就会把**上一个学生的作答**
 * 当作这个学生的重放出去 —— 那是一次跨学生的数据串台，且服务端会照收。
 */

/** 队列里的一条：**一道题只留一条**（同题后一次作答覆盖前一次）。 */
export interface WorksheetQueueItem {
  questionId: string;
  /**
   * 要落库的作答值。
   *
   * `null` = **清空这一题**（学生把输入框删干净了）。它不是「没有值」而是「有值，值是没有」：
   * 服务端把「请求体里没有 `value` 键」收成 SQL NULL（`toJsonValue` 的 `DbNull` 分支，
   * `routes/worksheets.ts`），通道就是**不发这个键**——`JSON.stringify` 会丢掉
   * `undefined`，所以 `value: null` 在这里再被翻译成「不带上 `value`」。
   */
  value: WorksheetAnswerValue | null;
  /** 入队时刻（ms）。重放按它**升序** —— 同一题改了两次，后一次必须最后落地。 */
  at: number;
}

/** 只用到这三件事的存储（真实实现是 `window.localStorage`，测试里是内存替身）。 */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 队列的存储键。**两个 id 都必须在**，理由见文件头。
 *
 * ⚠️ 键的拼接方式变了就等于所有人换了一次队列（老键留在存储里没人读），
 * 所以别顺手改分隔符。
 */
export function worksheetQueueKey(classroomId: string, participantId: string): string {
  return `worksheet-queue:${classroomId}:${participantId}`;
}

/**
 * 读队列。**容错到底**：存储里的东西可能来自上一个版本、也可能被手工改过，
 * 而它读不出来的代价不该是「面板打不开」。
 *
 * 逐条校验形状（`questionId` 是非空字符串、`at` 是有限数）；读不出来就整条丢掉。
 * ⚠️ 丢掉**坏条目**而不是整份队列：一条坏行不该把同一名学生还没发出去的其它作答一起作废
 * —— 那正是本节最不能发生的事。
 */
export function readQueue(storage: QueueStorage, key: string): WorksheetQueueItem[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    // 隐私模式 / 存储被禁用时访问会抛。降级成「没有队列」而不是崩掉面板。
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: WorksheetQueueItem[] = [];
  parsed.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    if (typeof row.questionId !== 'string' || !row.questionId) return;
    if (typeof row.at !== 'number' || !isFinite(row.at)) return;
    const value = row.value === null || row.value === undefined
      ? null
      : (row.value as WorksheetAnswerValue);
    items.push({ questionId: row.questionId, value, at: row.at });
  });
  return items;
}

/** 写队列。**队列空 ⇒ 删掉键**，不留一条 `[]` 在存储里（那会让「有没有东西要发」多一种判据）。 */
export function writeQueue(storage: QueueStorage, key: string, items: WorksheetQueueItem[]): void {
  try {
    if (items.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(items));
  } catch {
    // 写不进去（配额 / 隐私模式）时**不改内存里的队列** —— 这一次会话里它仍然是对的，
    // 只是撑不过刷新。抛出去只会把面板打崩。
  }
}

/** 入队 / 覆盖。同题只留一条（后一次作答覆盖前一次），返回**新数组**。 */
export function upsertQueueItem(items: WorksheetQueueItem[], item: WorksheetQueueItem): WorksheetQueueItem[] {
  return [...items.filter((existing) => existing.questionId !== item.questionId), item];
}

/** 出队（服务端**返回 200 之后**才允许调用，见文件头）。 */
export function dropQueueItem(items: WorksheetQueueItem[], questionId: string): WorksheetQueueItem[] {
  return items.filter((existing) => existing.questionId !== questionId);
}

/**
 * 重放顺序：`at` 升序。
 *
 * ⚠️ 不能靠数组顺序：同题覆盖是「先删后加」，被覆盖那一条的位置信息随删除一起丢了；
 * 而跨题之间「先答第 3 题、后答第 1 题」是常态。按 `at` 排是唯一与「学生动手的顺序」
 * 同构的判据 —— 服务端那一侧是幂等的 upsert，顺序错了不会报错，只会让最后一题
 * 的答案是**较早**的那一次。
 */
export function replayOrder(items: WorksheetQueueItem[]): WorksheetQueueItem[] {
  return [...items].sort((a, b) => a.at - b.at);
}

/**
 * 这一次失败该怎么处置。**三档，不是一个布尔值** —— `'permanent'` 是**唯一**会让作答
 * 出队（即真的丢掉）的那一档，判据只有这一个出口（`use-worksheet-answers.ts` 的 flush 循环）。
 *
 * 🔴 这条判据是本模块唯一一条不能含糊的规则：
 *   · **`'permanent'`：4xx（含 `allowResubmit: false` 的 409）⇒ 从队列里丢弃**。
 *     留着重试 = 每一次联网、每一次输入都重放同一条被服务端拒绝的请求，队列永远清不空、
 *     顶部永远挂着「⚠ 离线」，而学生看到的是一句「保存中…」永远不结束。
 *   · **`'transient'`：5xx 与网络错误（`status` 为 `null`）⇒ 保留并重试**。
 *     这两类的共同点是「服务端此刻没能处理，但这条作答本身没错」。
 *   · 🔴 **`'session-expired'`：401 ⇒ 保留，且**不出队**。** 它不是「永久失败」，
 *     理由见下面 `sessionExpiredMessage` 上方那一段。
 *
 * 服务端那侧的配合是刻意的（`routes/worksheets.ts` 的注释写明）：409 用来表示
 * 「当前状态不允许这个操作」、400 表示「请求本身有问题」，两者都不与 5xx 混用。
 * **客户端这条判据与那条约定是一对**，改一边就要看另一边。
 */
export type FailureKind = 'permanent' | 'session-expired' | 'transient';

export function classifyFailure(status: number | null): FailureKind {
  if (status === null) return 'transient';
  // 🔴 401 走单独一档，**绝不能与 400/403/409 合并**。见 `sessionExpiredMessage`。
  if (status === 401) return 'session-expired';
  if (status >= 400 && status < 500) return 'permanent';
  return 'transient';
}

/** 「这一条该丢掉吗」。**只为读起来顺**——判据本体在 `classifyFailure`，不在这里。 */
export function isPermanentFailure(status: number | null): boolean {
  return classifyFailure(status) === 'permanent';
}

/**
 * 服务端拒了之后给学生的**一句人话**。
 *
 * 优先用服务端给的 `error`（它是中文、且比客户端更清楚为什么），拿不到才回落。
 * ⚠️ 这句提示**必须出现**：永久失败意味着学生这一次的作答**真的没了**，
 * 静默丢弃正是本节要防的那件事。
 */
export function permanentFailureMessage(status: number, serverMessage?: string | null): string {
  if (serverMessage) return serverMessage;
  if (status === 409) return '老师已设置本题提交后不可修改，这一题这次没能保存';
  return `这一题没能保存（错误 ${status}），请告诉老师`;
}

/**
 * 会话过期（401）时给学生的**一句人话**。
 *
 * 🔴 为什么 401 绝不能走「丢弃」那一支（`classifyFailure` 里单独一档就是为它）：
 * 服务端的学生 token 是用**每进程随机**的密钥签的（`middleware/student-auth.ts` 的
 * `crypto.randomBytes(32)`），所以**服务端每重启一次，所有学生 token 立刻失效** ——
 * 开发时 `tsx watch` 改一次文件就重启一次，桌面端每次升级重启同理。也就是说 401 的成因
 * **全在服务端**，与这道题的答案毫无关系。按「4xx 一律永久」处置的后果是双重的：
 * 那条作答被**真的丢掉**，而学生看到的还是 `middleware/auth.ts` 那句
 * 「教师会话已失效，请重新登录」—— 那是说给教师的，学生根本没有教师会话可登。
 * 一句谎话 + 一次真丢数据，正是规格 §8.3 明令禁止的那件事。
 *
 * 不丢的**底气**来自队列本身：键是「课堂 + 参与者」且落在 `localStorage`，
 * 刷新页面会重新 `createStudentSession` 并**重放整个队列** ⇒ 只要不出队，
 * 学生的答案一条都不会少。所以这里的出路是「刷新一下」，不是「重新作答」。
 *
 * ⚠️ 服务端那句 `error` 在这里**故意不用**（与 `permanentFailureMessage` 相反）：
 * 它是写给教师的，照抄过来就是上面那句谎话。
 */
export function sessionExpiredMessage(): string {
  return '登录状态过期了，刷新一下页面就好 —— 你答过的题都还在，刷新后会自动重发';
}

// ── 服务端回读的水合（「学生做了一半刷新页面后，做好的题没了」）──────────────

/**
 * 服务端回读的一行 —— `GET /api/worksheets/:id/answers` 的 `rows` 元素。
 *
 * ⚠️ 信封那个键是 `rows`（「作答行」），不是 `answers`：后者是**正确答案**那个字段的
 * 名字（`ANSWER_KEYS`），两个端点都被「响应里不许出现 `ANSWER_KEYS` 里的键」扫着。
 */
export interface SavedAnswerRow {
  questionId: string;
  /** 学生自己写的值。`null` = 这一题的作答**被清空了**（库里那一行还在）。 */
  value: WorksheetAnswerValue | null;
  /** 服务端那一行的状态。不认识的字符串按 `draft` 处置（见 `hydrateAnswers`）。 */
  status: string;
  /** `boolean` = 判了对错；`null` = **没判分**（主观题 / 关掉自动判分）。 */
  isCorrect: boolean | null;
  /**
   * ★ M4a：这一题拿到的**绝对数**（教师逐题填的两个档之一，规格 §12）。
   *
   * 🔴 **`null` 有两种成因，处置相同**：
   *   · 没判分（主观题 / 关掉自动判分 / 还没提交）；
   *   · **升级前落库的旧行**（A1 只回填了 `gradeState`，`score` 刻意没回填 —— 旧行没有
   *     逐题分值，写死任何一个数都是编的）。
   * 后者靠 `scoreFromWire` 里的 `isCorrect` 兜底，不然升级后历史作答的奖励**凭空消失**。
   */
  score: number | null;
}

/**
 * 线缆上的一行 → 界面用的**得分**。全项目**唯一**一处做这个转换的地方。
 *
 * M4a：得分不再是 0/1，而是教师逐题填的**绝对值**（`score`），所以直接取用。
 * ⚠️ `isCorrect` 仍在线上（协议字段，**只增不改**），而且**它仍然参与换算** ——
 * 就是下面那两行对**旧行**的兜底（`score` 不是数时：`true ⇒ 1` / `false ⇒ 0`）。
 * ⊘ 2026-09-24 更正（与 `routes/worksheets.ts` 那句是同一处缺陷的两个副本）：这里原先写
 * 「改名 ⇒ 前端拿到 `undefined` ⇒ 这里回 `null` ⇒ **不画奖励**，且没有任何报错。但它**不再**
 * 参与换算」—— 后半句与下面那两行**直接打架**（兜底读的就是它），前半句也已被 D1+D2
 * 改入参（收整行而不是一个布尔）、D3 把 `score` 提为第一优先级**作废**（新行有 `score`，
 * 那两行根本走不到）。⇒ 改名的真实代价在这里是**旧行**：升级前落库的行 `score` 是 null，
 * 只有 `isCorrect` 能读出来 —— 改名 ⇒ 升级当天历史作答的奖励**凭空消失**，而界面上
 * 一切正常（学生只看到「星星不见了」）。**兜底那两行不许删，理由就是它。**
 *
 * 🔴 **兜底那两行为什么必须有**：A1 的回填**只补了 `gradeState`，没补 `score`**
 * （旧行没有逐题分值，写死任何数都是编的）。没有兜底 ⇒ 升级后所有历史作答的奖励
 * **凭空消失**，而学生看到的只是「星星不见了」，教师那边一切正常。
 *
 * 🔴 判据必须是 `=== true` / `=== false` 两条正面命中，其余一律 `null`：
 * 服务端的 `isCorrect` 是 `boolean | null`（`grade()` 对主观题回 `null`、关掉自动判分
 * 也回 `null`），而 `.json()` 失败时这里是 `undefined`。把 `undefined` 当成 `0`
 * 会让一次读不出来的响应变成「答错了」——静默地把学生判错。
 *
 * ⚠️ 入参是**整行**（不是一个布尔）：`submit` 那条路拿到的是响应体、水合那条路拿到的是
 * `SavedAnswerRow`，两者形状不同但都带这两个键 —— 收成「整行」就不必在两处各写一遍取值，
 * 也让「`score` 优先、`isCorrect` 兜底」这条顺序只有一处。
 *
 * ⚠️ 它住在**本文件**（纯逻辑、被 `node --test` 跑）而不是 `use-worksheet-answers.ts`：
 * 水合（`hydrateAnswers`）与服务端响应（`submit`）两处都要用它，而「`null` 不是 `0`」
 * 与「旧行要兜底」这两条判据必须有一条能跑到的用例钉住 —— 那个文件引 React，跑不了。
 */
export function scoreFromWire(row: unknown): number | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  if (typeof source.score === 'number' && Number.isFinite(source.score)) return source.score;
  if (source.isCorrect === true) return 1;
  if (source.isCorrect === false) return 0;
  return null;
}

/** `hydrateAnswers` 的产物：四张按 `questionId` 索引的表，直接灌进 `useState` / ref。 */
export interface HydratedAnswerState {
  /** 界面上的输入态。 */
  drafts: Record<string, AnswerDraft>;
  /** 每一题在服务端的状态（`✓ 已提交` 芯片与进度条的判据）。 */
  statuses: Record<string, 'draft' | 'submitted'>;
  /** 每一题的得分（奖励）。 */
  scores: Record<string, number | null>;
  /** 「库里**确实已经有这一行**」的题的「上一次落库的值」——「清空」判据吃它。 */
  lastSent: Record<string, WorksheetAnswerValue | null>;
}

/**
 * 把**服务端已有的作答**与**本地还没发出去的队列**合成一份界面态。
 *
 * 🔴 合并规则只有一条，但它是整个修复里最容易写错的地方：
 *   **队列赢。** 队列里那一题是**本地更新、还没被服务端确认**的改动（学生刚改完，
 *   或者上一次会话断网留下的），服务端那一行的值一定更旧 —— 拿它覆盖，
 *   学生看到的就正是他刚删掉的那个旧答案。
 *
 * 逐条口径（每一条都有 `worksheet-queue.test.ts` 第 5 节的用例钉着）：
 *   · 服务端那一行 ⇒ 草稿 + 状态 + 得分 + `lastSent`（**库里确实有这一行**，
 *     所以学生随后把它清空时必须发一条「清空」出去）；
 *   · 队列里那一题 ⇒ 草稿**覆盖**，状态与得分**删掉**（本地这次改动马上会被 PUT
 *     拨回 `draft` 并把 `isCorrect` / `score` 清成 `null`，留着它们会一边显示
 *     「✓ 已提交 ⭐」一边让学生继续改 —— 一句关于他自己的谎话），`lastSent` **刻意不填**
 *     （这一条还没被确认过，不知道库里那行在不在；理由与 `use-worksheet-answers.ts`
 *     里那段逐字相同）；
 *   · 两边都没有的题 ⇒ 什么都不给（保持空白，不是「有值但值是空」）。
 *
 * ── `questions`（★ M4a/D1 新增的第三个入参）为什么必须有 ──────────────────
 * 输入态的形状是**逐题型**的（排序是一列 id、连线是一串 `links`、填空是一列文本），
 * 而 `draftFromValue` 要按题目把作答值**读回**那个形状并与之对齐（教师加了一个空 /
 * 删了一个条目）。没有题目就只读得出一个「大致像」的东西 —— 而那正是
 * 「刷新后做好的题画成空白 / 少一个框」这类缺陷的来源。
 *
 * ⚠️ **内容里已经没有的题（教师删掉了它）整行跳过**：那一行读出来也没有地方画它
 *（面板只渲染 `content` 里有的题），而凭空塞进 `drafts` 只会让「这份图里有几个键」
 * 与「屏幕上有几道题」不再对应。⚠️ 题库 id 是稳定的（规格 §3-P），所以「删了又加回来」
 * 不会复用同一个 id —— 跳过不会漏掉任何还能被作答的题。
 *
 * ⚠️ 纯函数，**不改入参**：`use-worksheet-answers.ts` 的水合 effect 会把结果整个灌进
 * state 与 ref，就地改会让「刷新后重算一次」变成一次累加。
 */
export function hydrateAnswers(
  saved: SavedAnswerRow[],
  queue: WorksheetQueueItem[],
  questions: WorksheetQuestionNode[],
): HydratedAnswerState {
  const drafts: Record<string, AnswerDraft> = {};
  const statuses: Record<string, 'draft' | 'submitted'> = {};
  const scores: Record<string, number | null> = {};
  const lastSent: Record<string, WorksheetAnswerValue | null> = {};
  const byId: Record<string, WorksheetQuestionNode> = {};
  questions.forEach((node) => { byId[node.id] = node; });

  // ① 服务端已有的每一行 —— 这些是**已经落库**的作答，刷新后必须回到屏幕上。
  saved.forEach((row) => {
    const node = byId[row.questionId];
    if (!node) return;
    // `value` 为 `null`（学生清空过）时 `draftFromValue` 给这一题的**空输入态**，正是要的。
    drafts[row.questionId] = draftFromValue(node, row.value);
    // ⚠️ 不认识的 `status` 落到 **`draft`**（保守的一侧）：反过来落到 `submitted`
    // 会给出一道**在学生眼里改不动**的题（`allowResubmit: false` 时界面会收起输入控件
    // 并显示「老师已设置本题提交后不可修改」），而服务端其实还收得下他的改动。
    statuses[row.questionId] = row.status === 'submitted' ? 'submitted' : 'draft';
    // ⚠️ 传**整行**（不是 `row.isCorrect`）：`score` 优先、`isCorrect` 兜底，
    // 旧行（A1 没回填 `score`）因此仍然画得出奖励。顺序的理由写在 `scoreFromWire` 上。
    scores[row.questionId] = scoreFromWire(row);
    lastSent[row.questionId] = row.value;
  });

  // ② 🔴 队列赢（见上面那段）。
  queue.forEach((item) => {
    const node = byId[item.questionId];
    if (!node) return;
    // `value` 为 `null` 是「学生把这一题删干净了」的标记 —— 草稿要是**空的**，
    // 不是「没有这一题」。
    drafts[item.questionId] = item.value === null ? emptyDraftFor(node) : draftFromValue(node, item.value);
    delete statuses[item.questionId];
    delete scores[item.questionId];
    delete lastSent[item.questionId];
  });

  return { drafts, statuses, scores, lastSent };
}
