import assert from 'node:assert/strict';
import test from 'node:test';

import { fillSettingsFor, sharedPoolChoices, splitAnswerText, splitChoiceText, writeFillSettings } from './worksheet-fill-modes.ts';
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
  const written = writeFillSettings(runs, [
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

// ── 标准答案那一栏的单行输入（★ 2026-09-28，教师第二轮）──────────────────
//
// 教师原话：「这里也改成单行了，而且可以使用哪些符号间隔，要提示一下。」
//
// 🔴 **答案与待选词的分隔符**不能是同一套**：待选词是「词」（内部不会有标点），
//    而答案是**短语** —— 「小明、小红」是一个答案，「先洗菜，再切菜」也是一个。
//    照待选词那套切，这两条会被**悄悄拆成两个可接受答案**，于是学生答「小明」
//    就得满分，而教师看不到任何异常（单行框里重新拼接后长得一模一样）。

test('🔴 splitAnswerText：分号（中英文）与换行是分隔符', () => {
  assert.deepEqual(splitAnswerText('唐；唐代'), ['唐', '唐代']);
  assert.deepEqual(splitAnswerText('唐;唐代'), ['唐', '唐代']);
  assert.deepEqual(splitAnswerText('唐\n唐代'), ['唐', '唐代']);
  assert.deepEqual(splitAnswerText('  唐 ； 唐代  '), ['唐', '唐代']);
  assert.deepEqual(splitAnswerText('唐；；唐代'), ['唐', '唐代']);
  assert.deepEqual(splitAnswerText('唐；'), ['唐']);
  assert.deepEqual(splitAnswerText('；'), []);
  assert.deepEqual(splitAnswerText(''), []);
});

test('🔴 splitAnswerText：顿号与逗号**是答案的一部分**，不许拆', () => {
  // 这两条是这个函数存在的全部理由 —— 它们要是被拆开，就是**静默的判分变化**：
  // 教师本想让学生答出完整的那一句，结果答出半句也算对。
  assert.deepEqual(splitAnswerText('小明、小红'), ['小明、小红']);
  assert.deepEqual(splitAnswerText('先洗菜，再切菜'), ['先洗菜，再切菜']);
  assert.deepEqual(splitAnswerText('小明、小红；先洗菜，再切菜'), ['小明、小红', '先洗菜，再切菜']);
});

test('🔴 splitAnswerText：数组原样交给 splitChoiceLines；坏输入 ⇒ 空表', () => {
  assert.deepEqual(splitAnswerText([' 甲 ', '', '乙']), ['甲', '乙']);
  assert.deepEqual(splitAnswerText(null), []);
  assert.deepEqual(splitAnswerText(42), []);
});
