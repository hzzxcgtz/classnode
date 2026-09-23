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
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';

/**
 * 学习单**学生端**：读取（`student-view`）、作答（`PUT`）、提交判分。
 *
 * 三块重点，各自对应一类已经踩过的坑：
 *   ① 🔴 **答案剥离（规格 §5.4 第一条）**。学生端的 `content` 里不得出现
 *      `correctKeys` / `answers` / `explanation`。这是本任务唯一的红线，
 *      所以这里除了「搜不到」，还必须有两条**阳性对照**：
 *        · 题本身在（一个 `res.json({})` 的实现也能让「搜不到答案」通过）；
 *        · 同一份学习单走**教师端**读，答案是**在**的（否则夹具里根本没有答案，
 *          那条「搜不到」什么都没证明）。
 *   ② **越权（规格 §5.3）**。只能读/写**自己那一份**。高级模式下不同组拿的是
 *      不同的学习单 ⇒「只校验 classroomId」等于谁都能读别人组那份。
 *      高级模式**不回落**到课堂级 —— 那会让学生静默地做另一份卷子。
 *   ③ **判分在服务端（§5.4 第二条 / §5.6）**。主观题是 `null` 不是 `false`；
 *      `autoGrade` 关是 `null`；返回体**不含 `score`**（规格 §3-S）。
 *
 * ⚠️ 这个文件用**真 Prisma + 真 SQLite**（照 worksheet-routes.test.ts）。
 * 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，用例开头第一件事就是断言这一点 ——
 * 本项目出过一次「`db push` 打在真实库上」的事故，那条断言是它的直接产物。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-worksheet-student-'));
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

interface TestServer {
  get: (pathname: string, headers?: Record<string, string>) => Promise<Response>;
  post: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  put: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  /** 教师 cookie —— 默认带在所有请求上（学生 token 会覆盖闸门的分支，见下）。 */
  cookie: string;
}

/**
 * 起真实路由 + **真实的鉴权闸门**（`worksheetAccessGate`，index.ts 用的就是同一个函数）。
 *
 * ⚠️ 闸门刻意从 `routes/worksheets.ts` 导入而不是在本文件里抄一遍：抄一遍的话，
 * 测试证明的只是「我抄的这一份能拦」，而 `index.ts` 挂的是哪一份无人过问。
 *
 * ⚠️ 真实浏览器里学生**没有**教师 cookie，而这个 helper 默认给每个请求都带上它 ——
 * 那是**更严**的一侧：闸门必须靠**学生 token** 把请求认成学生（它先判学生分支），
 * 带着教师 cookie 也拦不住。要模拟纯学生请求传 `{ Cookie: '' }` 覆盖即可。
 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
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
  };
}

/**
 * 夹具里**三种答案字段都有**（`correctKeys` / `answers` / `explanation`）——
 * 剥离测试要逐个字段证明「学生端搜不到」而「教师端搜得到」。
 * 少放一个，那个字段的断言就是恒真的（搜不到的真正原因是夹具里没有它）。
 */
const SAMPLE_CONTENT = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'q_1',
      type: 'single-choice',
      prompt: '光合作用需要哪些条件？',
      inputMode: 'keyboard',
      data: {
        options: [{ key: 'A', text: '只有水' }, { key: 'B', text: '光能和二氧化碳' }],
        correctKeys: ['B'],
        explanation: '光合作用需要光能，并把二氧化碳转化成有机物',
      },
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

/** 答案字段的**三个**键名 —— 与 `worksheet-questions.ts` 的 `ANSWER_KEYS` 同源。 */
const ANSWER_KEYS = ['correctKeys', 'answers', 'explanation'] as const;

async function seedWorksheet(
  prisma: PrismaClient,
  title = '光合作用学习单',
  settings: Record<string, unknown> = SAMPLE_SETTINGS,
) {
  return prisma.worksheet.create({
    data: { title, description: '第一课时', content: SAMPLE_CONTENT, settings: settings as never },
  });
}

