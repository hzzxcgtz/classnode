import type { ReactNode } from 'react';

type TableTool = 'add-row' | 'add-column' | 'delete-row' | 'delete-column' | 'merge-horizontal' | 'merge-vertical' | 'split' | 'header' | 'paste';

/** 统一用单元格边界表达表格操作，合并箭头朝内、拆分以新增格线表示。 */
export function TableToolIcon({ kind }: { kind: TableTool }) {
  let drawing: ReactNode;
  if (kind === 'merge-horizontal' || kind === 'merge-vertical') {
    drawing = <g transform={kind === 'merge-vertical' ? 'rotate(90 12 12)' : undefined}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="1.5" />
      <path d="M12 5v3m0 8v3" strokeDasharray="1 2" opacity=".5" />
      <path d="M5 12h5m-2-2 2 2-2 2M19 12h-5m2-2-2 2 2 2" />
    </g>;
  } else if (kind === 'split') {
    drawing = <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M12 4v16M4 12h16" strokeDasharray="2 2" /></>;
  } else if (kind === 'header') {
    drawing = <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M4 5h16v5H4z" fill="currentColor" stroke="none" opacity=".3"/><path d="M3 10h18m-12 0v10m6-10v10"/></>;
  } else if (kind === 'paste') {
    drawing = <><rect x="5" y="5" width="15" height="17" rx="1.5"/><rect x="9" y="2" width="7" height="5" rx="1" fill="var(--card, white)"/><path d="M8 12h9m-9 5h9m-5-5v8"/></>;
  } else {
    const column = kind === 'add-column' || kind === 'delete-column';
    const remove = kind === 'delete-row' || kind === 'delete-column';
    drawing = <>
      <g transform={column ? 'rotate(-90 10 10)' : undefined}>
        <rect x="2" y="2" width="16" height="16" rx="1.5"/>
        <path d="M3 11h14v6H3z" fill="currentColor" stroke="none" opacity=".18"/>
        <path d="M2 10h16m-10-8v16"/>
      </g>
      <circle cx="18" cy="18" r="5" fill="var(--card, white)" stroke="none"/>
      <path d={remove ? 'M15 18h6' : 'M15 18h6m-3-3v6'} strokeWidth="2"/>
    </>;
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>;
}
