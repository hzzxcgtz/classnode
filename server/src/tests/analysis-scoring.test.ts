import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiScoringConfigOf,
  answerGradeFromAiScore,
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

test('🔴 填空题**不再**进入 AI 评分 —— 逐空 AI 那一档整个删了（教师 2026-10-09 裁定）', () => {
  // ★ 决策原话：「填空题简化：所有空都不涉及 AI 评分；想让学生自由写就用**问答题**。
  //   删 `'ai'` 与 `'none'` 两档 ⇒ 一律『每空有答案键、都算分』。」
  // 🔴 老数据里那些 `gradingMode: 'ai'` 的空：**不再计分**（判分侧 `grade()` 本来就只认
  //    `'auto'`），这里的 `enabled` 也就永远是 false ⇒ 面板 / 学生端不再显示它们的旧 AI 分数，
  //    而教师要在编辑器里给这些空补答案键（编辑器逐空提示）。
  const config = aiScoringConfigOf(node({
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 2 },
      b: { mode: 'pool', gradingMode: 'auto', maxScore: 1 },
      c: { mode: 'text', gradingMode: 'ai', maxScore: 5 },
    },
    answers: [['甲'], ['乙'], []],
  }, 'fill-blank'));
  assert.equal(config.enabled, false, '填空题又回到 AI 评分那条路上了 —— 逐空 AI 档已经删掉');
  assert.equal(config.parts, undefined, '不许再产出逐空分数（`parts` 只留给**读**旧结果）');
  // 阳性对照：光看 `enabled: false` 不够 —— 一个恒返回 false 的实现也能让它绿。
  // 问答题那条路必须**照旧**能用（那正是「主观内容走问答题」这句话的落点）。
  const shortAnswer = aiScoringConfigOf(node({ aiScoringEnabled: true, aiScoringMaxScore: 8 }, 'short-answer'));
  assert.equal(shortAnswer.enabled, true, '问答题的 AI 评分被误伤了');
  assert.equal(shortAnswer.maxScore, 8);
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

/*
  ★ 2026-10-07（教师：联系表标签改用「姓名 + 学号」）——
  模型**可能只回姓名**（把 `#7` 丢掉）。丢掉就整班收不到分，而教师看到的只是一句
  「本次只拿到 0/N」—— 代价太大，所以认。
  🔴 但**只在姓名唯一时**认：不唯一时必须**响亮地失败**（那个人进 `missing`）——
     猜一个的后果正是这次换标签要修的那件事（分贴到别人头上）。
*/
const SCORE_CONFIG = { enabled: true, maxScore: 5, unit: '分', criteria: '' };
const scored = (student: string) =>
  `解读<classnode-scores>{"scores":[{"student":"${student}","score":4,"reason":"好","advice":"再补。"}]}</classnode-scores>`;

test('★ 标签原样匹配优先', () => {
  const result = parseAiAnalysisResult(scored('张伟#7'), SCORE_CONFIG, [
    { studentId: 's1', anonLabel: '张伟#7', name: '张伟' },
  ]);
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.perStudent?.scores[0].studentId, 's1');
  assert.deepEqual(result.missing, []);
});

test('★ 姓名在本轮名单里唯一时，只回姓名也认', () => {
  const result = parseAiAnalysisResult(scored('张伟'), SCORE_CONFIG, [
    { studentId: 's1', anonLabel: '张伟#7', name: '张伟' },
    { studentId: 's2', anonLabel: '李四#12', name: '李四' },
  ]);
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.perStudent?.scores[0].studentId, 's1', '只回姓名就整班收不到分，代价太大');
  assert.deepEqual(result.missing, ['s2']);
});

test('🔴 姓名不唯一 ⇒ **不许猜**，那个人进 missing', () => {
  const result = parseAiAnalysisResult(scored('张伟'), SCORE_CONFIG, [
    { studentId: 's1', anonLabel: '张伟#7', name: '张伟' },
    { studentId: 's2', anonLabel: '张伟#9', name: '张伟' },
  ]);
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.perStudent, null, '猜一个的后果是分贴到别人头上 —— 宁可没有');
  assert.deepEqual(result.missing, ['s1', 's2'], '两个人一起进 missing，教师看得见');
});

