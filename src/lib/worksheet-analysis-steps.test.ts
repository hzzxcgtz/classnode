import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorksheetAnalysisSteps } from './worksheet-analysis-steps.ts';
import type { WorksheetAnalysisPayload } from './types';

const payload = () => ({ aiScoring: { enabled: true }, studentAiReviewEnabled: false, canSend: { ok: true }, entries: [{ studentId: 'graded' }, { studentId: 'missing' }, { studentId: 'unreadable' }], perStudent: { scores: [{ studentId: 'graded', score: 0 }] }, unscorableIds: ['unreadable'] }) as unknown as WorksheetAnalysisPayload;
const completedPayload = () => {
  const value = payload();
  value.perStudent!.scores.push({ studentId: 'missing', score: 3, reason: '评价', advice: '建议' });
  return value;
};

test('补评并分析按补评、刷新作答、只分析的顺序执行，零分也视为已评分', async () => {
  const calls: unknown[] = [];
  const progress: string[] = [];
  await runWorksheetAnalysisSteps(payload(), {}, async options => { calls.push(options); return 'ok'; }, async () => { calls.push('refresh'); return completedPayload(); }, message => progress.push(message));
  assert.deepEqual(calls, [{ only: ['missing'] }, 'refresh', { analysisOnly: true }]);
  assert.deepEqual(progress, ['正在补评未评学生（第 1/1 批），请稍等…', '正在核对补评结果，请稍等…', '补评已完成，正在生成班级分析，请稍等…']);
});
test('仅补评不更新全班分析；重评发送全班且不保护已有成绩', async () => {
  for (const [input, expected] of [[{ incremental: true }, { only: ['missing'] }], [{ regrade: true }, { regrade: true }]] as const) {
    const calls: unknown[] = [];
    await runWorksheetAnalysisSteps(payload(), input, async options => { calls.push(options); return 'ok'; }, async () => completedPayload());
    assert.deepEqual(calls, [expected]);
  }
});
test('AI 请求完成但评分未落库时，不报补评成功或继续生成班级总结', async () => {
  for (const input of [{ incremental: true }, {}]) {
    const calls: unknown[] = [];
    await assert.rejects(runWorksheetAnalysisSteps(payload(), input, async options => { calls.push(options); return 'ok'; }, async () => payload()), /仍有 1 位学生/);
    assert.deepEqual(calls, [{ only: ['missing'] }]);
  }
});
test('整班补评分批发送，每批最多8人，最后核对全部评分', async () => {
  const value = payload();
  value.entries = Array.from({ length: 17 }, (_, i) => ({ studentId: `student-${i}` })) as WorksheetAnalysisPayload['entries'];
  value.perStudent = null;
  const batches: string[][] = [];
  const progress: string[] = [];
  await runWorksheetAnalysisSteps(value, { incremental: true }, async options => {
    batches.push(options.only!);
    return 'ok';
  }, async () => ({ ...value, perStudent: { scores: value.entries.map(row => ({ studentId: row.studentId, score: 3 })) } }) as WorksheetAnalysisPayload, message => progress.push(message));
  assert.deepEqual(batches.map(batch => batch.length), [8, 8, 1]);
  assert.deepEqual(batches.flat(), value.entries.map(row => row.studentId));
  assert.deepEqual(progress.slice(0, 3), [1, 2, 3].map(batch => `正在补评未评学生（第 ${batch}/3 批），请稍等…`));
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
test('补评中停止时不再发送下一批或更新班级分析', async () => {
  const value = payload();
  value.entries = Array.from({ length: 17 }, (_, i) => ({ studentId: `student-${i}` })) as WorksheetAnalysisPayload['entries'];
  value.perStudent = null;
  let calls = 0;
  await assert.rejects(runWorksheetAnalysisSteps(value, {}, async () => { calls++; throw new Error('分析已停止'); }, async () => { assert.fail('停止后不再刷新并发起下一步'); }), /分析已停止/);
  assert.equal(calls, 1);
});

test('未开启 AI 评分的信息收集题只生成或更新分析，不提示补评完成', async () => {
  for (const narrative of ['', '已有班级分析']) {
    const value = payload();
    value.aiScoring.enabled = false;
    value.narrative = narrative;
    const calls: unknown[] = [];
    const progress: string[] = [];
    await runWorksheetAnalysisSteps(value, {}, async options => { calls.push(options); return 'ok'; }, async () => { assert.fail('未执行补评，不应核对评分'); }, message => progress.push(message));
    assert.deepEqual(calls, [{ analysisOnly: true }]);
    assert.deepEqual(progress, [`正在${narrative ? '更新' : '生成'}班级分析，请稍等…`]);
  }
});

test('明确选择只分析时，即使开启评分且存在未评学生，也不提示补评完成', async () => {
  const calls: unknown[] = [];
  const progress: string[] = [];
  await runWorksheetAnalysisSteps(payload(), { analysisOnly: true }, async options => { calls.push(options); return 'ok'; }, async () => { assert.fail('只分析不核对评分'); }, message => progress.push(message));
  assert.deepEqual(calls, [{ analysisOnly: true }]);
  assert.deepEqual(progress, ['正在生成班级分析，请稍等…']);
});
