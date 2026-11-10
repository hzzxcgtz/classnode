'use client';

import { IconStar, IconStarFilled } from '@tabler/icons-react';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { CANVAS_STAR_LABEL, type DeskRating } from '@/lib/worksheet-image-canvas';
import styles from './worksheet.module.css';
import canvasStyles from './image-canvas-task.module.css';

export function DeskRatingInput({ draft, settings, disabled, onChange }: {
  draft: Extract<AnswerDraft, { kind: 'audio' }>;
  settings: { maxStars: 3 | 5; instruction: string };
  disabled: boolean;
  onChange: (rating: DeskRating) => void;
}) {
  const { deskRating } = draft;
  const scale = disabled && deskRating ? deskRating.maxStars : settings.maxStars;
  const stars = deskRating?.maxStars === scale ? deskRating.stars : 0;
  return <section className={canvasStyles.deskRating} aria-label={CANVAS_STAR_LABEL}>
    <strong>{CANVAS_STAR_LABEL}</strong>
    {settings.instruction && <p>{settings.instruction}</p>}
    {!draft.url ? <p>请用这台 iPad 给身旁的同桌录一段，再为这段录音评星。</p> : <>
      <div className={canvasStyles.stars} role="group" aria-label="选择星级">
        {Array.from({ length: scale }, (_, index) => {
          const Star = index < stars ? IconStarFilled : IconStar;
          return <button type="button" className={`btn btn-secondary ${styles.imageCanvasButton}`} key={index}
            aria-pressed={stars === index + 1} aria-label={`${index + 1} 颗星`} disabled={disabled}
            onClick={() => onChange({ stars: index + 1, maxStars: scale })}><Star size={20} aria-hidden="true" /></button>;
        })}
      </div>
      <p role="status">{stars ? `已选 ${stars} / ${scale} 星` : '请选择星级，再完成提交。'}</p>
    </>}
  </section>;
}
