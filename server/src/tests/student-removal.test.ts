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
import classRoutes from '../routes/classes.js';

/**
 * 「把学生从名册里去掉」与「把他整个人删掉」是**两件事**（★ 2026-10-09 教师裁定）。
 *
 * 🔴 起因（审计 §B1）：名册上那个 × 一直是**裸 `prisma.student.delete`** —— 而
 *    `Student` →(Cascade) `ClassroomStudent` →(Cascade) `Message` / `WorksheetResponse`
 *    →(Cascade) `WorksheetAnswer`（见 `schema.prisma` 的三条外键）⇒ 教师按日常名册维护的
 *    预期（「这学期他不在我这个班了」）点下去，**上个学期（含已结束课堂）的对话与作答一起没了**。
 *    紧挨其上 100 行的「删班级」反倒有守卫（有关联课堂就拒绝）—— 两条路的口径原来是反的。
 *
 * 裁定：拆成两个动作，各自把后果说清楚。
 *   · **移出班级** ⇒ 只断开名册归属（`Student.classId = null`），**一个字节的历史都不动**；
 *   · **彻底删除** ⇒ 保留原来的级联行为（那条路是**刻意**要删干净的），弹窗必须写明。
 *
 * ⚠️ 本文件用**真 Prisma + 真 SQLite**（照 `classroom-answers-lock.test.ts`）：这条修复的
 *    全部意义就在**数据到底还在不在**，而那是只有真库能回答的问题。
 * ⚠️ 「移出」那一条断言的是**三张表都还在**，不只是「学生行还在」——
 *    链子是 `Student → ClassroomStudent → Message / WorksheetResponse`，
 *    只保住第一环而后面断了，屏幕上照样是空课堂。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

interface TempDb { prisma: PrismaClient; dir: string }

async function openTempDb(): Promise<TempDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-student-removal-'));
  const file = path.join(dir, 'test.db');
  const url = `file:${file}`;
  // 🔴 安全闸门（不是装饰）：保证下面那次 db push 不可能落在真实库上。
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), `DATABASE_URL 必须指向临时目录，实际是 ${url}`);
  assert.notEqual(path.resolve(file), path.resolve(HERE, '../../prisma/dev.db'));
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { prisma, dir };
}

interface Harness {
  get: (pathname: string) => Promise<Response>;
  post: (pathname: string) => Promise<Response>;
  del: (pathname: string) => Promise<Response>;
}

async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { to: () => ({ emit: () => {} }) });
  app.use('/api/classes', classRoutes);
  // 兜底 404 一律回 JSON（express 默认回 HTML，会把「路由不存在」盖成一句 JSON 解析错误）。
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    get: (p) => fetch(`${base}${p}`),
    post: (p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    del: (p) => fetch(`${base}${p}`, { method: 'DELETE' }),
  };
}

/** 一间课堂 + 一名学生 + 一轮对话 + 一份学习单作答 —— 「历史」的最小完整形状。 */
async function seedStudentWithHistory(prisma: PrismaClient) {
  const klass = await prisma.class.create({ data: { name: '一班' } });
  const student = await prisma.student.create({ data: { classId: klass.id, name: '张伟', studentNo: '7' } });
  const classroom = await prisma.classroom.create({ data: { title: '公开课' } });
  const participant = await prisma.classroomStudent.create({
    data: { classroomId: classroom.id, studentId: student.id, type: 'student' },
  });
  const message = await prisma.message.create({
    data: { classroomId: classroom.id, studentId: participant.id, content: '光合作用是什么？', role: 'user' },
  });
  const worksheet = await prisma.worksheet.create({
    data: { title: '学习单', content: { questions: [] }, settings: {} },
  });
  const response = await prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id },
  });
  return { klass, student, classroom, participant, message, response };
}

