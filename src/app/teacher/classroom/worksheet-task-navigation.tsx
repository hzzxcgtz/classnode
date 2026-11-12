'use client';

import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { questionTypeLabel, type AnswerableGroup } from '@/lib/worksheet-questions';
import styles from './student-worksheet-viewer.module.css';

export function WorksheetTaskNavigation({ slides, activeIndex, goTo, swipe = false }: {
  slides: AnswerableGroup[];
  activeIndex: number;
  goTo: (index: number) => void;
  swipe?: boolean;
}) {
  return <footer className={styles.navigation}>
    <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>
      <IconChevronLeft size={18} aria-hidden="true" />上一页
    </button>
    <div className={styles.position}>
      <label className={styles.jump}>
        <span>任务</span>
        <select aria-label="跳到任务" value={activeIndex} onChange={event => goTo(Number(event.target.value))}>
          {slides.map(({ items: [{ node }] }, index) => <option key={node.id} value={index}>
            {index + 1} / {slides.length} · {questionTypeLabel(node.type)}
          </option>)}
        </select>
      </label>
      {swipe && <span className={styles.swipeHint}>左右滑动切换任务</span>}
    </div>
    <button type="button" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === slides.length - 1}>
      下一页<IconChevronRight size={18} aria-hidden="true" />
    </button>
  </footer>;
}
