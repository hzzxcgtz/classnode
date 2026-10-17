'use client';

import { useId, useRef, useState } from 'react';
import { Markdown } from '@/lib/markdown';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { normalizeWorksheetAnalysisMarkdown } from '@/lib/worksheet-analysis-markdown';
import styles from './analysis-report.module.css';
import { classReportContent, reportStudentLabel } from '@/lib/worksheet-class-report';

function StudentGroupHint({ students, onOpenStudent }: { students: { id: string; name: string }[]; onOpenStudent?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <span className={styles.group} onKeyDown={event => {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      setExpanded(false);
      button.current?.focus();
    }
  }}>
    <button ref={button} type="button" className={styles.trigger} onClick={() => setExpanded(value => !value)}
      aria-controls={expanded ? id : undefined} aria-label={`${reportStudentLabel(students.map(student => student.name))}，${expanded ? '收起' : '展开'}${students.length}位同学名单`} aria-expanded={expanded}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></svg>
      {reportStudentLabel(students.map(student => student.name))}
      <svg className={styles.chevron} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{transform: expanded ? 'rotate(180deg)' : undefined}}><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {expanded && <span id={id} className={styles.studentList}>{students.map(student => onOpenStudent
      ? <button key={student.id} type="button" className={styles.studentLink} title={`查看${student.name}的本题作答`} onClick={() => { setExpanded(false); onOpenStudent(student.id); }}>{student.name}</button>
      : <span key={student.id} className={styles.studentName}>{student.name}</span>)}</span>}
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
