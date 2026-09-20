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
 * `modules` 是 classroomModule.findMany 的返回值 —— 两个读端点都用它拼三态。
 * `modulesError` 让 findMany 抛错，模拟「ClassroomModule 表不存在」（老库启动 DDL 被跳过）。
 */
function createHarness(options: { classroom: unknown; modules?: unknown[]; modulesError?: boolean }) {
  const emits: Emitted[] = [];
  const writes: unknown[] = [];
  const prisma = {
    classroom: {
      findUnique: async () => options.classroom,
    },
    classroomModule: {
      findMany: async () => {
        if (options.modulesError) throw new Error('no such table: ClassroomModule');
        return options.modules ?? [];
      },
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

async function startServer(
  t: { after: (fn: () => void) => void },
  options: { classroom: unknown; modules?: unknown[]; modulesError?: boolean },
) {
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

// ---------------------------------------------------------------------------
// 读路径：学生端 GET /code/:code 与教师端 GET /:id 都必须下发完整三态。
// 写入端点只为被设置的那一个模块建行，老课堂更是零行，所以两条路径都必须
// 按 MODULE_KEYS 补齐 —— 这三个用例（0 / 1~2 / 3 行）就是为这条兜底写的。
// ---------------------------------------------------------------------------

/** 三个 key 的期望顺序，与 MODULE_KEYS 一致。 */
const ALL_MODULE_KEYS = ['learning-sheet', 'explorer', 'companion'];

/** 学生端 GET /code/:code 会展开 classroomAgents / groups，故 mock 需带上空数组。 */
function studentClassroom() {
  return {
    id: 'classroom-1',
    code: '1234',
    title: '测试课堂',
    mode: 'standard',
    status: 'active',
    allowStudentStop: false,
    allowStudentExport: false,
    classroomAgents: [],
    groups: [],
  };
}

/** 教师端 GET /:id 在响应前会遍历 students / groups。 */
function teacherClassroom() {
  return { ...studentClassroom(), classes: [], students: [] };
}

function getByCode(baseUrl: string, code: string) {
  return fetch(`${baseUrl}/code/${code}`);
}

function getClassroom(baseUrl: string, id: string) {
  return fetch(`${baseUrl}/${id}`);
}

test('学生端：课堂没有任何模块行时仍返回三个 key，且全部为默认态', async (t) => {
  const { baseUrl } = await startServer(t, { classroom: studentClassroom(), modules: [] });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.modules.length, 3);
  assert.deepEqual(body.modules, ALL_MODULE_KEYS.map(moduleKey => ({ moduleKey, state: 'preview' })));
});

test('学生端：三个模块都有记录时返回各自的态', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: studentClassroom(),
    modules: [
      { moduleKey: 'learning-sheet', state: 'hidden' },
      { moduleKey: 'explorer', state: 'open' },
      { moduleKey: 'companion', state: 'preview' },
    ],
  });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).modules, [
    { moduleKey: 'learning-sheet', state: 'hidden' },
    { moduleKey: 'explorer', state: 'open' },
    { moduleKey: 'companion', state: 'preview' },
  ]);
});

test('学生端：只有部分记录时，缺失的 key 用默认态补齐', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: studentClassroom(),
    modules: [{ moduleKey: 'explorer', state: 'open' }],
  });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).modules, [
    { moduleKey: 'learning-sheet', state: 'preview' },
    { moduleKey: 'explorer', state: 'open' },
    { moduleKey: 'companion', state: 'preview' },
  ]);
});

test('学生端：库里的态非法时退回默认态，不把脏数据下发给学生', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: studentClassroom(),
    modules: [{ moduleKey: 'companion', state: 'locked' }],
  });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).modules, [
    { moduleKey: 'learning-sheet', state: 'preview' },
    { moduleKey: 'explorer', state: 'preview' },
    { moduleKey: 'companion', state: 'preview' },
  ]);
});

test('教师端：课堂没有任何模块行时仍返回三个 key，且全部为默认态', async (t) => {
  const { baseUrl } = await startServer(t, { classroom: teacherClassroom(), modules: [] });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.modules.length, 3);
  assert.deepEqual(body.modules, ALL_MODULE_KEYS.map(moduleKey => ({ moduleKey, state: 'preview' })));
});

test('教师端：三个模块都有记录时返回各自的态', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: teacherClassroom(),
    modules: [
      { moduleKey: 'learning-sheet', state: 'open' },
      { moduleKey: 'explorer', state: 'hidden' },
      { moduleKey: 'companion', state: 'open' },
    ],
  });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).modules, [
    { moduleKey: 'learning-sheet', state: 'open' },
    { moduleKey: 'explorer', state: 'hidden' },
    { moduleKey: 'companion', state: 'open' },
  ]);
});

