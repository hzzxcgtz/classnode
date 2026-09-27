import type { WorksheetQuestionNode } from './types.ts';
import { blankRuns, type PromptRun } from './worksheet-prompt-marks.ts';

export type FillAnswerMode = 'text' | 'pool' | 'inline';

export interface FillBlankSetting {
  mode: FillAnswerMode;
  choices: string[];
}

/**
 * **单行**输入框里那一串词 → 词表（★ 2026-09-28，教师）。
 *
 * 教师原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示使用
 * 常见的符号分隔即可。」⇒ 输入框从多行 textarea 变成单行，于是解析要认常见的分隔符：
 * **顿号、逗号（中英文）、分号（中英文）、换行**。
 *
 * 🔴 **只用在输入这一侧。** 读库那一侧（`fillSettingsFor` / `sharedPoolChoices`）
 * 仍然走 `splitChoiceLines` —— 让**读**也按逗号切，会把库里一个含逗号的词条
 * 悄悄切成两个，而那是**数据变更**（存进去的是「甲,乙」一个词，读出来变两个）。
 *
 * ⚠️ **空格不是分隔符**：「New York」是一个词。教师说的也是「符号」。
 * ⚠️ 数组直接交给 `splitChoiceLines`（它已经是一份词表了，再切一次就是重复解析）。
 */
export function splitChoiceText(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitChoiceLines(raw);
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[、，,；;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * **标准答案**那一栏的单行输入 → 可接受答案表（★ 2026-09-28，教师第二轮）。
 *
 * 教师原话：「这里也改成单行了，而且可以使用哪些符号间隔，要提示一下。」
 *
 * 🔴 **为什么与 `splitChoiceText` 不是同一套分隔符**：
 *   待选词是「词」（内部不会有标点），而答案是**短语** ——「小明、小红」是一个答案、
 *   「先洗菜，再切菜」也是一个。照待选词那套（顿号/逗号都切）走，这两条会被
 *   **悄悄拆成两个可接受答案** ⇒ 学生答「小明」就得满分，而教师**看不到任何异常**
 *   （单行框里重新拼接之后长得一模一样）。那是静默的判分变化，本仓最防的那一类。
 *   ⇒ 只用**分号**（中英文）与换行 —— 中文标点规范里分号正是干这件事的
 *   「分隔已经用了逗号的并列成分」。
 *
 * ⚠️ `\n` 在 `<input>` 里进不来（HTML 会把换行从 value 里去掉），留着它是防**粘贴**：
 *   教师从别处粘一行一个答案的文本时，照样能认。
 */
export function splitAnswerText(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitChoiceLines(raw);
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[；;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

export function fillSettingsFor(node: WorksheetQuestionNode, runs: PromptRun[]): FillBlankSetting[] {
  const stored = storedSettings(node);
  const legacyChoices = splitChoiceLines(node.data.choices);
  const legacyInline = node.type === 'choice-blank' && node.data.choiceLayout === 'inline-pairs';
  return blankRuns(runs).map((run, index) => {
    const raw = stored[run.blank];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      const mode: FillAnswerMode = item.mode === 'pool' || item.mode === 'inline' ? item.mode : 'text';
      return { mode, choices: splitChoiceLines(item.choices) };
    }
    if (node.type === 'choice-blank') {
      return legacyInline
        ? { mode: 'inline', choices: legacyChoices.slice(index * 2, index * 2 + 2) }
        : { mode: 'pool', choices: [] };
    }
    return { mode: 'text', choices: [] };
  });
}

export function writeFillSettings(runs: PromptRun[], settings: FillBlankSetting[]): Record<string, FillBlankSetting> {
  const result: Record<string, FillBlankSetting> = {};
  blankRuns(runs).forEach((run, index) => {
    const setting = settings[index] ?? { mode: 'text' as const, choices: [] };
    result[run.blank] = { mode: setting.mode, choices: splitChoiceLines(setting.choices) };
  });
  return result;
}

export function sharedPoolChoices(node: WorksheetQuestionNode): string[] {
  return splitChoiceLines(node.data.fillChoicePool ?? node.data.choices);
}
