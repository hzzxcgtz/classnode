import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';

/**
 * 学习单教师端路由：CRUD / duplicate / usage，以及**分层鉴权**。
 *
 * 三块重点，各自对应一类已经踩过的坑：
 *   ① **删除守卫要数三样**（规格 §5.5）。少数一样不是一个「更宽松的策略」，
 *      而是一个**说谎的 400**：守卫说「没在用」，数据库却因为
 *      `WorksheetResponse_worksheetId_fkey` 是 RESTRICT 而拒绝删除。
 *   ② **duplicate 必须深拷贝**。`content` 是 JSON 树，浅拷贝会让副本与原件
 *      共用同一批嵌套对象 —— 改副本的题干会静默改掉原件。
 *   ③ **鉴权分层**。本路由教师端与学生端混装，中间件放行三种学生形状、
 *      其余一律拦下。这块写错了测试也会全绿（端点本身是好的），
 *      所以下面除了「被拦」还必须有「放行」的阳性对照，两者缺一不可。
 *
 * ⚠️ 这个文件用**真 Prisma + 真 SQLite**（照 classroom-webapp-link.test.ts）。
 * 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，用例开头第一件事就是断言这一点 ——
 * 本项目出过一次「`db push` 打在真实库上」的事故，那条断言是它的直接产物。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/node_modules/.bin/prisma（dist/tests → server 根） */
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');
const INDEX_SRC = path.resolve(HERE, '../index.js');

interface TempDb {
  prisma: PrismaClient;
  file: string;
}

async function openTempDb(): Promise<TempDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-worksheet-routes-'));
  const file = path.join(dir, 'test.db');
  const url = `file:${file}`;
  // 🔴 这条断言是安全闸门，不是装饰：它保证下面那次 db push 不可能落在真实库上。
  assert.ok(
    url.startsWith(`file:${os.tmpdir()}`),
    `DATABASE_URL 必须指向临时目录，实际是 ${url}`,
  );
  assert.notEqual(path.resolve(file), path.resolve(HERE, '../../prisma/dev.db'));
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { prisma, file };
}

function teacherCookie(): string {
  const setCookies: string[] = [];
  createTeacherSession({ setHeader: (_name: string, value: string) => { setCookies.push(value); } } as never);
  return setCookies[0].split(';')[0];
}

interface TestServer {
  get: (pathname: string, headers?: Record<string, string>) => Promise<Response>;
  post: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  put: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  delete: (pathname: string, headers?: Record<string, string>) => Promise<Response>;
  cookie: string;
}

