import type { ReactNode } from 'react';
import { ReviewBuddyHeading } from '@/components/review-buddy-heading';
import { ReviewRewardText } from '@/components/review-reward-text';

import { formatReviewText, formatReviewAdvice } from '@/lib/worksheet-review-display';
import type { AnswerReview } from './review-history';
import { ReviewTiming } from './review-timing';
import styles from './worksheet.module.css';

function feedbackSections(text: string) {
  const headings = [...text.matchAll(/^(第 (\d+) 空(?:（[^\n]*?）)?)：|^(作答区 (\d+) · [^\n]+)\n/gm)];
  if (headings[0]?.index !== 0) return [];
  return headings.map((match, index) => ({
    key: match[2] ? `blank-${match[2]}` : `region-${match[4]}`,
    title: match[1] ?? match[3],
    text: text.slice(match.index + match[0].length, headings[index + 1]?.index).trim(),
  }));
}

/** 所有题型共用评价与建议的呈现，逐空反馈保留原有换行。 */
export function AiReviewFeedback({ reason, advice, review, actions }: { reason?: string | null; advice?: string | null; review?: AnswerReview; actions?: ReactNode }) {
  if (!reason && !advice) return null;
  const assessments = feedbackSections(reason ?? '');
  const suggestions = feedbackSections(advice ?? '');
  const sectionKeys = [...new Set([...assessments, ...suggestions].map(section => section.key))];
  const grouped = sectionKeys.length > 1 && (!reason || assessments.length > 0) && (!advice || suggestions.length > 0);
  const renderFeedback = (assessment?: string | null, suggestion?: string | null) => <>
    {assessment && <div className={styles.aiFeedbackSection}>
      <strong>这次表现</strong>
      <p className={styles.aiScoreCommentText}><ReviewRewardText text={formatReviewText(assessment)} /></p>
    </div>}
    {suggestion && <div className={styles.aiScoreAdvice}>
      <strong>下一步可以怎么做</strong>
      <p>{formatReviewAdvice(suggestion)}</p>
    </div>}
  </>;
  return <aside className={`${styles.aiScoreComment} ${actions ? styles.aiScoreWithActions : ''}`} aria-label="AI 评价反馈">
    {actions && <div className={styles.aiScoreActions}>{actions}</div>}
    <div className={styles.aiScoreCommentBody}>
      <strong className={styles.aiScoreCommentHeading}><ReviewBuddyHeading /></strong>
      {review && <ReviewTiming review={review} />}
      {grouped ? sectionKeys.map(key => {
        const assessment = assessments.find(section => section.key === key);
        const suggestion = suggestions.find(section => section.key === key);
        return <details key={key} className={styles.aiFeedbackPart}>
          <summary>{assessment?.title ?? suggestion?.title}</summary>
          {renderFeedback(assessment?.text, suggestion?.text)}
        </details>;
      }) : renderFeedback(reason, advice)}
    </div>
  </aside>;
}
