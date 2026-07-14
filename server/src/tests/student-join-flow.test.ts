import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';
import { verifyStudentToken } from '../middleware/student-auth.js';

const classroom = {
  id: 'classroom-1',
  code: '1234',
  title: '语文互动课',
  mode: 'standard',
  status: 'active',
  allowStudentStop: true,
  allowStudentExport: true,
  classroomAgents: [{ agent: { id: 'agent-1', name: '语文助手', logo: null, platform: 'coze', enabled: true, greeting: null } }],
  groups: [],
};

test('student join flow exposes a minimal roster and issues a classroom-bound session', async (t) => {
  const app = express();
  app.use(express.json());
  app.set('prisma', {
    classroom: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
        where.code === '1234' || where.id === 'classroom-1' ? classroom : null,
    },
    classroomStudent: {
      findFirst: async ({ where }: { where: { classroomId: string; studentId: string } }) =>
        where.classroomId === 'classroom-1' && where.studentId === 'student-1' ? { id: 'membership-1' } : null,
      findMany: async () => [{
        student: { id: 'student-1', name: '小林', studentNo: '202601', gender: 'boy', avatarId: 7, tag: null },
        groupId: null,
        group: null,
        status: 'offline',
      }],
    },
  });
  app.use(classroomRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const classroomResponse = await fetch(`${baseUrl}/code/1234`);
  assert.equal(classroomResponse.status, 200);
  assert.deepEqual(await classroomResponse.json(), {
    id: 'classroom-1',
    code: '1234',
    title: '语文互动课',
    mode: 'standard',
    status: 'active',
    allowStudentStop: true,
    allowStudentExport: true,
    agents: [{ id: 'agent-1', name: '语文助手', logo: null, platform: 'coze', enabled: true, greeting: null }],
  });

  const studentsResponse = await fetch(`${baseUrl}/classroom-1/students`);
  assert.equal(studentsResponse.status, 200);
  assert.deepEqual(await studentsResponse.json(), [{
    id: 'student-1', name: '小林', studentNo: null, gender: null, avatarId: 7, groupId: null, status: 'offline',
  }]);

  const sessionResponse = await fetch(`${baseUrl}/code/1234/student-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'student-1' }),
  });
  assert.equal(sessionResponse.status, 200);
  const { token } = await sessionResponse.json() as { token: string };
  const session = verifyStudentToken(token);
  assert.equal(session?.classroomId, 'classroom-1');
  assert.equal(session?.studentId, 'student-1');

  const deniedResponse = await fetch(`${baseUrl}/code/1234/student-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'student-not-in-classroom' }),
  });
  assert.equal(deniedResponse.status, 403);
  assert.deepEqual(await deniedResponse.json(), { error: '该学生不属于当前课堂' });

  // 暂停课堂仍允许学生断线重连；只有结束后才应彻底关闭公开入口。
  classroom.status = 'ended';
  const endedClassroomResponse = await fetch(`${baseUrl}/code/1234`);
  assert.equal(endedClassroomResponse.status, 400);
  assert.deepEqual(await endedClassroomResponse.json(), { error: '课堂已结束' });

  const endedStudentsResponse = await fetch(`${baseUrl}/classroom-1/students`);
  assert.equal(endedStudentsResponse.status, 404);
  assert.deepEqual(await endedStudentsResponse.json(), { error: '课堂不存在或已结束' });

  const endedSessionResponse = await fetch(`${baseUrl}/code/1234/student-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'student-1' }),
  });
  assert.equal(endedSessionResponse.status, 404);
  assert.deepEqual(await endedSessionResponse.json(), { error: '课堂不存在或已结束' });
  classroom.status = 'active';
});
