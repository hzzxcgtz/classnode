import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ M7b：**学生端那道闸在「两条路径」上都生效**（独立审查 C2 + 它建议的这条网）。
 *
 * 🔴 为什么单靠纯函数用例不够：学生的智能体列表有**两条来源**、走**两条路径** ——
 *   · `agents[]`（课堂级 `ClassroomAgent`）→ HTTP 首屏（`GET /code/:code`）**与** socket 的 `joined`
 *   · `groups[].agent`（组级 `ClassroomGroupMaterial`）→ 同样两条路径
 * 而 `agent-purpose.ts` 的用例只钉住了「那个助手本身是对的」。
 * ⇒ 这条用例**真的连一个 socket 客户端**，把两条路径、两处来源**一次断言完**。
 *
 * ⚠️ 它存在的直接理由：C2 那处泄漏**是在纯函数全绿的情况下溜过去的** ——
 * 组材料那条路当时根本没走闸，而没有任何东西会红。
 *
 * ⚠️ `socket.io-client` 是本批为它加进 `server` 的 devDependency（`--offline` 从 store 装的）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import classroomRoutes from '../routes/classroom.js';
import { setupSocketHandlers } from '../socket/index.js';
import { createStudentToken } from '../middleware/student-auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/prisma/build/index.js');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

/** `joined` 载荷里这条用例要用到的两个字段。 */
interface JoinedPayload {
  agents: Array<{ id: string }>;
  groups: Array<{ id: string; agent: { id: string } | null }>;
}

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-agent-gate-paths-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [PRISMA_BIN, 'db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  return { prisma: new PrismaClient({ datasources: { db: { url } } }), dir };
}

test('🔴 分析型 bot 不许出现在学生的任何一条路径上（HTTP 首屏 + socket joined，两处来源各一次）', async (t) => {
  const db = await openTempDb();
  const { prisma } = db;
  // ⚠️ 清理**只有一个** `t.after`（在下面起完服务之后注册）—— 第一版这里还留着一个旧的，
  // 它先跑、先把临时库删了，于是 socket 那边在飞的查询报
  // 「Unable to open the database file」（一条「测试之后才炸」的未处理 rejection）。
  // 顺序见下面那一段。

  // 一节高级模式的课：**课堂级**挂一个学伴、**组级**故意挂那个分析型
  const classroom = await prisma.classroom.create({
    data: { title: '课', code: '9101', status: 'active', mode: 'advanced' },
  });
  const tutor = await prisma.agent.create({
    data: { name: '学伴', platform: 'coze', apiKey: 'k', enabled: true, purpose: 'tutoring' },
  });
  const analysisBot = await prisma.agent.create({
    data: { name: '分析型·会收到全班作业', platform: 'coze', apiKey: 'k', enabled: true, purpose: 'analysis' },
  });
  await prisma.classroomAgent.create({ data: { classroomId: classroom.id, agentId: tutor.id } });
  const group = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '一组' } });
  await prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'agent', targetId: analysisBot.id } });
  const participant = await prisma.classroomStudent.create({
    data: { classroomId: classroom.id, type: 'group', groupId: group.id },
  });
  const token = createStudentToken(classroom.id, participant.id);

  // ── 起服务（HTTP 路由 + socket）
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('lanAccessEnabled', true);
  app.use('/api/classroom', classroomRoutes);
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: true } });
  app.set('io', io);
  setupSocketHandlers(io, prisma);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  let client: ClientSocket | null = null;
  /**
   * 🔴 **清理顺序是承重的**（第一版没管它，结果：临时库被删时 socket 那边还有在飞的查询
   * ⇒ `Unable to open the database file`，变成一个「测试之后才炸」的未处理 rejection）。
   * 顺序：先断客户端与 io（不再有新查询）→ 再关 http → 再断 Prisma → 最后删目录。
   */
  t.after(async () => {
    client?.close();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
    fs.rmSync(db.dir, { recursive: true, force: true });
  });

  // ── ① HTTP 首屏
  const httpPayload = await (await fetch(`http://127.0.0.1:${port}/api/classroom/code/${classroom.code}`))
    .json() as { agents: Array<{ id: string }>; groups: Array<{ id: string; agent: { id: string } | null }> };
  assert.deepEqual(httpPayload.agents.map((a) => a.id).includes(analysisBot.id), false,
    '① HTTP 首屏的 agents[] 不许有分析型');
  assert.ok(httpPayload.agents.some((a) => a.id === tutor.id), '阳性对照：学伴要在（否则这条断言是空的）');
  assert.equal(httpPayload.groups.find((g) => g.id === group.id)?.agent, null,
    '② HTTP 首屏的 groups[].agent 不许有分析型（C2 的漏点就在这里）');

  // ── ③ socket 的 joined 载荷（学生**连接后**那一份）
  client = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  const joined = await new Promise<JoinedPayload>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join-classroom 超时')), 8000);
    client!.on('joined', (payload: JoinedPayload) => { clearTimeout(timer); resolve(payload); });
    client!.on('ai-error', (err: unknown) => { clearTimeout(timer); reject(new Error(`socket 报错：${JSON.stringify(err)}`)); });
    client!.emit('join-classroom', { classroomCode: classroom.code, studentId: participant.id, token });
  });
  assert.deepEqual(joined.agents.map((a) => a.id).includes(analysisBot.id), false,
    '③ socket 的 joined.agents[] 不许有分析型');
  assert.ok(joined.agents.some((a) => a.id === tutor.id), '阳性对照：学伴要在');
  assert.equal(joined.groups.find((g) => g.id === group.id)?.agent, null,
    '④ socket 的 joined.groups[].agent 不许有分析型');
});
