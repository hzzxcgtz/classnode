import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisAnswerText,
  analysisQuestionDetails,
  analysisReferenceAnswer,
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
