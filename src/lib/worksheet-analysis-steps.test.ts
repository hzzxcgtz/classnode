import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorksheetAnalysisSteps } from './worksheet-analysis-steps.ts';
import type { WorksheetAnalysisPayload } from './types';

const payload = () => ({ aiScoring: { enabled: true }, studentAiReviewEnabled: false, canSend: { ok: true }, entries: [{ studentId: 'graded' }, { studentId: 'missing' }, { studentId: 'unreadable' }], perStudent: { scores: [{ studentId: 'graded', score: 0 }] }, unscorableIds: ['unreadable'] }) as unknown as WorksheetAnalysisPayload;

test('补评并分析按补评、刷新作答、只分析的顺序执行，零分也视为已评分', async () => {
  const calls: unknown[] = [];
  await runWorksheetAnalysisSteps(payload(), {}, async options => { calls.push(options); return 'ok'; }, async () => { calls.push('refresh'); return payload(); });
  assert.deepEqual(calls, [{ only: ['missing'] }, 'refresh', { analysisOnly: true }]);
});
test('仅补评不更新全班分析；重评发送全班且不保护已有成绩', async () => {
  for (const [input, expected] of [[{ incremental: true }, { only: ['missing'] }], [{ regrade: true }, { regrade: true }]] as const) {
    const calls: unknown[] = [];
    await runWorksheetAnalysisSteps(payload(), input, async options => { calls.push(options); return 'ok'; }, async () => { throw new Error('不应刷新'); });
    assert.deepEqual(calls, [expected]);
  }
});
test('自主评价模式或全班已有评分时只生成总结', async () => {
  for (const automatic of [true, false]) {
    const value = payload();
    value.studentAiReviewEnabled = automatic;
    if (!automatic) value.perStudent!.scores.push({ studentId: 'missing', score: 5, reason: '', advice: '' });
    const calls: unknown[] = [];
    await runWorksheetAnalysisSteps(value, {}, async options => { calls.push(options); return 'ok'; }, async () => { throw new Error('不应刷新'); });
    assert.deepEqual(calls, [{ analysisOnly: true }]);
  }
});
test('补评失败后不更新全班总结', async () => {
  let calls = 0;
  await assert.rejects(runWorksheetAnalysisSteps(payload(), {}, async () => { calls++; throw new Error('补评失败'); }, async () => { throw new Error('不应刷新'); }), /补评失败/);
  assert.equal(calls, 1);
});
