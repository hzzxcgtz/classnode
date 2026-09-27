import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PROMPT_STYLE, type PromptRun } from './worksheet-prompt-marks.ts';
import {
  MAX_TABLE_BLANKS,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  blankLabelAt,
  blankLayout,
  blankSlotIndex,
  canAddTableColumn,
  canAddTableRow,
  cellAtSlot,
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
  tableBlankIds,
  tableColumnCount,
  tableRowCount,
  type WorksheetTable,
} from './worksheet-table.ts';

/** 造一格。`blank` 非空 ⇒ 这一格是空（用可读的名字，不用随机 id）。 */
function cell(text: string, blank = '') {
  return { text, blank };
}

/** 3×3，两个空：第 2 行第 2 格（b1）、第 3 行第 3 格（b2）。 */
function sampleTable(): WorksheetTable {
  return {
    headerRow: true,
    rows: [
      [cell('姓名'), cell('年龄'), cell('城市')],
      [cell('张三'), cell('', 'b1'), cell('北京')],
      [cell('李四'), cell('25'), cell('', 'b2')],
    ],
  };
}

/**
 * `rowCount × colCount` 的表，`blanks` 里那几格（按 **0 起的 `[行, 列]`**）是空。
 * ⚠️ 它存在的理由是**造不在对角线上的空** —— `sampleTable` 那两个空都在对角线上，
 * 行列写反在它身上看不出来（变异检验抓过这个洞）。
 */
function tableOf(rowCount: number, colCount: number, blanks: Array<[number, number]> = []): WorksheetTable {
  return {
    headerRow: true,
    rows: Array.from({ length: rowCount }, (_, row) => Array.from({ length: colCount }, (_, col) => ({
      text: `r${row}c${col}`,
      blank: blanks.some(([r, c]) => r === row && c === col) ? `tb_${row}_${col}` : '',
    }))),
  };
}

/**
 * 造一道题干里有 `textBlanks` 个空的题（够 `blankLayout` 用）。
 * ⚠️ 题干那一段的文本必须与分段**逐字对上**：`readPromptRuns` 会把不拼满的分段丢掉。
 */
function nodeOf(textBlanks: number, table?: unknown) {
  const prompt = '{填空域}'.repeat(textBlanks);
  const runs: PromptRun[] = Array.from({ length: textBlanks }, (_, index) => ({
    start: index * 5,
    end: index * 5 + 5,
    ...DEFAULT_PROMPT_STYLE,
    blank: `t${index + 1}`,
  }));
  return { prompt, data: { promptRuns: runs, ...(table === undefined ? {} : { table }) } };
}

// ── 读：数空、位置、给人看的标签 ──────────────────────────────────────

test('tableBlankCount：数表格里的空', () => {
  assert.equal(tableBlankCount(sampleTable()), 2);
});

test('🔴 tableBlankCount：没有表格 / 坏形状一律 0，不抛', () => {
  assert.equal(tableBlankCount(undefined), 0);
  assert.equal(tableBlankCount(null), 0);
  assert.equal(tableBlankCount({}), 0);
  assert.equal(tableBlankCount({ rows: '不是数组' }), 0);
  assert.equal(tableBlankCount({ rows: [null, 3, 'x'] }), 0);
  // 行里的坏元素跳过，好元素照数
  assert.equal(tableBlankCount({ rows: [[cell('甲'), null, cell('乙', 'b1')]] }), 1);
});

test('tableRowCount / tableColumnCount', () => {
  assert.equal(tableRowCount(sampleTable()), 3);
  assert.equal(tableColumnCount(sampleTable()), 3);
  assert.equal(tableRowCount(undefined), 0);
  assert.equal(tableColumnCount(undefined), 0);
});

test('🔴 blankSlotIndex：行优先，不是空的那格是 -1', () => {
  const table = sampleTable();
  assert.equal(blankSlotIndex(table, 1, 1), 0);
  assert.equal(blankSlotIndex(table, 2, 2), 1);
  assert.equal(blankSlotIndex(table, 0, 0), -1);
  assert.equal(blankSlotIndex(table, 2, 1), -1);
  // 越界 / 坏坐标
  assert.equal(blankSlotIndex(table, 9, 9), -1);
  assert.equal(blankSlotIndex(table, -1, 0), -1);
  assert.equal(blankSlotIndex(undefined, 0, 0), -1);
});

