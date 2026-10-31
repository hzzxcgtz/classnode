'use client';
import { IconFileSearch, IconMessageSearch } from '@tabler/icons-react';
import styles from './fullscreen-preview.module.css';
export function LectureTabs({mode,onChange}:{mode:'answer'|'review';onChange:(mode:'answer'|'review')=>void}) {
 return <div className={styles.lectureTabs} role="tablist" aria-label="讲评内容切换" onKeyDown={event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();onChange(event.key==='Home'?'answer':event.key==='End'?'review':mode==='answer'?'review':'answer');
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelector<HTMLElement>('dialog[open] [role="tab"][aria-selected="true"]')?.focus({preventScroll:true})));
 }}>
  <button type="button" role="tab" aria-selected={mode==='answer'} tabIndex={mode==='answer'?0:-1} onClick={()=>onChange('answer')}><IconFileSearch size={18} aria-hidden="true"/><span>学生作答</span></button>
  <button type="button" role="tab" aria-selected={mode==='review'} tabIndex={mode==='review'?0:-1} onClick={()=>onChange('review')}><IconMessageSearch size={18} aria-hidden="true"/><span>评价建议</span></button>
 </div>;
}
