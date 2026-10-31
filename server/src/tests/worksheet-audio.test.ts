import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createDatabaseClient } from '../services/database-client.js';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { createTeacherSession } from '../middleware/auth.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import { selectAnalyzeEntries, buildAnalysisPayload, DEFAULT_ANALYSIS_KNOBS, entriesFromAggregate, entriesToAggregate } from '../services/analysis-payload.js';
import { proxyAnalysisRequest } from '../services/ai-proxy.js';
import { findAudioValueError } from '../services/worksheet-audio.js';

const audioUrl = '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.ogg';
const audioValue = { format: 'audio/v1', url: audioUrl, durationMs: 3400 };
function opus() {
  const bytes = Buffer.alloc(47); bytes.write('OggS'); bytes[5] = 2; bytes[26] = 1; bytes[27] = 19;
  bytes.write('OpusHead', 28); bytes[36] = 1; bytes[37] = 1; return bytes;
}
test('audio analysis keeps original clips, labels and order through persisted aggregates', () => {
  const participants = [{ participantId: 'p1', name: '甲', labelNo: '1' }, { participantId: 'p2', name: '乙', labelNo: '2' }];
  const entries = selectAnalyzeEntries(participants.map(p => ({ participantId: p.participantId, questionId: 'q', status: 'submitted', value: audioValue })), participants, 'q');
  assert.equal(entries.length, 2); assert.equal(entries[0].kind, 'audio');
  assert.deepEqual(entriesFromAggregate(entriesToAggregate(entries)), entries);
  const payload = buildAnalysisPayload({ entries, participants, total: 2, knobs: DEFAULT_ANALYSIS_KNOBS, question: { questionId: 'q', heading: '任务一', typeLabel: '表达题', prompt: '说说发现' } });
  assert.equal(payload.payloadKind, 'text'); assert.equal(payload.sheetLayouts.length, 0);
  assert.deepEqual(payload.audioAnswers, [{ url: audioUrl, label: '甲#1' }, { url: audioUrl, label: '乙#2' }]);
  assert.match(payload.text!, /第 1 段音频/); assert.match(payload.text!, /第 2 段音频/);
  assert.equal(payload.unscorableIds.length, 0);
  assert.ok(findAudioValueError({ ...audioValue, url: 'https://example.com/a.ogg' }));
  assert.ok(findAudioValueError({ ...audioValue, durationMs: 300001 }));
});
test('Coze analysis uploads original audio as audio and collects the streamed evaluation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-audio-proxy-'));
  const oldDir = process.env.CLASSNODE_DATA_DIR, originalFetch = globalThis.fetch;
  process.env.CLASSNODE_DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, 'uploads/chat'), { recursive: true }); fs.writeFileSync(path.join(dir, audioUrl), opus());
  let uploads = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/v1/files/upload')) {
      const file = (init!.body as FormData).get('file') as File;
      assert.equal(file.type, 'audio/ogg'); uploads++;
      return Response.json({ code: 0, data: { id: `voice-${uploads}` } });
    }
    const body = JSON.parse(String(init!.body)); assert.equal(body.stream, true);
    const items = JSON.parse(body.additional_messages.at(-1).content);
    assert.deepEqual(items.slice(1), [{ type: 'audio', file_id: 'voice-1' }, { type: 'audio', file_id: 'voice-2' }]);
    assert.match(items[0].text, /第 1 段音频：甲#1/); assert.match(items[0].text, /第 2 段音频：乙#2/);
    return new Response('event: conversation.message.delta\ndata: {"role":"assistant","type":"answer","content":"语音评价完成"}\n\nevent: conversation.chat.completed\ndata: {"id":"chat","conversation_id":"conversation","status":"completed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const result = await proxyAnalysisRequest({ platform: 'coze', apiKey: 'test', botId: 'test' }, '任务要求', [], undefined, [{ url: audioUrl, label: '甲#1' }, { url: audioUrl, label: '乙#2' }]);
    assert.equal(result.success, true); assert.equal(result.content, '语音评价完成'); assert.equal(uploads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldDir === undefined) delete process.env.CLASSNODE_DATA_DIR; else process.env.CLASSNODE_DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('audio answer end-to-end: configure, upload, save, submit, restore and analyze', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-worksheet-audio-'));
  const oldDir = process.env.CLASSNODE_DATA_DIR; process.env.CLASSNODE_DATA_DIR = dir;
  const dbUrl = `file:${path.join(dir, 'test.db')}`; prepareTemporarySqliteFile(dbUrl);
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, [path.resolve(here, '../../node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe' });
  const db = createDatabaseClient(dbUrl);
  t.after(async () => { await db.$disconnect(); if (oldDir === undefined) delete process.env.CLASSNODE_DATA_DIR; else process.env.CLASSNODE_DATA_DIR = oldDir; fs.rmSync(dir, { recursive: true, force: true }); });
  const app = express(); app.use(express.json()); app.set('prisma', db);
  const uploaded = await import('../routes/upload.js');
  app.use('/api/upload', uploaded.default);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  let analyzedAudio: unknown;
  app.set('analysisProxy', async (_agent: unknown, message: string, _images: unknown, _signal: unknown, audio: unknown) => { analyzedAudio = audio; assert.match(message, /语音作答/); return { success: true, content: '学生说明了观察过程。' }; });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = ''; createTeacherSession({ setHeader: (_n: string, value: string) => { cookie = value.split(';')[0]; } } as never);
  const call = (method: string, suffix: string, body?: unknown, token?: string) => fetch(`${base}/api/worksheets${suffix}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const agent = await db.agent.create({ data: { name: '评价', purpose: 'analysis', platform: 'coze', apiKey: 'unused', botId: 'test' } });
  const created = await call('POST', '', { title: '口头表达', content: { schemaVersion: 1, nodes: [{ id: 'q', type: 'short-answer', prompt: '说说观察到的现象', inputMode: 'audio', data: {}, children: [] }] }, settings: { answerMode: 'open', analysisAgentId: agent.id } });
  assert.equal(created.status, 200); const sheet = await created.json(); assert.equal(sheet.content.nodes[0].inputMode, 'audio');
  const room = await db.classroom.create({ data: { status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.create({ data: { classroomId: room.id, worksheetId: sheet.id } });
  const student = await db.classroomStudent.create({ data: { classroomId: room.id, type: 'student' } });
  const token = createStudentToken(room.id, student.id);
  const form = new FormData(); form.append('file', new Blob([opus()], { type: 'audio/ogg' }), 'voice.ogg');
  const response = await fetch(`${base}/api/upload/worksheet-audio`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  assert.equal(response.status, 200); const upload = await response.json(); assert.match(upload.url, new RegExp(`/classrooms/${room.id}/worksheet/.*\\.ogg$`));
  const invalid = new FormData(); invalid.append('file', new Blob(['not audio']), 'bad.ogg');
  assert.equal((await fetch(`${base}/api/upload/worksheet-audio`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: invalid })).status, 400);
  const value = { ...audioValue, url: upload.url };
  assert.equal((await call('PUT', `/${sheet.id}/answers`, { questionId: 'q', value }, token)).status, 200);
  assert.equal((await call('POST', `/${sheet.id}/answers/submit`, { questionId: 'q' }, token)).status, 200);
  const restored = await (await call('GET', `/${sheet.id}/answers`, undefined, token)).json();
  assert.deepEqual(restored.rows[0].value, value); assert.equal(restored.rows[0].status, 'submitted');
  assert.equal((await call('POST', `/${sheet.id}/analysis/q?classroomId=${room.id}`)).status, 200);
  const analysis = await call('POST', `/${sheet.id}/analysis/q/run?classroomId=${room.id}`);
  assert.equal(analysis.status, 200, await analysis.text());
  assert.ok(Array.isArray(analyzedAudio)); assert.equal(analyzedAudio[0].url, upload.url);
  assert.equal((await call('PUT', `/${sheet.id}/answers`, { questionId: 'q', value: { ...value, url: 'https://elsewhere/audio.ogg' } }, token)).status, 400);
  await db.worksheet.update({ where: { id: sheet.id }, data: { content: { schemaVersion: 1, nodes: [{ id: 'q', type: 'short-answer', inputMode: 'audio', prompt: '说说发现', data: { aiScoringEnabled: true, studentAiReviewEnabled: true, aiScoringMaxScore: 10, rubricText: '说清楚观察到的变化' }, children: [] }] } } });
  app.set('analysisProxy', async (_agent: unknown, _message: string, _images: unknown, _signal: unknown, audio: Array<{url:string;label:string}>) => {
    assert.equal(audio[0].url, upload.url);
    return { success: true, content: `<classnode-scores>${JSON.stringify({scores:[{student:audio[0].label,score:2,reason:'你说出了观察到的变化。',advice:'你可以补充发生变化的过程。'}]})}</classnode-scores><classnode-evidence>${JSON.stringify({students:[{student:audio[0].label,summary:"教师专用观察依据",criteria:[{requirement:"说清变化",status:"partial",evidence:"说明了变化，未说明过程"}],limitations:[]}]})}</classnode-evidence>` };
  });
  const personal = await (await call('POST', `/${sheet.id}/answers/submit`, {questionId:'q',evaluate:true,requestId:'audio_personal_review'}, token)).json();
  assert.ok(personal.reviewId);
  for (let i=0;i<100;i++) {
    const review = await db.worksheetAnswerReview.findUnique({where:{id:personal.reviewId}});
    if (review?.status !== 'pending') { assert.equal(review?.status,'succeeded',review?.error || '个人评价失败'); assert.deepEqual(review?.value,value); assert.equal(review?.score,2); break; }
    if(i===99) assert.fail('个人语音评价没有完成');
    await new Promise(resolve=>setTimeout(resolve,20));
  }

  const storedEvidence = await db.worksheetAnswerReview.findUnique({where:{id:personal.reviewId}});
  const storedQuestion = storedEvidence?.question;
  assert.ok(storedQuestion && typeof storedQuestion === 'object' && !Array.isArray(storedQuestion));
  const evidence = storedQuestion.evaluationEvidence;
  assert.ok(evidence && typeof evidence === 'object' && !Array.isArray(evidence));
  assert.equal(evidence.summary, '教师专用观察依据');
  const publicReviews = await (await call('GET', `/${sheet.id}/answers/reviews`, undefined, token)).json();
  assert.ok(!JSON.stringify(publicReviews).includes('教师专用观察依据'));
  assert.ok(!JSON.stringify(publicReviews).includes('evaluationEvidence'));
  const teacherReviews=await (await call('GET',`/${sheet.id}/reviews?classroomId=${room.id}&participantId=${student.id}`)).json();
  assert.equal(teacherReviews.reviews.find((r:{id:string})=>r.id===personal.reviewId).evidence.summary,'教师专用观察依据');

  const personalAudioProxy = app.get('analysisProxy');
  let summaryAudioCalls = 0;
  app.set('analysisProxy', async (_agent: unknown, message: string, images: Buffer[], _signal: unknown, clips: unknown[]) => {
    summaryAudioCalls++;
    assert.match(message, /个人评价结果汇总/); assert.match(message, /教师专用观察依据/);
    assert.equal(images.length, 0); assert.deepEqual(clips, []); assert.ok(!message.includes(upload.url));
    return { success: true, content: '### 主要表现\n依据个人评价，学生说明了变化，建议补充过程。' };
  });
  const summary = await call('POST', `/${sheet.id}/analysis/q/run?classroomId=${room.id}&analysisOnly=true`);
  assert.equal(summary.status, 200, await summary.clone().text()); assert.equal(summaryAudioCalls, 1);
  assert.match((await summary.json()).narrative, /纳入有效评价 1 人/);
  app.set('analysisProxy', personalAudioProxy);

  assert.equal((await call('POST',`/${sheet.id}/answers/speech`,{reviewId:personal.reviewId},token)).status,403,'学生不能调用朗读接口');

  // Ordinary fills and tables share this same per-slot submission contract.
  const fillNode = { id: 'qfill', type: 'fill-blank', inputMode: 'keyboard', prompt: '{填空域}{填空域}', data: {
    promptRuns: [{start:0,end:5,blank:'text-slot'},{start:5,end:10,blank:'voice-slot'}], answers:[['甲'],[]],
    fillBlankSettings:{'text-slot':{mode:'text',gradingMode:'auto',maxScore:2},'voice-slot':{mode:'audio',gradingMode:'ai',maxScore:3,audioCriteria:'说清理由'}}, studentAiReviewEnabled:true,
  }, children:[] };
  await db.worksheet.update({where:{id:sheet.id},data:{content:{schemaVersion:1,nodes:[fillNode]}}});
  const mixedValue = {format:'fill-multi/v1',texts:['甲',''],audios:{'voice-slot':value}};
  const savedFill = await call('PUT', `/${sheet.id}/answers`, {questionId:'qfill',value:mixedValue},token);
  assert.equal(savedFill.status,200,await savedFill.text());
  app.set('analysisProxy', async (_agent:unknown,message:string,_images:unknown,_signal:unknown,clips:Array<{url:string;label:string}>)=>{
    assert.equal(clips[0].url,upload.url); assert.match(clips[0].label,/第 2 空/); assert.match(message,/说清理由/);
    const studentLabel=clips[0].label.split(' · ')[0];
    return {success:true,content:`<classnode-scores>${JSON.stringify({scores:[{student:studentLabel,score:2,reason:'你说明了理由',advice:'再补充依据',parts:[{index:1,score:2,reason:'理由基本清楚',advice:'举一个观察到的例子'}]}]})}</classnode-scores>`};
  });
  const fillSubmitResponse=await call('POST',`/${sheet.id}/answers/submit`,{questionId:'qfill',requestId:'fill_audio_personal_review'},token);
  assert.equal(fillSubmitResponse.status,200);
  const fillSubmit=await fillSubmitResponse.json(); assert.ok(fillSubmit.reviewId);
  let succeeded=false;
  for(let i=0;i<100;i++){
    const review=await db.worksheetAnswerReview.findUnique({where:{id:fillSubmit.reviewId}});
    if(review?.status!=='pending'){assert.equal(review?.status,'succeeded',review?.error ?? '');succeeded=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(succeeded,true);
  const filled=await db.worksheetAnswer.findFirst({where:{questionId:'qfill'}});
  assert.equal(filled?.score,4); assert.equal(filled?.gradeState,'partial');
  assert.deepEqual(filled?.value,mixedValue);

  const currentFill=await (await call('GET',`/${sheet.id}/answers`,undefined,token)).json();
  const currentRow=currentFill.rows.find((row:{questionId:string})=>row.questionId==='qfill');
  assert.equal(currentRow.aiReferenceScore.score,2);
  assert.match(currentRow.aiReferenceScore.comment,/第 2 空/);
  assert.match(currentRow.aiReferenceScore.advice,/观察到的例子/);

  const emptyNode={...fillNode,id:'qempty'};
  await db.worksheet.update({where:{id:sheet.id},data:{content:{schemaVersion:1,nodes:[emptyNode]}}});
  assert.equal((await call('PUT',`/${sheet.id}/answers`,{questionId:'qempty',value:mixedValue},token)).status,200);
  app.set('analysisProxy',async(_agent:unknown,_message:unknown,_images:unknown,_signal:unknown,clips:Array<{label:string}>)=>({success:true,content:'<classnode-scores>'+JSON.stringify({scores:[{student:clips[0].label.split(' · ')[0],score:null,reason:'无有效内容',advice:'请重新录音',parts:[{index:1,score:null,reason:'没有听到讲话',advice:'请重新录音'}]}]})+'</classnode-scores>'}));
  const emptySubmission=await (await call('POST',`/${sheet.id}/answers/submit`,{questionId:'qempty',requestId:'fill_empty_audio_review'},token)).json();
  assert.ok(emptySubmission.reviewId);
  for(let i=0;i<100;i++){
    const review=await db.worksheetAnswerReview.findUnique({where:{id:emptySubmission.reviewId}});
    if(review?.status!=='pending'){
      assert.equal(review?.status,'failed');
      assert.match(review?.error ?? '', /AI 暂时没能完成评分/);
      assert.doesNotMatch(review?.error ?? '', /第 2 空|没有听到讲话/);
      break;
    }
    if(i===99) assert.fail('空白语音评价未结束');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal((await db.worksheetAnswer.findFirst({where:{questionId:'qempty'}}))?.score,null);

});
