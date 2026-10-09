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
import type { Response as ExpressResponse } from 'express';
import type { Server } from 'socket.io';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { setupSocketHandlers } from '../socket/index.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';

/**
 * 学习单**实时回传**（规格 §5.7 / §7.2）与教师的「已查看」（规格 §3-AA / §3-D）。
 *
 * 两块重点：
 *
 * ① 🔴 **广播载荷必须含 `questionId`**（规格 §5.7 末尾一句专门写了它）。
 *    教师看板格子的「正在做第 N 题」**只**靠这个字段（§7.4 的数据来源表）。
 *    缺了它看板只会显示一个笼统的进度，而**没有任何报错** —— 典型的「看起来成功」的坏数据。
 *    所以这里的断言不是「收到了事件」，而是**载荷里那个 id 就是我们刚保存的那道题**。
 *
 * ② 🔴 **广播必须发到教师看板**真在的那个房间。
 *    规格 §5.7 的示意图把这个房间写作 `classroom:<id>`，但代码里 `classroom:<id>` 是
 *    **学生**房间（`socket/index.ts` 的 `join-classroom` 里 `socket.join(...)`），
 *    教师看板加入的是 `teacher:<id>`（同一个文件的 `join-teacher-board`）。
 *    两者混淆不会有任何报错 —— 事件照发、日志干净、看板永远不动。
 *    所以本文件**不写死房间名**：它先用假 socket 跑一遍真实的 `join-teacher-board`，
 *    实测出「看板到底进了哪个房间」，再拿它与路由广播的房间对比（见
 *    `boardRoomFromSocketHandler` 与用例 ③）。这条对比就是那种静默错配的回归网。
 *
 * ⚠️ 这个文件用**真 Prisma + 真 SQLite**（照 worksheet-student.test.ts）。
 * 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，用例开头第一件事就是断言这一点 ——
 * 本项目出过一次「`db push` 打在真实库上」的事故，那条断言是它的直接产物。
 *
 * ⚠️ socket 这一层**不引依赖**：项目里没有 `socket.io-client`（那是前端的传递依赖，
 * 服务端不该借道解析它）。广播的接缝是 `req.app.get('io')` —— 与
 * `classroom-webapp-capture-route.test.ts` 同一个替身写法；房间那一半用
 * `socket-connection-lifecycle.test.ts` 的假 socket 写法，两条都跑的是真实代码。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/node_modules/.bin/prisma（dist/tests → server 根） */
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/prisma/build/index.js');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

interface TempDb {
  prisma: PrismaClient;
  file: string;
}

async function openTempDb(): Promise<TempDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-worksheet-realtime-'));
  const file = path.join(dir, 'test.db');
  const url = `file:${file}`;
  // 🔴 这条断言是安全闸门，不是装饰：它保证下面那次 db push 不可能落在真实库上。
  assert.ok(
    url.startsWith(`file:${os.tmpdir()}`),
    `DATABASE_URL 必须指向临时目录，实际是 ${url}`,
  );
  assert.notEqual(path.resolve(file), path.resolve(HERE, '../../prisma/dev.db'));
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [PRISMA_BIN, 'db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
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

/** 路由广播出去的一条（房间 + 事件 + 载荷）。 */
interface Broadcast {
  room: string;
  event: string;
  payload: Record<string, unknown>;
}

interface TestServer {
  get: (pathname: string, headers?: Record<string, string>) => Promise<globalThis.Response>;
  post: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<globalThis.Response>;
  put: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<globalThis.Response>;
  /** 教师 cookie —— 默认带在所有请求上（学生 token 会覆盖闸门的分支）。 */
  cookie: string;
  /** 本服务收到的全部广播（替身 io 记账）。 */
  broadcasts: Broadcast[];
}

/**
 * 起真实路由 + **真实的鉴权闸门**（`worksheetAccessGate`，index.ts 用的就是同一个函数），
 * 把 `io` 换成**记账替身** —— 它是本项目里路由拿 io 的**唯一**途径
 * （`req.app.get('io')`），所以这一层替身换掉的是「投递」，不是「广播这件事本身」。
 *
 * ⚠️ 替身只实现 `to(room).emit(event, payload)` 这一条链：路由若改用别的形状
 * （`io.sockets.…`、逐个 socket 发），这里会**当场抛错**而不是静默漏掉 —— 刻意的。
 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient): Promise<TestServer> {
  const broadcasts: Broadcast[] = [];
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', {
    to: (room: string) => ({
      emit: (event: string, payload: Record<string, unknown>) => { broadcasts.push({ room, event, payload }); },
    }),
  });
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  // 兜底 404 一律回 JSON：express 默认回的是 HTML，断言失败时 `await res.json()` 会抛
  // `Unexpected token '<'`，把「状态码不对」这个真正的原因盖成一句解析错误。
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const cookie = teacherCookie();
  const call = (method: string) => (pathname: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
  const get = (pathname: string, headers?: Record<string, string>) => call('GET')(pathname, undefined, headers);
  return {
    get,
    post: (pathname, body, headers) => call('POST')(pathname, body, headers),
    put: (pathname, body, headers) => call('PUT')(pathname, body, headers),
    cookie,
    broadcasts,
  };
}

/**
 * 实测「教师看板进了哪个房间」——返回**房间名前缀**（形如 `teacher:`）。
 *
 * 跑的是**真实的** `setupSocketHandlers` + 真实的 `join-teacher-board` 处理器，
 * 只把 socket/io 换成记录用的壳（照 `socket-connection-lifecycle.test.ts`）。
 * 这样一来 B4 的广播目标就不是从规格或注释里抄来的字符串，而是**从代码里量出来的** ——
 * 规格写 `classroom:<id>`、代码写 `teacher:<id>` 这类分歧只有这种断言能发现。
 *
 * ⚠️ 返回的是前缀而不是整串：本用例拿它去套**真实课堂的 uuid**（`classroom-1` 这个
 * 夹具 id 与数据库里的不是同一个），所以这里量的是「房间名怎么拼出来的」这件事本身。
 */
async function boardRoomPrefixFromSocketHandler(): Promise<string> {
  const roomCalls: string[] = [];
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const socket = {
    id: 'socket-1',
    rooms: new Set<string>(['socket-1']),
    handshake: { headers: { cookie: teacherCookie() } },
    data: {} as Record<string, unknown>,
    join(room: string) { roomCalls.push(room); },
    leave(_room: string) { /* 本用例不制造 stale 房间，路径不走这里 */ },
    emit(_event: string, _payload?: unknown) { /* 鉴权成功时无 emit */ },
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, handler); },
  };

  const connectionHandlers: ((s: typeof socket) => void)[] = [];
  const io = {
    on(event: string, handler: (s: typeof socket) => void) {
      if (event === 'connection') connectionHandlers.push(handler);
    },
  };
  setupSocketHandlers(io as unknown as Server, {} as unknown as PrismaClientType);

  assert.equal(connectionHandlers.length, 1, 'setupSocketHandlers 应当注册恰好一个 connection 回调');
  connectionHandlers[0](socket);

  const handler = handlers.get('join-teacher-board');
  assert.ok(handler, 'connection 回调应当注册 join-teacher-board 处理器');
  await (handler as unknown as (classroomId: string) => Promise<void>)('classroom-1');

  // 夹具只放了一个房间 `socket-1`（自己的 id），没有任何 stale 房间 —— 所以这一路
  // 只该 join 一次、且不该 leave 任何东西。
  assert.equal(roomCalls.length, 1, `join-teacher-board 应当恰好 join 一个房间，实际：${roomCalls.join(',')}`);
  const room = roomCalls[0];
  assert.ok(room.endsWith('classroom-1'), `房间名应当以课堂 id 结尾，实际 ${room}`);
  // 'classroom-1' 是夹具 id，量出来的前缀拿去套真实 uuid。
  return room.slice(0, room.length - 'classroom-1'.length);
}

