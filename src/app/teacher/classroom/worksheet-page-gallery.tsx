'use client';

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { AnswerableGroup } from '@/lib/worksheet-questions';
import { questionTypeLabel } from '@/lib/worksheet-questions';
import worksheetStyles from '@/app/classroom/worksheet/worksheet.module.css';
import { WorksheetTaskNavigation } from './worksheet-task-navigation';
import styles from './student-worksheet-viewer.module.css';

/** Editor preview uses the final viewer's page surfaces, snap scrolling and navigation. */
export function WorksheetPageGallery({ slides, activeIndex, onSelect, renderPage, surfaceStyle, hasBackground, hasPortrait, pageWidth = 792 }: {
  slides: AnswerableGroup[]; activeIndex: number; onSelect: (index: number) => void;
  renderPage: (index: number) => ReactNode; surfaceStyle: CSSProperties;
  hasBackground: boolean; hasPortrait: boolean; pageWidth?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(activeIndex); current.current = activeIndex;
  const positions = useRef(new Map<string, number>());
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const align = () => { const width = element.firstElementChild?.getBoundingClientRect().width; if (width) element.scrollTo({left:width * current.current, behavior:'auto'}); };
    align(); const observer = new ResizeObserver(align); observer.observe(element);
    return () => observer.disconnect();
  }, [pageWidth]);
  useLayoutEffect(() => {
    const page = track.current?.children[activeIndex]?.querySelector('section');
    if (page) page.scrollTop = positions.current.get(slides[activeIndex].items[0].node.id) ?? 0;
    track.current?.querySelectorAll<HTMLAudioElement>('section[inert] audio').forEach(audio => audio.pause());
  }, [activeIndex, slides]);
  const goTo = (index: number) => {
    const element = track.current;
    const width = element?.firstElementChild?.getBoundingClientRect().width;
    if (!element || !width || index < 0 || index >= slides.length) return;
    element.scrollTo({ left:width * index, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(index-activeIndex)>1 ? 'auto' : 'smooth' });
  };
  return <>
    <div className={styles.track} ref={track} style={{'--worksheet-page-width':`${pageWidth}px`} as CSSProperties}
      aria-label="翻页查看学习单" onScroll={event => {
        if (event.target !== event.currentTarget) return;
        const width = event.currentTarget.firstElementChild?.getBoundingClientRect().width;
        if (width) onSelect(Math.max(0,Math.min(slides.length-1,Math.round(event.currentTarget.scrollLeft/width))));
      }}>
      {slides.map((slide,index) => <div key={slide.items[0].node.id} className={styles.slideSlot} data-active={index===activeIndex}>
        <section className={`${worksheetStyles.scroller} ${styles.slide}`} style={surfaceStyle}
          data-has-background={hasBackground?'1':'0'} data-has-portrait={hasPortrait?'1':'0'}
          aria-label={`第 ${index+1} 项 · ${questionTypeLabel(slide.items[0].node.type)}`} aria-hidden={index!==activeIndex} inert={index!==activeIndex}
          onScroll={event => {if(event.target===event.currentTarget && index===activeIndex) positions.current.set(slide.items[0].node.id,event.currentTarget.scrollTop);}}>
          {Math.abs(index-activeIndex)<=1 && renderPage(index)}
        </section>
        {Math.abs(index-activeIndex)===1 && <button type="button" className={styles.sidePage} aria-label={`翻到第 ${index+1} 项任务`} onClick={()=>goTo(index)}/>}
      </div>)}
    </div>
    <WorksheetTaskNavigation slides={slides} activeIndex={activeIndex} goTo={goTo} swipe />
  </>;
}
