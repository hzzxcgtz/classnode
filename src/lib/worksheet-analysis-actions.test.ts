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
  assert.equal(actions.primaryLabel, '补评并生成班级分析');
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

test('补评中每批结果到达都只保留当前操作，最后一批完成也不提前切换按钮', () => {
  const value = payload(false, false);
  for (const stage of ['before', 'partial', 'complete']) {
    if (stage === 'partial') value.perStudent!.scores.push({ studentId: 'a', score: 3, reason: '', advice: '' });
    if (stage === 'complete') value.perStudent!.scores.push({ studentId: 'b', score: 0, reason: '', advice: '' });
    const actions = worksheetAnalysisActions(value, 'incremental');
    assert.equal(actions.showSupplement, true);
    assert.equal(actions.showAnalysis, false);
    assert.equal(actions.showRegrade, false);
  }
  const finished = worksheetAnalysisActions(value);
  assert.equal(finished.showSupplement, false);
  assert.equal(finished.showAnalysis, true);
  assert.equal(finished.primaryLabel, '更新班级分析');
  assert.equal(finished.showRegrade, true, '全部补评完成后保留独立重评入口');
});

test('补评并分析及重评过程中，不出现其它操作按钮', () => {
  for (const running of ['analysis', 'regrade'] as const) {
    const actions = worksheetAnalysisActions(payload(false), running);
    assert.equal(actions.showSupplement, false);
    assert.equal(actions.showAnalysis, running === 'analysis');
    assert.equal(actions.showRegrade, running === 'regrade');
  }
});

test('未生成或清除班级分析后显示生成，个人评分仍保留', () => {
  const value = payload(false);
  value.perStudent!.scores.push({ studentId: 'b', score: 0, reason: '', advice: '' });
  for (const narrative of [null, '', '   ']) {
    value.narrative = narrative;
    const actions = worksheetAnalysisActions(value);
    assert.equal(actions.primaryLabel, '生成班级分析');
    assert.equal(actions.regradeLabel, '重评并生成班级分析');
    assert.equal(actions.ungradedCount, 0);
    assert.equal(actions.hasScores, true);
  }
  value.narrative = '班级分析已生成';
  assert.equal(worksheetAnalysisActions(value).primaryLabel, '更新班级分析');
  assert.equal(worksheetAnalysisActions(value).regradeLabel, '重评并更新班级分析');
});

test('客观题不能清除直接打分；主观题可清除AI评分，包括已关闭评分开关后的旧结果', () => {
  const value = payload(false);
  value.canClearAiScores = false;
  assert.equal(worksheetAnalysisActions(value).canClearAiScores, false);
  value.aiScoring.enabled = false;
  assert.equal(worksheetAnalysisActions(value).canClearAiScores, false);
  value.canClearAiScores = true;
  assert.equal(worksheetAnalysisActions(value).canClearAiScores, true);
  assert.equal(worksheetAnalysisActions(value).showSupplement, false);
});
