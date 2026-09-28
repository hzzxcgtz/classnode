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
import { ANSWER_KEYS } from '../services/worksheet-questions.js';

/**
 * 教师看板的**历史读端点**：`GET /api/worksheets/classroom/:classroomId/answers`。
 *
 * 它补的是 D3 实测出来的一个洞：看板格子完全由广播驱动 ⇒ **教师刷新一次页面，
 * 早做完的学生就掉回「还没收到作答」态**。抽屉（形态 A / B）本来也要同一份数据。
 *
 * 四条硬要求，每条一个用例：
 *   ① **教师专用** —— 它挂在 `/api/worksheets` 那条混装鉴权路由下，而放行正则只放三种
 *      学生形状（`GET /:id/student-view`、`PUT /:id/answers`、`POST /:id/answers/submit`）。
 *      新路径是**三段** `/classroom/:id/answers`，绝不落进那三条里。除了「学生被拦」，
 *      还必须有「三种学生形状仍然放行」的阳性对照 —— 否则一个「一律 403」的闸门也能通过。
 *   ② **不泄漏答案**（规格 §5.4 红线）—— 判据不是「搜不到某几个词」，而是
 *      **`ANSWER_KEYS` 里的每一个键在整份响应里都不存在**（递归扫，不是字符串包含），
 *      外加两条阳性对照：题目在、且同一份学习单走教师读端点时那些键**在**。
 *   ③ **高级模式下不同组是不同的学习单** —— 形状必须能表达，不能假设全班共用一份。
 *   ④ **「已查看」的时间与「学生原答案」都要在**（抽屉形态 A 的两列）。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-worksheet-board-'));
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
  cookie: string;
}

/**
 * 起真实路由 + **真实的鉴权闸门**（`worksheetAccessGate`，index.ts 用的就是同一个函数，
 * 本文件不含 `index.ts` 的挂载语句 —— 那条由 `worksheet-routes.test.ts` 的源码断言兜底）。
 */
async function startServer(t: { after: (fn: () => void) => void }, prisma: PrismaClient): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);
  // 兜底 404 一律回 JSON：express 默认回 HTML，断言失败时 `await res.json()` 会抛
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
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
  return {
    // ⚠️ 教师 cookie **不默认带上**（与另外两个学习单用例文件不同）：本文件的核心用例是
    // 「学生 token 打教师端点」，多带一个教师 cookie 会让「到底是谁放行的」变成一件
    // 要靠闸门内部顺序去推的事。需要教师身份的调用显式传 `{ Cookie: cookie }`。
    get: (pathname, headers) => call('GET')(pathname, undefined, headers),
    post: (pathname, body, headers) => call('POST')(pathname, body, headers),
    put: (pathname, body, headers) => call('PUT')(pathname, body, headers),
    cookie,
  };
}

/**
 * 夹具里的每一道题都**带着答案**，否则「响应里没有答案键」那句什么都没证明 ——
 * 阳性对照见下面最后一条用例。
 *
 * 🔴 **`ANSWER_KEYS` 里的每一个键都必须在这份夹具里出现一次**，而这不是靠人记得：
 * 那条用例会逐个键断言「教师读端点里看得到它」，漏一个就红。
 * M4a 往 `ANSWER_KEYS` 加 `correctOrder` / `pairs` / `placement` 时，正是这条把
 * q_4 / q_5 / q_6 逼出来的 —— 它要的是「这道题**真的**带着那个键」，不是往某道题里
 * 塞一个空数组凑字符串。
 */
