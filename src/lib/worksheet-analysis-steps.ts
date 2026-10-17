import type { WorksheetAnalysisPayload } from './types';

type RunOptions = { only?: string[]; regrade?: boolean; analysisOnly?: boolean };

/** Keep supplementation and the following class summary in the same background task. */
export async function runWorksheetAnalysisSteps<T>(
  payload: WorksheetAnalysisPayload,
  input: RunOptions & { incremental?: boolean },
  run: (options: RunOptions) => Promise<T>,
  refresh: () => Promise<WorksheetAnalysisPayload>,
  onProgress: (message: string) => void = () => {},
): Promise<T> {
  if (input.regrade || input.only?.length) return run(input);
  const scored = new Set((payload.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
  const unscorable = new Set(payload.unscorableIds ?? []);
  const missing = payload.entries.filter(row => !scored.has(row.studentId) && !unscorable.has(row.studentId)).map(row => row.studentId);
  const verifySupplement = async () => {
    onProgress('正在核对补评结果，请稍等…');
    const updated = await refresh();
    const completed = new Set((updated.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
    const remaining = missing.filter(id => updated.entries.some(row => row.studentId === id) && !completed.has(id));
    if (remaining.length) throw new Error(`补评尚未完成：仍有 ${remaining.length} 位学生未取得有效评分，已取得的评分已保留。`);
    return updated;
  };
  // 每人都要返回评价和建议，整班一次输出容易超出模型回复长度。
  const supplement = async () => {
    let result!: T;
    for (let offset = 0; offset < missing.length; offset += 8) {
      onProgress(`正在补评未评学生（第 ${Math.floor(offset / 8) + 1}/${Math.ceil(missing.length / 8)} 批），请稍等…`);
      result = await run({ only: missing.slice(offset, offset + 8) });
    }
    return result;
  };
  if (input.incremental) {
    if (!missing.length) throw new Error('目前没有需要补评的已提交作品');
    const result = await supplement();
    await verifySupplement();
    return result;
  }
  if (payload.aiScoring.enabled && !payload.studentAiReviewEnabled && !input.analysisOnly && missing.length) {
    await supplement();
    // Include submissions arriving during supplementation in the subsequent summary.
    const updated = await verifySupplement();
    if (!updated.canSend.ok) throw new Error(updated.canSend.reason);
  }
  const reportVerb = payload.narrative?.trim() ? '更新' : '生成';
  onProgress(missing.length && !input.analysisOnly && !payload.studentAiReviewEnabled
    ? `补评已完成，正在${reportVerb}班级分析，请稍等…`
    : `正在${reportVerb}班级分析，请稍等…`);
  return run({ analysisOnly: true });
}
