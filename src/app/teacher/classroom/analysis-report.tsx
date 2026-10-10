'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '@/lib/markdown';
import type { WorksheetAnalysisPayload } from '@/lib/types';
import { normalizeWorksheetAnalysisMarkdown } from '@/lib/worksheet-analysis-markdown';
import styles from './analysis-report.module.css';
import { classReportContent } from '@/lib/worksheet-class-report';

function StudentGroupHint({ names }: { names: string[] }) {
  const [position, setPosition] = useState<{left:number;top:number;above:boolean;width:number} | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 24);
    const above = window.innerHeight - rect.bottom < 220 && rect.top > 220;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - 8 : rect.bottom + 8, above, width });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [position]);
  return <span className={styles.group} onMouseEnter={show} onMouseLeave={() => setPosition(null)}>
    <button ref={button} type="button" className={styles.trigger} onFocus={show} onBlur={() => setPosition(null)} onClick={show}
      onKeyDown={event => { if (event.key === 'Escape') setPosition(null); }} aria-describedby={position ? id : undefined} aria-expanded={Boolean(position)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></svg>
      {names.length} 名同学
    </button>
    {position && createPortal(<span id={id} role="tooltip" className={styles.tooltip} style={{left:position.left,top:position.top,width:position.width,transform:position.above?'translateY(-100%)':undefined}}><strong>相关同学</strong><span>{names.join('、')}</span></span>, document.body)}
  </span>;
}

/** 名单只来自服务端校验过的学生 ID，不从报告文字猜学生身份。 */
export function AnalysisReport({ text, payload, className }: { text: string; payload: WorksheetAnalysisPayload; className?: string }) {
  const report = classReportContent(text, payload.entries, payload.participantNames ?? {});
  const groups = [...(payload.feedback?.groups ?? []), ...report.groups];
  return <Markdown className={className} allowImages={false} renderLink={(href) => {
    if (!href?.startsWith('#classnode-group-')) return undefined;
    const group = groups.find(group => `#classnode-group-${group.id}` === href);
    if (!group) return <span className={styles.unverified}>部分同学（名单待核实）</span>;
    const names = group.studentIds.map(id => {
      const name = payload.participantNames?.[id];
      if (!name) return null;
      const label = payload.entries.find(entry => entry.studentId === id)?.anonLabel;
      const number = label?.match(/#([^#]+)$/)?.[1];
      return number ? `${name} #${number}` : name;
    });
    if (names.some(name => !name)) return <span className={styles.unverified}>相关同学（名单待核实）</span>;
    return <StudentGroupHint names={names as string[]} />;
  }}>{normalizeWorksheetAnalysisMarkdown(report.text)}</Markdown>;
}
