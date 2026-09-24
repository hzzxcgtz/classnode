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

/**
 * M5a：课堂级「锁定作答」的三个端点、广播与「恢复即解锁」。
 *
 * 这是这一批**唯一**的自动化回归网（规格 §6 的「能自动验的」那一栏）——
 * 学生端与教师端的实际表现本机一条都验不了（GC 24），所以服务端这一侧必须钉死。
 *
 * 三块重点：
 *   ① **幂等且总是广播**（裁定 R5）：已经锁着再锁一次也 200，**并且照样发一次广播**。
 *      客户端的状态可能与服务端不同步（另一个标签页、刚重连）⇒ 一次多余的广播是**自愈**。
 *      用例 2 钉的是这一条 —— 少了它，「再锁一次不广播」这个更省事的实现也能全绿。
 *   ② **恢复即解锁**（规格 §3.4）：`ended → active` 时锁自动解开。理由：锁的目的是停笔，
 *      而恢复课堂是重新开始上课，仍停笔自相矛盾。
 *   ③ **404 不许广播**（用例 4，阴性对照）：把「课堂不存在」也广播出去的话，
 *      在线的学生会被一个不存在的课堂名推着改状态。
 *
 * ⚠️ 快照那一半（`GET /code/:code` 里的 `answersLocked`）**不在本文件**：
 * 它属于学生端会话那条路，回归网在别处（`GET /code/:code` 需要真实的学生令牌与码）。
 *
 * ⚠️ 这个文件用**真 Prisma + 真 SQLite**（照 `worksheet-routes.test.ts`）。
 * 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，用例开头第一件事就是断言这一点 ——
 * 本项目出过一次「`db push` 打在真实库上」的事故，那条断言是它的直接产物（GC 4 / 20）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/node_modules/.bin/prisma（dist/tests → server 根） */
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

interface TempDb {
  prisma: PrismaClient;
  dir: string;
}

async function openTempDb(): Promise<TempDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-answers-lock-'));
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
  return { prisma, dir };
}

/** 收集到的广播调用，用于断言「发给谁、什么事件」。 */
type Emitted = { room: string; event: string };

interface Harness {
  post: (pathname: string) => Promise<Response>;
  emits: Emitted[];
}

/**
 * 起真实路由 + **捕获式的假 io**（照 `classroom-module-state-route.test.ts` 的形状）。
 *
 * ⚠️ 这里**不加教师闸门**：`index.ts` 是按 `requireTeacher` 逐个包的，路由自己不鉴权。
 * 本文件验的是端点行为，不是鉴权；鉴权那一层由 `classroom-module-state-route.test.ts`
 * 与 `index.ts` 的挂载断言各自盯着。
 */
async function startServer(
  t: { after: (fn: () => void) => void },
  prisma: PrismaClient,
): Promise<Harness> {
  const emits: Emitted[] = [];
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', {
    to: (room: string) => ({
      emit: (event: string) => {
        emits.push({ room, event });
      },
    }),
  });
  app.use('/api/classroom', classroomRoutes);
  // 兜底 404 一律回 JSON：express 默认回的是 HTML，断言失败时 `await res.json()` 会抛
  // `Unexpected token '<'`，把「状态码不对」这个真正的原因盖成一句解析错误。
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return {
    post: (pathname: string) =>
      fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    emits,
  };
}

/** 每个用例自带一个临时库与一个服务端（照 `worksheet-routes.test.ts` 的既有写法）。 */
async function withServer(t: { after: (fn: () => void) => void }) {
  const db = await openTempDb();
  t.after(async () => {
    await db.prisma.$disconnect();
    fs.rmSync(db.dir, { recursive: true, force: true });
  });
  const server = await startServer(t, db.prisma);
  return { ...server, prisma: db.prisma };
}

/** 这一条事件名被广播到了哪些房间（顺序无关，按集合断言）。 */
function roomsFor(emits: Emitted[], event: string): string[] {
  return emits.filter((e) => e.event === event).map((e) => e.room).sort();
}

