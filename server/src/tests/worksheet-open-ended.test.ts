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
import { grade, validateQuestion, type QuestionNode } from '../services/worksheet-questions.js';
import { analysisReferenceAnswer } from '../services/analysis-question.js';
import { aiScoringConfigOf } from '../services/analysis-scoring.js';
import { individualReviewSettings } from '../services/individual-review.js';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { createTeacherSession } from '../middleware/auth.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

const question = (type: QuestionNode['type'], data: Record<string, unknown> = {}): QuestionNode => ({ id: type, type, prompt: '请写下你的想法或选择。', inputMode: 'keyboard', autoGrade: false, data, children: [] });
const objectiveQuestions: QuestionNode[] = [
  question('single-choice', { options: [{ key: 'A', text: '方案一' }, { key: 'B', text: '方案二' }] }),
  question('multi-choice', { options: [{ key: 'A', text: '方案一' }, { key: 'B', text: '方案二' }] }),
  question('true-false'),
  question('fill-blank', { answers: [[]] }),
  question('choice-blank', { answers: [[]], choices: ['方案一', '方案二'] }),
  question('order', { items: [{ id: 'i1', text: '先观察' }, { id: 'i2', text: '先提问' }] }),
  question('match', { left: [{ id: 'l1', text: '树' }, { id: 'l2', text: '花' }], right: [{ id: 'r1', text: '春' }, { id: 'r2', text: '夏' }] }),
  question('categorize', { items: [{ id: 'i1', text: '跑步' }, { id: 'i2', text: '看书' }], zones: [{ id: 'z1', label: '室内' }, { id: 'z2', label: '室外' }] }),
];

test('八种客观题关闭自动评分后可无答案保存，不判对错；选择填空仍须有作答材料', () => {
  for (const node of objectiveQuestions) {
    assert.deepEqual(validateQuestion(node), [], node.type);
    assert.equal(grade(node, {}, { full: 1, half: 0 }), null, node.type);
    assert.match(analysisReferenceAnswer(node), /不设标准答案/);
  }
  assert.ok(validateQuestion(question('choice-blank', { answers: [[]], choices: [] })).some(message => message.includes('待选词')));
  const open = question('open-ended', { aiScoringEnabled: true, studentAiReviewEnabled: true, answers: [['错误注入的答案']] });
  assert.equal(grade(open, { format: 'text/v1', text: '我的独特观点' }, { full: 5, half: 0 }), null);
  assert.equal(aiScoringConfigOf(open).enabled, false);
  assert.equal(individualReviewSettings(open).enabled, false);
  assert.ok(!analysisReferenceAnswer(open).includes('错误注入的答案'));
});

