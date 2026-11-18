'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { IconCheck, IconChevronLeft, IconChevronRight, IconList, IconLock } from '@tabler/icons-react';
import { answerModeView } from '@/lib/worksheet-answer-mode';
import { questionTypeNickname, type AnswerableGroup } from '@/lib/worksheet-questions';
import type { WorksheetAnswerMode } from '@/lib/types';
import styles from './worksheet-directory.module.css';

export function WorksheetDirectory({ groups, statuses, answerMode, openQuestions, scrollerRef }: {
  groups: AnswerableGroup[];
  statuses: Record<string, string>;
  answerMode: WorksheetAnswerMode;
  openQuestions: readonly string[];
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const [current, setCurrent] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  // Set the initial device default once; resizing must not override a user's choice.
  useEffect(() => {
    setCollapsed(window.matchMedia('(max-width: 600px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)').matches);
  }, []);
  const listId = useId();
  const [notice, setNotice] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const view = answerModeView({ groups, statuses, answerMode, openQuestions });
  const visible = new Set(view.groups.flatMap(group => group.items.map(item => item.node.id)));
  const visibleKey = [...visible].join('|');
  const total = groups.reduce((count, group) => count + group.items.length, 0);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = root.getBoundingClientRect().top + 32;
      const items = [...root.querySelectorAll<HTMLElement>('[data-worksheet-question]')];
      let active = items[0];
      for (const item of items) {
        if (item.getBoundingClientRect().top <= top) active = item;
        else break;
      }
      setCurrent(active?.dataset.worksheetQuestion ?? '');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { root.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, [scrollerRef, visibleKey]);

  useEffect(() => { setNotice(''); }, [visibleKey]);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !item) return;
    const bounds = list.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [current, collapsed]);

  if (total < 2) return null;

  const jump = (id: string) => {
    if (!visible.has(id)) {
      setNotice(view.unlockHint || '该任务尚未解锁');
      return;
    }
    const root = scrollerRef.current;
    const attribute = 'data-worksheet-question';
    const target = [...(root?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])].find(element => element.getAttribute(attribute) === id);
    if (!root || !target) return;
    setNotice('');
    const top = root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    root.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return <nav className={styles.directory} data-collapsed={collapsed || undefined} aria-label="学习单目录">
    {collapsed ? <button type="button" className={styles.expand} title="展开学习单目录" aria-label="展开学习单目录"
      aria-expanded={false} aria-controls={listId} onClick={() => setCollapsed(false)}><IconChevronLeft size={14} aria-hidden="true" /></button>
      : <div className={styles.heading}><IconList size={14} aria-hidden="true" /><span>目录</span>
        <button type="button" className={styles.collapse} title="收起学习单目录" aria-label="收起学习单目录"
          aria-expanded={true} aria-controls={listId} onClick={() => { setCollapsed(true); setNotice(''); }}><IconChevronRight size={14} aria-hidden="true" /></button>
      </div>}
    <div className={styles.list} ref={listRef} id={listId} hidden={collapsed}>
      {groups.flatMap(group => group.items).map(({ node, label }) => {
        const locked = !visible.has(node.id);
        const done = statuses[node.id] === 'submitted';
        const name = `${label} ${questionTypeNickname(node.type)}`;
        return <button type="button" key={node.id} className={styles.item} data-locked={locked || undefined}
          aria-current={current === node.id ? 'location' : undefined} aria-disabled={locked}
          aria-label={`${name}，${locked ? '未解锁' : done ? '已完成' : '未完成'}`}
          title={`${name}${locked ? '（未解锁）' : ''}`} onClick={() => jump(node.id)}>
          <span className={styles.number}>{label}</span><span className={styles.name}>{questionTypeNickname(node.type)}</span>
          <span className={styles.state}>{locked ? <IconLock size={13} aria-hidden="true" /> : done ? <IconCheck size={14} aria-hidden="true" /> : null}</span>
        </button>;
      })}
    </div>
    {!collapsed && notice && <div className={styles.notice} role="status">{notice}</div>}
  </nav>;
}
