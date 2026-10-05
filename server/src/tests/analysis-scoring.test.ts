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

test('AI 评分对问答、绘图生效，填空题则受题目级自动评分总开关控制', () => {
  assert.deepEqual(aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringMaxScore: 5, aiScoringCriteria: ' 要点 ' })), {
    enabled: true, maxScore: 5, unit: '分', criteria: '要点',
  });
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true }, 'single-choice')).enabled, false);
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true }, 'fill-blank')).enabled, false,
    '普通填空仍开着本地自动判分时不能同时启用 AI 评分');
  assert.equal(aiScoringConfigOf({ ...node({ aiScoringEnabled: true }, 'fill-blank'), autoGrade: false }).enabled, false,
    '填空题关闭总开关后，旧的 AI 设置也不能继续评分');
  assert.equal(aiScoringConfigOf({ ...node({ aiScoringEnabled: true }, 'choice-blank'), autoGrade: false }).enabled, false,
    '选择填空仍是客观题，不进入 AI 评分');
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringMaxScore: 0 })).maxScore, 10);
});

test('混合填空只把标为 AI 的空计入 AI 满额，并保留空号', () => {
  const config = aiScoringConfigOf(node({
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 2 },
      b: { mode: 'pool', gradingMode: 'auto', maxScore: 1 },
      c: { mode: 'text', gradingMode: 'ai', maxScore: 5 },
    },
    answers: [['甲'], ['乙'], []],
  }, 'fill-blank'));
  assert.deepEqual(config, {
    enabled: true, maxScore: 5, unit: '分', criteria: '', parts: [{ index: 2, maxScore: 5 }],
  });
});

test('🔴 评分依据取「评分标准」（`rubricText`），旧字段只作回退', () => {
  // ★ 2026-10-05：教师把「评分标准」与「评分要求」合并成一个输入框 ⇒ 判据层跟着改读
  // `rubricText`（唯一读取点 `rubricTextOf`）。回退保的是老学习单：只填过「评分要求」的
  // 课堂，升级后发给模型的依据不能变成空。
  const merged = aiScoringConfigOf(node({ aiScoringEnabled: true, rubricText: ' 结论 2 分，理由 3 分 ' }));
  assert.equal(merged.criteria, '结论 2 分，理由 3 分', '去掉首尾空白');

  const both = aiScoringConfigOf(node({ aiScoringEnabled: true, rubricText: '新标准', aiScoringCriteria: '旧要求' }));
  assert.equal(both.criteria, '新标准', '两个都在时以评分标准为准');

  const legacyOnly = aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringCriteria: '旧要求' }));
  assert.equal(legacyOnly.criteria, '旧要求');

  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true })).criteria, '', '都没写 ⇒ 空（消息里由兜底那句承担）');
  // 存下来的这一份是给人看的，超长截断；发给模型的那一份是载荷里的原文（不截断）。
  assert.equal(aiScoringConfigOf(node({ aiScoringEnabled: true, rubricText: '甲'.repeat(1300) })).criteria.length, 1200);
});

test('开启评分时拆出机器块、映射匿名代号并保留 Markdown 解读', () => {
  const result = parseAiAnalysisResult(
    '### 解读\n有两类思路。\n<classnode-scores>\n{"scores":[{"student":"User_001","score":4.5,"reason":"要点完整","advice":"补充一个具体依据。"},{"student":"User_002","score":null,"reason":"作品暂时无法辨认","advice":"请拍清楚作品后再试一次。"}]}\n</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '按要点评分' },
    [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }],
  );
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.narrative, '### 解读\n有两类思路。');
  assert.deepEqual(result.perStudent?.scores, [
    { studentId: 's1', score: 4.5, reason: '要点完整', advice: '补充一个具体依据。' },
    { studentId: 's2', score: null, reason: '作品暂时无法辨认', advice: '请拍清楚作品后再试一次。' },
  ]);
});

test('奖杯等图标奖励只能是整数，分数档仍可保留一位小数', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }];
  const raw = '解读<classnode-scores>{"scores":[{"student":"User_001","score":2.5,"reason":"达到一半要求","advice":"再补充一个关键点。"}]}</classnode-scores>';
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
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":3,"reason":"ok","advice":"继续完善。"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok('error' in missing);
  const overflow = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":8,"reason":"bad","advice":"修正。"},{"student":"User_002","score":3,"reason":"ok","advice":"继续。"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok('error' in overflow);
});

test('关闭评分或教师修改满分后，不显示上一次的旧评分', () => {
  const stored = { maxScore: 5, unit: '分', criteria: '', scores: [{ studentId: 's1', score: 4, reason: '符合要点', advice: '补充依据。' }] };
  assert.equal(readStoredAiScoring(stored, { enabled: false, maxScore: 5, unit: '分', criteria: '' }, ['s1']), null);
  assert.equal(readStoredAiScoring(stored, { enabled: true, maxScore: 10, unit: '分', criteria: '' }, ['s1']), null);
  assert.equal(readStoredAiScoring(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, ['s1']), null);
  assert.deepEqual(readStoredAiScoring(stored, { enabled: true, maxScore: 5, unit: '分', criteria: '' }, ['s1']), stored);
});

test('学生端只读取自己的 AI 评分和评语，不返回同班数据', () => {
  const stored = {
    maxScore: 5, unit: '座奖杯', criteria: '按要点评分',
    scores: [
      { studentId: 's1', score: 4, reason: '理由一', advice: '建议一' },
      { studentId: 's2', score: 2, reason: '理由二', advice: '建议二' },
    ],
  };
  assert.deepEqual(
    readStudentAiReferenceScore(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, 's2'),
    { score: 2, maxScore: 5, unit: '座奖杯', comment: '理由二', advice: '建议二' },
  );
  assert.equal(readStudentAiReferenceScore(stored, { enabled: true, maxScore: 5, unit: '座奖杯', criteria: '' }, 'missing'), null);
});

test('证据不足无法给分时，学生仍能看到自己的评价与详细建议', () => {
  const stored = {
    maxScore: 5, unit: '分', criteria: '',
    scores: [{ studentId: 's1', score: null, reason: '照片中的文字暂时看不清', advice: '请重新拍摄清晰照片，确保答案完整入镜。' }],
  };
  assert.deepEqual(
    readStudentAiReferenceScore(stored, { enabled: true, maxScore: 5, unit: '分', criteria: '' }, 's1'),
    {
      score: null, maxScore: 5, unit: '分', comment: '照片中的文字暂时看不清',
      advice: '请重新拍摄清晰照片，确保答案完整入镜。',
    },
  );
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
  assert.equal(readStudentAiReferenceScore(stored, config, 's1')?.advice, '', '升级前结果没有详细建议时保持兼容');
});

test('新分析缺少逐生详细建议时拒绝写入，避免学生只看到半张反馈卡', () => {
  const result = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":4,"reason":"理解基本正确"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' },
    [{ studentId: 's1', anonLabel: 'User_001' }],
  );
  assert.ok('error' in result);
});
