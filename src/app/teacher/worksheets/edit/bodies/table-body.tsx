'use client';

import { useState } from 'react';

import {
  MAX_TABLE_BLANKS,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  blankLayout,
  canAddTableColumn,
  canAddTableRow,
  cellLabel,
  createTable,
  insertTableColumn,
  insertTableRow,
  parseTablePaste,
  readTableFor,
  removeTableColumn,
  removeTableRow,
  setCellBlank,
  setCellText,
  tableBlankCount,
  tableColumnCount,
  type WorksheetTable,
} from '@/lib/worksheet-table';
import type { WorksheetQuestionNode } from '@/lib/types';
import { newBlankId, readBlankAnswers } from '../worksheet-editor-core';

/**
 * 表格填空的**网格面板**（★ 2026-09-28，教师裁定③ = 乙-1）。
 *
 * 教师在这个面板里加行加列、打字、把某几格标成「填空」；**学生看到的那张表由
 * `@/lib/worksheet-table-view` 画**（同一个组件也画教师卡里那份只读的「卷子样子」）。
 *
 * ── 🔴 这个文件里不许有任何自己的算术 ──────────────────────────────────────
 * 面板这一层在本机**一行都跑不到**（没有 jsdom、没有浏览器），所以「第几行第几列」
 * 「这一格是第几个空」「删一行之后答案往哪挪」全部由 `@/lib/worksheet-table` 回答
 *（那一层有用例、能做变异检验）。这里只负责画与收集点击。
 * 同一条纪律的先例：`worksheet-prompt-marks.ts` 的文件头（教师那次裁定把「是不是空」
 * 从 DOM 那层搬到了纯逻辑层，理由逐字就是「那一层本机一行都跑不到」）。
 *
 * ── 🔴 结构改动必须**表格与答案一起提交** ───────────────────────────────────
 * 每个回调都走下面那个 `apply`：`{ table, answers }` 一次写进去。
 * 分开写会有一个「题面已经变了、答案还指着旧的」的窗口期，而那个窗口期一旦被保存
 * 命中，落库的就是一张判分错位的题（**没有任何报错**）——
 * 这条纪律在 `worksheet-editor-core.ts` 的「6 个题型的编辑形状」那一节写着。
 *
 * ⚠️ 答案的偏移：表格里的空在 `data.answers` 里的下标是 `base + 表内序号`，
 * 而 `base` 是**题干里那几个空**（表格固定渲染在题干之后，裁定②）。`base` 由
 * `blankLayout(node).textCount` 给，每个结构操作都把它传下去 —— 一处都不许省。
 */