/**
 * 起真实路由 + **真实的鉴权闸门**（`worksheetAccessGate`，index.ts 用的就是同一个函数）。
 *
 * ⚠️ 闸门刻意从 `routes/worksheets.ts` 导入而不是在本文件里抄一遍：
 * 抄一遍的话，测试证明的只是「我抄的这一份能拦」，而 `index.ts` 挂的是哪一份无人过问 ——
 * 那正是本任务最该防的那种假绿。`index.ts` 的挂载本身由下面那条源码断言兜底。
 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  // 兜底 404 一律回 JSON：express 默认回的是 HTML，断言失败时 `await res.json()` 会抛
  // `Unexpected token '<'`，把「状态码不对」这个真正的原因盖成一句解析错误。
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const cookie = teacherCookie();
  const call = (method: string) => (pathname: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body),
    });
  const get = (pathname: string, headers?: Record<string, string>) => call('GET')(pathname, undefined, headers);
  return {
    get,
    post: (pathname, body, headers) => call('POST')(pathname, body, headers),
    put: (pathname, body, headers) => call('PUT')(pathname, body, headers),
    delete: (pathname, headers) => call('DELETE')(pathname, undefined, headers),
    cookie,
  };
}

const SAMPLE_CONTENT = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'q_1',
      type: 'single-choice',
      prompt: '光合作用需要哪些条件？',
      inputMode: 'keyboard',
      data: { options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }], correctKeys: ['B'] },
      children: [],
    },
    {
      id: 'q_2',
      type: 'fill-blank',
      prompt: '水的化学式是____',
      inputMode: 'keyboard',
      data: { answers: ['H2O'] },
      children: [],
    },
    {
      id: 'q_3',
      type: 'short-answer',
      prompt: '说说你观察到的现象。',
      inputMode: 'keyboard',
      data: {},
      children: [],
    },
  ],
};

const SAMPLE_SETTINGS = { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' };

async function seedWorksheet(prisma: PrismaClient, title = '光合作用学习单') {
  return prisma.worksheet.create({
    data: { title, description: '第一课时', content: SAMPLE_CONTENT, settings: SAMPLE_SETTINGS },
  });
}

/** 一间课堂 + 一个参与者（`ClassroomStudent` —— 学习单的 participantId 指向它）。 */
async function seedClassroom(prisma: PrismaClient, code: string, title = '测试课堂') {
  const classroom = await prisma.classroom.create({ data: { code, title, mode: 'standard' } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  return { classroom, participant };
}

// ---------------------------------------------------------------------------
// 删除守卫（规格 §5.5）：三样引用都要数，少一样就删出悬空引用 / 说谎的 400
// ---------------------------------------------------------------------------

/**
 * 🔴 **本任务最容易漏的一条**：学习单与网页同构，有「课堂级」与「组级」两条引用路径。
 * `ClassroomWorksheet`（标准/分组模式）与 `ClassroomGroupMaterial(kind='worksheet')`
 * （高级模式每组一份）是**两张表**。
 *
 * 只数课堂级 ⇒ 一份只被某个高级课堂的小组引用的学习单看起来「没人用」，
 * 教师照着删掉，那个组从此读不到学习单（`targetId` 没有真外键，数据库不会拦），
 * 而界面显示成「未配置」。
 */
test('守卫：只被**组级材料**引用的学习单，usage 必须说「在用」且 DELETE 被 400 拦下', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom } = await seedClassroom(db.prisma, '8001', '高级课堂');
  const group = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'worksheet', targetId: worksheet.id } });

  const usageRes = await server.get(`/api/worksheets/${worksheet.id}/usage`);
  const usage = await usageRes.json() as { used: boolean; classroomCount: number; responseCount: number; classrooms: Array<{ id: string }> };
  assert.equal(usageRes.status, 200, JSON.stringify(usage));
  assert.equal(usage.used, true, '组级引用也是引用 —— 数漏了它，教师会删掉一个正在用的学习单');
  assert.equal(usage.classroomCount, 1);
  assert.equal(usage.responseCount, 0);
  assert.deepEqual(usage.classrooms.map(c => c.id), [classroom.id]);

  const del = await server.delete(`/api/worksheets/${worksheet.id}`);
  const body = await del.json() as { error: string };
  assert.equal(del.status, 400, JSON.stringify(body));
  assert.match(body.error, /小组|组/, '文案要指出是小组在用，而不是含糊的「无法删除」');
  assert.equal(
    await db.prisma.worksheet.count({ where: { id: worksheet.id } }),
    1,
    '被拦下的删除不得真的把行删掉',
  );
});

/**
 * 🔴 **第三样引用：历史作答**（规格 §5.5 的完整论证）。
 *
 * `WorksheetResponse_worksheetId_fkey` 是 **RESTRICT**（Prisma 对必填关系的默认）。
 * 于是守卫若只数「未结束的课堂」，就会给出一个「没在用」的 400，
 * 紧接着数据库拒绝删除 —— **一个说谎的 400 文案**。
 * 所以这里断言的不只是「被拦」，还有**文案必须如实说清有几份作答并给出出路**。
 */
