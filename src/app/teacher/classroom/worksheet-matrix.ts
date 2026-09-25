// ⚠️ **相对路径 + `.ts` 后缀**（不是联名路径 `@/…`）：本文件要被 `node --test` 直接跑，
// 而 Node 的类型擦除不认 tsconfig 的 `paths`。与 `worksheet-tile-state.ts` 同一条写法。
import { flattenQuestions, questionTypeLabel } from '../../../lib/worksheet-questions.ts';
import type { WorksheetBoardWorksheet, WorksheetQuestionNode } from '@/lib/types';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';

/**
 * 矩阵的**判据层** —— 与 `worksheet-tile-state.ts` 同一条分工：
 * 判据全在这里（纯函数、被 `node --test` 跑），渲染在 `matrix-overlay.tsx`（那个文件引 JSX，跑不了）。
 *
 * 🔴 存在的理由：本仓没有 jsdom ⇒ 写进 JSX 的判据**没有任何回归网**。
 * 而这里每一条错了都**不报错**，只会让教师讲错题。
 *
 * 数据两条腿（规格 `specs/2026-09-25-m5b-matrix-overview.md` §2.5）：REST 那份
 * `GET /classroom/:id/answers` 当底，`worksheet-answer-updated` 广播当增量 ——
 * 只用广播会在刷新后画成「全班都没动」，只用 REST 会看不到实时。
 */

/** 一格的状态。**只有三档**：对错**不在这里**（规格 §3.4 / p1 §7.2）。 */
export type CellState = 'unanswered' | 'draft' | 'submitted';

/** 矩阵的一行 = 一道题。 */
export interface MatrixRow {
  questionId: string;
  /** 0-based 的**拍平**题序（与 `worksheetTileState` 的 `index` 同源）。屏幕上加 1 显示。 */
  index: number;
  /** 题型的中文名（`questionTypeLabel`）。 */
  typeLabel: string;
  /** 题干原文。截断由 CSS 做，不在这一层切字符串。 */
  prompt: string;
  /** 参与者 id → 这一格的状态。**每个参与者都有一项**（没作答就是 `'unanswered'`）。 */
  cells: Record<string, CellState>;
}

/**
 * 认得出的状态就返回它，认不出返回 `null`。
 *
 * ⚠️ **两个来源对 `null` 的处置不同，这不是笔误**（本注释初稿写成「一律当未答」，
 * 与下面 live 那一支的行为**相反**，被本文件自己的用例 `:97` 反证了）：
 *   · **REST 那一支**：`null` ⇒ **丢掉这一行**（等于「这一题没有任何行」= 未答）；
 *   · **live 那一支**：`null` ⇒ **回落到 REST**。当成未答会把学生**已经交掉**的题画成没动。
 */
function toCellState(value: unknown): CellState | null {
  return value === 'draft' || value === 'submitted' ? value : null;
}

/**
 * 把 REST 那一份与广播那一份合成矩阵。
 *
 * 🔴 **行轴是题目树**（`flattenQuestions(nodes)`），**不是**「有人答过的题」的并集 ——
 * 后者会让一道全班都没动过的题**整行消失**，而那恰恰是最该被看见的一行。
 *
 * 🔴 **列轴只有 REST 那一份**（`sheet.participants`）。广播里出现列外的参与者时**不造列**：
 * 两边各造一套「谁在班里」必然分叉。课中途加入的人等下一轮 30 秒重拉（规格 §3.9）。
 *
 * 🔴 **合并规则：广播赢**。广播里那一条是**本地更新的那一次动作**，REST 那份是
 * **上一次拉取时**的快照，一定更旧 —— 与学伴端 `hydrateAnswers` 的「队列赢」逐字同源。
 */
export function buildWorksheetMatrix(
  sheet: WorksheetBoardWorksheet,
  nodes: WorksheetQuestionNode[],
  live: Record<string, ParticipantWorksheetProgress>,
  /**
   * ★ 只信**在这个时刻之后到达**的广播（= 本次 REST 快照发起的时刻）。
   *
   * 🔴 加它的理由（独立审查抓到的）：`live` 是页内 state，**没有任何失效机制** ——
   * 教师这台机器的 socket 断线期间学生提交了，那条广播永远收不到，而 30 秒重拉回来的
   * REST 明确说 `submitted`，`live` 里断线前那条 `draft` 却照样赢 ⇒ 那一格**永远**停在琥珀，
   * 直到教师手动刷新页面。而它恰好咬在招牌上：被黏住的正是**学生动过的那几题**。
   *
   * 判据是 `ParticipantWorksheetProgress.lastAt`（广播**到达浏览器**的时刻）。
   * 一个参与者的广播若全部早于这个下界，REST 那份**一定不比它旧**（REST 是在那一刻之后才读的库）
   * ⇒ 丢开 live、用 REST。**这个方向只会丢陈旧数据，不会丢新数据。**
   *
   * ⚠️ 两端都是**浏览器时钟**（`lastAt` 与这个下界都由 `page.tsx` 的 `Date.now()` 写），
   * 所以服务器 / 浏览器之间的时钟偏差在比较中**相消**。这是为什么不用服务端时间。
   *
   * 不传 = 全信 live（既有调用点与既有用例的行为逐字不变）。
   */
  liveTrustedAfter?: number,
): MatrixRow[] {
  // ① REST 那一份先摊成 (参与者 → 题 → 状态)。
  const restCells: Record<string, Record<string, CellState>> = {};
  sheet.participants.forEach((participant) => {
    const byQuestion: Record<string, CellState> = {};
    participant.answerRows.forEach((answer) => {
      const state = toCellState(answer.status);
      if (state) byQuestion[answer.questionId] = state;
    });
    restCells[participant.participantId] = byQuestion;
  });

  // ② 逐题成行。广播优先，认不出或没有则回落 REST，两边都没有就是未答。
  return flattenQuestions(nodes).map((node, index) => {
    const cells: Record<string, CellState> = {};
    sheet.participants.forEach((participant) => {
      const progress = live[participant.participantId];
      // ⚠️ `>` 不是 `>=`：下界是**快照发起**的时刻，而广播要在它之后**到达**才算新。
      const trustLive = liveTrustedAfter === undefined || (progress !== undefined && progress.lastAt > liveTrustedAfter);
      const fromLive = trustLive ? toCellState(progress?.cells[node.id]) : null;
      cells[participant.participantId] = fromLive ?? restCells[participant.participantId]?.[node.id] ?? 'unanswered';
    });
    return { questionId: node.id, index, typeLabel: questionTypeLabel(node.type), prompt: node.prompt, cells };
  });
}

