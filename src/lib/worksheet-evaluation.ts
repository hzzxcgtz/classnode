/** Versioned evaluation settings. Reading historical data never changes saved grades or triggers. */
export type EvaluationMode = 'answer' | 'ai' | 'collect';
export interface EvaluationSettings {
  evaluationVersion?: 1;
  evaluationMode?: EvaluationMode;
  evaluationScored?: boolean;
  evaluationText?: string;
  evaluationImages?: string[];
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function evaluationRequirements(data: Record<string, unknown>, reference?: unknown): string {
  if (typeof data.evaluationText === 'string') return data.evaluationText;
  const parts: string[] = [];
  const criteria = text(data.audioCriteria) || text(data.rubricText) || text(data.aiScoringCriteria);
  if (criteria) parts.push(criteria);
  const examples = text(data.audioReference) || (Array.isArray(reference) ? reference.flat().filter(v => typeof v === 'string').join('\n') : '');
  if (examples) parts.push('参考内容：\n' + examples);
  const focus = text(data.analysisFocus);
  if (focus) parts.push('关注重点：\n' + focus);
  return parts.join('\n\n');
}
export function evaluationImages(data: Record<string, unknown>): string[] {
  const raw = Array.isArray(data.evaluationImages) ? data.evaluationImages : [data.rubricImageUrl];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && /^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[0-9a-f-]+\.(?:png|jpe?g|webp)$/i.test(v)))].slice(0, 6);
}
export function hasEvaluation(data?: Record<string, unknown>): boolean {
  return data?.evaluationVersion === 1 && ['answer', 'ai', 'collect'].includes(String(data.evaluationMode));
}
export function evaluationMode(data: Record<string, unknown>, legacy: EvaluationMode): EvaluationMode {
  return hasEvaluation(data) ? data.evaluationMode as EvaluationMode : legacy;
}
export function countsEvaluation(data: Record<string, unknown>): boolean {
  return data.evaluationMode !== 'collect' && data.evaluationScored === true;
}
export function aiEvaluationEnabled(node: {type: string; autoGrade?: boolean; data?: Record<string, unknown>}): boolean {
  const data = node.data ?? {};
  if (node.type === 'fill-blank' || node.type === 'choice-blank') return Object.values((data.fillBlankSettings as Record<string, Record<string, unknown>>) ?? {}).some(s => s && (hasEvaluation(s) ? s.evaluationMode === 'ai' : node.autoGrade !== false && s.mode === 'audio' && s.gradingMode === 'ai'));
  return hasEvaluation(data) ? data.evaluationMode === 'ai' : (node.type === 'short-answer' || node.type === 'drawing') && data.aiScoringEnabled === true;
}
