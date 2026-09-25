/**
 * ★ M7a：三个分析端点的**接线**。判据在 `analysis-payload.test.ts` 里，这里只管接线。
 *
 * 🔴 最要紧的一条是 **`total` 的分母**：高级模式下**每个组可以是不同的学习单**
 * （M5b 规格 §2.2）⇒「该题应作答的参与者数」**不是**「全班参与者数」。
 * 算错的后果是「已交 5/40」而实际只有 5 人该答，教师会以为全班都没交 —— 而**没有任何报错**。
 * 分母必须走 `resolveMaterialTargetId` 这个唯一口径，不许另算一把尺子。
 *
 * 🔴 第二条要紧的是**安全边界**：这三条路径是三段 / 四段，而 `worksheetAccessGate`
 * 放行学生的四条正则都是「**恰好两段**」⇒ 它们自然落到 `requireTeacher`。
 * 将来谁把 `analysis` 那一段挪成两段形状，就会把**全班作答**开给学生 —— 所以这里钉一条 403。
 *
 * ⚠️ 临时库在 `os.tmpdir()` 下，开头第一件事就断言这一点（GC 4 / 20）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createStudentToken } from '../middleware/student-auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-analysis-endpoint-'));
  const file = path.join(dir, 'test.db');
  const url = `file:${file}`;
  // 🔴 安全闸门，不是装饰：保证下面那次 db push 不可能落在真实库上。
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), `DATABASE_URL 必须指向临时目录，实际是 ${url}`);
  assert.notEqual(path.resolve(file), path.resolve(HERE, '../../prisma/dev.db'));
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  return { prisma: new PrismaClient({ datasources: { db: { url } } }), dir };
}

/**
 * 一条问答题的节点（主观题 ⇒ 过闸门）。
 * ⚠️ 类型必须写成 `Prisma.InputJsonValue` —— 本仓的 `content` 是 JSON 列，
 * 而 Prisma 的 JSON 入参类型**不接受** `Record<string, unknown>`（里面的 `unknown` 过不去）。
 */
const SHORT_ANSWER_NODE: Prisma.InputJsonValue = { id: 'q1', type: 'short-answer', prompt: '说说你的看法', inputMode: 'keyboard', data: {}, children: [] };
/** 一条绘图题的节点（主观题之一 ⇒ 过闸门；它的载荷是**联系表**）。 */
const DRAWING_NODE: Prisma.InputJsonValue = { id: 'q3', type: 'drawing', prompt: '画一画', inputMode: 'handwriting', data: {}, children: [] };
/** 一条单选题的节点（客观题 ⇒ 不该有分析）。 */
const CHOICE_NODE: Prisma.InputJsonValue = { id: 'q2', type: 'single-choice', prompt: '选一个', inputMode: 'keyboard', data: {}, children: [] };

async function seedWorksheet(prisma: PrismaClient, nodes: Prisma.InputJsonValue[]) {
  return prisma.worksheet.create({
    data: { title: '学习单', content: { schemaVersion: 1, nodes }, settings: {} },
  });
}

/**
 * 起一个只挂 worksheets 路由的 app。
 *
 * 🔴 **默认不挂 gate**（= 跳过 `requireTeacher`）—— 与 `history-traces.test.ts` 同一条做法：
 * 接线用例测的是**字段名与分母**，不是鉴权。挂上 gate 的话每个请求都要教师凭据，
 * 而那与这些用例要证的事无关。
 * ⚠️ 唯一要测鉴权的那一条（学生 token 必须 403）**显式**传 `withGate: true` ——
 * 那条边只有真的挂上 gate 才证得了。
 */