test('教师端：只有部分记录时，缺失的 key 用默认态补齐', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: teacherClassroom(),
    modules: [{ moduleKey: 'learning-sheet', state: 'hidden' }],
  });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).modules, [
    { moduleKey: 'learning-sheet', state: 'hidden' },
    { moduleKey: 'explorer', state: 'preview' },
    { moduleKey: 'companion', state: 'preview' },
  ]);
});

test('两个读端点在同样的记录下给出同一份三态', async (t) => {
  const modules = [{ moduleKey: 'companion', state: 'hidden' }];
  const student = await startServer(t, { classroom: studentClassroom(), modules });
  const teacher = await startServer(t, { classroom: teacherClassroom(), modules });

  const studentBody = await (await getByCode(student.baseUrl, '1234')).json();
  const teacherBody = await (await getClassroom(teacher.baseUrl, 'classroom-1')).json();

  assert.deepEqual(studentBody.modules, teacherBody.modules);
  assert.deepEqual(teacherBody.modules, [
    { moduleKey: 'learning-sheet', state: 'preview' },
    { moduleKey: 'explorer', state: 'preview' },
    { moduleKey: 'companion', state: 'hidden' },
  ]);
});

// ---------------------------------------------------------------------------
// 读路径不可失败：ClassroomModule 表不存在时（老库启动 DDL 被跳过）也必须降级，
// 而不是把学生挡在课堂门外。三态本身可以退化成「都可见但锁定」，进不来不行。
// ---------------------------------------------------------------------------

test('学生端：模块表查询抛错时仍返回 200，三态降级为三个默认态', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: studentClassroom(),
    modulesError: true,
  });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 'classroom-1');
  assert.equal(body.modules.length, 3);
  assert.deepEqual(body.modules, ALL_MODULE_KEYS.map(moduleKey => ({ moduleKey, state: 'preview' })));
});

test('教师端：模块表查询抛错时仍返回 200，三态降级为三个默认态', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: teacherClassroom(),
    modulesError: true,
  });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 'classroom-1');
  assert.equal(body.modules.length, 3);
  assert.deepEqual(body.modules, ALL_MODULE_KEYS.map(moduleKey => ({ moduleKey, state: 'preview' })));
});

// ---------------------------------------------------------------------------
// hasModuleRows：教师端的模块菜单要区分「教师把三项都设成了预告」与「这个课堂从未设置过」，
// 而 mergeModuleStates 会把两种情况补齐成**一模一样**的 modules（都是三个 preview），
// 前端单看 modules 分不出来 —— 这就是这个派生量存在的理由。它只为教师端 GET /:id 服务。
// ---------------------------------------------------------------------------

test('教师端：课堂没有模块行时 hasModuleRows 为 false', async (t) => {
  const { baseUrl } = await startServer(t, { classroom: teacherClassroom(), modules: [] });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  assert.equal((await response.json()).hasModuleRows, false);
});

test('教师端：有模块行时 hasModuleRows 为 true，哪怕三态与补齐后的默认态完全相同', async (t) => {
  const { baseUrl } = await startServer(t, {
    classroom: teacherClassroom(),
    modules: [{ moduleKey: 'companion', state: 'preview' }],
  });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hasModuleRows, true);
  // 只有一行、且态就是默认态：modules 与上一用例（零行）逐字相同，
  // 唯一的区别只在这个字段里 —— 少了它前端就会把「显式设成预告」说成「从未设置过」。
  assert.deepEqual(body.modules, ALL_MODULE_KEYS.map(moduleKey => ({ moduleKey, state: 'preview' })));
});

test('教师端：模块表查询抛错时不下发 hasModuleRows，不把「读不到」说成「没有」', async (t) => {
  const { baseUrl } = await startServer(t, { classroom: teacherClassroom(), modulesError: true });

  const response = await getClassroom(baseUrl, 'classroom-1');

  assert.equal(response.status, 200);
  assert.equal('hasModuleRows' in (await response.json()), false);
});

test('学生端：响应里没有 hasModuleRows，教师端的菜单提示不该泄漏给学生', async (t) => {
  const { baseUrl } = await startServer(t, { classroom: studentClassroom(), modules: [] });

  const response = await getByCode(baseUrl, '1234');

  assert.equal(response.status, 200);
  assert.equal('hasModuleRows' in (await response.json()), false);
});
