import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiScoringConfigOf,
  parseAiAnalysisResult,
  readStoredAiScoring,
  readStudentAiReferenceScore,
} from '../services/analysis-scoring.js';
import type { QuestionNode } from '../services/worksheet-questions.js';

function node(data: Record<string, unknown>, type = 'short-answer'): QuestionNode {
  return { id: 'q1', type, prompt: '说明理由', inputMode: 'keyboard', data, children: [] } as QuestionNode;
}

test('AI 评分设置只对问答题和绘图题生效，并归一化满分', () => {
  assert.deepEqual(aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringMaxScore: 5, aiScoringCriteria: ' 要点 ' })), {
    enabled: true, maxScore: 5, unit: '分', criteria: '要点',
  });
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true }, 'single-choice')).enabled, false);
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringMaxScore: 0 })).maxScore, 10);
});

test('开启评分时拆出机器块、映射匿名代号并保留 Markdown 解读', () => {
  const result = parseAiAnalysisResult(
    '### 解读\n有两类思路。\n<classnode-scores>\n{"scores":[{"student":"User_001","score":4.5,"reason":"要点完整"},{"student":"User_002","score":null,"reason":"作品无法辨认"}]}\n</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '按要点评分' },
    [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }],
  );
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.narrative, '### 解读\n有两类思路。');
  assert.deepEqual(result.perStudent?.scores, [
    { studentId: 's1', score: 4.5, reason: '要点完整' },
    { studentId: 's2', score: null, reason: '作品无法辨认' },
  ]);
});

test('奖杯等图标奖励只能是整数，分数档仍可保留一位小数', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }];
  const raw = '解读<classnode-scores>{"scores":[{"student":"User_001","score":2.5,"reason":"达到一半要求"}]}</classnode-scores>';
  const trophy = parseAiAnalysisResult(raw, {
    enabled: true, maxScore: 5, unit: '座奖杯', criteria: '',
  }, entries);
  assert.ok(!('error' in trophy));
  if (!('error' in trophy)) assert.equal(trophy.perStudent?.scores[0]?.score, 3);

  const points = parseAiAnalysisResult(raw, {
    enabled: true, maxScore: 5, unit: '分', criteria: '',
  }, entries);
  assert.ok(!('error' in points));
  if (!('error' in points)) assert.equal(points.perStudent?.scores[0]?.score, 2.5);
});

test('开启评分时漏人或越界分数拒绝整次结果，避免保存半份评分', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }];
  const missing = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":3,"reason":"ok"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok('error' in missing);
  const overflow = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":8,"reason":"bad"},{"student":"User_002","score":3,"reason":"ok"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok('error' in overflow);
});

test('关闭评分或教师修改满分后，不显示上一次的旧评分', () => {
  const stored = { maxScore: 5, unit: '分', criteria: '', scores: [{ studentId: 's1', score: 4, reason: '符合要点' }] };
  assert.equal(readStoredAiScoring(stored, { enabled: false, maxScore: 5, unit: '分', criteria: '' }, ['s1']), null);
  assert.equal(readStoredAiScoring(stored, { enabled: true, maxScore: 10, unit: '分', criteria: '' }, ['s1']), null);
  assert.equal(readStoredAiScoring(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, ['s1']), null);
  assert.deepEqual(readStoredAiScoring(stored, { enabled: true, maxScore: 5, unit: '分', criteria: '' }, ['s1']), stored);
});

test('学生端只读取自己的 AI 评分和评语，不返回同班数据', () => {
  const stored = {
    maxScore: 5, unit: '座奖杯', criteria: '按要点评分',
    scores: [
      { studentId: 's1', score: 4, reason: '理由一' },
      { studentId: 's2', score: 2, reason: '理由二' },
    ],
  };
  assert.deepEqual(
    readStudentAiReferenceScore(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, 's2'),
    { score: 2, maxScore: 5, unit: '座奖杯', comment: '理由二' },
  );
  assert.equal(readStudentAiReferenceScore(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, 'missing'), null);
});

test('读取旧评分时也不会把半个奖杯送到教师端或学生端', () => {
  const stored = {
    maxScore: 5, unit: '座奖杯', criteria: '',
    scores: [{ studentId: 's1', score: 1.5, reason: '旧数据' }],
  };
  const config = { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' };
  assert.equal(readStoredAiScoring(stored, config, ['s1'])?.scores[0]?.score, 2);
  assert.equal(readStudentAiReferenceScore(stored, config, 's1')?.score, 2);
  assert.equal(readStudentAiReferenceScore(stored, config, 's1')?.comment, '旧数据');
});
