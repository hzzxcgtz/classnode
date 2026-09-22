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
import classroomRoutes from '../routes/classroom.js';
import { createTeacherSession } from '../middleware/auth.js';

/**
 * 创建课堂 / 保存课堂设置的**规则**：三件套（AI 智能体 / 探究网页 / 学习单）、
 * 参与班级、以及「探究网页单选」这条约束在三条路径上的落地。
 *   · `POST /create`、`POST /create-advanced` —— 只关联第一个网页；
 *   · `PUT /:id/settings` —— 把历史遗留的多余关联裁到一个，且**只允许改课堂名称**。
 *
 * ⚠️ **这个文件刻意用真 Prisma + 真 SQLite，而不是手搓一个假 prisma。**
 * 被验证的东西恰好是「Prisma 的嵌套 create 语法有没有把 `ClassroomWebapp` 行写下去」——
 * 一个只记录调用参数的替身**证明不了这件事**（关系名写错、字段名写错，替身一样绿，
 * 而生产环境会 500）。这正是本项目「测试替身与生产路径不同构」那一类假绿的入口，
 * 所以这里用的是 prisma 自己的 schema：临时库由 `prisma db push` 生成。
 *
 * ⚠️ **临时库，绝不是真实库**：`DATABASE_URL` 一律指向 `os.tmpdir()` 下的文件，
 * 用例开头第一件事就是断言这一点（见 `openTempDb`）。项目里已经出过一次
 * 「`db push` 打在真实库上、删掉一列」的事故，这条断言是那次事故的直接产物。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/node_modules/.bin/prisma（dist/tests → server 根） */
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

interface TempDb {
  prisma: PrismaClient;
  file: string;
}

async function openTempDb(): Promise<TempDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-link-'));
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

/** 起真实路由（真 prisma），返回 fetch 用的地址与 cookie。 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/classroom', classroomRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const cookie = teacherCookie();
  const send = (method: string) => (pathname: string, body: unknown) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  return { post: send('POST'), put: send('PUT') };
}

/** 一套最小可用夹具：一个班 + 一名学生 + 一个智能体 + N 个网页。 */
async function seed(prisma: PrismaClient, webappCount: number) {
  const cls = await prisma.class.create({ data: { name: '测试班' } });
  const student = await prisma.student.create({ data: { classId: cls.id, name: '张三' } });
  const agent = await prisma.agent.create({ data: { name: '测试智能体', platform: 'coze', apiKey: 'x' } });
  const webapps = [];
  for (let i = 0; i < webappCount; i++) {
    webapps.push(await prisma.webapp.create({ data: { name: `网页${i + 1}`, entryPath: 'index.html' } }));
  }
  return { cls, student, agent, webapps };
}

/**
 * ⚠️ 这条用例在 P2.3 被**改写**过，从前断言的是「勾两个 ⇒ 关联两行」。
 *
 * 改写的理由不是「测试太严」，而是规则本身变了：探究网页改成单选，学生端从头到尾只加载
 * `webapps[0]`，第二个及以后**从未生效**。所以现在断言的是「只留第一个」。
 * 阴性对照保留下来了 —— 「多传的那个没被关联」才是这条规则真正的证据。
 */
