'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PasteTableDialog } from './paste-table-dialog';
import { IconAlignLeft, IconAlignCenter, IconAlignRight, IconLineDashed, IconArrowBackUp } from '@tabler/icons-react';
import { TableToolIcon } from './table-tool-icon';
import { useTeacherConfirm } from '@/lib/components';
import { setCellAlignment, coveredTableCells, mergeTableCells, splitTableCell, tableAxisBlocked, MAX_TABLE_BLANKS, MAX_TABLE_COLS, MAX_TABLE_ROWS, blankLayout, canAddTableColumn, canAddTableRow, cellLabel, createTable, insertTableColumn, insertTableRow, parseTablePaste, readTableFor, removeTableColumn, removeTableRow, setCellBlank, setCellText, tableBlankCount, tableColumnCount, type WorksheetTable } from '@/lib/worksheet-table';
import { blankSlots } from '@/lib/worksheet-fill-modes';
import { fillPromptPatch } from '@/lib/worksheet-fill-edit';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import type { WorksheetQuestionNode } from '@/lib/types';
import { newBlankId, readBlankAnswers } from '../worksheet-editor-core';

/** 网格就是题面；仅选中单元格时显示转换和结构操作，设置通过稳定 blank ID 定位。 */
export function TableBody({ node, onDataChange, onBlankSelect, selectedBlankId, standalone = false }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  onBlankSelect?: (id: string) => void;
  selectedBlankId?: string | null;
  standalone?: boolean;
}) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const pasteTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !toolsRef.current?.contains(target)) setActive(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, []);
  const { askConfirmation, confirmationDialog } = useTeacherConfirm();
  const table = readTableFor(node);
  const answers = readBlankAnswers(node);
  const runs = readPromptRunsFor(node);
  const slots = blankSlots(node, runs);
  const base = blankLayout(node, runs).tableBase;
  const covered = coveredTableCells(table);
  const cell = selected && table?.rows[selected.row]?.[selected.col];
  const selectedHere = Boolean(cell && (!selectedBlankId || cell.blank === selectedBlankId));
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      const rect = (standalone ? rootRef.current?.querySelector('td.is-active') ?? rootRef.current : rootRef.current)?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) { setPosition(null); return; }
      const width = Math.min(standalone ? 340 : 820, window.innerWidth - 24);
      const height = toolsRef.current?.getBoundingClientRect().height ?? 100;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(10, rect.top - height - 8), maxWidth: width });
    };
    update(); window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [active, standalone, selected?.row, selected?.col, selectedBlankId, table?.rows.length]);
  const apply = (next: { table: WorksheetTable }, inserted?: { id: string; answer: string }) => {
    onDataChange({ ...fillPromptPatch(node, runs, node.prompt, runs, answers, inserted, next.table), table: next.table });
  };
  const changeStructure = (next: { table: WorksheetTable }) => { setSelected(null); apply(next); };
  const pasteTable = async () => {
    const parsed = parseTablePaste(paste);
    if (!parsed) { const message = '请从 Excel 或 Word 复制表格后粘贴，列之间需有制表符。'; if (!standalone) setNote(message); setPasteError(message); return; }
    if (table && (tableBlankCount(table) || table.rows.some(row => row.some(item => item.text.trim())))) {
      if (standalone) setPasteOpen(false);
      const confirmed = await askConfirmation({ title: '替换当前表格？', message: '当前表格的内容及填空答案会被替换，文字填空不受影响。', confirmLabel: '替换表格', tone: 'danger' });
      if (!confirmed) { if (standalone) setPasteOpen(true); return; }
    }
    changeStructure({ table: { rows: parsed.rows.map(row => row.map(text => ({ text, blank: '' }))), headerRow: true } });
    setNote(parsed.droppedRows || parsed.droppedCols ? `已导入，上限为 ${MAX_TABLE_ROWS} 行、${MAX_TABLE_COLS} 列，超出部分未导入。` : '表格已导入，选中格子可设为填空。'); setPaste(''); setPasteOpen(false);
  };
  const toggleBlank = () => {
    if (!table || !selected || !cell) return;
    const id = cell.blank ? null : newBlankId();
    apply(setCellBlank(table, answers, base, selected.row, selected.col, id), id ? { id, answer: cell.text } : undefined);
    onBlankSelect?.(id ?? '');
  };
  const merge = (direction: 'right' | 'down') => {
    if (!table || !selected) return;
    const result = mergeTableCells(table, selected.row, selected.col, direction);
    if (result.error) { setNote(result.error); return; }
    apply({ table: result.table }); setNote('');
    onBlankSelect?.(result.table.rows[selected.row][selected.col].blank);
  };
  const rowAt = selected ? selected.row + (cell?.rowSpan ?? 1) : table?.rows.length ?? 0;
  const colAt = selected ? selected.col + (cell?.colSpan ?? 1) : tableColumnCount(table);
  const rail = table && <div className="worksheet-editor-table-structure-tools worksheet-editor-table-icon-rail" role="group" aria-label="表格工具">
    <button type="button" title="在所选格下方插入一行" aria-label="插入一行" disabled={!canAddTableRow(table) || tableAxisBlocked(table, 'row', rowAt, true)} onClick={() => changeStructure(insertTableRow(table, answers, base, rowAt))}><TableToolIcon kind="add-row"/></button>
    <button type="button" title="在所选格右侧插入一列" aria-label="插入一列" disabled={!canAddTableColumn(table) || tableAxisBlocked(table, 'col', colAt, true)} onClick={() => changeStructure(insertTableColumn(table, answers, base, colAt))}><TableToolIcon kind="add-column"/></button>
    <button type="button" title="删除所选行；涉及合并格时请先拆分" aria-label="删除所选行" disabled={!selected || !selectedHere || table.rows.length <= 1 || tableAxisBlocked(table, 'row', selected.row, false)} onClick={() => { if (selected) changeStructure(removeTableRow(table, answers, base, selected.row)); }}><TableToolIcon kind="delete-row"/></button>
    <button type="button" title="删除所选列；涉及合并格时请先拆分" aria-label="删除所选列" disabled={!selected || !selectedHere || tableColumnCount(table) <= 1 || tableAxisBlocked(table, 'col', selected.col, false)} onClick={() => { if (selected) changeStructure(removeTableColumn(table, answers, base, selected.col)); }}><TableToolIcon kind="delete-column"/></button>
    <span className="worksheet-editor-table-rail-divider"/>
    <button type="button" title="左右合并：与右侧单元格合并" aria-label="向右合并单元格" disabled={!selected || !selectedHere || selected.col + (cell?.colSpan ?? 1) >= tableColumnCount(table)} onClick={() => merge('right')}><TableToolIcon kind="merge-horizontal"/><small>左右合并</small></button>
    <button type="button" title="上下合并：与下方单元格合并" aria-label="向下合并单元格" disabled={!selected || !selectedHere || selected.row + (cell?.rowSpan ?? 1) >= table.rows.length} onClick={() => merge('down')}><TableToolIcon kind="merge-vertical"/><small>上下合并</small></button>
    <button type="button" title="拆分单元格；内容保留在左上格" aria-label="拆分单元格" disabled={!selected || !selectedHere || (!cell?.rowSpan && !cell?.colSpan)} onClick={() => { if (selected) { apply({table:splitTableCell(table, selected.row, selected.col)}); setNote('已拆分，原有内容保留在左上格。'); } }}><TableToolIcon kind="split"/><small>拆分</small></button>
    <span className="worksheet-editor-table-rail-divider"/>
    <button type="button" title="首行为表头" aria-label="首行为表头" aria-pressed={table.headerRow !== false} onClick={() => onDataChange({table:{...table,headerRow:table.headerRow === false}})}><TableToolIcon kind="header"/></button>
    <button ref={pasteTriggerRef} type="button" title="从 Excel / Word 粘贴表格" aria-label="粘贴表格" aria-expanded={pasteOpen} onClick={() => { setPasteError(''); setPasteOpen(true); }}><TableToolIcon kind="paste"/></button>
  </div>;
  const structureTools = table && <>
        <details className="worksheet-editor-row-column-tools"><summary>行列设置</summary><div>
          <button type="button" className="btn btn-secondary" aria-label="插入一行" disabled={!canAddTableRow(table)} onClick={() => changeStructure(insertTableRow(table, answers, base, selected ? selected.row + 1 : table.rows.length))}>插入一行</button>
          <button type="button" className="btn btn-secondary" aria-label="插入一列" disabled={!canAddTableColumn(table)} onClick={() => changeStructure(insertTableColumn(table, answers, base, selected ? selected.col + 1 : tableColumnCount(table)))}>插入一列</button>
          <button type="button" className="btn btn-ghost" aria-label="删除所选行" disabled={!selected || !selectedHere || table.rows.length <= 1} onClick={() => { if (selected) changeStructure(removeTableRow(table, answers, base, selected.row)); }}>删除所选行</button>
          <button type="button" className="btn btn-ghost" aria-label="删除所选列" disabled={!selected || !selectedHere || tableColumnCount(table) <= 1} onClick={() => { if (selected) changeStructure(removeTableColumn(table, answers, base, selected.col)); }}>删除所选列</button>
          <label><input type="checkbox" aria-label="首行为表头" checked={table.headerRow !== false} onChange={event => onDataChange({ table: { ...table, headerRow: event.target.checked } })} />首行为表头</label>
        </div></details>
      <div className="worksheet-editor-live-table-footer"><button type="button" className="btn btn-ghost" disabled={!canAddTableRow(table)} onClick={() => changeStructure(insertTableRow(table, answers, base, table.rows.length))}>＋ 添加一行</button><span>已设 {tableBlankCount(table)} 个填空 / 最多 {MAX_TABLE_BLANKS} 个</span></div>    <details className="worksheet-editor-table-paste"><summary>粘贴表格</summary><textarea className="input" rows={3} aria-label="粘贴表格内容" placeholder="从 Excel / Word 复制表格后粘贴到这里" value={paste} onChange={event => setPaste(event.target.value)} /><button type="button" className="btn btn-secondary" disabled={!paste.trim()} onClick={() => void pasteTable()}>使用这张表格</button></details>
        {note && <p className="worksheet-editor-table-note" role="status">{note}</p>}
  </>;
  return <div ref={rootRef} className={`worksheet-editor-live-table${standalone ? ' is-standalone' : ''}`} onFocusCapture={event => setActive(!(event.target as HTMLElement).closest('.worksheet-editor-table-structure-tools'))} onPointerDown={event => setActive(!(event.target as HTMLElement).closest('.worksheet-editor-table-structure-tools'))}>
    {!table ? <button type="button" className="btn btn-secondary" onClick={() => apply({ table: createTable(3, 3) })}>创建 3 × 3 表格</button> : <>
      {standalone && rail}

      <div className="worksheet-editor-live-table-scroll"><table style={{ minWidth: Math.max(300, tableColumnCount(table) * 110) }}><colgroup>{Array.from({length:tableColumnCount(table)}, (_, i) => <col key={i}/>)}</colgroup><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((item, c) => {
        if (covered.has(`${r}:${c}`)) return null;
        const cellActive = active && (item.blank ? selectedBlankId === item.blank : selectedHere && selected?.row === r && selected.col === c);
        const number = item.blank ? slots.findIndex(slot => slot.id === item.blank) + 1 : 0;
        return <td key={c} rowSpan={item.rowSpan} colSpan={item.colSpan} style={{textAlign:item.align,verticalAlign:item.verticalAlign}} className={`${r === 0 && table.headerRow !== false ? 'is-heading' : ''} ${cellActive ? 'is-active' : ''}`}>
          {item.blank ? <button type="button" className="worksheet-editor-table-blank-line" aria-label={`设置第 ${number} 空，${cellLabel(r, c)}`} aria-pressed={cellActive} onClick={() => { setSelected({ row: r, col: c }); onBlankSelect?.(item.blank); }}><span>{number}</span>{(node.data.fillBlankSettings as Record<string, {mode?:string}>)?.[item.blank]?.mode === 'audio' ? <small>语音作答</small> : <i aria-hidden="true" />}</button>
            : <textarea style={{textAlign:item.align}} rows={2} aria-label={`${cellLabel(r, c)}的内容`} placeholder={r === 0 && table.headerRow !== false ? '表头' : '点击填写'} value={item.text} onFocus={() => { setSelected({ row: r, col: c }); onBlankSelect?.(''); }} onChange={event => onDataChange({ table: setCellText(table, r, c, event.target.value) })} />}
        </td>;
      })}</tr>)}</tbody></table></div>
      {standalone && <span className="worksheet-editor-table-blank-count">{tableBlankCount(table)} / {MAX_TABLE_BLANKS} 个填空</span>}
      {standalone && note && <p className="worksheet-editor-table-note" role="status">{note}</p>}
      {active && position && (!standalone || (selected && selectedHere)) && createPortal(<div ref={toolsRef} className="worksheet-editor-floating-table-tools" role="toolbar" aria-label="表格编辑工具" style={{ position: 'fixed', ...position }} onKeyDown={event => { if (event.key === 'Escape') { setActive(false); event.stopPropagation(); } }}>
      <div className="worksheet-editor-cell-tools" aria-label="所选单元格操作">
        <div className="worksheet-editor-cell-alignment" role="group" aria-label="水平对齐">{([
          ['left','左对齐',IconAlignLeft], ['center','水平居中',IconAlignCenter], ['right','右对齐',IconAlignRight],
        ] as const).map(([value,label,Icon]) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={(cell?.align ?? 'left') === value} disabled={!cell || !selectedHere} onClick={() => { if(selected) onDataChange({table:setCellAlignment(table,selected.row,selected.col,{align:value})}); }}><Icon size={15}/></button>)}</div>
        <button type="button" className={`btn worksheet-editor-convert-blank ${cell && selectedHere && cell.blank ? 'btn-secondary' : 'btn-primary'}`} disabled={!cell || !selectedHere || (!cell.blank && tableBlankCount(table) >= MAX_TABLE_BLANKS)} onClick={toggleBlank}>{cell?.blank ? <IconArrowBackUp size={14} aria-hidden="true"/> : <IconLineDashed size={14} aria-hidden="true"/>}{cell && selectedHere && cell.blank ? '改为文字格' : '设为填空'}</button>
        { !standalone && structureTools }
      </div>
      </div>, document.body)}
    </>}
    {standalone && pasteOpen && createPortal(<PasteTableDialog returnFocusRef={pasteTriggerRef} value={paste} error={pasteError} busy={pasteBusy} onChange={value => { setPaste(value); setPasteError(''); }} onClose={() => { if (!pasteBusy) setPasteOpen(false); }} onConfirm={() => { if (pasteBusy) return; setPasteBusy(true); void pasteTable().finally(() => setPasteBusy(false)); }} />, document.body)}
    {confirmationDialog && createPortal(confirmationDialog, document.body)}
  </div>;
}