test('守卫：有历史作答卷的学习单，DELETE 被拦且文案含「已收到 K 份作答」并给出出路', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '8002');
  await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id, status: 'submitted' },
  });

  const usageRes = await server.get(`/api/worksheets/${worksheet.id}/usage`);
  const usage = await usageRes.json() as { used: boolean; responseCount: number };
  assert.equal(usageRes.status, 200, JSON.stringify(usage));
  assert.equal(usage.responseCount, 1, '历史作答必须被如实数出来 —— 它就是数据库会拒绝删除的那条约束');
  assert.equal(usage.used, true);

  const del = await server.delete(`/api/worksheets/${worksheet.id}`);
  const body = await del.json() as { error: string };
  assert.equal(del.status, 400, JSON.stringify(body));
  assert.match(body.error, /已收到 1 份作答/, '规格 §5.5 指定的文案');
  assert.match(body.error, /编辑/, '要给出出路（改内容请直接编辑），不是一句「不能删除」');
  assert.match(body.error, /复制/, '要给出出路（想要新的请复制一份）');
  assert.equal(await db.prisma.worksheet.count({ where: { id: worksheet.id } }), 1);
});

/** 课堂级引用同样要数 —— 三条路径里的第一条。 */
test('守卫：被课堂级关联引用的学习单，DELETE 同样被 400 拦下', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom } = await seedClassroom(db.prisma, '8003');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });

  const usage = await (await server.get(`/api/worksheets/${worksheet.id}/usage`)).json() as { used: boolean; classroomCount: number };
  assert.equal(usage.used, true);
  assert.equal(usage.classroomCount, 1);

  const del = await server.delete(`/api/worksheets/${worksheet.id}`);
  assert.equal(del.status, 400, JSON.stringify(await del.json()));
});

/**
 * **阳性对照** —— 没有它，一个「DELETE 永远 400」的实现也能让上面三条全绿。
 * 一份任何课堂、任何小组、任何作答都没碰过的学习单必须删得掉。
 */
test('守卫的阳性对照：三样引用都为 0 的学习单必须真的被删掉', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '没人用过的学习单');
  // 同一批夹具里放一份**在用**的，确认阳性结果不是「库里本来就没有引用」
  const used = await seedWorksheet(db.prisma, '在用的学习单');
  const { classroom } = await seedClassroom(db.prisma, '8004');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: used.id } });

  // `/usage` 在删除确认弹窗之外也会被调用（列表页的「关联课堂」入口）——
  // 没人用时它**不能说「无法删除」**，否则教师以为这份学习单动不了。
  const usage = await (await server.get(`/api/worksheets/${worksheet.id}/usage`)).json() as { used: boolean; message: string };
  assert.equal(usage.used, false);
  assert.doesNotMatch(usage.message, /无法删除/, `没人用的学习单不该被说成删不掉：${usage.message}`);
  assert.match(usage.message, /可以放心删除/);

  const res = await server.delete(`/api/worksheets/${worksheet.id}`);
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  assert.equal(await db.prisma.worksheet.count({ where: { id: worksheet.id } }), 0, '必须真的删掉');
  assert.equal(await db.prisma.worksheet.count({ where: { id: used.id } }), 1, '在用的那一份一个字节都不许动');
});

// ---------------------------------------------------------------------------
// duplicate：深拷贝（`content` 是树，浅拷贝会让副本与原件共用同一批节点）
// ---------------------------------------------------------------------------

test('duplicate：深拷贝 —— 改副本的 content 不影响原件（逐字比对原件）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const original = await seedWorksheet(db.prisma, '光合作用学习单');
  const originalContentBefore = JSON.stringify(original.content);
  const originalSettingsBefore = JSON.stringify(original.settings);

  const dupRes = await server.post(`/api/worksheets/${original.id}/duplicate`, {});
  const copy = await dupRes.json() as { id: string; title: string; content: unknown; settings: unknown };
  assert.equal(dupRes.status, 200, JSON.stringify(copy));
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.title, '光合作用学习单（副本）', '标题加后缀「（副本）」');
  assert.deepEqual(copy.content, original.content, '副本的内容起初必须与原件一致');
  assert.deepEqual(copy.settings, original.settings);

  // 改副本：改题干 + 改判分答案，两条都是嵌在树/对象里的字段。
  const mutated = structuredClone(SAMPLE_CONTENT);
  mutated.nodes[0].prompt = '被改过的题干';
  mutated.nodes[0].data.correctKeys = ['A'];
  const putRes = await server.put(`/api/worksheets/${copy.id}`, {
    content: mutated,
    settings: { allowResubmit: false, autoGrade: false, defaultInputMode: 'keyboard' },
  });
  assert.equal(putRes.status, 200, JSON.stringify(await putRes.json()));

  // 🔴 逐字比对：不是 deepEqual 到一个「应该是这样」的期望值，而是与改动**之前**抓到的快照比。
  const after = await db.prisma.worksheet.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(JSON.stringify(after.content), originalContentBefore, '改副本的题干/答案不得污染原件');
  assert.equal(JSON.stringify(after.settings), originalSettingsBefore, 'settings 同样必须深拷贝');

  // 副本自己确实变了（否则上面那条可能只是因为 PUT 没生效）
  const copyAfter = await db.prisma.worksheet.findUniqueOrThrow({ where: { id: copy.id } });
  assert.equal(JSON.stringify(copyAfter.content), JSON.stringify(mutated));
});

