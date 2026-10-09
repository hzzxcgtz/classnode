import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import classroomRoutes, { classroomAccessGate } from '../routes/classroom.js';
import avatarsRoutes from '../routes/avatars.js';
import { createStudentToken } from '../middleware/student-auth.js';
import { createTeacherSession } from '../middleware/auth.js';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

// The complete gate + router + Prisma query must be exercised together.
test('notifications are scoped by verified identity; old avatar rows stay inert on route reads', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-notification-privacy-'));
  const url = `file:${path.join(root, 'test.db')}`;
  prepareTemporarySqliteFile(url);
  execFileSync(path.resolve(here, '../../node_modules/.bin/prisma'), ['db', 'push', '--skip-generate', `--schema=${path.resolve(here, '../../prisma/schema.prisma')}`], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const app = express();
  app.set('prisma', prisma);
  app.use(express.json());
  app.post('/login', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); });
  app.use('/api/classroom', classroomAccessGate, classroomRoutes);
  app.use('/api/avatars', avatarsRoutes);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const klass = await prisma.class.create({ data: { name: 'privacy' } });
    const classroom = await prisma.classroom.create({ data: { title: 'privacy' } });
    const otherClassroom = await prisma.classroom.create({ data: { title: 'other' } });
    const alice = await prisma.student.create({ data: { name: 'Alice', classId: klass.id, avatarChangeTokens: 1 } });
    const bob = await prisma.student.create({ data: { name: 'Bob', classId: klass.id } });
    const a = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, studentId: alice.id } });
    const b = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, studentId: bob.id } });
    const groupA = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: 'A' } });
    const groupB = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: 'B' } });
    const ga = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, groupId: groupA.id, type: 'group' } });
    const gb = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, groupId: groupB.id, type: 'group' } });
    await prisma.teacherNotification.createMany({ data: [
      { classroomId: classroom.id, content: 'broadcast' },
      { classroomId: classroom.id, studentId: a.id, content: 'alice' },
      { classroomId: classroom.id, studentId: alice.id, content: 'alice-legacy' },
      { classroomId: classroom.id, studentId: b.id, content: 'bob' },
      { classroomId: classroom.id, studentId: bob.id, content: 'bob-legacy' },
      { classroomId: classroom.id, groupId: groupA.id, content: 'group-a-legacy' },
      { classroomId: classroom.id, groupId: groupB.id, content: 'group-b-legacy' },
      { classroomId: classroom.id, groupId: groupA.id, studentId: ga.id, content: 'group-a-current' },
      { classroomId: classroom.id, groupId: groupB.id, studentId: gb.id, content: 'group-b-current' },
      { classroomId: otherClassroom.id, content: 'other-classroom' },
    ] });
    const endpoint = `${base}/api/classroom/${classroom.id}/notifications`;
    const headers = (id: string) => ({ Authorization: `Bearer ${createStudentToken(classroom.id, id)}` });
    const expected = new Map([
      [a.id, ['alice', 'alice-legacy', 'broadcast']], [b.id, ['bob', 'bob-legacy', 'broadcast']],
      [ga.id, ['broadcast', 'group-a-current', 'group-a-legacy']], [gb.id, ['broadcast', 'group-b-current', 'group-b-legacy']],
    ]);
    for (const [id, contents] of expected) {
      for (const query of ['', `?studentId=${id}`]) {
        const response = await fetch(endpoint + query, { headers: headers(id) });
        assert.equal(response.status, 200);
        const result = await response.json() as { content: string }[];
        assert.deepEqual(result.map(row => row.content).sort(), contents.sort());
      }
      const other = id === a.id ? b.id : a.id;
      assert.equal((await fetch(`${endpoint}?studentId=${other}`, { headers: headers(id) })).status, 403);
      assert.equal((await fetch(`${base}/api/classroom/${otherClassroom.id}/notifications`, { headers: headers(id) })).status, 401);
    }
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: headers('missing-participant') })).status, 403);
    const teacherCookie = (await fetch(`${base}/login`, { method: 'POST' })).headers.get('set-cookie')!.split(';')[0];
    const teacherHeaders = { Cookie: teacherCookie };
    const teacherResult = await fetch(endpoint, { headers: teacherHeaders });
    assert.equal(teacherResult.status, 200);
    assert.equal((await teacherResult.json() as unknown[]).length, 9);
    const teacherScope = await fetch(`${endpoint}?studentId=${ga.id}`, { headers: teacherHeaders });
    assert.deepEqual((await teacherScope.json() as { content: string }[]).map(row => row.content).sort(), expected.get(ga.id));
    assert.equal((await fetch(`${endpoint}?studentId[]=x`, { headers: teacherHeaders })).status, 400);
    // Verify the limit is applied after privacy filtering (foreign notifications cannot crowd ours out).
    await prisma.teacherNotification.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ classroomId: classroom.id, studentId: b.id, content: `foreign-${i}` })) });
    assert.equal((await (await fetch(endpoint, { headers: headers(a.id) })).json() as unknown[]).length, 3);
    await prisma.classroomStudent.delete({ where: { id: a.id } });
    assert.equal((await fetch(endpoint, { headers: headers(a.id) })).status, 403);

    const old = await prisma.avatar.create({ data: { category: 'student', source: 'teacher', svgContent: '<svg><a href="&#106;avascript:alert(1)"><text>click</text></a></svg>' } });
    for (const route of ['', '/all', '/all-including-student']) {
      const response = await fetch(`${base}/api/avatars${route}`, { headers: teacherHeaders });
      assert.equal(response.status, 200);
      const avatars = await response.json() as { id: number; svgContent: string }[];
      assert.doesNotMatch(avatars.find(row => row.id === old.id)!.svgContent, /<a |javascript/);
    }
    assert.equal((await prisma.avatar.findUniqueOrThrow({ where: { id: old.id } })).svgContent, old.svgContent);
    let pushed: { svgContent: string } | undefined;
    app.set('io', { to: () => ({ emit: (_event: string, payload: { svgContent: string }) => { pushed = payload; } }) });
    await prisma.classroomStudent.create({ data: { classroomId: classroom.id, studentId: alice.id } });
    const selfChanged = await fetch(`${base}/api/avatars/student-self/${alice.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarId: old.id }) });
    assert.equal(selfChanged.status, 200);
    assert.doesNotMatch((await selfChanged.json() as { svgContent: string }).svgContent, /<a |javascript/);
    assert.ok(pushed);
    assert.doesNotMatch(pushed.svgContent, /<a |javascript/);
    const edited = await fetch(`${base}/api/avatars/${old.id}`, { method: 'PUT', headers: { ...teacherHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ gender: 'neutral' }) });
    assert.equal(edited.status, 200);
    assert.doesNotMatch((await edited.json() as { svgContent: string }).svgContent, /<a |javascript/);
    for (const method of ['POST', 'PUT']) {
      const response = await fetch(`${base}/api/avatars${method === 'PUT' ? `/${old.id}` : ''}`, { method, headers: { ...teacherHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ svgContent: old.svgContent, category: 'student' }) });
      assert.equal(response.status, 400);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
