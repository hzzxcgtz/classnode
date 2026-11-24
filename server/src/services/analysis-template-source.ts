import { EXTERNAL_ANALYSIS_TEMPLATE, ANALYSIS_PROMPT_VERSION } from './analysis-teaching-policy.js';

const STAGES = ['primary', 'middle'];
const SUBJECTS = ['chinese', 'math', 'english', 'science', 'information-technology', 'general'];
const templateIds = new Set(['universal', ...STAGES.flatMap(stage => SUBJECTS.map(subject => `${stage}-${subject}`))]);

/** Older clients can still request their original template IDs. */
export function readAnalysisTemplate(id: string) {
  if (!templateIds.has(id)) return undefined;
  return { text: EXTERNAL_ANALYSIS_TEMPLATE, version: ANALYSIS_PROMPT_VERSION };
}
