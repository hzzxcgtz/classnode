import { blankCount, readPromptRuns } from './worksheet-prompt-marks.ts';

/**
 * 表格填空的**纯逻辑核心**（★ 2026-09-28，教师裁定「按 B 做」＝ 结构化网格）。
 *
 * 教师原话：「学生可在教师提供的表格中在指定的位置填空答题。」
 * 设计见 `specs/2026-09-28-表格填空.md`。**不新增题型** —— 表格挂在 `fill-blank` 的
 * `data.table` 上，判分一个字不改（服务端只认 `data.answers[i]` 的位置，从不读题干：
 * `answerSlotCount` 的注释写着「不是题干里画了几个框」）。
 *
 * ── 🔴 这个文件为什么必须零 import（只有一条相对 import，且它自己也零 import）──────
 * 表格的**编辑器是一个网格面板**，而网格面板那一层在本机**一行都跑不到**
 * （没有 jsdom、没有浏览器）。⇒ 所有算术必须住在这一层，它才有回归网。
 * 同一条纪律的先例是 `worksheet-prompt-marks.ts`（「是不是空由文本决定」那条裁定
 * 就是为此把判断从 DOM 层搬过来的）。**面板里不许有任何自己的算术。**
 *
 * ── 🔴 这个文件里最容易写错的一件事：答案的**绝对位置** ──────────────────────
 * 答案 `data.answers` 是**全局**的、按位置存的（`answers[i]` = 从左到右第 i 个空），
 * 而题干里的空排在表格的空**之前**（裁定②：表格固定渲染在题干之后）。
 * ⇒ 表格里第 k 个空在 `answers` 里的下标是 `base + k`，**`base` 就是题干里的空数**。
 * 把 `base` 忘了的症状：教师标一个空，答案插到了题干空的位置上 ——
 * 屏幕上一切正常，而**学生答对被判错**。所以每个动答案的函数都收 `base`，一处都不许省。
 *
 * ⚠️ 空的**身份**（`blank`）与题干那套共用同一个命名空间、同一种造法
 * （`blank_<6 位 base36>`，见 `prompt-editor.tsx` 的 `blankIdSuffix`）。
 * 造 id 的能力**由调用方传进来**（这里的函数只收一个 id 字符串）——
 * 纯逻辑层自己造标识的话，用例就不确定了（`recognizeBlanks` 那条注释的同一条理由）。
 */

/** 表格的行数上限。⚠️ 产品数（照 `MAX_OPTIONS = 26` 的先例），教师觉得不合适就改。 */
export const MAX_TABLE_ROWS = 10;
/** 表格的列数上限。理由与 iPad 竖屏下的可读性有关，不是技术限制。 */
export const MAX_TABLE_COLS = 10;
/** 表格里空的个数上限（一道表格题最多几个空）。 */
export const MAX_TABLE_BLANKS = 30;

/** 一格。`blank` 非空 ⇒ 这一格是空（值就是那个空的身份）。 */
export interface WorksheetTableCell {
  text: string;
  blank: string;
}

/**
 * 一张表格。
 *
 * ⚠️ **v1 是方正网格**（每一行等长）。行列不齐的表格会让「这一格是第几行第几列」
 * 有两个可能的答案，而那个数就是 `data.answers` 的下标 —— 所以不齐的输入一律**补齐**
 * （`parseTablePaste`）或按第一行算列数（`tableColumnCount`），不让不齐的形状活下去。
 */
export interface WorksheetTable {
  rows: WorksheetTableCell[][];
  /** 第一行当表头（**只影响外观**：加粗与底色）。 */
  headerRow: boolean;
}

/** 造一个空格子。 */
function emptyCell(): WorksheetTableCell {
  return { text: '', blank: '' };
}

/** 把库里读到的一格归一化。**坏元素变成空格子而不是被丢掉**（丢掉会挪动列下标）。 */
function readCell(raw: unknown): WorksheetTableCell {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCell();
  const row = raw as Record<string, unknown>;
  return {
    text: typeof row.text === 'string' ? row.text : '',
    blank: typeof row.blank === 'string' ? row.blank : '',
  };
}