/** 一道题的三档计数。**分母是参与者数**（`total`），不是「作答过的人数」。 */
export interface QuestionTally {
  questionId: string;
  index: number;
  /** `'draft'` 的参与者数。 */
  drafted: number;
  /** `'submitted'` 的参与者数。 */
  submitted: number;
  /** **作答过**的（`drafted + submitted`）。「卡住」判据吃的就是它。 */
  engaged: number;
  /** 这一行的总格数 = 参与者数。 */
  total: number;
}

export function questionTallies(rows: MatrixRow[]): QuestionTally[] {
  return rows.map(rowTally);
}

/**
 * 此刻该讲哪一题。**五个变体**，每一句在屏幕上都是不同的话。
 *
 * 🔴 **卡住的那一题 = 在「已交 < 参与者数」的题里，已作答最多的那一道**（并列取最靠前）。
 * 为什么不是「未交最多」：一个班正在做第 2 题时，第 3–10 题全部「未交」= 100%，
 * 那个判据会把**还没讲到的题**误报成卡住 —— 而它看起来完全合理。
 * **已作答**（草稿也算）才分得开「停在这里」与「还没到」。
 *
 * ⚠️ `tally` 是**作答过的人数**（不是「答错的」）—— 矩阵不编码对错（规格 §3.4）。
 */
export type MatrixHeadline =
  | { kind: 'no-questions' }
  | { kind: 'no-participants' }
  | { kind: 'all-submitted' }
  | { kind: 'not-started' }
  | { kind: 'stuck'; questionId: string; index: number; tally: number; total: number };

export function matrixHeadline(tallies: QuestionTally[]): MatrixHeadline {
  if (tallies.length === 0) return { kind: 'no-questions' };
  const total = tallies[0].total;
  if (total === 0) return { kind: 'no-participants' };

  // 「还没交齐」的题。全部交齐时这一集合为空 —— 那不是「卡住」，是「做完了」。
  const open = tallies.filter((tally) => tally.submitted < total);
  if (open.length === 0) return { kind: 'all-submitted' };
  // 每一道还没交齐的题都没人动过 ⇒ 全班还没开始（不是卡在某一题）。
  if (open.every((tally) => tally.engaged === 0)) return { kind: 'not-started' };

  // ⚠️ 严格 `>` ⇒ 并列时**保留先遇到的那一个** = 题序最小的那一题。
  const stuck = open.reduce((best, tally) => (tally.engaged > best.engaged ? tally : best));
  return { kind: 'stuck', questionId: stuck.questionId, index: stuck.index, tally: stuck.engaged, total };
}

/**
 * 一行的计数。`questionTallies` 就是它逐行 `map` —— **同一份判据**。
 *
 * 🔴 存在的理由（独立审查抓到的）：组件原先在 JSX 里**自己又数了一遍**「已交 N/M」
 * （`filter(id => row.cells[id] === 'submitted')`），于是屏幕上的那个数字与用例断言的那个
 * **不是同一个函数**：今天两份实现逐字等价、三道门禁全绿，一旦有人改了口径，
 * **测试仍全绿而屏幕上的数字变了**。⇒ 屏幕也走这里（GC 26）。
 */
export function rowTally(row: MatrixRow): QuestionTally {
  const values = Object.values(row.cells);
  const drafted = values.filter((value) => value === 'draft').length;
  const submitted = values.filter((value) => value === 'submitted').length;
  return {
    questionId: row.questionId,
    index: row.index,
    drafted,
    submitted,
    engaged: drafted + submitted,
    total: values.length,
  };
}

/** 题干那一格的文案。**「算不算空」的判据只在这一处** —— JSX 里不许再 `trim()` 一次。 */
export function promptLabel(prompt: string): string {
  return prompt.trim() || '（这道题的题干还没写）';
}

/**
 * 没有任何一份学习单可作答的参与者数（屏幕上底部那一行）。
 *
 * ⚠️ 两个入参**必须取自同一时刻的快照**，否则这个减法会**静默漏报或误报** ——
 * 这是本函数唯一的坑，调用方（`page.tsx` 的矩阵重拉）要负责。
 */
export function uncoveredCount(participantCount: number, sheets: WorksheetBoardWorksheet[]): number {
  const covered = sheets.reduce((sum, sheet) => sum + sheet.participants.length, 0);
  // ⚠️ 钳在 0：两个快照取自不同时刻时差额**可以是负数**，而「另有 -1 个」是一句胡话。
  return Math.max(0, participantCount - covered);
}
