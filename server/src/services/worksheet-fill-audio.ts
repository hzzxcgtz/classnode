import { hasEvaluation, countsEvaluation } from './worksheet-evaluation.js';
import { readAudioAnswer, type AudioAnswer } from './worksheet-audio.js';

/** Settings are written in answer-slot order; audio values themselves use stable blank IDs. */
export function fillAudioSlots(node: { type: string; autoGrade?: boolean; data: Record<string, unknown> }) {
  if (node.type !== 'fill-blank') return [];
  const raw = node.data?.fillBlankSettings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([id, value], index) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (item.mode !== 'audio') return [];
    return [{ id, index, scored: hasEvaluation(item) ? countsEvaluation(item) && item.evaluationMode === 'ai' : node.autoGrade !== false && item.gradingMode === 'ai',
      maxScore: typeof item.maxScore === 'number' && Number.isInteger(item.maxScore) && item.maxScore >= 1 && item.maxScore <= 99 ? item.maxScore : 1,
      criteria: typeof item.audioCriteria === 'string' ? item.audioCriteria.trim() : '',
      reference: typeof item.audioReference === 'string' ? item.audioReference.trim() : '' }];
  });
}
export function readFillAudios(node: Parameters<typeof fillAudioSlots>[0], value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const audios = row.audios && typeof row.audios === 'object' && !Array.isArray(row.audios) ? row.audios as Record<string, unknown> : {};
  return fillAudioSlots(node).flatMap(slot => {
    const audio = readAudioAnswer(audios[slot.id]);
    return audio ? [{ ...slot, ...audio }] : [];
  });
}
export function findFillAudioValueError(node: Parameters<typeof fillAudioSlots>[0], value: unknown): string | null {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (row.audios === undefined) return null;
  if (row.format !== 'fill-multi/v1' || !row.audios || typeof row.audios !== 'object' || Array.isArray(row.audios)) return '填空录音格式无效，请重新录音';
  const slots = new Set(fillAudioSlots(node).map(slot => slot.id));
  for (const [id, audio] of Object.entries(row.audios)) {
    if (!slots.has(id) || !readAudioAnswer(audio)) return '录音与当前填空不匹配，请刷新后重新录音';
  }
  return null;
}
export type FillAudioMap = Record<string, AudioAnswer>;