const SAMPLE_CONTENT = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'q_1',
      type: 'single-choice',
      prompt: '光合作用需要哪些条件？',
      inputMode: 'keyboard',
      data: { options: [{ key: 'A', text: '只有水' }, { key: 'B', text: '光能和二氧化碳' }], correctKeys: ['B'] },
      children: [],
    },
    {
      id: 'q_2',
      type: 'fill-blank',
      prompt: '水的化学式是____',
      inputMode: 'keyboard',
      data: { answers: ['H2O'] },
      children: [],
    },
    {
      id: 'q_3',
      type: 'short-answer',
      prompt: '说说你观察到的现象。',
      inputMode: 'keyboard',
      data: {},
      children: [],
    },
  ],
};

const SAMPLE_SETTINGS = { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' };

async function seedWorksheet(
  prisma: PrismaClient,
  title = '光合作用学习单',
  settings: Record<string, unknown> = SAMPLE_SETTINGS,
) {
  return prisma.worksheet.create({
    data: { title, description: '第一课时', content: SAMPLE_CONTENT, settings: settings as never },
  });
}

/** 一间课堂 + 一个参与者，且该课堂**正在用**这份学习单（课堂级关联）。 */
async function seedClassroomUsingWorksheet(prisma: PrismaClient, code: string) {
  const worksheet = await seedWorksheet(prisma);
  const classroom = await prisma.classroom.create({ data: { code, title: '测试课堂', mode: 'standard' } });
  await prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  return { worksheet, classroom, participant };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const CHOICE = (selected: string[]) => ({ format: 'choice/v1', selected });

// ---------------------------------------------------------------------------
// ① 鉴权：`POST /:id/review` 是**教师专用**（规格 §5.3 末尾那一段）
// ---------------------------------------------------------------------------

/**
 * 🔴 学生 token 打 `review` 必须是 **403**，且**一个字都不许落库**。
 *
 * 这是本任务的第一条红线：`review` 是「老师已看过我的作业」这个信号的**唯一**写入口，
 * 学生能伪造它，教师看板的「已看 N/M」就是假的 —— 而看板不会报错，只会显示一个
 * 老师以为自己点过、其实没点过的数字。
 *
 * 三层断言，缺一层就是假绿：
 *   · 学生 token ⇒ 403（闸门拦下）；
 *   · 库里那张答案行的 `reviewedAt` **还是 null**（403 之后仍有副作用是最坏的一种）；
 *   · **教师 cookie ⇒ 200 且真的写上了**（少了这一层，一个「review 永远 403」的实现
 *     也能让上面两条全绿 —— 而那正是把功能整个关掉）。
 */
test('鉴权：学生 token 打 review 必须 403 且不落库，教师 cookie 必须 200 且真的写上', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9101');
  const token = createStudentToken(classroom.id, participant.id);
  // 先让这名学生真的答一题 —— 否则「没有落库」可能只是因为压根没有可写的行。
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  assert.equal(await db.prisma.worksheetAnswer.count(), 1, '夹具前提：这一行必须存在');

  const asStudent = await server.post(
    `/api/worksheets/${worksheet.id}/review`,
    { participantId: participant.id, questionId: 'q_1' },
    bearer(token),
  );
  const studentBody = await asStudent.json() as { error?: string };
  assert.equal(
    asStudent.status,
    403,
    `学生不得伪造「老师已查看」：${JSON.stringify(studentBody)}`,
  );

  const untouched = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.equal(untouched.reviewedAt, null, '被拒的请求不得留下任何痕迹（reviewedAt 必须还是 null）');

  // ── 阳性对照：同一请求换成教师 cookie 必须 200，且真的写进库里 ──────────────
  const asTeacher = await server.post(
    `/api/worksheets/${worksheet.id}/review`,
    { participantId: participant.id, questionId: 'q_1' },
  );
  assert.equal(asTeacher.status, 200, `教师必须能标记：${await asTeacher.text()}`);
  const marked = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.ok(marked.reviewedAt, '教师这一支必须真的写 reviewedAt —— 否则上面那条 403 什么都没证明');
});

// ---------------------------------------------------------------------------
// ② 「已查看」的语义（规格 §3-AA）：重复调用是**刷新**，不是「第一次有效」
// ---------------------------------------------------------------------------

/**
 * 教师连点两次「标记已查看」是正常形态（手抖、界面没给反馈、换台设备再看一遍）。
 * `reviewedAt` 是「**最后**一次查看的时间」—— 幂等地保留第一次会让
 * 「这题我刚看过」显示成一个几分钟前的时间戳，而看板正是靠它排序/高亮的。
 */
test('已查看：第一次写 reviewedAt，第二次调用刷新为新时间', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9102');
  const token = createStudentToken(classroom.id, participant.id);
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_3', value: { format: 'text/v1', text: '叶子冒泡' } }, bearer(token));

  const review = () => server.post(`/api/worksheets/${worksheet.id}/review`, { participantId: participant.id, questionId: 'q_3' });

  const first = await review();
  const firstBody = await first.json() as { reviewedAt?: string };
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  assert.ok(firstBody.reviewedAt, '响应体要把时间戳带回来（看板当场更新那一格，不必再拉一次列表）');
  const firstAt = new Date(String(firstBody.reviewedAt));

  const storedFirst = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.ok(storedFirst.reviewedAt, '第一次调用必须落库');
  assert.equal(storedFirst.reviewedAt?.getTime(), firstAt.getTime(), '响应体与库里必须是同一个时间');

  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await review();
  const secondBody = await second.json() as { reviewedAt?: string };
  assert.equal(second.status, 200, JSON.stringify(secondBody));
  const secondAt = new Date(String(secondBody.reviewedAt));

  assert.ok(
    secondAt.getTime() > firstAt.getTime(),
    `第二次调用必须把时间**刷新**（幂等保留第一次会让「刚看过」显示成旧时间）：${firstAt.toISOString()} → ${secondAt.toISOString()}`,
  );
  const storedSecond = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.equal(storedSecond.reviewedAt?.getTime(), secondAt.getTime());
  // 标记「已查看」只动这一列：答案本身与提交状态都不该被顺手改掉。
  assert.equal(storedSecond.status, 'draft');
  assert.deepEqual(storedSecond.value, { format: 'text/v1', text: '叶子冒泡' });
});