const SAMPLE_CONTENT = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'q_1',
      type: 'single-choice',
      prompt: '光合作用需要哪些条件？',
      inputMode: 'keyboard',
      data: { options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }], correctKeys: ['B'], explanation: '光是光合作用的能量来源' },
      children: [],
    },
    {
      id: 'q_2',
      type: 'fill-blank',
      prompt: '水的化学式是____',
      inputMode: 'keyboard',
      data: { answers: ['H2O'], explanation: '两个氢一个氧' },
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
    {
      // 排序题：答案是 `correctOrder`（**不是** `items` —— 那是学生看到的初始顺序）。
      id: 'q_4',
      type: 'order',
      prompt: '把光合作用的步骤排好',
      inputMode: 'keyboard',
      data: {
        items: [{ id: 'i1', text: '吸收光能' }, { id: 'i2', text: '合成有机物' }],
        correctOrder: ['i2', 'i1'],
        explanation: '先吸光再合成',
      },
      children: [],
    },
    {
      // 连线题：答案是 `pairs`；`left` / `right` 是必须留给学生的题面。
      id: 'q_5',
      type: 'match',
      prompt: '把名称与化学式连起来',
      inputMode: 'keyboard',
      data: {
        left: [{ id: 'l1', text: '水' }, { id: 'l2', text: '二氧化碳' }],
        right: [{ id: 'r1', text: 'H2O' }, { id: 'r2', text: 'CO2' }],
        pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }],
        explanation: '水是 H2O',
      },
      children: [],
    },
    {
      // 归类题：答案是 `placement`；`items` / `zones` 是题面。
      id: 'q_6',
      type: 'categorize',
      prompt: '把下面的动物分到相应的框里',
      inputMode: 'keyboard',
      data: {
        items: [{ id: 'i1', text: '猫' }],
        zones: [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }],
        placement: { i1: 'z1' },
        explanation: '猫是哺乳类',
      },
      children: [],
    },
  ],
};

const SAMPLE_SETTINGS = { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' };

async function seedWorksheet(prisma: PrismaClient, title: string) {
  return prisma.worksheet.create({
    data: { title, description: null, content: SAMPLE_CONTENT, settings: SAMPLE_SETTINGS },
  });
}

/** 递归收集一棵 JSON 里出现过的**所有键名**（不是字符串包含 —— 键名判据必须精确）。 */
function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { value.forEach(item => collectKeys(item, out)); return out; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ① 鉴权：教师专用
// ---------------------------------------------------------------------------

test('鉴权：新读端点是**教师专用** —— 学生 token 403、教师 200、无凭据 401', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '光合作用学习单');
  const classroom = await db.prisma.classroom.create({ data: { code: '9001', title: '鉴权课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });

  const token = createStudentToken(classroom.id, participant.id);
  const asStudent = { Authorization: `Bearer ${token}` };
  const boardPath = `/api/worksheets/classroom/${classroom.id}/answers`;

  // 🔴 学生 token：**403**（已认证但无权），不是 401。
  const asStudentRes = await server.get(boardPath, asStudent);
  const asStudentBody = await asStudentRes.json() as { error?: string };
  assert.equal(asStudentRes.status, 403, JSON.stringify(asStudentBody));
  assert.equal(asStudentBody.error, '该接口仅教师可用', '403 必须是**闸门**回的那一句，不是偶然的 403');

  // 教师 cookie：200。
  const asTeacherRes = await server.get(boardPath, { Cookie: server.cookie });
  assert.equal(asTeacherRes.status, 200, JSON.stringify(await asTeacherRes.json()));

  // 无凭据：401（`requireTeacher` 的那一支）。这条同时证明上面那个 403 **不是**
  // 「闸门把谁都拦成 403」——没有凭据时它仍然会说「未认证」。
  const anon = await server.get(boardPath);
  assert.equal(anon.status, 401);

  // ── 阳性对照：三种学生形状**仍然放行**。没有这一段，一个把什么都 403 掉的闸门
  //    也能让上面那条通过，而学生端会整个坏掉。
  const shapes: Array<[string, Promise<Response>]> = [
    ['GET  /:id/student-view', server.get(`/api/worksheets/${worksheet.id}/student-view`, asStudent)],
    ['PUT  /:id/answers', server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: { format: 'choice/v1', selected: ['B'] } }, asStudent)],
    ['POST /:id/answers/submit', server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, asStudent)],
  ];
  for (const [label, pending] of shapes) {
    const res = await pending;
    assert.notEqual(res.status, 403, `${label} 必须放行，实际 403：${JSON.stringify(await res.json())}`);
  }

  // 既有教师端点「已查看」同样不受影响（闸门那三条正则一个字都没改）。
  const review = await server.post(`/api/worksheets/${worksheet.id}/review`, { participantId: participant.id, questionId: 'q_2' }, asStudent);
  assert.equal(review.status, 403, '「已查看」是教师端点，学生 token 不得放行');
});

// ---------------------------------------------------------------------------
// ② 不泄漏答案（规格 §5.4 红线）
// ---------------------------------------------------------------------------

