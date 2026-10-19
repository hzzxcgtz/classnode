'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '@/lib/markdown';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { normalizeWorksheetAnalysisMarkdown } from '@/lib/worksheet-analysis-markdown';
import styles from './analysis-report.module.css';
import { classReportContent, reportStudentLabel } from '@/lib/worksheet-class-report';

function StudentGroupHint({ students, onOpenStudent }: { students: { id: string; name: string }[]; onOpenStudent?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const list = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!expanded) return;
    const update = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(340, window.innerWidth - 24);
      const below = window.innerHeight - anchor.bottom - 20;
      const above = anchor.top - 20;
      const useBelow = below >= 200 || below >= above;
      const maxHeight = Math.max(48, Math.min(260, useBelow ? below : above));
      const height = Math.min(list.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
        top: useBelow ? anchor.bottom + 6 : Math.max(12, anchor.top - height - 6),
        width, maxHeight,
      });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !list.current?.contains(event.target)) setExpanded(false);
    };
    update();
    // Re-measure once the portal has mounted, especially when opening above the tag.
    const frame = requestAnimationFrame(() => { update(); list.current?.focus(); });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [expanded]);
  return <span className={styles.group} onKeyDown={event => {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      setExpanded(false);
      button.current?.focus();
    }
  }}>
    <button ref={button} type="button" className={styles.trigger} onClick={() => setExpanded(value => !value)}
      aria-haspopup="dialog" aria-controls={expanded ? id : undefined} aria-label={`${reportStudentLabel(students.map(student => student.name))}，${expanded ? '收起' : '展开'}${students.length}位同学名单`} aria-expanded={expanded}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></svg>
      {reportStudentLabel(students.map(student => student.name))}
      <svg className={styles.chevron} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{transform: expanded ? 'rotate(180deg)' : undefined}}><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {expanded && position && createPortal(<span ref={list} id={id} tabIndex={-1} role="dialog" aria-label={`学生名单，共${students.length}人`} className={styles.studentList} style={position}>{students.map(student => onOpenStudent
      ? <button key={student.id} type="button" className={styles.studentLink} title={`查看${student.name}的当前任务作答`} onClick={() => { setExpanded(false); onOpenStudent(student.id); }}>{student.name}</button>
      : <span key={student.id} className={styles.studentName}>{student.name}</span>)}</span>, document.body)}
  </span>;
}

/** 名单只来自服务端校验过的学生 ID，不从报告文字猜学生身份。 */
export function AnalysisReport({ text, payload, className, onOpenStudent }: { text: string; payload: WorksheetAnalysisPayload; className?: string; onOpenStudent?: (id: string) => void }) {
  const report = classReportContent(text, payload.entries, payload.participantNames ?? {}, payload.feedback?.groups ?? []);
  const groups = [...(payload.feedback?.groups ?? []), ...report.groups];
  return <Markdown className={className} allowImages={false} renderLink={(href) => {
    if (!href?.startsWith('#classnode-group-')) return undefined;
    const group = groups.find(group => `#classnode-group-${group.id}` === href);
    if (!group) return <span className={styles.unverified}>部分同学（名单待核实）</span>;
    const students = [...new Set(group.studentIds)].map(id => ({ id, name: payload.participantNames?.[id] ?? '' }));
    if (students.some(student => !student.name)) return <span className={styles.unverified}>相关同学（名单待核实）</span>;
    return <StudentGroupHint students={students} onOpenStudent={onOpenStudent} />;
  }}>{normalizeWorksheetAnalysisMarkdown(report.text)}</Markdown>;
}
