import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluationRequirements, evaluationImages, aiEvaluationEnabled, evaluationMode } from './worksheet-evaluation.ts';
import { fillGradingTotals } from './worksheet-fill-modes.ts';
const image = '/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png';
test('统一要求合并历史标准、参考内容与分析重点，显式清空不回弹',()=>{
 const legacy={rubricText:'说清原因',analysisFocus:'暂不评错别字'};
 assert.equal(evaluationRequirements(legacy,[['示例内容']]),'说清原因\n\n参考内容：\n示例内容\n\n关注重点：\n暂不评错别字');
 assert.equal(evaluationRequirements({...legacy,evaluationText:''}), '');
 assert.equal(evaluationRequirements({audioCriteria:'观察变化',audioReference:'颜色改变'}),'观察变化\n\n参考内容：\n颜色改变');
});
test('文字和评价图片可并存；只接受本地受控图片，去重且显式空数组不恢复旧图片',()=>{
 assert.deepEqual(evaluationImages({evaluationText:'依据',evaluationImages:[image,image,'https://outside/test.jpg']}),[image]);
 assert.deepEqual(evaluationImages({rubricImageUrl:image}),[image]);
 assert.deepEqual(evaluationImages({rubricImageUrl:image,evaluationImages:[]}),[]);
});
test('文字与语音输入独立于 AI 评价；旧文字AI不被重新启用',()=>{
 const slot={mode:'text',evaluationVersion:1,evaluationMode:'ai',evaluationScored:false};
 assert.equal(aiEvaluationEnabled({type:'fill-blank',data:{fillBlankSettings:{a:slot}}}),true);
 assert.equal(aiEvaluationEnabled({type:'fill-blank',data:{fillBlankSettings:{a:{mode:'text',gradingMode:'ai'}}}}),false);
 assert.equal(aiEvaluationEnabled({type:'single-choice',autoGrade:false,data:{evaluationVersion:1,evaluationMode:'ai'}}),true);
 assert.equal(evaluationMode({},'collect'),'collect');
});
test('混合填空总分只汇总计分空，不把反馈空与收集空加入满分',()=>{
 assert.equal(fillGradingTotals([
 {mode:'text',choices:[],gradingMode:'auto',maxScore:2},
 {mode:'text',choices:[],gradingMode:'ai',evaluationVersion:1,evaluationMode:'ai',evaluationScored:true,maxScore:3},
 {mode:'audio',choices:[],gradingMode:'ai',evaluationVersion:1,evaluationMode:'ai',evaluationScored:false,maxScore:9},
 {mode:'text',choices:[],gradingMode:'none',evaluationVersion:1,evaluationMode:'collect',evaluationScored:false,maxScore:8}
 ]).total,5);
});
