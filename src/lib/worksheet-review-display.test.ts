import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewText, formatReviewAdvice, reviewDurationLabel, reviewSourceLabel } from './worksheet-review-display.ts';
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

test('评价编号逐条换行，兼容空格和中文编号分隔符', () => {
  assert.equal(formatReviewText('1. 外形清楚；2. 动词准确；3. 比喻生动'), '1. 外形清楚\n2. 动词准确\n3. 比喻生动');
  assert.equal(formatReviewText('1. 外形清楚 2. 动词准确 3. 比喻生动'), '1. 外形清楚\n2. 动词准确\n3. 比喻生动');
  assert.equal(formatReviewText('1、补动作；2、补心情'), '1、补动作\n2、补心情');
  assert.equal(formatReviewText('1）补动作；2）补心情'), '1）补动作\n2）补心情');
  assert.equal(formatReviewText('1. 对比 第①项；2. 补充 第②项'), '1. 对比 第①项\n2. 补充 第②项');
  assert.equal(formatReviewText('评价：1. 写得清楚；2. 内容具体'), '评价：\n1. 写得清楚\n2. 内容具体');
});
test('已有换行保持稳定，数字、小数和版本号不被误拆', () => {
  for (const text of ['1. 补细节\n2. 写动作\n3. 写心情','用 1.5 米，2.5 米说明。版本 2.1.3。','2026.10.23 记录','用 1．5 米，2．5 米说明。','需要补充两点；2.5 是计算结果','表达清楚，内容具体。']) assert.equal(formatReviewText(text),text);
  const once = formatReviewText('1. 长度为 2.5 米；2. 注意单位');
  assert.equal(once,'1. 长度为 2.5 米\n2. 注意单位');
  assert.equal(formatReviewText(once),once);
});

test('圈号、括号和中文编号可分行，句中的题号引用保持原样', () => {
  assert.equal(formatReviewText('作答：①写出外形；②写出动作；③比喻生动'), '作答：\n①写出外形\n②写出动作\n③比喻生动');
  assert.equal(formatReviewText('（1）补动作；（2）补心情'), '（1）补动作\n（2）补心情');
  assert.equal(formatReviewText('一、补动作；二、补心情'), '一、补动作\n二、补心情');
  assert.equal(formatReviewText('写故事时，第①项要选小事；第②项要写动作；第③项写心情'), '写故事时，第①项要选小事；第②项要写动作；第③项写心情');
  assert.equal(formatReviewText('他的第①项达标，第②项也符合要求。请补全第③项。'), '他的第①项达标，第②项也符合要求。请补全第③项。');
});

test('连续引用评分标准中的学生原话保留原段落及已有换行', () => {
  for (const text of [
    '的作答：①“调整风车”是具体小事；②“举着跑”是具体动作；③有心情。',
    '作答：①「小事」；②「动作」；③心情。',
    '作答：①“调整风车”是具体小事\n②“举着跑”是具体动作\n③有心情。',
    '第①项达标；第②项具体；第③项也符合要求。',
  ]) assert.equal(formatReviewText(text), text);
});
