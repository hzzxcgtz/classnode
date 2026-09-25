import { readInkValue, type InkValue } from './ink-path.js';

/**
 * 「学习单与探究空间报告」的**判据层**（M6a）。
 *
 * 🔴 为什么它单独成文件：报告的 docx 渲染（`export-service.ts`）本机**验不了**（没有 Word），
 * 而纸上的每一句话都来自这里。判据住在这里 ⇒ 服务端的 `node --test` 跑得到，
 * 渲染层只剩「把模型画成段落」这一件事。
 *
 * 🔴 三条硬约束（本批的 Global Constraint 29–31）：
 *   · **不印正确答案** —— 本文件**不许**出现 `correctKeys` / `answers` / `explanation` /
 *     `correctOrder` / `pairs` / `placement` 任何一个键名（`ANSWER_KEYS`）。
 *   · **不印恒为 0 的列** —— 见 `webappUsageLineKeys`。
 *   · **走活的那条导出路** —— 那是接线的事，与这里无关。
 */

/* ── 评分三态 ─────────────────────────────────────────────────────────── */

/** 一档判分结论在纸上长什么样。四档，`未判分` **不是** `错`。 */
export type GradeLabel = '对' | '半对' | '错' | '未判分';

/**
 * 🔴 **必须读 `gradeState`，不能只读 `isCorrect`。**
 *
 * `isCorrect` 的语义已**收窄为「全对」**（规格 §12），所以 `false` **同时**覆盖
 * 「答错」与「半对」两件事 —— 只看它会把半对**印成错**，而那是一次对学生的错判。
 * 三态住在 `gradeState` 里（`correct` / `partial` / `incorrect`）。
 *
 * ⚠️ `gradeState` 缺失或认不出时**回落**到 `isCorrect`：升级前落库的旧行没有
 * `gradeState`（A1 的回填只补了新行那一段），那两档在旧行上仍然分得开。
 */
export function gradeLabel(row: { isCorrect: boolean | null; gradeState: string | null }): GradeLabel {
  if (row.gradeState === 'correct') return '对';
  if (row.gradeState === 'partial') return '半对';
  if (row.gradeState === 'incorrect') return '错';
  if (row.isCorrect === true) return '对';
  if (row.isCorrect === false) return '错';
  return '未判分';
}

/* ── 一格作答 ─────────────────────────────────────────────────────────── */

/**
 * 一格里放什么。
 *
 * ⚠️ **`cleared` 与 `unanswered` 是两件事**（规格 §3.5）：
 *   · `cleared` = 库里**有那一行**、而 `value` 是 `null` ⇒ 学生写了又**删干净了**；
 *   · `unanswered` = **压根没有那一行** ⇒ 他这一题没动过。
 * 合成一句话的后果是「他没做」与「他做了又删了」在纸上长得一样。
 */
export type AnswerCell =
  | { kind: 'text'; text: string }
  | { kind: 'ink'; ink: InkValue }
  | { kind: 'cleared' }
  | { kind: 'unanswered' };

/** 排序 / 连线 / 归类：值里存的是 **id**，对教师不可读 ⇒ 指一句，不印 id。 */
const COARSE_LABEL: Record<string, string> = {
  'order/v1': '（排序作答，请在系统中查看）',
  'match/v1': '（连线作答，请在系统中查看）',
  'categorize/v1': '（归类作答，请在系统中查看）',
};

/**
 * 把 `WorksheetAnswer.value` 那一列读成一格。
 *
 * 🔴 **不镜像教师抽屉的 `formatAnswer`**（`src/app/teacher/classroom/worksheet-drawer-state.ts`）。
 * 实测（`node --test` 探针，2026-09-25）：那个函数对 `order/v1` / `match/v1` / `categorize/v1`
 * **一律回 `null`** ⇒ 抽屉把**答过**的学生显示成「未作答」。镜像它 = 把这个缺陷抄到纸面上。
 * 报告这一侧对那三种给一句**指向性说明**（`COARSE_LABEL`），**不**顺手新写一个
 * id→标签解析器 —— 那会是第二份，而第一份还不存在（那个缺陷归它自己的批次）。
 *
 * 🔴 **认不出的形状不抛**：抛出去的后果是**整份导出失败**，而教师只看到「导出失败」
 * —— 一道手工改过的题可以让一整节课的报告导不出来。
 */
