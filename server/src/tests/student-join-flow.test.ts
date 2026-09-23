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
    // 本课堂没有任何 ClassroomModule 行（老课堂升级后的常态）：GET /code/:code 仍须下发三个默认态。
    classroomModule: {
      findMany: async () => [],
    },
    // 本课堂没有关联任何探究空间网页：GET /code/:code 仍须下发 webapps: [] 而不是省略/报错。
    classroomWebapp: {
      findMany: async () => [],
    },
    // 课堂级学习单（P1）：与上一条同理 —— 没关联就下发 worksheets: []。
    // ⚠️ 它是**标准 / 分组模式**下学生知道「老师布置了哪一份」的唯一来源（那两种模式的
    // `groups[]` 里没有材料行，standard 下 `groups` 甚至是 undefined）。
    classroomWorksheet: {
      findMany: async () => [],
    },
    classroomStudent: {
      findFirst: async ({ where }: { where: { classroomId: string; id: string } }) =>
        where.classroomId === 'classroom-1' && where.id === 'membership-1' ? { id: 'membership-1' } : null,
      findMany: async () => [
        {
          id: 'membership-10', type: 'student', studentId: 'student-10',
          student: { id: 'student-10', name: '十号', studentNo: '10', gender: 'girl', avatarId: null, tag: null },
          groupId: null, group: null, status: 'offline',
        },
        {
          id: 'membership-1', type: 'student', studentId: 'student-1',
          student: { id: 'student-1', name: '小林', studentNo: '1', gender: 'boy', avatarId: 7, tag: null },
          groupId: null, group: null, status: 'offline',
        },
        {
          id: 'membership-2', type: 'student', studentId: 'student-2',
          student: { id: 'student-2', name: '二号', studentNo: '2', gender: 'boy', avatarId: null, tag: null },
          groupId: null, group: null, status: 'offline',
        },
      ],
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
    // 三态随课堂信息一起下发，缺失的行按 MODULE_KEYS 补齐为默认态 preview。
    modules: [
      { moduleKey: 'learning-sheet', state: 'preview' },
      { moduleKey: 'explorer', state: 'preview' },
      { moduleKey: 'companion', state: 'preview' },
    ],
    // 探究空间：只发 id / name / entryPath，不含任何磁盘路径（本课堂未关联任何网页，空数组）。
    webapps: [],
    // 课堂级学习单：只发 id / title（本课堂未关联，空数组）。形状与组级那份一致。
    worksheets: [],
    agents: [{ id: 'agent-1', name: '语文助手', logo: null, platform: 'coze', enabled: true, greeting: null }],
  });

  const studentsResponse = await fetch(`${baseUrl}/classroom-1/students`);
  assert.equal(studentsResponse.status, 200);
  assert.deepEqual(await studentsResponse.json(), [
    { id: 'membership-1', participantType: 'student', studentId: 'student-1', name: '小林', studentNo: null, gender: null, avatarId: 7, groupId: null, status: 'offline' },
    { id: 'membership-2', participantType: 'student', studentId: 'student-2', name: '二号', studentNo: null, gender: null, avatarId: null, groupId: null, status: 'offline' },
    { id: 'membership-10', participantType: 'student', studentId: 'student-10', name: '十号', studentNo: null, gender: null, avatarId: null, groupId: null, status: 'offline' },
  ]);

  const sessionResponse = await fetch(`${baseUrl}/code/1234/student-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'membership-1' }),
  });
  assert.equal(sessionResponse.status, 200);
  const { token } = await sessionResponse.json() as { token: string };
  const session = verifyStudentToken(token);
  assert.equal(session?.classroomId, 'classroom-1');
  assert.equal(session?.studentId, 'membership-1');

  const deniedResponse = await fetch(`${baseUrl}/code/1234/student-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'student-not-in-classroom' }),
  });
  assert.equal(deniedResponse.status, 403);
  assert.deepEqual(await deniedResponse.json(), { error: '该参与者不属于当前课堂' });

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
    body: JSON.stringify({ studentId: 'membership-1' }),
  });
  assert.equal(endedSessionResponse.status, 404);
  assert.deepEqual(await endedSessionResponse.json(), { error: '课堂不存在或已结束' });
  classroom.status = 'active';
});

/**
 * `GET /code/:code` 的 `worksheets` 与 `webapps` 一样是**读路径不可失败**的：
 * 老库（启动时的补表 DDL 被跳过 ⇒ `ClassroomWorksheet` 模型整个不存在）下必须
 * 降级成空数组，**绝不能**因为查不到学习单把学生挡在课堂门外。
 *
 * 🔴 这里的替身**刻意不给** `classroomWorksheet` —— 于是 `prisma.classroomWorksheet.findMany`
 * 在同步求值时抛 TypeError（「模型整个不存在」时 Prisma 是**同步**抛，而不是拒绝一个 Promise）。
 * 用 `.catch()` 接不住这一种，只有 try/catch 能接住 —— 这正是 `loadClassroomWorksheets`
 * 里那段注释写明的取舍，本条用例是它的判据。
 */
test('老库缺 ClassroomWorksheet 模型：GET /code/:code 仍 200，worksheets 降级为空数组', async (t) => {
  const app = express();
  app.use(express.json());
  app.set('prisma', {
    classroom: {
      findUnique: async ({ where }: { where: { code?: string } }) =>
        where.code === '1234' ? classroom : null,
    },
    classroomModule: { findMany: async () => [] },
    classroomWebapp: { findMany: async () => [] },
    // ⚠️ 故意没有 classroomWorksheet。
  });
  app.use(classroomRoutes);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/code/1234`);
  assert.equal(response.status, 200, '读路径不可失败 —— 不能因为缺表把学生挡在门外');
  const body = await response.json() as { worksheets?: unknown; webapps?: unknown };
  assert.deepEqual(body.worksheets, [], '降级为空数组，而不是省略这个键');
  assert.deepEqual(body.webapps, [], '与 webapps 同款');
});
