import { Fragment, type CSSProperties, type ReactNode } from 'react';

import { blankAriaLabel, blankValueStyle } from './worksheet-prompt-marks.ts';
import { BlankSlot } from './worksheet-blank-slot.tsx';
import { cellLabel, type WorksheetTable } from './worksheet-table.ts';

/**
 * 表格填空的**表格那一份渲染**（★ 2026-09-28）。
 *
 * ── 为什么只有这一份实现 ────────────────────────────────────────────────────
 * 三个地方要看这张表：学生端的作答区、教师端的只读「卷子样子」、以及（将来）
 * 教师端网格面板的预览。三处各写一份的话，改了这边那边不动，而**两边都不报错** ——
 * 本仓最防的那种分叉（`worksheet-prompt-text.tsx` 的文件头为同一件事写过一整段理由：
 * 题干昨天就吃过这个亏，两份渲染各画各的）。
 * ⇒ 一份实现放 `src/lib`，与 `PromptText` 完全同一种做法。
 *
 * ── 为什么只有内联样式、不带类名 ────────────────────────────────────────────
 * 与 `PromptText` 逐字同一条理由：两个调用方分属**两套 CSS 模块**（学生端是
 * `worksheet.module.css`、教师端是 `globals.css`）。本组件只画表格的骨架
 * （边框 / 内边距 / 表头加粗 / 空白格），**基线字号与颜色由调用方那个容器给**。
 * ⚠️ 唯一的例外是空输入框那个类 `worksheet-blank-input` —— 它在 `globals.css` 里
 * **是全局的**（焦点态与自适应宽度都在那儿），两套世界都取得到，而且必须是同一份：
 * 另写一份的症状是「题干里的空与表格里的空长得不一样」（`PromptText` 那条注释）。
 *
 * ── 学生端要守的东西 ────────────────────────────────────────────────────────
 * · 表格在 iPad 竖屏上会超出宽度 ⇒ 外面套一层可横向滚动的容器，**不压字**；
 * · 空的那几格是 `<input>`（与题干里的空同一套观感），读屏标签是**「第 2 行第 2 格」**
 *   —— 表格里说「第 N 空」，学生找不到那一格（`blankLabelAt` 那条注释）；
 * · 答错的那格 ⇒ 那个格里的字改成**暗红 + 删除线**（★ 2026-09-29 教师：红叉对学生的
 *   体验不好）。⚠️ 与题干里的空**同一条规则**（`WRONG_ANSWER_STYLE` 只有一份），不是各写一份；
 * · 不加 `:has()` / `content-visibility` / `@container` / `color-mix()`、
 *   不用 `Array.prototype.at` —— 学生端跑在 Safari 15 的老 iPad 上
 *   （`scripts/check-classroom-browser-compat.mjs` 会把门）。
 */

/** 表格里那些空的绑定。⚠️ `values` 用**全局**下标（题干里的空排在表格的空之前）。 */
export interface TableBlankBinding {
  values: string[];
  /** 表格里第 0 个空在 `values` 里的下标（= `blankLayout(node).tableBase`）。 */
  base: number;
  onChange: (index: number, value: string) => void;
  disabled: boolean;
  /** 某个**全局**下标是不是答错了。⚠️ 服务端只发答错的那几格，所以「拿到什么画什么」。 */
  wrongOf?: (index: number) => boolean;
  /**
   * ★ 2026-09-28（教师）：「表格里的空也应该可以设置三种方式，跟普通填空域一样。」
   * ⇒ 表格里的空也能是**落点槽**（右侧选词 / 下方选词），不只是输入框。
   * ⚠️ 形状与 `PromptBlankBinding` 那一个**刻意一样**（同一套拖拽那一层按
   * `data-drop-id` 找人，跨组件没问题）——调用方把同一个对象喂给两处。
   */
  modeOf?: (index: number) => 'input' | 'drop';
  drop?: {
    idOf: (index: number) => string;
    onPlace: (index: number) => void;
    pending: string | null;
    activeId?: string | null;
    /** 紧跟在槽后面的内容（「右侧选词」那一串候选词）。 */
    after?: (index: number) => ReactNode;
  };
}

export interface WorksheetTableViewProps {
  table: unknown;
  /**
   * ⚠️ **有它 ⇒ 空画成输入框；没有它 ⇒ 空画成一截下划线**（教师端的只读预览）。
   * 这是同一份渲染器的两种用途，不是两套实现 —— 与 `PromptText` 的 `blanks` 同一条规矩。
   */
  blanks?: TableBlankBinding;
}

/** 一格的内边距与边框。边距小是刻意的：表格要在一屏里放下。 */
const CELL_STYLE: CSSProperties = {
  border: '1px solid #cbd5e1',
  padding: '6px 8px',
  verticalAlign: 'middle',
  // ⚠️ 空的那一格也要撑得住：没有这一条，一个空行会被压成一条线
  minWidth: '5.5em',
};

