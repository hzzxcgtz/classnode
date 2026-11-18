'use client';

import { useEffect, useRef } from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { questionTypeLabel, type AnswerableGroup } from '@/lib/worksheet-questions';
import styles from './student-worksheet-viewer.module.css';

export function WorksheetTaskNavigation({ slides, activeIndex, goTo, swipe = false }: {
  slides: AnswerableGroup[];
  activeIndex: number;
  goTo: (index: number) => void;
  swipe?: boolean;
}) {
  const markers = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = markers.current;
    const button = strip?.children[activeIndex] as HTMLElement | undefined;
    if (!strip || !button) return;
    strip.scrollTo({left:strip.scrollLeft + button.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth-button.offsetWidth)/2,behavior:'auto'});
  }, [activeIndex, slides.length]);
  return <footer className={styles.navigation}>
    <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>
      <IconChevronLeft size={18} aria-hidden="true" />上一页
    </button>
    <div className={styles.position}>
      <div className={styles.pageMarkers} ref={markers} role="group" aria-label={`共 ${slides.length} 项任务，当前第 ${activeIndex + 1} 项`}>
        {slides.map(({items:[{node}]},index) => <button type="button" key={node.id} className={styles.pageMarker}
          aria-label={`第 ${index + 1} 项：${questionTypeLabel(node.type)}`} aria-current={index===activeIndex ? 'page' : undefined}
          title={`第 ${index + 1} 项 · ${questionTypeLabel(node.type)}`} onClick={()=>goTo(index)}>{index+1}</button>)}
      </div>
      <span className={styles.pageAnnouncement} aria-live="polite">第 {activeIndex+1} 项，共 {slides.length} 项</span>
      {swipe && <span className={styles.swipeHint}>左右滑动</span>}
    </div>
    <button type="button" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === slides.length - 1}>
      下一页<IconChevronRight size={18} aria-hidden="true" />
    </button>
  </footer>;
}
