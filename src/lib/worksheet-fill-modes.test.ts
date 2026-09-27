import assert from 'node:assert/strict';
import test from 'node:test';

import { blankSlots, fillSettingsFor, sharedPoolChoices, splitChoiceText, writeFillSettings } from './worksheet-fill-modes.ts';
import type { WorksheetQuestionNode } from './types.ts';
import { DEFAULT_PROMPT_STYLE, type PromptRun } from './worksheet-prompt-marks.ts';

const runs: PromptRun[] = [
  { start: 0, end: 4, ...DEFAULT_PROMPT_STYLE, blank: 'blank-a' },
  { start: 4, end: 8, ...DEFAULT_PROMPT_STYLE, blank: 'blank-b' },
  { start: 8, end: 12, ...DEFAULT_PROMPT_STYLE, blank: 'blank-c' },
];

function node(data: Record<string, unknown>, type: WorksheetQuestionNode['type'] = 'fill-blank'): WorksheetQuestionNode {
  return { id: 'q1', type, prompt: '____________', inputMode: 'keyboard', data, children: [] };
}

test('每个填空域按稳定 blank id 读取自己的作答方式', () => {
  const settings = fillSettingsFor(node({ fillBlankSettings: {
    'blank-a': { mode: 'text', choices: [] },
    'blank-b': { mode: 'inline', choices: ['阳光', '灯光'] },
    'blank-c': { mode: 'pool', choices: [] },
  } }), runs);
  assert.deepEqual(settings.map(item => item.mode), ['text', 'inline', 'pool']);
  assert.deepEqual(settings[1].choices, ['阳光', '灯光']);
});

test('设置写回仍以 blank id 为键，题干中插空不会让后面的设置串位', () => {
  // ⚠️ 签名带 `node` 了（★ 2026-09-28）：表格里的空不在 `runs` 里，光看分段认不出它们。
  const written = writeFillSettings(node({}), runs, [
    { mode: 'pool', choices: [] },
    { mode: 'text', choices: [] },
    { mode: 'inline', choices: ['水', '油'] },
  ]);
  assert.equal(written['blank-a'].mode, 'pool');
  assert.equal(written['blank-c'].mode, 'inline');
});

test('旧选择填空继续读取原来的共用词池与右侧两词分组', () => {
  const legacy = node({ choices: ['甲', '乙', '丙', '丁', '戊', '己'], choiceLayout: 'inline-pairs' }, 'choice-blank');
  assert.deepEqual(fillSettingsFor(legacy, runs).map(item => item.choices), [['甲', '乙'], ['丙', '丁'], ['戊', '己']]);
  assert.deepEqual(sharedPoolChoices(node({ choices: [' 甲 ', '', '乙'] }, 'choice-blank')), ['甲', '乙']);
});

// ── 单行输入那一套（★ 2026-09-28，教师）────────────────────────────────
//
// 教师原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示使用
// 常见的符号分隔即可。」⇒ 输入框从 textarea 改成单行，于是解析要认常见的分隔符。
// 🔴 **只用在输入这一侧**：读库那一侧（`fillSettingsFor` / `sharedPoolChoices`）
//    仍然走 `splitChoiceLines`（数组就是数组、字符串按行分）——
//    让**读**也按逗号切，会把库里一个含逗号的词条悄悄切成两个，而那是数据变更。

test('🔴 splitChoiceText：顿号、逗号、分号、换行都是分隔符', () => {
  assert.deepEqual(splitChoiceText('唐、宋、元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐，宋，元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐,宋,元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐；宋;元'), ['唐', '宋', '元']);
  // 换行仍然认（教师从 Excel 一列复制过来的那一列）
  assert.deepEqual(splitChoiceText('唐\n宋\n元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐、宋\n元;明'), ['唐', '宋', '元', '明']);
});

test('🔴 splitChoiceText：连续分隔符与两侧空白都不产生空词条', () => {
  assert.deepEqual(splitChoiceText('  唐 、、 宋  '), ['唐', '宋']);
  assert.deepEqual(splitChoiceText('唐、、、'), ['唐']);
  assert.deepEqual(splitChoiceText('、、'), []);
  assert.deepEqual(splitChoiceText(''), []);
  assert.deepEqual(splitChoiceText('   '), []);
});