/** 一间课堂 + 一个参与者（`ClassroomStudent` —— 学习单的 participantId 指向它）。 */
async function seedClassroom(prisma: PrismaClient, code: string, title = '测试课堂') {
  const classroom = await prisma.classroom.create({ data: { code, title, mode: 'standard' } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  return { classroom, participant };
}

/**
 * 一间**高级模式**课堂：两个组各挂一份学习单，各有一个参与者。
 *
 * 高级模式是「越权」唯一能被构造出来的形态 —— 标准/分组模式全班拿的是同一份，
 * 那种模式下「读别人那份」根本不是一个可达的状态。
 */
async function seedAdvancedClassroom(prisma: PrismaClient, code: string) {
  const classroom = await prisma.classroom.create({ data: { code, title: '高级课堂', mode: 'advanced' } });
  const groupA = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  const groupB = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第二组' } });
  const worksheetA = await seedWorksheet(prisma, '第一组的学习单');
  const worksheetB = await seedWorksheet(prisma, '第二组的学习单');
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupA.id, kind: 'worksheet', targetId: worksheetA.id } });
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupB.id, kind: 'worksheet', targetId: worksheetB.id } });
  const participantA = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: groupA.id } });
  const participantB = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: groupB.id } });
  return { classroom, groupA, groupB, worksheetA, worksheetB, participantA, participantB };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const CHOICE = (selected: string[]) => ({ format: 'choice/v1', selected });
const FILL = (text: string) => ({ format: 'fill/v1', text });

// ---------------------------------------------------------------------------
// ① 答案剥离（规格 §5.4 第一条）—— 本任务唯一的红线
// ---------------------------------------------------------------------------

/**
 * 🔴 **本任务最重要的一条**：`student-view` 的返回体里搜不到任何答案字段。
 *
 * 「测试绿了」与「剥离真的生效了」是两件事，所以本用例有三层：
 *   · 学生的返回体里三个答案键**一个都搜不到**；
 *   · 同一份学习单走**教师端**读，三个键**都在**（证明夹具里确实有答案）；
 *   · 库里的行**没被动过**（防止有人用「写库时把答案删掉」来让这条测试变绿 ——
 *     那会让教师的答案键永久消失，是比泄露更糟的修法）。
 */
test('红线：student-view 返回体里搜不到任何答案字段，而教师端读同一份时答案都在', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9001');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.get(`/api/worksheets/${worksheet.id}/student-view`, bearer(token));
  const raw = await res.text();
  assert.equal(res.status, 200, raw);

  for (const key of ANSWER_KEYS) {
    assert.ok(
      !raw.includes(key),
      `student-view 的返回体里出现了答案字段「${key}」—— 过滤必须在**服务端**做，` +
      `前端过滤等同于未过滤：${raw}`,
    );
  }

  // 阳性对照 ①：题**在**。一个 `res.json({})` 的实现也能让上面三条通过。
  const body = JSON.parse(raw) as {
    id: string; title: string; description: string;
    content: { nodes: Array<{ id: string; prompt: string; data: Record<string, unknown> }> };
    settings: Record<string, unknown>;
  };
  assert.equal(body.id, worksheet.id);
  assert.equal(body.title, '光合作用学习单');
  assert.equal(body.description, '第一课时');
  assert.equal(body.content.nodes.length, 3, '三道题一道都不能少');
  assert.equal(body.content.nodes[0].prompt, '光合作用需要哪些条件？');
  assert.deepEqual(
    body.content.nodes[0].data.options,
    [{ key: 'A', text: '只有水' }, { key: 'B', text: '光能和二氧化碳' }],
    '选项要留给学生（剥掉的只有答案）',
  );

  // ⚠️ `settings` 只给学生需要的两个字段（B3 的明确要求）—— 整份原样丢出去会连带
  //    下发第一批用不到的 `defaultInputMode`，前端就多一个能读错的开关。
  assert.deepEqual(body.settings, { allowResubmit: true, autoGrade: true });

  // 阳性对照 ②：同一份学习单走**教师端**读，三个答案键都必须在 ——
  // 否则上面那三条可能只是因为夹具里根本没有答案。
  const teacherRaw = await (await server.get(`/api/worksheets/${worksheet.id}`)).text();
  for (const key of ANSWER_KEYS) {
    assert.ok(teacherRaw.includes(key), `教师端读同一份时必须能看到「${key}」—— 否则剥离测试是空的`);
  }

  // 阳性对照 ③：库里的行没被动过。「写库时删掉答案」也能让最上面三条变绿，
  // 而那会让教师的答案键永久消失 —— 比泄露更糟的修法。
  const stored = await db.prisma.worksheet.findUniqueOrThrow({ where: { id: worksheet.id } });
  const storedRaw = JSON.stringify(stored.content);
  for (const key of ANSWER_KEYS) {
    assert.ok(storedRaw.includes(key), `剥离只发生在**返回前**，库里的「${key}」一个字节都不许动`);
  }
});

