import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';
import { verifyStudentToken } from '../middleware/student-auth.js';

test('group classroom exposes a group participant without a virtual Student', async (t) => {
  const app = express();
  app.use(express.json());
  app.set('prisma', {
    classroom: {
      findUnique: async () => ({
        id: 'group-classroom', code: '2468', title: '小组探究', mode: 'group', status: 'active',
        allowStudentStop: true, allowStudentExport: true,
        classroomAgents: [], groups: [{ id: 'group-a', name: '探索组', agent: { id: 'agent-a', name: '探究助手', logo: null, platform: 'coze', enabled: true, greeting: null } }],
      }),
    },
    classroomStudent: {
      findFirst: async ({ where }: { where: { id: string; classroomId: string } }) =>
        where.id === 'participant-group-a' && where.classroomId === 'group-classroom' ? { id: 'participant-group-a' } : null,
      findMany: async () => [{
        id: 'participant-group-a', type: 'group', studentId: null, student: null,
        groupId: 'group-a', group: { id: 'group-a', name: '探索组' }, status: 'offline',
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

  const roster = await fetch(`${baseUrl}/group-classroom/students`);
  assert.deepEqual(await roster.json(), [{
    id: 'participant-group-a', participantType: 'group', studentId: null,
    name: '探索组', studentNo: null, gender: null, avatarId: null,
    groupId: 'group-a', groupName: '探索组', status: 'offline',
  }]);

  const sessionResponse = await fetch(`${baseUrl}/code/2468/student-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'participant-group-a' }),
  });
  assert.equal(sessionResponse.status, 200);
  const { token } = await sessionResponse.json() as { token: string };
  assert.equal(verifyStudentToken(token)?.studentId, 'participant-group-a');
});

test('syncing an active group classroom refreshes rosters and creates newly added groups', async (t) => {
  const deletedSnapshots: string[] = [];
  const createdSnapshots: Array<{ groupId: string; studentId: string }> = [];
  const tx = {
    classroom: {
      findUnique: async () => ({
        id: 'classroom-1', mode: 'group', status: 'active',
        classes: [{ classId: 'class-1' }],
        classroomAgents: [{ agentId: 'agent-default' }],
        groups: [{ id: 'classroom-group-old', name: '旧组名', agentId: 'agent-default', sourceClassGroupId: 'source-1' }],
      }),
    },
    classGroup: {
      findMany: async () => [
        { id: 'source-1', name: '第一组', studentIds: '["student-1"]' },
        { id: 'source-2', name: '第二组', studentIds: '["student-2"]' },
      ],
    },
    student: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({
        id, name: id === 'student-1' ? '小明' : '小红', studentNo: id === 'student-1' ? '01' : '02',
      })),
    },
    classroomGroup: {
      update: async () => ({}),
      create: async () => ({ id: 'classroom-group-new' }),
    },
    classroomStudent: { create: async () => ({ id: 'participant-new' }) },
    interaction: { create: async () => ({}) },
    classroomGroupMember: {
      deleteMany: async ({ where }: { where: { groupId: string } }) => { deletedSnapshots.push(where.groupId); },
      createMany: async ({ data }: { data: Array<{ groupId: string; studentId: string }> }) => { createdSnapshots.push(...data); },
    },
  };
  const app = express();
  app.use(express.json());
  app.set('prisma', { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) });
  app.set('io', { to: () => ({ emit: () => undefined }) });
  app.use(classroomRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/classroom-1/sync-groups`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, addedGroups: 1, updatedGroups: 1, sourceGroupCount: 2 });
  assert.deepEqual(deletedSnapshots, ['classroom-group-old', 'classroom-group-new']);
  assert.deepEqual(createdSnapshots.map(({ groupId, studentId }) => ({ groupId, studentId })), [
    { groupId: 'classroom-group-old', studentId: 'student-1' },
    { groupId: 'classroom-group-new', studentId: 'student-2' },
  ]);
});
