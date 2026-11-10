import type { WorksheetAnalysisPayload } from './types';
import { completedReviewIds, missingReviewIds } from './worksheet-review-completion.ts';

export function worksheetAnalysisActions(payload: WorksheetAnalysisPayload | null, runningAction: 'incremental' | 'analysis' | 'regrade' | null = null) {
  const grading = payload?.aiScoring.enabled === true;
  const ungradedCount = grading && payload ? missingReviewIds(payload).length : 0;
  const reportVerb = payload?.narrative?.trim() ? '更新' : '生成';
  return {
    automatic: grading, ungradedCount, hasScores: payload ? completedReviewIds(payload).size > 0 : false,
    canRegrade: false, showRegrade: false, regradeLabel: '',
    primaryLabel: payload?.sectioned ? (reportVerb === '更新' ? '更新整题 AI 分析' : '整题 AI 分析') : `${reportVerb}全班分析`,
    hint: payload?.sectioned ? '按空或作答区分析，再汇总全班表现；保留已有个人评价。' : grading ? `学生提交后自动评价；可单独补评未成功的学生，${reportVerb}全班分析保留已有个人评价。` : '汇总全班作答并生成分析，不进行 AI 评分。',
    showSupplement: runningAction ? runningAction === 'incremental' : ungradedCount > 0,
    showAnalysis: runningAction ? runningAction === 'analysis' : true,
    canClearAiScores: payload?.canClearAiScores ?? grading,
  };
}