/**
 * 把库里读到的东西归一化成一张表（读的一侧不信任库）。
 *
 * ⚠️ **坏的「行」变成空行而不是被丢掉**：丢掉会让后面的行整体上移一格，
 * 而行的下标就是「第几行」—— 那是 `data.answers` 的一部分。
 */
function readTable(raw: unknown): WorksheetTable {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rows: [], headerRow: true };
  const source = raw as Record<string, unknown>;
  const rows = Array.isArray(source.rows) ? source.rows : [];
  return {
    rows: rows.map((row) => (Array.isArray(row) ? row.map(readCell) : [])),
    headerRow: source.headerRow !== false,
  };
}

/** 夹进 `[low, high]`。**不是数字就当成 `low`**（与 `worksheet-prompt-marks` 同一把尺子）。 */
function clampIndex(raw: unknown, low: number, high: number): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : low;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function tableRowCount(table: unknown): number {
  return readTable(table).rows.length;
}

/** 列数 = **第一行**的长度（v1 正方正网格；不齐的形状按第一行算）。 */
export function tableColumnCount(table: unknown): number {
  const rows = readTable(table).rows;
  return rows.length > 0 ? rows[0].length : 0;
}

/** 表格里有几个空（= 学生要在表格里填几格）。 */
export function tableBlankCount(table: unknown): number {
  return readTable(table).rows.reduce(
    (total, row) => total + row.filter((cell) => cell.blank !== '').length,
    0,
  );
}

/**
 * 严格排在 `(row, col)` **之前**的空有几个（行优先）。
 *
 * ⚠️ 行优先就是「第几个空」的**唯一一条规则**（表格固定渲染在题干之后 ⇒ 顺序没有第二种可能）。
 * 它同时是 `blankSlotIndex`（表内下标）与 `setCellBlank`（新标一个空时插在哪一号）的底座。
 */
function blanksBeforeRows(rows: WorksheetTableCell[][], row: number, col: number): number {
  let total = 0;
  for (let r = 0; r < rows.length; r += 1) {
    if (r > row) break;
    const cells = rows[r];
    const upto = r === row ? Math.min(col, cells.length) : cells.length;
    for (let c = 0; c < upto; c += 1) if (cells[c].blank !== '') total += 1;
  }
  return total;
}

function blanksBefore(table: unknown, row: number, col: number): number {
  return blanksBeforeRows(readTable(table).rows, row, col);
}

/**
 * 那一格是**表格里的**第几个空（0 起）。不是空 / 坐标越界 / 没有那一格 ⇒ `-1`。
 *
 * ⚠️ 这是**表内**下标，不是 `data.answers` 的下标 —— 后者要加 `base`（题干里的空数）。
 * 分开两件事是刻意的：`base` 只在一处加（每个动答案的函数里各加一次），
 * 混进来的话「表内下标」与「全局下标」就会有两份说法。
 */
export function blankSlotIndex(table: unknown, row: number, col: number): number {
  const rows = readTable(table).rows;
  const cells = rows[row];
  if (!Array.isArray(cells) || col < 0 || col >= cells.length) return -1;
  if (cells[col].blank === '') return -1;
  return blanksBeforeRows(rows, row, col);
}

/** 给人看的位置：**教师与学生共用这一句话**。 */
export function cellLabel(row: number, col: number): string {
  return `第 ${row + 1} 行第 ${col + 1} 格`;
}

/** 一格的文本被改了。**答案与标空状态都不动** —— 改字与「这一格是不是空」是两件事。 */
export function setCellText(table: unknown, row: number, col: number, text: string): WorksheetTable {
  const current = readTable(table);
  const cells = current.rows[row];
  if (!Array.isArray(cells) || !Number.isInteger(col) || col < 0 || col >= cells.length) return current;
  const next = typeof text === 'string' ? text : '';
  if (cells[col].text === next) return current;
  return withCell(current, row, col, { ...cells[col], text: next });
}

/**
 * 从节点里读出那张表（编辑期用）。**没有表 / 有键但没有行 / 坏形状 ⇒ `null`**。
 *
 * ⚠️ 「有 `data.table` 键但一行都没有」当成**没有表**：那种形状在界面上是一个空白块，
 * 教师看不出「我到底加没加表」。`createTable` 保证新表至少 1×1。
 */
