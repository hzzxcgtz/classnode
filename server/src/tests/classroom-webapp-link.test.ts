import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
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
 * ★ 2026-09-29：也管「创建课堂」的另一条规则 —— **三个模块的初始态是「开放」**
 *（两条创建路径都要种，见下面那条用例）。放在本文件的理由只有一个：这里已经有
 * 一个**真库 + 真路由**的创建夹具，而为一条断言再抄一份 90 行的夹具更糟。
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
  prepareTemporarySqliteFile(url);
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
  return {
    post: send('POST'),
    put: send('PUT'),
    // GET 没有 body：包一层，免得每个调用点都要写个多余的 `undefined`。
    get: (pathname: string) => send('GET')(pathname, undefined),
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

/** N 份学习单 —— 与 `seed` 的网页同形（题目结构不是本文件关心的事，给个空壳即可）。 */
async function seedWorksheets(prisma: PrismaClient, count: number) {
  const worksheets = [];
  for (let i = 0; i < count; i++) {
    worksheets.push(await prisma.worksheet.create({
      data: { title: `学习单${i + 1}`, content: { schemaVersion: 1, nodes: [] }, settings: {} },
    }));
  }
  return worksheets;
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

/**
 * ★ 2026-09-29（教师）：「这三个模块在**创建后默认是开放**」。
 *
 * 🔴 为什么必须落在**真库**上用真路由验：被验证的恰好是「Prisma 的嵌套 create 语法有没有
 * 把那三行写下去」—— 一个只记录调用参数的替身证明不了关系名/字段名写对了
 * （与本文件第一条用例同一个理由）。而它错了**不报错**：教师建完课堂看到的是三个
 * 「暂停」的模块，只会以为「刚建的课堂怎么都点不进去」。
 *
 * ⚠️ **两条创建路径都要验**：只种一条的话，另一种模式建出来的课堂会落在
 * `DEFAULT_MODULE_STATE`（= 全暂停），而屏幕上没有任何异常。
 */
test('新建课堂：两条创建路径都种下三行「开放」（真 Prisma / 真 SQLite）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const readModules = async (classroomId: string) => {
    const rows = await db.prisma.classroomModule.findMany({
      where: { classroomId },
      select: { moduleKey: true, state: true },
      orderBy: { moduleKey: 'asc' },
    });
    return rows.map(row => `${row.moduleKey}=${row.state}`).sort();
  };

  const standard = await server.post('/api/classroom/create', {
    title: '标准模式', classIds: [cls.id], agentIds: [agent.id],
  });
  const standardBody = await standard.json() as { id: string };
  assert.equal(standard.status, 200, JSON.stringify(standardBody));
  assert.deepEqual(await readModules(standardBody.id), [
    'companion=open', 'explorer=open', 'learning-sheet=open',
  ]);

  const advanced = await server.post('/api/classroom/create-advanced', {
    title: '高级模式', classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id, webappId: webapps[0].id }],
  });
  const advancedBody = await advanced.json() as { id: string };
  assert.equal(advanced.status, 200, JSON.stringify(advancedBody));
  assert.deepEqual(await readModules(advancedBody.id), [
    'companion=open', 'explorer=open', 'learning-sheet=open',
  ], '高级模式漏种的话，这种课堂建出来三个模块全是「暂停」');
});

/**
 * ⚠️ 这条用例在「按组的课堂材料」改动里被**改写**过。原本它断言的是
 * 「高级模式也往 `ClassroomWebapp` 写一行」（当时的口径是「高级模式不支持网页」
 * 会变成一条只有教师自己会发现的静默差异）。
 *
 * 规则现在变了（spec §4.3）：高级模式下网页的**权威来源是每组一份**
 * （`ClassroomGroupMaterial`），课堂级那一行**不再写** —— 留着它会长出
 * 「它到底谁在用」的第二套解释，而运行期规定了高级模式不回落 ⇒
 * 它会变成一个**永远看不见、却挡得住删除守卫**的幽灵。
 * 阴性对照因此反了过来：现在要断言的是「课堂级确实**没有**写」。
 */
