import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisAnswerText,
  analysisQuestionDetails,
  analysisReferenceAnswer,
  analysisRubric,
  hasDrawingStarter,
  rubricTextOf,
} from '../services/analysis-question.js';
import type { QuestionNode, QuestionType } from '../services/worksheet-questions.js';

function node(type: QuestionType, data: Record<string, unknown>): QuestionNode {
  return { id: 'q1', type, prompt: '题干', inputMode: type === 'drawing' ? 'handwriting' : 'keyboard', data, children: [] };
}

test('选择族：选项、参考答案和学生选择都带完整语义，不只发 key', () => {
  const single = node('single-choice', {
    options: [{ key: 'A', text: '只看运动方向' }, { key: 'B', text: '先确定参照物' }],
    correctKeys: ['B'], explanation: '判断运动状态前要先确定参照物',
  });
  assert.match(analysisQuestionDetails(single), /A\. 只看运动方向/);
  assert.match(analysisReferenceAnswer(single), /B\. 先确定参照物/);
  assert.match(analysisReferenceAnswer(single), /参照物/);
  assert.equal(analysisAnswerText(single, { format: 'choice/v1', selected: ['A'] }), '选择：A. 只看运动方向');

  const judge = node('true-false', { correctKeys: ['F'] });
  assert.match(analysisQuestionDetails(judge), /T\. 正确/);
  assert.equal(analysisReferenceAnswer(judge), 'F. 错误');
  assert.equal(analysisAnswerText(judge, { format: 'choice/v1', selected: ['T'] }), '选择：T. 正确');
});

test('填空与选择填空：逐空保留答案，可接受答案与待选词也带出', () => {
  const fill = node('fill-blank', { answers: [['氧气', 'O₂'], ['阳光']] });
  assert.equal(analysisReferenceAnswer(fill), '第1空：氧气 / O₂；第2空：阳光');
  assert.equal(
    analysisAnswerText(fill, { format: 'fill-multi/v1', texts: ['空气', '阳光'] }),
    '第1空：空气；第2空：阳光',
  );
  const choiceBlank = node('choice-blank', { answers: [['氧气'], ['阳光']], choices: ['氧气', '阳光', '空气'] });
  assert.equal(analysisQuestionDetails(choiceBlank), '待选词：氧气、阳光、空气');
  assert.equal(analysisReferenceAnswer(choiceBlank), '第1空：氧气；第2空：阳光');
});

test('排序：内部 id 被翻译成条目文字', () => {
  const order = node('order', {
    items: [{ id: 'i1', text: '播种' }, { id: 'i2', text: '发芽' }, { id: 'i3', text: '开花' }],
    correctOrder: ['i1', 'i2', 'i3'],
  });
  assert.match(analysisQuestionDetails(order), /播种；发芽；开花/);
  assert.equal(analysisReferenceAnswer(order), '播种 → 发芽 → 开花');
  assert.equal(analysisAnswerText(order, { format: 'order/v1', order: ['i2', 'i1', 'i3'] }), '顺序：发芽 → 播种 → 开花');
});

test('连线：左右 id 被翻译成具体配对关系', () => {
  const match = node('match', {
    left: [{ id: 'l1', text: '水' }, { id: 'l2', text: '二氧化碳' }],
    right: [{ id: 'r1', text: 'H₂O' }, { id: 'r2', text: 'CO₂' }],
    pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
  });
  assert.match(analysisQuestionDetails(match), /左栏：水；二氧化碳/);
  assert.equal(analysisReferenceAnswer(match), '水 → H₂O；二氧化碳 → CO₂');
  assert.equal(analysisAnswerText(match, { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }] }), '水 → CO₂');
});

test('归类：按分类框组织条目，而不是把 assignment 原样发送', () => {
  const categorize = node('categorize', {
    items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '麻雀' }],
    zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
    placement: { i1: 'z1', i2: 'z2' },
  });
  assert.match(analysisQuestionDetails(categorize), /分类框：哺乳类；鸟类/);
  assert.equal(analysisReferenceAnswer(categorize), '哺乳类：猫；鸟类：麻雀');
  assert.equal(
    analysisAnswerText(categorize, { format: 'categorize/v1', assignment: { i1: 'z2', i2: 'z2' } }),
    '鸟类：猫、麻雀',
  );
});

