import type { WorksheetQuestionNode } from './types.ts';
import { blankSlots, fillSettingsFor, fillWholeScore, type FillBlankSetting } from './worksheet-fill-modes.ts';
import { readPromptRuns } from './worksheet-prompt-marks.ts';
import { mathText, splitMath } from './worksheet-math.ts';
import { bestFillCombination, normalizeFillText, readFillAnswerCombinations } from '../../server/src/services/fill-answer-combinations.ts';
export { readFillAnswerCombinations, MAX_FILL_ANSWER_COMBINATIONS } from '../../server/src/services/fill-answer-combinations.ts';
export type { FillAnswerCombination } from '../../server/src/services/fill-answer-combinations.ts';

export function isCombinationBlank(setting: FillBlankSetting): boolean {
  return setting.mode !== 'audio' && (setting.evaluationVersion === 1
    ? setting.evaluationMode === 'answer' && setting.evaluationScored === true
    : setting.gradingMode !== 'ai' && setting.gradingMode !== 'none');
}

/** Keep answer cells attached to blank IDs when the prompt or table changes. */
export function reconcileFillCombinations(raw: unknown, ids: string[]): Record<string, unknown> {
  const combinations = readFillAnswerCombinations(raw);
  if (!combinations.length) return {};
  return { fillAnswerCombinations: ids.length ? combinations.map(item => ({
    id: item.id, answers: Object.fromEntries(ids.map(id => [id, item.answers[id] ?? []])),
  })) : undefined };
}

/** Teacher answer comparison must use the same whole combination as server grading. */
export function selectFillCombination(node: WorksheetQuestionNode, texts: string[], base: string[][]): { answers: string[][]; index: number } {
  const extra = readFillAnswerCombinations(node.data.fillAnswerCombinations);
  if (!extra.length) return { answers: base, index: 0 };
  const runs = readPromptRuns(node.data.promptRuns, node.prompt);
  const slots = blankSlots(node, runs);
  const settings = fillSettingsFor(node, runs);
  const explicit = settings.length > 0 && settings.every(setting => ['auto', 'ai', 'none'].includes(setting.gradingMode ?? ''));
  const whole = fillWholeScore(node.data) !== undefined || node.data.fillScoring === 'whole';
  const weights = slots.map((_, i) => explicit ? isCombinationBlank(settings[i]) ? whole ? 1 : settings[i].maxScore ?? 1 : 0 : 1);
  const candidates = [{ answers: base, index: 0 }, ...extra.map((item, index) => ({
    answers: slots.map((slot, i) => weights[i] ? item.answers[slot.id] ?? [] : base[i] ?? []), index: index + 1,
  }))];
  const display = (value: string, i: number) => {
    const setting = settings[i];
    const choice = setting?.mode === 'pool' || setting?.mode === 'inline'
      || (!(node.data.fillBlankSettings as Record<string, unknown> | undefined)?.[slots[i]?.id] && (Array.isArray(node.data.fillChoicePool) || Array.isArray(node.data.choices)));
    return normalizeFillText(choice ? value.replace(/[\r\n]+/g, '') : value);
  };
  const selected = bestFillCombination(candidates, weights, (candidate, i) => Boolean(texts[i]?.trim())
    && (candidate.answers[i] ?? []).some(answer => display(mathText(splitMath(answer)), i) === display(texts[i], i)));
  return { ...selected, answers: selected.answers.map((answers, i) => weights[i] > 0 ? answers : []) };
}
