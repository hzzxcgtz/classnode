import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WorksheetQuestionNode} from './types.ts';
import {appendQuestionEvaluationImages, updateSharedFillEvaluation, needsWholeFillConversion, convertWholeFillSettings} from './worksheet-evaluation-edit.ts';
import {createHistory,contentReducer} from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';
import {readPromptRuns,recognizeBlanks,BLANK_MARK_TEXT} from './worksheet-prompt-marks.ts';
import {fillSettingsFor,writeFillSettings,fillGradingTotals} from './worksheet-fill-modes.ts';
const image='/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png';
function fixture():WorksheetQuestionNode {
 const prompt=BLANK_MARK_TEXT+'、'+BLANK_MARK_TEXT;const ids=['a','b'];const runs=recognizeBlanks(readPromptRuns(undefined,prompt),prompt,BLANK_MARK_TEXT,()=>ids.shift()!);
 return {id:'q',type:'fill-blank',prompt,inputMode:'keyboard',data:{fillScoring:'whole',promptRuns:runs,answers:[['甲'],['乙']]},children:[]};
}
test('旧整题填空修改作答方式不接管评分，必须明确转换后才写出逐空分值',()=>{
 const node=fixture();const runs=node.data.promptRuns as Parameters<typeof fillSettingsFor>[1];const settings=fillSettingsFor(node,runs);
 assert.equal(needsWholeFillConversion(node,settings),true);
 const changed=writeFillSettings(node,runs,settings.map((s,i)=>i===0?{...s,mode:'inline',choices:['甲','乙']}:s));
 assert.equal(needsWholeFillConversion({...node,data:{...node.data,fillBlankSettings:changed}},Object.values(changed)),true);
 assert.equal(Object.values(changed).some(s=>s.gradingMode!==undefined||s.maxScore!==undefined),false);
 const converted=convertWholeFillSettings(node,settings,3);assert.equal(fillGradingTotals(converted).total,6);assert.equal(needsWholeFillConversion(node,converted),false);
 assert.equal(fillGradingTotals(convertWholeFillSettings({...node,autoGrade:false},settings,3)).total,0,'仅收集旧题不因转换开始计分');
});
test('上传结束按稳定空ID合并当前状态，不覆盖上传期间修改的满分、文字或其他空',()=>{
 const base=fixture();const settings={a:{mode:'audio',choices:[],gradingMode:'ai',maxScore:3,evaluationVersion:1,evaluationMode:'ai',evaluationScored:true,evaluationText:'开始上传时的要求'},b:{mode:'text',choices:[],gradingMode:'auto',maxScore:2}};
 let state=createHistory({schemaVersion:1,nodes:[{...base,data:{...base.data,fillBlankSettings:settings}}]});
 const current={...settings,a:{...settings.a,maxScore:8,evaluationText:'上传期间更新的要求'},b:{...settings.b,maxScore:5}};
 state=contentReducer(state,{kind:'updateData',id:'q',patch:{fillBlankSettings:current}});
 state=contentReducer(state,{kind:'appendEvaluationImages',id:'q',blankId:'a',urls:[image]});
 const actual=state.present.nodes[0].data.fillBlankSettings as typeof current & {a:{evaluationImages:string[]}};
 assert.equal(actual.a.maxScore,8);assert.equal(actual.a.evaluationText,'上传期间更新的要求');assert.equal(actual.b.maxScore,5);assert.deepEqual(actual.a.evaluationImages,[image]);
 const undone=contentReducer(state,{kind:'undo'});assert.deepEqual(undone.present.nodes[0].data.fillBlankSettings,current,'撤销只移除本次图片，不撤销期间编辑');
});
test('上传期间空被删除，不恢复空或答案；题目级上传也只合并图片',()=>{
 const node=fixture();assert.equal(appendQuestionEvaluationImages(node,[image],'deleted'),node);
 const question={...node,type:'short-answer',data:{evaluationVersion:1,evaluationMode:'collect',evaluationScored:false,evaluationText:'新要求',aiScoringMaxScore:8}} as WorksheetQuestionNode;
 const next=appendQuestionEvaluationImages(question,[image]);assert.equal(next.data.aiScoringMaxScore,8);assert.equal(next.data.evaluationMode,'collect');assert.equal(next.data.evaluationText,'新要求');
});

test('表达空自动共用标准，新加入的表达空继承标准，分值与调查/练习空保持独立',()=>{
 const ai={mode:'text' as const,choices:[],evaluationVersion:1 as const,evaluationMode:'ai' as const,evaluationScored:true,maxScore:2,evaluationText:'原标准'};
 const rows=[ai,{...ai,maxScore:4,evaluationScored:false},{...ai,evaluationMode:'answer' as const},{...ai,evaluationMode:'collect' as const}];
 const changed=updateSharedFillEvaluation(rows,0,{evaluationText:'共同标准',evaluationImages:[image],maxScore:3});
 assert.equal(changed[1].evaluationText,'共同标准');assert.deepEqual(changed[1].evaluationImages,[image]);
 assert.equal(changed[1].maxScore,4);assert.equal(changed[1].evaluationScored,false);
 assert.equal(changed[2],rows[2]);assert.equal(changed[3],rows[3]);
 const joined=updateSharedFillEvaluation(changed,3,{evaluationMode:'ai',evaluationText:'',evaluationImages:[]});
 assert.equal(joined[3].evaluationText,'共同标准');assert.deepEqual(joined[3].evaluationImages,[image]);
 const removed=updateSharedFillEvaluation(joined,1,{evaluationImages:[]});
 assert.deepEqual(removed[0].evaluationImages,[]);assert.deepEqual(removed[3].evaluationImages,[]);
});
test('评价图片上传结束后同步给本题表达空，并保留不同分值',()=>{
 const node=fixture();
 const common={mode:'text',choices:[],evaluationVersion:1,evaluationMode:'ai',evaluationScored:true,evaluationText:'共同标准',gradingMode:'ai'};
 const next=appendQuestionEvaluationImages({...node,data:{...node.data,fillBlankSettings:{a:{...common,maxScore:2},b:{...common,maxScore:5}}}},[image],'a');
 const settings=next.data.fillBlankSettings as Record<string,{evaluationImages:string[];maxScore:number}>;
 assert.deepEqual(settings.a.evaluationImages,[image]);assert.deepEqual(settings.b.evaluationImages,[image]);
 assert.equal(settings.a.maxScore,2);assert.equal(settings.b.maxScore,5);
});
