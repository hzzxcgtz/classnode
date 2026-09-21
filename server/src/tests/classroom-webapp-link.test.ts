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
 * 创建课堂时的「关联网页」写入口。
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
  return {
    post: (pathname: string, body: unknown) => fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    }),
  };
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

test('标准模式：webappIds 真的写进 ClassroomWebapp（真 Prisma / 真 SQLite）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 3);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create', {
    title: '带网页的课堂',
    classIds: [cls.id],
    agentIds: [agent.id],
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
    [webapps[0].id, webapps[2].id],
    '勾选顺序 = 关联顺序；且**只关联勾选的**（没勾的那个不能顺带进来）',
  );

  // 阴性对照：同一批夹具里没被勾选的那个网页，一条关联行都不该有。
  assert.equal(
    await db.prisma.classroomWebapp.count({ where: { webappId: webapps[1].id } }),
    0,
    '未被勾选的网页不得被关联',
  );
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
