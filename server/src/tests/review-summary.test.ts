import test from 'node:test';import assert from 'node:assert/strict';
import {otherBlankContext,summaryRecord,summaryBasis,summaryBatches,reviewSummaryPrompt,type SummaryRecord} from '../services/review-summary.js';
const row:SummaryRecord={studentId:'p1',label:'张同学#1',reviewId:'r1',score:null,reason:'说出了变化',advice:'补充过程'};
test('summary retains legacy feedback, validates detailed evidence and never contains source media',()=>{
 const old=summaryRecord(row,undefined);assert.equal(old.evidence,undefined);
 const next=summaryRecord(row,{summary:'颜色由绿变黄',criteria:[{requirement:'描述变化',status:'met',evidence:'由绿变黄'}],limitations:[]});assert.equal(next.evidence?.version,1);
 const prompt=reviewSummaryPrompt('题目与要求',[old,next],3,['p2']);assert.match(prompt,/未纳入 1 人/);assert.match(prompt,/不直接查看原始作品/);assert.match(prompt,/缺少详细作答依据/);assert.ok(!prompt.includes('uploads/'));assert.match(prompt,/students.*\[\]/);
});
test('summary batches obey text budget and never omit or duplicate records',()=>{
 const records=Array.from({length:40},(_,i)=>({...row,studentId:String(i),label:`学生#${i}`,reason:'字'.repeat(1000)}));
 const batches=summaryBatches(records,3000);assert.ok(batches.length>1);assert.deepEqual(batches.flat(),records);assert.ok(batches.every(b=>JSON.stringify(b).length<=3100));
 assert.notEqual(summaryBasis(records,[]),summaryBasis(records,['new']));assert.notEqual(summaryBasis(records,[]),summaryBasis([{...row,advice:'已更新'}],[]));
});

test('mixed fill summary keeps objective and survey text but never audio paths',()=>{
 const context=otherBlankContext({texts:['跳绳','理由',''],audios:{x:{url:'/uploads/private.ogg'}}},[1],[2]);
 assert.deepEqual(context.map(r=>r.index),[0,2]);assert.equal(context[0].text,'跳绳');assert.match(context[1].text,/不推断/);assert.ok(!JSON.stringify(context).includes('/uploads/'));
});
