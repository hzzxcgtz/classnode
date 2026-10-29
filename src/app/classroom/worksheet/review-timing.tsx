import type { AnswerReview } from './review-history';
import { reviewDurationLabel, reviewSourceLabel } from '@/lib/worksheet-review-display';
import styles from './worksheet.module.css';

export function ReviewTiming({ review }: { review: AnswerReview }) {
  if (!review.evaluatedAt) return null;
  const duration = reviewDurationLabel(review.evaluationDurationMs);
  return <span className={styles.reviewTiming}>{reviewSourceLabel(review.source)} · 最近评价：{new Date(review.evaluatedAt).toLocaleString('zh-CN')}{duration ? ` · 耗时 ${duration}` : ' · 耗时未记录'}</span>;
}