test('开放题端到端：编辑保存、文字/照片/手写设置、学生提交回读、仅AI分析且不写入评分', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-open-ended-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, [path.resolve(here, '../../node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = createDatabaseClient(url);
  t.after(async () => { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const agent = await db.agent.create({ data: { name: '分析', purpose: 'analysis', platform: 'coze', apiKey: 'unused', botId: 'test' } });
  const app = express(); app.use(express.json()); app.set('prisma', db);
  let message = '';
  app.set('analysisProxy', async (_agent: unknown, text: string) => { message = text; return { success: true, content: '### 核心结论\n学生提出了不同观察角度，可以比较思路。\n<classnode-scores>{"scores":[]}</classnode-scores>' }; });
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worksheets`;
  let cookie = ''; createTeacherSession({ setHeader: (_n: string, value: string) => { cookie = value.split(';')[0]; } } as never);
  const call = (method: string, suffix: string, body?: unknown, token?: string) => fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const open = question('open-ended', { answers: [['不该保存']], aiScoringEnabled: true, studentAiReviewEnabled: true, rubricText: '不该保存的评分标准' });
  const guided = { ...question('short-answer', { answers: [['我先蹲下来，看见蚂蚁绕过叶子。']], rubricText: '用可见动作或对话写具体，不要求使用修辞。', analysisFocus: '重点看动作细节，暂不重点看修辞。' }), id: 'guided' };
  const task = { ...question('task', { description: '观察校园中的一件小事，保留现场细节。' }), id: 'task', prompt: '校园观察', children: [guided] };
  const invalid = await call('POST', '', { title: '缺标准', content: { schemaVersion: 1, nodes: [{ ...question('short-answer', { aiScoringEnabled: true }), id: 'invalid' }] } });
  assert.equal(invalid.status, 400, '开启AI评分必须提供评价标准');
  const created = await call('POST', '', { title: '开放探究', description: '比较不同观察方法。', content: { schemaVersion: 1, nodes: [open, { ...question('open-ended'), id: 'photo', inputMode: 'photo' }, { ...question('open-ended'), id: 'ink', inputMode: 'handwriting' }, ...objectiveQuestions, task] }, settings: { answerMode: 'open', analysisAgentId: agent.id, gradeLevel: 3, subject: '语文' } });
  assert.equal(created.status, 200);
  const sheet = await created.json();
  assert.equal(sheet.settings.gradeLevel, 3);
  assert.equal(sheet.settings.subject, '语文');
  const copy = await (await call('POST', `/${sheet.id}/duplicate`)).json();
  assert.equal(copy.settings.gradeLevel, 3);
  assert.equal(copy.settings.subject, '语文');
  assert.equal(sheet.content.nodes[0].type, 'short-answer');
  assert.deepEqual(sheet.content.nodes[0].data, { aiScoringEnabled: false, studentAiReviewEnabled: false });
  assert.equal(sheet.content.nodes[1].inputMode, 'photo');
  assert.equal(sheet.content.nodes[2].inputMode, 'handwriting');
  const room = await db.classroom.create({ data: { title: '开放课堂', status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.create({ data: { classroomId: room.id, worksheetId: sheet.id } });
  const student = await db.classroomStudent.create({ data: { classroomId: room.id, type: 'student' } });
  const token = createStudentToken(room.id, student.id);
  const value = { format: 'text/v1', text: '我觉得可以先观察叶子的颜色，再记录一周内的变化。' };
  assert.equal((await call('PUT', `/${sheet.id}/answers`, { questionId: open.id, value }, token)).status, 200);
  const submitted = await (await call('POST', `/${sheet.id}/answers/submit`, { questionId: open.id, evaluate: true }, token)).json();
  assert.equal(submitted.score, null);
  assert.equal(submitted.gradeState, null);
  assert.equal(submitted.reviewStatus, 'submitted', '无评分表达题只记录提交，不产生AI评价任务');
  const hydrated = await (await call('GET', `/${sheet.id}/answers`, undefined, token)).json();
  assert.deepEqual(hydrated.rows[0].value, value);
  assert.equal(hydrated.rows[0].aiReferenceScore, null);
  const analysisUrl = `/${sheet.id}/analysis/${open.id}`;
  const payload = await (await call('POST', `${analysisUrl}?classroomId=${room.id}`)).json();
  assert.equal(payload.openEnded, true);
  assert.equal(payload.aiScoring.enabled, false);
  assert.equal(payload.canClearAiScores, true, '兼容转换为表达题后仍遵循主观题评分清除策略');
  assert.equal(payload.analysisMode, 'open');
  assert.match(payload.context, /比较不同观察方法/);
  assert.match(payload.context, /适用年级：小学三年级/);
  assert.match(payload.context, /学科：语文/);
  assert.match(payload.text, /观察叶子的颜色/);
  assert.equal((await call('POST', `${analysisUrl}/run?classroomId=${room.id}`)).status, 200);
  assert.match(message, /不自行设定标准答案/);
  assert.ok(!message.includes('不该保存'));
  const answer = await db.worksheetAnswer.findFirstOrThrow();
  assert.equal(answer.score, null);
  assert.equal(answer.gradeState, null);
  assert.equal(await db.worksheetAnswerReview.count({ where: { status: 'pending' } }), 0);
  assert.equal((await call('PUT', `/${sheet.id}/answers`, { questionId: guided.id, value }, token)).status, 200);
  assert.equal((await call('POST', `/${sheet.id}/answers/submit`, { questionId: guided.id }, token)).status, 200);
  const guidedUrl = `/${sheet.id}/analysis/${guided.id}`;
  const guidedPayload = await (await call('POST', `${guidedUrl}?classroomId=${room.id}`)).json();
  assert.equal(guidedPayload.analysisMode, 'guided');
  assert.equal(guidedPayload.aiScoring.enabled, false);
  assert.match(guidedPayload.context, /校园观察/);
  assert.match(guidedPayload.context, /保留现场细节/);
  assert.match(guidedPayload.text, /重点看动作细节/);
  assert.match(guidedPayload.rubricText, /不要求使用修辞/);
  assert.match(guidedPayload.referenceAnswer, /蚂蚁/);
  assert.equal((await call('POST', `${guidedUrl}/run?classroomId=${room.id}`)).status, 200);
  assert.match(message, /不是唯一答案/);
  assert.match(message, /不改变给分条件/);
  assert.match(message, /评价标准决定达成要求/);
  const collection = objectiveQuestions[0];
  assert.equal((await call('PUT', `/${sheet.id}/answers`, { questionId: collection.id, value: { format: 'choice/v1', selected: ['B'] } }, token)).status, 200);
  assert.equal((await call('POST', `/${sheet.id}/answers/submit`, { questionId: collection.id }, token)).status, 200);
  const collectionUrl = `/${sheet.id}/analysis/${collection.id}`;
  const collectionPayload = await (await call('POST', `${collectionUrl}?classroomId=${room.id}`)).json();
  assert.equal(collectionPayload.analysisMode, 'collection');
  assert.equal((await call('POST', `${collectionUrl}/run?classroomId=${room.id}`)).status, 200);
  assert.match(message, /不把少数选择或个人偏好当成学习困难/);
  assert.ok(!message.includes('本地统计：全对'));
  assert.equal((await (await call('GET', `${guidedUrl}?classroomId=${room.id}`)).json()).stale, false);
  const changed = sheet.content;
  changed.nodes.find((item: { id: string }) => item.id === 'task').children[0].data.analysisFocus = '改为比较学生如何记录颜色变化。';
  await db.worksheet.update({ where: { id: sheet.id }, data: { content: changed } });
  await call('POST', `${guidedUrl}?classroomId=${room.id}`);
  const stale = await (await call('GET', `${guidedUrl}?classroomId=${room.id}`)).json();
  assert.equal(stale.stale, true, '重算统计不应让旧报告的教学依据变成最新');
  assert.match(stale.narrative, /学生提出了不同观察角度/);
  assert.equal(await db.worksheetAnswer.count({ where: { score: { not: null } } }), 0);
  assert.equal((await call('PUT', `/${sheet.id}`, { settings: { ...sheet.settings, gradeLevel: 0 } })).status, 400);
  assert.equal((await call('PUT', `/${sheet.id}`, { settings: { ...sheet.settings, subject: '不存在的学科' } })).status, 400);
  assert.equal((await call('PUT', `/${sheet.id}`, { settings: { ...sheet.settings, gradeLevel: 8, subject: '英语' } })).status, 200);
  const updated = await (await call('GET', `/${sheet.id}`)).json();
  assert.equal(updated.settings.gradeLevel, 8);
  assert.equal(updated.settings.subject, '英语');
  const newPayload = await (await call('POST', `${guidedUrl}?classroomId=${room.id}`)).json();
  assert.match(newPayload.context, /适用年级：初中八年级/);
  assert.match(newPayload.context, /学科：英语/);
  assert.equal(newPayload.stale, true);
  assert.equal((await call('PUT', `/${sheet.id}`, { settings: { analysisAgentId: agent.id } })).status, 200);
  const fromLegacyClient = await (await call('GET', `/${sheet.id}`)).json();
  assert.equal(fromLegacyClient.settings.gradeLevel, 8, '旧客户端未传新字段时不应清除适用对象');
  assert.equal(fromLegacyClient.settings.subject, '英语');


});