export function answerCell(value: unknown): AnswerCell {
  if (value === undefined) return { kind: 'unanswered' };
  if (value === null) return { kind: 'cleared' };
  // ⚠️ 先读笔迹：它**只认 `format`**，所以「教师把题从手写改回键盘」之后，
  //    学生**之前交的**那幅画仍然读得回来（与抽屉同一条纪律）。
  const ink = readInkValue(value);
  if (ink) return { kind: 'ink', ink };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'text', text: REPORT_TEXT.unreadable };
  }
  const row = value as Record<string, unknown>;
  const format = typeof row.format === 'string' ? row.format : '';
  if (COARSE_LABEL[format]) return { kind: 'text', text: COARSE_LABEL[format] };

  const strings = (raw: unknown): string[] | null =>
    Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? raw as string[] : null;

  if (format === 'choice/v1') {
    const selected = strings(row.selected);
    return selected && selected.length > 0
      ? { kind: 'text', text: selected.join('、') }
      : { kind: 'text', text: REPORT_TEXT.unreadable };
  }
  if (format === 'fill-multi/v1') {
    const texts = strings(row.texts);
    return texts ? { kind: 'text', text: texts.join(' / ') } : { kind: 'text', text: REPORT_TEXT.unreadable };
  }
  if (format === 'fill/v1' || format === 'text/v1') {
    // ⚠️ **不 `trim()` 后判空**：空白作答是「答了、内容是空」，与「未作答」不是一回事。
    return typeof row.text === 'string'
      ? { kind: 'text', text: row.text }
      : { kind: 'text', text: REPORT_TEXT.unreadable };
  }
  return { kind: 'text', text: REPORT_TEXT.unreadable };
}

/* ── 探究空间 ─────────────────────────────────────────────────────────── */

/**
 * 探究空间那一行的**列**（字段名即列名）。
 *
 * 🔴 **只有这四列**：`WebappUsage` 表里仍然有 `clicks` / `inputs` / `maxDepth` / `reports`，
 * 而 `recordWebappSummary` 早就不再写它们（`server/src/socket/index.ts` 的方法注释逐字写着
 * 「写入的列变少了…落库时走它们各自的 `@default(0)` ⇒ **值恒为 0**」）⇒ 印出去就是印四列 0。
 * 缺的那两样在报告里**如实说一句**（`REPORT_TEXT.webappNoteMissingCounters`）。
 *
 * ⚠️ 它是一个**函数**而不是只有类型，就是为了让这条约束**可被运行时断言**
 * （类型在运行期什么都不挡）。`worksheet-report.test.ts` 逐字钉着它。
 */
export function webappUsageLineKeys(): string[] {
  return ['webappName', 'participantName', 'durationMs', 'frameCount'];
}

export interface WebappUsageLine {
  webappName: string;
  participantName: string;
  durationMs: number;
  frameCount: number;
}

/**
 * 时长的人话。
 *
 * ⚠️ `0` 与「不足 1 秒」是两句不同的话：`durationMs` 是「首帧 → 末帧」推出来的，
 * **只采到 1 帧时它恒为 0** —— 那是「我们没采到」，不是「他没用过」。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒';
  if (ms < 1000) return '不足 1 秒';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours} 小时 ${Math.floor((totalSeconds - hours * 3600) / 60)} 分`;
}

/* ── 报告里那几句固定的话 ─────────────────────────────────────────────── */

/**
 * 报告里**所有**固定的句子，一处给全。
 *
 * 🔴 渲染层（`export-service.ts`）**不许自己写任何一句界面文案** —— 全部从这里取。
 * 理由与 M5b 的 GC 26 同源：写在渲染层里的字**没有任何回归网**，而本机验不了那份 docx。
 */
export const REPORT_TEXT = {
  /** 这间课堂没配学习单。 */
  noWorksheet: '本次课堂未使用学习单',
  /** 配了学习单但没有任何作答。 */
  noAnswers: '本次课堂没有收到任何作答',
  /** 没人用过探究空间。 */
  noWebapp: '本次课堂未使用探究空间',
  /** 没有那一行。 */
  unanswered: '未作答',
  /** 有那一行、值是 null（学生删干净了）。 */
  cleared: '（这一题被清空了）',
  /** 形状认不出来。 */
  unreadable: '（这一题的值读不出来）',
  /** 笔迹渲染不出图（`sharp` 不在）。**不是**留空。 */
  inkFallback: '（手写作答，本机无法渲染成图片）',
  /** 探究空间表下那句实话。 */
  webappNoteMissingCounters: '交互次数与滚动深度本轮暂不可得（该项统计已停采）',
} as const;

/** 高级模式下「没有可作答学习单」的那句附注（与 M5b 的矩阵同一条纪律）。 */
export function unmappedParticipantsNotice(count: number): string {
  return `另有 ${count} 个参与者没有可作答的学习单（高级模式下每组各自配置）`;
}

/* ── 题型名 ───────────────────────────────────────────────────────────── */

// 🔴 表在**另一个无 import 的文件**里：那份要能被前端 runner 直接加载（对拍用），
// 而本文件 import 了 `./ink-path.js` ⇒ Node 解析不了 ⇒ 本文件**不能**被前端加载。
export { QUESTION_TYPE_LABELS, questionTypeLabel } from './question-type-labels.js';
