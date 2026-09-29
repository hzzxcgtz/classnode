// ⚠️ **相对路径 + `.ts` 后缀**：本文件要被 `node --test` 直接跑（与 `worksheet-matrix.ts` 同一条写法）。
import { flattenAnswerable, questionTypeLabel } from '../../../lib/worksheet-questions.ts';
import type { WorksheetBoardAnswerRow, WorksheetBoardWorksheet, WorksheetQuestionNode } from '@/lib/types';

/**
 * 统计面板里**「学习单」与「探究空间」两页**要显示的那几个数（★ 2026-09-29，教师第 5 条）。
 *
 * 教师原话：「这个对话分析原来是针对智能学伴设计的，这个需要保留。但是对于学习单和探究空间
 * 这两个模块，也需要有相应的快捷统计信息，这样的话，三个模块就在**统一的位置**，由用户来
 * 切换显示哪个统计内容，切换的方式可以使用 Tab 方式……至于学习单和探究空间里需要统计的信息，
 * 你先根据你的思考帮我实现一个**初稿**，然后我在这个初稿的基础上进行优化。」
 *
 * ⇒ **这是初稿**（教师会在它上面改），所以这里的形状刻意做得「一个数一个字段」：
 * 调整口径时改的是这一层（有用例），JSX 那边只负责排。
 *
 * ── 🔴 两条纪律（与整个看板同源）──────────────────────────────────────────
 *   ① **只读 `gradeState`，绝不重算对错**（`rowVerdict` 那一套）：填空有多个可接受答案、
 *      排序有容错 —— 重算一份必然与判分器分叉，而屏幕上只是「数字不太对」。
 *   ② **每个比例都要写得出分母**：所以返回的是一条条计数，**不返回百分比** ——
 *      除法交给界面，而界面必须把分母一起画出来（本仓反复栽在分母口径上）。
 */

/** 一道题在全班这一侧的四个数（`graded` = 有判分结论的那些）。 */
export interface ClassQuestionRow {
  questionId: string;
  /** 两级题号（`任务二 · 1`），与矩阵/抽屉/学生端同源。 */
  heading: string;
  typeLabel: string;
  /** 这道题**已提交**的人数。 */
  submitted: number;
  /** 判分结论的分布（只数有结论的行）。 */
  correct: number;
  partial: number;
  wrong: number;
  /** `correct + partial + wrong`。`0` ⇒ 这道题还没有任何判分数据。 */
  graded: number;
  /** 这一行的总格数 = 参与者数。 */
  total: number;
}

export interface WorksheetClassSummary {
  worksheetId: string;
  title: string;
  /** 参与者数（**分母**：分组模式下是组数，量词由界面按课堂 mode 定）。 */
  participants: number;
  /** 至少有**一行**作答记录的人数（「有作答记录」而不是「开始作答」—— 有行就是有动作）。 */
  engaged: number;
  /** 已提交的「题 × 人」格数。 */
  submittedPairs: number;
  /** 总格数 = 题数 × 参与者数。 */
  totalPairs: number;
  /** 题数。 */
  questions: number;
  /** 逐题四个数（**顺序 = 题目树顺序**）。 */
  rows: ClassQuestionRow[];
}

/** 一行作答的判分结论 —— **只读 `gradeState`**，不重算（见文件头纪律 ①）。 */
function verdictOf(row: WorksheetBoardAnswerRow): 'correct' | 'partial' | 'incorrect' | null {
  const state: unknown = row.gradeState;
  if (state === 'correct' || state === 'partial' || state === 'incorrect') return state;
  return null;
}

/**
 * 一份学习单在全班这一侧的摘要。
 *
 * ⚠️ **分组 / 高级模式下每个组可以是不同的学习单**（规格 §2.2），所以这一个函数只算**一份**；
 * 界面按 `board.worksheets` 逐份调用（标准模式下就只有一份，自然退化成一块）。
 * 把多份混在一起算会让「第 3 题」指向几张不同的题 —— 那种错在屏幕上完全看不出来。
 */
