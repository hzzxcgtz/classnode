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
import { type Prisma } from '@prisma/client';
import { createDatabaseClient } from '../services/database-client.js';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { createTeacherSession } from '../middleware/auth.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

test('停止和清除：保留作答、按学生隔离、保留其它课堂与评分、拦截晚到结果及后续批次', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-analysis-controls-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, [path.resolve(here, '../../node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = createDatabaseClient(url);
  t.after(async () => { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const node = { id: 'q', type: 'short-answer', prompt: '写一件小事', inputMode: 'keyboard', data: { aiScoringEnabled: true, aiScoringMaxScore: 5, studentAiReviewEnabled: false }, children: [] };
  const agent = await db.agent.create({ data: { name: '分析', purpose: 'analysis', platform: 'coze', apiKey: 'test', botId: '1' } });
  const sheet = await db.worksheet.create({ data: { title: '习作', content: { nodes: [node] }, settings: { allowResubmit: true, rewardStyle: 'points', analysisAgentId: agent.id } } });
  const room = await db.classroom.create({ data: { title: '一班', status: 'active', mode: 'standard' } });
  const otherRoom = await db.classroom.create({ data: { title: '二班', status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.createMany({ data: [room, otherRoom].map(r => ({ classroomId: r.id, worksheetId: sheet.id })) });
  const people = await Promise.all([0, 1].map(() => db.classroomStudent.create({ data: { classroomId: room.id, type: 'student' } })));
  const outsider = await db.classroomStudent.create({ data: { classroomId: otherRoom.id, type: 'student' } });
  const answers = [];
  for (const person of [...people, outsider]) {
    const response = await db.worksheetResponse.create({ data: { classroomId: person.classroomId, worksheetId: sheet.id, participantId: person.id } });
    answers.push(await db.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q', value: { format: 'text/v1', text: '今天课间，我和同学一起整理了图书角。' }, status: 'submitted', submittedAt: new Date(Date.now() - 1000), score: 3, gradeState: 'partial', isCorrect: false } }));
  }
  const app = express(); app.use(express.json()); app.set('prisma', db);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  app.set('analysisProxy', async () => {
    entered?.();
    await new Promise<void>(resolve => { release = resolve; });
    // Deliberately ignores cancellation: the route must still refuse to persist it.
    return { success: true, content: '### 核心结论\n晚到的班级分析。' };
  });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  let cookie = ''; createTeacherSession({ setHeader: (_n: string, v: string) => { cookie = v.split(';')[0]; } } as never);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worksheets/${sheet.id}/analysis/q`;
  const call = (method: string, suffix = '', body?: unknown, token?: string) => fetch(`${base}${suffix}?classroomId=${room.id}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await call('POST')).status, 200);
  const metadata = { maxScore: 5, unit: '分', criteria: '', scores: people.map(p => ({ studentId: p.id, score: 3, reason: '评价', advice: '建议' })) };
  const key = { classroomId_worksheetId_questionId: { classroomId: room.id, worksheetId: sheet.id, questionId: 'q' } };
  const restore = () => db.worksheetQuestionAnalysis.update({ where: key, data: { narrative: '原班级分析', analyzedAt: new Date(), perStudent: metadata } });
  await restore();
  for (const answer of answers) await db.worksheetAnswerReview.create({ data: { answerId: answer.id, requestId: `review-${answer.id}`, generation: '0:0', question: node as Prisma.InputJsonValue, source: 'student', status: 'succeeded', score: 3, maxScore: 5, unit: '分', reason: '评价', advice: '建议', evaluatedAt: new Date() } });
  const token = createStudentToken(room.id, people[0].id);
  for (const [method, suffix] of [['POST', '/stop'], ['DELETE', '/grades'], ['DELETE', '/result']]) assert.equal((await call(method, suffix, {}, token)).status, 403);
  assert.equal((await call('DELETE', '/grades', { participantIds: [] })).status, 400);
  assert.equal((await call('DELETE', '/grades', { participantIds: [outsider.id] })).status, 400);

  assert.equal((await call('DELETE', '/result')).status, 200);
  const clearedReport = await db.worksheetQuestionAnalysis.findUniqueOrThrow({ where: key });
  assert.equal(clearedReport.narrative, null);
  assert.equal(clearedReport.analyzedAt, null);
  assert.deepEqual((clearedReport.perStudent as { scores: unknown }).scores, metadata.scores);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[0].id } })).score, 3);
  await restore();
  assert.equal((await call('DELETE', '/grades', { participantIds: [people[0].id] })).status, 200);
  const cleared = await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[0].id } });
  assert.equal(cleared.score, null); assert.equal(cleared.gradeState, null); assert.equal(cleared.status, 'submitted');
  assert.deepEqual(cleared.value, answers[0].value);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[1].id } })).score, 3);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[2].id } })).score, 3);
  const after = await (await call('GET')).json();
  assert.deepEqual(after.perStudent.scores.map((s: { studentId: string }) => s.studentId), [people[1].id], '旧个人评价不得恢复被清除的评分');

  await call('POST', '', { operationId: 'stopped-operation' });
  const running = call('POST', '/run', { operationId: 'stopped-operation' });
  await enteredPromise;
  assert.equal((await call('POST', '/stop')).status, 200);
  release!();
  assert.equal((await running).status, 409);
  assert.equal((await call('POST', '/run', { operationId: 'stopped-operation' })).status, 409, '停止后的后续批次不准启动');
  assert.equal((await db.worksheetQuestionAnalysis.findUniqueOrThrow({ where: key })).narrative, '原班级分析');

  enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  await call('POST', '', { operationId: 'cleared-operation' });
  const late = call('POST', '/run', { operationId: 'cleared-operation' });
  await enteredPromise;
  assert.equal((await call('DELETE', '/grades')).status, 200);
  release!();
  assert.equal((await late).status, 409);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[1].id } })).score, null);
  assert.equal((await db.worksheetAnswer.findUniqueOrThrow({ where: { id: answers[2].id } })).score, 3);
  assert.equal(await db.worksheetAnswer.count(), 3, '清分不删除作答');
  assert.equal((await db.worksheetQuestionAnalysis.findUniqueOrThrow({ where: key })).narrative, '原班级分析', '清评分不删除班级分析');
  const edit = await fetch(base.replace('/analysis/q', '/answers'), { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ questionId: 'q', value: { format: 'text/v1', text: '清评分后继续修改作品' }, generation: '0:0' }) });
  assert.equal(edit.status, 200, '仅清评分不能使学生现有作答版本失效');

  // Objective grades remain protected even with automatic grading disabled or a legacy AI flag.
  const objective = { id: 'objective', type: 'true-false', prompt: '三角形有三条边。', autoGrade: false, data: { answer: true, aiScoringEnabled: true }, children: [] };
  await db.worksheet.update({ where: { id: sheet.id }, data: { content: { nodes: [node, objective] } } });
  const objectiveAnswer = await db.worksheetAnswer.create({ data: { responseId: answers[0].responseId, questionId: 'objective', value: { answer: true }, status: 'submitted', submittedAt: new Date(), gradeState: 'correct', isCorrect: true, score: 1 } });
  const objectiveBase = base.replace('/analysis/q', '/analysis/objective');
  const objectiveCall = (method: string, suffix = '', body?: unknown) => fetch(`${objectiveBase}${suffix}?classroomId=${room.id}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const objectivePayload = await (await objectiveCall('POST')).json();
  assert.equal(objectivePayload.canClearAiScores, false);
  for (const body of [{}, { participantIds: [people[0].id] }]) {
    const denied = await objectiveCall('DELETE', '/grades', body);
    assert.equal(denied.status, 409);
    assert.match((await denied.json()).error, /客观题的直接打分不能清除/);
    assert.deepEqual(await db.worksheetAnswer.findUniqueOrThrow({ where: { id: objectiveAnswer.id } }), objectiveAnswer);
  }
  await db.worksheetQuestionAnalysis.update({ where: { classroomId_worksheetId_questionId: { classroomId: room.id, worksheetId: sheet.id, questionId: 'objective' } }, data: { narrative: '客观题作答分析', analyzedAt: new Date() } });
  assert.equal((await objectiveCall('DELETE', '/result')).status, 200);
  assert.deepEqual(await db.worksheetAnswer.findUniqueOrThrow({ where: { id: objectiveAnswer.id } }), objectiveAnswer, '客观题清除分析不改变直接打分');
  await db.worksheet.update({ where: { id: sheet.id }, data: { content: { nodes: [{ ...node, data: { ...node.data, aiScoringEnabled: false } }, objective] } } });
  assert.equal((await (await call('GET')).json()).canClearAiScores, true, '关闭AI评分的主观题仍可清除旧AI评分');
});
