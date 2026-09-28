// ⚠️ **相对路径 + `.ts` 后缀**（不是联名路径 `@/…`）：本文件要被 `node --test` 直接跑，
// 而 Node 的类型擦除不认 tsconfig 的 `paths`。与 `worksheet-tile-state.ts` 同一条写法。
import type { WorksheetBoard } from '../../../lib/types';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state.ts';

/**
 * 把**历史读端点的快照**换算成看板格子的进度 —— 纯函数，不碰 React / DOM / 网络。
 *
 * ── 它为什么存在（第 1 条：格子失忆）────────────────────────────────────
 * 格子的进度此前**只由广播写入**（`page.tsx` 的 `worksheetProgress`），于是
 * 教师刷新一次页面、或学生离开再回来（没有保存动作 ⇒ 没有广播），格子就掉回
 * 「还没收到作答」。而拉历史的那个端点**早就在了**，只是格子没消费它。
 *
 * ⇒ 本函数补上「底」那一份：`GET /classroom/:id/answers` 的快照换成的进度，
 * 由 `use-worksheet-board.ts` 与广播的增量合并（矩阵 M5b 早就是两条腿了）。
 *
 * ── 🔴 跨时钟相减（本文件最容易写错的一处）────────────────────────────
 * 快照里的 `savedAt` 是**服务端**时间，而格子判「停住了」用的是**浏览器**时钟
 * （`now - lastAt`，那只 30 秒「会走的表」也是浏览器时钟）。
 *
 * 直接把它塞进 `lastAt` 会**静默**算错：教师那台机器的时钟偏了 5 分钟，一个正在答题的
 * 学生会立刻显示成「停住了 5 分钟」，而屏幕上没有任何东西像坏了。
 *
 * 修法只用到减法：
 *   `serverNow - savedAt` = 距上次保存的**时长**（两个都是服务端时间 ⇒ 偏差相消）
 *   再从**浏览器**的收报时刻往回推同样的时长 ⇒ 换算进浏览器时钟。
 * 全程不需要知道两边的时区或偏差。
 *
 * ── 🔴 「不知道」不许被编成一个数 ─────────────────────────────────────
 * 三种编法都是错的，且都不报错：
 *   · `savedAt` 为 `null`（旧行，那一列上线之前落库的）当成「刚刚」⇒ 永远不报停住了；
 *   · 当成一个数（`now - null` = `now`）⇒ **立刻**报停住了，教师去救一个不需要救的人；
 *   · `serverNow` 缺失时拿浏览器时钟去减服务端时间戳 ⇒ 上面那条跨时钟的错。
 * ⇒ 两种情况都落 `lastAt: null`（=「不知道」，由 `worksheetTileState` 落 `working`）。
 *
 * ⚠️ 与矩阵的 `toCellState`（`worksheet-matrix.ts`）是同一把尺子、**刻意各留一份**：
 * 那边是「合并两路数据」用的私有函数，这边是「把一路摊成进度」用的。
 * 合并掉它们会让矩阵那个已有回归网的纯函数跟着动 —— 不值得。
 */

/** 认得出的状态就返回它，认不出返回 `null`（**丢掉**这一格，不猜）。 */
function toCellState(value: unknown): 'draft' | 'submitted' | null {
  return value === 'draft' || value === 'submitted' ? value : null;
}

/**
 * 合并**两条腿**：历史快照（底）+ 广播（增量）—— 纯函数。
 *
 * 🔴 **合并规则是「广播赢」，但只赢到它该赢的那一段。** 判据是 `snapshotAt`
 *（本次快照**发起**的时刻，浏览器时钟）：广播**到达**的时刻比它晚，才算「比这一份快照新」。
 *
 * 少了下界会怎样（矩阵那边实测过、逐字记在 `worksheet-matrix.ts` 的注释里）：
 * `live` 是页内 state，**没有任何失效机制** —— 教师这台机器的 socket 断线期间学生提交了，
 * 那条广播永远收不到，而 30 秒后重拉回来的 REST 明确说 `submitted`，`live` 里断线前那条
 * `draft` 却照样赢 ⇒ 那一格**永远**停在琥珀，直到教师手动刷新页面。
 * 而它恰好咬在招牌上：被黏住的正是**学生动过的那几题**。
 *
 * 🔴 **只在 `rest` 里已有的参与者上合并**（广播里出现快照之外的人时**不造列**）：
 * 两边各造一套「谁在班里」必然分叉。课中途加入的人等下一轮 30 秒重拉。
 *
 * @param snapshotAt 快照**发起**的时刻（不是回来的时刻）——发起之后到达的广播，
 *   其对应的写库一定发生在那次读之前？**不**，反过来：发起之后**到达**的广播，
 *   写库发生在它到达之前，而那次读是在发起时做的 ⇒ 那次读**可能没包含**它。
 *   ⚠️ 所以下界必须是「发起」而不是「回来」：用「回来」会漏掉在途的那几条广播
 *   （它们的写库早于回来的时刻、但晚于发起的时刻），那些格的更新会被误判成陈旧。
 */