test('安全：响应里**不存在 ANSWER_KEYS 中的任何一个键**，且不含 content', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '光合作用学习单');
  const classroom = await db.prisma.classroom.create({ data: { code: '9002', title: '安全课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const response = await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id, status: 'in-progress' },
  });
  await db.prisma.worksheetAnswer.create({
    data: {
      responseId: response.id, questionId: 'q_1', value: { format: 'choice/v1', selected: ['B'] },
      status: 'submitted', isCorrect: true,
      // ★ B1：三态与数值也要落进行里，下面才有东西可钉（`score` 用 2 而不是默认的 1 ——
      // 默认档下它与旧布尔值的 `Number()` 撞成同一个数，断言就不再可观测）。
      gradeState: 'correct', score: 2,
    },
  });

  const res = await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie });
  assert.equal(res.status, 200);
  const raw = await res.text();

  // ── 阳性对照之一：这一份学习单**确实带着答案**（同一份夹具走教师读端点是有的）。
  //    没有它，下面「找不到答案键」只说明夹具里压根没有答案。
  const detailRaw = await (await server.get(`/api/worksheets/${worksheet.id}`, { Cookie: server.cookie })).text();
  for (const key of ANSWER_KEYS) {
    assert.ok(detailRaw.includes(key), `夹具里应当有答案键 ${key}（否则本用例无效）：${key} 不在教师读端点响应里`);
  }

  // ── 判据一：键名级（递归）—— 不是字符串包含，避免「响应里恰好有个学生叫 answers」这类假阳性。
  const keys = collectKeys(JSON.parse(raw));
  for (const key of ANSWER_KEYS) {
    assert.ok(!keys.has(key), `响应里出现了答案键 ${key}（规格 §5.4 红线）`);
  }
  assert.ok(!keys.has('content'), '响应里不得有 content —— 题目节点的 data 就住在它里面');

  // ── 判据二：原始字面量级（报告里那三条 grep 的同一判据）。
  //    ⚠️ 本判据扫的是**整份响应**（含学生自己的作答 `value`），所以它成立的前提是
  //    「`ANSWER_KEYS` 的键名与学生作答值格式的字段名不撞车」。2026-09-23 之前
  //    `match/v1` / `categorize/v1` 用的 `pairs` / `placement` 正好撞上黑名单里那两个
  //    同名键，那条裁定把它们改成了 `links` / `assignment` —— **撞名是协议侧解决的**，
  //    判据这里一个字都不用让。若将来又有新格式想借黑名单里的名字，先看这条注释。
  for (const literal of [...ANSWER_KEYS, 'content']) {
    assert.ok(!raw.includes(literal), `响应原文里不该出现「${literal}」`);
  }

  // ── 阳性对照之二：题目与作答**在**（一个 `res.json({})` 的实现也能让上面全部通过）。
  const body = JSON.parse(raw) as { worksheets: Array<{ id: string; participants: Array<{ participantId: string; answerRows: Array<{ questionId: string; value: unknown; isCorrect: boolean | null; gradeState: string | null; score: number | null }> }> }> };
  assert.equal(body.worksheets.length, 1);
  assert.equal(body.worksheets[0].id, worksheet.id);
  const rows = body.worksheets[0].participants[0].answerRows;
  assert.equal(rows.length, 1, '逐题作答行必须下发');
  assert.equal(rows[0].questionId, 'q_1');
  assert.equal(rows[0].isCorrect, true, '对错必须下发（抽屉形态 A 的那一列）');
  // ★ B1：三态与数值是这条线缆的**第三段**（提交响应 / 学生读端点 / 教师读端点），
  // 而它此前没有任何哨兵。漏 `select` 一列的表现与「压根没实现」一模一样：事件照发、
  // 日志干净、档位永远画不出来 —— 而**响应里也没有任何东西缺一块**（键不存在与值为
  // `null` 在 `Object.keys` 之外几乎不可区分）。所以这里**钉值**，不是钉键存在。
  assert.equal(rows[0].gradeState, 'correct', '三态必须下发（看板的 ✓/½/✗ 只能来自它）');
  assert.equal(rows[0].score, 2, '得分必须下发（奖励由得分驱动），且是库里那个 2 而不是默认的 1');
  // 「学生原答案」是学生自己写的那个值，与「正确答案」是两件事 —— 抽屉要它（§7.3 形态 A）。
  assert.deepEqual(rows[0].value, { format: 'choice/v1', selected: ['B'] });
});

