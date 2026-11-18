import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedOpinions, OPINION_CLOUD_LIMIT } from './opinion-views.ts';
test('观点按人数排序，单人及十条之后的观点完整保留，重复人次不累计', () => {
 const phrases=Array.from({length:15},(_,i)=>({phrase:`观点${i}`,studentIds:['a']}));
 const all=rankedOpinions([...phrases,{phrase:'观点14',studentIds:['b','b','c']},{phrase:'观点0',studentIds:['a','a']}]);
 assert.equal(all.length,15);assert.equal(all[0].phrase,'观点14');assert.deepEqual(all[0].studentIds,['a','b','c']);
 assert.equal(all.slice(0,OPINION_CLOUD_LIMIT).length,10);assert.equal(all[1].studentIds.length,1);
 assert.equal(all[1].phrase,'观点0');
});