test('M5a · 锁定：POST lock-answers ⇒ 200、库里为 true、两个房间各一条 answers-locked', async (t) => {
  const { post, prisma, emits } = await withServer(t);
  const classroom = await prisma.classroom.create({ data: {} });

  // 前置条件：默认未锁定（规格 §6 的「`answersLocked` 默认 `false`」）。
  const before = await prisma.classroom.findUnique({ where: { id: classroom.id } });
  assert.equal(before?.answersLocked, false, '新建课堂必须默认未锁定');

  const res = await post(`/api/classroom/${classroom.id}/lock-answers`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.answersLocked, true, '响应体应当是更新后的 classroom 行');

  // 🔴 直接查库，不靠响应体 —— 响应体对了而库里没写是可能的（那个 bug 我们要能看见）。
  const after = await prisma.classroom.findUnique({ where: { id: classroom.id } });
  assert.equal(after?.answersLocked, true);

  assert.deepEqual(
    roomsFor(emits, 'answers-locked'),
    [`classroom:${classroom.id}`, `teacher:${classroom.id}`].sort(),
    '学生房间与教师房间都必须收到 answers-locked',
  );
});

test('M5a · 幂等：已经锁着再锁一次 ⇒ 仍然 200，且仍然广播（客户端自愈靠它）', async (t) => {
  const { post, prisma, emits } = await withServer(t);
  const classroom = await prisma.classroom.create({ data: {} });

  const first = await post(`/api/classroom/${classroom.id}/lock-answers`);
  assert.equal(first.status, 200);
  const emitsAfterFirst = emits.length;

  const second = await post(`/api/classroom/${classroom.id}/lock-answers`);
  assert.equal(second.status, 200, '幂等：已经锁着再锁一次也是 200');
  assert.equal(
    emits.length - emitsAfterFirst,
    2,
    '再广播一次才是幂等的意义所在 —— 少了它，状态不同步的客户端永远不会自愈',
  );
  assert.deepEqual(
    roomsFor(emits, 'answers-locked'),
    [`classroom:${classroom.id}`, `teacher:${classroom.id}`, `classroom:${classroom.id}`, `teacher:${classroom.id}`].sort(),
  );
});

test('M5a · 解锁：POST unlock-answers ⇒ 200、库里为 false、两个房间各一条 answers-unlocked', async (t) => {
  const { post, prisma, emits } = await withServer(t);
  const classroom = await prisma.classroom.create({ data: { answersLocked: true } });

  const res = await post(`/api/classroom/${classroom.id}/unlock-answers`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.answersLocked, false);

  const after = await prisma.classroom.findUnique({ where: { id: classroom.id } });
  assert.equal(after?.answersLocked, false);

  assert.deepEqual(
    roomsFor(emits, 'answers-unlocked'),
    [`classroom:${classroom.id}`, `teacher:${classroom.id}`].sort(),
  );
  assert.deepEqual(roomsFor(emits, 'answers-locked'), [], '解锁不许顺手广播锁定');
});

test('M5a · 不存在的课堂 ⇒ 404，且一条广播都不许发（阴性对照）', async (t) => {
  const { post, emits } = await withServer(t);

  const lock = await post('/api/classroom/does-not-exist/lock-answers');
  assert.equal(lock.status, 404);
  // 🔴 断言的是 **handler 自己那句**，不是「状态码是 404」——后者路由整个不存在时也成立
  // （express 的兜底也回 404），那样这条用例就分不出「端点答了 404」与「端点没有」。
  assert.equal((await lock.json()).error, '课堂不存在');
  const unlock = await post('/api/classroom/does-not-exist/unlock-answers');
  assert.equal(unlock.status, 404);
  assert.equal((await unlock.json()).error, '课堂不存在');

  assert.deepEqual(emits, [], '404 也广播的话，在线学生会被一个不存在的课堂推着改状态');
});

test('M5a · 恢复即解锁：ended → restore ⇒ 库里 answersLocked 变回 false', async (t) => {
  const { post, prisma } = await withServer(t);
  const classroom = await prisma.classroom.create({
    data: { status: 'ended', code: 'A1B2', answersLocked: true },
  });

  // 前置条件：锁真的在（否则下面那句 assert 会因为「本来就是 false」而假绿）。
  const before = await prisma.classroom.findUnique({ where: { id: classroom.id } });
  assert.equal(before?.answersLocked, true, '前置条件：这间课堂进来时是锁着的');

  const res = await post(`/api/classroom/${classroom.id}/restore`);
  assert.equal(res.status, 200);
  const after = await prisma.classroom.findUnique({ where: { id: classroom.id } });
  assert.equal(after?.status, 'active', '前置条件：恢复真的发生了');
  assert.equal(after?.answersLocked, false, '恢复课堂 = 重新开始上课 ⇒ 顺手解锁');
});
