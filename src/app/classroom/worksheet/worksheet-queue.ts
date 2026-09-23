import type { WorksheetAnswerValue } from '@/lib/worksheet-questions';

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
