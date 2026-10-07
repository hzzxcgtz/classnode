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

/*
  ★ 2026-10-07（教师：全班 40 人怎么一起交给智能体分析）—— 这里原来钉的是**全有或全无**：
    「漏一个人 / 有一个人分数越界 ⇒ **整次作废**」。
  🔴 那个口径在 40 人这个规模上要命：模型少写一行、或把 `User_013` 写成 `user_13`，
    教师等满约 3 分钟只等到「分析失败」，**一个学生的分都不落库**，也没有重试。
  ✅ 改成：**拿到几份存几份**，并把**缺的那几个**点名报出来（教师据此补跑）。
     ⚠️ 「一个人都不能少」那条纪律本身没变 —— 只是从「作废整次」变成「**那一行不算数**」：
        缺建议的那一行仍然不许单独存进去（学生那边不能只看到半张卡）。
*/
test('★ 漏人不再整次作废：拿到几份存几份，并点名报出缺谁', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }];
  const result = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":3,"reason":"ok","advice":"继续完善。"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok(!('error' in result), '漏了一个人就把全部丢掉 —— 那正是「等三分钟什么都没有」');
  if ('error' in result) return;
  assert.equal(result.perStudent?.scores.length, 1, '该存的那一份要存下来');
  assert.deepEqual(result.missing, ['s2'], '缺的那一个要点名（教师据此补跑）');
});

test('★ 越界分数只丢那一行，不牵连全班', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }];
  const result = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":8,"reason":"bad","advice":"修正。"},{"student":"User_002","score":3,"reason":"ok","advice":"继续。"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.deepEqual(result.perStudent?.scores.map((row) => row.studentId), ['s2'], '只丢越界那一行');
  assert.deepEqual(result.missing, ['s1']);
  assert.equal(result.perStudent?.scores[0].score, 3);
});

test('★ 一份有效分都没有 ⇒ 只写解读、不写分数（缺的人全列出来）', () => {
  const entries = [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }];
  const result = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' }, entries,
  );
  assert.ok(!('error' in result), '解读还在，就该让教师看到');
  if ('error' in result) return;
  assert.equal(result.perStudent, null, '一份都没有 ⇒ 不写分数（旧的那些由调用方合并保留）');
  assert.deepEqual(result.missing, ['s1', 's2']);
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

test('新分析缺少逐生详细建议时：**那一行不算数**（学生不能只看到半张卡），其余照存', () => {
  const result = parseAiAnalysisResult(
    '解读<classnode-scores>{"scores":[{"student":"User_001","score":4,"reason":"理解基本正确"},{"student":"User_002","score":3,"reason":"ok","advice":"继续。"}]}</classnode-scores>',
    { enabled: true, maxScore: 5, unit: '分', criteria: '' },
    [{ studentId: 's1', anonLabel: 'User_001' }, { studentId: 's2', anonLabel: 'User_002' }],
  );
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.deepEqual(result.perStudent?.scores.map((row) => row.studentId), ['s2'], '缺建议的那一行不许单独存（学生那边会只有半张卡）');
  assert.deepEqual(result.missing, ['s1'], '但它要出现在「缺谁」里 —— 教师补跑时才会带上他');
});

/*
  ★ 2026-10-07：**部分结果存得进、读不出** —— 写入那一侧改成「拿到几份存几份」之后，
  读取那一侧原来还要求 `scores.length === studentIds.length` ⇒ 部分结果被整份判为无效，
  面板上一片空白，而且**不报错**（比存不进去更难查）。
  ⇒ 这条钉住：逐行校验照旧，但**不要求一个都不能少**。
*/
test('★ 部分结果必须读得出来（读取那一侧不许再要求「一个都不能少」）', () => {
  const config = { enabled: true, maxScore: 5, unit: '分', criteria: '看结构' };
  const stored = {
    maxScore: 5, unit: '分', criteria: '看结构',
    scores: [{ studentId: 's1', score: 4, reason: '不错', advice: '继续。' }],
    missing: ['s2'],
  };
  const read = readStoredAiScoring(stored, config, ['s1', 's2']);
  assert.ok(read, '部分结果被整份判无效 —— 教师会在面板上看到一片空白（而库里其实有分）');
  assert.equal(read.scores.length, 1);
  assert.deepEqual(read.missing, ['s2'], '「还缺谁」要一起读出来，面板靠它提示');
  // 反面对照：越界分数仍然整份拒收（逐行校验没松）。
  assert.equal(readStoredAiScoring({ ...stored, scores: [{ studentId: 's1', score: 9, reason: 'x', advice: 'y' }] }, config, ['s1', 's2']), null);
});
