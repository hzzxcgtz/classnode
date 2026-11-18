import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { createTeacherSession } from '../middleware/auth.js';
import classroomRoutes, { classroomAccessGate } from '../routes/classroom.js';
import { maintenanceGate, trackDataTask } from '../services/data-maintenance.js';
import { createStudentToken, verifyStudentToken } from '../middleware/student-auth.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
test('清空单个课堂：事务清理、配置保留、其他课堂隔离及并发保护', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-clear-classroom-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [path.resolve(here, '../../node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const app = express();
  app.use(express.json(), maintenanceGate);
  app.set('prisma', prisma);
  const http = createServer(app);
  const io = new Server(http);
  app.set('io', io);
  const connections = new Map<string, string>();
  app.set('activeConnections', connections);
  app.post('/login', (_req, res) => { createTeacherSession(res); res.json({}); });
  app.use('/api/classroom', classroomAccessGate, classroomRoutes);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => io.close(() => resolve())); await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/classroom`;
  const login = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}/login`, { method: 'POST' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(`${base}/missing/clear-data`, { method: 'POST' })).status, 401);
  const clear = (id: string, confirm = true) => fetch(`${base}/${id}/clear-data`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ confirm }) });
  const student = await prisma.student.create({ data: { name: '老师' } });
  const worksheet = await prisma.worksheet.create({ data: { title: '保留学习单', content: {}, settings: {} } });
  const webapp = await prisma.webapp.create({ data: { name: '保留网页', entryPath: 'index.html' } });
  const classrooms = [];
  for (const code of ['1111', '2222']) {
    const classroom = await prisma.classroom.create({ data: {
      title: '保留课堂', code, worksheetOpen: { [worksheet.id]: ['q'] },
      worksheets: { create: { worksheetId: worksheet.id } }, webapps: { create: { webappId: webapp.id } },
      students: { create: { studentId: student.id, totalRounds: 3, warningCount: 2, blacklisted: true } },
    }, include: { students: true } });
    const participant = classroom.students[0];
    await prisma.message.create({ data: { classroomId: classroom.id, studentId: participant.id, content: '旧消息', role: 'user' } });
    await prisma.interaction.create({ data: { classroomId: classroom.id, studentId: participant.id, totalRounds: 3 } });
    await prisma.shieldWarning.create({ data: { classroomId: classroom.id, studentId: participant.id, word: 'test' } });
    await prisma.teacherNotification.create({ data: { classroomId: classroom.id, content: '旧通知' } });
    await prisma.webappUsage.create({ data: { classroomId: classroom.id, studentId: participant.id, webappId: webapp.id } });
    await prisma.classroomAnnotation.create({ data: { classroomId: classroom.id, targetKey: 'q', target: '{}', document: {} } });
    await prisma.worksheetResponse.create({ data: { classroomId: classroom.id, participantId: participant.id, worksheetId: worksheet.id, status: 'submitted', answers: { create: { questionId: 'q', value: { text: '旧作答' }, reviews: { create: { requestId: code, generation: 'test', question: {}, maxScore: 3, unit: '分' } } } } } });
    await prisma.worksheetQuestionAnalysis.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, questionId: 'q', aggregate: {}, totalCount: 1, narrative: '旧分析' } });
    connections.set(`${classroom.id}:${participant.id}`, code);
    classrooms.push(classroom);
  }
  const [a, b] = classrooms;
  const tokenA = createStudentToken(a.id, a.students[0].id);
  const tokenB = createStudentToken(b.id, b.students[0].id);
  assert.equal((await clear(a.id, false)).status, 400);
  await trackDataTask(async () => { assert.equal((await clear(a.id)).status, 409); });
  assert.equal(await prisma.message.count(), 2);
  assert.equal((await clear('missing')).status, 404);
  assert.equal((await clear(a.id)).status, 200);
  for (const model of ['message', 'interaction', 'shieldWarning', 'teacherNotification', 'webappUsage', 'classroomAnnotation', 'worksheetResponse', 'worksheetQuestionAnalysis'] as const) {
    const table: { count(args: { where: { classroomId: string } }): Promise<number> } = prisma[model];
    assert.equal(await table.count({ where: { classroomId: a.id } }), 0, model);
    assert.equal(await table.count({ where: { classroomId: b.id } }), 1, model);
  }
  assert.equal(await prisma.worksheetAnswer.count(), 1);
  assert.equal(await prisma.worksheetAnswerReview.count(), 1);
  const kept = await prisma.classroom.findUniqueOrThrow({ where: { id: a.id }, include: { students: true, worksheets: true, webapps: true } });
  assert.equal(kept.code, '1111');
  assert.equal(kept.status, 'active');
  assert.deepEqual(kept.worksheetOpen, a.worksheetOpen);
  assert.equal(kept.worksheets.length, 1);
  assert.equal(kept.webapps.length, 1);
  assert.equal(kept.students[0].studentId, student.id);
  assert.notEqual(kept.students[0].id, a.students[0].id, 'old offline draft queues cannot target the new participation');
  assert.equal(kept.students[0].warningCount, 0);
  assert.equal(kept.students[0].totalRounds, 0);
  assert.equal(kept.students[0].blacklisted, false);
  assert.equal(verifyStudentToken(tokenA), null);
  assert.ok(verifyStudentToken(tokenB));
  assert.equal(connections.size, 1);
  assert.ok(connections.has(`${b.id}:${b.students[0].id}`));
  assert.equal((await clear(a.id)).status, 200, 'repeated clearing remains safe');
});
