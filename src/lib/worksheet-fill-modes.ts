import type { EvaluationSettings } from './worksheet-evaluation.ts';
import type { WorksheetQuestionNode } from './types.ts';
import { blankRuns, type PromptRun } from './worksheet-prompt-marks.ts';
import { blankLayout, cellAtSlot, cellLabel, tableBlankIds } from './worksheet-table.ts';
// ★ 2026-09-30：落词要按**判分口径**写进草稿（见 `placedValue`）。
import { mathText, splitMath } from './worksheet-math.ts';

/** 作答方式独立于评价方式。evaluationVersion=1 使用统一评价设置；缺失时沿用历史规则。 */
export type FillAnswerMode = 'text' | 'pool' | 'inline' | 'audio';

/** Legacy storage bridge. New records resolve evaluationMode/evaluationScored first. */
export type FillGradingMode = 'auto' | 'ai' | 'none';

/** 今天**唯一**会写出去的逐空评分方式（历史值的处置见 `FillGradingMode`）。 */
export const FILL_GRADING_MODE: FillGradingMode = 'auto';

/**
 * 这是**历史**的评分方式吗（`'ai'` / `'none'`）—— 一律不算分，编辑器要逐空提示教师改。
 *
 * ⚠️ `undefined` **不是**历史值：那表示「这道题压根没有逐空设置」，
 *    它走的是**题目级**规则（老题），别拿这个提示去打扰教师。
 */
export function isLegacyFillGrading(mode: FillGradingMode | undefined): mode is 'ai' | 'none' {
  return mode === 'ai' || mode === 'none';
}

export interface FillBlankSetting extends EvaluationSettings {
  mode: FillAnswerMode;
  /** 固定宽度以汉字字符计，固定模式缺省为 10。 */
  widthChars?: number;
  widthMode?: 'auto' | 'fixed';
  choices: string[];
  conditionalAnswer?: { sourceId: string; cases: { when: string; answer: string }[] };
  audioCriteria?: string;
  audioReference?: string;
  /** 逐空评分；缺失表示老题，继续走题目级评分规则。 */
  gradingMode?: FillGradingMode;
  /** 该空答对时的满额。图标奖励同样只能设置完整个数。 */
  maxScore?: number;
}

export function hasExplicitFillGrading(settings: readonly FillBlankSetting[]): boolean {
  return settings.some(setting => setting.gradingMode !== undefined);
}

/**
 * 这道题的逐空总分。
 *
 * ★ 2026-10-09：只剩下**一档**算分（`'auto'`），所以这里不再有「AI 那一档」这笔账。
 *    历史值（`'ai'` / `'none'`）**一分都不算**：计进去会凭空多出一笔**没人给的账**
 *    （它们在判分侧 `grade()` 里本来就不参与命中）。
 * ⚠️ 缺省值仍是 1（没设 `maxScore` 的老数据）—— 与判分侧 `explicitFillGrading` 的口径同源。
 */
export function fillGradingTotals(settings: readonly FillBlankSetting[]): { auto: number; total: number } {
  let auto = 0;
  settings.forEach((setting) => {
    const score = Number.isInteger(setting.maxScore) && (setting.maxScore ?? 0) > 0 ? setting.maxScore! : 1;
    if (setting.evaluationVersion === 1 ? setting.evaluationMode !== 'collect' && setting.evaluationScored === true : setting.gradingMode === 'auto' || (setting.mode === 'audio' && setting.gradingMode === 'ai')) auto += score;
  });
  return { auto, total: auto };
}

/** 编辑输入只使用半角竖线分隔；已保存的数组保持原有条目。 */
export const CHOICE_SEPARATORS = '|';
export const CHOICE_JOINER = ' | ';
export const CHOICE_SEPARATOR_HINT = '多个条目请用半角竖线 | 分隔，条目内可保留逗号、顿号等标点。';
export function splitChoiceText(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitChoiceLines(raw);
  return typeof raw === 'string' ? raw.split('|').map(item => item.trim()).filter(Boolean) : [];
}

