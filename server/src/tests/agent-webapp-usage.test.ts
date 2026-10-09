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
import agentRoutes from '../routes/agents.js';
import webappRoutes from '../routes/webapps.js';

/**
 * `GET /api/agents/:id/usage` 与 `GET /api/webapps/:id/usage` 新返回的 `classrooms` 清单。
 *
 * 这一层要守的核心事实只有一条，但它**不会自己报错**：
 * 智能体的关联有**两条**独立的落库路径 —— `ClassroomAgent`（标准模式建的课堂）
 * 与 `ClassroomGroupMaterial`（高级模式里每组绑的智能体）。`classrooms` 必须 union 两张表。
 * 只查前者的实现会让高级模式的课堂**从清单里整个消失，却不报任何错**：
 * 教师看到「没有课堂关联这个智能体」，照着界面去删，删除守卫（数的是两张表）却回 400 ——
 * 界面与守卫自相矛盾，且没有任何一处把它标出来。
 * 第 2 条用例就是这条的**阴性对照**（夹具里 `ClassroomAgent` 一行都没有）。
 *
 * ⚠️ **这个文件刻意用真 Prisma + 真 SQLite，而不是手搓一个假 prisma。**
 * 被验证的东西恰好是「Prisma 的 findMany/include 有没有按 schema 把两张表读全」——
 * 一个只记录调用参数的替身证明不了这件事（include 的关系名写错、去重逻辑写反，
 * 替身一样绿，而生产环境是空的清单）。这正是本项目「测试替身与生产路径不同构」
 * 那一类假绿的入口，所以这里用的是 prisma 自己的 schema。
 *
 * ⚠️ **临时库，绝不是真实库**：`DATABASE_URL` 一律指向 `os.tmpdir()` 下的文件，
 * 用例开头第一件事就是断言这一点（见 `openTempDb`）。项目里已经出过一次
 * 「`db push` 打在真实库上、删掉一列」的事故，这条断言是那次事故的直接产物。
 * 本文件里唯一一次 `prisma db push` 就在 `openTempDb` 内，且它跑之前先过了那两条断言。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-agent-webapp-usage-'));
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

/**
 * 起真实路由（真 prisma）。
 *
 * ⚠️ **刻意不带鉴权**：这两个路由文件自身不查教师会话 —— 鉴权是 `index.ts` 在
 * **注册时**分层加的（见该文件的 `requireTeacher` 用法）。所以这里给 cookie 是
 * 死代码，而且 `createTeacherSession` 每次调用都会往进程内的会话表里塞一条不回收的
 * 记录，一个用例泄漏一条。少这一层，测到的才是路由真实的样子。
 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/agents', agentRoutes);
  app.use('/api/webapps', webappRoutes);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const send = (method: string) => (pathname: string) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, { method });
  return { get: send('GET'), del: send('DELETE') };
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
 * 直接落库造一个课堂。
 *
 * ⚠️ 刻意**不走** `POST /api/classroom/create`：本文件验证的是 usage 端点读到的形状，
 * 不是创建路径的规则（那是 `classroom-webapp-link.test.ts` 的事）。
 * 用创建路径造夹具会让「清单查不到」和「关联没建出来」两种失败混在一起，分不清。
 */
async function makeClassroom(
  prisma: PrismaClient,
  data: { title?: string | null; status?: string; mode?: string } = {},
) {
  return prisma.classroom.create({
    data: {
      title: data.title ?? null,
      status: data.status ?? 'active',
      mode: data.mode ?? 'standard',
    },
  });
}

/**
 * 造一个「绑了某个智能体」的小组。
 *
 * ⚠️ 组级智能体现在落在 `ClassroomGroupMaterial`（`kind='agent'`）里，
 * **不是** `ClassroomGroup.agentId` —— 那一列已经不存在了（迁移把它搬进了新表）。
 * 所以「某个小组用了这个智能体」这件事只能经新表表达，夹具也必须照这个形状造，
 * 否则这些用例测的是已经消失的那条关联路径，永远绿而真实路径坏着（假绿）。
 */
async function makeGroupWithAgent(
  prisma: PrismaClient,
  classroomId: string,
  name: string,
  agentId: string,
) {
  const group = await prisma.classroomGroup.create({ data: { classroomId, name } });
  await prisma.classroomGroupMaterial.create({
    data: { groupId: group.id, kind: 'agent', targetId: agentId },
  });
  return group;
}

