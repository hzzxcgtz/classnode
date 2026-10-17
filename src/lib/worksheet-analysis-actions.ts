import type { WorksheetAnalysisPayload } from './types';

/** Button policy follows the current question setting and valid, scorable results. */
export function worksheetAnalysisActions(payload: WorksheetAnalysisPayload | null, runningAction: 'incremental' | 'analysis' | 'regrade' | null = null) {
  const grading = payload?.aiScoring.enabled === true;
  const canClearAiScores = payload?.canClearAiScores ?? grading;
  const automatic = grading && payload?.studentAiReviewEnabled === true;
  const scored = new Set((payload?.perStudent?.scores ?? []).filter(row => row.score !== null).map(row => row.studentId));
  const unscorable = new Set(payload?.unscorableIds ?? []);
  const ungradedCount = grading && !automatic ? (payload?.entries ?? []).filter(row => !scored.has(row.studentId) && !unscorable.has(row.studentId)).length : 0;
  const reportVerb = payload?.narrative?.trim() ? '更新' : '生成';
  const primaryLabel = automatic
    ? `${reportVerb}全班分析`
    : grading ? `${ungradedCount > 0 ? '补评并' : ''}${reportVerb}班级分析`
    : `${reportVerb}全班分析`;
  const regradeLabel = `重评并${reportVerb}班级分析`;
  const hint = automatic
    ? `学生提交后自动评分；${reportVerb}全班分析只${reportVerb}班级总结，不改动个人评分。`
    : grading ? (ungradedCount > 0 ? `先补评未评分学生，再${reportVerb}全班总结。` : `${reportVerb}班级总结，保留已有评分。`)
    : '汇总全班作答并生成分析，不进行 AI 评分。';
  const canRegrade = grading && !automatic && scored.size > 0;
  // 中途收到一批评分只更新结果，不让操作按钮随批次增减。
  const showSupplement = runningAction ? runningAction === 'incremental' : ungradedCount > 0;
  const showAnalysis = runningAction ? runningAction === 'analysis' : true;
  const showRegrade = runningAction ? runningAction === 'regrade' : canRegrade;
  return { automatic, ungradedCount, hasScores: scored.size > 0, canRegrade, primaryLabel, regradeLabel, hint, showSupplement, showAnalysis, showRegrade, canClearAiScores };
}
