import { aiScoringConfigOf } from './analysis-scoring.js';
import { aiEvaluationEnabled } from './worksheet-evaluation.js';
import type { PrismaClient } from '@prisma/client';
import type { QuestionNode } from './worksheet-questions.js';

/** Quotas count successful student evaluations, not saves or teacher evaluations. */
export function individualReviewSettings(node: QuestionNode) {
  const raw = node.data.aiReviewLimit;
  return {
    enabled: (aiEvaluationEnabled(node) || (aiScoringConfigOf(node).enabled && node.autoGrade !== false)) && node.data.studentAiReviewEnabled === true,
    limit: typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 20 ? raw : 1,
  };
}

/** A process-wide bounded queue; external requests never hold a SQLite transaction. */
const queue: Array<() => Promise<void>> = [];
let running = 0;
export function enqueueIndividualReview(job: () => Promise<void>) {
  queue.push(job);
  const drain = () => {
    while (running < 2 && queue.length) {
      const next = queue.shift()!;
      running++;
      void next().catch(error => console.error('[individual-review]', error)).finally(() => { running--; drain(); });
    }
  };
  drain();
}

/** Quota changes unlock editing without invalidating an already running evaluation. */
export function reviewConfigurationKey(node: QuestionNode): string {
  const { aiReviewLimit: _limit, ...data } = node.data;
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
  const { studentAiReviewEnabled: _automatic, ...data } = node.data;
  return reviewConfigurationKey({ ...node, data });
}