export function readTableFor(node: { data: Record<string, unknown> }): WorksheetTable | null {
  const data = node && node.data && typeof node.data === 'object' ? node.data : {};
  const raw = data.table;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const table = readTable(raw);
  return table.rows.length > 0 ? table : null;
}

/**
 * 表格里那些空的**身份**，按行优先（★ 2026-09-28）。
 *
 * 🔴 它就是 `fillBlankSettings` 的键 —— 与题干里的空**共用同一个命名空间**
 *（`blankLayout` / `blankLabelAt` 也按同一顺序编号，三处一条规则）。
 */
export function tableBlankIds(table: unknown): string[] {
  const ids: string[] = [];
  readTable(table).rows.forEach((cells) => {
    cells.forEach((cell) => { if (cell.blank !== '') ids.push(cell.blank); });
  });
  return ids;
}

/** 表格里的第 `slot` 个空在哪一格（行优先）。越界 / 没有那一个 ⇒ `null`。 */
export function cellAtSlot(table: unknown, slot: number): { row: number; col: number } | null {
  if (!Number.isInteger(slot) || slot < 0) return null;
  const rows = readTable(table).rows;
  let seen = 0;
  for (let row = 0; row < rows.length; row += 1) {
    const cells = rows[row];
    for (let col = 0; col < cells.length; col += 1) {
      if (cells[col].blank === '') continue;
      if (seen === slot) return { row, col };
      seen += 1;
    }
  }
  return null;
}

/**
 * 第 `index` 个空**叫什么** —— 「正确答案」那块提示要用它（`specs/2026-09-28-表格填空.md`）。
 *
 * 🔴 两句话**必须不一样**：题干里的空说「第 N 空」；表格里的空说「第 2 行第 1 格」。
 * 表格里的空要是也说「第 N 空」，学生拿到答案也**找不到那一格在哪** ——
 * 而这块提示的全部用处就是告诉他「去改哪一格」。
 *
 * 越界 ⇒ `null`（调用方跳过它）：**不写半句话**（服务端对「没设答案键的空」不发答案，
 * 同一条窄口）。
 */
export function blankLabelAt(
  node: { prompt: string; data: Record<string, unknown> },
  index: number,
): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const { textCount } = blankLayout(node);
  if (index < textCount) return `第 ${index + 1} 空`;
  const data = node.data && typeof node.data === 'object' ? node.data : {};
  const inside = cellAtSlot(data.table, index - textCount);
  return inside ? cellLabel(inside.row, inside.col) : null;
}

/**
 * 这道题的空一共几个、各从几号开始 —— 客户端数空的**唯一真源**。
 *
 * `readBlankCount(node)` 就是 `blankLayout(node).total`（见 `worksheet-answer-value.ts`），
 * 于是 `emptyDraftFor` / `draftFromValue` / `buildAnswerValue` / 面板四处**一行都不用改**。
 *
 * 🔴 **两种空可以并存**（题干里的空 + 表格里的空），顺序是「题干在前、表格在后」。
 * 裁定②（表格固定渲染在题干之后）让这个顺序没有歧义 —— 不需要额外一条规则。
 */
export function blankLayout(node: { prompt: string; data: Record<string, unknown> }): {
  textCount: number;
  tableCount: number;
  total: number;
  tableBase: number;
} {
  const data = node.data && typeof node.data === 'object' ? node.data : {};
  const textCount = blankCount(readPromptRuns(data.promptRuns, node.prompt));
  const tableCount = tableBlankCount(data.table);
  return { textCount, tableCount, total: textCount + tableCount, tableBase: textCount };
}

export function canAddTableRow(table: unknown): boolean {
  return tableRowCount(table) < MAX_TABLE_ROWS;
}

/** ⚠️ 一行都没有时**加不了列** —— 没有行就无处补格子（面板该把按钮禁掉）。 */
export function canAddTableColumn(table: unknown): boolean {
  return tableRowCount(table) > 0 && tableColumnCount(table) < MAX_TABLE_COLS;
}