// ---------------------------------------------------------------------------
// ② 越权（规格 §5.3）：只能读/写**自己那一份**
// ---------------------------------------------------------------------------

test('越权：学生 A 读**B 组**那份的 student-view ⇒ 403（自己组那份 200）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, worksheetA, worksheetB, participantA } = await seedAdvancedClassroom(db.prisma, '9002');
  const tokenA = createStudentToken(classroom.id, participantA.id);

  const stolen = await server.get(`/api/worksheets/${worksheetB.id}/student-view`, bearer(tokenA));
  const stolenBody = await stolen.text();
  assert.equal(
    stolen.status,
    403,
    `B 组的学习单不得被 A 组的学生读到（404 会让「不是这一份」与「不存在」混淆）：${stolenBody}`,
  );
  assert.ok(!stolenBody.includes('第二组的学习单'), '被拒的响应里不得漏出那一份的任何内容');

  // 阳性对照：同一个 token 读**自己组**那份必须 200 ——
  // 少了它，一个「student-view 永远 403」的实现也能让上面那条通过。
  const own = await server.get(`/api/worksheets/${worksheetA.id}/student-view`, bearer(tokenA));
  const ownBody = await own.json() as { title: string };
  assert.equal(own.status, 200, JSON.stringify(ownBody));
  assert.equal(ownBody.title, '第一组的学习单');
});

test('越权：学生 A 往 **B 组**那份提交/保存 ⇒ 403（自己组那份 200）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, worksheetA, worksheetB, participantA } = await seedAdvancedClassroom(db.prisma, '9003');
  const tokenA = createStudentToken(classroom.id, participantA.id);

  const save = await server.put(`/api/worksheets/${worksheetB.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(tokenA));
  assert.equal(save.status, 403, `不得往别人组的学习单里写答案：${await save.text()}`);
  const submit = await server.post(`/api/worksheets/${worksheetB.id}/answers/submit`, { questionId: 'q_1' }, bearer(tokenA));
  assert.equal(submit.status, 403, `不得提交别人组的学习单：${await submit.text()}`);

  // 一行都不许落库（403 之后还有副作用是最坏的一种）
  assert.equal(await db.prisma.worksheetResponse.count(), 0, '被拒的请求不得留下作答会话');
  assert.equal(await db.prisma.worksheetAnswer.count(), 0, '被拒的请求不得留下答案行');

  // 阳性对照：同一 token 往**自己组**那份写必须 200，且答案真的落库
  const ownSave = await server.put(`/api/worksheets/${worksheetA.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(tokenA));
  assert.equal(ownSave.status, 200, JSON.stringify(await ownSave.json()));
  assert.equal(await db.prisma.worksheetAnswer.count(), 1);
  assert.equal(await db.prisma.worksheetResponse.count({ where: { worksheetId: worksheetA.id } }), 1);
});

test('越权：高级模式下本组**没配**学习单 ⇒ 403，不拿课堂级那份顶上', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  // 高级课堂：课堂级挂了一份，第一组**没配** —— 正是「本组未配置，不拿别组的顶上」
  // 那条边界（规格 §8.4）在服务端的落点。
  const classroom = await db.prisma.classroom.create({ data: { code: '9004', title: '高级课堂', mode: 'advanced' } });
  const group = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  const classroomLevel = await seedWorksheet(db.prisma, '课堂级的学习单');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: classroomLevel.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: group.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.get(`/api/worksheets/${classroomLevel.id}/student-view`, bearer(token));
  assert.equal(
    res.status,
    403,
    `高级模式下本组没配就是没有 —— 回落到课堂级等于让学生静默地做另一份卷子：${await res.text()}`,
  );

  // 阳性对照：把这一组配上之后，同一请求必须 200 ——
  // 否则上面那条可能只是「这个 token 什么都读不到」。
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'worksheet', targetId: classroomLevel.id } });
  const after = await server.get(`/api/worksheets/${classroomLevel.id}/student-view`, bearer(token));
  assert.equal(after.status, 200, JSON.stringify(await after.json()));
});