export function TableBody({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState('');
  const table = readTableFor(node);
  const answers = readBlankAnswers(node);
  const base = blankLayout(node).textCount;

  /** 表格与答案**一起**提交。`blanks: undefined` 顺手清掉老形状那个键（两份答案并存有歧义）。 */
  const apply = (next: { table: WorksheetTable; answers: string[][] }) =>
    onDataChange({ table: next.table, answers: next.answers, blanks: undefined });

  /** 粘贴一张新表：★ 换表 = 表格里原来的空全没了 ⇒ 答案要跟着裁到 `base`。 */
  const pasteTable = (raw: string) => {
    const parsed = parseTablePaste(raw);
    if (!parsed) {
      setNote('没认出表格：请从 Excel 或 Word 里复制（列之间是制表符）再粘进来。');
      return;
    }
    const kept = answers.slice(0, base);
    if (answers.length > base && !confirm('换一张表格会**清掉表格里原来的答案**（题干里那几个空的答案不受影响）。继续吗？')) return;
    const notes: string[] = [];
    if (parsed.droppedRows > 0) notes.push(`有 ${parsed.droppedRows} 行超出上限（最多 ${MAX_TABLE_ROWS} 行），没进来`);
    if (parsed.droppedCols > 0) notes.push(`有 ${parsed.droppedCols} 列超出上限（最多 ${MAX_TABLE_COLS} 列），没进来`);
    apply({
      table: {
        rows: parsed.rows.map((row) => row.map((text) => ({ text, blank: '' }))),
        headerRow: table ? table.headerRow : true,
      },
      answers: kept,
    });
    setNote(notes.join('；'));
  };

  if (!table) {
    // 还没有表：一个明确的入口，而不是一个空网格（空网格看不出「加没加表」）
    return (
      <div className="worksheet-editor-table">
        <div className="worksheet-editor-table-empty">
          <strong>这道题还没有表格</strong>
          <span>表格会显示在题干下方；学生只在标成「填空」的格子里作答。</span>
          <button type="button" className="btn btn-secondary" onClick={() => apply({ table: createTable(2, 3), answers })}>
            加一张表格
          </button>
        </div>
      </div>
    );
  }

  const blanksInTable = tableBlankCount(table);
  const atLimit = blanksInTable >= MAX_TABLE_BLANKS;

  return (
    <div className="worksheet-editor-table">
      <div className="worksheet-editor-table-tools">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canAddTableRow(table)}
          onClick={() => apply(insertTableRow(table, answers, base, table.rows.length))}
        >
          ＋ 行
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canAddTableColumn(table)}
          onClick={() => apply(insertTableColumn(table, answers, base, tableColumnCount(table)))}
        >
          ＋ 列
        </button>
        <label className="worksheet-editor-table-head-toggle">
          <input
            type="checkbox"
            checked={table.headerRow !== false}
            onChange={(event) => onDataChange({ table: { ...table, headerRow: event.target.checked } })}
          />
          第一行是表头
        </label>
        {/* ⚠️ 这里报的是**上限**，不是「这道题有几个空」—— 空的总数由下面
            「每个空的作答方式」那张清单说（一处口径；教师 2026-09-28 骂过一次重复信息）。 */}
        <span className="worksheet-editor-table-count">
          本表最多标 {MAX_TABLE_BLANKS} 个空，已标 {blanksInTable} 个
          {atLimit && <em>（到上限了）</em>}
        </span>
      </div>

      <table className="worksheet-editor-table-grid">
        <tbody>
          {table.rows.map((cells, row) => (
            <tr key={row}>
              {cells.map((cell, col) => (
                <td key={col} className={cell.blank === '' ? undefined : 'is-blank'}>
                  <input
                    className="input"
                    value={cell.text}
                    aria-label={`${cellLabel(row, col)}的内容`}
                    placeholder={row === 0 && table.headerRow !== false ? '表头' : ''}
                    onChange={(event) => onDataChange({ table: setCellText(table, row, col, event.target.value) })}
                  />
                  {/* ⚠️ 「设为填空」用真的复选框：读屏与键盘都天然可用，
                      也不用为它写一套按钮的选中态样式。 */}
                  <label className="worksheet-editor-table-blank-toggle">
                    <input
                      type="checkbox"
                      checked={cell.blank !== ''}
                      disabled={cell.blank === '' && atLimit}
                      onChange={(event) => apply(setCellBlank(
                        table, answers, base, row, col, event.target.checked ? newBlankId() : null,
                      ))}
                    />
                    填空
                  </label>
                </td>
              ))}
              <td className="worksheet-editor-table-op">
                <button
                  type="button"
                  title={`删除第 ${row + 1} 行`}
                  aria-label={`删除第 ${row + 1} 行`}
                  disabled={table.rows.length <= 1}
                  onClick={() => apply(removeTableRow(table, answers, base, row))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          <tr>
            {(table.rows[0] ?? []).map((_, col) => (
              <td key={col} className="worksheet-editor-table-op">
                <button
                  type="button"
                  title={`删除第 ${col + 1} 列`}
                  aria-label={`删除第 ${col + 1} 列`}
                  disabled={tableColumnCount(table) <= 1}
                  onClick={() => apply(removeTableColumn(table, answers, base, col))}
                >
                  ✕
                </button>
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>

      <details className="worksheet-editor-table-paste">
        {/* ⚠️ **不读剪贴板**：`navigator.clipboard.readText()` 会拉起浏览器自己的授权浮层，
            而浮层不处理掉那一次读就永远不返回（`paste-question-dialog.tsx` 的文件头
            记着教师实测的那一次）。这里给一个输入框，教师 ⌘V 由输入框自己接住。 */}
        <summary>从 Excel / Word 粘贴一张表</summary>
        <textarea
          className="input"
          rows={3}
          placeholder="从 Excel 复制表格，粘到这里"
          onChange={(event) => { if (event.target.value.trim()) pasteTable(event.target.value); }}
        />
        {note && <p className="worksheet-editor-table-note">{note}</p>}
      </details>
    </div>
  );
}