/**
 * 边界：教师在**道还没作答的题**上点「已查看」。
 *
 * 🔴 **这是一个待裁定的语义点**（B4 brief 第 3 条）。控制器的倾向是「建一行、
 * `status: 'unanswered'`、只填 `reviewedAt`」；本实现选择了「拒绝」，
 * 因为建行会把「答过了」这条判据变成一个假信号 —— `POST /:id/answers/submit` 的
 * 前置检查只问「这一行在不在」（`if (!answer) return 400`），凭空建出来的空行
 * 会让**从未作答**的题可以提交，进而在教师看板上记成「已提交 · 答错」，并推进整卷进度。
 * 那正是仓库里反复出现的那类**坏数据**（看板的唯一数据源就是这些行）。
 *
 * 也就是说：控制器担心的「`value` 为 null 的行被下游当成『答过了』」**真的存在**
 * （不在 `PUT` 的 upsert 上 —— 那一条是好的，`update` 分支会把 `status` 拨回 `draft`；
 * 而在 `submit` 的前置检查上），所以按 brief 的要求**停下来报告**，此处取
 * 「不伪造数据」的一侧。控制器的裁定若不同，改法是：这里建
 * `WorksheetResponse` + `WorksheetAnswer(status:'unanswered', reviewedAt)` 两行，
 * 并把 `submit` 的前置检查改成 `if (!answer || answer.status === 'unanswered')`；
 * 本用例随之改成断言 200 与那两行的存在。
 *
 * ⚠️ 与它并排的阳性对照（同一间课堂里**已作答**的题必须 200）不能省：
 * 少了它，一个「review 永远 409」的实现也能让上面这条全绿。
 */
test('边界：对**未作答**的题标记已查看 ⇒ 409 且不建任何行（已作答的题 200）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9103');
  const token = createStudentToken(classroom.id, participant.id);
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));

  const answersBefore = await db.prisma.worksheetAnswer.count();
  const responsesBefore = await db.prisma.worksheetResponse.count();

  // `q_2` 学生一个字都没写过。
  const res = await server.post(`/api/worksheets/${worksheet.id}/review`, { participantId: participant.id, questionId: 'q_2' });
  const body = await res.json() as { error?: string };
  assert.equal(
    res.status,
    409,
    `未作答的题不该被标成「看过了」并顺手建行（409 = 当前状态不允许这个操作）：${JSON.stringify(body)}`,
  );
  assert.equal(await db.prisma.worksheetAnswer.count(), answersBefore, '被拒的标记不得建答案行');
  assert.equal(await db.prisma.worksheetResponse.count(), responsesBefore, '被拒的标记不得建作答会话');

  // 阳性对照：已作答的题必须能标（否则上面那条可能只是「review 永远 409」）。
  const ok = await server.post(`/api/worksheets/${worksheet.id}/review`, { participantId: participant.id, questionId: 'q_1' });
  assert.equal(ok.status, 200, `已作答的题必须能标记：${await ok.text()}`);
});