async function withServer(prisma: PrismaClient, opts: { withGate?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  if (opts.withGate) app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  else app.use('/api/worksheets', worksheetRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}

test('🔴 标准模式：covered / total 按参与者数（不是「作答过的人数」）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;

  const worksheet = await seedWorksheet(p, [SHORT_ANSWER_NODE]);
  const classroom = await p.classroom.create({ data: { title: '课', code: '7001', status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const a = await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const b = await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const ra = await p.worksheetResponse.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: a.id } });
  await p.worksheetResponse.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: b.id } });
  // a 交了、b 没交
  await p.worksheetAnswer.create({
    data: { responseId: ra.id, questionId: 'q1', status: 'submitted', value: { format: 'text/v1', text: '我的答案' } },
  });

  const srv = await withServer(p);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1`, { method: 'POST' });
  // ⚠️ 不能写成 `assert.equal(res.status, 200, await res.text())` —— message 参数**先求值**，
  // 那次 `text()` 会把 body 读掉，紧接着的 `res.json()` 就抛「Body has already been read」，
  // 而**失败信息会指向一个与真因无关的地方**。先判状态，只在失败时才读 body。
  if (res.status !== 200) assert.fail(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.covered, 1, '只有一个人交了');
  assert.equal(body.total, 2, '分母是参与者数 —— 没交的人也算分母');
  assert.equal(body.payloadKind, 'text');
  assert.match(String(body.text), /我的答案/);
  assert.doesNotMatch(String(body.text), /未命名参与者/, 'a 没有真实姓名时用占位名，但不该印 id 之外的怪东西');
});

test('🔴 高级模式：分母只算「解析到这份学习单」的组（3 组里只有 2 组配了它）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;

  const worksheet = await seedWorksheet(p, [SHORT_ANSWER_NODE]);
  const other = await seedWorksheet(p, [SHORT_ANSWER_NODE]);
  const classroom = await p.classroom.create({ data: { title: '课', code: '7002', status: 'active', mode: 'advanced' } });
  const g1 = await p.classroomGroup.create({ data: { classroomId: classroom.id, name: '一组' } });
  const g2 = await p.classroomGroup.create({ data: { classroomId: classroom.id, name: '二组' } });
  const g3 = await p.classroomGroup.create({ data: { classroomId: classroom.id, name: '三组' } });
  // 只有一组、二组配了这份；三组配的是**另一份**
  await p.classroomGroupMaterial.create({ data: { groupId: g1.id, kind: 'worksheet', targetId: worksheet.id } });
  await p.classroomGroupMaterial.create({ data: { groupId: g2.id, kind: 'worksheet', targetId: worksheet.id } });
  await p.classroomGroupMaterial.create({ data: { groupId: g3.id, kind: 'worksheet', targetId: other.id } });
  for (const g of [g1, g2, g3]) {
    await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: g.id } });
  }

  const srv = await withServer(p);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1`, { method: 'POST' });
  // ⚠️ 不能写成 `assert.equal(res.status, 200, await res.text())` —— message 参数**先求值**，
  // 那次 `text()` 会把 body 读掉，紧接着的 `res.json()` 就抛「Body has already been read」，
  // 而**失败信息会指向一个与真因无关的地方**。先判状态，只在失败时才读 body。
  if (res.status !== 200) assert.fail(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.total, 2, '三组里只有两组该答这份 —— 分母是 2 不是 3（算成 3 会让教师以为有一组没交）');
  assert.equal(body.covered, 0);
});

test('还没算过时 GET ⇒ 404（不是空载荷）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const worksheet = await seedWorksheet(db.prisma, [SHORT_ANSWER_NODE]);
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1`);
  assert.equal(res.status, 404);
});

test('题不在学习单里 ⇒ POST 404', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const worksheet = await seedWorksheet(db.prisma, [SHORT_ANSWER_NODE]);
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/nope`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('🔴 客观题 ⇒ POST 400（闸门外，不该产出载荷）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const worksheet = await seedWorksheet(db.prisma, [CHOICE_NODE]);
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q2`, { method: 'POST' });
  assert.equal(res.status, 400, '客观题本来就判分，看板的 ✓/✗ 已经回答了问题');
});

test('没算过时取联系表 ⇒ 404', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const worksheet = await seedWorksheet(db.prisma, [SHORT_ANSWER_NODE]);
  const srv = await withServer(db.prisma);
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1/sheet/0`);
  assert.equal(res.status, 404);
});

