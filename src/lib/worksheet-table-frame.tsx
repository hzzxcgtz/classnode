import type { CSSProperties, ReactNode } from 'react';
import { promptFrameStyle } from './worksheet-prompt-marks';
import type { WorksheetTableCell } from './worksheet-table';

/** Same frame in the live editor, preview and student table. */
export function TableCellFrame({cell, children}: {cell: Pick<WorksheetTableCell, 'frame' | 'align' | 'blank'>; children: ReactNode}) {
  if (!cell.frame || !cell.blank) return <>{children}</>;
  return <span className="worksheet-table-cell-frame" data-frame={cell.frame} style={{...promptFrameStyle(cell.frame), minWidth:0, width:'100%', margin:0, textAlign:cell.align ?? 'left'} as CSSProperties}>{children}</span>;
}