/**
 * 表格里的空没有 `PromptRun`（那是**题干**的分段概念），而 `BlankSlot` 要一个 run
 * 来取字重与颜色 ⇒ 给它一个「什么都没设」的：颜色与题干基线一致，字重不额外加粗。
 * ⚠️ 与浮出那个「同一个空、换个模式粗细就变了」的教训同源 —— 槽从不自己写字重。
 */
const PLAIN_RUN = {
  start: 0, end: 0, bold: false, italic: false, underline: false, emphasis: false,
  color: '#1e293b', blank: '',
};

const HEADER_STYLE: CSSProperties = { ...CELL_STYLE, background: '#f1f5f9', fontWeight: 600 };

/**
 * 归一化读表格。**这里不重新实现一遍** —— 判据在 `worksheet-table.ts`（有用例），
 * 本组件只负责画。⚠️ 与 `PromptText` 同一条纪律：渲染层不做判断。
 */
function rowsOf(table: unknown): WorksheetTable['rows'] {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  const rows = (table as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!Array.isArray(row)) return [];
    return row.map((item) => {
      const cell = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : {};
      return {
        text: typeof cell.text === 'string' ? cell.text : '',
        blank: typeof cell.blank === 'string' ? cell.blank : '',
      };
    });
  });
}

export function WorksheetTableView({ table, blanks }: WorksheetTableViewProps) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;
  const rows = rowsOf(table);
  if (rows.length === 0) return null;
  const headerRow = (table as Record<string, unknown>).headerRow !== false;

  // 表格里的第几个空（**表内**下标，从 0 起、行优先）—— 就地数，不从外面传：
  // 那个数必须与 `blankSlotIndex` 同一条规则给。
  let slot = -1;
  return (
    // ⚠️ 横向滚动：iPad 竖屏放不下一张 5 列的表。**不许**把表格压成挤在一起的字。
    //    `-webkit-overflow-scrolling` 是给老 iPad 的惯性滚动（Safari 15 仍认它）。
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginTop: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.95rem' }}>
        <tbody>
          {rows.map((cells, row) => (
            <tr key={row}>
              {cells.map((cell, col) => {
                const isBlank = cell.blank !== '';
                if (isBlank) slot += 1;
                const label = cellLabel(row, col);
                const globalIndex = blanks ? blanks.base + slot : -1;
                const wrong = isBlank && blanks?.wrongOf ? blanks.wrongOf(globalIndex) : false;
                return (
                  <td key={col} style={headerRow && row === 0 ? HEADER_STYLE : CELL_STYLE}>
                    {isBlank ? (
                      <Fragment>
                        {blanks && blanks.drop && blanks.modeOf?.(globalIndex) !== 'input' ? (
                          /* ★ 2026-09-28：这一格是**落点槽**（右侧选词 / 下方选词）——
                             与题干里那种槽**同一个组件**（`BlankSlot`），所以两处长得一样。
                             ⚠️ 宽度给 `100%`：表格里的槽跟着格子走（题干里那个跟着占位文字走）。 */
                          <BlankSlot
                            run={PLAIN_RUN}
                            width="100%"
                            value={blanks.values[globalIndex] ?? ''}
                            label={label}
                            wrong={wrong}
                            disabled={blanks.disabled}
                            active={blanks.drop.activeId === blanks.drop.idOf(globalIndex)}
                            pending={blanks.drop.pending}
                            dropId={blanks.drop.idOf(globalIndex)}
                            onPlace={() => blanks.drop?.onPlace(globalIndex)}
                          >
                            {blanks.drop.after?.(globalIndex)}
                          </BlankSlot>
                        ) : blanks ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                            <input
                              type="text"
                              className="worksheet-blank-input"
                              aria-label={blankAriaLabel(label, wrong)}
                              value={blanks.values[globalIndex] ?? ''}
                              disabled={blanks.disabled}
                              onChange={(event) => blanks.onChange(globalIndex, event.target.value)}
                              // 与题干输入、选择填空槽走同一个最终样式：学生填写的内容恒为
                              // 600 字重；答错时再由同一函数叠加暗红色与删除线。
                              style={{
                                flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box',
                                ...(blankValueStyle(PLAIN_RUN, wrong) as CSSProperties),
                              }}
                            />
                          </span>
                        ) : (
                          // 只读预览（教师端）：画一截下划线，与题干里那些空同一个观感
                          <span
                            aria-label={label}
                            style={{
                              display: 'inline-block',
                              minWidth: '4em',
                              borderBottom: '1.5px solid #94a3b8',
                            }}
                          >
                            {' '}
                          </span>
                        )}
                      </Fragment>
                    ) : (
                      // 空格子也要占住那一行的高度（否则整行会被压扁）
                      cell.text === '' ? ' ' : cell.text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
