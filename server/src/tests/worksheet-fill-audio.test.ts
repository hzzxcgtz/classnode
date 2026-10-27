import test from 'node:test';
import assert from 'node:assert/strict';
import { fillAudioSlots, findFillAudioValueError } from '../services/worksheet-fill-audio.js';
import { aiScoringConfigOf, answerGradeWithFillAudio, parseAiAnalysisResult } from '../services/analysis-scoring.js';
import { grade, DEFAULT_POINTS, stripAnswers, validateQuestion, type QuestionNode } from '../services/worksheet-questions.js';
import { selectAnalyzeEntries, entriesToAggregate, entriesFromAggregate, buildAnalysisPayload, DEFAULT_ANALYSIS_KNOBS } from '../services/analysis-payload.js';
import { individualReviewSettings } from '../services/individual-review.js';
const audio={format:'audio/v1',url:'/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.ogg',durationMs:2500};
const node:QuestionNode={id:'q',type:'fill-blank',prompt:'{填空域}{填空域}',inputMode:'keyboard',data:{promptRuns:[{start:0,end:5,blank:'a'},{start:5,end:10,blank:'b'}],answers:[['甲'],[]],fillBlankSettings:{a:{mode:'text',gradingMode:'auto',maxScore:2},b:{mode:'audio',gradingMode:'ai',maxScore:3,audioCriteria:'说清依据',audioReference:'要点'}},studentAiReviewEnabled:true},children:[]};
const value={format:'fill-multi/v1',texts:['甲',''],audios:{b:audio}};
test('voice fills validate, keep scores pending, then combine exact-match and AI once',()=>{
 assert.deepEqual(validateQuestion(node),[]);
 assert.equal(fillAudioSlots(node)[0].id,'b');
 assert.equal(findFillAudioValueError(node,value),null);
 assert.ok(findFillAudioValueError(node,{...value,audios:{a:audio}}));
 assert.ok(findFillAudioValueError(node,{...value,audios:{b:{...audio,url:'https://example.com/a.ogg'}}}));
 assert.equal(grade(node,value,DEFAULT_POINTS),null);
 assert.deepEqual(answerGradeWithFillAudio(node,value,2,3),{isCorrect:false,gradeState:'partial',score:4});
 assert.deepEqual(answerGradeWithFillAudio(node,value,3,3),{isCorrect:true,gradeState:'correct',score:5});
 assert.equal(individualReviewSettings(node).enabled,true);
 const student=stripAnswers({schemaVersion:1,nodes:[node]}).nodes[0];
 assert.equal(JSON.stringify(student).includes('说清依据'),false);
 assert.equal((student.data.fillBlankSettings as any).b.mode,'audio');
});
test('mixed payload preserves audio attachment IDs, blank labels and snapshot round trip',()=>{
 const participants=[{participantId:'p',name:'甲',labelNo:'1'}];
 const entries=selectAnalyzeEntries([{participantId:'p',questionId:'q',status:'submitted',value}],participants,'q',node);
 assert.deepEqual(entriesFromAggregate(entriesToAggregate(entries)),entries);
 const payload=buildAnalysisPayload({entries,participants,total:1,knobs:DEFAULT_ANALYSIS_KNOBS,question:{questionId:'q',heading:'任务',typeLabel:'填空题',prompt:node.prompt,aiScoring:aiScoringConfigOf(node)}});
 assert.deepEqual(payload.audioAnswers,[{url:audio.url,label:'甲#1 · 第 2 空'}]);
 assert.match(payload.text!,/第 1 空：甲/);
});
test('AI must return every audio blank; empty speech is not counted as zero',()=>{
 const config=aiScoringConfigOf(node);
 const parse=(parts:unknown[])=>parseAiAnalysisResult('评价\n<classnode-scores>'+JSON.stringify({scores:[{student:'甲#1',score:2,reason:'评价',advice:'建议',parts}]})+'</classnode-scores>',config,[{studentId:'p',anonLabel:'甲#1'}]);
 const result=parse([{index:1,score:2,reason:'依据不够完整',advice:'补充观察依据'}]);
 assert.ok(!('error' in result)); if(!('error' in result)) { assert.equal(result.perStudent?.scores[0].score,2); assert.match(result.perStudent!.scores[0].reason,/第 2 空/); }
 const empty=parse([{index:1,score:null,reason:'没有听到有效内容',advice:'请重新录音'}]);
 if(!('error' in empty)) assert.equal(empty.perStudent!.scores[0].score,null);
 const missing=parse([]); if(!('error' in missing)) assert.deepEqual(missing.missing,['p']);
 const overflow=parse([{index:1,score:4,reason:'评价',advice:'建议'}]); if(!('error' in overflow)) assert.deepEqual(overflow.missing,['p']);
});
