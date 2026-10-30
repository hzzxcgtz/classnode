import type { WorksheetAnalysisPayload } from './types';
/** Feedback-only success has a null score; pending jobs must not be submitted twice. */
export function completedReviewIds(payload: WorksheetAnalysisPayload): Set<string> {
  return new Set((payload.perStudent?.scores ?? []).filter(row => row.score !== null || (payload.aiScoring.maxScore === 0 && Boolean(row.reason?.trim()) && Boolean(row.advice?.trim()))).map(row => row.studentId));
}
export function missingReviewIds(payload: WorksheetAnalysisPayload): string[] {
  const completed = completedReviewIds(payload);
  const excluded = new Set([...(payload.unscorableIds ?? []), ...(payload.pendingReviewIds ?? [])]);
  return payload.entries.filter(row => !completed.has(row.studentId) && !excluded.has(row.studentId)).map(row => row.studentId);
}