/**
 * 标准模式下同样只认课堂级那一份：另一份**没被本课堂关联**的学习单读不到
 * （它是同一张表里的另一行，不是「别人的组」）。
 */
test('越权：标准模式下没被本课堂关联的学习单一律 403', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const { classroom, participant } = await seedClassroom(db.prisma, '9005');
  const mine = await seedWorksheet(db.prisma, '我的学习单');
  const other = await seedWorksheet(db.prisma, '别处的学习单');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: mine.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.get(`/api/worksheets/${other.id}/student-view`, bearer(token));
  assert.equal(res.status, 403, await res.text());
  const own = await server.get(`/api/worksheets/${mine.id}/student-view`, bearer(token));
  assert.equal(own.status, 200, JSON.stringify(await own.json()));
});

// ---------------------------------------------------------------------------
// ③ 作答：幂等（规格 §5.3 · 学生端防抖 1.5s 会重复打同一个 PUT）
// ---------------------------------------------------------------------------

/**
 * 防抖 1.5s 的客户端在断网重放时会把同一个 `(participant, worksheet, questionId)`
 * 连打两次 —— 所以这一条不是洁癖，是那条链路的正常形态。
 */
test('作答：同一题连续 PUT 两次只有一行，且 value 是后一次', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9006');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const first = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(first.status, 200, JSON.stringify(await first.json()));
  const responseAfterFirst = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(responseAfterFirst.status, 'in-progress');
  assert.ok(responseAfterFirst.startedAt, 'startedAt 必须写上（「什么时候开始做的」）');

  // 第二次：换一个值
  const second = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  assert.equal(second.status, 200, JSON.stringify(await second.json()));

  const rows = await db.prisma.worksheetAnswer.findMany();
  assert.equal(rows.length, 1, '同一题只能有一行 —— `@@unique([responseId, questionId])` 的语义');
  assert.deepEqual(rows[0].value, CHOICE(['B']), '留下的是后一次的 value');
  assert.equal(rows[0].status, 'draft');
  assert.equal(rows[0].submittedAt, null);

  const responses = await db.prisma.worksheetResponse.findMany();
  assert.equal(responses.length, 1, '作答会话也只能有一条');
  assert.equal(
    responses[0].startedAt?.getTime(),
    responseAfterFirst.startedAt?.getTime(),
    'startedAt 是 `??= now` —— 每次保存都刷一遍等于没有这个字段',
  );

  // 阴性对照：另一道题是**另一行**（否则「只有一行」可能只是因为 upsert 把题都合并了）
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(token));
  assert.equal(await db.prisma.worksheetAnswer.count(), 2);
});

test('作答：questionId 不属于这份 content ⇒ 400，且一行都不落库', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9007');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  for (const [label, pending] of [
    ['PUT', server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_不存在', value: CHOICE(['B']) }, bearer(token))],
    ['POST submit', server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_不存在' }, bearer(token))],
    ['PUT 缺 questionId', server.put(`/api/worksheets/${worksheet.id}/answers`, { value: CHOICE(['B']) }, bearer(token))],
  ] as Array<[string, Promise<Response>]>) {
    const res = await pending;
    assert.equal(res.status, 400, `${label} 必须 400：${await res.text()}`);
  }
  assert.equal(await db.prisma.worksheetAnswer.count(), 0, '被拒的作答不得留下任何行');
  assert.equal(await db.prisma.worksheetResponse.count(), 0, '校验失败时连会话都不该建');

  // 阳性对照：真属于这份 content 的题必须能存
  const ok = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_3', value: { format: 'text/v1', text: '叶子冒泡' } }, bearer(token));
  assert.equal(ok.status, 200, JSON.stringify(await ok.json()));
});

// ---------------------------------------------------------------------------
// ④ 判分（规格 §5.4 第二条 / §5.6 / §3-S）
// ---------------------------------------------------------------------------

