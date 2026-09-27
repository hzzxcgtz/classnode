import assert from 'node:assert/strict';
import test from 'node:test';

import { fillSettingsFor, sharedPoolChoices, writeFillSettings } from './worksheet-fill-modes.ts';
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
