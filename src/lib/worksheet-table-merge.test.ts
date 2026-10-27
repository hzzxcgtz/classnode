import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, setCellText, setCellBlank, mergeTableCells, splitTableCell, coveredTableCells, tableBlankIds, insertTableColumn, insertTableRow, removeTableRow, removeTableColumn, tableAxisBlocked, readTableFor } from './worksheet-table.ts';
import { fillPromptPatch } from './worksheet-fill-edit.ts';
import { newQuestion } from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';
import { readPromptRuns } from './worksheet-prompt-marks.ts';

test('横向和纵向合并、连续合并、拆分，矩形下标不变且文字保留', () => {
  const original=setCellText(setCellText(createTable(3,3),0,0,'甲'),0,1,'乙');
  const horizontal=mergeTableCells(original,0,0,'right');
  assert.equal(horizontal.error,undefined); assert.equal(horizontal.table.rows[0][0].colSpan,2);
  assert.equal(horizontal.table.rows[0][0].text,'甲\n乙'); assert.equal(original.rows[0][0].text,'甲');
  const block=mergeTableCells(horizontal.table,0,0,'down');
  assert.equal(block.error,undefined);assert.equal(block.table.rows[0][0].rowSpan,2);
  assert.deepEqual([...coveredTableCells(block.table)],['0:1','1:0','1:1']);
  const wider=mergeTableCells(block.table,0,0,'right');assert.equal(wider.table.rows[0][0].colSpan,3);
  const loaded=readTableFor({data:{table:JSON.parse(JSON.stringify(wider.table))}})!;
  assert.equal(loaded.rows[0][0].colSpan,3);
  const split=splitTableCell(loaded,0,0);assert.equal(coveredTableCells(split).size,0);assert.equal(split.rows[0][0].text,'甲\n乙');
});
test('合并保留唯一填空 ID，答案与逐空设置按 ID 重排，多个填空拒绝合并', () => {
  let table=createTable(2,3);
  table=setCellBlank(table,[],0,0,1,'first').table;
  table=setCellBlank(table,[],0,1,0,'second').table;
  const node=newQuestion('fill-blank','table');node.data={...node.data,table,answers:[['甲'],['乙']],fillBlankSettings:{first:{mode:'text',choices:[],maxScore:2},second:{mode:'text',choices:[],maxScore:3}}};
  const merged=mergeTableCells(table,0,0,'right');assert.equal(merged.error,undefined);assert.deepEqual(tableBlankIds(merged.table),['first','second']);
  const runs=readPromptRuns(undefined,node.prompt);const patch=fillPromptPatch(node,runs,node.prompt,runs,[['甲'],['乙']],undefined,merged.table);
  assert.deepEqual(patch.answers,[['甲'],['乙']]);assert.equal((patch.fillBlankSettings as Record<string,{maxScore:number}>).first.maxScore,2);
  assert.ok(mergeTableCells(merged.table,0,0,'down').error?.includes('多个填空'));
});
test('合并格交叉、越界、藏有内容的损坏跨度不会吞掉格子', () => {
  const first=mergeTableCells(createTable(3,3),0,1,'down').table;
  assert.ok(mergeTableCells(first,0,0,'right').error);
  assert.ok(mergeTableCells(first,2,2,'right').error);
  const raw=createTable(2,2);raw.rows[0][0].colSpan=999;
  assert.equal(coveredTableCells(raw).size,0);
  raw.rows[0][0].colSpan=2;raw.rows[0][1].text='保留内容';assert.equal(coveredTableCells(raw).size,0);
});
test('合并范围外可增删行列，穿过合并格的操作保持原表，拆分后恢复', () => {
  const merged=mergeTableCells(mergeTableCells(createTable(3,3),0,0,'right').table,0,0,'down').table;
  assert.equal(tableAxisBlocked(merged,'row',1,true),true);
  assert.deepEqual(insertTableRow(merged,[],0,1).table,merged);
  assert.deepEqual(insertTableColumn(merged,[],0,1).table,merged);
  assert.deepEqual(removeTableRow(merged,[],0,0).table,merged);
  assert.deepEqual(removeTableColumn(merged,[],0,0).table,merged);
  assert.equal(insertTableRow(merged,[],0,3).table.rows.length,4);
  assert.equal(insertTableColumn(merged,[],0,3).table.rows[0].length,4);
  assert.equal(removeTableRow(merged,[],0,2).table.rows.length,2);
  assert.equal(removeTableColumn(merged,[],0,2).table.rows[0].length,2);
  assert.equal(removeTableRow(splitTableCell(merged,0,0),[],0,0).table.rows.length,2);
});

test('纵向合并把下方填空移到左上角后，其他答案和分值仍跟随原 ID', () => {
  let table=createTable(2,3);
  for(const [r,c,id] of [[0,0,'a'],[0,2,'b'],[1,1,'c']] as const) table=setCellBlank(table,[],0,r,c,id).table;
  const node=newQuestion('fill-blank','table');node.data={...node.data,table,answers:[['甲'],['乙'],['丙']],fillBlankSettings:{a:{mode:'text',choices:[],maxScore:1},b:{mode:'text',choices:[],maxScore:2},c:{mode:'text',choices:[],maxScore:3}}};
  const merged=mergeTableCells(table,0,1,'down');assert.equal(merged.error,undefined);
  const runs=readPromptRuns(undefined,node.prompt);
  const patch=fillPromptPatch(node,runs,node.prompt,runs,[['甲'],['乙'],['丙']],undefined,merged.table);
  assert.deepEqual(tableBlankIds(merged.table),['a','c','b']);assert.deepEqual(patch.answers,[['甲'],['丙'],['乙']]);
  assert.equal((patch.fillBlankSettings as Record<string,{maxScore:number}>).c.maxScore,3);
});

test('对齐设置不改变内容、跨度、填空 ID 和答案，加载/合并/拆分后保留', async () => {
  const {setCellAlignment}=await import('./worksheet-table.ts');
  let table=setCellBlank(createTable(2,3),[],0,0,0,'answer').table;
  table=setCellText(table,0,0,'答案');
  const aligned=setCellAlignment(table,0,0,{align:'right',verticalAlign:'bottom'});
  assert.equal(table.rows[0][0].align,undefined);
  assert.deepEqual(aligned.rows[0][0],{text:'答案',blank:'answer',align:'right',verticalAlign:'bottom'});
  const merged=mergeTableCells(aligned,0,0,'right').table;
  assert.equal(merged.rows[0][0].align,'right');assert.equal(merged.rows[0][0].verticalAlign,'bottom');
  const loaded=readTableFor({data:{table:JSON.parse(JSON.stringify(merged))}})!;
  assert.equal(splitTableCell(loaded,0,0).rows[0][0].align,'right');
  assert.deepEqual(setCellAlignment(merged,0,1,{align:'center'}),merged,'不能对被覆盖的格子写入对齐');
  const node=newQuestion('fill-blank','table');node.data={...node.data,table:merged,answers:[['答案']]};
  const runs=readPromptRuns(undefined,node.prompt);assert.deepEqual(fillPromptPatch(node,runs,node.prompt,runs,[['答案']],undefined,loaded).answers,[['答案']]);
});
