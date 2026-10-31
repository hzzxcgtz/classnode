import type { ReactNode } from 'react';
import { ReviewBuddyHeading } from '@/components/review-buddy-heading';
import { ReviewRewardText } from '@/components/review-reward-text';

import { formatReviewText, formatReviewAdvice } from '@/lib/worksheet-review-display';
import type { AnswerReview } from './review-history';
import { ReviewTiming } from './review-timing';
import styles from './worksheet.module.css';

/** 所有题型共用评价与建议的呈现，逐空反馈保留原有换行。 */
export function AiReviewFeedback({ reason, advice, review, actions }: { reason?: string | null; advice?: string | null; review?: AnswerReview; actions?: ReactNode }) {
  if (!reason && !advice) return null;
  return <aside className={`${styles.aiScoreComment} ${actions ? styles.aiScoreWithActions : ''}`} aria-label="AI 评价反馈">
    {actions && <div className={styles.aiScoreActions}>{actions}</div>}
    <div className={styles.aiScoreCommentBody}>
      <strong className={styles.aiScoreCommentHeading}><ReviewBuddyHeading /></strong>
      {review && <ReviewTiming review={review} />}
      {reason && <p className={styles.aiScoreCommentText}><ReviewRewardText text={formatReviewText(reason)} /></p>}
      {advice && <div className={styles.aiScoreAdvice}>
        <strong><ReviewBuddyHeading advice size={28}/></strong>
        <p>{formatReviewAdvice(advice)}</p>
      </div>}
    </div>
  </aside>;
}