export function worksheetClassSummary(
  worksheet: WorksheetBoardWorksheet,
  nodes: WorksheetQuestionNode[] | null,
): WorksheetClassSummary {
  const items = nodes ? flattenAnswerable(nodes) : [];
  const participants = worksheet.participants;
  /** 题 id → 这一题的四个数（**先按题目树建行**，所以一道没人动过的题也在）。 */
  const byQuestion = new Map<string, ClassQuestionRow>();
  for (const { node, heading } of items) {
    byQuestion.set(node.id, {
      questionId: node.id, heading, typeLabel: questionTypeLabel(node.type),
      submitted: 0, correct: 0, partial: 0, wrong: 0, graded: 0, total: participants.length,
    });
  }

  let submittedPairs = 0;
  let engaged = 0;
  for (const participant of participants) {
    if (participant.answerRows.length > 0) engaged += 1;
    for (const row of participant.answerRows) {
      const target = byQuestion.get(row.questionId);
      // ⚠️ 认不出的题 id **丢掉**（不是新建一行）：那是一道已经不在学习单里的题
      //（教师删过题），给它建行会让「题数」与实际不符，而屏幕上照样画得出来。
      if (!target) continue;
      // 🔴 **判分结论只数已提交的行** —— 与按题统计那一层（`worksheet-question-stats.ts`）
      // **逐字同一条口径**：草稿还在变，把它的 `gradeState` 混进来会让分布一直跳；
      // 而且那个结论是学生**上一次**提交时算的（他现在正在改），拿它说「他做错了」是旧账。
      // ⚠️ 两处口径分家的后果是「同一份数据在统计面板与按题浮层里是两个数」，都不报错。
      if (row.status !== 'submitted') continue;
      target.submitted += 1;
      submittedPairs += 1;
      const verdict = verdictOf(row);
      if (verdict === 'correct') { target.correct += 1; target.graded += 1; }
      else if (verdict === 'partial') { target.partial += 1; target.graded += 1; }
      else if (verdict === 'incorrect') { target.wrong += 1; target.graded += 1; }
    }
  }

  return {
    worksheetId: worksheet.id,
    title: worksheet.title,
    participants: participants.length,
    engaged,
    submittedPairs,
    totalPairs: items.length * participants.length,
    questions: items.length,
    rows: items.map((item) => byQuestion.get(item.node.id)!),
  };
}

/**
 * 「最需要讲的题」—— 取前 `limit` 条，**判据分两档**（这一条是初稿里最需要教师拍板的地方）：
 *
 *   · **有判分数据** ⇒ 按**答错人数降序**（并列时按题目树顺序）。那是「讲一讲最有用的题」
 *     最直接的度量，而且它只在**已提交**的行上有值（草稿没有判分结论）。
 *   · **一道题的判分数据都没有**（没开自动评分、或这份学习单只有主观题）⇒ 按**未提交人数
 *     降序**。⚠️ 这一档是**必需的**：那时「答错人数」全是 0，按它排等于**按题序取前三**，
 *     而屏幕上会写成「最需要讲的题」—— 那是编出来的结论。
 *
 * `mode` 一并返回，界面据此**把那句话写对**（「错得最多的题」/「最多人没交的题」）。
 */
export function needsAttentionQuestions(
  summary: WorksheetClassSummary,
  limit = 3,
): { mode: 'byWrong' | 'byUnsubmitted'; rows: ClassQuestionRow[] } {
  const graded = summary.rows.some((row) => row.graded > 0);
  const sorted = summary.rows.slice().sort((a, b) => (
    graded
      ? (b.wrong - a.wrong) || (b.graded - a.graded)
      : (b.total - b.submitted) - (a.total - a.submitted)
  ));
  // ⚠️ 只取**真的有信号**的那些：全对、且全班都交了的题不该出现在「需要讲」里。
  const useful = sorted.filter((row) => (graded ? row.wrong > 0 : row.submitted < row.total));
  return { mode: graded ? 'byWrong' : 'byUnsubmitted', rows: useful.slice(0, limit) };
}