/**
 * 副本是**崭新的一份**：`ClassroomWorksheet` / `ClassroomGroupMaterial` /
 * `WorksheetResponse` 一行都不带过来。
 *
 * 这不是洁癖：把关联一起复制过来的话，副本会**立刻**被删除守卫拦住
 * （`used === true`），而「复制一份，改完再换上去」正是这个功能唯一的用法。
 */
test('duplicate：不复制任何引用 —— 副本是一份没人用的新学习单', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const source = await seedWorksheet(db.prisma, '在用的学习单');
  const { classroom, participant } = await seedClassroom(db.prisma, '8008');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: source.id } });
  const group = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'worksheet', targetId: source.id } });
  await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: source.id, participantId: participant.id, status: 'submitted' },
  });

  const copy = await (await server.post(`/api/worksheets/${source.id}/duplicate`, {})).json() as { id: string };

  assert.equal(await db.prisma.classroomWorksheet.count({ where: { worksheetId: copy.id } }), 0);
  assert.equal(await db.prisma.classroomGroupMaterial.count({ where: { kind: 'worksheet', targetId: copy.id } }), 0);
  assert.equal(await db.prisma.worksheetResponse.count({ where: { worksheetId: copy.id } }), 0);

  const usage = await (await server.get(`/api/worksheets/${copy.id}/usage`)).json() as { used: boolean; message: string };
  assert.equal(usage.used, false, `副本必须没人用，否则「复制一份」这个用法当场作废：${usage.message}`);

  // 阳性对照：源学习单自己仍然是「在用」的 —— 上面那些 0 不是「夹具没造出来」。
  const sourceUsage = await (await server.get(`/api/worksheets/${source.id}/usage`)).json() as { used: boolean };
  assert.equal(sourceUsage.used, true);

  // 副本必须删得掉（「复制一份」之后发现复制错了，教师得能收拾）
  const del = await server.delete(`/api/worksheets/${copy.id}`);
  assert.equal(del.status, 200, JSON.stringify(await del.json()));
});

test('duplicate：源学习单不存在 ⇒ 404', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);
  const res = await server.post('/api/worksheets/does-not-exist/duplicate', {});
  assert.equal(res.status, 404, JSON.stringify(await res.json()));
});

// ---------------------------------------------------------------------------
// 分层鉴权（★ 安全关键）
//
// 本路由教师端与学生端**混装**。学生只放行三种形状，其余一律拦下。
// ⚠️ 学生 token 打教师端形状必须回 **403**（已认证但不是教师），**不是 401**
//    （401 会谎称「你未认证」，而学生手里明明有一个有效 token）。
//    这一条同时是 B4 的前提：`POST /:id/review` 不在三种形状里。
// ---------------------------------------------------------------------------

