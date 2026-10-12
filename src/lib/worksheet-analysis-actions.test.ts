import test from 'node:test';
import assert from 'node:assert/strict';
import { worksheetAnalysisActions } from './worksheet-analysis-actions.ts';
import type { WorksheetAnalysisPayload } from './types';

function payload(automatic: boolean, scored = true) {
  return { studentAiReviewEnabled: automatic, aiScoring: { enabled: true }, narrative: '原总结', entries: [{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }], unscorableIds: ['c'], perStudent: { scores: scored ? [{ studentId: 'a', score: 5 }, { studentId: 'b', score: null }] : [] } } as unknown as WorksheetAnalysisPayload;
}
test('开启自动评价：主要操作只分析，未评分作品也不显示教师补评', () => {
  const actions = worksheetAnalysisActions(payload(true));
  assert.equal(actions.primaryLabel, '更新全班分析');
  assert.equal(actions.automatic, true);
  assert.equal(actions.ungradedCount, 0);
  assert.equal(actions.hasScores, true);
  assert.equal(actions.canRegrade, false);
});
test('关闭自动评价：由教师发起全班分析与缺失评分', () => {
  const value = payload(false, false);
  value.narrative = null;
  const actions = worksheetAnalysisActions(value);
  assert.equal(actions.primaryLabel, '补评并更新班级分析');
  assert.equal(actions.automatic, false);
  assert.equal(actions.ungradedCount, 2);
  assert.equal(actions.hasScores, false);
});
test('全部已评分时不显示补评，关闭AI评分时只有分析', () => {
  const value = payload(true);
  value.perStudent!.scores.push({ studentId: 'b', score: 0, reason: '', advice: '' });
  assert.equal(worksheetAnalysisActions(value).ungradedCount, 0);
  value.aiScoring.enabled = false;
  assert.equal(worksheetAnalysisActions(value).automatic, false);
  assert.equal(worksheetAnalysisActions(value).ungradedCount, 0);
});

test('关闭自主评价后恢复教师重评操作，已有评分继续保留', () => {
  const value = payload(true);
  assert.equal(worksheetAnalysisActions(value).canRegrade, false);
  value.studentAiReviewEnabled = false;
  assert.equal(worksheetAnalysisActions(value).canRegrade, true);
  assert.equal(value.perStudent!.scores[0].score, 5);
});


test('无需补评时改为更新班级分析，零分有效、无法识别的作品不触发补评', () => {
  const value = payload(false);
  value.perStudent!.scores.push({ studentId: 'b', score: 0, reason: '', advice: '' });
  const actions = worksheetAnalysisActions(value);
  assert.equal(actions.ungradedCount, 0);
  assert.equal(actions.primaryLabel, '更新班级分析');
  assert.equal(actions.canRegrade, true);
  assert.equal(actions.hint, '更新班级总结，保留已有评分。');
  value.perStudent!.scores.pop();
  assert.equal(worksheetAnalysisActions(value).primaryLabel, '补评并更新班级分析');
});