/** 一张新表。行列都被上限夹住、且至少 1×1（表格不许没有格子）。 */
export function createTable(rowCount: unknown, colCount: unknown, headerRow = true): WorksheetTable {
  const rows = clampIndex(rowCount, 1, MAX_TABLE_ROWS);
  const cols = clampIndex(colCount, 1, MAX_TABLE_COLS);
  return {
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => emptyCell())),
    headerRow,
  };
}

/** 把 `index` 那几个位置的元素删掉。**必须从后往前删**，否则下标会随着删除而漂。 */
function removeAt<T>(list: readonly T[], indexes: readonly number[]): T[] {
  const out = list.slice();
  indexes
    .slice()
    .sort((a, b) => b - a)
    .forEach((index) => {
      if (Number.isInteger(index) && index >= 0 && index < out.length) out.splice(index, 1);
    });
  return out;
}

/** 换掉某一格的副本（不动传进来的那张表）。 */
function withCell(table: WorksheetTable, row: number, col: number, cell: WorksheetTableCell): WorksheetTable {
  return {
    ...table,
    rows: table.rows.map((cells, r) => (
      r === row ? cells.map((item, c) => (c === col ? cell : item)) : cells
    )),
  };
}

/**
 * 标记 / 取消标记一个空。
 *
 * `id` 是非空字符串 ⇒ 标成那个身份；`null` 或空串 ⇒ 取消。
 * ⚠️ 已经是空、再给一个**新**身份 ⇒ 只换身份，答案一个不动（教师在改 id 的场景）。
 *
 * 🔴 答案的 splice 位置：标空插在 `base + blanksBefore(自己)`（自己还不是空，
 * 所以它前面那几个空就是它该在的号）；取消则删掉 `base + blankSlotIndex(自己)`。
 */
export function setCellBlank(
  table: unknown,
  answers: readonly string[][],
  base: number,
  row: number,
  col: number,
  id: string | null,
): { table: WorksheetTable; answers: string[][] } {
  const current = readTable(table);
  const cells = current.rows[row];
  const inside = Array.isArray(cells) && Number.isInteger(col) && col >= 0 && col < cells.length;
  if (!inside) return { table: current, answers: answers.slice() };

  const cell = cells[col];
  const nextId = typeof id === 'string' ? id : '';
  if (cell.blank === nextId) return { table: current, answers: answers.slice() };

  // 取消：删掉它那一份答案，后面的整体前移
  if (nextId === '') {
    const slot = base + blankSlotIndex(current, row, col);
    return { table: withCell(current, row, col, { ...cell, blank: '' }), answers: removeAt(answers, [slot]) };
  }

  // 换身份：答案不动
  if (cell.blank !== '') {
    return { table: withCell(current, row, col, { ...cell, blank: nextId }), answers: answers.slice() };
  }

  // 新标一个空：**先看上限**（超了什么都不动 —— 不静默截断）
  if (tableBlankCount(current) >= MAX_TABLE_BLANKS) {
    return { table: current, answers: answers.slice() };
  }
  const slot = base + blanksBefore(current, row, col);
  const next = answers.slice();
  next.splice(Math.min(slot, next.length), 0, []);
  return { table: withCell(current, row, col, { ...cell, blank: nextId }), answers: next };
}

/**
 * 插一行。🔴 **答案一份都不动** —— 新行里的格子全是空格（没有空就没有答案）。
 * 推论：插行是**零风险**的结构操作，与「标空 / 取消标空 / 删行 / 删列」四条不同。
 */
export function insertTableRow(
  table: unknown,
  answers: readonly string[][],
  base: number,
  at: number,
): { table: WorksheetTable; answers: string[][] } {
  const current = readTable(table);
  if (!canAddTableRow(current)) return { table: current, answers: answers.slice() };
  const cols = tableColumnCount(current);
  const index = clampIndex(at, 0, current.rows.length);
  const rows = current.rows.slice();
  rows.splice(index, 0, Array.from({ length: cols }, () => emptyCell()));
  return { table: { ...current, rows }, answers: answers.slice() };
}