test('cellLabel：给人看的「第 R 行第 C 格」（从 1 数起）', () => {
  assert.equal(cellLabel(1, 0), '第 2 行第 1 格');
  assert.equal(cellLabel(0, 2), '第 1 行第 3 格');
});

test('🔴 blankLayout：题干空在前、表格空在后，tableBase 是表格空的起始号', () => {
  assert.deepEqual(blankLayout(nodeOf(2, sampleTable())), { textCount: 2, tableCount: 2, total: 4, tableBase: 2 });
});

test('blankLayout：只有题干空', () => {
  assert.deepEqual(blankLayout(nodeOf(3)), { textCount: 3, tableCount: 0, total: 3, tableBase: 3 });
});

test('blankLayout：只有表格空', () => {
  assert.deepEqual(blankLayout(nodeOf(0, sampleTable())), { textCount: 0, tableCount: 2, total: 2, tableBase: 0 });
});

test('blankLayout：一个空都没有', () => {
  assert.deepEqual(blankLayout(nodeOf(0)), { textCount: 0, tableCount: 0, total: 0, tableBase: 0 });
});

test('🔴 blankLayout：表格坏掉时只数题干那一份（不抛、也不假装有表格空）', () => {
  assert.deepEqual(blankLayout(nodeOf(1, { rows: 'x' })), { textCount: 1, tableCount: 0, total: 1, tableBase: 1 });
});

// ── 标空 / 取消标空：答案必须在**正确的绝对位置** splice ──────────────

test('🔴 setCellBlank：标空把一份空答案插在正确的绝对位置', () => {
  const table: WorksheetTable = { headerRow: false, rows: [[cell('甲'), cell('乙')]] };
  const state = setCellBlank(table, [['题']], 1, 0, 0, 'b1');
  assert.deepEqual(state.answers, [['题'], []]);
  assert.equal(state.table.rows[0][0].blank, 'b1');
  // 再标右边那一格 ⇒ 插在它自己那一号（1 + 1）
  const second = setCellBlank(state.table, state.answers, 1, 0, 1, 'b2');
  assert.deepEqual(second.answers, [['题'], [], []]);
});

test('🔴 setCellBlank：取消标空删掉那一份答案，后面的整体前移', () => {
  const table: WorksheetTable = {
    headerRow: false,
    rows: [[cell('', 'b1'), cell('', 'b2')]],
  };
  const state = setCellBlank(table, [['题'], ['A'], ['B']], 1, 0, 0, null);
  assert.deepEqual(state.answers, [['题'], ['B']]);
  assert.equal(state.table.rows[0][0].blank, '');
  // b2 那一格的号跟着前移 —— 它仍然是「表格里的第 0 个空」
  assert.equal(blankSlotIndex(state.table, 0, 1), 0);
});

test('🔴 setCellBlank：标空再取消 = 回到原样（往返）', () => {
  const table: WorksheetTable = { headerRow: false, rows: [[cell('甲'), cell('乙')]] };
  const answers = [['题']];
  const marked = setCellBlank(table, answers, 1, 0, 1, 'b1');
  const back = setCellBlank(marked.table, marked.answers, 1, 0, 1, null);
  assert.deepEqual(back.answers, answers);
  assert.deepEqual(back.table.rows, table.rows);
});

test('setCellBlank：取消标空时给空串也算取消（与 null 同义）', () => {
  const table: WorksheetTable = { headerRow: false, rows: [[cell('', 'b1')]] };
  const state = setCellBlank(table, [['A']], 0, 0, 0, '');
  assert.deepEqual(state.answers, []);
  assert.equal(state.table.rows[0][0].blank, '');
});

test('setCellBlank：已经是空、再给一个身份 ⇒ 换身份，答案一个都不动', () => {
  const table: WorksheetTable = { headerRow: false, rows: [[cell('', 'b1')]] };
  const state = setCellBlank(table, [['A']], 0, 0, 0, 'b9');
  assert.deepEqual(state.answers, [['A']]);
  assert.equal(state.table.rows[0][0].blank, 'b9');
});

