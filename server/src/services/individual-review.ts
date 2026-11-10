import { aiScoringConfigOf } from './analysis-scoring.js';
import { wordCloudRequirementsOf } from './analysis-feedback.js';
import { aiEvaluationEnabled } from './worksheet-evaluation.js';
import { canvasAutoReviewIds } from './worksheet-image-canvas.js';
import type { PrismaClient } from '@prisma/client';
import type { QuestionNode } from './worksheet-questions.js';

/** Quotas count successful student evaluations, not saves or teacher evaluations. */
export function individualReviewSettings(node: QuestionNode) {
  if (node.type === 'image-canvas') return { enabled: canvasAutoReviewIds(node).length > 0, limit: Infinity };
  const raw = node.data.aiReviewLimit;
  return {
    enabled: (aiEvaluationEnabled(node) || (aiScoringConfigOf(node).enabled && node.autoGrade !== false)),
    limit: typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 20 ? raw : 1,
  };
}

/** Quota and class-only settings do not invalidate an individual evaluation. */
export function reviewConfigurationKey(node: QuestionNode): string {
  const { aiReviewLimit: _limit, studentAiReviewEnabled: _automatic, wordCloudRequirements: _cloud, ...data } = node.data;

  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical({ ...node, data }));
}

/** Called once before the HTTP server starts; no page visit is required for recovery. */
export async function recoverInterruptedReviews(prisma: PrismaClient) {
  return prisma.worksheetAnswerReview.updateMany({ where: { status: 'pending' }, data: { status: 'failed', error: '服务已重启，评价被中断，可重新尝试，不扣次数' } });
}

/** Class analysis may continue across a student-review switch, but not a rubric change. */
export function classAnalysisConfigurationKey(node: QuestionNode): string {
  return JSON.stringify([reviewConfigurationKey(node), wordCloudRequirementsOf(node)]);
}


export function worksheetReviewAgentIds(settings: unknown): string[] {
  const config = settings as Record<string, unknown> | null;
  const primary = config?.analysisAgentId;
  if (typeof primary !== 'string' || !primary) return [];
  const additional: unknown[] = Array.isArray(config?.additionalReviewAgentIds) ? config.additionalReviewAgentIds : [];
  return [...new Set([primary, ...additional.filter((id): id is string => typeof id === 'string' && !!id)])].slice(0, 3);
}
