import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingConfig, ratingDimensionRows, ratingLeafDimensions, ratingResultSummary, ratingCompactSummary, readRatingAnswer, ratingSubmissionError, ratingCommentLength } from './worksheet-rating.ts';
import { newQuestion } from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';
import { emptyDraftFor, isDraftEmpty, buildAnswerValue, draftFromValue } from './worksheet-answer-value.ts';
import { answerView } from './worksheet-answer-view.ts';
import { questionStats } from '../app/teacher/classroom/worksheet-question-stats.ts';
import type { StatsRow } from '../app/teacher/classroom/worksheet-question-stats.ts';

const node = () => {
  const q = newQuestion('rating');
  q.prompt = '请分享你的评价';
  q.data.rating = { maxStars: 3, dimensions: [{ id: 'a', text: '清晰程度' }, { id: 'b', text: '实用程度' }], commentEnabled: true, commentPrompt: '' };
  return q;
};
test('评价题默认三星、调查收集，未操作不构成作答', () => {
  const q = newQuestion('rating');
  assert.equal(ratingConfig(q.data).maxStars, 3);
  assert.equal(q.data.evaluationMode, 'collect');
  assert.equal(q.data.evaluationScored, false);
  const draft = emptyDraftFor(q);
  assert.equal(draft.kind, 'rating');
  assert.equal(isDraftEmpty(draft), true);
  assert.equal(buildAnswerValue(q, draft), null);
});
test('评星及文字经过保存回填后保持一致；支持部分维度与纯文字感想', () => {
  const q = node();
  for (const ratings of ([{ a: 2, b: 3 }, { a: 1 }, {}] as Array<Record<string, number>>)) {
    const draft = { kind: 'rating' as const, maxStars: 3, ratings, text: '说明清楚，可以增加一个实例。' };
    const value = buildAnswerValue(q, draft);
    assert.ok(value);
    assert.deepEqual(draftFromValue(q, value), draft);
    assert.match(JSON.stringify(answerView(q, value)), /说明清楚/);
  }
});
test('坏星级、未知维度和旧星级上限不会进入统计；关闭文字后不提交隐藏感想', () => {
  const q = node();
  assert.equal(readRatingAnswer(q.data, { format: 'rating/v1', maxStars: 3, ratings: { a: 4, b: 1.5, unknown: 2 }, text: '' }), null);
  assert.equal(readRatingAnswer(q.data, { format: 'rating/v1', maxStars: 5, ratings: { a: 3 }, text: '' }), null);
  q.data.rating = { ...ratingConfig(q.data), commentEnabled: false };
  assert.equal(readRatingAnswer(q.data, { format: 'rating/v1', maxStars: 3, ratings: {}, text: '隐藏的旧文字' }), null);
});
test('每个维度仅以实际已提交评价计算人数与平均星级', () => {
  const q = node();
  const row = (id: string, ratings: Record<string, number>, status = 'submitted') => ({ participantId: id, status, value: { format: 'rating/v1', maxStars: 3, ratings, text: '' } }) as StatsRow;
  const result = questionStats(q, [row('1', { a: 3, b: 1 }), row('2', { a: 1 }), row('3', { a: 3 }, 'draft')]);
  assert.equal(result.distribution?.kind, 'rating');
  if (result.distribution?.kind !== 'rating') return;
  assert.deepEqual(result.distribution.dimensions.map(d => [d.count, d.average]), [[2, 2], [1, 1]]);
});

test('文字感想开启后必填，草稿仍可保存；最少字数忽略空白并按字符计数', () => {
  const q = node();
  const value = { format: 'rating/v1', maxStars: 3, ratings: { a: 2, b: 3 }, text: '' };
  assert.ok(readRatingAnswer(q.data, value), '无文字时仍能保存评价草稿');
  assert.equal(ratingSubmissionError(q.data, value), '请填写文字感想');
  q.data.rating = { ...ratingConfig(q.data), minCommentLength: 5 };
  assert.match(ratingSubmissionError(q.data, { ...value, text: '清楚  好\n' }) || '', /目前 3 字/);
  assert.equal(ratingSubmissionError(q.data, { ...value, text: '讲解清楚易懂' }), null);
  assert.equal(ratingCommentLength('你 好\n🙂'), 3);
  q.data.rating = { ...ratingConfig(q.data), commentEnabled: false };
  assert.equal(ratingSubmissionError(q.data, value), null);
});

test('评价维度和文字提示格式随配置保存，保留纯文本并剔除HTML及非法样式', () => {
  const data = { rating: { maxStars: 3, dimensions: [{ id: 'a', text: '问题与目标', runs: [
    { start: 0, end: 2, bold: true, italic: true, underline: true, color: '#315c86', html: '<script>bad</script>', frame: 'label' },
    { start: 2, end: 5, color: 'url(javascript:bad)' },
  ] }], commentPrompt: '听课感想', commentPromptRuns: [{ start: 0, end: 4, emphasis: true, color: '#aa5247' }] } };
  const config = ratingConfig(JSON.parse(JSON.stringify(data)));
  assert.equal(config.dimensions[0].text, '问题与目标');
  assert.equal(config.dimensions[0].runs?.[0].bold, true);
  assert.equal(config.dimensions[0].runs?.[0].italic, true);
  assert.equal(config.dimensions[0].runs?.[0].underline, true);
  assert.equal(config.dimensions[0].runs?.[1].color, '#1e293b');
  assert.equal(config.commentPromptRuns?.[0].emphasis, true);
  assert.equal(JSON.stringify(config).includes('<script>'), false);
  assert.equal(JSON.stringify(config).includes('frame'), false);
});


