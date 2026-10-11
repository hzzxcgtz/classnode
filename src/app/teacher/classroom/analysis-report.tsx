'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '@/lib/markdown';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { normalizeWorksheetAnalysisMarkdown } from '@/lib/worksheet-analysis-markdown';
import styles from './analysis-report.module.css';
import { classReportContent, reportStudentLabel } from '@/lib/worksheet-class-report';

function StudentGroupHint({ students, onOpenStudent }: { students: { id: string; name: string }[]; onOpenStudent?: (id: string) => void }) {
  const [position, setPosition] = useState<{left:number;top:number;above:boolean;width:number} | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const popup = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const closeSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPosition(null), 180); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const show = () => {
    keepOpen();
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 24);
    const above = window.innerHeight - rect.bottom < 220 && rect.top > 220;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - 8 : rect.bottom + 8, above, width });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [position]);
  return <span className={styles.group} onMouseEnter={show} onMouseLeave={closeSoon}>
    <button ref={button} type="button" className={styles.trigger} onFocus={show} onBlur={event => { if (!popup.current?.contains(event.relatedTarget as Node | null)) closeSoon(); }} onClick={show}
      onKeyDown={event => { if (event.key === 'Escape') setPosition(null); }} aria-controls={position ? id : undefined} aria-haspopup="dialog" aria-label={`${reportStudentLabel(students.map(student => student.name))}，查看${students.length}位同学名单`} aria-expanded={Boolean(position)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></svg>
      {reportStudentLabel(students.map(student => student.name))}
    </button>
    {position && createPortal(<span ref={popup} id={id} role="dialog" aria-label="相关同学" onMouseEnter={keepOpen} onMouseLeave={closeSoon} onFocus={keepOpen} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon(); }} onKeyDown={event => { if (event.key === 'Escape') { button.current?.focus(); setPosition(null); } }} className={styles.tooltip} style={{left:position.left,top:position.top,width:position.width,transform:position.above?'translateY(-100%)':undefined}}><strong>相关同学</strong><span className={styles.studentList}>{students.map(student => onOpenStudent ? <button key={student.id} type="button" className={styles.studentLink} title={`查看${student.name}的本题作答`} onClick={() => { setPosition(null); onOpenStudent(student.id); }}>{student.name}</button> : <span key={student.id}>{student.name}</span>)}</span></span>, document.body)}
  </span>;
}

/** 名单只来自服务端校验过的学生 ID，不从报告文字猜学生身份。 */
export function AnalysisReport({ text, payload, className, onOpenStudent }: { text: string; payload: WorksheetAnalysisPayload; className?: string; onOpenStudent?: (id: string) => void }) {
  const report = classReportContent(text, payload.entries, payload.participantNames ?? {});
  const groups = [...(payload.feedback?.groups ?? []), ...report.groups];
  return <Markdown className={className} allowImages={false} renderLink={(href) => {
    if (!href?.startsWith('#classnode-group-')) return undefined;
    const group = groups.find(group => `#classnode-group-${group.id}` === href);
    if (!group) return <span className={styles.unverified}>部分同学（名单待核实）</span>;
    const students = group.studentIds.map(id => ({ id, name: payload.participantNames?.[id] ?? '' }));
    if (students.some(student => !student.name)) return <span className={styles.unverified}>相关同学（名单待核实）</span>;
    return <StudentGroupHint students={students} onOpenStudent={onOpenStudent} />;
  }}>{normalizeWorksheetAnalysisMarkdown(report.text)}</Markdown>;
}