/** 参与者不存在 ⇒ 404；缺参数 ⇒ 400。三者与「题没作答」的 409 是**三种不同的处置**。 */
test('边界：review 的 participantId 不存在 ⇒ 404，缺参 ⇒ 400', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet } = await seedClassroomUsingWorksheet(db.prisma, '9104');
  const url = `/api/worksheets/${worksheet.id}/review`;

  const missingParticipant = await server.post(url, { participantId: 'cls_不存在', questionId: 'q_1' });
  assert.equal(missingParticipant.status, 404, await missingParticipant.text());

  for (const [label, body] of [
    ['缺 participantId', { questionId: 'q_1' }],
    ['缺 questionId', { participantId: 'cls_不存在' }],
    ['两个都空', {}],
  ] as Array<[string, Record<string, unknown>]>) {
    const res = await server.post(url, body);
    assert.equal(res.status, 400, `${label} 必须 400：${await res.text()}`);
  }
});

// ---------------------------------------------------------------------------
// ③ 广播：房间 + 载荷（规格 §5.7 / §7.2 / §7.4）
// ---------------------------------------------------------------------------

/**
 * 🔴 **本任务最重要的一条**：每次保存都要广播，且**载荷含 `questionId`**，
 * 且发到**教师看板真在的那个房间**。
 *
 * 用例由三块组成，各自堵一类假绿：
 *   · 事件收到了 —— 堵「根本没实现」；
 *   · 载荷里的 `questionId` **等于刚保存的那一道**，且 `participantId`/`classroomId`/
 *     `status` 都对 —— 堵「收到了一个空壳事件」（看板的「正在做第 N 题」靠它，
 *     缺了只会显示一个笼统的进度，**没有任何报错**）；
 *   · 房间 === 实测的 `join-teacher-board` 房间 —— 堵「发到了学生房间」。
 *     规格 §5.7 把这个房间写作 `classroom:<id>`，而代码里那是**学生**房间
 *     （`join-classroom` 里 join 的）。发错房间的后果与没实现一模一样：
 *     事件照发、日志干净、看板永远不动。这条断言就是这个分歧的回归网。
 *     同一个理由，这里也**正面钉住**它不去学生房间：载荷里有每名学生的
 *     作答状态与对错，学生房间里有全班学生。
 */
test('广播：保存作答 ⇒ 房间是教师看板房间，载荷含 questionId', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const boardPrefix = await boardRoomPrefixFromSocketHandler();
  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9105');
  const token = createStudentToken(classroom.id, participant.id);
  const boardRoom = `${boardPrefix}${classroom.id}`;

  const save = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: { format: 'fill/v1', text: 'H2O' } }, bearer(token));
  assert.equal(save.status, 200, JSON.stringify(await save.json()));

  const updates = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated');
  assert.equal(updates.length, 1, `保存一次必须恰好广播一条，实际：${JSON.stringify(server.broadcasts)}`);

  const { room, payload } = updates[0];
  assert.equal(room, boardRoom, `广播必须发到教师看板所在的房间（${boardRoom}），实际 ${room}`);
  assert.notEqual(
    room,
    `classroom:${classroom.id}`,
    '不得发到学生房间：载荷里有每名学生的作答状态与对错，而那个房间里是全班学生',
  );

  // 载荷的**字段集合**也是契约的一部分（brief 的 Produces 一节把它逐个列了出来）：
  // 多一个字段就是协议变更，应当是一次有意识的改动，而不是顺手带出来的。
  //
  // 🔴 **`isCorrect` 必须在这个集合里**（B1）。它是协议字段：改名 ⇒ **看板**（这条广播
  // 唯一的订阅方，`src/app/teacher/classroom/page.tsx`）拿到 `undefined` ⇒ 静默不画 ✓/✗，
  // 没有任何报错。本行就是防改名回归的哨兵 ——
  // 把它从期望集合里删掉、或让实现不再发它，这里都会红。
  // ⊘ 2026-09-24 更正：原先写的是「**前端与**看板拿到」—— 学生端**不订这条广播**
  //（`/usr/bin/grep -rn "worksheet-answer-updated" src` ⇒ `src/app/classroom/` 下零命中）。
  // `gradeState` / `score` 是 B1 新增的两项（规格 §12：三态 + 数值）。
  // ★ 2026-09-28 加了四项：`value` / `valueOmitted`（乙档：草稿实时可见）与
  // `savedAt` / `saveCount`（丙档：作答过程）。**这一行就是那次协议变更的记录**。
  //
  // 🔴 `valueOmitted` **永远在场**（超限时是 `true`、否则 `false`），而不是「只在超限时才发」：
  // `io.emit` 走 JSON 序列化，`undefined` 的键会被**整个丢掉** ⇒ 字段集合会随内容变化，
  // 而下面这条断言（以及任何按字段集合做的判据）就失去了意义。
  // 超限时 `value` 发的是 `null`（而不是 `undefined`）—— 同理。
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['classroomId', 'gradeState', 'isCorrect', 'participantId', 'questionId', 'reviewedAt',
     'saveCount', 'savedAt', 'score', 'status', 'value', 'valueOmitted'],
  );
  assert.equal(payload.classroomId, classroom.id);
  assert.equal(payload.participantId, participant.id);
  assert.equal(
    payload.questionId,
    'q_2',
    '🔴 载荷必须含 questionId —— 看板的「正在做第 N 题」只靠它（规格 §5.7 / §7.4）',
  );
  assert.equal(payload.status, 'draft', '保存后是 draft，看板据此显示「作答中」');
  assert.equal(payload.isCorrect, null, 'draft 没有判分结果');
  // ★ 草稿行的另外两个判分列也必须被清掉 —— 只清 `isCorrect` 会留下一行
  // 「没判对、但有态有分」的自相矛盾形状（`PUT` 那一段注释写着理由）。
  assert.equal(payload.gradeState, null, 'draft 没有三态结果');
  assert.equal(payload.score, null, 'draft 没有得分');
  assert.equal(payload.reviewedAt, null, '没被标记过就是 null');

  // ★ 乙档：学生刚保存的内容要跟着广播走（此前载荷里**没有** `value`，
  // 所以「他此刻写了什么」在教师那一侧只能等下一次快照）。
  // ⚠️ 值是**这一条广播对应的那一次保存**（本用例保存的是 q_2 的填空题）——
  // 不是随便挑一个：写成别的题的值会让这条断言在「广播发的是上一次的 value」时照样绿。
  assert.deepEqual(payload.value, { format: 'fill/v1', text: 'H2O' }, '🔴 保存的内容必须随广播下发（乙档）');
  assert.equal(payload.valueOmitted, false, '这一条没超限');
  // ★ 丙档：作答过程的两项。`savedAt` 是**这一次**保存的时刻（服务端时间）。
  assert.equal(payload.saveCount, 1, '🔴 首次保存 ⇒ saveCount 是 1（不是 null、也不是 0）');
  assert.equal(
    typeof payload.savedAt, 'string',
    '🔴 savedAt 必须是可解析的 ISO 串 —— 过程区的「最近 N 分钟前」只靠它',
  );
  assert.ok(Number.isFinite(Date.parse(payload.savedAt as string)), 'savedAt 要真的能解析');

  // 阴性对照：另一道题带来的是**另一条**广播、另一个 questionId ——
  // 少了它，一个「载荷里 questionId 恒为某个常量」的实现也能让上面那条通过。
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  const second = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1);
  assert.equal(second?.payload.questionId, 'q_1');
});

