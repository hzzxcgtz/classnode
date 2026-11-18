import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionCanEarnReward } from './worksheet-questions.ts';

const collect = { evaluationVersion: 1, evaluationMode: 'collect', evaluationScored: false };
const scored = { evaluationVersion: 1, evaluationMode: 'ai', evaluationScored: true };

test('rating stars and unscored AI feedback do not imply worksheet rewards', () => {
  assert.equal(questionCanEarnReward({ type: 'rating', data: { ...scored } }), false);
  assert.equal(questionCanEarnReward({ type: 'single-choice', data: collect }), false);
  assert.equal(questionCanEarnReward({ type: 'short-answer', data: { ...scored, evaluationScored: false } }), false);
  assert.equal(questionCanEarnReward({ type: 'drawing', data: collect }), false);
});
test('scored tasks keep the reward badge visible even before earning any points', () => {
  assert.equal(questionCanEarnReward({ type: 'single-choice' }), true);
  assert.equal(questionCanEarnReward({ type: 'single-choice', autoGrade: false }), false);
  assert.equal(questionCanEarnReward({ type: 'short-answer', data: scored }), true);
  assert.equal(questionCanEarnReward({ type: 'drawing', data: { aiScoringEnabled: true } }), true);
  assert.equal(questionCanEarnReward({ type: 'short-answer' }), false);
});
test('per-blank scoring and mixed worksheets preserve real reward eligibility', () => {
  const unscored = { type: 'fill-blank', data: { fillBlankSettings: { 0: collect, 1: collect } } };
  const mixed = { type: 'fill-blank', data: { ...collect, fillBlankSettings: { 0: collect, 1: scored } } };
  assert.equal(questionCanEarnReward(unscored), false);
  assert.equal(questionCanEarnReward(mixed), true);
  assert.equal([{ type: 'rating' }, unscored].some(questionCanEarnReward), false);
  assert.equal([{ type: 'rating' }, mixed].some(questionCanEarnReward), true);
});