export function mergeProgress(
  rest: Record<string, ParticipantWorksheetProgress>,
  live: Record<string, ParticipantWorksheetProgress>,
  snapshotAt: number,
): Record<string, ParticipantWorksheetProgress> {
  const out: Record<string, ParticipantWorksheetProgress> = {};
  for (const participantId of Object.keys(rest)) {
    const fromLive = live[participantId];
    // ⚠️ `>` 不是 `>=`，且 `lastAt === null`（不知道这条广播什么时候到的）一律**不信** ——
    // 与 `worksheet-matrix.ts` 里那条判据逐字同源。
    const trusted = fromLive !== undefined && fromLive.lastAt !== null && fromLive.lastAt > snapshotAt;
    out[participantId] = trusted ? fromLive : rest[participantId];
  }
  return out;
}

/**
 * @param fetchedAtBrowser 这一份快照**到达浏览器**的时刻（`Date.now()`）。
 *   ⚠️ 必须是浏览器时钟 —— 它的作用就是把「服务端时长」换算到浏览器这一侧。
 */
export function restProgress(
  board: WorksheetBoard,
  fetchedAtBrowser: number,
): Record<string, ParticipantWorksheetProgress> {
  // ⚠️ 读成 `unknown` 再判类型：这个字段来自线缆，而浏览器里的 bundle 与服务端
  // **不保证同一个版本**（旧服务端不发它）。`Date.parse` 对垃圾回 `NaN`，下面据此落 null。
  const raw: unknown = board.serverNow;
  const serverNowMs = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;

  const out: Record<string, ParticipantWorksheetProgress> = {};
  for (const worksheet of board.worksheets) {
    for (const participant of worksheet.participants) {
      const cells: Record<string, 'draft' | 'submitted'> = {};
      let lastQuestionId: string | null = null;
      /** 迄今见过的最大的 `savedAt`（服务端时间）。`NaN` = 一行都没有。 */
      let bestSavedAt = Number.NaN;

      for (const row of participant.answerRows) {
        const state = toCellState(row.status);
        // ⚠️ `unanswered` 是**有行但没动**：它在格子上与「没有行」长得一样（都是灰的），
        // 所以在这里就丢掉 —— 格子只编码「作答中 / 已提交」两种已知状态。
        if (state) cells[row.questionId] = state;

        // 「最后一次保存的是哪一题」= `savedAt` 最大的一行（规格 §3-H 的判据）。
        // ⚠️ 不是数组里的最后一行：`answerRows` **没有顺序保证**（数据库按写入顺序回）。
        const saved: unknown = row.savedAt;
        if (typeof saved === 'string') {
          const at = Date.parse(saved);
          if (Number.isFinite(at) && (!Number.isFinite(bestSavedAt) || at > bestSavedAt)) {
            bestSavedAt = at;
            lastQuestionId = row.questionId;
          }
        }
      }

      let lastAt: number | null = null;
      if (Number.isFinite(serverNowMs) && Number.isFinite(bestSavedAt)) {
        // ⚠️ 钳在 0：理论上 `savedAt <= serverNow`（行是先落库、`serverNow` 是后取的），
        // 但两次读之间若有写入落库，这个差可以是负的。负的时长会换算出一个**未来**的
        // `lastAt`，于是 `now - lastAt` 是负数 —— 不会报错，只是永远不报停住了。
        const idleMs = Math.max(0, serverNowMs - bestSavedAt);
        lastAt = fetchedAtBrowser - idleMs;
      }

      out[participant.participantId] = { cells, lastQuestionId, lastAt };
    }
  }
  return out;
}
