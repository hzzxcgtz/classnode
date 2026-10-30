import type { WorksheetQuestionNode } from '../../../lib/types';
import { flattenAnswerable } from '../../../lib/worksheet-questions.ts';
import { draftFromValue, isAudioNode, isDraftEmpty } from '../../../lib/worksheet-answer-value.ts';

/** A cleared audio answer is not the only unfinished recording: keep a useful preview. */
export function audioMonitorPreview(
  nodes: WorksheetQuestionNode[],
  rows: Array<{ questionId: string; value: unknown; savedAt?: string | null }>,
  draft: { questionId: string; value: unknown } | null,
  lastQuestionId: string | null,
): { questionId: string; value: unknown } | null {
  const items = flattenAnswerable(nodes);
  const selected = items.find(item => item.node.id === (draft?.questionId ?? lastQuestionId));
  if (!selected || !isAudioNode(selected.node)) return draft;
  const value = draft ? draft.value : rows.find(row => row.questionId === selected.node.id)?.value;
  if (!isDraftEmpty(draftFromValue(selected.node, value))) return draft;
  const recordings = rows.filter(row => {
    const node = items.find(item => item.node.id === row.questionId)?.node;
    return row.questionId !== selected.node.id && node && isAudioNode(node) && !isDraftEmpty(draftFromValue(node, row.value));
  }).sort((a, b) => (Date.parse(b.savedAt ?? '') || 0) - (Date.parse(a.savedAt ?? '') || 0));
  const recent = recordings[0];
  return recent ? { questionId: recent.questionId, value: recent.value } : draft;
}