test('🔴 splitChoiceText：词里的空格**不切**（「New York」是一个词）', () => {
  assert.deepEqual(splitChoiceText('New York、Los Angeles'), ['New York', 'Los Angeles']);
});

test('🔴 splitChoiceText：数组原样交给 splitChoiceLines（读库那一侧的口径不变）', () => {
  assert.deepEqual(splitChoiceText([' 甲 ', '', '乙']), ['甲', '乙']);
  assert.deepEqual(splitChoiceText('甲、乙'), ['甲', '乙'], '字符串才按符号切');
  assert.deepEqual(splitChoiceText(null), []);
  assert.deepEqual(splitChoiceText(42), []);
});

// ── 单行输入的分隔符集合（★ 2026-09-28，教师两轮）──────────────────────
//
// 教师第二轮看到我「待选词按标点切、答案只按分号切」之后否了：
// 「我说的是**常见符号提示都能用**，不要光是分号、顿号、逗号……」
// ⇒ 两种输入共用同一套分隔符。下面那两条**原来断言的是相反的结论**
//（「顿号与逗号是答案的一部分，不许拆」）—— 那是被教师否掉的设计，
// 现在断言的是**当下的**行为，免得下一个人把它当成 bug 改回去。

test('🔴 splitChoiceText：常见符号都算分隔符（顿号 / 逗号 / 分号 / 斜杠 / 竖线 / 换行）', () => {
  assert.deepEqual(splitChoiceText('唐、宋、元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐，宋，元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐,宋,元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐；宋;元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐/宋/元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐|宋|元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐\n宋\n元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐、宋\n元;明'), ['唐', '宋', '元', '明']);
});

test('🔴 splitChoiceText：**答案**也走同一套**（教师裁定：常见符号都能用）', () => {
  // ⚠️ 代价：本身含标点的答案会被拆开 —— 「小明、小红」变成两个可接受答案
  //（学生答「小明」也算对）。教师知情并选了这个便利，所以**提示必须写出来**
  //（见 question-card 里「标准答案」那句块说明）。
  assert.deepEqual(splitChoiceText('唐；唐代'), ['唐', '唐代']);
  assert.deepEqual(splitChoiceText('唐、唐代'), ['唐', '唐代']);
  assert.deepEqual(splitChoiceText('小明、小红'), ['小明', '小红']);
});

test('🔴 splitChoiceText：连续分隔符与两侧空白都不产生空条目', () => {
  assert.deepEqual(splitChoiceText('  唐 、、 宋  '), ['唐', '宋']);
  assert.deepEqual(splitChoiceText('唐、、、'), ['唐']);
  assert.deepEqual(splitChoiceText('、、'), []);
  assert.deepEqual(splitChoiceText(''), []);
  assert.deepEqual(splitChoiceText('   '), []);
});

test('🔴 splitChoiceText：词里的空格**不切**（「New York」是一个词）', () => {
  assert.deepEqual(splitChoiceText('New York、Los Angeles'), ['New York', 'Los Angeles']);
});

test('🔴 splitChoiceText：数组原样交给 splitChoiceLines（读库那一侧的口径不变）', () => {
  assert.deepEqual(splitChoiceText([' 甲 ', '', '乙']), ['甲', '乙']);
  assert.deepEqual(splitChoiceText('甲、乙'), ['甲', '乙'], '字符串才按符号切');
  assert.deepEqual(splitChoiceText(null), []);
  assert.deepEqual(splitChoiceText(42), []);
});

// ── 空的清单：题干里的 + 表格里的（★ 2026-09-28，教师反馈）────────────────
//
// 教师原话：「表格填空……和原来已有的题干和每个空的作答方式都完全割裂了……
// 东跳跳西跳跳」。
// 🔴 具体的一条是：`fillSettingsFor` 只认题干里的空（它遍历 `promptRuns` 的分段），
//    于是**一道表格题在「每个空的作答方式」那一块显示「题干中还没有填空域」**
//    —— 而上面明明有一张表、里面标着空。两块互相打脸。
// ⇒ 空的清单要**两种都数**，顺序与答案编号同一条规则（题干在前、表格在后）。

