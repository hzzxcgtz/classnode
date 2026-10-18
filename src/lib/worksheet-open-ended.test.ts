import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_TYPE_OPTIONS, supportsAiScoring } from './worksheet-questions.ts';
import { buildAnswerValue, draftFromValue, emptyDraftFor, isPhotoNode } from './worksheet-answer-value.ts';
import { normalizeLoadedContent, newQuestion } from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';
import { questionStats } from '../app/teacher/classroom/worksheet-question-stats.ts';
import type { WorksheetQuestionNode } from './types';

test('旧开放题类型保留作答格式兼容，不设答案、不参与AI评分', () => {
  const node = newQuestion('open-ended');
  assert.equal(QUESTION_TYPE_OPTIONS.find(option => option.value === node.type)?.graded, false);
  assert.equal(supportsAiScoring(node), false);
  assert.deepEqual(node.data, {});
  assert.deepEqual(emptyDraftFor(node), { kind: 'text', text: '' });
  const text = { kind: 'text' as const, text: '我想从不同的角度解释这个现象。' };
  const value = buildAnswerValue(node, text);
  assert.deepEqual(value, { format: 'text/v1', text: text.text });
  assert.deepEqual(draftFromValue(node, value), text);
  const photo: WorksheetQuestionNode = { ...node, inputMode: 'photo' };
  assert.equal(isPhotoNode(photo), true);
  const photoValue = buildAnswerValue(photo, { kind: 'photo', url: '/uploads/chat/chat-12345678.jpg' });
  assert.equal(photoValue?.format, 'photo/v1');
  assert.deepEqual(draftFromValue(photo, photoValue), { kind: 'photo', url: '/uploads/chat/chat-12345678.jpg' });
  const handwriting: WorksheetQuestionNode = { ...node, inputMode: 'handwriting' };
  const ink = { kind: 'ink' as const, box: { w: 600, h: 400 }, strokes: [{ color: '#000000', width: 0.01, points: [[0.1, 0.2]] as [number, number][] }] };
  assert.equal(buildAnswerValue(handwriting, ink)?.format, 'ink/v1');
});

test('客观题无答案模式只统计选择，不将旧分数和隐藏答案解释为对错', () => {
  const node: WorksheetQuestionNode = { ...newQuestion('single-choice'), autoGrade: false, prompt: '你更喜欢哪种方案？', data: { options: [{ key: 'A', text: '方案一' }, { key: 'B', text: '方案二' }], correctKeys: ['A'] } };
  const stats = questionStats(node, [{ participantId: 'p', participantName: '同学', status: 'submitted', gradeState: 'correct', isCorrect: true, value: { format: 'choice/v1', selected: ['B'] }, createdAt: null, savedAt: null, saveCount: null }]);
  assert.equal(stats.accuracy, null);
  assert.equal(stats.noVerdict, 1);
  assert.equal(stats.distribution?.kind, 'options');
  if (stats.distribution?.kind === 'options') assert.ok(stats.distribution.bars.every(bar => !bar.correct));
  assert.ok(stats.insights.every(insight => !insight.text.includes('不是正确答案') && !insight.text.includes('它就是正确答案')));
});


test('旧开放题读取为表达题，保留题目ID、作答方式、分析重点并关闭评分', () => {
  const old = { ...newQuestion('open-ended'), id: 'legacy', inputMode: 'photo' as const, data: { analysisFocus: '比较观点依据', aiScoringEnabled: true } };
  const migrated = normalizeLoadedContent({ schemaVersion: 1, nodes: [old] }).nodes[0];
  assert.equal(migrated.id, old.id);
  assert.equal(migrated.type, 'short-answer');
  assert.equal(migrated.inputMode, 'photo');
  assert.equal(migrated.data.analysisFocus, '比较观点依据');
  assert.equal(migrated.data.aiScoringEnabled, false);
});