export function sameChoiceItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function splitChoiceLines(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function storedSettings(node: WorksheetQuestionNode): Record<string, unknown> {
  const raw = node.data.fillBlankSettings;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/**
 * 这道题的**空的清单** —— 题干里的空在前、表格里的空在后（★ 2026-09-28，教师反馈）。
 *
 * 教师原话：「表格填空……和原来已有的题干和每个空的作答方式都完全割裂了……
 * 东跳跳西跳跳」。具体的一条是：`fillSettingsFor` 原来只遍历 `promptRuns` 的分段
 * ⇒ **一道表格题在「每个空的作答方式」那一块显示「题干中还没有填空域」**，
 * 而上面明明有一张表、里面标着空 —— 两块互相打脸。
 *
 * 🔴 顺序与**答案编号**同一条规则（题干在前、表格在后），所以
 * `slots[i]` 就是「第 i 个空」：标签用 `blankLabelAt`、身份用 `id`
 *（`fillBlankSettings` 的键）。三处一条规则，不会再各说各的。
 * ⚠️ `label` 由 `blankLabelAt` 给（有用例）—— 这里不自己拼「第几行第几格」。
 */
export interface BlankSlot {
  /** 空的身份 —— `fillBlankSettings` 的键，与题干里的空共用同一个命名空间。 */
  id: string;
  /** 它在哪：`第 2 空` / `第 2 行第 2 格`。 */
  label: string;
  kind: 'text' | 'table';
}

export function blankSlots(node: WorksheetQuestionNode, runs: PromptRun[]): BlankSlot[] {
  const textRuns = blankRuns(runs);
  // ⚠️ 把 `runs` 传进去：`blankLayout` 自己会读 `node.data.promptRuns`，两个来源
  // 一旦不是同一份，编号就会静默算错（这个坑我踩过一次）。
  const { tableBase } = blankLayout(node, runs);
  const tableIds = tableBlankIds(node.data.table);
  const slots: BlankSlot[] = [];
  // ① 标记**之前**的文本空
  textRuns.slice(0, tableBase).forEach((run, index) => {
    slots.push({ id: run.blank, label: `第 ${index + 1} 空`, kind: 'text' });
  });
  // ② 表格里的空（行优先）—— 插在中间了（★ 2026-09-28：表格域能插在题干中间）
  tableIds.forEach((id, index) => {
    const at = cellAtSlot(node.data.table, index);
    slots.push({
      id,
      label: at ? cellLabel(at.row, at.col) : `表格里的第 ${index + 1} 个空`,
      kind: 'table',
    });
  });
  // ③ 标记**之后**的文本空 —— 号接着表格往后数
  textRuns.slice(tableBase).forEach((run, index) => {
    slots.push({
      id: run.blank,
      label: `第 ${tableBase + tableIds.length + index + 1} 空`,
      kind: 'text',
    });
  });
  return slots;
}

function readConditionalAnswer(value: unknown): FillBlankSetting['conditionalAnswer'] {
  if (!value || typeof value !== 'object') return undefined;
  const { sourceId, cases } = value as Record<string, unknown>;
  if (typeof sourceId !== 'string' || !sourceId) return undefined;
  return {
    sourceId,
    cases: Array.isArray(cases) ? cases.filter((item): item is { when: string; answer: string } =>
      item !== null && typeof item === 'object' && typeof item.when === 'string' && typeof item.answer === 'string',
    ) : [],
  };
}

export function fillSettingsFor(node: WorksheetQuestionNode, runs: PromptRun[]): FillBlankSetting[] {
  const stored = storedSettings(node);
  const legacyChoices = splitChoiceLines(node.data.choices);
  const legacyInline = node.type === 'choice-blank' && node.data.choiceLayout === 'inline-pairs';
  // ⚠️ 下标用 `blankSlots` 的顺序：题干里的空在前（与 `blankRuns` 的下标逐位相同，
  //    所以下面那两处沿用它算「第几个空」的旧逻辑照旧成立），表格里的空在后面。
  return blankSlots(node, runs).map((slot, index) => {
    const raw = stored[slot.id];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      const mode: FillAnswerMode = item.mode === 'pool' || item.mode === 'inline' || item.mode === 'audio' ? item.mode : 'text';
      const gradingMode: FillGradingMode | undefined = item.gradingMode === 'auto' || item.gradingMode === 'ai' || item.gradingMode === 'none'
        ? item.gradingMode : undefined;
      const maxScore = typeof item.maxScore === 'number' && Number.isInteger(item.maxScore) && item.maxScore >= 1 && item.maxScore <= 99
        ? item.maxScore : undefined;
      return { ...item as unknown as FillBlankSetting, mode, choices: splitChoiceLines(item.choices), gradingMode, maxScore, conditionalAnswer: readConditionalAnswer(item.conditionalAnswer), ...(typeof item.audioCriteria === 'string' ? {audioCriteria:item.audioCriteria} : {}), ...(typeof item.audioReference === 'string' ? {audioReference:item.audioReference} : {}) };
    }
    // 表格里的空：缺省「手工填写」（v1 不给表格开选词 —— 存过的设置上面已经读到了）
    if (slot.kind === 'table') return { mode: 'text', choices: [] };
    if (node.type === 'choice-blank') {
      return legacyInline
        ? { mode: 'inline', choices: legacyChoices.slice(index * 2, index * 2 + 2) }
        : { mode: 'pool', choices: [] };
    }
    return { mode: 'text', choices: [] };
  });
}

/**
 * 把每个空的作答方式写回去。**按身份写**（`blankSlots` 的顺序给每份设置找到自己的空）。
 * ⚠️ 签名从 `(runs, settings)` 变成 `(node, runs, settings)`：表格里的空不在 `runs` 里，
 * 光看分段认不出它们。
 */
export function writeFillSettings(
  node: WorksheetQuestionNode,
  runs: PromptRun[],
  settings: FillBlankSetting[],
): Record<string, FillBlankSetting> {
  const result: Record<string, FillBlankSetting> = {};
  blankSlots(node, runs).forEach((slot, index) => {
    const setting = settings[index] ?? { mode: 'text' as const, choices: [] };
    result[slot.id] = {
      ...setting,
      mode: setting.mode,
      ...(setting.audioCriteria !== undefined ? {audioCriteria:setting.audioCriteria} : {}),
      ...(setting.audioReference !== undefined ? {audioReference:setting.audioReference} : {}),
      choices: splitChoiceLines(setting.choices),
      ...(setting.gradingMode ? { gradingMode: setting.gradingMode } : {}),
      ...(setting.maxScore ? { maxScore: setting.maxScore } : {}),
    };
  });
  return result;
}

export function sharedPoolChoices(node: WorksheetQuestionNode): string[] {
  return splitChoiceLines(node.data.fillChoicePool ?? node.data.choices);
}

/**
 * 学生**点/拖**一个候选词时，写进作答草稿的值（★ 2026-09-30）。
 *
 * 🔴 它必须是**判分口径**的词（剥掉公式定界符），不能是候选词的原文。
 *    根因：选择填空的学生**不打字** —— 他点的是**教师自己写的那个词**，`$` 是教师文本
 *    自带的。而判分侧（`gradableAnswers`）比的是剥离之后的文本 ⇒ 不剥的话
 *    **他点对了却判错**，而且屏幕上「他点的那个词」与「正确答案」都渲染成同一个公式，
 *    看起来一模一样 —— 本仓最防的那类静默错判。
 * ⚠️ 与「学生打 `$x=5$` 要判错」（裁定 ④ 的另一半）**不矛盾**：那说的是学生**手打**的
 *    字符，这里是教师文本的引用，两回事。
 * ⚠️ 没有公式的词一个字节都不动；不成公式的 `$`（「这本书 $5」）也原样保留 ——
 *    那一条由 `splitMath` 的安全阀保证，这里不另设规则。
 */
export function placedValue(word: string): string {
  return mathText(splitMath(word));
}


/** Older explicit numeric widths keep their fixed behavior; otherwise grow with content. */
export function fixedBlankWidth(setting: Pick<FillBlankSetting, 'widthMode' | 'widthChars'> | undefined): number | undefined {
  if (setting?.widthMode === 'auto') return undefined;
  if (setting?.widthMode !== 'fixed' && setting?.widthChars === undefined) return undefined;
  const width = setting?.widthChars;
  return typeof width === 'number' && Number.isInteger(width) && width >= 1 && width <= 100 ? width : 10;
}


/** The editor shows an explicit break marker; saved choices retain actual line breaks. */
export function choiceBreakEditorText(text: string): string {
  return text.replace(/\r\n?|\n/g, '↵');
}
export function choiceBreakValueText(text: string): string {
  return text.replace(/↵/g, '\n');
}
