import type { WorksheetQuestionNode } from './types.ts';
import { blankRuns, type PromptRun } from './worksheet-prompt-marks.ts';

export type FillAnswerMode = 'text' | 'pool' | 'inline';

export interface FillBlankSetting {
  mode: FillAnswerMode;
  choices: string[];
}

/**
 * **单行**输入框里那一串 → 条目表（★ 2026-09-28，教师）。**待选词与标准答案共用它。**
 *
 * 教师第一轮原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示
 * 使用常见的符号分隔即可。」第二轮（看到我按含义区分了两套分隔符之后）：
 * 「我说的是**常见符号提示都能用**，不要光是分号、顿号、逗号……」
 *
 * 🔴 **于是两种输入共用这一个分隔符集合**（曾经分成两套，被教师否掉）：
 *   顿号、逗号（中英文）、分号（中英文）、斜杠、竖线、换行。
 *   ⚠️ **代价要记住**：既然这些都算分隔，「小明、小红」这种**本身含标点的答案**
 *   会被拆成两个可接受答案 ⇒ 学生答出半句也算对。教师知情并选择了这个便利
 *   （我上一轮按「答案是短语、词是词」分成两套，被否了）。
 *   ⇒ 所以**提示必须写出来**（见 `question-card.tsx` 里「标准答案」那句块说明）：
 *     教师猜错分隔符的表现是**静默的判分变化**，而屏幕上什么都看不出来。
 *
 * 🔴 **只用在输入这一侧。** 读库那一侧（`fillSettingsFor` / `sharedPoolChoices`）
 * 仍然走 `splitChoiceLines` —— 让**读**也按逗号切，会把库里一个含逗号的词条
 * 悄悄切成两个，而那是**数据变更**（存进去的是「甲,乙」一个词，读出来变两个）。
 *
 * ⚠️ **空格不是分隔符**：「New York」是一个词。教师说的也是「符号」。
 * ⚠️ 数组直接交给 `splitChoiceLines`（它已经是一份条目表了，再切一次就是重复解析）。
 */
export function splitChoiceText(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitChoiceLines(raw);
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[、，,；;/|｜\r\n]+/)
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