test('🔴 setCellBlank：越界 / 坏坐标 ⇒ 原样返回，不抛', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  assert.deepEqual(setCellBlank(table, answers, 0, 9, 0, 'b1').answers, answers);
  assert.deepEqual(setCellBlank(table, answers, 0, 0, 9, 'b1').answers, answers);
  assert.deepEqual(setCellBlank(table, answers, 0, -1, 0, 'b1').answers, answers);
  assert.deepEqual(setCellBlank(undefined, answers, 0, 0, 0, 'b1').answers, answers);
});

test('🔴 setCellBlank：answers 比空数短（坏数据）时不抛', () => {
  // 表里有两个空（b1 在第 0 号、b2 在第 1 号），但只存了一份答案
  const table: WorksheetTable = { headerRow: false, rows: [[cell('', 'b1'), cell('', 'b2')]] };
  // 取消第 1 号那个空：越界的那一次 splice 是空操作，剩下那一份原样留着
  const state = setCellBlank(table, [['A']], 0, 0, 1, null);
  assert.deepEqual(state.answers, [['A']]);
  assert.equal(state.table.rows[0][1].blank, '');
});

test('🔴 setCellBlank：不改传进来的那两个对象（纯函数）', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  const snapshot = JSON.stringify({ table, answers });
  setCellBlank(table, answers, 0, 1, 1, null);
  assert.equal(JSON.stringify({ table, answers }), snapshot);
});

// ── 插行 / 插列：答案一个都不动（新格子没有空）────────────────────────

test('🔴 插行：答案一个都不动（新行没有空）', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  const state = insertTableRow(table, answers, 0, 1);
  assert.deepEqual(state.answers, answers);
  assert.equal(tableRowCount(state.table), 4);
  assert.deepEqual(state.table.rows[1], [cell(''), cell(''), cell('')]);
  // 插进去的那一行在原来的第 1 行位置
  assert.equal(state.table.rows[2][0].text, '张三');
});

test('🔴 插列：答案一个都不动，每一行都补一格', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  const state = insertTableColumn(table, answers, 0, 1);
  assert.deepEqual(state.answers, answers);
  assert.equal(tableColumnCount(state.table), 4);
  state.table.rows.forEach((row) => assert.equal(row.length, 4));
});

test('插行 / 插列：越界一律夹进 [0, 行数]（不抛）', () => {
  const table = sampleTable();
  assert.equal(tableRowCount(insertTableRow(table, [], 0, 99).table), 4);
  assert.equal(tableRowCount(insertTableRow(table, [], 0, -5).table), 4);
  assert.equal(tableColumnCount(insertTableColumn(table, [], 0, 99).table), 4);
});

// ── 删行 / 删列：答案按行优先删掉，且**必须从后往前删** ────────────────

test('🔴 删行：删掉那一行的空，后面的答案整体前移（删第 0 行）', () => {
  const table: WorksheetTable = {
    headerRow: false,
    rows: [[cell('', 'b1')], [cell('中间')], [cell('', 'b2')]],
  };
  const state = removeTableRow(table, [['A'], ['B']], 0, 0);
  assert.deepEqual(state.answers, [['B']]);
  assert.equal(tableRowCount(state.table), 2);
  assert.equal(state.table.rows[0][0].text, '中间');
});

test('🔴 删列：同一列里有两个空时也必须删对（从后往前删）', () => {
  // 第 0 列里有两个空（b1、b2），第 1 列里有一个空（b3）
  const table: WorksheetTable = {
    headerRow: false,
    rows: [[cell('', 'b1'), cell('x')], [cell('', 'b2'), cell('y')], [cell('z'), cell('', 'b3')]],
  };
  const state = removeTableColumn(table, [['A'], ['B'], ['C']], 0, 0);
  assert.deepEqual(state.answers, [['C']]);
  assert.equal(tableColumnCount(state.table), 1);
  // b3 那一格现在还在，而且是表格里唯一的空
  assert.equal(blankSlotIndex(state.table, 2, 0), 0);
});

test('删行 / 删列：越界 ⇒ 原样返回，不抛', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  assert.deepEqual(removeTableRow(table, answers, 0, 99).answers, answers);
  assert.deepEqual(removeTableColumn(table, answers, 0, -1).answers, answers);
  assert.deepEqual(removeTableRow(table, answers, 0, 99).table.rows.length, 3);
});

test('删行 / 删列：整行一个空都没有 ⇒ 答案一份都不掉', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  assert.deepEqual(removeTableRow(table, answers, 0, 0).answers, answers);
});