test('高级模式：不再写课堂级网页，网页落在每组一行（阴性对照已反转）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id, webappId: webapps[1].id }],
    webappIds: [webapps[1].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  assert.equal(
    await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id } }),
    0,
    '高级模式不得再写课堂级网页 —— 那是一个学生会「看不见」、却挡得住删除守卫的幽灵',
  );
  const groups = await db.prisma.classroomGroup.findMany({
    where: { classroomId: classroom.id },
    include: { materials: true },
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].materials.map(m => `${m.kind}:${m.targetId}`).sort(),
    [`agent:${agent.id}`, `webapp:${webapps[1].id}`].sort(),
    '每组的材料各自落一行（智能体 + 网页）',
  );
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

/**
 * ⚠️ 同一条改写（见上一条用例的注释）：高级模式的网页口径从「课堂级一行」变成
 * 「每组一行」，所以「只关联第一个」这条规则在高级模式下的落点也变了 ——
 * 现在它由每组的 `webappId`（本就是**单选**，`toId` 后一个字符串）承载。
 * 课堂级那一条写入口已删，这里断言它**没有**被写。
 */
test('高级模式：组级网页落库，课堂级不写（与标准模式不再是同一个写入口）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent, webapps } = await seed(db.prisma, 3);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id, webappId: webapps[2].id }],
    webappIds: [webapps[1].id, webapps[2].id],
  });
  const classroom = await res.json() as { id: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  assert.equal(
    await db.prisma.classroomWebapp.count({ where: { classroomId: classroom.id } }),
    0,
    '课堂级一行都不写',
  );
  const materials = await db.prisma.classroomGroupMaterial.findMany({
    where: { kind: 'webapp', group: { classroomId: classroom.id } },
    select: { targetId: true },
  });
  assert.deepEqual(materials.map(m => m.targetId), [webapps[2].id], '组级只落它自己那一个');
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

// ---------------------------------------------------------------------------
// 按组的课堂材料（`ClassroomGroupMaterial`）：高级模式下每组各自配
// 智能体 / 探究网页，且**各自可以什么都不配**。
//
// 🔴 这一组的核心事实是「组可以不配」不再等于「建不出来」也不再等于「500」：
//    · 服务端以前要求每组必须有智能体（`!group.agentId ⇒ 400`）；
//    · 读路径以前对 `group.agent.id` 做**非空解引用** ⇒ 组无智能体时整间课堂 500
//      （该课堂所有学生都进不去）。
//    两条都要有用例钉住，否则下次改动会把它们一起带回来。
// ---------------------------------------------------------------------------

test('高级模式：某组只配网页不配智能体 ⇒ 200，该组只有 webapp 一行、agent 为 null', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '只配网页的高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', webappId: webapps[0].id }],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  const groups = await db.prisma.classroomGroup.findMany({
    where: { classroomId: classroom.id! },
    include: { materials: true },
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].materials.map(m => `${m.kind}:${m.targetId}`),
    [`webapp:${webapps[0].id}`],
    '只该有 webapp 一行 —— 没配的智能体不得落一行空串',
  );
});

test('高级模式：某组什么都没配 + 另一组配了 ⇒ 200，空组不产生任何材料行', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '有组没配的高级课堂',
    classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }, { name: '第二组' }],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  const groups = await db.prisma.classroomGroup.findMany({
    where: { classroomId: classroom.id! },
    include: { materials: true },
    orderBy: { name: 'asc' },
  });
  const byName = new Map(groups.map(g => [g.name, g]));
  assert.equal(byName.get('第一组')?.materials.length, 1, '配了的那组有材料');
  assert.equal(
    byName.get('第二组')?.materials.length,
    0,
    '什么都没配的组不得产生任何材料行（空串/缺字段一律归一成 null）',
  );
});

test('三件套全空（所有组都不配 + 无课堂级材料）⇒ 400，且一个课堂都不建', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create-advanced', {
    title: '空课堂',
    classId: cls.id,
    groups: [{ name: '第一组' }, { name: '第二组' }],
  });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /AI 智能体/);
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');
});