test('鉴权：学生 token 打教师端端点必须是 403（不是 401），且教师 cookie 必须 200', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, participant } = await seedClassroom(db.prisma, '8005');
  await seedWorksheet(db.prisma);
  const token = createStudentToken(classroom.id, participant.id);
  const asStudent = { Authorization: `Bearer ${token}` };

  const res = await server.get('/api/worksheets', asStudent);
  const body = await res.json() as { error?: string };
  assert.equal(res.status, 403, `学生 token 不得读到教师端的学习单列表：${JSON.stringify(body)}`);

  // 阳性对照：同一个端点在教师 cookie 下必须 200 ——
  // 少了这一半，一个「所有请求都 403」的错误挂载也会让上面那条通过。
  const teacherRes = await server.get('/api/worksheets');
  assert.equal(teacherRes.status, 200, JSON.stringify(await teacherRes.json()));
});

/**
 * 无凭据 ⇒ **401**。这条是「闸门不是自己答一切」的证据：
 * 学生 token 那一支走的是 403，而没有凭据时必须**回落到 `requireTeacher`**（401）。
 * 少了这条，一个「凡是没有教师 cookie 就 403」的实现也能让上面的鉴权用例全绿。
 */
test('鉴权：无凭据打教师端端点是 401 —— 证明闸门确实回落到 requireTeacher', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const res = await server.get('/api/worksheets', { Cookie: '' });
  assert.equal(res.status, 401, `期望 requireTeacher 的 401，实际 ${res.status}：${JSON.stringify(await res.json())}`);
});

test('鉴权：学生 token 打 POST /:id/review 必须 403（B4 的前提）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, participant } = await seedClassroom(db.prisma, '8006');
  const worksheet = await seedWorksheet(db.prisma);
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.post(`/api/worksheets/${worksheet.id}/review`, { questionId: 'q_1' }, { Authorization: `Bearer ${token}` });
  assert.equal(
    res.status,
    403,
    '「已查看」是教师专用端点 —— 它不匹配三种学生形状，改动正则时必须确认这一点没有变',
  );
});

test('鉴权：三种学生形状必须**放行**（判据：既不是 403 也不是 401）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, participant } = await seedClassroom(db.prisma, '8007');
  const worksheet = await seedWorksheet(db.prisma);
  const token = createStudentToken(classroom.id, participant.id);
  const asStudent = { Authorization: `Bearer ${token}` };

  // ⚠️ 本任务（B1）**只负责放行**，学生端处理器由 B3 实现。
  // 所以判据是「闸门没有拦」（≠403，也 ≠401），**不是**「返回 200」——
  // 未实现时 express 的兜底 404 同样是合格的放行证据。实际观察到的状态码见报告。
  const shapes: Array<[string, Promise<Response>]> = [
    ['GET  /:id/student-view', server.get(`/api/worksheets/${worksheet.id}/student-view`, asStudent)],
    ['PUT  /:id/answers', server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: { format: 'choice/v1', selected: ['B'] } }, asStudent)],
    ['POST /:id/answers/submit', server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, asStudent)],
  ];
  for (const [label, pending] of shapes) {
    const res = await pending;
    assert.notEqual(res.status, 403, `${label} 必须放行，实际 403：${JSON.stringify(await res.json())}`);
    assert.notEqual(res.status, 401, `${label} 必须放行，实际 401`);
  }

  // 阴性对照：同一 token 打**不在**三种形状里的路径必须被拦 ——
  // 少了它，「闸门把什么都放过去」也能让上面三条通过。
  const blocked = await server.get(`/api/worksheets/${worksheet.id}/usage`, asStudent);
  assert.equal(blocked.status, 403, '/usage 是教师端端点，学生 token 不得放行');
});

/**
 * 源码级断言：闸门写了但**没挂上**，前面所有鉴权用例照样全绿（它们自己挂的闸门）。
 * 这条用一个非常宽松的匹配（同一行里既有 `/api/worksheets` 又有 `worksheetAccessGate`）
 * 钉住「阶段 B 的注册处确实用了这个闸门」，不钉格式。
 */
test('注册：index.ts 的 /api/worksheets 挂载必须使用 worksheetAccessGate', () => {
  const source = fs.readFileSync(INDEX_SRC, 'utf8');
  const line = source.split('\n').find(l => l.includes("'/api/worksheets'"));
  assert.ok(line, 'index.ts 里找不到 /api/worksheets 的注册 —— 路由根本没挂上');
  assert.match(
    line!,
    /worksheetAccessGate/,
    `挂载处没有使用 worksheetAccessGate，分层鉴权形同不存在：${line}`,
  );
});

