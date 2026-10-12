'use client';
import { useId, useState } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { AnswerViewBody } from '@/app/teacher/classroom/answer-view';
import styles from './worksheet.module.css';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { REWARD_STYLE_OPTIONS, pointsUnitLabel } from '@/lib/worksheet-reward';
import { formatReviewAdvice, reviewDurationLabel, reviewSourceLabel } from '@/lib/worksheet-review-display';

export interface AnswerReview {
  id: string; questionId: string; value: unknown;
  status: 'submitted' | 'pending' | 'succeeded' | 'failed' | 'superseded'; source: string;
  phase?: 'queued' | 'running' | null;
  canRetry?: boolean; retryBlockedReason?: string | null;
  score: number | null; maxScore: number; unit: string;
  reason: string | null; advice: string | null; error: string | null;
  createdAt: string; evaluatedAt: string | null; evaluationDurationMs?: number | null;
}
export function ReviewHistory({ node, reviews, onRetry }: { node: WorksheetQuestionNode; reviews: AnswerReview[]; onRetry?: (id: string) => void | Promise<void> }) {
  const accordionName = useId();
  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (id: string) => {
    if (retrying || !onRetry) return;
    setRetrying(id);
    try { await onRetry(id); } finally { setRetrying(null); }
  };
  const records = reviews.filter(r => r.status !== 'submitted');
  if (!records.length) return null;
  return <section className={styles.reviewHistory} aria-label="提交与评价记录">
    <h4 className={styles.reviewHistoryHeading}>提交与评价记录 · {records.length} 条</h4>
    {records.map((r, index) => <details key={r.id} name={accordionName} className={styles.reviewRevision} onToggle={event => {
      if (event.currentTarget.open) event.currentTarget.parentElement?.querySelectorAll<HTMLDetailsElement>('details').forEach(item => { if (item !== event.currentTarget) item.open = false; });
    }}>
      <summary className={styles.reviewRevisionSummary}>
        <span className={styles.reviewRevisionIdentity}><strong>{reviewSourceLabel(r.source)}{r.source === 'student' ? ` · 第 ${records.slice(index).filter(item => item.source === 'student').length} 次` : ''}</strong><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString('zh-CN')}</time></span>
        <span className={styles.reviewRevisionResult}>{(r.status === 'succeeded' || r.status === 'superseded') ? <ReviewReward score={r.score} maxScore={r.maxScore} unit={r.unit} /> : r.status === 'pending' ? (r.phase === 'queued' ? '等待评价' : '正在评价') : '评价失败'}</span>
        <span className={styles.reviewRevisionChevron} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7" /></svg></span>
      </summary>
      <div className={styles.reviewRevisionBody}>
      {r.evaluatedAt && <ReviewTiming review={r} />}

      <AnswerViewBody node={node} value={r.value} />
      {r.status === 'superseded' && <p role="status">{r.error || '历史结果，不计入当前成绩和评价次数'}</p>}
      {r.reason && <p><strong>AI 评价：</strong>{r.reason}</p>}
      {r.advice && <p><strong>修改建议：</strong>{formatReviewAdvice(r.advice)}</p>}
      {r.status === 'failed' && <ReviewFailure review={r} onRetry={onRetry && r.canRetry !== false && r.id === reviews.find(item => item.source === 'student')?.id ? () => retry(r.id) : undefined} retrying={retrying !== null} />}
      </div>
    </details>)}
  </section>;
}

export function ReviewFailure({ review, onRetry, retrying = false }: { review: AnswerReview; onRetry?: () => void | Promise<void>; retrying?: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const busy = retrying || requesting;
  const retry = async () => {
    if (busy || !onRetry) return;
    setRequesting(true);
    try { await onRetry(); } finally { setRequesting(false); }
  };
  return <div className={styles.reviewFailure} role="status">
    <p>{review.error || '本次评价未完成，作品已经保存。'}<span className={styles.reviewFailureHint}>{review.retryBlockedReason || '本次未扣评价次数，作品已保存。'}</span></p>
    {onRetry && <button type="button" className={styles.submitButton} disabled={busy} onClick={() => void retry()}>{busy ? '正在重试…' : '重试评价'}</button>}
  </div>;
}

export function ReviewTiming({ review }: { review: AnswerReview }) {
  if (!review.evaluatedAt) return null;
  const duration = reviewDurationLabel(review.evaluationDurationMs);
  return <span className={styles.reviewTiming}>{reviewSourceLabel(review.source)} · 最近评价：{new Date(review.evaluatedAt).toLocaleString('zh-CN')}{duration ? ` · 耗时 ${duration}` : ' · 耗时未记录'}</span>;
}
function ReviewReward({ score, maxScore, unit }: { score: number | null; maxScore: number; unit: string }) {
  const style = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit)?.value;
  if (!style) return <span>{score}/{maxScore} {unit}</span>;
  const count = Math.min(10, Math.max(0, Math.floor(maxScore)));
  return <span className={styles.reviewReward} aria-label={`${score}/${maxScore} ${unit}`}>
    {Array.from({ length: count }, (_, index) => <RewardIcon key={index} kind={style} state={index < (score ?? 0) ? 'earned' : 'empty'} size={24} />)}
    {maxScore > 10 && <span>{score}/{maxScore}</span>}
  </span>;
}
