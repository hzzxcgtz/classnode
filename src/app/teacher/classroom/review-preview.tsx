'use client';
import { ReviewBuddyHeading } from '@/components/review-buddy-heading';
import { ReviewRewardText } from '@/components/review-reward-text';

import { useState } from 'react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { REWARD_STYLE_OPTIONS, pointsUnitLabel } from '@/lib/worksheet-reward';
import { formatReviewText, formatReviewAdvice } from '@/lib/worksheet-review-display';
import { FullscreenPreview } from './fullscreen-preview';
import styles from './fullscreen-preview.module.css';

export function ReviewPreviewButton({ title = 'AI 评价与建议', reason, advice, score, maxScore, unit, note, annotationId, onOpen }: {
  onOpen?: () => void; title?: string; reason?: string | null; advice?: string | null; score?: number | null; maxScore?: number; unit?: string; note?: string; annotationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fontSize, setFontSize] = useState(24);
  if (!reason && !advice) return null;
  const reward = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit);
  const showRewardIcons = !!reward && score !== null && score !== undefined && Number.isInteger(score) && maxScore !== undefined && Number.isInteger(maxScore) && maxScore > 0 && maxScore <= 20;
  return <>
    <button type="button" className={styles.expand} aria-label="全屏查看评价" title="全屏查看评价" onClick={() => { onOpen?.(); setFontSize(24); setOpen(true); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
    </button>
    {open && <FullscreenPreview allowAnnotations textSize={fontSize} annotationKey={JSON.stringify(['review', annotationId, title, reason, advice, score, maxScore, unit, note])} title={title} onClose={() => setOpen(false)} controls={<>
      <div className={styles.fontTools}><span className={styles.toolLabel}>文字大小</span>
      <button type="button" onClick={() => setFontSize(size => Math.max(18, size - 2))} disabled={fontSize <= 18} aria-label="缩小评价文字">A−</button>
      <output aria-label="当前文字大小">{fontSize}<small>px</small></output>
      <button type="button" onClick={() => setFontSize(size => Math.min(48, size + 2))} disabled={fontSize >= 48} aria-label="放大评价文字">A＋</button>
      </div>
      <span className={styles.hint}>上下滚动查看全文 <kbd>Esc</kbd> 退出</span>
    </>}>
      <div className={styles.textViewport} role="region" tabIndex={0} aria-label="AI 评价与建议全文">
        <article className={styles.review} style={{ fontSize:'var(--preview-text-size, 24px)' }}>
          {(score !== undefined && score !== null || note) && <div className={styles.reviewMeta}>
            {score !== undefined && score !== null && <div className={styles.rewardSummary}>
              <span className={styles.rewardLabel}>本次获得</span>
              {showRewardIcons ? <span className={styles.rewardIcons} role="img" aria-label={`获得 ${score} / ${maxScore} ${unit ?? ''}`}>
                {Array.from({ length: maxScore! }, (_, index) => <RewardIcon key={index} kind={reward!.value} state={index < score ? 'earned' : 'empty'} size={36} />)}
              </span> : null}
              <span className={styles.rewardCount}>{score}<span> / {maxScore ?? '—'} {unit ?? '分'}</span></span>
            </div>}
            {note && <p className={styles.reviewNote}>{note}</p>}
          </div>}
          {reason && <section><h3><ReviewBuddyHeading size={40}/></h3><p><ReviewRewardText text={formatReviewText(reason)} /></p></section>}
          {advice && <section><h3><ReviewBuddyHeading advice size={40}/></h3><p>{formatReviewAdvice(advice)}</p></section>}
        </article>
      </div>
    </FullscreenPreview>}
  </>;
}