// ---------------------------------------------------------------------------
// ②b ★ 2026-09-28：作答活动三列必须下发（抽屉「过程区」的唯一数据源）
// ---------------------------------------------------------------------------

/**
 * 🔴 与上面 `gradeState` / `score` 那条**逐字同源**的坑：漏 `select` 一列的表现
 * 与「压根没实现」一模一样 —— 事件照发、日志干净、那一项**永远画不出来**，
 * 而响应里也没有任何东西缺一块（键不存在与值为 `null` 在 `Object.keys` 之外几乎不可区分）。
 *
 * 所以本用例**钉值**，且**刻意用三个互不相同的数**（若是三个 `null` 或三个 `0`，
 * 「读错了列」与「正确」在断言上不可区分）：
 *   · `createdAt` —— 12:00，**第一次**作答的时刻；
 *   · `savedAt`   —— 12:07，**最近一次保存**（与上面那个不同 ⇒ 能证明确实读的是两列）；
 *   · `saveCount` —— 3。
 */
test('★ 作答活动三列（createdAt / savedAt / saveCount）必须下发，且是库里那三个值', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '过程区学习单');
  const classroom = await db.prisma.classroom.create({ data: { code: '9003', title: '过程课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const response = await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id, status: 'draft' },
  });

  const createdAt = new Date('2026-09-28T12:00:00.000Z');
  const savedAt = new Date('2026-09-28T12:07:00.000Z');
  await db.prisma.worksheetAnswer.create({
    data: {
      responseId: response.id, questionId: 'q_1',
      value: { format: 'choice/v1', selected: ['B'] }, status: 'draft',
      createdAt, savedAt, saveCount: 3,
    },
  });

  const body = await (await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie })).json() as {
    worksheets: Array<{ participants: Array<{ answerRows: Array<{ questionId: string; createdAt: string | null; savedAt: string | null; saveCount: number | null }> }> }>;
  };
  const rows = body.worksheets[0].participants[0].answerRows;
  assert.equal(rows.length, 1);

  // ⚠️ 三个值互不相同（12:00 / 12:07 / 3）—— 读错列、或三列读成同一个值，都会在这里红。
  assert.equal(new Date(rows[0].createdAt!).toISOString(), createdAt.toISOString(), 'createdAt 必须下发且是库里那个值');
  assert.equal(new Date(rows[0].savedAt!).toISOString(), savedAt.toISOString(), 'savedAt 必须下发且是库里那个值');
  assert.equal(rows[0].saveCount, 3, 'saveCount 必须下发且是库里那个值');

  // 阴性对照：旧行（三列为 NULL）下发的是 **null**，不是 0 / undefined。
  // 🔴 `undefined` 与 `null` 在 JSON 里长得一样（键会整个消失），但读的一侧分不出来
  // 就会把「不知道」渲染成「刚刚」—— 所以这里断言键**在**、值是 null。
  const legacy = await db.prisma.worksheetAnswer.create({
    data: { responseId: response.id, questionId: 'q_2', value: { format: 'choice/v1', selected: ['A'] }, status: 'draft' },
  });
  assert.equal(legacy.saveCount, null, '前置条件：直接建的行三列都是 NULL');
  const again = await (await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie })).json() as {
    worksheets: Array<{ participants: Array<{ answerRows: Array<Record<string, unknown>> }> }>;
  };
  const legacyRow = again.worksheets[0].participants[0].answerRows.find(row => row.questionId === 'q_2')!;
  assert.ok('createdAt' in legacyRow, '旧行也要**带上这个键**（值是 null，不是缺字段）');
  assert.equal(legacyRow.createdAt, null);
  assert.equal(legacyRow.savedAt, null);
  assert.equal(legacyRow.saveCount, null);
});

// ---------------------------------------------------------------------------
// ③ 高级模式：不同组是不同的学习单
// ---------------------------------------------------------------------------

