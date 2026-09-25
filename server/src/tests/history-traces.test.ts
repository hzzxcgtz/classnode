/**
 * M6c：`/history/all` 那三件套的聚合 —— `loadHistoryTraces` 的唯一回归网。
 *
 * 跑法：
 * ```bash
 * pnpm build:server && node --test server/dist/tests/history-traces.test.js
 * ```
 *
 * 🔴 它测的是**那个聚合函数**，不是端点（端点要起服务器，而聚合里的判据才是会错的地方）：
 *   · **空表**：一节从没人用过探究空间、也没人作答过的课 ⇒ 四个数都必须是 `0`，
 *     而**查询不许报错**（`SUM` 对空集回 `NULL`，没 `COALESCE` 就会得到一个 `null` 而**不报错** ——
 *     那个 `null` 会在前端渲染成空白，看起来像「还没加载」）；
 *   · **不串课堂**：两节课各自的数据不能互相污染（GC 35「一轮查完、不许 N+1」的语义正确性）。
 *
 * ⚠️ 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，开头第一件事就断言这一点（GC 4 / 20）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadHistoryTraces } from '../routes/classroom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-history-traces-'));
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

/** 一节课堂 + 一个参与者 + 一份学习单的关联行（作答行要 responseId，所以都得建）。 */
async function seedClassroomWithWorksheet(prisma: PrismaClient, code: string) {
  const classroom = await prisma.classroom.create({ data: { title: `课堂 ${code}`, code, status: 'ended' } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const worksheet = await prisma.worksheet.create({ data: { title: '学习单', content: { schemaVersion: 1, nodes: [] }, settings: {} } });
  const response = await prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id },
  });
  return { classroom, participant, worksheet, response };
}

test('🔴 空表：两样都没有 ⇒ 四个数都是 0（`SUM` 对空集回 NULL，没 COALESCE 会得到 null 而不报错）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const { classroom } = await seedClassroomWithWorksheet(db.prisma, '9001');
  const traces = await loadHistoryTraces(db.prisma, [classroom.id]);
  const entry = traces.get(classroom.id);
  assert.ok(entry, '每一个传进去的 id 都要有一个条目（哪怕是全 0）');
  assert.deepEqual(entry, { webappUsageCount: 0, webappDurationMs: 0, worksheetSubmitted: 0, worksheetTotal: 0 });
});

test('★ 有数据：3 人用过探究空间（一个人用了两个网页）/ 时长 700；学习单 2 交 1 草稿', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const { classroom, participant, response } = await seedClassroomWithWorksheet(db.prisma, '9002');
  const webapp = await db.prisma.webapp.create({ data: { name: '网页', entryPath: 'index.html' } });
  // 🔴 `WebappUsage` 的唯一约束是 `(classroomId, studentId, webappId)` ⇒ 一个参与者对一个网页**只能一行**。
  //    所以「3 行」= 3 个不同的参与者各一行（这也是为什么列上的数是 `COUNT(DISTINCT studentId)`）。
  const others = await Promise.all([1, 2].map(() =>
    db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } })));
  const people = [participant.id, ...others.map((o) => o.id)];
  for (let i = 0; i < 3; i++) {
    await db.prisma.webappUsage.create({
      data: { classroomId: classroom.id, webappId: webapp.id, studentId: people[i], durationMs: (i + 1) * 100, frameCount: 1 },
    });
  }
  // ★ 钉住 DISTINCT：同一个人**第二个网页**再加一行 ⇒ 行数变 4，而「用过探究空间的人」仍是 3。
  const webapp2 = await db.prisma.webapp.create({ data: { name: '网页 2', entryPath: 'index.html' } });
  await db.prisma.webappUsage.create({
    data: { classroomId: classroom.id, webappId: webapp2.id, studentId: people[0], durationMs: 100, frameCount: 1 },
  });
  await db.prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q1', status: 'submitted', value: { format: 'text/v1', text: 'a' } } });
  await db.prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q2', status: 'submitted', value: { format: 'text/v1', text: 'b' } } });
  await db.prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q3', status: 'draft', value: { format: 'text/v1', text: 'c' } } });

  const entry = (await loadHistoryTraces(db.prisma, [classroom.id])).get(classroom.id);
  assert.equal(entry?.webappUsageCount, 3, '用过探究空间的**人**是 3（不是 4 行 —— 一个人用两个网页只算一个人）');
  assert.equal(entry?.webappDurationMs, 700, '时长是**逐行**相加（一个人两个网页要两段都算）');
  assert.equal(entry?.worksheetSubmitted, 2, '只有 status=submitted 的算交');
  assert.equal(entry?.worksheetTotal, 3);
});

test('🔴 不串课堂：两节各自的数据互不污染（「一轮查完」的语义正确性）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const a = await seedClassroomWithWorksheet(db.prisma, '9003');
  const b = await seedClassroomWithWorksheet(db.prisma, '9004');
  const webapp = await db.prisma.webapp.create({ data: { name: '网页', entryPath: 'index.html' } });
  await db.prisma.webappUsage.create({ data: { classroomId: a.classroom.id, webappId: webapp.id, studentId: a.participant.id, durationMs: 500, frameCount: 1 } });
  await db.prisma.worksheetAnswer.create({ data: { responseId: b.response.id, questionId: 'q1', status: 'submitted', value: { format: 'text/v1', text: 'x' } } });

  const traces = await loadHistoryTraces(db.prisma, [a.classroom.id, b.classroom.id]);
  assert.equal(traces.get(a.classroom.id)?.webappUsageCount, 1);
  assert.equal(traces.get(a.classroom.id)?.worksheetTotal, 0, 'A 的学习单数不能被 B 的污染');
  assert.equal(traces.get(b.classroom.id)?.webappUsageCount, 0, 'B 的探究空间数不能被 A 的污染');
  assert.equal(traces.get(b.classroom.id)?.worksheetSubmitted, 1);
});

test('★ ids 为空数组 ⇒ 回空 Map（与既有那条聚合同一条守卫：不发查询）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const traces = await loadHistoryTraces(db.prisma, []);
  assert.equal(traces.size, 0);
});