test('标准模式：webappIds 只取第一个写进 ClassroomWebapp（真 Prisma / 真 SQLite）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 3);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create', {
    title: '带网页的课堂',
    classIds: [cls.id],
    agentIds: [agent.id],
    // 旧客户端发的是数组，服务端按「取第一个」兼容，不 400（见 resolveSingleWebappId）。
    webappIds: [webapps[0].id, webapps[2].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  const links = await db.prisma.classroomWebapp.findMany({
    where: { classroomId: classroom.id },
    select: { webappId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.deepEqual(
    links.map(link => link.webappId),
    [webapps[0].id],
    '单选：只关联第一个（第二个及以后从未生效过）',
  );

  // 阴性对照：同一批夹具里没被选中的那两个网页，一条关联行都不该有。
  for (const index of [1, 2]) {
    assert.equal(
      await db.prisma.classroomWebapp.count({ where: { webappId: webapps[index].id } }),
      0,
      `未选中的网页 ${index} 不得被关联`,
    );
  }
});

test('高级模式：同一条写入口，关联同样生效（否则「高级模式静默不支持网页」）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }],
    webappIds: [webapps[1].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  const links = await db.prisma.classroomWebapp.findMany({ where: { classroomId: classroom.id }, select: { webappId: true } });
  assert.deepEqual(links.map(link => link.webappId), [webapps[1].id]);
});

test('传了不存在的 webappId：整条 400，且**一个课堂都不建**（不静默跳过）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', {
    title: '不该被建出来',
    classIds: [cls.id],
    agentIds: [agent.id],
    webappIds: [webapps[0].id, 'does-not-exist'],
  });
  const rejected = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(rejected));
  assert.match(rejected.error, /探究网页/);
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');

  // 阳性对照：同一个夹具、同一条路径，把坏 id 换成好 id 必须 200 ——
  // 少了这一半，「400 是因为别的字段也不对」也会让上面那条通过。
  const ok = await server.post('/api/classroom/create', {
    title: '应当成功',
    classIds: [cls.id],
    agentIds: [agent.id],
    webappIds: [webapps[0].id, webapps[1].id],
  });
  const okBody = await ok.json() as { id?: string };
  assert.equal(ok.status, 200, JSON.stringify(okBody));
});

test('重复的 webappId 去重（否则会撞 @@unique 让整个创建失败）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create', {
    title: '重复 id',
    classIds: [cls.id],
    agentIds: [agent.id],
    webappIds: [webapps[0].id, webapps[0].id, webapps[0].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  assert.equal(await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id } }), 1);
});

test('不传 webappIds（老客户端）：照常建课堂，零关联（不是报错）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create', { title: '老客户端', classIds: [cls.id], agentIds: [agent.id] });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  assert.equal(await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id } }), 0);
});

test('删除守卫与关联是同一条数据的两个方向：有关联就删不掉', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);
  const res = await server.post('/api/classroom/create', { title: 'x', classIds: [cls.id], agentIds: [agent.id], webappIds: [webapps[0].id] });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));

  // 这就是 `GET /api/webapps/:id/usage` 背后的那个 count（管理页的删除守卫用它）。
  assert.equal(await db.prisma.classroomWebapp.count({ where: { webappId: webapps[0].id } }), 1);
});

// ---------------------------------------------------------------------------
// 三件套（AI 智能体 / 探究网页 / 学习单）：每一项都不是必填，但至少选一项。
// 参与班级**不属于**三件套，它是学生名册的来源，单独必填。
// ---------------------------------------------------------------------------

test('只选探究网页、不选智能体：必须建得出来（智能体不是必填）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', {
    title: '只有网页的课堂',
    classIds: [cls.id],
    // 完全没有 agentIds —— 这一条在 P2.3 之前是 400（那时智能体是必填的）。
    webappIds: [webapps[0].id],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  assert.equal(await db.prisma.classroom.count(), before + 1, '课堂必须真的建出来，不是「200 但没建」');
  assert.equal(
    await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id! } }),
    1,
    '网页关联同样要落库 —— 否则「只有网页的课堂」其实是个空课堂',
  );
});

test('三件套全空：400，且文案把三项都念出来（告诉教师该怎么办）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', { title: '空课堂', classIds: [cls.id] });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /AI 智能体/);
  assert.match(body.error, /探究网页/);
  assert.match(body.error, /学习单/, '文案要按三件套写 —— 学习单还没做，但规则里已经有它的位置');
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');
});

test('缺班级与缺三件套是**两条**不同的报错：只缺班级时不能提智能体', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { agent } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  // 只缺班级，三件套是齐的（有智能体）。
  const res = await server.post('/api/classroom/create', { title: '缺班级', agentIds: [agent.id] });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /班级/);
  assert.doesNotMatch(
    body.error,
    /智能体/,
    '班级这条报错里不能出现「智能体」—— 合成一句「请选择班级和智能体」会让只缺班级的教师去翻智能体那一栏',
  );
});