test('🔴 别名不与标签抢：某人真名恰好等于另一个人的标签 ⇒ 不认别名（名册有病，不在这里替它做主）', () => {
  const result = parseAiAnalysisResult(scored('张伟#7'), SCORE_CONFIG, [
    { studentId: 's1', anonLabel: '张伟#7', name: '张伟' },
    { studentId: 's2', anonLabel: '李四#12', name: '张伟#7' },
  ]);
  assert.ok(!('error' in result));
  if ('error' in result) return;
  assert.equal(result.perStudent?.scores.length, 1);
  assert.equal(result.perStudent?.scores[0].studentId, 's1', '标签优先 —— 别名不许把它顶掉');
});

/*
  ★ 2026-10-07（教师决定 2：「AI 分按比例换算到题目分值」，原话的例子是
  「AI 给 4/5、题目 10 分 ⇒ 记 8 分」）—— 这个函数的唯一职责就是那一次换算 + 三态。
*/
test('★ 按比例换算：4/5 × 10 分 ⇒ 8 分', () => {
  assert.deepEqual(
    answerGradeFromAiScore(4, 5, 10),
    { isCorrect: false, gradeState: 'partial', score: 8 },
  );
});

test('★ 满分 ⇒ correct；0 ⇒ incorrect（三态与本地判分同一口径）', () => {
  assert.deepEqual(answerGradeFromAiScore(5, 5, 10), { isCorrect: true, gradeState: 'correct', score: 10 });
  assert.deepEqual(answerGradeFromAiScore(0, 5, 10), { isCorrect: false, gradeState: 'incorrect', score: 0 });
});

test('🔴 折出来的分必须是**整数**：符号奖励画的是 repeat(amount)，8.4 会被截成 8', () => {
  assert.equal(answerGradeFromAiScore(3.7, 5, 10).score, 7);
  assert.equal(answerGradeFromAiScore(4.5, 5, 10).score, 9);
  assert.equal(answerGradeFromAiScore(1, 3, 10).score, 3, '10/3 不许变成 3.333…');
});

test('🔴 坏输入收在 0..full 里，不许出 NaN / Infinity', () => {
  assert.equal(answerGradeFromAiScore(9, 5, 10).score, 10, '越界封顶');
  assert.equal(answerGradeFromAiScore(-1, 5, 10).score, 0, '负数不许写进去（学生的累计会变负）');
  assert.equal(answerGradeFromAiScore(5, 0, 10).score, 0, 'aiMaxScore 为 0 不许出 NaN');
  assert.equal(answerGradeFromAiScore(Number.NaN, 5, 10).score, 0);
});

test('🔴 不往 {0, half, full} 上贴：教师给的例子本身就否掉了那一条', () => {
  const hit = answerGradeFromAiScore(4, 5, 10);
  assert.notEqual(hit.score, 0);
  assert.notEqual(hit.score, 10);
  assert.equal(hit.gradeState, 'partial', '8 分既不是全对也不是全错');
  // 而「半对档 = 5 分」的学习单里也照样记 8 —— 那是**本地判分器**给部分分用的档，
  // 教师明确要的是按比例换算（4/5 × 10）。
  assert.equal(answerGradeFromAiScore(2, 5, 10).score, 4, '按比例，不贴半对档');
});

test('★ 三态与 score 同生共死：correct ⇔ score === full、incorrect ⇔ score === 0', () => {
  for (const [ai, full] of [[5, 10], [0, 10], [4, 10], [0.4, 10], [1, 1]] as const) {
    const hit = answerGradeFromAiScore(ai, 5, full);
    assert.equal(hit.isCorrect, hit.gradeState === 'correct', `isCorrect 与 gradeState 必须同一口径（ai=${ai}）`);
    assert.equal(hit.gradeState === 'correct', hit.score >= full, `满分档对不上（ai=${ai}）`);
    assert.equal(hit.gradeState === 'incorrect', hit.score <= 0, `零分档对不上（ai=${ai}）`);
  }
});
