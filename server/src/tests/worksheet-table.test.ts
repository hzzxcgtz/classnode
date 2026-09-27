import assert from 'node:assert/strict';
import test from 'node:test';

import {
  questionTextFor,
  tableAsText,
  tableBlankCount,
  validateQuestion,
  type QuestionNode,
} from '../services/worksheet-questions.js';

/**
 * 表格填空在**服务端**的那两件事（★ 2026-09-28）。
 *
 * 🔴 判分**一个字都没改** —— 服务端只认 `data.answers[i]` 的位置，从不读题干
 *（`answerSlotCount` 的注释写着「不是题干里画了几个框」）。这里守的是另外两件：
 *
 * ① **空数与答案槽数必须一致**。不查的后果是**静默的**：教师标了 3 个空只填了 2 个答案
 *   ⇒ 判分器只数 2 个 ⇒ 学生第 3 格**永远不判分**，而屏幕上一切正常。
 *   ⚠️ 服务端要有**自己的一份** `tableBlankCount` —— 照本仓既有的双胞胎先例
 *   （`fillShape`（客户端）/ `hasNestedAnswers`（服务端）就是刻意各写一份）。
 *
 * ② **表格要能被 Word 导出与 AI 分析载荷看见**。那两条路今天只读 `prompt` 文本
 *   ⇒ 表格会凭空消失，而分析智能体看不到那道题在问的那张表。
 */

function cell(text: string, blank = '') {
  return { text, blank };
}

/** 一张 `rowCount × colCount` 的表，`blanks` 里那几格是空。 */
function tableOf(rowCount: number, colCount: number, blanks: Array<[number, number]> = []) {
  return {
    headerRow: true,
    rows: Array.from({ length: rowCount }, (_, row) => Array.from({ length: colCount }, (_, col) => ({
      text: `r${row}c${col}`,
      blank: blanks.some(([r, c]) => r === row && c === col) ? `tb_${row}_${col}` : '',
    }))),
  };
}

/** ⚠️ 题干里**必须带标记**：有表没标记是「学生看不到的内容」，服务端会响亮地拒。 */
function nodeOf(data: Record<string, unknown>, prompt = '看表{表格域}填空'): QuestionNode {
  return { id: 'q_t', type: 'fill-blank', prompt, inputMode: 'keyboard', data, children: [] };
}

// ── ① 数空 ────────────────────────────────────────────────────────────

test('🔴 tableBlankCount：只数带空标识的格子', () => {
  assert.equal(tableBlankCount(tableOf(2, 2, [])), 0);
  assert.equal(tableBlankCount(tableOf(2, 2, [[0, 0]])), 1);
  assert.equal(tableBlankCount(tableOf(3, 3, [[0, 0], [2, 1]])), 2);
});

test('🔴 tableBlankCount：没有表格 / 坏形状一律 0，不抛', () => {
  assert.equal(tableBlankCount(undefined), 0);
  assert.equal(tableBlankCount(null), 0);
  assert.equal(tableBlankCount('不是表'), 0);
  assert.equal(tableBlankCount({}), 0);
  assert.equal(tableBlankCount({ rows: '不是数组' }), 0);
  assert.equal(tableBlankCount({ rows: [null, 3, 'x'] }), 0);
  // 行里的坏元素跳过、好元素照数
  assert.equal(tableBlankCount({ rows: [[cell('甲'), null, cell('乙', 'b1')]] }), 1);
  // 空标识必须是非空**字符串**（`true` / 数字都不算 —— 与客户端的判据同一条）
  assert.equal(tableBlankCount({ rows: [[{ text: '甲', blank: true }, { text: '乙', blank: 3 }]] }), 0);
});

// ── ② 校验：空数与答案槽数必须一致（那道静默的窄口）──────────────────────

test('🔴 校验：表格的空数与答案槽数一致 ⇒ 通过', () => {
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2, [[0, 0], [1, 1]]), answers: [['甲'], ['乙']] }));
  assert.deepEqual(errors, []);
});

test('🔴 校验：教师标了 3 个空只填了 2 个答案 ⇒ **响亮地拒**（不许静默）', () => {
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2, [[0, 0], [0, 1], [1, 0]]), answers: [['甲'], ['乙']] }));
  assert.equal(errors.length, 1, `应当正好一条错：${JSON.stringify(errors)}`);
  assert.match(errors[0], /3/);
  assert.match(errors[0], /2/);
});

test('🔴 校验：答案比空多**不能拒** —— 服务端读不出题干里有几个空', () => {
  // 🔴 这是本次唯一一条「有意不查」的方向，理由要记住：
  //    服务端**从不读题干**（`answerSlotCount` 的注释：「不是题干里画了几个框」），
  //    所以「表格 1 个空 + 2 份答案」既可能是坏数据、也可能是**题干里还有一个空**。
  //    查它会把合法的「题干空 + 表格空」混合题一律拒掉（而那正是本设计允许的）。
  //    ⇒ 只查**一个方向**：表格的空比答案槽还多 —— 那种题无论题干里有没有空都一定是坏的。
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2, [[1, 1]]), answers: [['甲'], ['乙']] }));
  assert.deepEqual(errors, []);
});

test('🔴 校验：没有表格的填空题**一个字都不受影响**（老题回归）', () => {
  assert.deepEqual(validateQuestion(nodeOf({ answers: [['甲']] })), []);
});