test('三级维度按树排序，只保留末级评价；统计和摘要保留分组', () => {
  const q = node();
  q.data.rating = { maxStars: 3, commentEnabled: false, dimensions: [
    { id: 'a', text: '教学设计' }, { id: 'b', text: '目标设计', parentId: 'a' },
    { id: 'c', text: '符合学情', parentId: 'b' }, { id: 'd', text: '情境创设', parentId: 'a' },
    { id: 'e', text: '整体感受' },
  ] };
  const config = ratingConfig(q.data);
  assert.deepEqual(ratingDimensionRows(config).map(d => [d.id, d.depth, d.isLeaf]), [
    ['a', 0, false], ['b', 1, false], ['c', 2, true], ['d', 1, true], ['e', 0, true],
  ]);
  assert.deepEqual(ratingLeafDimensions(config).map(d => d.id), ['c', 'd', 'e']);
  const value = { format: 'rating/v1', maxStars: 3, ratings: { a: 3, b: 2, c: 1, d: 3, e: 2 }, text: '' };
  assert.deepEqual(readRatingAnswer(q.data, value)?.ratings, { c: 1, d: 3, e: 2 });
  assert.match(ratingResultSummary(q.data, value)!, /教学设计 \/ 目标设计 \/ 符合学情：1 \/ 3/);
  const stats = questionStats(q, [{ participantId: 's', status: 'submitted', value } as StatsRow]);
  assert.equal(stats.distribution?.kind, 'rating');
  if (stats.distribution?.kind === 'rating') assert.deepEqual(stats.distribution.dimensions.map(d => [d.isLeaf, d.count]), [[false, 0], [false, 0], [true, 1], [true, 1], [true, 1]]);
});

test('单维度兼容；断链、循环和超三级不造成丢失或递归', () => {
  const config = ratingConfig({ rating: { dimensions: [{ id: 'a', text: '整体感受' }] } });
  assert.equal(ratingLeafDimensions(config).length, 1);
  const invalid = ratingConfig({ rating: { dimensions: [
    { id: 'a', text: 'A', parentId: 'b' }, { id: 'b', text: 'B', parentId: 'a' },
    { id: 'c', text: 'C', parentId: 'missing' }, { id: 'd', text: 'D' },
    { id: 'e', text: 'E', parentId: 'd' }, { id: 'f', text: 'F', parentId: 'e' },
    { id: 'g', text: 'G', parentId: 'f' },
  ] } });
  const rows = ratingDimensionRows(invalid);
  assert.equal(rows.length, 7);
  assert.ok(rows.every(d => d.depth < 3));
});


test('监控卡片只展示简短结果，未评价项合并，重名末级保留路径以区分', () => {
  const q = node();
  q.data.rating = { maxStars: 3, dimensions: [
    { id: 'a', text: '教学设计' }, { id: 'b', parentId: 'a', text: '素养导向：观察提示' },
    { id: 'c', parentId: 'a', text: '学情契合：观察提示' },
  ] };
  const value = { format: 'rating/v1', maxStars: 3, ratings: {}, text: '课堂交流很有启发。' };
  assert.equal(ratingCompactSummary(q.data, value), '2 项未评价\n感想：课堂交流很有启发。');
  assert.equal(ratingCompactSummary(q.data, { ...value, ratings: { b: 2 } }), '素养导向 2/3\n1 项未评价\n感想：课堂交流很有启发。');
  const config = ratingConfig(q.data);
  q.data.rating = { ...config, dimensions: [...config.dimensions, { id: 'd', text: '课堂实施' }, { id: 'e', parentId: 'd', text: '素养导向' }] };
  assert.match(ratingCompactSummary(q.data, { ...value, ratings: { b: 2, e: 3 } })!, /教学设计 \/ 素养导向 2\/3 · 课堂实施 \/ 素养导向 3\/3/);
});


test('只有末级维度全部评价才可提交；纯文字、漏评、非法值和取消评分均不能提交', () => {
  const q = node();
  q.data.rating = { maxStars: 3, commentEnabled: false, dimensions: [
    { id: 'group', text: '分组' }, { id: 'a', text: '项目甲', parentId: 'group' }, { id: 'b', text: '项目乙', parentId: 'group' },
  ] };
  const value = { format: 'rating/v1', maxStars: 3, ratings: { a: 2, b: 3 }, text: '' };
  assert.equal(ratingSubmissionError(q.data, value), null, '分组不用评价');
  for (const ratings of [{}, { a: 2 }, { a: 2, b: 0 }, { a: 2, b: 4 }, { a: 2, b: 1.5 }]) {
    assert.match(ratingSubmissionError(q.data, { ...value, ratings, text: '只有感想也不能提交' })!, /还差/);
  }
  assert.ok(readRatingAnswer(q.data, { ...value, ratings: { a: 1 } }), '部分作答仍能保存草稿');
  assert.match(ratingSubmissionError(q.data, { ...value, maxStars: 5 })!, /还差 2 项/);
});