/** `autoGrade` 关 ⇒ **不判分**（`null`），不是「判错」（`false`）—— 两者在界面上完全不同。 */
test('判分：autoGrade 关 ⇒ isCorrect 为 null（不是 false），且返回体不含 score', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '不判分的学习单', { allowResubmit: true, autoGrade: false, defaultInputMode: 'keyboard' });
  const { classroom, participant } = await seedClassroom(db.prisma, '9008');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  const res = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  const body = await res.json() as Record<string, unknown>;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.isCorrect, null, '关掉自动判分是「不判」，不是「判错」');
  // 规格 §3-S：**不建也不返回 score**。分值一旦下发就有人拿它做统计，而它可推导。
  assert.deepEqual(Object.keys(body), ['isCorrect'], `返回体只能有 isCorrect：${JSON.stringify(body)}`);

  const row = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.equal(row.status, 'submitted', '提交这一动作本身照常生效');
  assert.ok(row.submittedAt, 'submittedAt 必须写上');
  assert.equal(row.isCorrect, null);
});

/**
 * `autoGrade` 开 ⇒ 客观题有值、**问答题恒 `null`**。
 * 同时验证 §5.6 的归一化是**真的**经过了判分链路（全角 `Ｈ２Ｏ` 要判对）——
 * 只测 `normalizeFillText` 是 A2 的事，这里测的是「学生的输入真的走到了那个函数」。
 */
test('判分：autoGrade 开 ⇒ 单选题有对错、填空归一化后判对、问答题恒为 null', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9009');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const save = (questionId: string, value: unknown) =>
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId, value }, bearer(token));
  const submit = async (questionId: string) =>
    (await (await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId }, bearer(token))).json()) as { isCorrect: boolean | null };

  // 单选题：对
  await save('q_1', CHOICE(['B']));
  assert.equal((await submit('q_1')).isCorrect, true);

  // 同一题改错、再提交 ⇒ **重新判分**（规格 §8.4：改已提交的题重新判分）
  await save('q_1', CHOICE(['A']));
  assert.equal((await submit('q_1')).isCorrect, false, '改过之后必须重新判分，不是沿用上一次的结论');

  // 填空题：全角的 `Ｈ２Ｏ` 与首尾空格都要被归一化掉（§5.6）
  await save('q_2', FILL('  Ｈ２Ｏ  '));
  assert.equal((await submit('q_2')).isCorrect, true, '归一化要真的生效：全角转半角 + 去首尾空格');

  // 填空题：错的要判错（阴性对照 —— 否则上面那条可能只是「填空题恒 true」）
  await save('q_2', FILL('CO2'));
  assert.equal((await submit('q_2')).isCorrect, false);

  // 问答题：`grade()` 返回 `null` —— **不是 false**。「没判」与「判错」是两件事。
  await save('q_3', { format: 'text/v1', text: '叶子冒泡了' });
  const shortAnswer = await submit('q_3');
  assert.equal(shortAnswer.isCorrect, null, '主观题不参与判分，返回 null');
  assert.deepEqual(Object.keys(shortAnswer), ['isCorrect']);

  const rows = await db.prisma.worksheetAnswer.findMany({ orderBy: { questionId: 'asc' } });
  assert.deepEqual(rows.map(r => [r.questionId, r.isCorrect]), [['q_1', false], ['q_2', false], ['q_3', null]]);
});

/**
 * 提交前必须先作答。
 *
 * 一个「没作答也能提交」的实现会把空题记成「已提交 · 判错」，还会推进整卷进度 ——
 * 学生什么都没写，看板上却显示他做完了。这不是防御性编程，是防止**服务端的假数据**
 * 进入教师看板（看板的唯一数据源就是这些行）。
 */
test('判分：没作答就提交 ⇒ 400，不把空题记成「已提交」', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9010');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(res.status, 400, await res.text());
  assert.equal(await db.prisma.worksheetAnswer.count(), 0);
  // 被拒的提交**不得留下任何痕迹**：顺手建一份「已开始作答」会让教师看板把一个
  // 什么都没做的学生显示成正在做 —— 而看板唯一的进度来源就是这个状态。
  assert.equal(await db.prisma.worksheetResponse.count(), 0, '被拒的提交不得建作答会话');

  // 阳性对照：先作答再提交必须 200
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }, bearer(token));
  const ok = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(ok.status, 200, JSON.stringify(await ok.json()));
});

// ---------------------------------------------------------------------------
// ⑤ 状态流转：draft ⇄ submitted、整卷 submitted
// ---------------------------------------------------------------------------