test('🔴 删行：answers 比空数短（坏数据）时不抛', () => {
  const table: WorksheetTable = { headerRow: false, rows: [[cell('', 'b1')], [cell('', 'b2')]] };
  const state = removeTableRow(table, [], 0, 0);
  assert.deepEqual(state.answers, []);
});

// ── 上限（产品数，超过一律不生效 —— 界面靠 canAdd* 把按钮禁掉）────────

test('🔴 上限：加到第 MAX_TABLE_ROWS 行为止，第 MAX_TABLE_ROWS+1 行不生效', () => {
  let table: WorksheetTable = { headerRow: true, rows: [Array.from({ length: 2 }, () => cell(''))] };
  for (let index = 1; index < MAX_TABLE_ROWS; index += 1) table = insertTableRow(table, [], 0, index).table;
  assert.equal(tableRowCount(table), MAX_TABLE_ROWS);
  assert.equal(canAddTableRow(table), false);
  assert.equal(tableRowCount(insertTableRow(table, [], 0, 0).table), MAX_TABLE_ROWS);
});

test('🔴 上限：加到第 MAX_TABLE_COLS 列为止，再多一列不生效', () => {
  let table: WorksheetTable = { headerRow: true, rows: [[cell('')]] };
  for (let index = 1; index < MAX_TABLE_COLS; index += 1) table = insertTableColumn(table, [], 0, index).table;
  assert.equal(tableColumnCount(table), MAX_TABLE_COLS);
  assert.equal(canAddTableColumn(table), false);
  assert.equal(tableColumnCount(insertTableColumn(table, [], 0, 0).table), MAX_TABLE_COLS);
});

test('🔴 上限：标到第 MAX_TABLE_BLANKS 个空为止，再多一个不生效（答案也不被改）', () => {
  // 格子要**够多**，否则「第 31 个不生效」会因为坐标越界而通过 —— 那条用例就白写了。
  const rows = Math.ceil((MAX_TABLE_BLANKS + 1) / MAX_TABLE_COLS);
  const table: WorksheetTable = {
    headerRow: false,
    rows: Array.from({ length: rows }, () => Array.from({ length: MAX_TABLE_COLS }, () => cell(''))),
  };
  let current: WorksheetTable = table;
  let answers: string[][] = [];
  for (let index = 0; index < MAX_TABLE_BLANKS; index += 1) {
    const state = setCellBlank(current, answers, 0, Math.floor(index / MAX_TABLE_COLS), index % MAX_TABLE_COLS, `b${index}`);
    current = state.table;
    answers = state.answers;
  }
  assert.equal(tableBlankCount(current), MAX_TABLE_BLANKS);
  assert.equal(answers.length, MAX_TABLE_BLANKS);
  // 第 MAX_TABLE_BLANKS+1 个：**坐标在界内**，不生效只能是因为上限
  const at = { row: Math.floor(MAX_TABLE_BLANKS / MAX_TABLE_COLS), col: MAX_TABLE_BLANKS % MAX_TABLE_COLS };
  assert.ok(current.rows[at.row]?.[at.col], '这一格必须在界内，否则这条用例测的不是上限');
  const overflow = setCellBlank(current, answers, 0, at.row, at.col, 'overflow');
  assert.equal(tableBlankCount(overflow.table), MAX_TABLE_BLANKS);
  assert.deepEqual(overflow.answers, answers);
});

test('🔴 删行 / 删列：最后一行 / 最后一列不许删（表格必须留得下格子）', () => {
  const one: WorksheetTable = { headerRow: true, rows: [[cell('', 'b1')]] };
  assert.equal(tableRowCount(removeTableRow(one, [['A']], 0, 0).table), 1);
  assert.deepEqual(removeTableRow(one, [['A']], 0, 0).answers, [['A']]);
  assert.equal(tableColumnCount(removeTableColumn(one, [['A']], 0, 0).table), 1);
  assert.deepEqual(removeTableColumn(one, [['A']], 0, 0).answers, [['A']]);
});

test('createTable：造出方正网格，一个空都没有', () => {
  const table = createTable(2, 3);
  assert.equal(tableRowCount(table), 2);
  assert.equal(tableColumnCount(table), 3);
  assert.equal(tableBlankCount(table), 0);
  assert.equal(table.rows[0][0].blank, '');
});

