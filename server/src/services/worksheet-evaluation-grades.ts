import { aiScoringConfigOf } from './analysis-scoring.js';
import { hasEvaluation, countsEvaluation } from './worksheet-evaluation.js';
import type { QuestionNode } from './worksheet-questions.js';

function slots(node:QuestionNode):Record<string,Record<string,unknown>> {
  const raw=node.data.fillBlankSettings;
  return raw && typeof raw==='object' && !Array.isArray(raw) ? raw as Record<string,Record<string,unknown>> : {};
}
export function hasVersionedEvaluation(node:QuestionNode):boolean {
  return hasEvaluation(node.data) || Object.values(slots(node)).some(hasEvaluation);
}
/** Legacy snapshots keep their historical policy; explicit new no-score settings do not. */
export function mayKeepPriorAiGrade(node:QuestionNode):boolean {
  if (!hasVersionedEvaluation(node)) return true;
  const config=aiScoringConfigOf(node);
  return config.enabled && config.maxScore>0;
}
/** Removing a scored part invalidates the aggregate, but never deletes review history. */
export function removedEvaluationScore(before:QuestionNode,next:QuestionNode):boolean {
  if (hasEvaluation(next.data) && !countsEvaluation(next.data)) return true;
  const previous=slots(before);
  return Object.entries(slots(next)).some(([id,item])=>{
    if (!hasEvaluation(item) || countsEvaluation(item)) return false;
    const old=previous[id];
    if (old && hasEvaluation(old)) return countsEvaluation(old);
    return before.autoGrade!==false && (!old || old.gradingMode===undefined || old.gradingMode==='auto' || (old.mode==='audio' && old.gradingMode==='ai'));
  });
}