test('🔴 重算**不清空** AI 字段（将来 AI 写进去的解读不该被「重新生成」抹掉）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const worksheet = await seedWorksheet(p, [SHORT_ANSWER_NODE]);
  const classroom = await p.classroom.create({ data: { title: '课', code: '7003', status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });

  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1`, { method: 'POST' });

  // 假装 AI 已经写过解读（本版不写，但结构已留）
  await p.worksheetQuestionAnalysis.update({
    where: { worksheetId_questionId: { worksheetId: worksheet.id, questionId: 'q1' } },
    data: { narrative: 'AI 写的解读', model: 'some-model' },
  });

  await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q1`, { method: 'POST' });
  const row = await p.worksheetQuestionAnalysis.findUnique({
    where: { worksheetId_questionId: { worksheetId: worksheet.id, questionId: 'q1' } },
  });
  assert.equal(row?.narrative, 'AI 写的解读', '重算不该把 AI 的解读抹掉 —— 而抹掉是静默的');
  assert.equal(row?.model, 'some-model');
  assert.ok(row?.computedAt, '重算要更新 computedAt');
});

test('🔴 安全边界：学生 token 打这三条路径一律 403（它们不是「恰好两段」）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const worksheet = await seedWorksheet(p, [SHORT_ANSWER_NODE]);
  const classroom = await p.classroom.create({ data: { title: '课', code: '7004', status: 'active', mode: 'standard' } });
  const participant = await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const token = createStudentToken(classroom.id, participant.id);

  const srv = await withServer(p, { withGate: true });
  t.after(() => srv.close());
  const paths: Array<[string, string]> = [
    [`/api/worksheets/${worksheet.id}/analysis/q1`, 'POST'],
    [`/api/worksheets/${worksheet.id}/analysis/q1`, 'GET'],
    [`/api/worksheets/${worksheet.id}/analysis/q1/sheet/0`, 'GET'],
  ];
  for (const [url, method] of paths) {
    const res = await fetch(`${srv.base}${url}`, { method, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 403, `${method} ${url} 必须 403 —— 它带全班学生的作答，不能开给学生`);
  }
});

test('🔴 联系表的成功路径：真 PNG + 正确的 content-type（此前只有 404 那条被覆盖）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;

  const worksheet = await seedWorksheet(p, [DRAWING_NODE]);
  const classroom = await p.classroom.create({ data: { title: '课', code: '7005', status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const a = await p.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const ra = await p.worksheetResponse.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: a.id } });
  await p.worksheetAnswer.create({
    data: {
      responseId: ra.id, questionId: 'q3', status: 'submitted',
      value: {
        format: 'ink/v1', canvas: { w: 320, h: 240 },
        strokes: [{ points: [[0.1, 0.1], [0.9, 0.9]], width: 0.01, color: '#111111' }],
      },
    },
  });

  const srv = await withServer(p);
  t.after(() => srv.close());
  const post = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q3`, { method: 'POST' });
  if (post.status !== 200) assert.fail(`POST HTTP ${post.status}: ${await post.text()}`);
  const payload = await post.json() as Record<string, unknown>;
  assert.equal(payload.payloadKind, 'image', '全笔迹 ⇒ 联系表');
  assert.equal(payload.covered, 1);
  assert.equal(payload.text, null, '形态是 image 时不给文档');
  assert.equal((payload.sheetLayouts as unknown[]).length, 1);
  assert.equal((payload.entries as Array<{ anonLabel: string }>)[0].anonLabel, 'User_001', '伪名按格序派生');

  const sheet = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q3/sheet/0`);
  assert.equal(sheet.status, 200);
  assert.equal(sheet.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await sheet.arrayBuffer());
  assert.ok(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), '必须是真 PNG');
  assert.equal(sheet.headers.get('x-analysis-labels'), null, '本机能画标签 ⇒ 不该带「无标签」那个头');

  // 越界的张号 ⇒ 404（不是 500、不是空图）
  const beyond = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q3/sheet/9`);
  assert.equal(beyond.status, 404);

  // GET 是同一个载荷（从落库的 aggregate 重建），与 POST 那次的结构一致
  const got = await fetch(`${srv.base}/api/worksheets/${worksheet.id}/analysis/q3`);
  assert.equal(got.status, 200);
  const again = await got.json() as Record<string, unknown>;
  assert.equal(again.payloadKind, 'image');
  assert.equal(again.covered, 1);
  assert.equal(again.total, 1);
  assert.deepEqual(again.entries, payload.entries, '同一份 aggregate 重读出的条目必须一致');
});