/**
 * 2×3 的表，**第 2 行第 3 格**是空（身份 `tb1`）。
 *
 * 🔴 空**不能落在对角线上**：`cellLabel` 的两个参数写反时，「第 2 行第 2 格」这类
 * 标签一个字都不变 ⇒ 变异检验抓不到（我在 `worksheet-table.test.ts` 里刚栽过一次，
 * 这里又栽了一次 —— 夹具自己要先立得住）。
 */
function tableFixture() {
  return {
    headerRow: true,
    rows: [
      [{ text: '姓名', blank: '' }, { text: '年龄', blank: '' }, { text: '城市', blank: '' }],
      [{ text: '张三', blank: '' }, { text: '25', blank: '' }, { text: '', blank: 'tb1' }],
    ],
  };
}

test('🔴 blankSlots：题干里的空在前、表格里的空在后，各自说清自己在哪', () => {
  const slots = blankSlots(node({ table: tableFixture() }), runs);
  assert.deepEqual(slots.map(item => [item.kind, item.label]), [
    ['text', '第 1 空'], ['text', '第 2 空'], ['text', '第 3 空'],
    ['table', '第 2 行第 3 格'],
  ]);
  assert.deepEqual(slots.map(item => item.id), ['blank-a', 'blank-b', 'blank-c', 'tb1'], '身份就是 fillBlankSettings 的键');
});

test('🔴 blankSlots：没有表格 ⇒ 与原来逐字相同（老题的清单一个字不变）', () => {
  assert.deepEqual(blankSlots(node({}), runs).map(item => item.id), ['blank-a', 'blank-b', 'blank-c']);
});

test('🔴 fillSettingsFor：**表格里的空也在清单里**（表格题不再说「还没有填空域」）', () => {
  const settings = fillSettingsFor(node({ table: tableFixture() }), runs);
  assert.equal(settings.length, 4, '三个题干空 + 一个表格空');
  assert.deepEqual(settings.map(item => item.mode), ['text', 'text', 'text', 'text'], '表格空缺省就是手工填写');
});

test('🔴 fillSettingsFor：表格空**存过的设置照读**（手改过的库 / 以后给表格开选词）', () => {
  const settings = fillSettingsFor(node({
    table: tableFixture(),
    fillBlankSettings: { tb1: { mode: 'pool', choices: [] } },
  }), runs);
  assert.equal(settings[3].mode, 'pool', '键是格子的身份，不是下标');
});

test('🔴 writeFillSettings：表格空的设置也按格子身份写回去', () => {
  const written = writeFillSettings(node({ table: tableFixture() }), runs, [
    { mode: 'text', choices: [] },
    { mode: 'inline', choices: ['甲', '乙'] },
    { mode: 'text', choices: [] },
    { mode: 'text', choices: [] },
  ]);
  assert.equal(written['blank-b'].mode, 'inline');
  assert.equal(written['tb1'].mode, 'text', '第 4 份写给了格子 tb1');
  assert.equal(Object.keys(written).length, 4);
});

test('🔴 blankSlots：标记夹在中间时，清单的顺序 = 答案的顺序（标记前 → 表格 → 标记后）', () => {
  // 题干：`{填空域}{表格域}{填空域}` —— 标记把两个文本空分开了
  const runs: PromptRun[] = [
    { start: 0, end: 5, ...DEFAULT_PROMPT_STYLE, blank: 'ba' },
    { start: 10, end: 15, ...DEFAULT_PROMPT_STYLE, blank: 'bc' },
  ];
  const node = { id: 'q1', type: 'fill-blank', prompt: '{填空域}{表格域}{填空域}', inputMode: 'keyboard' as const, data: { promptRuns: runs, table: tableFixture() }, children: [] };
  const slots = blankSlots(node, runs);
  assert.deepEqual(slots.map(item => item.label), ['第 1 空', '第 2 行第 3 格', '第 3 空']);
  assert.deepEqual(slots.map(item => item.id), ['ba', 'tb1', 'bc']);
  assert.deepEqual(slots.map(item => item.kind), ['text', 'table', 'text']);
});
