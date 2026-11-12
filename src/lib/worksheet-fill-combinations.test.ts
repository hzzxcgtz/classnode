import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetQuestionNode } from './types.ts';
import { selectFillCombination, reconcileFillCombinations } from './worksheet-fill-combinations.ts';
import { BLANK_MARK_TEXT, recognizeBlanks, readPromptRuns, insertBlank, removePromptRange } from './worksheet-prompt-marks.ts';
import { fillPromptPatch } from './worksheet-fill-edit.ts';
import { answerView } from './worksheet-answer-view.ts';

function fixture(): WorksheetQuestionNode {
  const prompt = '题目 ' + Array(4).fill(BLANK_MARK_TEXT).join(' ');
  let index = 0;
  const promptRuns = recognizeBlanks(readPromptRuns(undefined, prompt), prompt, BLANK_MARK_TEXT, () => `b${index++}`);
  return { id:'q',type:'fill-blank',prompt,inputMode:'keyboard',children:[],data:{ promptRuns,
    answers:[['A'],['B'],['C'],['D']],
    fillBlankSettings: Object.fromEntries([0,1,2,3].map(i=>[`b${i}`,{mode:'pool',gradingMode:'auto',maxScore:1,choices:[]}])),
    fillAnswerCombinations:[{id:'swapped',answers:{b0:['B'],b1:['A'],b2:['D'],b3:['C']}}],
  } };
}

test('教师答案对照选择完整组合，与加权和整题评分保持一致', () => {
  const node=fixture();
  const base=node.data.answers as string[][];
  assert.equal(selectFillCombination(node,['B','A','D','C'],base).index,1);
  assert.equal(selectFillCombination(node,['A','B','D','C'],base).index,0);
  (node.data.fillBlankSettings as Record<string,{maxScore:number}>).b0.maxScore=8;
  assert.equal(selectFillCombination(node,['A','A','D','C'],base).index,0);
  node.data.fillWholeScore=1;
  assert.equal(selectFillCombination(node,['A','A','D','C'],base).index,1);
});

test('教师作答模型展示最匹配组合，未把各套答案独立混到每个空', () => {
  const node=fixture();
  const view=answerView(node,{format:'fill-multi/v1',texts:['B','A','D','C']});
  assert.equal(view.kind,'fill');
  if(view.kind==='fill') {
    assert.equal(view.combinationLabel,'按正确组合 2 对照');
    assert.deepEqual(view.blanks.map(blank=>blank.accepted),[['B'],['A'],['D'],['C']]);
  }
});

test('插空与删空：组合内容跟随稳定 ID，不会移到相邻空', () => {
  const node=fixture();
  const runs=readPromptRuns(node.data.promptRuns,node.prompt);
  const next=insertBlank(runs,node.prompt,0,0,BLANK_MARK_TEXT,'new');
  const patch=fillPromptPatch(node,runs,next.text,next.runs,node.data.answers as string[][]);
  const combinations=patch.fillAnswerCombinations as {answers:Record<string,string[]>}[];
  assert.deepEqual(combinations[0].answers,{new:[],b0:['B'],b1:['A'],b2:['D'],b3:['C']});
  const removed=removePromptRange(runs,node.prompt,3,3+BLANK_MARK_TEXT.length);
  const deleted=fillPromptPatch(node,runs,removed.text,removed.runs,node.data.answers as string[][]);
  assert.deepEqual((deleted.fillAnswerCombinations as {answers:Record<string,string[]>}[])[0].answers,{b1:['A'],b2:['D'],b3:['C']});
  assert.deepEqual(reconcileFillCombinations(node.data.fillAnswerCombinations,[]),{fillAnswerCombinations:undefined});
});