test('问答与绘图：参考答案/要点可用，问答保留原文，绘图内容仍走联系表', () => {
  const short = node('short-answer', { answers: [['因为水蒸气遇冷液化', '水蒸气凝结成小水滴']] });
  assert.equal(analysisReferenceAnswer(short), '第1空：因为水蒸气遇冷液化 / 水蒸气凝结成小水滴');
  assert.equal(analysisAnswerText(short, { format: 'text/v1', text: '因为屋里太热了' }), '因为屋里太热了');

  const drawing = node('drawing', { answers: [['包含蒸发、凝结、降水，并用箭头表示过程']] });
  assert.match(analysisReferenceAnswer(drawing), /蒸发、凝结、降水/);
  assert.equal(analysisAnswerText(drawing, { format: 'ink/v1' }), null, '笔迹由联系表渲染，不转成假文字');
});

test('坏形状不抛：无法识别返回 null，已提交空答案保留为空串', () => {
  assert.equal(analysisAnswerText(node('single-choice', {}), null), null);
  assert.equal(analysisAnswerText(node('fill-blank', {}), { format: 'fill-multi/v1', texts: ['', ''] }), '');
  assert.equal(analysisAnswerText(node('categorize', {}), { assignment: [] }), null);
});

test('主观题评分标准进入分析；客观题与外部图片地址不会进入', () => {
  const imageUrl = '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png';
  assert.deepEqual(analysisRubric(node('short-answer', { rubricText: '理由完整 4 分', rubricImageUrl: imageUrl })), {
    text: '理由完整 4 分', imageUrl,
  });
  assert.deepEqual(analysisRubric(node('drawing', { rubricText: '构图完整', rubricImageUrl: 'https://example.com/x.png' })), {
    text: '构图完整', imageUrl: null,
  });
  assert.deepEqual(analysisRubric({ ...node('fill-blank', { rubricText: '语义合理即可', rubricImageUrl: imageUrl }), autoGrade: false }), {
    text: '语义合理即可', imageUrl,
  }, '关闭本地判分的普通填空按主观题携带评分标准');
  assert.deepEqual(analysisRubric(node('fill-blank', { rubricText: '不应发送' })), { text: '', imageUrl: null },
    '仍开启本地自动判分的填空不发送 AI 评分标准');
  assert.deepEqual(analysisRubric(node('single-choice', { rubricText: '不应发送' })), { text: '', imageUrl: null });
});

test('★ 填空题的整题评分标准只在「关掉本地自动评分」时才读（旧数据的兼容路）', () => {
  // ★ 2026-10-05（教师裁定 B）：编辑页不再给填空题提供「整题评分标准」入口
  // （标准已经细化到每一空，见 `fill-blanks-body.tsx`）。但**旧学习单里写过的还在**：
  // 这条 `fill-blank && autoGrade === false` 的路留着，它们照旧随分析发出去。
  // 🔴 删掉它 = 让老数据的评分标准**静默失效**（模型少收到一段教师写过的标准，没人会报）。
  const withRubric = { ...node('fill-blank', { rubricText: '错别字不扣分', answers: [['甲']] }), autoGrade: false };
  assert.equal(analysisRubric(withRubric).text, '错别字不扣分');
  // 自动评分的填空题不读整题标准（那一路没有 AI 评分，写了也不该发）。
  assert.equal(analysisRubric(node('fill-blank', { rubricText: '不应发送', answers: [['甲']] })).text, '');
});

