'use client';
import { useReviewSpeech } from './use-review-speech';
import { IconMessageSearch } from '@tabler/icons-react';
import { ReviewBuddyHeading } from '@/components/review-buddy-heading';
import { ReviewRewardText } from '@/components/review-reward-text';

import { useState, type ReactNode } from 'react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { REWARD_STYLE_OPTIONS, pointsUnitLabel } from '@/lib/worksheet-reward';
import { formatReviewText, formatReviewAdvice } from '@/lib/worksheet-review-display';
import { FullscreenPreview } from './fullscreen-preview';
import styles from './fullscreen-preview.module.css';

export interface ReviewPreviewProps {
  title?: string; reason?: string | null; advice?: string | null; score?: number | null; maxScore?: number; unit?: string; note?: string; annotationId?: string;
}
export function ReviewPreviewButton(props: ReviewPreviewProps & {onOpen?:()=>void; openExternally?:()=>void}) {
 const [open,setOpen]=useState(false);
 if(!props.reason&&!props.advice)return null;
 return <><button type="button" className={styles.expand} aria-label="放大讲评AI评价与建议" title="放大讲评 AI 评价与建议" onClick={()=>{props.onOpen?.();if(props.openExternally)props.openExternally();else setOpen(true);}}><IconMessageSearch size={18} stroke={1.7} aria-hidden="true"/></button>{open&&<ReviewFullscreen {...props} onClose={()=>setOpen(false)}/>}</>;
}
export function ReviewFullscreen({title='AI 评价与建议',reason,advice,score,maxScore,unit,note,annotationId,onClose,onSwitch,viewTabs,visible = true}:ReviewPreviewProps & {viewTabs?:ReactNode;visible?:boolean;onClose:()=>void;onSwitch?:()=>void}) {
 const [fontSize,setFontSize]=useState(24);
 const speech=useReviewSpeech(reason??'',advice??'',visible,annotationId??title);
  const reward = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit);
  const showRewardIcons = !!reward && score !== null && score !== undefined && Number.isInteger(score) && maxScore !== undefined && Number.isInteger(maxScore) && maxScore > 0 && maxScore <= 20;
  return <FullscreenPreview viewTabs={viewTabs} visible={visible} switchAnimation floatingControls compactControls allowAnnotations textSize={fontSize} annotationKey={JSON.stringify(['review', annotationId, title, reason, advice, score, maxScore, unit, note])} title={title} onClose={onClose} quickAction={!viewTabs&&onSwitch&&<button onClick={onSwitch}>查看作答</button>} controls={<>
      <div className={styles.fontTools}>
      <button type="button" onClick={() => setFontSize(size => Math.max(18, size - 2))} disabled={fontSize <= 18} aria-label="缩小评价文字">A−</button>
      <output aria-label="当前文字大小">{fontSize}<small>px</small></output>
      <button type="button" onClick={() => setFontSize(size => Math.min(48, size + 2))} disabled={fontSize >= 48} aria-label="放大评价文字">A＋</button>
      </div>
    </>}>
      <div className={styles.textViewport} role="region" tabIndex={0} aria-label="AI 评价与建议全文">
        <article className={styles.review} style={{ fontSize:'var(--preview-text-size, 24px)' }}>
          <div className={styles.reviewSpeechTop}><div>{(score !== undefined && score !== null || note) && <div className={styles.reviewMeta}>
            {score !== undefined && score !== null && <div className={styles.rewardSummary}>
              <span className={styles.rewardLabel}>本次获得</span>
              {showRewardIcons ? <span className={styles.rewardIcons} role="img" aria-label={`获得 ${score} / ${maxScore} ${unit ?? ''}`}>
                {Array.from({ length: maxScore! }, (_, index) => <RewardIcon key={index} kind={reward!.value} state={index < score ? 'earned' : 'empty'} size={36} />)}
              </span> : null}
              <span className={styles.rewardCount}>{score}<span> / {maxScore ?? '—'} {unit ?? '分'}</span></span>
            </div>}
            {note && <p className={styles.reviewNote}>{note}</p>}
          </div>}</div>{speech.controls('all')}</div>
          {speech.error&&<p className={styles.reviewSpeechError} role="status">{speech.error}</p>}
          {reason && <section className={speech.activePart==='reason'?styles.reviewSpeechActive:undefined}><h3><ReviewBuddyHeading size={40}/>{speech.controls('reason')}</h3><p><ReviewRewardText text={formatReviewText(reason)} /></p></section>}
          {advice && <section className={speech.activePart==='advice'?styles.reviewSpeechActive:undefined}><h3><ReviewBuddyHeading advice size={40}/>{speech.controls('advice')}</h3><p>{formatReviewAdvice(advice)}</p></section>}
        </article>
      </div>
    </FullscreenPreview>;
}
