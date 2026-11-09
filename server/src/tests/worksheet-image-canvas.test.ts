import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createDatabaseClient } from '../services/database-client.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import { readImageCanvas } from '../services/worksheet-image-canvas.js';

const image = '/uploads/chat/chat-11111111-1111-4111-8111-111111111111.png';
const answer = { id: 'answer', kind: 'answer', x: 12, y: 74, width: 76, height: 16, label: '给同桌录音', detail: '' };
const hint = { id: 'hint', kind: 'hint', x: 40, y: 45, width: 22, height: 6, label: '西沙群岛', detail: '位于南海西北部。' };
const canvas = { url: image, width: 1200, height: 1600, widgets: [answer, hint] };

test('整图布局拒绝越界、重复作答区和非本地图片', () => {
  assert.deepEqual(readImageCanvas(canvas), canvas);
  assert.equal(readImageCanvas({ ...canvas, url: 'https://example.com/test.png' }), null);
  assert.equal(readImageCanvas({ ...canvas, widgets: [{ ...answer, x: 90 }] }), null);
  assert.equal(readImageCanvas({ ...canvas, widgets: [answer, { ...answer, id: 'another' }] }), null);
});

test('整图任务可保存并投影给学生，同桌录音评星随实名作答提交并保留录音版本', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-image-canvas-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  const prisma = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));
  const schema = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
  execFileSync(process.execPath, [prisma, 'db', 'push', '--skip-generate', '--schema', schema],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = createDatabaseClient(url);
  const app = express();
  app.use(express.json());
  app.set('prisma', db);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let cookie = '';
  createTeacherSession({ setHeader: (_name: string, value: string) => { cookie = value.split(';')[0]; } } as never);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/worksheets`;
  const call = (method: string, path: string, body?: unknown, token?: string) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const node = { id: 'q', type: 'short-answer', inputMode: 'audio', prompt: '海底住着谁', children: [],
    data: { imageCanvas: canvas, deskReview: { maxStars: 3, instruction: '听一听，有没有说清特点？' }, aiScoringEnabled: true } };
  const content = { schemaVersion: 1, nodes: [node] };
  const created = await call('POST', '', { title: '海底导览', content, settings: { allowResubmit: true } });
  assert.equal(created.status, 200, await created.clone().text());
  const sheet = await created.json();
  assert.equal(sheet.content.nodes[0].data.evaluationMode, 'collect');
  const room = await db.classroom.create({ data: { status: 'active', mode: 'standard' } });
  await db.classroomWorksheet.create({ data: { classroomId: room.id, worksheetId: sheet.id } });
  const klass = await db.class.create({ data: { name: '示例班' } });
  const student = await db.student.create({ data: { classId: klass.id, name: '示例学生' } });
  const user = await db.classroomStudent.create({ data: { classroomId: room.id, studentId: student.id, type: 'student' } });
  const token = createStudentToken(room.id, user.id);
  const group = await db.classroomStudent.create({ data: { classroomId: room.id, type: 'group' } });
  const groupToken = createStudentToken(room.id, group.id);
  const root = `/${sheet.id}`;
  const view = await (await call('GET', root + '/student-view', undefined, token)).json();
  assert.deepEqual(view.content.nodes[0].data.imageCanvas, canvas);
  assert.equal(view.content.nodes[0].data.deskReview.maxStars, 3);
  const audio = { format: 'audio/v1', url: '/uploads/chat/chat-22222222-2222-4222-8222-222222222222.ogg', durationMs: 3000 };
  const save = (value: unknown, who = token) => call('PUT', root + '/answers', { questionId: 'q', value }, who);
  const submit = () => call('POST', root + '/answers/submit', { questionId: 'q' }, token);
  assert.equal((await save(audio, groupToken)).status, 403);
  assert.equal((await save(audio)).status, 200);
  const incomplete = await submit();
  assert.equal(incomplete.status, 409);
  assert.equal((await incomplete.json()).code, 'desk-rating-required');
  assert.equal((await save({ ...audio, deskRating: { stars: 4, maxStars: 3 } })).status, 400);
  const first = { ...audio, deskRating: { stars: 2, maxStars: 3 } };
  assert.equal((await save(first)).status, 200);
  assert.equal((await submit()).status, 200);
  const own = await (await call('GET', root + '/answers', undefined, token)).json();
  assert.deepEqual(own.rows[0].value, first);

  const second = { ...first, url: '/uploads/chat/chat-33333333-3333-4333-8333-333333333333.ogg', deskRating: { stars: 3, maxStars: 3 } };
  assert.equal((await save(second)).status, 200);
  assert.equal((await submit()).status, 200);
  const stored = await db.worksheetAnswer.findFirstOrThrow({ include: { response: true, reviews: { orderBy: { createdAt: 'asc' } } } });
  assert.equal(stored.response.participantId, user.id);
  assert.equal(stored.score, null);
  assert.deepEqual(stored.reviews.map(review => review.value), [first, second]);
  assert.ok(stored.reviews.every(review => review.status === 'submitted'));
});