test('状态：allowResubmit 为真时改已提交的题，本题回 draft、整卷回 in-progress', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9011');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const save = (questionId: string, value: unknown) =>
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId, value }, bearer(token));
  const submit = (questionId: string) =>
    server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId }, bearer(token));

  // 三道题全部提交 ⇒ 整卷 submitted
  await save('q_1', CHOICE(['B']));
  await submit('q_1');
  await save('q_2', FILL('H2O'));
  await submit('q_2');
  const half = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(half.status, 'in-progress', '还剩一题没提交，整卷不能算交卷');

  await save('q_3', { format: 'text/v1', text: '冒泡' });
  await submit('q_3');
  const whole = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(whole.status, 'submitted', '三道题都提交了 ⇒ 整卷 submitted');
  assert.ok(whole.submittedAt, '整卷的 submittedAt 必须写上');

  // 改一题：本题回 draft（规格 §8.4 的第三行），整卷回 in-progress
  await save('q_1', CHOICE(['A']));
  const q1 = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(q1.status, 'draft', 'allowResubmit 为真 ⇒ 改了就回到 draft');
  assert.equal(q1.submittedAt, null, 'draft 的题不该留着定稿时间戳');
  assert.equal(q1.isCorrect, null, 'draft 的题不该留着上一次的判分（看板会显示成「刚判过」）');
  assert.equal((await db.prisma.worksheetResponse.findFirstOrThrow()).status, 'in-progress');

  // 再提交一次 ⇒ 重新判分（§8.4：「再次提交时重新判分并更新 submittedAt」）
  const resubmit = await (await submit('q_1')).json() as { isCorrect: boolean | null };
  assert.equal(resubmit.isCorrect, false, '改错了就该判错');
  const q1Again = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(q1Again.status, 'submitted');
  assert.ok(q1Again.submittedAt);
  assert.equal((await db.prisma.worksheetResponse.findFirstOrThrow()).status, 'submitted');
});

// ---------------------------------------------------------------------------
// ⑥ 鉴权边角：教师 cookie 打学生端端点、目标已被删
// ---------------------------------------------------------------------------

/**
 * 闸门对**教师**是放行的（它是混装路由，教师端端点也要走它）⇒ 学生端的处理器
 * **必须自己**处理「没有学生会话」。少了这一步，教师误点学生端 URL 会拿到 500
 * （`student.studentId` 打在 null 上），而日志里只有一句 TypeError。
 */
test('鉴权：教师 cookie 打学生端三个端点 ⇒ 401（不是 500）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom } = await seedClassroom(db.prisma, '9012');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });

  const res = await Promise.all([
    server.get(`/api/worksheets/${worksheet.id}/student-view`),
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['B']) }),
    server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }),
  ]);
  for (const r of res) {
    assert.equal(r.status, 401, `学生端端点在没有学生会话时必须是 401：${await r.text()}`);
  }

  // 无凭据同样 401（`Cookie: ''` + 没有 Bearer）
  const anonymous = await server.get(`/api/worksheets/${worksheet.id}/student-view`, { Cookie: '' });
  assert.equal(anonymous.status, 401, await anonymous.text());
});

/**
 * 组级材料的 `targetId` **没有真外键** ⇒ 目标可能已经被删（删除守卫是唯一防线，
 * 它拦不住「先建课堂、后删目标」以外的历史数据）。此时解析出来的 id 就是学生的
 * 「那一份」，但它已经不存在了 —— 该回 404（这份**没了**），不是 403（**不是你的**）。
 */
test('边界：本组的学习单目标已被删（悬空 targetId）⇒ 404，不是 403', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const classroom = await db.prisma.classroom.create({ data: { code: '9013', title: '高级课堂', mode: 'advanced' } });
  const group = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  const goneId = 'ws-已经-被-删-了';
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'worksheet', targetId: goneId } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: group.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const res = await server.get(`/api/worksheets/${goneId}/student-view`, bearer(token));
  const body = await res.json() as { error?: string };
  assert.equal(res.status, 404, JSON.stringify(body));
  // ⚠️ 只断言 404 是一条**假绿**：本文件末尾挂的兜底 404 也是这个状态码，
  // 于是「处理器根本没实现」与「处理器正确回了 404」在断言眼里一模一样。
  // 所以这里必须把「路由自己回的那句」与兜底那句区分开。
  assert.notEqual(body.error, 'not found', '404 必须是处理器自己回的，不是 express 的兜底');
  assert.match(String(body.error), /不存在/, '要能诊断「这一份没了」，而不是一句泛泛的错误');
});
