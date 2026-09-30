/**
 * 「题目开放方式」四档的**归一化**与**学生端闸门**（★ 2026-09-30）。
 *
 * ── 为什么单独一个文件 ───────────────────────────────────────────────────
 * 这一段判据原先**内联在学生面板里**（`worksheet-panel.tsx` 的三元分支），零回归网；
 * 而本次要加第四档（教师手动逐题开放）。加一档要同时改四处，每一处漏改都**不报错**：
 *   · 归一化（三份内联副本：编辑器两条读路径 + 学生面板一条）；
 *   · 闸门的分支；
 *   · 末尾那句「怎么解锁」的提示语（漏改 ⇒ 手动档会对学生说「完成当前小题后继续解锁」，
 *     而明明什么都没得做 —— 一句**假话**，屏幕上没有任何异常）。
 * ⇒ 判据搬到这里，`node --test` 直接钉（先例：`worksheet-prompt-marks.ts`）。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`，也不得出现正则 lookbehind。
 */
import type { WorksheetAnswerMode } from './types';
import type { AnswerableGroup } from './worksheet-questions';

/**
 * 作答状态里**本文件唯一读**的那一个值。
 *
 * 🔴 写成常量而不是从 `app/` 引类型：`lib/` **不许依赖 `app/`**（方向问题），
 * 而 `WorksheetQuestionStatus` 住在 `app/classroom/worksheet/use-worksheet-answers.ts`。
 * ⇒ 这里按**结构**收（`Record<string, string>`），只认这一个字面量。
 * ⚠️ 代价：那个字面量哪天在 `app/` 里被改名，这里会**静默**把每一道题都当成「没交」
 *（表现：分步档下学生永远只看到第一个任务）。`worksheet-answer-mode.test.ts` 有一条
 * 跨文件用例去读那个类型声明、钉住这个字面量。
 */
export const SUBMITTED_STATUS = 'submitted';

/** 作答状态表。值域见上面那条注释 —— 本文件只关心「等不等于 `submitted`」。 */
export type AnswerStatusMap = Readonly<Record<string, string | undefined>>;

/**
 * 四档的取值域。**唯一一份** —— 归一化与（服务端那份同名数组）都从这里对齐。
 *
 * ── 四档各自是谁在推进 ────────────────────────────────────────────────────
 *   · `open`           —— 没人推进：一打开就全部可作答；
 *   · `task-step`      —— **学生**推进：交了当前任务，下一个任务才出现；
 *   · `question-step`  —— **学生**推进：交了当前小题，下一小题才出现；
 *   · `manual`         —— **教师**推进：只有老师在「逐题开放」里开过的那几道是可作答的。
 * 🔴 `manual` 与上面两种分步是**两个方向**：那两种看 `statuses`（谁交了），
 *    这一种**不看** `statuses`（老师说了算）。把两者混起来会导致「学生交了才出现」
 *    这种谁也没要求过的行为。
 */
export const WORKSHEET_ANSWER_MODES: readonly WorksheetAnswerMode[] = [
  'open', 'task-step', 'question-step', 'manual',
];

/**
 * 把库里/线缆上那个值收成四档之一。认不出的（老数据、手改过的行、将来的第五档）
 * 一律回 **`open`** —— 那是「什么都不拦」的那一档，与 `normalizeSettings` 的兜底同向：
 * 一个设置读不出来时，学生的屏幕**不该**因此被锁上。
 */
export function normalizeAnswerMode(value: unknown): WorksheetAnswerMode {
  return typeof value === 'string' && (WORKSHEET_ANSWER_MODES as readonly string[]).includes(value)
    ? value as WorksheetAnswerMode
    : 'open';
}

/**
 * 末段那句提示语要用的「怎么解锁」。
 *
 * 🔴 它是**判据的一部分**，不是文案细节：四档各有各的解锁条件，写错的那一档会对学生
 * 说一句他做不到的事（手动档说「完成当前小题后继续解锁」是最典型的）。
 * ⚠️ 返回值是**半句话**（渲染侧前面还要说「后面还有 N 道小题」），空串 = 不渲染那半句。
 */
export function unlockHintFor(answerMode: WorksheetAnswerMode): string {
  if (answerMode === 'task-step') return '完成当前任务后继续解锁';
  if (answerMode === 'question-step') return '完成当前小题后继续解锁';
  if (answerMode === 'manual') return '老师还没开放后面的题';
  return '';
}

