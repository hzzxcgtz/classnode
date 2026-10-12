import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewAdvice, reviewDurationLabel, reviewSourceLabel } from './worksheet-review-display.ts';
test('分号串联的编号建议分行，正文和已有换行保持不变', () => {
  assert.equal(formatReviewAdvice('1. 补细节； 2. 写动作；3. 写心情'), '1. 补细节\n2. 写动作\n3. 写心情');
  assert.equal(formatReviewAdvice('长宽比为1.5；注意单位。\n另一点'), '长宽比为1.5；注意单位。\n另一点');
});
test('真实耗时显示秒或分钟，未记录时不估算', () => {
  assert.equal(reviewDurationLabel(2500), '3 秒');
  assert.equal(reviewDurationLabel(61000), '1 分 1 秒');
  assert.equal(reviewDurationLabel(null), null);
  assert.equal(reviewDurationLabel(-1), null);
});

test('评价来源仅区分教师主动评分与学生自主评分', () => {
  assert.equal(reviewSourceLabel('teacher'), '教师主动评分');
  assert.equal(reviewSourceLabel('student'), '学生自主评分');
});
