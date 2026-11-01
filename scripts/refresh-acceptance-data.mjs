/** Refresh local acceptance fixtures without changing existing classrooms or fabricating AI reviews.
 * pnpm --filter classnode-server exec tsx ../scripts/refresh-acceptance-data.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validateQuestion,flattenQuestions} from '../server/src/services/worksheet-questions.ts';
import {aiEvaluationEnabled,evaluationRequirements} from '../server/src/services/worksheet-evaluation.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'server/package.json'));
const {PrismaClient}=require('@prisma/client');
const db=path.join(root,'server/prisma/dev.db');
const prisma=new PrismaClient({datasources:{db:{url:`file:${db}`}}});
const directory=path.join(root,'.dev/acceptance-current');
const revision='accept216-20261101';
const apply=process.argv.includes('--apply');
const report={revision,applied:apply,oldDataPreserved:true,audit:[],created:[]};
const plans=[];
try {
 report.existingWorksheets=[];
 for(const sheet of await prisma.worksheet.findMany()) {
  const questions=flattenQuestions(sheet.content).filter(n=>!['task','heading'].includes(n.type));
  const issues=[];
  for(const node of questions) {
   const errors=validateQuestion(node);if(errors.length)issues.push({questionId:node.id,errors});
   if(aiEvaluationEnabled(node)&&!['fill-blank','choice-blank'].includes(node.type)&&!evaluationRequirements(node.data).trim())issues.push({questionId:node.id,errors:['AI评价要求为空']});
  }
  report.existingWorksheets.push({id:sheet.id,title:sheet.title,questions:questions.length,issues});
 }
 for(const kind of ['voice','general']) {
  const source=await prisma.worksheet.findUniqueOrThrow({where:{id:`accept216-20261028-${kind}`}});
  const room=await prisma.classroom.findUniqueOrThrow({where:{id:`accept216-20261028-${kind}-room`},include:{classes:true,students:{include:{student:true}},worksheets:true}});
  const agent=await prisma.agent.findUnique({where:{id:source.settings.analysisAgentId}});
  if(!agent?.enabled||agent.purpose!=='analysis')throw Error(`验收智能体不可用：${kind}`);
  if(await prisma.worksheet.findUnique({where:{id:`${revision}-${kind}`}}))throw Error('新版验收数据已存在，停止以保护后续真机测试记录');
  const nodes=structuredClone(source.content.nodes);
  const questions=flattenQuestions({...source.content,nodes});
  if(!questions.length)throw Error("验收学习单不能为空");
  for(const node of questions) {
   const errors=validateQuestion(node);if(errors.length)throw Error(`${node.id}: ${errors.join(';')}`);
   if(aiEvaluationEnabled(node)) {
    node.data.aiReviewLimit=5;
    node.data.studentAiReviewEnabled=true;
    if(node.type!=='fill-blank'&&node.type!=='choice-blank'&&!evaluationRequirements(node.data).trim())throw Error(`${node.id} 缺少评价要求`);
    for(const [blank,setting] of Object.entries(node.data.fillBlankSettings??{}))if(setting.evaluationMode==='ai'&&!evaluationRequirements(setting).trim())throw Error(`${blank} 缺少评价要求`);
   }
  }
  const responses=await prisma.worksheetResponse.findMany({where:{classroomId:room.id,worksheetId:source.id},include:{answers:true}});
  const assets=new Set();
  function findAssets(value) {
   if(typeof value==='string'&&value.startsWith('/uploads/'))assets.add(value);
   else if(Array.isArray(value))value.forEach(findAssets);
   else if(value&&typeof value==='object')Object.values(value).forEach(findAssets);
  }
  responses.forEach(response=>response.answers.forEach(answer=>findAssets(answer.value)));
  for(const url of assets){const file=path.resolve(root,'server',`.${url}`);if(!file.startsWith(path.join(root,'server/uploads')+path.sep)||!fs.existsSync(file))throw Error(`附件不存在或路径无效：${url}`);}
  const oldReviews=await prisma.worksheetAnswerReview.groupBy({by:['status'],where:{answer:{response:{classroomId:room.id}}},_count:true});
  report.audit.push({source:source.title,questionCount:questions.length,aiQuestions:questions.filter(aiEvaluationEnabled).length,assets:assets.size,reviewStates:oldReviews.map(r=>({status:r.status,count:r._count})),note:'旧提交快照不代表成功AI评价；保留原样，不改写评价依据或伪造成功结果。'});
  plans.push({kind,source,room,nodes,responses,questions});
 }
 if(apply) {
  fs.mkdirSync(directory,{recursive:true});
  const backup=path.join(directory,`before-${Date.now()}.db`);
  execFileSync('python3',['-c','import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',db,backup]);report.backup=backup;
  await prisma.$transaction(async tx=>{
   for(const {kind,source,room,nodes,responses,questions} of plans) {
    const title=`2.1.6 更新验收｜${kind==='voice'?'语音作答与自动评价':'客观判分、调查与主观评价'}`;
    const sheet=await tx.worksheet.create({data:{id:`${revision}-${kind}`,title,description:'2026-11-01刷新。虚构验收数据；预填内容均为未提交草稿。请登录学生端提交以触发真实AI评价，完成后再生成全班分析；不预造AI分数或评价。旧课堂与历史数据完整保留。',content:{...source.content,nodes},settings:{...source.settings,allowResubmit:true}}});
    let code=kind==='voice'?2168:2169;while(await tx.classroom.findUnique({where:{code:String(code)}}))code++;
    const created=await tx.classroom.create({data:{id:`${revision}-${kind}-room`,title,code:String(code),mode:'standard',status:'active',classes:{create:room.classes.map(c=>({classId:c.classId}))},worksheets:{create:{worksheetId:sheet.id}},modules:{create:[{moduleKey:'learning-sheet',state:'open'},{moduleKey:'explorer',state:'hidden'},{moduleKey:'companion',state:'hidden'}]}}});
    let drafts=0;
    for(const member of room.students.filter(s=>s.type==='student')) {
     const participant=await tx.classroomStudent.create({data:{classroomId:created.id,studentId:member.studentId,type:'student',status:'offline'}});
     await tx.interaction.create({data:{classroomId:created.id,studentId:participant.id}});
     const response=responses.find(r=>r.participantId===member.id);if(!response?.answers.length)continue;
     const now=new Date();
     const draft=await tx.worksheetResponse.create({data:{classroomId:created.id,worksheetId:sheet.id,participantId:participant.id,status:'in-progress',startedAt:now}});
     for(const answer of response.answers) {
      if(!questions.some(q=>q.id===answer.questionId))continue;
      await tx.worksheetAnswer.create({data:{responseId:draft.id,questionId:answer.questionId,value:answer.value,status:'draft',createdAt:now,savedAt:now,saveCount:1}});drafts++;
     }
    }
    report.created.push({title,code:String(code),worksheetId:sheet.id,classroomId:created.id,drafts,questions:questions.length});
   }
  },{timeout:60000});
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify(report,null,2));
} finally {await prisma.$disconnect();}