/**
 * 把「已开放的题 id」收干净 —— 缺字段 / 坏形状 / 重复一律处理掉。
 *
 * 🔴 它有两个来路，**两个都是外部输入**：`student-view` 那次读取、以及 socket 上那条
 * 广播（`worksheet-open-changed`）。少了它，一条坏载荷会让 `Set` 里混进非字符串，
 * 而表现只是「学生那一屏少了几道题」—— 屏幕上看不出是数据坏了。
 * ⚠️ 缺字段（老服务端不发这一格）⇒ **空数组**：那是「老师还没开放任何题」，
 * 而 `manual` 档下它意味着学生看到一句「老师还没开放后面的题」而不是一片空白。
 */
export function normalizeOpenQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item === '') continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export interface AnswerModeViewInput {
  /** 这一份单的全部段（`studentVisibleGroups` 的产物）。 */
  groups: AnswerableGroup[];
  /** 作答状态（`useWorksheetAnswers` 的 `statuses`）。`manual` 档不看它。 */
  statuses: AnswerStatusMap;
  answerMode: WorksheetAnswerMode;
  /**
   * 教师已开放的题 id（`manual` 档专用）。
   * ⚠️ 其它三档**一律忽略它** —— 老师哪天把模式从「手动」改回「开放式」，
   *    那些还留在库里的 id 不该继续起作用（否则学生会看到一份莫名其妙被截断的卷子）。
   */
  openQuestions: readonly string[];
}

export interface AnswerModeView {
  /** 学生此刻该看到的段（顺序与入参**逐项相同**，只做过滤）。 */
  groups: AnswerableGroup[];
  /** 被挡住的**小题**数（渲染「后面还有 N 道小题」用）。 */
  hiddenCount: number;
  /** 那半句解锁说明（空串 = 不渲染）。 */
  unlockHint: string;
}

/**
 * 学生此刻能看到哪几段、几道题。
 *
 * ⚠️ **只做过滤，不重排**：`manual` 档下老师可以跳着开（先开第 3 题再开第 1 题），
 * 而屏幕上的顺序永远是**题目的顺序** —— 按开放次序重排会让学生看到的卷子与老师
 * 手里那张对不上号。
 * ⚠️ 空白段的处理与 `studentVisibleGroups` 同一条：过滤之后一段都不剩的段**整个去掉**
 *（留一个只有标题的空壳会让那个任务看起来坏了）。
 */
export function answerModeView(input: AnswerModeViewInput): AnswerModeView {
  const { groups, statuses, answerMode, openQuestions } = input;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const done = (visible: AnswerableGroup[]): AnswerModeView => {
    const shown = visible.reduce((sum, group) => sum + group.items.length, 0);
    return { groups: visible, hiddenCount: total - shown, unlockHint: unlockHintFor(answerMode) };
  };

  if (answerMode === 'task-step') {
    // 当前任务 = 第一个**还有没交的题**的任务。它前面的都做完了 ⇒ 全部留给他们看
    //（做过的不许缩回去，否则学生回头检查时会以为自己的答案没了）。
    const current = groups.findIndex(group =>
      group.items.some(({ node }) => statuses[node.id] !== SUBMITTED_STATUS));
    if (current < 0) return done(groups);          // 全交完了 ⇒ 一道都不藏
    return done(groups.slice(0, current + 1));
  }

  if (answerMode === 'question-step') {
    // 一路放行到**第一道没交的题**（含它），再往后全挡。
    let reached = false;
    const visible = groups
      .map(group => ({
        ...group,
        items: group.items.filter(({ node }) => {
          if (reached) return false;
          if (statuses[node.id] !== SUBMITTED_STATUS) reached = true;
          return true;
        }),
      }))
      .filter(group => group.items.length > 0);
    return done(visible);
  }

  if (answerMode === 'manual') {
    // 🔴 **不看 `statuses`**（见上面 `WORKSHEET_ANSWER_MODES` 那段）。
    const open = new Set(openQuestions);
    const visible = groups
      .map(group => ({ ...group, items: group.items.filter(({ node }) => open.has(node.id)) }))
      .filter(group => group.items.length > 0);
    return done(visible);
  }

  return done(groups);
}