test('高级模式同样只关联第一个网页（与标准模式一个口径）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 3);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }],
    webappIds: [webapps[1].id, webapps[2].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  const links = await db.prisma.classroomWebapp.findMany({ where: { classroomId: classroom.id }, select: { webappId: true } });
  assert.deepEqual(links.map(link => link.webappId), [webapps[1].id]);
});

// ---------------------------------------------------------------------------
// PUT /:id/settings —— 只允许改课堂名称 + 裁剪多余的网页关联。
// ---------------------------------------------------------------------------

/** 造一个「多选时代」的课堂：直接写三行关联，`createdAt` 递增以固定「谁是第一个」。 */
async function seedLegacyMultiWebappClassroom(
  prisma: PrismaClient,
  classId: string,
  webappIds: string[],
) {
  const classroom = await prisma.classroom.create({ data: { code: '9001', title: '旧课堂', mode: 'standard' } });
  await prisma.classroomClass.create({ data: { classroomId: classroom.id, classId } });
  const base = Date.now() - webappIds.length;
  for (let i = 0; i < webappIds.length; i++) {
    await prisma.classroomWebapp.create({
      data: { classroomId: classroom.id, webappId: webappIds[i], createdAt: new Date(base + i) },
    });
  }
  return classroom;
}

test('保存设置：多余的网页关联被裁到只剩第一个，且课堂名称同时生效', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 3);
  const server = await startServer(t, db.prisma);
  const classroom = await seedLegacyMultiWebappClassroom(db.prisma, cls.id, webapps.map(w => w.id));

  assert.equal(await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id } }), 3, '前置条件：夹具里确实是三条关联');

  const res = await server.put(`/api/classroom/${classroom.id}/settings`, { title: '改过名的课堂' });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));

  const links = await db.prisma.classroomWebapp.findMany({
    where: { classroomId: classroom.id },
    select: { webappId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.deepEqual(
    links.map(link => link.webappId),
    [webapps[0].id],
    '留下的必须是**第一个**（与读路径 loadClassroomWebapps 同一套排序）',
  );
  const updated = await db.prisma.classroom.findUniqueOrThrow({ where: { id: classroom.id } });
  assert.equal(updated.title, '改过名的课堂', '裁剪不能把同一请求里的改名吞掉');
});

test('保存设置：只有一条关联时不动它（阴性对照 —— 别把「裁剪」写成「清空」）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);
  const classroom = await seedLegacyMultiWebappClassroom(db.prisma, cls.id, [webapps[1].id]);

  const res = await server.put(`/api/classroom/${classroom.id}/settings`, { title: '一条关联的课堂' });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  const links = await db.prisma.classroomWebapp.findMany({ where: { classroomId: classroom.id }, select: { webappId: true } });
  assert.deepEqual(links.map(link => link.webappId), [webapps[1].id], '唯一的那条关联必须原样留着');
});

test('保存设置：除课堂名称外的字段一律不采用（body 里塞了也不改）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 2);
  const otherAgent = await db.prisma.agent.create({ data: { name: '另一个智能体', platform: 'coze', apiKey: 'x' } });
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '原名', classIds: [cls.id], agentIds: [agent.id], webappIds: [webapps[0].id],
  });
  const classroom = await created.json() as { id: string };

  // 恶意/过期的客户端把「想改的东西」全塞进来 —— 服务端只应认 title。
  const res = await server.put(`/api/classroom/${classroom.id}/settings`, {
    title: '新名',
    classIds: [],
    agentIds: [otherAgent.id],
    mode: 'advanced',
    webappIds: [webapps[1].id],
  });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));

  const after = await db.prisma.classroom.findUniqueOrThrow({
    where: { id: classroom.id },
    include: { classroomAgents: true, classes: true, webapps: true },
  });
  assert.equal(after.title, '新名');
  assert.equal(after.mode, 'standard', '课堂模式不可改');
  assert.deepEqual(after.classroomAgents.map(a => a.agentId), [agent.id], '智能体不可改');
  assert.deepEqual(after.classes.map(c => c.classId), [cls.id], '参与班级不可改');
  assert.deepEqual(after.webapps.map(w => w.webappId), [webapps[0].id], '探究网页不可通过保存设置换掉');
});