/** 插一列。同 `insertTableRow`：答案一份都不动。 */
export function insertTableColumn(
  table: unknown,
  answers: readonly string[][],
  base: number,
  at: number,
): { table: WorksheetTable; answers: string[][] } {
  const current = readTable(table);
  if (!canAddTableColumn(current)) return { table: current, answers: answers.slice() };
  const index = clampIndex(at, 0, tableColumnCount(current));
  const rows = current.rows.map((cells) => {
    const next = cells.slice();
    next.splice(Math.min(index, next.length), 0, emptyCell());
    return next;
  });
  return { table: { ...current, rows }, answers: answers.slice() };
}

/** 删一行：把这一行里的空那几份答案删掉（`removeAt` 会从后往前删）。 */
export function removeTableRow(
  table: unknown,
  answers: readonly string[][],
  base: number,
  at: number,
): { table: WorksheetTable; answers: string[][] } {
  const current = readTable(table);
  // ⚠️ 最后一行不许删：表格必须留得下格子（没有格子的表在界面上是个空白块）
  if (current.rows.length <= 1) return { table: current, answers: answers.slice() };
  if (!Number.isInteger(at) || at < 0 || at >= current.rows.length) {
    return { table: current, answers: answers.slice() };
  }
  const slots: number[] = [];
  current.rows[at].forEach((cell, col) => {
    if (cell.blank !== '') slots.push(base + blankSlotIndex(current, at, col));
  });
  return {
    table: { ...current, rows: current.rows.filter((_, index) => index !== at) },
    answers: removeAt(answers, slots),
  };
}

/** 删一列：**每一行**都要看一眼那一格是不是空（一列里可能有好几个空）。 */
export function removeTableColumn(
  table: unknown,
  answers: readonly string[][],
  base: number,
  at: number,
): { table: WorksheetTable; answers: string[][] } {
  const current = readTable(table);
  const cols = tableColumnCount(current);
  // ⚠️ 最后一列不许删（与最后一行同一条理由）
  if (cols <= 1) return { table: current, answers: answers.slice() };
  if (!Number.isInteger(at) || at < 0 || at >= cols) return { table: current, answers: answers.slice() };
  const slots: number[] = [];
  current.rows.forEach((cells, row) => {
    const cell = cells[at];
    if (cell && cell.blank !== '') slots.push(base + blankSlotIndex(current, row, at));
  });
  return {
    table: { ...current, rows: current.rows.map((cells) => cells.filter((_, col) => col !== at)) },
    answers: removeAt(answers, slots),
  };
}

/**
 * 从剪贴板粘进来的表格 → 行列表（★ Excel/Word 复制出来就是 TSV）。
 *
 * 🔴 **一个制表符都没有 ⇒ `null`**：那不是一张表（一句话、一段文字都会走到这里，
 * 把一整段话当成「一列的表」是替教师做了一个他没做的决定）。照 `parseQuestionPaste`
 * 的先例：认不出来就如实说认不出来，让调用方去问人。
 *
 * ⚠️ **每格两侧空白去掉**、末尾换行不产生空行、**行长短不一补齐成方正网格**
 * （v1 的不变式）、超过上限**截断并报出丢了多少**（不静默 —— 照 `parseQuestionPaste`
 * 的 `dropped` 那条纪律）。
 */
export function parseTablePaste(raw: unknown): {
  rows: string[][];
  droppedRows: number;
  droppedCols: number;
} | null {
  if (typeof raw !== 'string') return null;
  const source = raw.replace(/\r\n?/g, '\n');
  if (!source.includes('\t')) return null;
  const lines = source.split('\n');
  // 末尾那个换行不算一行
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return null;
  const cells = lines.map((line) => line.split('\t').map((item) => item.trim()));
  // 全是空的（例如只有一个制表符）⇒ 不是一张表
  if (cells.every((row) => row.every((item) => item === ''))) return null;

  const droppedRows = Math.max(0, cells.length - MAX_TABLE_ROWS);
  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  const droppedCols = Math.max(0, width - MAX_TABLE_COLS);
  const cols = Math.min(width, MAX_TABLE_COLS);
  return {
    rows: cells.slice(0, MAX_TABLE_ROWS).map((row) => (
      Array.from({ length: cols }, (_, index) => row[index] ?? '')
    )),
    droppedRows,
    droppedCols,
  };
}
