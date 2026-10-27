import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetQuestionNode } from './types.ts';
import { BLANK_MARK_TEXT, blankRuns, insertBlank, readPromptRuns, recognizeBlanks, removePromptRange } from './worksheet-prompt-marks.ts';
import { TABLE_MARK_TEXT, createTable, setCellBlank, removeTableRow } from './worksheet-table.ts';
import { fillPromptPatch, atomicPromptDeletion } from './worksheet-fill-edit.ts';

function fixture() {
  const prompt = `甲${BLANK_MARK_TEXT}${TABLE_MARK_TEXT}乙${BLANK_MARK_TEXT}`;
  const ids = ['a', 'b'];
  const runs = recognizeBlanks(readPromptRuns(undefined, prompt), prompt, BLANK_MARK_TEXT, () => ids.shift()!);
  const table = setCellBlank(createTable(2, 2), [], 0, 1, 1, 't').table;
  const node = { id: 'q1', type: 'fill-blank', inputMode: 'keyboard', prompt, children: [], data: { promptRuns: runs, table, answers: [['甲空'], ['表空'], ['乙空']], fillBlankSettings: { a: { mode: 'text', choices: [], maxScore: 2, gradingMode: 'auto' }, t: { mode: 'inline', choices: ['一', '二'], maxScore: 3, gradingMode: 'auto' }, b: { mode: 'text', choices: [], maxScore: 4, gradingMode: 'auto' } } } } as WorksheetQuestionNode;
  return { node, runs, answers: node.data.answers as string[][], table };
}
test('在表格之前插空，表格答案与后方文字答案按 ID 保留', () => {
  const { node, runs, answers } = fixture();
  const next = insertBlank(runs, node.prompt, 0, 0, BLANK_MARK_TEXT, 'new');
  const patch = fillPromptPatch(node, runs, next.text, next.runs, answers);
  assert.deepEqual(patch.answers, [[], ['甲空'], ['表空'], ['乙空']]);
  assert.equal((patch.fillBlankSettings as Record<string, { maxScore: number }>).t.maxScore, 3);
});
test('选中文字变成横线，原文字成为该空参考答案', () => {
  const { node, runs, answers } = fixture();
  const next = insertBlank(runs, node.prompt, 0, 1, BLANK_MARK_TEXT, 'converted');
  const patch = fillPromptPatch(node, runs, next.text, next.runs, answers, { id: 'converted', answer: '甲' });
  assert.deepEqual(patch.answers, [['甲'], ['甲空'], ['表空'], ['乙空']]);
});
test('删除表前文字空，不丢失表格答案和后方文字空', () => {
  const { node, runs, answers } = fixture();
  const first = blankRuns(runs)[0];
  const next = removePromptRange(runs, node.prompt, first.start, first.end);
  assert.deepEqual(fillPromptPatch(node, runs, next.text, next.runs, answers).answers, [['表空'], ['乙空']]);
});
test('删除表格行，只移除被删格子的答案和设置', () => {
  const { node, runs, answers, table } = fixture();
  const next = removeTableRow(table, answers, 1, 1);
  const patch = fillPromptPatch(node, runs, node.prompt, runs, answers, undefined, next.table);
  assert.deepEqual(patch.answers, [['甲空'], ['乙空']]);
  assert.equal((patch.fillBlankSettings as Record<string, unknown>).t, undefined);
});
test('把有文字的表格格子设为填空，预填答案且不移动其他空的答案', () => {
  const { node, runs, answers, table } = fixture();
  const next = setCellBlank(table, answers, 1, 0, 0, 't2');
  const patch = fillPromptPatch(node, runs, node.prompt, runs, answers, { id: 't2', answer: '12' }, next.table);
  assert.deepEqual(patch.answers, [['甲空'], ['12'], ['表空'], ['乙空']]);
});
test('退格和 Delete 整块删除横线，普通文字、换行不误删', () => {
  const { node, runs } = fixture();
  const first = blankRuns(runs)[0];
  assert.deepEqual(atomicPromptDeletion(node.prompt, runs, first.end, first.end, 'backward'), { from: first.start, to: first.end });
  assert.deepEqual(atomicPromptDeletion(node.prompt, runs, first.start, first.start, 'forward'), { from: first.start, to: first.end });
  assert.equal(atomicPromptDeletion(node.prompt, runs, first.start, first.start, 'backward'), null);
  assert.equal(atomicPromptDeletion(node.prompt, runs, node.prompt.length, node.prompt.length, 'forward'), null);
});
test('选区覆盖部分标记时，删除范围扩展为完整填空和表格标记', () => {
  const { node, runs } = fixture();
  const first = blankRuns(runs)[0];
  const table = node.prompt.indexOf(TABLE_MARK_TEXT);
  assert.deepEqual(atomicPromptDeletion(node.prompt, runs, first.start + 1, table + 1, 'backward'), { from: first.start, to: table + TABLE_MARK_TEXT.length });
});

test('横线编辑经实际撤销栈、保存载荷和重新加载，ID、答案与评分仍对应', async () => {
  const { contentReducer, createHistory, buildPayload, normalizeLoadedContent, DEFAULT_SETTINGS } = await import('../app/teacher/worksheets/edit/worksheet-editor-core.ts');
  const { node, runs, answers } = fixture();
  const before = createHistory({ schemaVersion: 1, nodes: [node] });
  const next = insertBlank(runs, node.prompt, 0, 1, BLANK_MARK_TEXT, 'converted');
  const data = fillPromptPatch(node, runs, next.text, next.runs, answers, { id: 'converted', answer: '甲' });
  const changed = contentReducer(before, { kind: 'updatePrompt', id: node.id, prompt: next.text, data });
  assert.deepEqual(contentReducer(changed, { kind: 'undo' }).present, before.present);
  const redone = contentReducer(contentReducer(changed, { kind: 'undo' }), { kind: 'redo' });
  const payload = buildPayload('测试学习单', '', DEFAULT_SETTINGS, redone.present);
  const loaded = normalizeLoadedContent(JSON.parse(JSON.stringify(payload.content)));
  assert.deepEqual(loaded.nodes[0].data.answers, [['甲'], ['甲空'], ['表空'], ['乙空']]);
  assert.equal((loaded.nodes[0].data.fillBlankSettings as Record<string, {maxScore: number}>).t.maxScore, 3);
  assert.equal(blankRuns(loaded.nodes[0].data.promptRuns as ReturnType<typeof readPromptRuns>)[0].blank, 'converted');
});

