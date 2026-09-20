import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';

/** 收集到的广播调用，用于断言「发给谁、什么事件、什么载荷」。 */
type Emitted = { room: string; event: string; payload: unknown };

/**
 * 手写 prisma mock：只实现本端点会调到的方法。
 * `writes` 记录所有写库调用，非法输入用例断言它必须为空。
 */
function createHarness(options: { classroom: unknown }) {
  const emits: Emitted[] = [];
  const writes: unknown[] = [];
  const prisma = {
    classroom: {
      findUnique: async () => options.classroom,
    },
    classroomModule: {
      upsert: async (args: unknown) => {
        writes.push(args);
        return { id: 'module-row-1' };
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ room, event, payload });
      },
    }),
  });
  app.use(classroomRoutes);
  return { app, emits, writes };
}

async function startServer(t: { after: (fn: () => void) => void }, options: { classroom: unknown }) {
  const harness = createHarness(options);
  const server = createServer(harness.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  return { ...harness, baseUrl: `http://127.0.0.1:${address.port}` };
}

function putState(baseUrl: string, moduleKey: string, body: unknown) {
  return fetch(`${baseUrl}/classroom-1/modules/${moduleKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('合法请求返回目标态，并按复合键 classroomId_moduleKey 落库', async (t) => {
  const { baseUrl, writes } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const response = await putState(baseUrl, 'explorer', { state: 'open' });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { moduleKey: 'explorer', state: 'open' });
  assert.deepEqual(writes, [{
    where: { classroomId_moduleKey: { classroomId: 'classroom-1', moduleKey: 'explorer' } },
    create: { classroomId: 'classroom-1', moduleKey: 'explorer', state: 'open' },
    update: { state: 'open' },
  }]);
});

test('状态变更向 classroom:<id> 与 teacher:<id> 双发广播', async (t) => {
  const { baseUrl, emits } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const response = await putState(baseUrl, 'learning-sheet', { state: 'hidden' });

  assert.equal(response.status, 200);
  assert.equal(emits.length, 2);
  assert.deepEqual(emits, [
    { room: 'classroom:classroom-1', event: 'module-state-changed', payload: { moduleKey: 'learning-sheet', state: 'hidden' } },
    { room: 'teacher:classroom-1', event: 'module-state-changed', payload: { moduleKey: 'learning-sheet', state: 'hidden' } },
  ]);
});

test('非法 moduleKey 返回 400，且不写库、不广播', async (t) => {
  const { baseUrl, emits, writes } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const response = await putState(baseUrl, 'worksheet', { state: 'open' });

  assert.equal(response.status, 400);
  assert.deepEqual(writes, []);
  assert.deepEqual(emits, []);
});

test('非法 state 返回 400，且不写库、不广播', async (t) => {
  const { baseUrl, emits, writes } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const response = await putState(baseUrl, 'companion', { state: 'locked' });

  assert.equal(response.status, 400);
  assert.deepEqual(writes, []);
  assert.deepEqual(emits, []);
});

test('缺少 state 字段返回 400，且不写库、不广播', async (t) => {
  const { baseUrl, emits, writes } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const response = await putState(baseUrl, 'companion', {});

  assert.equal(response.status, 400);
  assert.deepEqual(writes, []);
  assert.deepEqual(emits, []);
});

test('课堂不存在返回 404，且不写库、不广播', async (t) => {
  const { baseUrl, emits, writes } = await startServer(t, { classroom: null });

  const response = await putState(baseUrl, 'companion', { state: 'open' });

  assert.equal(response.status, 404);
  assert.deepEqual(writes, []);
  assert.deepEqual(emits, []);
});

test('重复提交同一状态幂等：两次都返回 200 并各自广播', async (t) => {
  const { baseUrl, emits, writes } = await startServer(t, { classroom: { id: 'classroom-1' } });

  const first = await putState(baseUrl, 'companion', { state: 'preview' });
  const second = await putState(baseUrl, 'companion', { state: 'preview' });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), { moduleKey: 'companion', state: 'preview' });
  assert.deepEqual(await second.json(), { moduleKey: 'companion', state: 'preview' });
  assert.equal(writes.length, 2);
  assert.deepEqual(emits.map(({ room }) => room), [
    'classroom:classroom-1', 'teacher:classroom-1',
    'classroom:classroom-1', 'teacher:classroom-1',
  ]);
});