// ---------------------------------------------------------------------------
// CRUD 基线：列表 / 详情 / 新建 / 更新 的基本形状
// ---------------------------------------------------------------------------

test('CRUD：新建 → 列表能搜到 → 详情含完整 content → 更新生效', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const createRes = await server.post('/api/worksheets', {
    title: '新建学习单',
    description: '说明',
    content: SAMPLE_CONTENT,
    settings: SAMPLE_SETTINGS,
  });
  const created = await createRes.json() as { id: string; title: string };
  assert.equal(createRes.status, 200, JSON.stringify(created));

  const list = await (await server.get('/api/worksheets')).json() as { items: Array<{ id: string; title: string }>; total: number };
  assert.equal(list.total, 1);
  assert.deepEqual(list.items.map(w => w.id), [created.id]);

  const searched = await (await server.get('/api/worksheets?search=新建')).json() as { total: number };
  assert.equal(searched.total, 1, '按标题搜索要能命中');
  const missed = await (await server.get('/api/worksheets?search=不存在的标题')).json() as { total: number };
  assert.equal(missed.total, 0, '阴性对照：搜不中时 total 必须是 0');

  const detail = await (await server.get(`/api/worksheets/${created.id}`)).json() as { content: unknown };
  assert.deepEqual(detail.content, SAMPLE_CONTENT);

  const putRes = await server.put(`/api/worksheets/${created.id}`, { title: '改过名的学习单' });
  assert.equal(putRes.status, 200, JSON.stringify(await putRes.json()));
  const after = await db.prisma.worksheet.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(after.title, '改过名的学习单');
  assert.equal(JSON.stringify(after.content), JSON.stringify(SAMPLE_CONTENT), '只改标题时 content 不得被动过');
});

test('CRUD：题目不合法（单选题没有正确答案）⇒ 400，且一个学习单都不建', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const broken = structuredClone(SAMPLE_CONTENT);
  broken.nodes[0].data.correctKeys = [];
  const res = await server.post('/api/worksheets', { title: '坏学习单', content: broken, settings: SAMPLE_SETTINGS });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /正确答案/, '报错要点到具体是哪条校验没过');
  assert.equal(await db.prisma.worksheet.count(), 0, '被拒的请求不得留下任何学习单');
});

test('CRUD：标题为空 ⇒ 400（不静默建成「未命名」）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);
  const res = await server.post('/api/worksheets', { title: '   ', content: SAMPLE_CONTENT, settings: SAMPLE_SETTINGS });
  assert.equal(res.status, 400, JSON.stringify(await res.json()));
  assert.equal(await db.prisma.worksheet.count(), 0);
});

test('CRUD：不给 id 的题目由服务端补一个稳定 id，且同一次请求内不得重复', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const noIds = {
    schemaVersion: 1,
    nodes: SAMPLE_CONTENT.nodes.map(({ id: _id, ...rest }) => rest),
  };
  const res = await server.post('/api/worksheets', { title: '无 id 的学习单', content: noIds, settings: SAMPLE_SETTINGS });
  const created = await res.json() as { id: string; content: { nodes: Array<{ id: string }> } };
  assert.equal(res.status, 200, JSON.stringify(created));
  const ids = created.content.nodes.map(n => n.id);
  assert.equal(ids.filter(Boolean).length, 3, '每道题都要有 id');
  assert.equal(new Set(ids).size, 3, 'id 不得重复 —— 重复会让 WorksheetAnswer 的 upsert 打在同一行上');

  const dup = structuredClone(SAMPLE_CONTENT);
  dup.nodes[1].id = 'q_1';
  const dupRes = await server.post('/api/worksheets', { title: '重复 id', content: dup, settings: SAMPLE_SETTINGS });
  assert.equal(dupRes.status, 400, `id 重复必须当场拒绝：${JSON.stringify(await dupRes.json())}`);
});
