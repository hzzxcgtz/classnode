import {mayKeepPriorAiGrade,removedEvaluationScore} from '../services/worksheet-evaluation-grades.js';
import {createTeacherSession} from '../middleware/auth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {PrismaClient, type Prisma} from '@prisma/client';
import systemRoutes from '../routes/system.js';
import {worksheetAccessGate, worksheetRoutes} from '../routes/worksheets.js';
import {createStudentToken} from '../middleware/student-auth.js';
import {prepareTemporarySqliteFile} from './helpers/temporary-sqlite.js';
import {resolveLocalPath} from '../services/ai-proxy.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiScoringConfigOf, parseAiAnalysisResult, answerGradeWithFillAudio } from '../services/analysis-scoring.js';
import { analysisRubric } from '../services/analysis-question.js';
import { grade, stripAnswers, type QuestionNode } from '../services/worksheet-questions.js';
import { individualReviewSettings } from '../services/individual-review.js';
const evaluation = {evaluationVersion:1,evaluationMode:'ai',evaluationScored:false,evaluationText:'说清观察与依据'};
const image='/uploads/chat/chat-123e4567-e89b-42d3-a456-426614174000.png';
const q=(data:Record<string,unknown>,type='short-answer'):QuestionNode=>({id:'q',type:type as QuestionNode['type'],prompt:'说说发现',inputMode:'keyboard',autoGrade:false,data,children:[]});
const entries=[{studentId:'s',anonLabel:'学生#1'}];
test('各题型AI反馈独立于计分，并保留个人评价开关',()=>{
 for(const type of ['single-choice','multi-choice','true-false','order','match','categorize','short-answer','drawing']){
  const node=q({...evaluation,studentAiReviewEnabled:true},type);
  const config=aiScoringConfigOf(node);
  assert.equal(config.enabled,true,type);assert.equal(config.maxScore,0,type);
  assert.equal(individualReviewSettings(node).enabled,true,type);
  assert.equal(grade(node,{format:'choice/v1',selected:['A']},{full:2,half:1}),null,type);
 }
});
test('反馈不计分返回null，保存评价和建议，不会成为0分',()=>{
 const parsed=parseAiAnalysisResult('<classnode-scores>{"scores":[{"student":"学生#1","score":null,"reason":"观察很具体","advice":"补充变化的依据"}]}</classnode-scores>',aiScoringConfigOf(q(evaluation)),entries,{allowScoreOnly:true});
 assert.ok(!('error' in parsed));assert.equal(parsed.perStudent?.scores[0].score,null);assert.equal(parsed.perStudent?.scores[0].advice,'补充变化的依据');
});
test('混合文字AI、语音反馈和本地核对，分数只累计一次',()=>{
 const node=q({answers:[['对'],[],[]],fillBlankSettings:{a:{mode:'text',gradingMode:'auto',maxScore:2},b:{...evaluation,evaluationScored:true,mode:'text',gradingMode:'ai',maxScore:3},c:{...evaluation,mode:'audio',gradingMode:'ai',maxScore:1}}},'fill-blank');
 const config=aiScoringConfigOf(node);assert.equal(config.maxScore,3);assert.deepEqual(config.parts,[{index:1,maxScore:3},{index:2,maxScore:0}]);
 const value={format:'fill-multi/v1',texts:['对','我的观察','']};
 assert.equal(grade(node,value,{full:1,half:0}),null,'AI计分尚未完成时整题待评');
 assert.equal(answerGradeWithFillAudio(node,value,2,3).score,4);
 const parsed=parseAiAnalysisResult('<classnode-scores>{"scores":[{"student":"学生#1","score":2,"reason":"逐空反馈","advice":"逐空建议","parts":[{"index":1,"score":2,"reason":"观察清楚","advice":"补充依据"},{"index":2,"score":null,"reason":"声音清楚","advice":"放慢语速"}]}]}</classnode-scores>',config,entries,{allowScoreOnly:true});
 assert.ok(!('error' in parsed));assert.equal(parsed.perStudent?.scores[0].score,2,'反馈空的null不阻断计分空');
});
test('评价依据同时投影文字与多张图片；学生版递归剥离依据但保留评价方式',()=>{
 const node=q({...evaluation,evaluationImages:[image]});const rubric=analysisRubric(node);
 assert.equal(rubric.text,'说清观察与依据');assert.deepEqual(rubric.imageUrls,[image]);
 const stripped=stripAnswers({schemaVersion:1,nodes:[node]}).nodes[0];assert.equal(stripped.data.evaluationMode,'ai');assert.equal(stripped.data.evaluationText,undefined);assert.equal(stripped.data.evaluationImages,undefined);
});
test('无法辨认的反馈不算一次成功评价，不用空白内容编造建议',()=>{
 const result=parseAiAnalysisResult('<classnode-scores>{"scores":[{"student":"学生#1","unavailable":true,"score":null,"reason":"未听到讲话","advice":"请重新录音"}]}</classnode-scores>',aiScoringConfigOf(q(evaluation)),entries,{allowScoreOnly:true});
 assert.ok('error' in result);
});