test('🔴 评分标准与评分要求合并：`rubricText` 为准，旧字段 `aiScoringCriteria` 只作回退', () => {
  // ★ 2026-10-05（教师）：编辑器里两个输入框合并成一个，数据以 `rubricText` 为准。
  // 这条网守的是**不许在迁移里丢掉教师已经写下的东西**：只填过「评分要求」的老学习单
  // （`aiScoringCriteria`），读出来必须还是那一段文字 —— 否则它会在升级后静默消失。
  const both = node('short-answer', { rubricText: '新的标准', aiScoringCriteria: '旧的要求' });
  assert.equal(rubricTextOf(both), '新的标准', '两个都在时以评分标准为准');
  assert.equal(analysisRubric(both).text, '新的标准');

  const legacyOnly = node('short-answer', { aiScoringCriteria: '  旧的要求  ' });
  assert.equal(rubricTextOf(legacyOnly), '旧的要求', '旧字段要去首尾空白后照样读出来');
  assert.equal(analysisRubric(legacyOnly).text, '旧的要求');

  // 空白串不算「写过」—— 与 `textOf` 同一条口径（教师把输入框清空 = 没写标准）。
  assert.equal(rubricTextOf(node('short-answer', { rubricText: '   ', aiScoringCriteria: '旧的要求' })), '旧的要求');
  assert.equal(rubricTextOf(node('short-answer', {})), '');
  // 客观题没有评分标准这一说（`analysisRubric` 的第一道闸），但 `rubricTextOf` 是纯读值。
  assert.equal(rubricTextOf(node('single-choice', { aiScoringCriteria: '不该用' })), '不该用');
  assert.equal(analysisRubric(node('single-choice', { aiScoringCriteria: '不该用' })).text, '');
});

test('★ 绘图题的「初始图」判据：与前端 `readDrawingStarter` 同一把尺子', () => {
  // 为什么这条要在服务端也钉一遍：这个判据决定「发给 AI 的提示词要不要说『图里有教师的初始图』」。
  //   服务端**放宽**（认了前端不认的形状）⇒ 模型会去找一段不存在的底稿；
  //   服务端**收紧** ⇒ 该说的那句没说，模型把教师画的那半张算成学生的成果。
  // 两种都不报错，所以形状必须逐条对拍前端 `src/lib/worksheet-drawing-starter.ts` 的判据。
  const starter = { tool: 'flowchart', data: { nodes: [], edges: [] } };
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: starter })), true, '合法的 { tool, data } 就是有初始图');
  for (const tool of ['flowchart', 'mind-map', 'math', 'free']) {
    assert.equal(
      hasDrawingStarter(node('drawing', { drawingStarter: { tool, data: {} } })), true,
      `「${tool}」是认得出的画板工具（前端 DRAWING_TOOLS 那一档）`,
    );
  }
  // 认不出的形状一律当「没有初始图」—— 与前端回 null 的那些分支一一对应。
  assert.equal(hasDrawingStarter(node('drawing', {})), false, '没设过 ⇒ 没有初始图');
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: null })), false);
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: 'flowchart' })), false, '字符串不是那个形状');
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: [starter] })), false, '数组不是那个形状');
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: { tool: 'flowchart' } })), false, '缺 data ⇒ 前端也读不出来');
  assert.equal(hasDrawingStarter(node('drawing', { drawingStarter: { data: {} } })), false, '缺 tool ⇒ 前端也读不出来');
  assert.equal(
    hasDrawingStarter(node('drawing', { drawingStarter: { tool: 'nope', data: {} } })), false,
    '认不出的工具（手改过的数据、将来新增的工具）不算 —— 前端也不认它',
  );
});

test('🔴 「初始图」只在**绘图题**上考虑：别的题型挂着同名字段也不算', () => {
  // 为什么：`data` 是**原样透传**的（见 `normalizeNode`），所以复制/手改来的
  // `drawingStarter` 可以出现在任何题型上。若判据是「有 tool 有 data 就算」，
  // 提示词会对一道**根本没有图**的题说「图里有教师预先给出的初始图」——
  // 模型于是拿一段文字作答去找底稿，评价口径整个错位，而全程没有一处报错。
  const starter = { tool: 'flowchart', data: { nodes: [] } };
  for (const type of ['single-choice', 'short-answer', 'fill-blank', 'task'] as const) {
    assert.equal(hasDrawingStarter(node(type, { drawingStarter: starter })), false, `${type} 不是绘图题，不许认这个字段`);
  }
});