test('高级模式：**每组一份不同的学习单**，形状必须能表达（两组各只看到自己那份与自己那些人）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const first = await seedWorksheet(db.prisma, '第一组的学习单');
  const second = await seedWorksheet(db.prisma, '第二组的学习单');
  const classroom = await db.prisma.classroom.create({ data: { code: '9003', title: '高级课堂', mode: 'advanced' } });

  const groupA = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  const groupB = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第二组' } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: groupA.id, kind: 'worksheet', targetId: first.id } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: groupB.id, kind: 'worksheet', targetId: second.id } });

  // 高级模式下**一个组一行参与者**（`type: 'group'`）。
  const participantA = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: groupA.id } });
  const participantB = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: groupB.id } });

  const responseA = await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: first.id, participantId: participantA.id, status: 'submitted' },
  });
  await db.prisma.worksheetAnswer.create({
    data: { responseId: responseA.id, questionId: 'q_2', value: { format: 'fill/v1', text: 'H2O' }, status: 'submitted', isCorrect: true, reviewedAt: new Date('2026-09-23T02:00:00Z') },
  });

  const res = await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie });
  assert.equal(res.status, 200);
  const body = await res.json() as { worksheets: Array<{ id: string; title: string; participants: Array<{ participantId: string; name: string; kind: string; groupName: string | null; answerRows: Array<{ questionId: string; reviewedAt: string | null }> }> }> };

  // 「全班共有的第 3 题」并不存在 —— 所以**先按学习单分组**，两份都在。
  assert.equal(body.worksheets.length, 2, '两份不同的学习单必须各成一组（§7.3 形态 B 的第一层）');
  const byId = new Map(body.worksheets.map(item => [item.id, item]));
  assert.equal(byId.get(first.id)?.title, '第一组的学习单');
  assert.equal(byId.get(second.id)?.title, '第二组的学习单');

  // 每组只看到**自己那些人**，不串到另一组。
  assert.deepEqual(byId.get(first.id)?.participants.map(p => p.participantId), [participantA.id]);
  assert.deepEqual(byId.get(second.id)?.participants.map(p => p.participantId), [participantB.id]);

  // 参与者是**组不是人**（§7.3 的「全部作答」那个标题就是为它改的），名字取组名。
  const groupParticipant = byId.get(first.id)!.participants[0];
  assert.equal(groupParticipant.kind, 'group');
  assert.equal(groupParticipant.name, '第一组');
  assert.equal(groupParticipant.groupName, '第一组');

  // 「已查看」的时间在（B4 的 `reviewedAt`，规格 §7.4）。
  const rows = groupParticipant.answerRows;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].reviewedAt, '已查看时间必须下发（规格 §7.4：「已看 N/M」的数据源）');
  assert.equal(new Date(rows[0].reviewedAt!).toISOString(), '2026-09-23T02:00:00.000Z');

  // 阴性对照：第二组（没答过）的 answerRows 是**空数组而不是缺字段** ——
  // 「已交 N/M」的分母是参与者数，缺字段会让分母只剩作答过的人。
  assert.deepEqual(byId.get(second.id)?.participants[0].answerRows, []);
});