test('createTable：行列数都被上限夹住', () => {
  assert.equal(tableRowCount(createTable(99, 99)), MAX_TABLE_ROWS);
  assert.equal(tableColumnCount(createTable(99, 99)), MAX_TABLE_COLS);
  assert.equal(tableRowCount(createTable(0, 0)), 1);
});

// ── 从剪贴板粘贴（Excel 复制出来就是 TSV）────────────────────────────

test('parseTablePaste：制表符分隔的多行 → 行列表', () => {
  const parsed = parseTablePaste('姓名\t年龄\n张三\t25');
  assert.deepEqual(parsed?.rows, [['姓名', '年龄'], ['张三', '25']]);
});

test('🔴 parseTablePaste：一个制表符都没有 ⇒ null（那不是一张表）', () => {
  assert.equal(parseTablePaste('就是一句话'), null);
  assert.equal(parseTablePaste('第一行\n第二行'), null);
});

test('parseTablePaste：末尾换行不产生空行；每格两侧空白去掉', () => {
  const parsed = parseTablePaste(' 姓名 \t 年龄 \n 张三 \t 25 \n');
  assert.deepEqual(parsed?.rows, [['姓名', '年龄'], ['张三', '25']]);
});

test('parseTablePaste：坏输入 ⇒ null', () => {
  assert.equal(parseTablePaste(''), null);
  assert.equal(parseTablePaste(null), null);
  assert.equal(parseTablePaste(42), null);
  assert.equal(parseTablePaste('\t'), null);
});

test('🔴 parseTablePaste：超过上限 ⇒ 截断并报出丢了多少（不静默）', () => {
  const rows = Array.from({ length: MAX_TABLE_ROWS + 2 }, (_, index) => `第${index}行\t值`);
  const parsed = parseTablePaste(rows.join('\n'));
  assert.equal(parsed?.rows.length, MAX_TABLE_ROWS);
  assert.equal(parsed?.droppedRows, 2);

  const extraCells = 3;
  const wide = ['表头', ...Array.from({ length: MAX_TABLE_COLS + extraCells }, (_, index) => `格${index}`)].join('\t');
  const parsedWide = parseTablePaste(wide);
  assert.equal(parsedWide?.rows[0].length, MAX_TABLE_COLS);
  // 一共 1 + (MAX_TABLE_COLS + extraCells) 格，留下 MAX_TABLE_COLS 格
  assert.equal(parsedWide?.droppedCols, extraCells + 1);
});

test('parseTablePaste：没有超出上限时 dropped 都是 0', () => {
  const parsed = parseTablePaste('甲\t乙');
  assert.equal(parsed?.droppedRows, 0);
  assert.equal(parsed?.droppedCols, 0);
});

// ── 编辑期访问器（网格面板用）──────────────────────────────────────────

test('🔴 readTableFor：从节点读出表格；没有表 / 空表 / 坏形状 ⇒ null', () => {
  assert.equal(readTableFor({ data: {} }), null);
  assert.equal(readTableFor({ data: { table: { rows: [] } } }), null, '有键但没有行 ⇒ 不算有表');
  assert.equal(readTableFor({ data: { table: '不是表' } }), null);
  const table = readTableFor({ data: { table: sampleTable() } });
  assert.equal(tableRowCount(table), 3);
  assert.equal(tableBlankCount(table), 2);
});

test('🔴 setCellText：改格子里的字，**答案一个都不动**', () => {
  const table = sampleTable();
  const answers = [['A'], ['B']];
  const next = setCellText(table, 0, 0, '名字');
  assert.equal(next.rows[0][0].text, '名字');
  assert.equal(next.rows[0][0].blank, '', '标空状态不受影响');
  // 改一个**是空**的格子：身份留着（它是空这件事不该被打字抹掉）
  const onBlank = setCellText(table, 1, 1, '提示文字');
  assert.equal(onBlank.rows[1][1].text, '提示文字');
  assert.equal(onBlank.rows[1][1].blank, 'b1');
  // 越界 ⇒ 什么都不改（⚠️ 断言看**内容**，不看引用：这些函数一律返回归一化过的副本）
  assert.deepEqual(setCellText(table, 9, 9, 'x'), readTableFor({ data: { table } }));
  assert.deepEqual(answers, [['A'], ['B']], '传进来的答案没被动过');
});

