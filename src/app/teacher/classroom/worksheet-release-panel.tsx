'use client';

import { useId, useMemo, useState } from 'react';
import { groupAnswerable } from '@/lib/worksheet-questions';
import { stripMarkdownToPlainText } from '@/lib/markdown';
import { manualReleaseSheets, releasedUnitCount, releaseUnits, type ReleaseSheet } from './worksheet-release-model';

export function WorksheetReleasePanel({ worksheets, open, busy, onChange, onView, selectedQuestionId, forceExpanded, onExpandedChange }: {
  worksheets: readonly ReleaseSheet[];
  open: Record<string, string[]>;
  busy: boolean;
  onChange: (worksheetId: string, questionIds: string[]) => void;
  onView: (worksheetId: string, questionId: string) => void;
  selectedQuestionId?: string;
  forceExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = forceExpanded ?? localExpanded;
  const setExpanded = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(value); };
  const [sheetId, setSheetId] = useState('');
  const panelId = useId();
  const available = useMemo(() => manualReleaseSheets(worksheets), [worksheets]);
  const sheet = available.find(item => item.id === sheetId) ?? available[0];
  const units = useMemo(() => releaseUnits(groupAnswerable(sheet?.nodes ?? [])), [sheet?.nodes]);
  if (!sheet || units.length === 0) return null;
  const openIds = open[sheet.id] ?? [];
  const count = releasedUnitCount(units, openIds);
  const unitName = '项任务';
  const next = units.findIndex(unit => !openIds.includes(unit.id));
  const hasNext = next >= 0 && next < units.length;
  const publish = (index: number) => onChange(sheet.id, [...openIds, units[index].id]);

  return <aside className={`worksheet-release-panel${expanded ? ' is-expanded' : ''}`} aria-label="学习单开放进度" onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}>
    <button type="button" className="worksheet-release-trigger" aria-expanded={expanded} aria-controls={panelId} aria-label={`展开开放进度，已开放 ${count}/${units.length} ${unitName}`} title={`展开开放进度 · ${count}/${units.length} ${unitName}`} onClick={() => setExpanded(!expanded)}>
      <span><strong>开放进度</strong><small>{`${count}/${units.length} ${unitName}`}</small></span>
      <span aria-hidden="true">{expanded ? '›' : '‹'}</span>
    </button>
    {expanded && <div id={panelId} className="worksheet-release-content">
      <header><div><strong>学习单开放</strong><small>教师手动开放 · {count}/{units.length} {unitName}</small></div><button type="button" className="worksheet-release-collapse" onClick={() => setExpanded(false)} aria-label="向右收起开放进度" title="向右收起">›</button></header>
      {available.length > 1
        ? <select className="input" aria-label="选择要控制开放的学习单" value={sheet.id} onChange={event => setSheetId(event.target.value)}>{available.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        : <p className="worksheet-release-title" title={sheet.title}>{sheet.title}</p>}
      <p className="worksheet-release-help">点击开放，学生即可看到并作答；提交后不会自动开放下一项任务。收回只隐藏任务，保留已交作答。</p>
      <ol className="worksheet-release-list">{units.map((unit, index) => {
        const isOpen = openIds.includes(unit.id);
        const viewing = unit.items.some(item => item.node.id === selectedQuestionId);
        const preview = stripMarkdownToPlainText(unit.items[0].node.prompt).replace(/\s+/g, ' ').trim();
        return <li key={unit.id} className={`${isOpen ? 'is-open' : ''}${viewing ? ' is-viewing' : ''}`}>
          <button type="button" className="worksheet-release-view" onClick={() => onView(sheet.id, unit.items[0].node.id)} title={`查看${unit.title}：${preview}`} aria-current={viewing ? 'true' : undefined}>
            <strong>{unit.title}</strong><span>{preview || '未填写任务要求'}</span>
            <small>{isOpen ? '已开放' : '未开放'}</small>
          </button>
          <button type="button" className={`worksheet-release-action${isOpen ? ' is-withdraw' : ''}`} disabled={busy} onClick={() => isOpen ? onChange(sheet.id, openIds.filter(id => id !== unit.id)) : publish(index)} aria-label={`${isOpen ? '收回' : '开放'}${unit.title}`}>
            {isOpen ? '收回' : '开放'}
          </button>
        </li>;
      })}</ol>
      {hasNext && <button type="button" className="btn btn-primary worksheet-release-next" disabled={busy} onClick={() => publish(next)}>{busy ? '正在同步…' : `开放下一${unitName}`}</button>}
      {!hasNext && <p className="worksheet-release-complete">{busy ? '正在同步开放状态…' : '已全部开放'}</p>}
    </div>}
  </aside>;
}