test('标准模式：只配了学习单的学生在列、没配的**不进分母**；未作答者的 answerRows 为空数组', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '标准模式学习单');
  const withoutSheet = await db.prisma.classroom.create({ data: { code: '9004', title: '没配单的课堂', mode: 'standard' } });
  const classroom = await db.prisma.classroom.create({ data: { code: '9005', title: '标准课堂', mode: 'standard' } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });

  const answered = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const idle = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  await db.prisma.classroomStudent.create({ data: { classroomId: withoutSheet.id, type: 'student' } });

  const response = await db.prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: answered.id, status: 'in-progress' },
  });
  // ★ B1：这一行是**手工塞进库里的哨兵**，不是 `grade()` 的产物 —— 它钉的是
  // 「DB → 响应直通」这三列。选 `partial` 是因为它是 `isCorrect` **一个人表达不了**
  // 的那一档：`false` 底下同时住着「判错」与「部分给分」。
  // ⚠️ **别把这一行的值读成「本单的配置」或「这道题的真实判分」**（2026-09-24 实测）：
  //    · 这一单的 `settings` 没配部分给分档 ⇒ `pointsFromSettings` 给的是 `{full:1, half:0}`，
  //      也就是说**部分给分档与判错档在这一单里都是 0**；
  //    · `q_4` 的 `correctOrder` 是 `['i2','i1']`，这里的作答是 `['i1','i2']` ——
  //      **逐位 0 命中** ⇒ `grade()` 给的是 `{state:'incorrect', score:0}`，不是部分给分
  //      （两条目也排不出「部分正确」：唯一另一个排列就是逐位全错）。
  //   ⇒ 下面那个 `score: 2` 是**构造出来的哨兵值**（取 2 而不是默认的 1，这样「直通了
  //   库里那个值」与「补了个默认值」才分得开），它不对应任何真实配置。
  // 库里只留这一行，`answerRows[0]` 才是确定的（这个端点的 `select` 里没有 `orderBy`，
  // 加第二行会让下标变成不确定的）。
  await db.prisma.worksheetAnswer.create({
    data: {
      responseId: response.id, questionId: 'q_4', value: { format: 'order/v1', order: ['i1', 'i2'] },
      status: 'submitted', isCorrect: false, gradeState: 'partial', score: 2,
    },
  });

  const res = await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie });
  const body = await res.json() as { worksheets: Array<{ participants: Array<{ participantId: string; answerRows: Array<{ questionId: string; isCorrect: boolean | null; gradeState: string | null; score: number | null }> }> }> };
  assert.equal(body.worksheets.length, 1);
  const participants = body.worksheets[0].participants;
  assert.deepEqual(participants.map(p => p.participantId).sort(), [answered.id, idle.id].sort(), '两条都在：分母是「这一份学习单的人」，不是「答过的人」');
  const idleRows = participants.find(p => p.participantId === idle.id)!.answerRows;
  assert.deepEqual(idleRows, [], '一次都没作答的人要回空数组，不是缺字段');
  // 判错也要如实下发（`false` 与「没有对错」的 `null` 是两件事）。
  const answeredRow = participants.find(p => p.participantId === answered.id)!.answerRows[0];
  assert.equal(answeredRow.isCorrect, false);
  // ★ B1：`false` 之上的那一层 —— 这条线缆必须说得出「这是部分给分，不是错」，也必须
  // 带着库里那一行的数。少了 `select` 里的一列，这里会拿到 `undefined`
  //（键不存在），而看板的 ½ 与奖励会静默地永远画不出来。
  assert.equal(answeredRow.gradeState, 'partial', '部分给分必须能由 gradeState 说出来 —— isCorrect=false 推不出它');
  assert.equal(answeredRow.score, 2, '得分必须是**库里那一行的 2**（构造值，见上面的说明）—— 不是 0，也不是默认的 1');
  assert.equal(answeredRow.questionId, 'q_4', '钉住是这一行，别让夹具漂到别的题上而断言还是绿的');

  // 另一间课堂不受影响（按 `classroomId` 收口，不是「把全库作答行都发出去」）。
  const other = await server.get(`/api/worksheets/classroom/${withoutSheet.id}/answers`, { Cookie: server.cookie });
  assert.equal(other.status, 200);
  assert.deepEqual((await other.json() as { worksheets: unknown[] }).worksheets, [], '没配学习单的课堂回空数组');
});

// ---------------------------------------------------------------------------
// 边界：课堂不存在 / 目标已删（组级 targetId 悬空）
// ---------------------------------------------------------------------------

test('边界：课堂不存在 ⇒ 404；组级目标已删（悬空 targetId）⇒ 那份不出现，也不 500', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const missing = await server.get('/api/worksheets/classroom/根本不存在的课堂/answers', { Cookie: server.cookie });
  assert.equal(missing.status, 404);

  // 高级模式 + 一组配了一份**已经不在了**的学习单（组级 targetId 没有真外键，删得掉）。
  const classroom = await db.prisma.classroom.create({ data: { code: '9006', title: '悬空课堂', mode: 'advanced' } });
  const group = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第一组' } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: group.id, kind: 'worksheet', targetId: '已经被删掉的学习单' } });
  await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: group.id } });

  const res = await server.get(`/api/worksheets/classroom/${classroom.id}/answers`, { Cookie: server.cookie });
  assert.equal(res.status, 200, '读路径不得因为一条悬空引用整个 500');
  const body = await res.json() as { worksheets: Array<{ id: string }> };
  assert.deepEqual(body.worksheets, [], '那一份没有标题也没有题目，前端画不出任何东西 ⇒ 不出现在响应里');
});
