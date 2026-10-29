import { ReviewRewardText } from '@/components/review-reward-text';

import { formatReviewText, formatReviewAdvice } from '@/lib/worksheet-review-display';
import type { AnswerReview } from './review-history';
import { ReviewTiming } from './review-timing';
import styles from './worksheet.module.css';

function AiFeedbackIcon({ advice = false }: { advice?: boolean }) {
  if (!advice) return <img src="/logo.png" alt="" className={styles.aiFeedbackIcon} />;
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={styles.aiFeedbackIcon}>
      <path d="M11 21c0-3-4-4.5-4-10a9 9 0 0 1 18 0c0 5.5-4 7-4 10" fill="#fff0ae" stroke="#bb862b" strokeWidth="1.8" />
      <path d="M12 23h8m-7 4h6m-6-12 3 3 3-3m-3 3v4" stroke="#bb862b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="11" r="1" fill="#926520" /><circle cx="19" cy="11" r="1" fill="#926520" />
    </svg>
  );
}


/** 所有题型共用评价与建议的呈现，逐空反馈保留原有换行。 */
export function AiReviewFeedback({ reason, advice, review }: { reason?: string | null; advice?: string | null; review?: AnswerReview }) {
  if (!reason && !advice) return null;
  return <aside className={styles.aiScoreComment} aria-label="AI 评价反馈">
    <span className={styles.aiScoreCommentMark}><AiFeedbackIcon /></span>
    <div className={styles.aiScoreCommentBody}>
      <strong className={styles.aiScoreCommentHeading}>AI 给你的评价</strong>
      {review && <ReviewTiming review={review} />}
      {reason && <p className={styles.aiScoreCommentText}><ReviewRewardText text={formatReviewText(reason)} /></p>}
      {advice && <div className={styles.aiScoreAdvice}>
        <strong><AiFeedbackIcon advice />小建议</strong>
        <p>{formatReviewAdvice(advice)}</p>
      </div>}
    </div>
  </aside>;
}