/* ── 探究空间那一页 ──────────────────────────────────────────────────── */

/** 一个学生此刻的探究状态（`use-webapp-monitor` 的 `StudentMonitorState` 里这一页用得着的部分）。 */
export interface ExploreStudentState {
  dataUrl: string | null;
  /** 学生设备已放弃采集（不会自愈）。 */
  captureBlocked: boolean;
  presence: { webappId: string; visible: boolean; depth: number; switches: number } | null;
}

export interface ExploreClassSummary {
  /** 参与者数（分母）。 */
  participants: number;
  /** 已有画面的（收到过至少一帧）。 */
  withFrame: number;
  /** **此刻在前台**看着网页的。 */
  opened: number;
  /** 设备放弃了采集的 —— 与「画面还没到」是两件事（后者会自愈）。 */
  blocked: number;
  /** 此刻在看的那些网页各有多少人（按人数降序；同一网页多人则合并）。 */
  viewing: Array<{ webappId: string; count: number; minDepth: number }>;
  /** 可见性切换最多的前 `switchLimit` 个人（按次数降序）。「切来切去」是分心的信号。 */
  switchy: Array<{ studentId: string; switches: number }>;
}

/**
 * 探究空间在全班这一侧的摘要。
 *
 * ⚠️ 返回的 `webappId` / `studentId` 是**裸 id**：名字由界面查（它才有名册与网页表）。
 * 在这里顺手把名字查出来就等于把「谁知道谁叫什么」也搬进这一层，而那一份名字在别处
 * 已经有了（两处各存一份名字必然分叉）。
 */
export function exploreClassSummary(
  studentIds: readonly string[],
  states: Readonly<Record<string, ExploreStudentState | undefined>>,
  switchLimit = 3,
): ExploreClassSummary {
  let withFrame = 0;
  let opened = 0;
  let blocked = 0;
  const byWebapp = new Map<string, { count: number; minDepth: number }>();
  const switchy: Array<{ studentId: string; switches: number }> = [];

  for (const studentId of studentIds) {
    const state = states[studentId];
    if (!state) continue;
    if (state.dataUrl) withFrame += 1;
    if (state.captureBlocked) blocked += 1;
    const presence = state.presence;
    if (!presence) continue;
    if (presence.visible) {
      opened += 1;
      const current = byWebapp.get(presence.webappId);
      byWebapp.set(presence.webappId, {
        count: (current?.count ?? 0) + 1,
        // 取**最浅**的那一个：它答的是「这个网页上还有人是没往下看的」。
        minDepth: current === undefined ? presence.depth : Math.min(current.minDepth, presence.depth),
      });
    }
    // ⚠️ 切换次数不按「此刻是否可见」筛：切走的人恰恰是那个数大的。
    if (presence.switches > 0) switchy.push({ studentId, switches: presence.switches });
  }

  return {
    participants: studentIds.length,
    withFrame,
    opened,
    blocked,
    viewing: [...byWebapp.entries()]
      .map(([webappId, value]) => ({ webappId, count: value.count, minDepth: value.minDepth }))
      .sort((a, b) => b.count - a.count),
    switchy: switchy.sort((a, b) => b.switches - a.switches).slice(0, switchLimit),
  };
}

/* ── 那个 Tab 栏本身 ─────────────────────────────────────────────────── */

/**
 * 统计面板的三个 Tab（★ 2026-09-29，教师给的顺序就是三件套的顺序）。
 *
 * 🔴 标签放这里而不是写进 JSX：一个 Tab 丢掉或改了名字，屏幕上只是「少一个页签」——
 * 没有任何东西会红（与 `WORKSHEET_MENU_ITEMS` 同一条理由）。
 */
export const STATS_TABS: ReadonlyArray<{ id: 'companion' | 'worksheet' | 'explore'; label: string }> = [
  { id: 'companion', label: '智能学伴' },
  { id: 'worksheet', label: '学习单' },
  { id: 'explore', label: '探究空间' },
];
