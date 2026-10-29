import type { WorksheetQuestionNode } from './types.ts';
import { evaluationImages, evaluationRequirements, hasEvaluation } from './worksheet-evaluation.ts';
import { blankSlots, fillSettingsFor, hasExplicitFillGrading, writeFillSettings, type FillBlankSetting } from './worksheet-fill-modes.ts';
import { readPromptRuns } from './worksheet-prompt-marks.ts';

/** Share only the rubric. Input modes, scoring switches and per-blank maxima stay independent. */
export function updateSharedFillEvaluation(settings: FillBlankSetting[], index: number, patch: Record<string, unknown>): FillBlankSetting[] {
  const before = settings[index];
  if (!before) return settings;
  const updated = {...before,...patch} as FillBlankSetting;
  if (updated.evaluationMode !== 'ai') return settings.map((item,at) => at === index ? updated : item);
  const source = before.evaluationMode !== 'ai'
    ? settings.find((item,at) => at !== index && hasEvaluation(item as unknown as Record<string,unknown>) && item.evaluationMode === 'ai') ?? updated
    : updated;
  const shared = {
    evaluationText:evaluationRequirements(source as unknown as Record<string,unknown>),
    evaluationImages:evaluationImages(source as unknown as Record<string,unknown>),
  };
  return settings.map((item,at) => {
    const next = at === index ? updated : item;
    return hasEvaluation(next as unknown as Record<string,unknown>) && next.evaluationMode === 'ai' ? {...next,...shared} : next;
  });
}

/** Preserve whole-question grading until the teacher explicitly converts it. */
export function needsWholeFillConversion(node: WorksheetQuestionNode, settings: FillBlankSetting[]): boolean {
  return (node.type === 'fill-blank' || node.type === 'choice-blank') && !hasEvaluation(node.data) && node.data.fillScoring !== 'per-blank' && !hasExplicitFillGrading(settings);
}

/** Resolve the target against current reducer state; uploads never replace other settings. */
export function appendQuestionEvaluationImages(node: WorksheetQuestionNode, urls: string[], blankId?: string): WorksheetQuestionNode {
  const append = (data: Record<string, unknown>, blank = false): Record<string, unknown> => {
    const mode = blank ? data.mode === 'audio' ? data.gradingMode === 'ai' ? 'ai' : 'collect' : data.gradingMode === 'none' || data.gradingMode === 'ai' ? 'collect' : 'answer' : data.aiScoringEnabled === true ? 'ai' : 'collect';
    const scored = blank ? node.autoGrade !== false && mode !== 'collect' : data.aiScoringEnabled === true;
    return { ...data, ...(!hasEvaluation(data) ? {
      evaluationVersion: 1, evaluationMode: mode, evaluationScored: scored,
      evaluationText: evaluationRequirements(data, blank ? undefined : node.data.answers),
      ...(blank ? {maxScore:typeof data.maxScore === 'number' ? data.maxScore : 1} : {aiScoringMaxScore:typeof data.aiScoringMaxScore === 'number' ? data.aiScoringMaxScore : 10}),
    } : {}), evaluationImages: evaluationImages({evaluationImages:[...evaluationImages(data),...urls]}) };
  };
  if (!blankId) return {...node,data:append(node.data)};
  const runs = readPromptRuns(node.data.promptRuns,node.prompt);
  const slots = blankSlots(node,runs), at = slots.findIndex(slot=>slot.id === blankId);
  if (at < 0) return node; // Deleted blanks must never be recreated by an upload completing late.
  const settings = fillSettingsFor(node,runs);
  const next = updateSharedFillEvaluation(settings,at,append(settings[at] as unknown as Record<string,unknown>,true));
  return {...node,data:{...node.data,fillBlankSettings:writeFillSettings(node,runs,next)}};
}

/** Only called by the explicit conversion button, after the new total is displayed. */
export function convertWholeFillSettings(node:WorksheetQuestionNode,settings:FillBlankSetting[],fullPoints:number):FillBlankSetting[] {
  return settings.map(setting=>{
    const scored=node.autoGrade!==false;
    return {...setting,gradingMode:scored?'auto':'none',maxScore:setting.maxScore ?? fullPoints,
      evaluationVersion:1,evaluationMode:scored?'answer':'collect',evaluationScored:scored,
      evaluationText:evaluationRequirements(setting as unknown as Record<string,unknown>),evaluationImages:evaluationImages(setting as unknown as Record<string,unknown>)};
  });
}