test('移动文字填空跨过表格，答案和分值随 ID 重新排序', async () => {
  const { movePromptBlank } = await import('./worksheet-fill-edit.ts');
  const { node, runs, answers } = fixture();
  const moved = movePromptBlank(node.prompt, runs, 'a', node.prompt.length);
  assert.equal(blankRuns(moved.runs).filter(run => run.blank === 'a').length, 1);
  assert.equal(blankRuns(moved.runs)[1].blank, 'a');
  const patch = fillPromptPatch(node, runs, moved.text, moved.runs, answers);
  assert.deepEqual(patch.answers, [['表空'], ['乙空'], ['甲空']]);
  assert.equal((patch.fillBlankSettings as Record<string, {maxScore: number}>).a.maxScore, 2);
});
test('相同横线相邻换位也保留各自身份和答案', async () => {
  const { movePromptBlank, blankStepTarget } = await import('./worksheet-fill-edit.ts');
  const prompt = BLANK_MARK_TEXT.repeat(2); let i = 0;
  const runs = recognizeBlanks(readPromptRuns(undefined, prompt), prompt, BLANK_MARK_TEXT, () => ['left', 'right'][i++]);
  const node = { id:'adjacent',type:'fill-blank',inputMode:'keyboard',prompt,data:{promptRuns:runs},children:[] } as WorksheetQuestionNode;
  const moved = movePromptBlank(prompt, runs, 'left', blankStepTarget(prompt, runs, 'left', 1));
  assert.equal(moved.text, prompt);
  assert.deepEqual(blankRuns(moved.runs).map(run => run.blank), ['right', 'left']);
  assert.deepEqual(fillPromptPatch(node, runs, moved.text, moved.runs, [['左答案'], ['右答案']]).answers, [['右答案'], ['左答案']]);
});
test('拖放落点在其他空或表格标记中间时吸附边缘，不拆坏任何标记', async () => {
  const { movePromptBlank } = await import('./worksheet-fill-edit.ts');
  const { node, runs } = fixture();
  for (const at of [node.prompt.indexOf(TABLE_MARK_TEXT)+1, blankRuns(runs)[1].start+1]) {
    const moved = movePromptBlank(node.prompt, runs, 'a', at);
    assert.equal(moved.text.split(BLANK_MARK_TEXT).length-1, 2);
    assert.equal(moved.text.split(TABLE_MARK_TEXT).length-1, 1);
    assert.deepEqual(new Set(blankRuns(moved.runs).map(run=>run.blank)), new Set(['a','b']));
  }
});
test('取消拖动与落回原位置不生成修改，键盘移动不拆开 emoji', async () => {
  const { movePromptBlank, blankStepTarget } = await import('./worksheet-fill-edit.ts');
  const text = `😀${BLANK_MARK_TEXT}文`; let i = 0;
  const runs = recognizeBlanks(readPromptRuns(undefined,text),text,BLANK_MARK_TEXT,()=>`id${i++}`);
  assert.equal(movePromptBlank(text,runs,'id0',3).runs,runs);
  const moved=movePromptBlank(text,runs,'id0',blankStepTarget(text,runs,'id0',-1));
  assert.equal(moved.text,`${BLANK_MARK_TEXT}😀文`);
});

test('删除表格对象时一并清理表格及答案，避免隐藏表格阻止保存', () => {
  const {node,runs,answers}=fixture(); const at=node.prompt.indexOf(TABLE_MARK_TEXT);
  const removed=removePromptRange(runs,node.prompt,at,at+TABLE_MARK_TEXT.length);
  const patch=fillPromptPatch(node,runs,removed.text,removed.runs,answers);
  assert.ok(Object.prototype.hasOwnProperty.call(patch,'table'));
  assert.equal(patch.table,undefined);
  assert.deepEqual(patch.answers,[['甲空'],['乙空']]);
});

test('左右光标一次跨过完整填空、连续填空和表格标记，不停在隐藏标记内', async () => {
  const {promptCaretStep}=await import('./worksheet-fill-edit.ts');
  const text=`甲${BLANK_MARK_TEXT}${BLANK_MARK_TEXT}${TABLE_MARK_TEXT}😀乙`;
  let id=0;const runs=recognizeBlanks(readPromptRuns(undefined,text),text,BLANK_MARK_TEXT,()=>`b${id++}`);
  const positions=[0];let at=0;
  while(at<text.length){at=promptCaretStep(text,runs,at,1);positions.push(at);}
  assert.deepEqual(positions,[0,1,6,11,16,18,19]);
  const reversed=[at];while(at>0){at=promptCaretStep(text,runs,at,-1);reversed.push(at);}
  assert.deepEqual(reversed,[...positions].reverse());
  assert.equal(promptCaretStep(text,runs,3,1),6);assert.equal(promptCaretStep(text,runs,3,-1),1);
  assert.equal(promptCaretStep(text,runs,-20,-1),0);assert.equal(promptCaretStep(text,runs,Infinity,1),1);
});