test('🔴 校验：表格题一个空都没标 ⇒ 至少有一条错（这道题没法作答）', () => {
  // ⚠️ 措辞不在这里钉 —— 它走的是既有那两条分支（「至少要有一个空」/「至少要有一个可接受的答案」），
  //    钉死其中一个字面量只会让下一次改文案时多一条假红。
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2), answers: [] }));
  assert.ok(errors.length >= 1, `必须有错：${JSON.stringify(errors)}`);
});

// ── ③ 上限（与客户端同一组数）────────────────────────────────────────

test('🔴 校验：表格超过行/列上限 ⇒ 拒', () => {
  const wide = validateQuestion(nodeOf({ table: tableOf(1, 11, [[0, 0]]), answers: [['甲']] }));
  assert.equal(wide.length, 1, JSON.stringify(wide));
  const tall = validateQuestion(nodeOf({ table: tableOf(11, 1, [[0, 0]]), answers: [['甲']] }));
  assert.equal(tall.length, 1, JSON.stringify(tall));
});

test('🔴 校验：空数超过上限 ⇒ 拒（不静默截断）', () => {
  // 4×8 = 32 格，全标成空 ⇒ 32 > 30
  const all: Array<[number, number]> = [];
  for (let row = 0; row < 4; row += 1) for (let col = 0; col < 8; col += 1) all.push([row, col]);
  const table = tableOf(4, 8, all);
  assert.equal(tableBlankCount(table), 32, '夹具要先立得住');
  const errors = validateQuestion(nodeOf({ table, answers: all.map(() => ['甲']) }));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /30/);
});

// ── ④ 投影：让 Word 导出与 AI 分析载荷看得见表格 ──────────────────────

test('🔴 tableAsText：把表格拍成能读的纯文本（列用 ` | ` 分隔）', () => {
  const text = tableAsText(tableOf(2, 2, [[1, 1]]));
  assert.equal(text, 'r0c0 | r0c1\nr1c0 | r1c1');
});

test('🔴 tableAsText：一格里的换行与竖线不能把表格搞乱', () => {
  // 格子里的 `|` 会被读成列分隔符，换行会被读成换行 —— 两样都要**压平**
  const table = { headerRow: false, rows: [[cell('甲|乙'), cell('丙\n丁')]] };
  const text = tableAsText(table);
  assert.equal(text.split('\n').length, 1, '一个格子里的换行不许变成新的一行');
  assert.equal(text, '甲/乙 | 丙 丁');
});

test('🔴 tableAsText：没有表格 / 坏形状 ⇒ 空串（调用方据此决定要不要接这一段）', () => {
  assert.equal(tableAsText(undefined), '');
  assert.equal(tableAsText({ rows: [] }), '');
  assert.equal(tableAsText('不是表'), '');
  assert.equal(tableAsText({ rows: [[cell('  '), cell('')]] }), '', '全是空白 ⇒ 空串');
});

test('🔴 questionTextFor：表格在**标记的位置**就地展开（不再是追加在末尾）', () => {
  assert.equal(
    questionTextFor({ prompt: '请根据下表填写：{表格域}', data: { table: tableOf(2, 2) } }),
    '请根据下表填写：r0c0 | r0c1\nr1c0 | r1c1',
  );
  // 标记夹在中间 ⇒ 表格就插在中间，与学生在屏幕上看到的顺序一致
  assert.equal(
    questionTextFor({ prompt: '前{表格域}后', data: { table: tableOf(1, 1) } }),
    '前r0c0后',
  );
});

test('🔴 questionTextFor：**没有标记就不投影**（与渲染同一条判据：由文本决定）', () => {
  assert.equal(questionTextFor({ prompt: '一道老题', data: {} }), '一道老题');
  // 有表但没标记 ⇒ 学生看不到它，投影也不该凭空冒出来（校验会另外拒这道题）
  assert.equal(questionTextFor({ prompt: '没有标记', data: { table: tableOf(1, 1) } }), '没有标记');
});

test('🔴 questionTextFor：`{填空域}` 换成一条下划线（原来会原样进 Word 与 AI 载荷）', () => {
  // 🔴 这一条是**既有的**毛病，2026-09-28 一并修：`node.prompt` 里存的就是那五个字，
  //    而服务端没有任何地方替换它 ⇒ 教师导出的 Word 里写着「植物需要{填空域}才能生长」。
  assert.equal(questionTextFor({ prompt: '植物需要{填空域}才能生长', data: {} }), '植物需要＿＿＿＿才能生长');
  assert.equal(
    questionTextFor({ prompt: '看{填空域}和{表格域}', data: { table: tableOf(1, 1) } }),
    '看＿＿＿＿和r0c0',
  );
});

test('🔴 校验：题干里有**两处**标记 ⇒ 响亮地拒（一份题干只允许一张表）', () => {
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2, [[1, 1]]), answers: [['甲']] }, '{表格域}和{表格域}'));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /只能放一张/);
});

test('🔴 校验：**有表却没有标记** ⇒ 响亮地拒（学生看不到那张表）', () => {
  const errors = validateQuestion(nodeOf({ table: tableOf(2, 2, [[1, 1]]), answers: [['甲']] }, '没有标记的题干'));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /没有「\{表格域\}」标记/);
});
