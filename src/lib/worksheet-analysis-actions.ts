import type { WorksheetAnalysisPayload } from './types';

/** Button policy follows the current question setting and valid, scorable results. */
export function worksheetAnalysisActions(payload: WorksheetAnalysisPayload | null) {
  const grading = payload?.aiScoring.enabled === true;
  const automatic = grading && payload?.studentAiReviewEnabled === true;
  const scored = new Set((payload?.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
  const unscorable = new Set(payload?.unscorableIds ?? []);
  const ungradedCount = grading && !automatic ? (payload?.entries ?? []).filter(row => !scored.has(row.studentId) && !unscorable.has(row.studentId)).length : 0;
  const primaryLabel = automatic
    ? (payload?.narrative ? '更新全班分析' : '生成全班分析')
    : grading ? (ungradedCount > 0 ? '补评并更新班级分析' : '更新班级分析')
    : (payload?.narrative ? '更新全班分析' : '生成全班分析');
  const hint = automatic
    ? '学生提交后自动评分；更新全班分析只更新班级总结，不改动个人评分。'
    : grading ? (ungradedCount > 0 ? '先补评未评分学生，再更新全班总结。' : '更新班级总结，保留已有评分。')
    : '汇总全班作答并生成分析，不进行 AI 评分。';
  return { automatic, ungradedCount, hasScores: scored.size > 0, canRegrade: grading && !automatic && scored.size > 0, primaryLabel, hint };
}