/**
 * 提交那一条要带**判分结果**：看板的抽屉里逐题显示 ✓/✗（规格 §7.3），
 * 而它只能来自这条广播（不做按需推流，§7.4）。
 *
 * ⚠️ `autoGrade` 关是 `null`（**不是 `false`**）—— 与 B3 在响应体上的口径逐字一致：
 * 「没判」与「判错」在看板上是两种不同的显示。
 */
test('广播：提交作答 ⇒ 载荷带 isCorrect 与 submitted（autoGrade 关时是 null）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const boardPrefix = await boardRoomPrefixFromSocketHandler();
  const graded = await seedClassroomUsingWorksheet(db.prisma, '9106');
  const ungraded = await seedClassroomUsingWorksheet(db.prisma, '9107');
  const boardRoom = `${boardPrefix}${graded.classroom.id}`;
  // ★ `q_1` 的**逐题分值**用 2，不是默认的 1：默认档下 `score` 恰好等于旧布尔值的
  // `Number()`（对 = 1、错 = 0），于是「把 `state` 当 `score` 用」「忘了乘 `points.full`」
  // 「得分写成比例」三种错会**全部绿**。这个数在这里唯一的作用就是让 `score` 可观测。
  // ⚠️ 2026-09-26：原来写的是**学习单级的** `rewardStep: 2` —— 那两个档不再参与判分
  //（教师裁定：默认给分不要了，逐题分值已由迁移钉住）⇒ 改成直接钉在这一题上。
  const gradedContent = (await db.prisma.worksheet.findUnique({ where: { id: graded.worksheet.id } }))!
    .content as unknown as { nodes: Array<Record<string, unknown>> };
  await db.prisma.worksheet.update({
    where: { id: graded.worksheet.id },
    data: {
      settings: { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' },
      content: {
        ...gradedContent,
        nodes: gradedContent.nodes.map((node) => (node.id === 'q_1' ? { ...node, points: { full: 2, half: 1 } } : node)),
      } as never,
    },
  });
  await db.prisma.worksheet.update({
    where: { id: ungraded.worksheet.id },
    data: { settings: { allowResubmit: true, autoGrade: false, defaultInputMode: 'keyboard' } },
  });
  const gradedToken = createStudentToken(graded.classroom.id, graded.participant.id);
  const ungradedToken = createStudentToken(ungraded.classroom.id, ungraded.participant.id);

  const save = (ctx: typeof graded, token: string, value: unknown) =>
    server.put(`/api/worksheets/${ctx.worksheet.id}/answers`, { questionId: 'q_1', value }, bearer(token));
  const submit = (ctx: typeof graded, token: string) =>
    server.post(`/api/worksheets/${ctx.worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));

  // ── autoGrade 开：答对 ────────────────────────────────────────────────
  await save(graded, gradedToken, CHOICE(['B']));
  const submitRes = await submit(graded, gradedToken);
  assert.equal(submitRes.status, 200, JSON.stringify(await submitRes.json()));

  const gradedPush = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1);
  assert.ok(gradedPush, '提交也要广播 —— 教师看板的「已交 N/M」靠它');
  assert.equal(gradedPush.room, boardRoom);
  assert.equal(gradedPush.payload.questionId, 'q_1');
  assert.equal(gradedPush.payload.participantId, graded.participant.id);
  assert.equal(gradedPush.payload.status, 'submitted');
  assert.equal(gradedPush.payload.isCorrect, true, '判分结果必须在广播里，否则抽屉的 ✓/✗ 只能靠轮询');
  // ★ B1：三态与数值一起上线缆。三个字段**同生共死** —— 只断言 `isCorrect` 的话，
  // 「新增的两个字段压根没发」也能全绿（那正是 B1 之前的状态）。
  assert.equal(gradedPush.payload.gradeState, 'correct', '三态必须随广播下发（看板的 ½ 部分给分档只能来自它）');
  assert.equal(gradedPush.payload.score, 2, '得分必须随广播下发（奖励显示由得分驱动），且用的是学习单级的档 2 而不是默认的 1');

  // ── autoGrade 关：**不判**（null），不是「判错」 ────────────────────────
  await save(ungraded, ungradedToken, CHOICE(['B']));
  assert.equal((await submit(ungraded, ungradedToken)).status, 200);
  const ungradedPush = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1);
  assert.equal(ungradedPush?.payload.status, 'submitted');
  assert.equal(
    ungradedPush?.payload.isCorrect,
    null,
    '关掉自动判分是「不判」（null），不是「判错」（false）—— 看板上是两种显示',
  );
  // ★ 「不判分」在三个字段上是**同一个回答**：全是 null。
  assert.equal(ungradedPush?.payload.gradeState, null, '不判分 ⇒ gradeState 也是 null（不是 incorrect）');
  assert.equal(ungradedPush?.payload.score, null, '不判分 ⇒ score 也是 null（不是 0）');
});

/**
 * 🔴 **部分给分**：`isCorrect` 一个人表达不了它 —— 这就是 §12 重开 §3-S 的全部理由。
 *
 * 这道题是多选（正确 = A+C），教师的「漏选算不算部分给分」选了**算**，逐题赋分 3 / 2。
 * 学生只选了 A ⇒ `partial`：
 *   · `isCorrect === false`（语义收窄为「全对」，它**不是**错的）；
 *   · `gradeState === 'partial'`；
 *   · `score === 2`（不是 0 —— 部分给分那个数）。
 *
 * ⚠️ 断言里 `false` 与 `partial` 必须在**同一条**用例里出现：分开写等于允许一个
 * 「`isCorrect=false` 就一定是错」的实现通过，而那正是三态要否掉的东西。
 */
test('广播：部分给分（多选漏选）⇒ isCorrect=false 与 gradeState=partial 同时成立，score 是部分给分档', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  // 逐题赋分（`points` 落在**题目节点**上，不进 `data`）是这里唯一能拿到「部分给分 ≠ 0」的路径：
  // 本用例下面写进库的那份 `settings` 里**没有** `halfStep` ⇒ `pointsFromSettings` 读到的是
  // 缺席 ⇒ 部分给分档 = 0，那样 `score` 与「判错」撞成同一个数、断言就不再可观测。
  // ⊘ 2026-09-24（C3）更正理由：这里原先写的是「学习单级的 `halfStep` 要到 B2 才进写入口」。
  // B2 已经让写入口认它、C3 又让编辑器设置面板能写出它 ⇒ 那半句当天作废。
  // **用例本身不用改**（夹具里确实没有那个键，行为逐字不变），过期的只是理由。
  const worksheet = await db.prisma.worksheet.create({
    data: {
      title: '多选部分给分的学习单',
      content: {
        schemaVersion: 1,
        nodes: [{
          id: 'm_1',
          type: 'multi-choice',
          prompt: '下列哪些是光合作用的原料？',
          inputMode: 'keyboard',
          points: { full: 3, half: 2 },
          data: {
            options: [{ key: 'A', text: '水' }, { key: 'B', text: '氧气' }, { key: 'C', text: '二氧化碳' }],
            correctKeys: ['A', 'C'],
            partialCredit: 'allow-missing',
          },
          children: [],
        }],
      },
      settings: { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' },
    },
  });
  const classroom = await db.prisma.classroom.create({ data: { code: '9110', title: '测试课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const token = createStudentToken(classroom.id, participant.id);

  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'm_1', value: CHOICE(['A']) }, bearer(token));
  const res = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'm_1' }, bearer(token));
  const body = await res.json() as Record<string, unknown>;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.isCorrect, false, '部分给分不是「全对」⇒ isCorrect 收窄后就是 false');
  assert.equal(body.gradeState, 'partial', '🔴 但它**不是**错 —— 三态必须由 gradeState 说出来');
  assert.equal(body.score, 2, '得分是教师填的**部分给分**那一档（逐题 3/2 里的 2），不是 0');

  const push = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1);
  assert.equal(push?.payload.isCorrect, false, '广播与响应体必须是同一个回答（看板看到的必须是库里的真相）');
  assert.equal(push?.payload.gradeState, 'partial');
  assert.equal(push?.payload.score, 2);

  const row = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.equal(row.gradeState, 'partial', '三态必须**落库**，不能只在线缆上（看板的统计走库里那一列）');
  assert.equal(row.score, 2);
});

/**
 * 被拒的保存/提交**不得**广播。
 *
 * 看板唯一的进度来源就是这些广播：一次 409 的改题动作若照样广播 `draft`，
 * 教师会看到格子里那题从「已提交」跳回「作答中」，而库里那一行**一个字都没变**
 * （B3 的 409 用例正面钉过「一个字节都不能变」）。广播与落库必须是同一件事的两种表达。
 */
test('广播：被拒的保存（allowResubmit 为假 ⇒ 409）不广播', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '不可重交的学习单', { allowResubmit: false, autoGrade: true, defaultInputMode: 'keyboard' });
  const classroom = await db.prisma.classroom.create({ data: { code: '9108', title: '测试课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const token = createStudentToken(classroom.id, participant.id);

  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  assert.equal((await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token))).status, 200);

  const before = server.broadcasts.length;
  const rejected = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(rejected.status, 409, await rejected.text());
  assert.equal(
    server.broadcasts.length,
    before,
    `被拒的保存不得广播（看板会显示成「作答中」，而库里一个字都没变）：${JSON.stringify(server.broadcasts.slice(before))}`,
  );
});

// ---------------------------------------------------------------------------
// ⑯ 作答活动三列（★ 2026-09-28）：过程数据必须**落在库里**，不是只在线缆上
// ---------------------------------------------------------------------------

/**
 * 教师看板第 3 条（「正在答题的过程」）的三段数字全部来自这三列。
 * 它们三条各自有**一个错了不报错**的性质，所以逐条钉：
 *
 *   ① `createdAt` —— 首次保存写一次，**此后永不改**。改了的后果是「首次作答 12 分钟前」
 *      每次都变成「刚刚」，教师看不出他在这题上耗了多久；
 *   ② `saveCount` —— 每次保存 +1。不涨的后果是「已保存 N 次」永远显示 1；
 *      涨多了（比如提交也算一次）的后果是把「改了几次」说多了 —— 一样没有报错；
 *   ③ 🔴 **`savedAt` 必须被提交跳过**。提交那一次的 `data` 里**没有 `value`**
 *      （它只改 status 与判分三列），不是一次内容写入。让它推进的话，学生交完卷
 *      什么都不动，「距上次保存」也会显示成「刚刚保存过」—— 而看板据此判断他还在写。
 *
 * ⚠️ 第二条与第三条要用**真实的时间流逝**才分得清（同一毫秒内两件事看不出先后），
 * 所以中间 `await sleep(12)`。这不是 flaky：断言的是「不小于」与「不变」，
 * 不是「等于某个具体毫秒数」。
 */
test('★ 作答活动三列：首次保存写 createdAt，再保存只推进 savedAt/saveCount，提交不推进 savedAt', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9111');
  const token = createStudentToken(classroom.id, participant.id);
  const answers = (q: string, body: unknown) =>
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: q, value: body }, bearer(token));

  // ── ① 第一次保存：三列都要落地 ────────────────────────────────────────
  assert.equal((await answers('q_1', CHOICE(['B']))).status, 200);
  const first = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.ok(first.createdAt, '🔴 首次保存必须写 createdAt（没写 ⇒「首次作答 X 前」整段显示不出来）');
  assert.ok(first.savedAt, '首次保存必须写 savedAt');
  assert.equal(first.saveCount, 1, '🔴 首次保存后 saveCount 必须是 1 —— 写成 null 会让它显示成「不知道保存过几次」');

  const firstCreatedAt = first.createdAt!.getTime();
  const firstSavedAt = first.savedAt!.getTime();

  // ── ② 再保存：createdAt 不动，savedAt 前进，saveCount 涨 ────────────────
  await sleep(12);
  assert.equal((await answers('q_1', CHOICE(['A']))).status, 200);
  const second = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(
    second.createdAt!.getTime(),
    firstCreatedAt,
    '🔴 createdAt 是「第一次」的时刻，第二次保存不许改它',
  );
  assert.ok(
    second.savedAt!.getTime() >= firstSavedAt,
    'savedAt 必须跟着这次保存前进',
  );
  assert.equal(second.saveCount, 2, '🔴 第二次保存后 saveCount 必须是 2');

  // ── ③ 🔴 提交：status 变了，但 savedAt / saveCount **一个都不许动** ──────
  await sleep(12);
  const submitted = await server.post(
    `/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(submitted.status, 200, await submitted.text());
  const third = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(third.status, 'submitted', '前提：提交确实改了 status');
  assert.ok(third.submittedAt, '前提：提交确实写了 submittedAt');
  assert.equal(
    third.savedAt!.getTime(),
    second.savedAt!.getTime(),
    '🔴 提交**不是**一次保存 —— savedAt 不许被它推进（推进了 ⇒「距上次保存」在交卷后显示成「刚刚」）',
  );
  assert.equal(third.saveCount, 2, '🔴 提交不计入 saveCount（它不是内容写入）');

  // ── ④ 阳性对照：提交之后再保存一次，三列**照常**前进 ──────────────────────
  // 少了这一段，「savedAt 永不更新」那种实现也能让上面三条全绿。
  const allowResubmit = await db.prisma.worksheet.update({
    where: { id: worksheet.id }, data: { settings: { ...SAMPLE_SETTINGS, allowResubmit: true } as never },
  });
  assert.ok(allowResubmit, '前提：允许重交');
  await sleep(12);
  assert.equal((await answers('q_1', CHOICE(['C']))).status, 200);
  const fourth = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.ok(fourth.savedAt!.getTime() > third.savedAt!.getTime(), '再保存必须推进 savedAt');
  assert.equal(fourth.saveCount, 3, '再保存必须继续累加 saveCount');
  assert.equal(fourth.createdAt!.getTime(), firstCreatedAt, 'createdAt 仍然不许变');
});

/**
 * ★ 旧行的 `saveCount` 是 `NULL`，而写入侧用的是 Prisma 的 `increment`
 * —— 它落到 SQL 是 `"saveCount" = "saveCount" + 1`，而 **SQL 里 `NULL + 1` 还是 `NULL`**。
 *
 * 这条用例**量它**，不猜它。两种结果都有各自的道理，但必须写清楚是哪一个：
 *   · 若结果是 `NULL` —— 旧行的「已保存 N 次」**永远不显示**（=「不知道」，诚实）；
 *   · 若结果是 `1`   —— 那个数会被读成「他一共保存过 1 次」，而实际上他可能保存过 10 次。
 * 🔴 后者才是危险的那一个：它把一个**从升级那一刻起才开始数**的数字，说成了他的历史。
 * 所以这条用例断言的正是「不许变成 1」—— 将来有人把 `increment` 换成
 * `COALESCE` 或读-改-写，这里会红，那时他要来读这一段。
 */
test('★ 旧行（saveCount 为 NULL）再保存：不许凭空变成 1（那会把「升级后才开始数」说成他的历史）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9112');
  const token = createStudentToken(classroom.id, participant.id);

  // 造一行「升级前」的作答：三列全 NULL（`ensureWorksheetAnswerColumns` 只加列、不回填，
  // 所以这正是真实升级之后旧行的样子）。
  const response = await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id, status: 'draft' },
  });
  await db.prisma.worksheetAnswer.create({
    data: { responseId: response.id, questionId: 'q_1', status: 'draft', value: { format: 'choice/v1', selected: ['B'] } as never },
  });
  const legacy = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(legacy.saveCount, null, '前置条件：旧行的 saveCount 是 NULL');
  assert.equal(legacy.createdAt, null, '前置条件：旧行的 createdAt 是 NULL');

  const saved = await server.put(
    `/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(saved.status, 200, await saved.text());

  const after = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(
    after.saveCount,
    null,
    '🔴 旧行的 saveCount 必须**保持 NULL**（「不知道」）—— 变成 1 就是把一个'
    + '「从升级那一刻才开始数」的数字说成了他一共保存过 1 次',
  );
  assert.equal(after.createdAt, null, '旧行的 createdAt 同样是「不知道」，不许被这次保存补成 now');
  assert.ok(after.savedAt, '但 `savedAt` 必须写上 —— 这一次保存的时刻是**知道**的（它刚刚发生）');
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ★ 乙档的**上限**：内容过大时不下发 `value`，但**其余字段一个都不少**。
 *
 * 🔴 这里挡的是两件事，两件都不报错：
 *   ① **静默截断** —— 截断之后那串字读起来仍然像学生的原文，教师会照着一份被腰斩的
 *      答案去讲题。所以超限时发的是 `null` + `valueOmitted: true`，由界面说
 *      「内容较大，打开详情查看」；
 *   ② **连坐** —— `value` 超限不该影响「他答了哪一题、什么时候保存的、保存了几次」。
 *      看板靠那三项更新格子与过程区，丢掉它们的话，一道笔迹题会让整格停止更新。
 */
test('★ 广播上限：value 超限时不发内容但置 valueOmitted，其余字段照常', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { worksheet, classroom, participant } = await seedClassroomUsingWorksheet(db.prisma, '9113');
  const token = createStudentToken(classroom.id, participant.id);

  // 一条超限的文本作答。⚠️ 夹具的规模必须**跟着上限走**：上限从 8192 抬到 65536 之后，
  // 原来那个 `'好'.repeat(9000)` 不再超限，这条用例会红 —— 而它红得对（说明上限真的抬了）。
  // 判据是 `JSON.stringify(value).length`，与格式无关。
  // ⚠️ 用 **ASCII** 而不是中文：中文一个字在 JS 里 `length` 是 1、在 UTF-8 里是 3 字节，
  // 而本文件的请求体上限是 `express.json()` 的默认 100kb ⇒ 70000 个中文是 210KB，
  // 会被 **413 拒绝**（第一版就是这样红的，而它红的原因与上限判据毫无关系）。
  // ⚠️ 另一件事：**生产的上限是 10mb**（`index.ts:109`），所以真实保存不受这个 100kb 影响 ——
  // 这一条限制只属于本测试替身。
  const huge = 'a'.repeat(70000);
  assert.equal(
    (await server.put(`/api/worksheets/${worksheet.id}/answers`,
      { questionId: 'q_1', value: { format: 'text/v1', text: huge } }, bearer(token))).status,
    200,
  );

  const push = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1)!;
  assert.equal(push.payload.valueOmitted, true, '🔴 超限必须**说出来**，而不是静默截断');
  assert.equal(push.payload.value, null, '内容不发（不是截断后的那一份）');
  // ② 连坐：其余字段一个都不许少。
  assert.equal(push.payload.questionId, 'q_1', '题号照常 —— 少了它整格会停止更新');
  assert.equal(push.payload.status, 'draft');
  assert.equal(push.payload.saveCount, 1, '次数照常');
  assert.equal(typeof push.payload.savedAt, 'string', '保存时刻照常');

  // 阳性对照：一条**没超限**的作答里 value 照常下发（否则「永远发 null」也能让上面绿）。
  await server.put(`/api/worksheets/${worksheet.id}/answers`,
    { questionId: 'q_2', value: { format: 'text/v1', text: '短答案' } }, bearer(token));
  const small = server.broadcasts.filter(item => item.event === 'worksheet-answer-updated').at(-1)!;
  assert.equal(small.payload.valueOmitted, false);
  assert.deepEqual(small.payload.value, { format: 'text/v1', text: '短答案' }, '未超限时原样下发');
});
