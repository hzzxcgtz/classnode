/**
 * ★ M7b：`run` 端点的接线。判据在 `analysis-agent.test.ts` 里，这里只管接线。
 *
 * 🔴 三条最要紧的：
 *   ① **成功时只写 `narrative`/`agentId`/`model`** —— `aggregate`/`totalCount`/`computedAt`
 *      一个都不许碰（用户裁定 3：两组字段各自动自己那一半）
 *   ② **失败不写库** —— 已有解读绝不被清空
 *   ③ 两次闸门（没指定智能体 / 平台收不了图 / 零份作答）都要在发之前拦下
 *
 * 🧪 **本机怎么测到成功路径**：起一个**假的 Coze 端点**，把那个分析智能体的 `apiUrl`
 * 指过去（`createCozeBot` 的 `baseUrl: agent.apiUrl || undefined` 是可以改指的）。
 * ⚠️ 它证的是「我们的端点拿到一个成功响应之后做对了什么」—— **不证真 Coze 会怎么答**。
 * 那一条本机永远验不了，已写进验收清单。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Prisma, PrismaClient } from '@prisma/client';
import express from 'express';
import { worksheetRoutes } from '../routes/worksheets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-analysis-run-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  return { prisma: new PrismaClient({ datasources: { db: { url } } }), dir };
}

/**
 * 一个**假的 Coze 端点**，照客户端真正会打的四条路径作答
 * （`/v1/files/upload` · `/v3/chat` · `/v3/chat/retrieve` · `/v3/chat/message/list`）。
 * `answer` 就是它「模型」的产出 —— 传 `''` 可以模拟「模型返回空」。
 */
async function startFakeCoze(answer: string): Promise<{ base: string; close: () => void; hits: string[] }> {
  const hits: string[] = [];
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { hits.push(`${req.method} ${req.path}`); next(); });
  app.post('/v1/files/upload', (_req, res) => { res.json({ code: 0, data: { id: 'file-1' } }); });
  app.post('/v3/chat', (_req, res) => {
    res.json({ code: 0, data: { id: 'chat-1', conversation_id: 'conv-1', bot_id: 'bot-1', status: 'in_progress', created_at: 1 } });
  });
  app.get('/v3/chat/retrieve', (_req, res) => {
    res.json({ code: 0, data: { id: 'chat-1', conversation_id: 'conv-1', bot_id: 'bot-1', status: 'completed', created_at: 1 } });
  });
  app.get('/v3/chat/message/list', (_req, res) => {
    res.json({
      code: 0,
      data: [{
        id: 'm1', conversation_id: 'conv-1', role: 'assistant', content: answer,
        content_type: 'text', type: 'answer', created_at: 1, updated_at: 1,
      }],
    });
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close(), hits };
}

async function withServer(prisma: PrismaClient) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.set('prisma', prisma);
  app.use('/api/worksheets', worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** M7a 那条（生成/读取载荷）。 */
const payloadUrl = (base: string, ws: string, q: string, classroomId: string) =>
  `${base}/api/worksheets/${ws}/analysis/${q}?classroomId=${classroomId}`;
/**
 * M7b 那条（真的发出去）。⚠️ 路径是 `…/analysis/:qid/run`，查询串在**最后**。
 * 🔴 **不能写成 `payloadUrl(...) + '/run'`** —— 那样查询串会落到路径中间
 * （`…/q3?classroomId=X/run`）⇒ `classroomId` 变成 `X/run` ⇒ 课堂匹配不上 ⇒ 404。
 * （M7a 的 `analysis-endpoint.test.ts` 里为 `sheetUrl` 记过同一个坑。）
 */
const runUrl = (base: string, ws: string, q: string, classroomId: string) =>
  `${base}/api/worksheets/${ws}/analysis/${q}/run?classroomId=${classroomId}`;

const DRAWING: Prisma.InputJsonValue = { id: 'q3', type: 'drawing', prompt: '画一画', inputMode: 'handwriting', data: {}, children: [] };

/** 一节标准模式的课 + 一份绘图学习单 + 一份已提交的笔迹作答。返回那几个 id。 */
async function seed(p: PrismaClient, opts: { analysisAgentId?: string | null; withAnswer?: boolean } = {}) {
  const worksheet = await p.worksheet.create({
    data: {
      title: '学习单',
      content: { schemaVersion: 1, nodes: [DRAWING] },
      settings: { analysisAgentId: opts.analysisAgentId ?? null },
    },
  });
  const classroom = await p.classroom.create({ data: { title: '课', code: `70${Math.floor(Math.random() * 90 + 10)}`, status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const student = await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const response = await p.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: student.id },
  });
  if (opts.withAnswer !== false) {
    await p.worksheetAnswer.create({
      data: {
        responseId: response.id, questionId: 'q3', status: 'submitted',
        value: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [{ points: [[0.1, 0.1], [0.9, 0.9]], width: 0.01, color: '#111111' }] },
      },
    });
  }
  return { worksheet, classroom };
}