test('🔴 GET /code/:code 对「某组没配材料」的课堂返回 200（不是 500），该组 agent/webapp 均为 null', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create-advanced', {
    title: '含空材料的课堂',
    classId: cls.id,
    groups: [{ name: '配了的组', agentId: agent.id }, { name: '没配的组' }],
  });
  const createdBody = await created.json() as { id: string; code: string };
  assert.equal(created.status, 200, JSON.stringify(createdBody));

  const res = await server.get(`/api/classroom/code/${createdBody.code}`);
  const body = await res.json() as {
    error?: string;
    groups?: Array<{ id: string; name: string; agent: { id: string } | null; webapp: unknown | null }>;
  };
  // 这就是 §1.2 ② 的那处：`agent: { id: group.agent.id, … }` 在组无智能体时抛 TypeError，
  // 被 catch 吞成 500 ⇒ **该课堂所有学生都进不去**。
  assert.equal(res.status, 200, `读路径不得 500：${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.groups), `groups 必须是数组：${JSON.stringify(body)}`);
  assert.equal(body.groups!.length, 2);

  const configured = body.groups!.find(g => g.name === '配了的组');
  const empty = body.groups!.find(g => g.name === '没配的组');
  assert.equal(configured?.agent?.id, agent.id, '配了的那组要如实下发它的智能体');
  assert.equal(empty?.agent, null, '没配的组 agent 必须是 null（不是 500、也不是别人的智能体）');
  assert.equal(empty?.webapp, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(empty, 'agentId'),
    false,
    'agentId 字段已随列删除 —— 它没有真外键，留着会诱使调用方继续按列名读取',
  );
});

test('agentId 传空串 ⇒ 不落库（不是落一行空串）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '空串归一成 null',
    classId: cls.id,
    // 三件套靠网页那一项满足（否则会先被 400 拦住，测不到空串这一条）。
    groups: [{ name: '第一组', agentId: '   ', webappId: webapps[0].id }],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  assert.equal(
    await db.prisma.classroomGroupMaterial.count({ where: { targetId: '' } }),
    0,
    '空串不得成为第三种状态落库 —— 它在 `?.` 判空里与 null 表现一致，'
      + '直到有人写 `where: { targetId: null }` 的统计才会暴露',
  );
  assert.equal(
    await db.prisma.classroomGroupMaterial.count({ where: { kind: 'agent', group: { classroomId: classroom.id! } } }),
    0,
    '这一组不该有任何 agent 材料行',
  );
});

test('回归：分组模式「不选智能体 + 选网页」⇒ 200（原来是 500）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  // §1.2 ③：`agentId: uniqueAgentIds[0]` 在空数组时是 `undefined`，而 TS 认为它是
  // `string` ⇒ tsc 一声不吭，Prisma 在事务里抛必填缺失 ⇒ 500「创建课堂失败」。
  // 前端「分组模式」是一等入口，且明确允许「只选网页」。
  const res = await server.post('/api/classroom/create', {
    title: '分组模式只有网页',
    classIds: [cls.id],
    mode: 'group',
    webappIds: [webapps[0].id],
  });
  const body = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, `分组模式不得再 500：${JSON.stringify(body)}`);
  assert.ok(body.id, '课堂必须真的建出来');
  assert.equal(await db.prisma.classroomWebapp.count({ where: { classroomId: body.id! } }), 1);
});

// ---------------------------------------------------------------------------
// 学习单（三件套的第三项，P1）—— 与探究网页**同构**，但**数法不同**：
//   · 标准 / 分组：课堂级那一份（`ClassroomWorksheet`，0 或 1 行）；
//   · 高级：**真的配了的**组级学习单数（不是组的数量）。
// 数法混淆的后果不是「报错难看」，而是「三件套全空的课堂被放行」—— 学生进去一片空白。
// ---------------------------------------------------------------------------

test('标准模式：worksheetIds ⇒ ClassroomWorksheet 落库一行（三件套只靠学习单也建得出来）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', {
    title: '只有学习单的课堂',
    classIds: [cls.id],
    // 既没有 agentIds 也没有 webappIds —— 三件套里**只有学习单**这一项。
    worksheetIds: [ws.id],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  assert.equal(await db.prisma.classroom.count(), before + 1, '课堂必须真的建出来，不是「200 但没建」');
  const links = await db.prisma.classroomWorksheet.findMany({ where: { classroomId: classroom.id! } });
  assert.equal(links.length, 1, '学习单关联必须落库 —— 少这一处，学生看到的永远是「老师还没布置」');
  assert.equal(links[0].worksheetId, ws.id);
});

test('标准模式：worksheetIds 只取第一个（与探究网页同一条单选口径）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const worksheets = await seedWorksheets(db.prisma, 3);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create', {
    title: '多传了两份学习单',
    classIds: [cls.id],
    worksheetIds: worksheets.map(w => w.id),
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));
  const links = await db.prisma.classroomWorksheet.findMany({ where: { classroomId: classroom.id! } });
  assert.deepEqual(links.map(l => l.worksheetId), [worksheets[0].id], '只留第一个，多余的不静默多写');
});

test('标准模式：worksheetIds 里的 id 不存在 ⇒ 400（不静默建出一个没学习单的课堂）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create', {
    title: '学习单已被删',
    classIds: [cls.id],
    webappIds: [webapps[0].id],
    worksheetIds: ['does-not-exist'],
  });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /学习单/, '文案要念出是**哪一项**过期了 —— 与网页那条分开');
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');
});

test('标准/分组模式：只选学习单 ⇒ 200；三件套全空 ⇒ 400（学习单让「至少一项」成立）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  // 阳性：只有学习单。
  for (const mode of ['standard', 'group']) {
    const ok = await server.post('/api/classroom/create', {
      title: `${mode} 只有学习单`, classIds: [cls.id], mode, worksheetIds: [ws.id],
    });
    const okBody = await ok.json() as { id?: string; error?: string };
    assert.equal(ok.status, 200, `${mode} 只选学习单必须建得出来：${JSON.stringify(okBody)}`);
  }

  // 阴性对照：同一间班、什么都不选 ⇒ 仍然 400（这一条在 P1 之前就存在，此处防回归）。
  const before = await db.prisma.classroom.count();
  const bad = await server.post('/api/classroom/create', { title: '空课堂', classIds: [cls.id] });
  assert.equal(bad.status, 400);
  assert.equal(await db.prisma.classroom.count(), before);
});

test('高级模式：groups[].worksheetId 落库；空串 / 缺字段一律归一成 null（不产生第三种状态）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '组级学习单',
    classId: cls.id,
    groups: [
      { name: '有学习单的组', worksheetId: ws.id },
      { name: '空串的组', worksheetId: '   ' },
      { name: '缺字段的组' },
    ],
  });
  const classroom = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, JSON.stringify(classroom));

  const rows = await db.prisma.classroomGroupMaterial.findMany({
    where: { kind: 'worksheet', group: { classroomId: classroom.id! } },
  });
  assert.equal(rows.length, 1, '只有真配了的那一组写材料行');
  assert.equal(rows[0].targetId, ws.id);
  assert.equal(await db.prisma.classroomGroupMaterial.count({ where: { targetId: '' } }), 0,
    '空串不得成为第三种状态落库');
});

test('高级模式：groups[].worksheetId 指向不存在的东西 ⇒ 400（targetId 没有真外键，只能靠这里拦）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create-advanced', {
    title: '学习单已被删', classId: cls.id,
    groups: [{ name: '第一组', worksheetId: 'does-not-exist' }],
  });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /学习单/);
  assert.equal(await db.prisma.classroom.count(), before);
});

// 🔴 本任务两处「数法」的分水岭。混淆的形态：高级模式用 `normalizedGroups.length` 冒充
//    「配了学习单的组数」⇒ 「所有组都不配 + 无课堂级材料」这条路径被放行，
//    建出来的正是一个**三件套全空的课堂**（`classroomMaterialError` 唯一要防的形态）。
test('🔴 高级模式：所有组都不配 + 无课堂级材料 ⇒ 400；只要**有一组**配了学习单 ⇒ 200', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  // 阴性：三个组，全都不配任何材料 ⇒ 三件套全空 ⇒ 400，且一个课堂都不建。
  const before = await db.prisma.classroom.count();
  const bad = await server.post('/api/classroom/create-advanced', {
    title: '三件套全空', classId: cls.id,
    groups: [{ name: '第一组' }, { name: '第二组' }, { name: '第三组' }],
  });
  const badBody = await bad.json() as { error: string };
  assert.equal(bad.status, 400, JSON.stringify(badBody));
  assert.match(badBody.error, /学习单/, '文案要按三件套念 —— 三项都要念出来');
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');

  // 阳性：三个组里**只有一组**配了学习单 ⇒ 三件套非空 ⇒ 200。
  // （「组的数量」这一版实现下阳性也是 200，所以阳性单独不足以证明口径 ——
  //   上面那条阴性才是判据；两条一起才把「数的是什么」钉住。）
  const ok = await server.post('/api/classroom/create-advanced', {
    title: '只有一组配了学习单', classId: cls.id,
    groups: [{ name: '第一组', worksheetId: ws.id }, { name: '第二组' }, { name: '第三组' }],
  });
  const okBody = await ok.json() as { id?: string; error?: string };
  assert.equal(ok.status, 200, JSON.stringify(okBody));
  assert.equal(
    await db.prisma.classroomGroupMaterial.count({ where: { kind: 'worksheet', group: { classroomId: okBody.id! } } }),
    1,
    '只有配了的那一组写行',
  );
});

// ---------------------------------------------------------------------------
// 形状一致：五条下发 groups[] 的路径都必须带上 worksheet。
// 「少了这个键」与「这个键是 null」在服务端看起来只差一点，但前端要靠区分它们
// 来讲「本组未配置学习单」—— 少一个键的那条路径会让学生的界面**什么都不说**。
// ---------------------------------------------------------------------------

test('读路径：/code/:code、/:id、/all、/active 的 groups[] 都带 worksheet（形状逐字一致）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create-advanced', {
    title: '含学习单的课堂', classId: cls.id,
    groups: [
      { name: '配了的组', agentId: agent.id, worksheetId: ws.id },
      { name: '没配的组' },
    ],
  });
  const createdBody = await created.json() as { id: string; code: string };
  assert.equal(created.status, 200, JSON.stringify(createdBody));

  type GroupView = { id: string; name: string; agent: { id: string } | null; webapp: unknown | null; worksheet: { id: string; title: string } | null };
  const check = (label: string, groups: GroupView[] | undefined) => {
    assert.ok(Array.isArray(groups), `${label}: groups 必须是数组`);
    const configured = groups!.find(g => g.name === '配了的组');
    const empty = groups!.find(g => g.name === '没配的组');
    // 用 hasOwnProperty 而不是 `!== undefined`：**键必须存在**（值为 null 才是「未配置」）。
    assert.ok(Object.prototype.hasOwnProperty.call(configured, 'worksheet'), `${label}: 配了的组必须有 worksheet 键`);
    assert.equal(configured?.worksheet?.id, ws.id, `${label}: 配了的组要如实下发它的学习单`);
    assert.equal(configured?.worksheet?.title, ws.title, `${label}: 要带标题（学生端卡片要显示它）`);
    assert.ok(Object.prototype.hasOwnProperty.call(empty, 'worksheet'), `${label}: 没配的组必须有 worksheet 键`);
    assert.equal(empty?.worksheet, null, `${label}: 没配的组必须如实是 null（不是别人的、也不是缺少这个键）`);
  };

  const byCode = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as { groups?: GroupView[] };
  check('GET /code/:code', byCode.groups);

  const byId = await (await server.get(`/api/classroom/${createdBody.id}`)).json() as { groups?: GroupView[] };
  check('GET /:id', byId.groups);

  const all = await (await server.get('/api/classroom/all')).json() as Array<{ id: string; groups: GroupView[] }>;
  check('GET /all', all.find(c => c.id === createdBody.id)?.groups);

  const active = await (await server.get('/api/classroom/active')).json() as Array<{ id: string; groups: GroupView[] }>;
  check('GET /active', active.find(c => c.id === createdBody.id)?.groups);
});

// ---------------------------------------------------------------------------
// F1：**课堂级**学习单下发（`worksheets`，与课堂级 `webapps` 同形同源）。
//
// 为什么这一项是必需的（不是「顺手加的字段」）：标准 / 分组模式下
// `ClassroomGroupMaterial` 里**没有任何行** —— 那两种模式的材料权威来源就是课堂级。
// 而 `groups[]` 在 standard 模式下根本不下发（`GET /code/:code` 里是 `undefined`）、
// 在 `group` 模式下每组的 `worksheet` 恒为 `null`。
// ⇒ 少了课堂级这一项，标准/分组的学生端**完全没有**「老师布置了哪一份」的来源，
//    界面上只会显示「还没有布置」，且没有任何报错。
// ---------------------------------------------------------------------------

test('🔴 标准模式：GET /code/:code 下发**课堂级** worksheets（standard 没有 groups，这里是唯一来源）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '标准模式带学习单', classIds: [cls.id], worksheetIds: [ws.id],
  });
  const createdBody = await created.json() as { id: string; code: string };
  assert.equal(created.status, 200, JSON.stringify(createdBody));

  const body = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as {
    mode?: string; groups?: unknown; worksheets?: Array<{ id: string; title: string }>;
  };
  assert.equal(body.mode, 'standard');
  // 前提：standard 模式本来就不下发 groups —— 这正是「必须另有课堂级来源」的原因。
  assert.equal(body.groups, undefined, 'standard 模式不下发 groups（本条用例的前提）');
  assert.ok(Array.isArray(body.worksheets), `worksheets 必须是数组：${JSON.stringify(body)}`);
  assert.equal(body.worksheets!.length, 1, '课堂级那一份要下发');
  assert.equal(body.worksheets![0].id, ws.id);
  assert.equal(body.worksheets![0].title, ws.title, '要带标题 —— 首页卡片要显示它');
  // 形状与组级 `worksheet` 一致：前端只需要处理**一种**学习单形状。
  assert.deepEqual(Object.keys(body.worksheets![0]).sort(), ['id', 'title']);
});

test('分组模式：课堂级 worksheets 有值，而每组的 worksheet 恒为 null（组级不是分组模式的权威来源）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '分组模式带学习单', classIds: [cls.id], mode: 'group', worksheetIds: [ws.id],
  });
  const createdBody = await created.json() as { id: string; code: string };
  assert.equal(created.status, 200, JSON.stringify(createdBody));

  const body = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as {
    worksheets?: Array<{ id: string }>;
    groups?: Array<{ name: string; worksheet: unknown }>;
  };
  assert.equal(body.worksheets?.[0]?.id, ws.id, '分组模式的权威来源是课堂级');
  // 阳性对照的另一半：组级那份**不该**有值 —— 不然前端会以为该按组取。
  for (const group of body.groups ?? []) {
    assert.equal(group.worksheet, null, `分组模式的组不该有组级学习单（${group.name}）`);
  }
});

test('未关联学习单：worksheets 下发空数组（不是省略这个键、也不是报错）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '只有网页', classIds: [cls.id], webappIds: [webapps[0].id],
  });
  const createdBody = await created.json() as { code: string };
  const body = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as { worksheets?: unknown };
  assert.deepEqual(body.worksheets, [], '与 webapps 同款：空数组，不是省略');
});

test('高级模式：课堂级 worksheets 恒为**空**（该模式不写课堂级），组级那份照常有值', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create-advanced', {
    title: '高级模式', classId: cls.id,
    groups: [{ name: '第一组', worksheetId: ws.id }],
  });
  const createdBody = await created.json() as { id: string; code: string };
  assert.equal(created.status, 200, JSON.stringify(createdBody));

  const byCode = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as {
    worksheets?: unknown; groups?: Array<{ worksheet: { id: string } | null }>;
  };
  assert.deepEqual(byCode.worksheets, [], '高级模式的课堂级学习单恒为空（运行期也不回落它）');
  assert.equal(byCode.groups?.[0]?.worksheet?.id, ws.id, '组级那份才是高级模式的权威来源');

  // 幽灵防线：课堂级那条关联**一行都不该有**（留着会长出「它到底谁在用」的第二套解释，
  // 且挡得住删除守卫）。这里直接数库，别只看响应。
  assert.equal(await db.prisma.classroomWorksheet.count({ where: { classroomId: createdBody.id } }), 0);
});

test('课堂级 worksheets 与 webapps 的下发路径完全对齐（/code/:code、/:id、/active 有；/all 两者都没有）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 1);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '两条路径对齐', classIds: [cls.id], worksheetIds: [ws.id],
  });
  const createdBody = await created.json() as { id: string; code: string };

  const has = (label: string, body: Record<string, unknown>) => {
    for (const key of ['webapps', 'worksheets']) {
      assert.ok(Object.prototype.hasOwnProperty.call(body, key), `${label} 必须下发 ${key}`);
      assert.ok(Array.isArray(body[key]), `${label} 的 ${key} 必须是数组`);
    }
    assert.equal((body.worksheets as unknown[]).length, 1, `${label} 的 worksheets 要含那一份`);
  };

  has('GET /code/:code', await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as Record<string, unknown>);
  has('GET /:id', await (await server.get(`/api/classroom/${createdBody.id}`)).json() as Record<string, unknown>);
  const active = await (await server.get('/api/classroom/active')).json() as Array<Record<string, unknown>>;
  has('GET /active', active.find(c => c.id === createdBody.id)!);

  // `/all` 两个都不发 —— 这是与 `loadClassroomWebapps` **刻意对齐**的结果，不是漏了学习单。
  const all = await (await server.get('/api/classroom/all')).json() as Array<Record<string, unknown>>;
  const row = all.find(c => c.id === createdBody.id)!;
  for (const key of ['webapps', 'worksheets']) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, key), false, `/all 两者都不发（对齐），实际多了 ${key}`);
  }
});

test('课堂级 worksheets 的排序 = 写入顺序（orderBy createdAt,id，与写入口/裁剪同一套）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const worksheets = await seedWorksheets(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const created = await server.post('/api/classroom/create', {
    title: '顺序', classIds: [cls.id], worksheetIds: [worksheets[0].id],
  });
  const createdBody = await created.json() as { id: string; code: string };
  // 第二行只能直接写库（创建端点是单选）。用**同一套**时间戳规则中「更晚」的那个值 ——
  // 若读路径的 orderBy 丢了 createdAt，顺序就会落到 uuid 字典序。
  await db.prisma.classroomWorksheet.create({
    data: { classroomId: createdBody.id, worksheetId: worksheets[1].id, createdAt: new Date(Date.now() + 1000) },
  });

  const body = await (await server.get(`/api/classroom/code/${createdBody.code}`)).json() as { worksheets?: Array<{ id: string }> };
  assert.deepEqual(body.worksheets?.map(w => w.id), [worksheets[0].id, worksheets[1].id],
    '按 createdAt 升序 —— 读路径必须与写入口同一套排序键');
});

// ---------------------------------------------------------------------------
// F2：高级模式对**课堂级** `worksheetIds` 与 `webappIds` 同口径：解析 + 留痕 + 不落库。
// 只「忽略」的话，教师勾过的选项会**完全无声**地消失。
// ---------------------------------------------------------------------------

test('高级模式：课堂级 worksheetIds 被解析但不落库（不写幽灵行）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const res = await server.post('/api/classroom/create-advanced', {
    title: '高级模式带课堂级学习单', classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }],
    // 与 webappIds 同款：解析通过后被丢掉，且必须留痕（写在服务端日志里）。
    worksheetIds: [ws.id],
  });
  const body = await res.json() as { id?: string; error?: string };
  assert.equal(res.status, 200, `旧字段不该让创建失败：${JSON.stringify(body)}`);
  assert.equal(await db.prisma.classroomWorksheet.count({ where: { classroomId: body.id! } }), 0,
    '课堂级学习单在高级模式下不落库 —— 否则它会成为一个永远看不见、却挡得住删除守卫的幽灵');
});

test('🔴 高级模式：课堂级 worksheetIds 里的 id 不存在 ⇒ 400（证明真的解析了，不是静默忽略）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls, agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create-advanced', {
    title: '学习单已被删', classId: cls.id,
    groups: [{ name: '第一组', agentId: agent.id }],
    worksheetIds: ['does-not-exist'],
  });
  const body = await res.json() as { error: string };
  // 只把字段「忽略」的实现下，这一条会 200 —— 所以它是 F2 那条改动的判据。
  assert.equal(res.status, 400, `必须与 webappIds 同口径地校验：${JSON.stringify(body)}`);
  assert.match(body.error, /学习单/);
  assert.equal(await db.prisma.classroom.count(), before, '被拒的请求不得留下任何课堂');
});

test('高级模式：只有课堂级 worksheetIds、所有组都不配 ⇒ 仍然 400（不落库的材料不计入三件套）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const { cls } = await seed(db.prisma, 0);
  const [ws] = await seedWorksheets(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const before = await db.prisma.classroom.count();
  const res = await server.post('/api/classroom/create-advanced', {
    title: '课堂级学习单不算数', classId: cls.id,
    groups: [{ name: '第一组' }, { name: '第二组' }],
    worksheetIds: [ws.id],
  });
  const body = await res.json() as { error: string };
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /学习单/, '文案要按三件套念');
  assert.equal(await db.prisma.classroom.count(), before);
});