test('🔴 setCellText：不改传进来的那张表（纯函数）', () => {
  const table = sampleTable();
  const snapshot = JSON.stringify(table);
  setCellText(table, 1, 0, '李四四');
  assert.equal(JSON.stringify(table), snapshot);
});

// ── 反向映射：第几个空 → 哪一格（「正确答案」那句话要用它）──────────────

test('🔴 cellAtSlot：第 k 个空在哪一格（行优先）', () => {
  const table = sampleTable();
  assert.deepEqual(cellAtSlot(table, 0), { row: 1, col: 1 });
  assert.deepEqual(cellAtSlot(table, 1), { row: 2, col: 2 });
  assert.equal(cellAtSlot(table, 2), null);
  assert.equal(cellAtSlot(table, -1), null);
  assert.equal(cellAtSlot(undefined, 0), null);
});

test('🔴 cellAtSlot：**行列不能互换**（用不在对角线上的空钉住）', () => {
  // ⚠️ 这条是补的：`sampleTable` 那两个空都在对角线上（row === col），
  //    所以「行列写反」在那些断言下**看不出来** —— 变异检验抓到了这个洞。
  const table = tableOf(2, 3, [[0, 2], [1, 0]]);
  assert.deepEqual(cellAtSlot(table, 0), { row: 0, col: 2 });
  assert.deepEqual(cellAtSlot(table, 1), { row: 1, col: 0 });
});

test('🔴 blankLabelAt：**行列不能互换**（同一条洞的另一半）', () => {
  const table = tableOf(2, 3, [[0, 2], [1, 0]]);
  assert.equal(blankLabelAt(nodeOf(0, table), 0), '第 1 行第 3 格');
  assert.equal(blankLabelAt(nodeOf(0, table), 1), '第 2 行第 1 格');
});

test('🔴 blankLabelAt：题干里的空说「第 N 空」，表格里的空说「第 R 行第 C 格」', () => {
  // 只有题干空
  assert.equal(blankLabelAt(nodeOf(2), 0), '第 1 空');
  assert.equal(blankLabelAt(nodeOf(2), 1), '第 2 空');
  assert.equal(blankLabelAt(nodeOf(2), 2), null);
  // 只有表格空。⚠️ sampleTable 的两个空在 0 起的 (1,1) 与 (2,2) ⇒ 标签是「第 2 行第 2 格」
  //    与「第 3 行第 3 格」（1 起）。**别把 0 起的列号当成标签**。
  assert.equal(blankLabelAt(nodeOf(0, sampleTable()), 0), '第 2 行第 2 格');
  assert.equal(blankLabelAt(nodeOf(0, sampleTable()), 1), '第 3 行第 3 格');
  // 两种并存：题干那两个是「第 1/2 空」，表格那两个接着排
  const both = nodeOf(2, sampleTable());
  assert.equal(blankLabelAt(both, 0), '第 1 空');
  assert.equal(blankLabelAt(both, 1), '第 2 空');
  assert.equal(blankLabelAt(both, 2), '第 2 行第 2 格');
  assert.equal(blankLabelAt(both, 3), '第 3 行第 3 格');
  assert.equal(blankLabelAt(both, 4), null, '越界 ⇒ null（调用方跳过它，不写出半句话）');
});


test('🔴 parseTablePaste：行长短不一 ⇒ 补齐成方正网格（表格的 v1 不变式）', () => {
  const parsed = parseTablePaste('甲\t乙\t丙\n丁');
  assert.deepEqual(parsed?.rows, [['甲', '乙', '丙'], ['丁', '', '']]);
});

test('🔴 tableBlankIds：行优先的身份表（`fillBlankSettings` 的键就是它）', () => {
  assert.deepEqual(tableBlankIds(sampleTable()), ['b1', 'b2']);
  assert.deepEqual(tableBlankIds(tableOf(2, 3, [[0, 2], [1, 0]])), ['tb_0_2', 'tb_1_0']);
  assert.deepEqual(tableBlankIds(tableOf(2, 2, [])), []);
  assert.deepEqual(tableBlankIds(undefined), []);
  assert.deepEqual(tableBlankIds({ rows: [[cell('甲'), { text: '乙', blank: true }]] }), [], '非字符串的标记不算空');
});
