import type { WorksheetAnalysisPayload } from './types';

type RunOptions = { only?: string[]; regrade?: boolean; analysisOnly?: boolean };

/** Keep supplementation and the following class summary in the same background task. */
export async function runWorksheetAnalysisSteps<T>(
  payload: WorksheetAnalysisPayload,
  input: RunOptions & { incremental?: boolean },
  run: (options: RunOptions) => Promise<T>,
  refresh: () => Promise<WorksheetAnalysisPayload>,
): Promise<T> {
  if (input.regrade || input.only?.length) return run(input);
  const scored = new Set((payload.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
  const unscorable = new Set(payload.unscorableIds ?? []);
  const missing = payload.entries.filter(row => !scored.has(row.studentId) && !unscorable.has(row.studentId)).map(row => row.studentId);
  if (input.incremental) {
    if (!missing.length) throw new Error('目前没有需要补评的已提交作品');
    return run({ only: missing });
  }
  if (payload.aiScoring.enabled && !payload.studentAiReviewEnabled && !input.analysisOnly && missing.length) {
    await run({ only: missing });
    // Include submissions arriving during supplementation in the subsequent summary.
    const updated = await refresh();
    if (!updated.canSend.ok) throw new Error(updated.canSend.reason);
  }
  return run({ analysisOnly: true });
}