/** 造一个分析智能体；`apiUrl` 指向假端点。 */
async function makeAgent(p: PrismaClient, platform: string, apiUrl: string | null) {
  return p.agent.create({
    data: { name: '分析助手', platform, apiKey: 'fake-key', botId: 'bot-1', apiUrl, enabled: true, purpose: 'analysis' },
  });
}

test('🔴 成功路径：写回 narrative/agentId/model，且**一个载荷字段都不动**', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('整体情况：多数人画成了满月。典型错误见 User_002。');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id });
  const srv = await withServer(p);
  t.after(() => srv.close());

  // 先生成载荷（M7a 那条端点）
  const post = await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  if (post.status !== 200) assert.fail(`生成载荷 HTTP ${post.status}: ${await post.text()}`);
  const before = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  assert.equal(before.narrative, null, '前置：还没分析过');

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  if (run.status !== 200) assert.fail(`run HTTP ${run.status}: ${await run.text()}`);
  const body = await run.json() as Record<string, unknown>;
  assert.match(String(body.narrative), /多数人画成了满月/);
  assert.equal(body.agentId, agent.id);
  assert.equal(body.model, 'coze');

  const after = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  assert.match(String(after.narrative), /多数人画成了满月/, '解读要落库');
  assert.equal(after.agentId, agent.id);
  assert.equal(after.model, 'coze');
  // 🔴 用户裁定 3：两组字段各自动自己那一半 —— 载荷那一侧**一个字节都不许动**
  assert.deepEqual(after.aggregate, before.aggregate, 'aggregate 不许被这次分析改动');
  assert.equal(after.totalCount, before.totalCount, 'totalCount 不许动');
  assert.equal(after.computedAt.getTime(), before.computedAt.getTime(), 'computedAt 不许动');
  // 而它真的发了图（假端点收到了上传与建会话）
  assert.ok(fake.hits.includes('POST /v1/files/upload'), '联系表要真的上传（走 uploadBuffer）');
  assert.ok(fake.hits.includes('POST /v3/chat'), '要真的建会话');
});

test('🔴 模型返回空 ⇒ 502 且**不写库**（已有解读绝不被清空）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('');            // 「模型返回空」—— 最常见的一种失败
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  // 先手工放一段「旧的解读」
  await p.worksheetQuestionAnalysis.updateMany({ where: { worksheetId: worksheet.id }, data: { narrative: '旧的解读' } });

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 502);
  const row = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  assert.equal(row.narrative, '旧的解读', '失败时已有解读必须原样保留 —— 清空它是静默的');
});

test('🔴 平台收不了图 ⇒ 400，且**一次网络都没发**', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'wenxin', null);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 400);
  assert.match(String((await run.json() as Record<string, unknown>).error), /收不了图|Coze/);
});

test('没指定分析智能体 ⇒ 400，并说清去哪儿指定', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const { worksheet, classroom } = await seed(db.prisma, { analysisAgentId: null });
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 400);
  assert.match(String((await run.json() as Record<string, unknown>).error), /学习单|指定/);
});

test('零份已提交 ⇒ 400（发空载荷只会得到一段编造的解读）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', null);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, withAnswer: false });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 400);
  assert.match(String((await run.json() as Record<string, unknown>).error), /还没有|尚无|没有已提交/);
});

test('缺 classroomId ⇒ 400（分析是按课堂存的）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const { worksheet } = await seed(db.prisma);
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  const run = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q3/run`, { method: 'POST' });
  assert.equal(run.status, 400);
});
