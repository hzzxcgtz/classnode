import type { WorksheetQuestionNode } from './types.ts';
import { blankRuns, type PromptRun } from './worksheet-prompt-marks.ts';

export type FillAnswerMode = 'text' | 'pool' | 'inline';

export interface FillBlankSetting {
  mode: FillAnswerMode;
  choices: string[];
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