test('真实HTTP提交：文字与图片共同传给AI，反馈成功计次数而不写入零分', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cn-evaluation-'));
 const url=`file:${path.join(dir,'test.db')}`;prepareTemporarySqliteFile(url);
 const here=path.dirname(fileURLToPath(import.meta.url));
 execFileSync(process.execPath,[path.resolve(here,'../../node_modules/prisma/build/index.js'),'db','push','--skip-generate',`--schema=${path.resolve(here,'../../prisma/schema.prisma')}`],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
 const db=new PrismaClient({datasources:{db:{url}}});
 const imageUrl=`/uploads/chat/chat-${crypto.randomUUID()}.png`;
 const file=resolveLocalPath(imageUrl);fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=','base64');fs.writeFileSync(file,bytes);
 t.after(async()=>{await db.$disconnect();fs.unlinkSync(file);fs.rmSync(dir,{recursive:true,force:true});});
 const agent=await db.agent.create({data:{name:'测试分析',platform:'coze',apiKey:'test',botId:'123',purpose:'analysis'}});
 const node=q({...evaluation,evaluationImages:[imageUrl],studentAiReviewEnabled:true,aiReviewLimit:1});
 const sheet=await db.worksheet.create({data:{title:'反馈测试',content:{schemaVersion:1,nodes:[node]} as unknown as Prisma.InputJsonValue,settings:{analysisAgentId:agent.id,rewardStyle:'points',allowResubmit:false}}});
 const room=await db.classroom.create({data:{code:'9876',title:'测试课堂',mode:'standard',status:'active'}});
 const person=await db.classroomStudent.create({data:{classroomId:room.id,type:'student'}});
 await db.classroomWorksheet.create({data:{classroomId:room.id,worksheetId:sheet.id}});
 const app=express();app.use(express.json());app.set('prisma',db);let calls=0;
 app.set('analysisProxy',async(_agent:unknown,message:string,images:Buffer[])=>{
  calls++;assert.match(message,/说清观察与依据/);assert.match(message,/AI 评价要求/);assert.match(message,/只给具体评价与建议/);assert.match(message,/我看到了颜色变化/);assert.equal(images.length,1);assert.deepEqual(images[0],bytes);
  await db.worksheetAnswer.updateMany({data:{score:7,gradeState:'partial',isCorrect:false}}); // A stale grade present when AI returns must also be removed.
  const label=message.match(/请给下面这些学生评分：([^。]+)/)?.[1]?.split('、')[0];assert.ok(label);
  return {success:true,content:`<classnode-scores>${JSON.stringify({scores:[{student:label,score:null,reason:'你描述了颜色变化。',advice:'再说说变化前后的区别。'}]})}</classnode-scores>`};
 });
 app.use('/api/system',systemRoutes);app.use('/api/worksheets',worksheetAccessGate,worksheetRoutes);
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worksheets/${sheet.id}`;const token=createStudentToken(room.id,person.id);
 const call=(method:string,suffix:string,body?:unknown)=>fetch(base+suffix,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await call('PUT','/answers',{questionId:'q',value:{format:'text/v1',text:'我看到了颜色变化'}})).status,200);
 await db.worksheetAnswer.updateMany({data:{score:9,gradeState:'partial',isCorrect:false}});
 assert.equal((await call('PUT','/answers',{questionId:'q',value:{format:'text/v1',text:'我看到了颜色变化'}})).status,200);
 assert.equal((await db.worksheetAnswer.findFirstOrThrow()).score,null,'保存不计分新稿时移除残留成绩');
 await db.worksheetAnswer.updateMany({data:{score:9,gradeState:'partial',isCorrect:false}});
 const submitted=await call('POST','/answers/submit',{questionId:'q',requestId:'feedback_test'});assert.equal(submitted.status,200);const first=await submitted.json();assert.equal(first.reviewStatus,'pending');assert.equal(first.score,null,'提交不计分作答时移除残留成绩');
 let status='pending';for(let i=0;i<200;i++){const review=await db.worksheetAnswerReview.findUniqueOrThrow({where:{id:first.reviewId}});status=review.status;if(status!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status,'succeeded');assert.equal(calls,1);
 const saved=await db.worksheetAnswer.findFirstOrThrow();assert.equal(saved.score,null);assert.equal(saved.gradeState,null);
 const result=await(await call('GET','/answers')).json();assert.equal(result.rows[0].aiReferenceScore.maxScore,0);assert.equal(result.rows[0].aiReferenceScore.comment,'你描述了颜色变化。');assert.equal(result.rows[0].aiReferenceScore.score,null);
 assert.equal((await call('POST','/answers/submit',{questionId:'q',requestId:'feedback_again'})).status,409);assert.equal(calls,1);
 let cookie='';createTeacherSession({setHeader:(_name:string,value:string)=>{cookie=value.split(';')[0];}} as never);
 const teacherSave=(next:QuestionNode)=>fetch(base,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({content:{schemaVersion:1,nodes:[next]}})});
 const firstHistory=await db.worksheetAnswerReview.findFirstOrThrow();
 await db.worksheetAnswerReview.create({data:{answerId:firstHistory.answerId,requestId:'historical_scored_review',generation:firstHistory.generation,value:firstHistory.value as Prisma.InputJsonValue,question:firstHistory.question as Prisma.InputJsonValue,status:'succeeded',source:'teacher',score:9,maxScore:10,unit:'分',reason:'原评分依据',advice:'原建议'}});
 const beforeHistory=await db.worksheetAnswerReview.findMany();
 for (const mode of ['ai','collect']) {
   await db.worksheet.update({where:{id:sheet.id},data:{content:{schemaVersion:1,nodes:[q({...evaluation,evaluationScored:true,aiScoringMaxScore:10})]} as unknown as Prisma.InputJsonValue}});
   await db.worksheetAnswer.updateMany({data:{score:9,gradeState:'partial',isCorrect:false}});
   const result=await teacherSave(q({...evaluation,evaluationMode:mode}));assert.equal(result.status,200,await result.text());
   const answer=await db.worksheetAnswer.findFirstOrThrow();assert.equal(answer.score,null,mode+'：教师关闭计分后立即清除当前成绩');assert.equal(answer.gradeState,null);
 }
 assert.deepEqual(await db.worksheetAnswerReview.findMany(),beforeHistory,'清除当前成绩不删除或改写评价历史');
 const oldFill=q({answers:[['甲'],[]],fillBlankSettings:{a:{mode:'text',gradingMode:'auto',maxScore:2},b:{...evaluation,mode:'text',gradingMode:'ai',evaluationScored:true,maxScore:3}}},'fill-blank');
 oldFill.autoGrade=true;
 await db.worksheet.update({where:{id:sheet.id},data:{content:{schemaVersion:1,nodes:[oldFill]} as unknown as Prisma.InputJsonValue}});
 await db.worksheetAnswer.updateMany({data:{score:5,gradeState:'correct',isCorrect:true,value:{format:'fill-multi/v1',texts:['甲','自己的观察']}}});
 const nextFill={...oldFill,data:{...oldFill.data,fillBlankSettings:{a:{mode:'text',gradingMode:'auto',maxScore:2},b:{...evaluation,mode:'text',gradingMode:'ai',evaluationScored:false,maxScore:3}}}};
 const changed=await teacherSave(nextFill);assert.equal(changed.status,200,await changed.text());
 assert.equal((await db.worksheetAnswer.findFirstOrThrow()).score,2,'关闭其中一个空的AI计分后保留其余本地得分，移除AI旧分');
 assert.equal(calls,1,'规则变更不额外调用智能体');

});
test('历史选择填空明确使用新评价设置后，同样支持文字AI计分且旧题不会自动迁移',()=>{
 const node=q({answers:[['甲'],[]],fillBlankSettings:{a:{mode:'inline',gradingMode:'auto',maxScore:2},b:{...evaluation,mode:'text',gradingMode:'ai',maxScore:3,evaluationScored:true}}},'choice-blank');
 const config=aiScoringConfigOf(node);assert.equal(config.maxScore,3);assert.equal(config.parts?.[0].index,1);
 assert.equal(answerGradeWithFillAudio(node,{format:'fill-multi/v1',texts:['甲','解释内容']},2,3).score,4);
 assert.equal(aiScoringConfigOf(q({fillBlankSettings:{a:{mode:'text',gradingMode:'ai'}}},'choice-blank')).enabled,false);
});

test('新配置关闭分数时不保留旧AI成绩；仍计分与历史规则保持原行为',()=>{
 assert.equal(mayKeepPriorAiGrade(q(evaluation)),false);
 assert.equal(mayKeepPriorAiGrade(q({...evaluation,evaluationMode:'collect'})),false);
 assert.equal(mayKeepPriorAiGrade(q({...evaluation,evaluationScored:true,aiScoringMaxScore:3})),true);
 assert.equal(mayKeepPriorAiGrade(q({aiScoringEnabled:false})),true,'不因升级改变未迁移的历史口径');
 const previous=q({...evaluation,evaluationScored:true,aiScoringMaxScore:3});assert.equal(removedEvaluationScore(previous,q(evaluation)),true);
});
test('旧整题填空仅修改输入方式仍只给整题3分',()=>{
 const node=q({fillScoring:'whole',answers:[['甲'],['乙']],fillBlankSettings:{a:{mode:'inline',choices:['甲','丙']},b:{mode:'text',choices:[]}}},'fill-blank');node.autoGrade=true;
 assert.deepEqual(grade(node,{format:'fill-multi/v1',texts:['甲','乙']},{full:3,half:0}),{state:'correct',score:3});
});

test('练习判分与调查收集不生成个人AI评价，新规则不受旧小题判分开关影响',()=>{
 const exercise=q({evaluationVersion:1,evaluationMode:'answer',evaluationScored:true,options:[{key:'A',text:'甲'},{key:'B',text:'乙'}],correctKeys:['A']},'single-choice');
 assert.equal(aiScoringConfigOf(exercise).enabled,false);
 assert.equal(individualReviewSettings(exercise).enabled,false);
 assert.equal(grade(exercise,{format:'choice/v1',selected:['A']},{full:2,half:1})?.score,2);
 const survey={...exercise,data:{...exercise.data,evaluationMode:'collect',evaluationScored:false}};
 assert.equal(aiScoringConfigOf(survey).enabled,false);
 assert.equal(grade(survey,{format:'choice/v1',selected:['A']},{full:2,half:1}),null);
 assert.equal(individualReviewSettings(survey).enabled,false);
});