interface RelatedClassroom {
  id: string;
  title: string;
  status: string;
  mode?: string;
}

interface UsageResponse {
  used: boolean;
  classroomCount: number;
  groupCount?: number;
  classrooms: RelatedClassroom[];
  /** ★ 2026-10-08：只对**分析型**智能体非空（来源是 `settings.analysisAgentId`）。 */
  worksheets?: RelatedWorksheet[];
}

/** ★ 2026-10-08：`Worksheet.settings.analysisAgentId` 反查出来的清单。 */
interface RelatedWorksheet {
  id: string;
  title: string;
  updatedAt: string;
}

async function readUsage(get: (pathname: string) => Promise<Response>, pathname: string): Promise<UsageResponse> {
  const res = await get(pathname);
  const body = await res.json() as UsageResponse;
  assert.equal(res.status, 200, `期望 200，实际 ${res.status}：${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.classrooms), `classrooms 必须是数组：${JSON.stringify(body)}`);
  return body;
}

/** 每个用例的收尾：断开连接 + 删掉整个临时目录（临时库文件随之消失）。 */
function cleanup(t: { after: (fn: () => void) => void }, db: TempDb) {
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
}

// ---------------------------------------------------------------------------
// 智能体：classrooms 必须 union ClassroomAgent 与 ClassroomGroupMaterial 两张表
// ---------------------------------------------------------------------------

test('智能体只经 ClassroomAgent 关联（标准模式）：classrooms 里查得到那个课堂', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const linked = await makeClassroom(db.prisma, { title: '标准模式的课堂', status: 'active', mode: 'standard' });
  const untouched = await makeClassroom(db.prisma, { title: '没关联的课堂', status: 'ended', mode: 'standard' });
  await db.prisma.classroomAgent.create({ data: { classroomId: linked.id, agentId: agent.id } });

  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);

  assert.equal(usage.classrooms.length, 1, JSON.stringify(usage));
  assert.equal(usage.classrooms[0].id, linked.id);
  assert.equal(usage.classrooms[0].title, '标准模式的课堂');
  assert.equal(usage.classrooms[0].status, 'active');
  assert.equal(usage.classrooms[0].mode, 'standard');
  assert.equal(usage.classrooms.some(row => row.id === untouched.id), false, '没关联的课堂不得出现在清单里');
  assert.equal(usage.used, true);
  assert.equal(usage.classroomCount, 1);
  assert.equal(usage.groupCount, 0);
});

/**
 * 🔴 本文件最关键的一条 —— 高级模式里智能体只落在 `ClassroomGroupMaterial` 上。
 *
 * 阴性对照写在夹具里：`ClassroomAgent` 对这个智能体**一行都没有**。
 * 只查一张表的实现会让 `classrooms` 变成空数组（而 `used` 仍是 true），
 * 于是界面说「没有课堂关联」、删除守卫说「不能删」。
 */
test('智能体只经组级材料关联（高级/分组模式）：classrooms 里同样查得到（只查一张表会让它红）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '高级模式的课堂', status: 'paused', mode: 'advanced' });
  await makeGroupWithAgent(db.prisma, classroom.id, '第一组', agent.id);

  assert.equal(
    await db.prisma.classroomAgent.count({ where: { agentId: agent.id } }),
    0,
    '前置条件：这个夹具里只经组级材料关联，ClassroomAgent 一行都没有',
  );

  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);

  assert.equal(usage.classrooms.length, 1, `分组模式的课堂必须出现：${JSON.stringify(usage)}`);
  assert.equal(usage.classrooms[0].id, classroom.id);
  assert.equal(usage.classrooms[0].title, '高级模式的课堂');
  assert.equal(usage.classrooms[0].status, 'paused');
  assert.equal(usage.classrooms[0].mode, 'advanced');
  assert.equal(usage.used, true);
  assert.equal(usage.classroomCount, 0, 'classroomCount 仍只数 ClassroomAgent');
  assert.equal(usage.groupCount, 1, 'groupCount 仍只数组级材料行');
});

test('同一个课堂既在 ClassroomAgent 又在组级材料：classrooms 里只出现一次（按 classroomId 去重）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '两边都关联的课堂', status: 'active', mode: 'advanced' });
  await db.prisma.classroomAgent.create({ data: { classroomId: classroom.id, agentId: agent.id } });
  await makeGroupWithAgent(db.prisma, classroom.id, '第一组', agent.id);
  await makeGroupWithAgent(db.prisma, classroom.id, '第二组', agent.id);

  assert.equal(await db.prisma.classroomAgent.count({ where: { classroomId: classroom.id } }), 1, '前置条件：两边都有行');
  assert.equal(await db.prisma.classroomGroup.count({ where: { classroomId: classroom.id } }), 2, '前置条件：组级材料里两条');

  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);

  assert.equal(
    usage.classrooms.length,
    1,
    `同一个课堂只该出现一次，实际 ${JSON.stringify(usage.classrooms)}`,
  );
  assert.equal(usage.classrooms[0].id, classroom.id);
  // 去重只作用于清单：两个计数仍是各自的原始行数，否则删除守卫的判据会跟着变。
  assert.equal(usage.classroomCount, 1);
  assert.equal(usage.groupCount, 2);
});

test('智能体没有任何关联：classrooms 是空数组、used 为 false', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  // 阳性对照的邻居：库里**确实有**课堂，只是没关联这个智能体 ——
  // 少了它，「空数组」可能只是因为整个库是空的。
  const other = await makeClassroom(db.prisma, { title: '别人的课堂', status: 'active' });
  assert.equal(await db.prisma.classroom.count(), 1, '前置条件：库里有课堂');

  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);

  // ⚠️ 这里用 `length === 0` 而不是 `deepEqual(…, [])`：后者会让 TS 把 `classrooms`
  // 窄化成 `never[]`，下面那条 `.some(row => row.id …)` 的 `row` 就变成 `never` 而编译不过
  // （`tsc` 实测报 TS2339）。两者对数组的判别力等价，且 `readUsage` 已经断言过它是数组。
  assert.equal(usage.classrooms.length, 0, JSON.stringify(usage));
  assert.equal(usage.used, false);
  assert.equal(usage.classroomCount, 0);
  assert.equal(usage.groupCount, 0);
  assert.equal(usage.classrooms.some(row => row.id === other.id), false);
});

// ---------------------------------------------------------------------------
// 网页：只有 ClassroomWebapp 一条路径
// ---------------------------------------------------------------------------

test('网页被两个课堂关联：classrooms 长度为 2，状态原样带出', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const first = await makeClassroom(db.prisma, { title: '网页课堂 A', status: 'active', mode: 'standard' });
  const second = await makeClassroom(db.prisma, { title: '网页课堂 B', status: 'ended', mode: 'advanced' });
  await db.prisma.classroomWebapp.create({ data: { classroomId: first.id, webappId: webapps[0].id } });
  await db.prisma.classroomWebapp.create({ data: { classroomId: second.id, webappId: webapps[0].id } });

  const usage = await readUsage(server.get, `/api/webapps/${webapps[0].id}/usage`);

  assert.equal(usage.classrooms.length, 2, JSON.stringify(usage));
  assert.deepEqual(
    usage.classrooms.map(row => row.id).sort(),
    [first.id, second.id].sort(),
    '两个课堂都要在，且不重复',
  );
  assert.deepEqual(
    usage.classrooms.map(row => row.status).sort(),
    ['active', 'ended'],
    'status 原样带出，不是恒为某个值',
  );
  assert.equal(usage.used, true);
  assert.equal(usage.classroomCount, 2);
});

test('网页没有任何关联：classrooms 是空数组、used 为 false（另一个网页被关联着）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '只关联网页1的课堂', status: 'active' });
  await db.prisma.classroomWebapp.create({ data: { classroomId: classroom.id, webappId: webapps[0].id } });

  const usage = await readUsage(server.get, `/api/webapps/${webapps[1].id}/usage`);

  assert.deepEqual(usage.classrooms, [], JSON.stringify(usage));
  assert.equal(usage.used, false);
  assert.equal(usage.classroomCount, 0);

  // 阳性对照：同一个夹具里，被关联的那个网页查得出东西来 ——
  // 少了这一半，「空数组」也可能只是这张表压根没读。
  const linked = await readUsage(server.get, `/api/webapps/${webapps[0].id}/usage`);
  assert.equal(linked.classrooms.length, 1, JSON.stringify(linked));
  assert.equal(linked.classrooms[0].id, classroom.id);
});

// ---------------------------------------------------------------------------
// title 回退与既有字段的回归
// ---------------------------------------------------------------------------

test('title 为空的课堂回退成「未命名课堂」（智能体与网页两条路径），有标题的不受影响', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent, webapps } = await seed(db.prisma, 1);
  const server = await startServer(t, db.prisma);

  const untitled = await makeClassroom(db.prisma, { title: null, status: 'active' });
  const titled = await makeClassroom(db.prisma, { title: '有名字的课堂', status: 'active' });
  await db.prisma.classroomAgent.create({ data: { classroomId: untitled.id, agentId: agent.id } });
  await db.prisma.classroomAgent.create({ data: { classroomId: titled.id, agentId: agent.id } });
  await db.prisma.classroomWebapp.create({ data: { classroomId: untitled.id, webappId: webapps[0].id } });

  const agentUsage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);
  const untitledRow = agentUsage.classrooms.find(row => row.id === untitled.id);
  assert.ok(untitledRow, `标题为空的课堂也要在清单里：${JSON.stringify(agentUsage)}`);
  assert.equal(untitledRow.title, '未命名课堂');
  assert.equal(
    agentUsage.classrooms.find(row => row.id === titled.id)?.title,
    '有名字的课堂',
    '回退不能把有标题的也一起改掉',
  );

  const webappUsage = await readUsage(server.get, `/api/webapps/${webapps[0].id}/usage`);
  assert.equal(webappUsage.classrooms.length, 1, JSON.stringify(webappUsage));
  assert.equal(webappUsage.classrooms[0].title, '未命名课堂');
});

/**
 * 回归：`used` / `classroomCount` / `groupCount` 三个字段是**删除守卫的判据**
 * （`agents.ts` 的 DELETE 分支），加了 `classrooms` 之后取值口径必须一字不变 ——
 * `classroomCount` 只数 `ClassroomAgent`、`groupCount` 只数 `ClassroomGroupMaterial`，
 * `used` 仍是「两者任一 > 0」。这里把三种情形都钉住，并顺带真的打一次 DELETE。
 */
test('回归：used / classroomCount / groupCount 与改动前一致（无关联、单表关联、双表关联三种情形）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);
  const usageUrl = `/api/agents/${agent.id}/usage`;

  // 情形一：无关联 ⇒ used false，两个计数都是 0。
  const empty = await readUsage(server.get, usageUrl);
  assert.equal(empty.used, false);
  assert.equal(empty.classroomCount, 0);
  assert.equal(empty.groupCount, 0);

  // 情形二：两张表各关联一个不同的课堂 ⇒ used true，计数各 1。
  const standardClassroom = await makeClassroom(db.prisma, { title: '标准课堂', mode: 'standard' });
  const advancedClassroom = await makeClassroom(db.prisma, { title: '高级课堂', mode: 'advanced' });
  await db.prisma.classroomAgent.create({ data: { classroomId: standardClassroom.id, agentId: agent.id } });
  await makeGroupWithAgent(db.prisma, advancedClassroom.id, '第一组', agent.id);

  const linked = await readUsage(server.get, usageUrl);
  assert.equal(linked.used, true);
  assert.equal(linked.classroomCount, 1, 'classroomCount = ClassroomAgent 行数');
  assert.equal(linked.groupCount, 1, 'groupCount = 组级材料行数');
  // 删除守卫用的就是这条恒等式；清单去重不得让它失配。
  assert.equal(linked.used, linked.classroomCount > 0 || linked.groupCount > 0);
  assert.equal(linked.classrooms.length, 2, `两个课堂都要在清单里：${JSON.stringify(linked)}`);

  // 情形三：删除守卫的**可观察行为**没变 —— 只被组级材料关联也照样删不掉。
  const blocked = await server.del(`/api/agents/${agent.id}`);
  const blockedBody = await blocked.json() as { error: string };
  assert.equal(blocked.status, 400, JSON.stringify(blockedBody));
  assert.match(blockedBody.error, /无法删除/);
});

// ---------------------------------------------------------------------------
// 列表接口的 classroomCount
//
// 管理页的概览条（全部 / 已关联 / 未关联）与「按关联状态筛选」都依赖它，
// 而它的口径必须是**去重后**的 —— 与 :id/usage 的 classrooms.length 同口径。
// 两处口径一旦不一致，卡片会显示「关联 1 个课堂」而清单里躺着两条。
// ---------------------------------------------------------------------------

interface AgentListRow { id: string; name: string; platform?: string; enabled?: boolean; classroomCount?: number }
interface WebappListRow { id: string; name: string; entryPath: string; createdAt?: string; classroomCount?: number }

test('列表 GET /api/webapps：classroomCount 反映被几个课堂关联（未被关联的是 0）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const first = await makeClassroom(db.prisma, { title: '课堂 A' });
  const second = await makeClassroom(db.prisma, { title: '课堂 B' });
  await db.prisma.classroomWebapp.create({ data: { classroomId: first.id, webappId: webapps[0].id } });
  await db.prisma.classroomWebapp.create({ data: { classroomId: second.id, webappId: webapps[0].id } });

  const res = await server.get('/api/webapps');
  const rows = await res.json() as WebappListRow[];
  assert.equal(res.status, 200, JSON.stringify(rows));

  const linked = rows.find(row => row.id === webapps[0].id);
  const untouched = rows.find(row => row.id === webapps[1].id);
  assert.equal(linked?.classroomCount, 2, JSON.stringify(rows));
  assert.equal(untouched?.classroomCount, 0, '未被任何课堂关联的必须是 0，不是 undefined');

  // 回归：原有的字段一个都不能少（管理页的卡片靠它们渲染）。
  assert.ok(linked?.name, 'name 仍在');
  assert.ok(linked?.entryPath, 'entryPath 仍在');
  assert.ok(linked?.createdAt, 'createdAt 仍在');
});

test('🔴 列表 GET /api/agents：只经组级材料关联的智能体，classroomCount 是 1 不是 0', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '高级模式课堂', mode: 'advanced' });
  await makeGroupWithAgent(db.prisma, classroom.id, '第一组', agent.id);

  assert.equal(
    await db.prisma.classroomAgent.count({ where: { agentId: agent.id } }),
    0,
    '前置条件：只经组级材料关联，ClassroomAgent 一行都没有',
  );

  const res = await server.get('/api/agents');
  const rows = await res.json() as AgentListRow[];
  assert.equal(res.status, 200, JSON.stringify(rows));

  const row = rows.find(item => item.id === agent.id);
  // 只数 ClassroomAgent 的实现会让这里是 0：卡片显示「未关联」，
  // 而教师去删时守卫回 400 —— 界面与守卫自相矛盾且不报错。
  assert.equal(row?.classroomCount, 1, JSON.stringify(rows));
});

test('🔴 列表 GET /api/agents：同一个课堂两张表都有行时只算一次（去重）', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  // 同一对 (课堂, 智能体) 在两张表里同时有行 —— 老的高级课堂就是这个形状：
  // 迁移前它既从各组 agentId 派生过 `ClassroomAgent`，迁移又把那几个 agentId 搬成了
  // 组级材料行（派生的旧行**不删**，见 create-advanced 的注释）。
  // 所以「两边都有行」现在是**历史数据的常态**，去重不是边界情形。
  const classroom = await makeClassroom(db.prisma, { title: '两边都关联', mode: 'advanced' });
  await db.prisma.classroomAgent.create({ data: { classroomId: classroom.id, agentId: agent.id } });
  await makeGroupWithAgent(db.prisma, classroom.id, '第一组', agent.id);
  await makeGroupWithAgent(db.prisma, classroom.id, '第二组', agent.id);

  const res = await server.get('/api/agents');
  const rows = await res.json() as AgentListRow[];
  const row = rows.find(item => item.id === agent.id);

  assert.equal(row?.classroomCount, 1, `三个关联行指向同一个课堂，必须去重成 1：${JSON.stringify(rows)}`);

  // 与 :id/usage 的清单同口径 —— 两处对不上就是界面自相矛盾。
  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);
  assert.equal(row?.classroomCount, usage.classrooms.length, '列表计数必须与 usage 清单长度一致');
});

test('列表 GET /api/agents：无任何关联的智能体 classroomCount 为 0，且既有字段仍在', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const res = await server.get('/api/agents');
  const rows = await res.json() as AgentListRow[];
  const row = rows.find(item => item.id === agent.id);

  assert.equal(row?.classroomCount, 0, JSON.stringify(rows));
  // 回归：`toPublicAgent` 的既有字段一个都不能少 —— 管理页卡片靠它们渲染。
  assert.equal(row?.name, '测试智能体');
  assert.equal(row?.platform, 'coze');
  assert.equal(typeof row?.enabled, 'boolean', 'enabled 仍在且是布尔');
});

// ---------------------------------------------------------------------------
// 🔴 删除守卫的**新关联路径**：组级材料（`ClassroomGroupMaterial`）。
//
// 智能体那一侧以前还能靠 `ClassroomGroup.agentId` 兜住「组里绑了它」，
// 而**网页那一侧以前只有课堂级一条路径**（见文件顶部对 `/usage` 的说明）——
// 加了组级之后变两条。这一节把两条路径各自钉一遍，因为「漏一处就删出悬空引用」：
// `targetId` 是**多态**的、没有真外键，删掉目标不会报错，只会留一行读不到的 id，
// 那个组从此显示成「未配置」，而教师以为自己删的是一个没人用的东西。
// ---------------------------------------------------------------------------

/** 造一个「关联了某个网页」的小组（组级材料）。 */
async function makeGroupWithWebapp(
  prisma: PrismaClient,
  classroomId: string,
  name: string,
  webappId: string,
) {
  const group = await prisma.classroomGroup.create({ data: { classroomId, name } });
  await prisma.classroomGroupMaterial.create({
    data: { groupId: group.id, kind: 'webapp', targetId: webappId },
  });
  return group;
}

test('🔴 只被组级材料引用的网页：/usage 的 used 为真，DELETE 被 400 拦下', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { webapps } = await seed(db.prisma, 2);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '高级模式课堂', mode: 'advanced' });
  await makeGroupWithWebapp(db.prisma, classroom.id, '第一组', webapps[0].id);

  // 前置条件：课堂级一条都没有 —— 这是纯粹的「只经组级材料关联」夹具。
  assert.equal(
    await db.prisma.classroomWebapp.count({ where: { webappId: webapps[0].id } }),
    0,
    '前置条件：只经组级材料关联，ClassroomWebapp 一行都没有',
  );

  const usage = await readUsage(server.get, `/api/webapps/${webapps[0].id}/usage`);
  // 老实现只查 `ClassroomWebapp`：`used` 会是 false、清单会是空的，
  // 教师要删、界面说「没关联」，而删除守卫本该回 400 —— 两边自相矛盾。
  assert.equal(usage.used, true, `组级引用也算「被使用」：${JSON.stringify(usage)}`);
  assert.equal(usage.classroomCount, 1);
  assert.equal(usage.classrooms.length, 1);
  assert.equal(usage.classrooms[0].id, classroom.id);

  const blocked = await server.del(`/api/webapps/${webapps[0].id}`);
  const blockedBody = await blocked.json() as { error: string };
  assert.equal(blocked.status, 400, `只被组级材料引用的网页必须删不掉：${JSON.stringify(blockedBody)}`);
  assert.match(blockedBody.error, /无法删除/);
  // 拦下之后目标必须还在（守卫不得「先删后判」）。
  assert.ok(await db.prisma.webapp.findUnique({ where: { id: webapps[0].id } }), '被拦下的删除不得真的删掉网页');

  // 阳性对照：同一个夹具里没被引用的那个网页必须删得掉 ——
  // 少了这一半，「400 是因为别的原因」也会让上面那条通过。
  const allowed = await server.del(`/api/webapps/${webapps[1].id}`);
  assert.equal(allowed.status, 200, JSON.stringify(await allowed.json()));
});

test('🔴 只被组级材料引用的智能体：/usage 的 used 为真，DELETE 被 400 拦下', async (t) => {
  const db = await openTempDb();
  cleanup(t, db);
  const { agent } = await seed(db.prisma, 0);
  const server = await startServer(t, db.prisma);

  const classroom = await makeClassroom(db.prisma, { title: '高级模式课堂', mode: 'advanced' });
  await makeGroupWithAgent(db.prisma, classroom.id, '第一组', agent.id);

  assert.equal(
    await db.prisma.classroomAgent.count({ where: { agentId: agent.id } }),
    0,
    '前置条件：只经组级材料关联，ClassroomAgent 一行都没有',
  );

  const usage = await readUsage(server.get, `/api/agents/${agent.id}/usage`);
  assert.equal(usage.used, true, `组级引用也算「被使用」：${JSON.stringify(usage)}`);
  assert.equal(usage.groupCount, 1, 'groupCount 数的是组级材料行');
  assert.equal(usage.classroomCount, 0, 'classroomCount 仍只数 ClassroomAgent');

  const blocked = await server.del(`/api/agents/${agent.id}`);
  const blockedBody = await blocked.json() as { error: string };
  assert.equal(blocked.status, 400, `只被组级材料引用的智能体必须删不掉：${JSON.stringify(blockedBody)}`);
  assert.match(blockedBody.error, /无法删除/);
  // 文案说的是「小组」而不是「分组」：现在数的是组级材料行，一条行 = 一个小组用了它。
  assert.match(blockedBody.error, /小组/);
  assert.ok(await db.prisma.agent.findUnique({ where: { id: agent.id } }), '被拦下的删除不得真的删掉智能体');
});

/*
 * ★ 2026-10-08（教师）：「（分析型智能体那张卡上）这里应该是**查看关联的学习单**。」
 *
 * 🔴 这条关系**没有关联表**（全仓无 `WorksheetAgent`）：唯一的来源是
 *   `Worksheet.settings.analysisAgentId` —— 一个 **JSON 列**里的字段。
 *   所以 `/:id/usage` 只能把学习单取回、在 JS 里筛（照 `DELETE /:id` 那个删除守卫的写法）。
 *   本用例钉的就是那个筛：**JSON 里的字段读得出来、且比的是同一个 id**。
 *   筛错的表现是**静默的** —— 教师点开看到空清单，以为"没有学习单用它"，
 *   而删除守卫（用同一条判据）却会拦住他 ⇒ 界面与守卫自相矛盾，两边都不报错。
 * ⚠️ 与 `agent-webapp-usage` 那个文件头同一条理由：这里用**真 Prisma + 真 SQLite**，
 *   因为要验的恰好是「Prisma 有没有按 schema 把 JSON 列读出来」——替身证明不了这件事。
 */
test('★ 2026-10-08：usage 带上「指定它做分析」的学习单，且 used 跟着为真', async (t) => {
  const db = await openTempDb();
  const prisma = db.prisma;
  const { get } = await startServer(t, prisma);
  cleanup(t, db);

  const { agent } = await seed(prisma, 0);
  const other = await prisma.agent.create({ data: { name: '别的分析 bot', platform: 'coze', apiKey: 'y' } });
  const lonely = await prisma.agent.create({ data: { name: '没人用', platform: 'coze', apiKey: 'z' } });

  const mine = await prisma.worksheet.create({
    data: { title: '我关联的', content: { nodes: [] }, settings: { analysisAgentId: agent.id } },
  });
  await prisma.worksheet.create({
    data: { title: '别人的', content: { nodes: [] }, settings: { analysisAgentId: other.id } },
  });
  await prisma.worksheet.create({
    data: { title: '没指定的', content: { nodes: [] }, settings: {} },
  });

  const body = await readUsage(get, `/api/agents/${agent.id}/usage`);
  assert.deepEqual(
    (body.worksheets ?? []).map((w) => w.title),
    ['我关联的'],
    'JSON 里的 analysisAgentId 没有筛对（多列 / 少列 / 比错 id 都是静默的）',
  );
  assert.equal(body.worksheets?.[0]?.id, mine.id, '回来的是另一份学习单');
  assert.ok(typeof body.worksheets?.[0]?.updatedAt === 'string', '清单里缺 updatedAt');
  assert.equal(body.used, true,
    '有学习单引用它、used 却仍是 false ⇒ 界面与删除守卫会自相矛盾');

  // 阳性对照：另一个智能体的清单里**只有**它自己那一份（证明筛的是 id，不是"全都要"）。
  const body2 = await readUsage(get, `/api/agents/${other.id}/usage`);
  assert.deepEqual(body2.worksheets?.map((w) => w.title), ['别人的'], '阳性对照本身没造对');

  // 阴性对照：没有任何学习单指定它 ⇒ **空数组**（不是缺字段 —— 缺字段会让界面无法区分
  //「读到了、确实没有」与「没读到」，而那正是本仓弹窗文案依赖的两件事）。
  const body3 = await readUsage(get, `/api/agents/${lonely.id}/usage`);
  assert.deepEqual(body3.worksheets, [], '没有学习单指定它时，worksheets 应是空数组');
  assert.equal(body3.used, false, '什么都没有关联时 used 应为 false');
});
