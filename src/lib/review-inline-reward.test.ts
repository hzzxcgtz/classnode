import test from 'node:test';
import assert from 'node:assert/strict';
import {inlineReviewReward} from './review-inline-reward.ts';
test('逐空奖励按原记录的单位映射图标，保留空号和评价',()=>{
  assert.deepEqual(inlineReviewReward('第 2 空（1 座奖杯）：表达清楚'),{prefix:'第 2 空',count:1,kind:'trophy',suffix:'：表达清楚',label:'1 座奖杯'});
  assert.equal(inlineReviewReward('第1空 (3 颗星星): 好')?.kind,'star');
  assert.equal(inlineReviewReward('第 1 空（0 座奖杯）：继续努力')?.count,0);
});
test('分数、未计分反馈和正文数字保留原文',()=>{
  for(const text of ['第 1 空（1 分）：完成','第 2 空：表达完整','我得到了（1 座奖杯）','第 1 空（1.5 座奖杯）：完成']) assert.equal(inlineReviewReward(text),null);
});
