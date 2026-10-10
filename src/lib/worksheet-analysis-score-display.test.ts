import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreParticipantMeta, sortAnalysisScores } from './worksheet-analysis-score-display.ts';
const entries = [{studentId:'b',anonLabel:'张辽#17'},{studentId:'a',anonLabel:'刘备#1'},{studentId:'c',anonLabel:'关羽#2'}];
test('评分按学号自然排序，但联系表格号与输入评分保持不变', () => {
  const scores = [{studentId:'b'},{studentId:'c'},{studentId:'a'}];
  assert.deepEqual(sortAnalysisScores(scores,entries).map(row=>row.studentId),['a','c','b']);
  assert.equal(scores[0].studentId,'b');
  assert.deepEqual(scoreParticipantMeta(entries,'b'),{cell:1,number:'17'});
});
test('没有学号的旧标签和未匹配参与者不会编造学号', () => {
  assert.deepEqual(scoreParticipantMeta([{studentId:'a',anonLabel:'User_001'}],'a'),{cell:1,number:null});
  assert.deepEqual(scoreParticipantMeta(entries,'unknown'),{cell:null,number:null});
});
