import { cellNumberOf } from './worksheet-analysis-cells.ts';

/** 标签中的学号只用于列表展示；原始格号始终按联系表条目顺序计算。 */
export function scoreParticipantMeta(entries: ReadonlyArray<{ studentId: string; anonLabel: string }>, studentId: string) {
  const hit = cellNumberOf(entries, studentId);
  const number = hit?.anonLabel.match(/#([^#]+)$/)?.[1] ?? null;
  return { cell: hit?.cell ?? null, number };
}

export function sortAnalysisScores<T extends { studentId: string }>(scores: readonly T[], entries: ReadonlyArray<{ studentId: string; anonLabel: string }>): T[] {
  const numberOf = (id: string) => scoreParticipantMeta(entries, id).number;
  return [...scores].sort((a, b) => {
    const left = numberOf(a.studentId), right = numberOf(b.studentId);
    if (left && right) return left.localeCompare(right, 'zh-CN', { numeric: true });
    return left ? -1 : right ? 1 : 0;
  });
}
