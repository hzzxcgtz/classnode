'use client';
import { WorksheetFieldTag } from '@/components/worksheet-field-tag';
import { useId, useState, type CSSProperties } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { ratingConfig, ratingCommentLength, ratingDimensionRows } from '@/lib/worksheet-rating';
import { normalizeRewardStyle, type RewardStyle } from '@/lib/worksheet-reward';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { readPromptRuns } from '@/lib/worksheet-prompt-marks';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import ratingStyles from './rating-body.module.css';
import styles from '../worksheet.module.css';

function RatingChoices({ label, value, max, rewardStyle, disabled, onChange }: {
  label: string; value: number; max: number; rewardStyle: RewardStyle; disabled: boolean; onChange: (value: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = disabled ? value : preview ?? value;
  return <div className={ratingStyles.choices} role="group" aria-label={label}
    onPointerLeave={() => setPreview(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}>
    {Array.from({ length: max }, (_, index) => {
      const count = index + 1;
      return <button type="button" className={`${styles.imageCanvasButton} ${ratingStyles.choice}`} key={count}
        aria-label={`${label}：${count} / ${max}`} aria-pressed={value === count} disabled={disabled}
        data-active={count <= shown} data-preview={preview !== null && !disabled}
        onPointerEnter={event => { if (!disabled && event.pointerType === 'mouse') setPreview(count); }}
        onFocus={() => { if (!disabled) setPreview(count); }}
        onClick={() => { onChange(value === count ? 0 : count); setPreview(null); }}>
        <RewardIcon kind={rewardStyle} state={count <= shown ? 'earned' : 'empty'} size={26} />
      </button>;
    })}
  </div>;
}

export function RatingBody({ node, draft, disabled, rewardStyle, onChange }: {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'rating' }>;
  disabled: boolean;
  rewardStyle?: RewardStyle;
  onChange: (next: Extract<AnswerDraft, { kind: 'rating' }>) => void;
}) {
  const config = ratingConfig(node.data);
  const style = normalizeRewardStyle(rewardStyle);
  const commentId = useId();
  const count = ratingCommentLength(draft.text);
  const short = count < config.minCommentLength;
  const commentPrompt = config.commentPrompt || '评价与感想';
  const commentRuns = readPromptRuns(config.commentPromptRuns, commentPrompt);
  const descriptionStart = commentPrompt.indexOf('\n');
  const commentTitle = descriptionStart < 0 ? commentPrompt : commentPrompt.slice(0, descriptionStart);
  const commentDescription = descriptionStart < 0 ? '' : commentPrompt.slice(descriptionStart + 1);
  const titleRuns = commentRuns.filter(run => run.start < commentTitle.length).map(run => ({ ...run, end: Math.min(run.end, commentTitle.length) }));
  const descriptionRuns = commentRuns.filter(run => run.end > descriptionStart + 1).map(run => ({ ...run, start: Math.max(0, run.start - descriptionStart - 1), end: run.end - descriptionStart - 1 }));
  return <div className={ratingStyles.body}>
    <div className={ratingStyles.tableFrame}>
      <table className={ratingStyles.table} style={{ '--rating-scale-width': `${Math.max(80, config.maxStars * 36 + 12)}px` } as CSSProperties}>
        <colgroup><col /><col className={ratingStyles.ratingColumn} /></colgroup>
        <thead><tr><th scope="col">评价维度</th><th scope="col">你的评价</th></tr></thead>
        <tbody>{ratingDimensionRows(config).map((dimension, i) => {
          const value = draft.maxStars === config.maxStars ? draft.ratings[dimension.id] || 0 : 0;
          const label = dimension.text || `评价维度 ${i + 1}`;
          if (!dimension.isLeaf) return <tr key={dimension.id} className={ratingStyles.groupRow}><th colSpan={2} style={{ '--rating-depth': dimension.depth } as CSSProperties}><PromptText text={label} runs={readPromptRuns(dimension.runs, label)} placeholder={null} /></th></tr>;
          return <tr key={dimension.id}>
            <th scope="row" style={{ '--rating-depth': dimension.depth } as CSSProperties}><PromptText text={label} runs={readPromptRuns(dimension.runs, label)} placeholder={null} /></th>
            <td className={ratingStyles.ratingCell}><RatingChoices label={label} value={value} max={config.maxStars}
              rewardStyle={style} disabled={disabled} onChange={next => {
                const ratings = { ...(draft.maxStars === config.maxStars ? draft.ratings : {}) };
                if (next) ratings[dimension.id] = next;
                else delete ratings[dimension.id];
                onChange({ ...draft, maxStars: config.maxStars, ratings });
              }} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {config.commentEnabled && <div className={ratingStyles.comment}>
      <div className={ratingStyles.commentHeading}>
        <label htmlFor={commentId}>
          <PromptText text={commentTitle} runs={titleRuns} placeholder={null} />
          <WorksheetFieldTag />
          {commentDescription && <span className={ratingStyles.commentDescription}><PromptText text={commentDescription} runs={descriptionRuns} placeholder={null} /></span>}
        </label>
        <span id={`${commentId}-count`} className={ratingStyles.counter} data-short={short && count > 0} aria-live="polite">{count} 字{config.minCommentLength > 1 && ` / 至少 ${config.minCommentLength} 字`}</span>
      </div>
      <textarea id={commentId} className={`input ${ratingStyles.commentInput}`} rows={4} maxLength={10000} required
        aria-describedby={`${commentId}-count ${commentId}-hint`} disabled={disabled} value={draft.text}
        placeholder="写下你的观察、感受或建议"
        onChange={event => onChange({ ...draft, text: event.target.value })} />
      <p id={`${commentId}-hint`} className={ratingStyles.commentHint}>{config.minCommentLength > 1 ? `请至少填写 ${config.minCommentLength} 字，空格和换行不计入字数。` : '请填写文字感想后提交。'}</p>
    </div>}
  </div>;
}
