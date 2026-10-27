import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillEditorKind, tableDescription, withTableDescription } from './worksheet-fill-layout.ts';
import { createTable, TABLE_MARK_TEXT, blankLayout } from './worksheet-table.ts';
import { readPromptRuns, insertBlank, BLANK_MARK_TEXT } from './worksheet-prompt-marks.ts';
import { newQuestion, normalizeLoadedContent } from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';

test('新建文字填空与表格填空使用独立布局，继续兼容原评分协议', () => {
  const text = newQuestion('fill-blank');
  const table = newQuestion('fill-blank', 'table');
  assert.equal(fillEditorKind(text), 'text');
  assert.equal(text.data.table, undefined);
  assert.equal(fillEditorKind(table), 'table');
  assert.equal(table.prompt, TABLE_MARK_TEXT);
  assert.equal(table.type, 'fill-blank');
  assert.equal(table.data.fillScoring, 'per-blank');
  assert.equal((table.data.table as {rows: unknown[]}).rows.length, 3);
  const saved = normalizeLoadedContent(JSON.parse(JSON.stringify({ nodes: [text, table] })));
  assert.equal(fillEditorKind(saved.nodes[1]), 'table');
});
test('旧纯表格自动独立显示，旧混合题保持混合编辑，不丢文字空', () => {
  const table = newQuestion('fill-blank');
  table.prompt = '记录人数' + TABLE_MARK_TEXT;
  table.data.table = createTable(2, 2);
  assert.equal(fillEditorKind(table), 'table');
  const inserted = insertBlank(readPromptRuns(undefined, table.prompt), table.prompt, 0, 0, BLANK_MARK_TEXT, 'legacy-text');
  const mixed = { ...table, prompt: inserted.text, data: { ...table.data, promptRuns: inserted.runs } };
  assert.equal(fillEditorKind(mixed), 'mixed');
  assert.equal(blankLayout(mixed).textCount, 1);
});
test('单独编辑表格描述，往返保留文字样式、表格位置和答案', () => {
  const node = newQuestion('fill-blank', 'table');
  node.prompt = '人数' + TABLE_MARK_TEXT;
  node.data.answers = [['12']];
  node.data.promptRuns = readPromptRuns(undefined, node.prompt).map(run => ({...run, bold:true}));
  const description = tableDescription(node);
  assert.equal(description.text, '人数');
  assert.equal(description.runs[0].bold, true);
  const full = withTableDescription(description.text + '统计', [...description.runs, ...readPromptRuns(undefined, '统计').map(run => ({...run, start:run.start+2,end:run.end+2}))]);
  assert.equal(full.text, '人数统计' + TABLE_MARK_TEXT);
  assert.equal(full.runs[0].bold, true);
  assert.deepEqual(node.data.answers, [['12']]);
  assert.equal(tableDescription({...node,prompt:full.text,data:{...node.data,promptRuns:full.runs}}).text,'人数统计');
});
