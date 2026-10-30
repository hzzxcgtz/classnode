import test from 'node:test';
import assert from 'node:assert/strict';
import { worksheetAnalysisActions } from './worksheet-analysis-actions.ts';
import { missingReviewIds } from './worksheet-review-completion.ts';
import type { WorksheetAnalysisPayload } from './types';
const payload=()=>({aiScoring:{enabled:true,maxScore:3},entries:[{studentId:'a'},{studentId:'b'},{studentId:'c'}],unscorableIds:['c'],perStudent:{scores:[{studentId:'a',score:0,reason:'评价',advice:'建议'}]}}) as WorksheetAnalysisPayload;
test('自动评价和旧关闭设置均只提供分析与缺失补评，取消全班重评',()=>{
 for(const flag of [true,false]){const p=payload();p.studentAiReviewEnabled=flag;const a=worksheetAnalysisActions(p);assert.equal(a.automatic,true);assert.equal(a.ungradedCount,1);assert.equal(a.showSupplement,true);assert.equal(a.canRegrade,false);assert.equal(a.showRegrade,false);assert.equal(a.primaryLabel,'生成全班分析');}
});
test('仅反馈的有效null分数算已评，排队中和不可识别的不重复补评',()=>{
 const p=payload();p.aiScoring.maxScore=0;p.perStudent!.scores[0].score=null;
 assert.deepEqual(missingReviewIds(p),['b']);p.pendingReviewIds=['b'];assert.deepEqual(missingReviewIds(p),[]);
 p.perStudent!.scores[0].reason='';assert.deepEqual(missingReviewIds(p),['a']);
});
test('操作中按钮不随每批结果切换，非AI题不提供补评',()=>{
 const p=payload();assert.equal(worksheetAnalysisActions(p,'incremental').showAnalysis,false);assert.equal(worksheetAnalysisActions(p,'incremental').showSupplement,true);p.aiScoring.enabled=false;assert.equal(worksheetAnalysisActions(p).showSupplement,false);
});