/** 这名学生身上还挂着几样历史（移出班级之后必须**一样不少**）。 */
async function historyCounts(prisma: PrismaClient, studentId: string) {
  const participant = await prisma.classroomStudent.findFirst({ where: { studentId } });
  return {
    participants: await prisma.classroomStudent.count({ where: { studentId } }),
    messages: participant ? await prisma.message.count({ where: { studentId: participant.id } }) : 0,
    responses: participant ? await prisma.worksheetResponse.count({ where: { participantId: participant.id } }) : 0,
    participantsInClass: participant
      ? await prisma.classroomStudent.count({ where: { studentId } })
      : 0,
  };
}

async function withServer(t: { after: (fn: () => void) => void }) {
  const db = await openTempDb();
  t.after(async () => {
    await db.prisma.$disconnect();
    fs.rmSync(db.dir, { recursive: true, force: true });
  });
  const server = await startServer(t, db.prisma);
  return { ...server, prisma: db.prisma };
}

test('🔴 移出班级：从名册里消失，但**一条历史都不许动**', async (t) => {
  const { post, get, prisma } = await withServer(t);
  const { klass, student } = await seedStudentWithHistory(prisma);
  assert.deepEqual(await historyCounts(prisma, student.id),
    { participants: 1, messages: 1, responses: 1, participantsInClass: 1 }, '前置：历史确实挂在他身上');

  const res = await post(`/api/classes/${klass.id}/students/${student.id}/remove`);
  assert.equal(res.status, 200);

  // ① 名册里没有了。
  const roster = await (await get(`/api/classes/${klass.id}/students`)).json() as Array<{ id: string }>;
  assert.deepEqual(roster.map((row) => row.id), [], '移出之后他还留在名册上 —— 教师点了一下什么也没发生');

  // ② 人还在（那正是历史的锚）。
  const after = await prisma.student.findUnique({ where: { id: student.id } });
  assert.ok(after, '学生行被删了 —— 「移出班级」把历史也一起带走了');
  assert.equal(after?.classId, null, '名册归属是靠 `classId` 断开的');
  assert.equal(after?.name, '张伟', '姓名等资料原样保留');

  // ③ 🔴 三张表一条都不能少（链子是 Student → ClassroomStudent → Message / WorksheetResponse）。
  assert.deepEqual(await historyCounts(prisma, student.id),
    { participants: 1, messages: 1, responses: 1, participantsInClass: 1 },
    '移出班级动到了历史数据 —— 上个学期（含已结束课堂）的对话与作答必须原样留着');
});

test('🔴 彻底删除：仍然级联清干净（这条路是**刻意**的，与移出班级是两件事）', async (t) => {
  const { del, prisma } = await withServer(t);
  const { klass, student } = await seedStudentWithHistory(prisma);

  const res = await del(`/api/classes/${klass.id}/students/${student.id}`);
  assert.equal(res.status, 200);

  const after = await prisma.student.findUnique({ where: { id: student.id } });
  assert.equal(after, null, '「彻底删除」必须真的把人删掉（弹窗已经写明会连历史一起删）');
  assert.deepEqual(await historyCounts(prisma, student.id),
    { participants: 0, messages: 0, responses: 0, participantsInClass: 0 },
    '级联没走完 —— 留着的对话/作答会变成指向不存在的人的孤儿行');
});

test('🔴 阴性对照：不是这个班的学生，两个动作都不许碰（防跨班误删）', async (t) => {
  const { post, del, prisma } = await withServer(t);
  const { student } = await seedStudentWithHistory(prisma);
  const otherClass = await prisma.class.create({ data: { name: '二班' } });

  // 拿**别的班**的 classId 去操作这名学生：两条路都必须拒绝，且什么都不改。
  assert.equal((await post(`/api/classes/${otherClass.id}/students/${student.id}/remove`)).status, 404);
  assert.equal((await del(`/api/classes/${otherClass.id}/students/${student.id}`)).status, 404);
  const after = await prisma.student.findUnique({ where: { id: student.id } });
  assert.equal(after?.classId, student.classId, '拒了却还是把人动了');
  assert.deepEqual(await historyCounts(prisma, student.id),
    { participants: 1, messages: 1, responses: 1, participantsInClass: 1 });
});
