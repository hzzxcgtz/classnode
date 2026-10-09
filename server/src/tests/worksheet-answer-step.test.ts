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
import { worksheetAccessGate, worksheetRoutes } from '../routes/worksheets.js';
import { createTeacherSession } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';

/**
 * ★ 2026-10-09 审计发现：**`manual`（逐题开放）档的写路径没有按开放清单判**。
 *
 * `answerStepAllowed`（`routes/worksheets.ts`）只对 `open` 一条特判，其余的档**一律**
 * 落进「按已提交状态推的顺序前缀」那条（`target <= firstPending`）。
 * 而契约是另一个方向 —— `src/lib/worksheet-answer-mode.ts:42-45` 逐字写着：
 *
 *   · `manual` —— **教师**推进：只有老师在「逐题开放」里开过的那几道是可作答的。
 *   🔴 `manual` 与上面两种分步是**两个方向**：那两种看 `statuses`（谁交了），
 *      这一种**不看** `statuses`（老师说了算）。
 *
 * 后果（本文件就是它的回归网）：
 *   ① 老师只开放第 2 题 ⇒ 学生答第 2 题被 409 `worksheet-step-locked`
 *      ⇒ 客户端 `classifyFailure` 把它归成 `'locked'`（`worksheet-queue.ts:173`）
 *      = **保留、不重试、不弹提示** ⇒ 学生的作答**静默消失**，屏幕上没有任何异常；
 *   ② 反过来，老师**没**开放的题只要排在进度前缀里就能存进去（闸门不发它该发的拦）。
 *
 * ── 为什么这个文件单独存在 ──────────────────────────────────────────────────
 * 本仓纪律是「**过滤在服务端执行，不在前端**」（规格 §5.4）。客户端那一份判据
 *（`answerModeView`）本来就是对的 —— 它会藏起未开放的题；坏的只有服务端这一份。
 * 所以「学生端看起来没问题」**证明不了**这里没问题，只有端点级用例能钉住。
 *
 * ⚠️ 这个文件用**真 Prisma + 真 SQLite**（照 `worksheet-student.test.ts`）。
 * 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，用例开头第一件事就是断言这一点 ——
 * 本项目出过一次「`db push` 打在真实库上」的事故，那条断言是它的直接产物。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-answer-step-'));
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

interface TestServer {
  post: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  put: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
}

/**
 * 起真实路由 + **真实的鉴权闸门**（`worksheetAccessGate`，`index.ts` 用的就是同一个函数）。
 *
 * ⚠️ 闸门刻意从 `routes/worksheets.ts` 导入而不是在本文件里抄一遍：抄一遍的话，
 * 测试证明的只是「我抄的这一份能拦」，而 `index.ts` 挂的是哪一份无人过问。
 * ⚠️ 默认带上教师 cookie，学生请求靠 `Authorization` 把闸门推上学生那支（更严的一侧）。
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
      body: JSON.stringify(body),
    });
  return { post: call('POST'), put: call('PUT') };
}

/**
 * 最小夹具：**只两道题**（q_1 单选、q_2 填空）。
 *
 * 🔴 刻意只有两道：`answerStepAllowed` 的判据是「目标题 vs **第一道还没交的题**」的下标比较，
 * 题数越多越难一眼看出 `target` 与 `firstPending` 各是几 —— 而这条 bug 的本质就是这两个下标。
 * 两题时：q_1 的 target 是 0、q_2 的 target 是 1，任何一条断言红的缘由都不必再看第二眼。
 */
const CONTENT = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'q_1', type: 'single-choice', prompt: '光能从哪里来？', inputMode: 'keyboard',
      data: { options: [{ key: 'A', text: '太阳' }, { key: 'B', text: '月亮' }], correctKeys: ['A'] },
      children: [],
    },
    {
      id: 'q_2', type: 'fill-blank', prompt: '水的化学式是____', inputMode: 'keyboard',
      data: { answers: ['H2O'] },
      children: [],
    },
  ],
};

const BASE_SETTINGS = { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard' };

/** 一间标准模式课堂 + 一份学习单 + 一个参与者；`open` 非 null 时写进 `Classroom.worksheetOpen`。 */
async function seed(
  prisma: PrismaClient,
  code: string,
  answerMode: string,
  open: string[] | null,
) {
  const worksheet = await prisma.worksheet.create({
    data: { title: `学习单-${answerMode}`, content: CONTENT, settings: { ...BASE_SETTINGS, answerMode } as never },
  });
  const classroom = await prisma.classroom.create({
    data: {
      code, title: '测试课堂', mode: 'standard',
      ...(open ? { worksheetOpen: { [worksheet.id]: open } as never } : {}),
    },
  });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  await prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  return { worksheet, classroom, participant, token: createStudentToken(classroom.id, participant.id) };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const CHOICE = (selected: string[]) => ({ format: 'choice/v1', selected });
const FILL = (text: string) => ({ format: 'fill/v1', text });

/** 每次建库 + 起服务，并在用例结束时收干净（照 `worksheet-student.test.ts`）。 */
async function withServer(t: { after: (fn: () => void) => void }) {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  return { ...(await startServer(t, db.prisma)), prisma: db.prisma };
}

// ---------------------------------------------------------------------------
// ① `manual` 档：写路径必须认开放清单（本文件存在的理由）
// ---------------------------------------------------------------------------

test('★ manual：老师只开放第 2 题 ⇒ 答第 2 题必须 200（否则作答静默消失）', async (t) => {
  const { put, prisma } = await withServer(t);
  const { worksheet, participant, token } = await seed(prisma, '9101', 'manual', ['q_2']);

  const res = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(token));
  assert.equal(
    res.status, 200,
    `老师**开放过**的题必须能存：${res.status} ${JSON.stringify(await res.json())}`,
  );

  // 🔴 直接查库，不靠响应体 —— 响应体 200 而库里没写是可能的。
  const rows = await prisma.worksheetAnswer.findMany();
  assert.equal(rows.length, 1, '200 就必须真的落库');
  assert.equal(rows[0].questionId, 'q_2');
  assert.equal(rows[0].status, 'draft');
});

test('★ manual：老师**没**开放第 1 题 ⇒ 答第 1 题必须 409（现在被放行）', async (t) => {
  const { put, prisma } = await withServer(t);
  const { worksheet, token } = await seed(prisma, '9102', 'manual', ['q_2']);

  const res = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(res.status, 409, `未开放的题不许存：${res.status}`);
  // 🔴 断言的是**机器可读的 code**，不是状态码 —— 本文件里 409 有两种来路
  //（`answers-locked` / `allowResubmit`），只看状态码分不出是哪一条判据在拦。
  assert.equal((await res.json()).code, 'worksheet-step-locked');

  // 被拒的保存**不得留下任何痕迹**（会话也算痕迹）：教师看板会把它显示成「正在作答」。
  assert.equal(await prisma.worksheetAnswer.count(), 0, '被拒的作答不得落库');
  assert.equal(await prisma.worksheetResponse.count(), 0, '被拒的请求连作答会话都不该建');
});

test('★ manual：交完**已开放**的题之后，未开放的题仍然 409（进度不许替代开放清单）', async (t) => {
  const { put, post, prisma } = await withServer(t);
  const { worksheet, token } = await seed(prisma, '9103', 'manual', ['q_1']);

  const save = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(save.status, 200, '前置条件：开放的 q_1 存得进去');
  const submit = await post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(submit.status, 200, `前置条件：开放的 q_1 交得上去：${await submit.text()}`);

  // 到这里 done = {q_1}、firstPending = 1（q_2）⇒ 若按「顺序前缀」判，q_2 的 target(1) <= 1 成立
  // ⇒ 会被**错误放行**。manual 档的判据只有开放清单一条，与交没交过无关。
  const res = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(token));
  assert.equal(res.status, 409, `交过前一道不等于后一道被开放：${res.status}`);
  assert.equal((await res.json()).code, 'worksheet-step-locked');
  assert.equal(await prisma.worksheetAnswer.count(), 1, '只有 q_1 那一行');
});

test('★ manual：**提交端点**用同一判据 —— 库里已有草稿的未开放题提交必须 409', async (t) => {
  const { post, prisma } = await withServer(t);
  const { worksheet, classroom, participant, token } = await seed(prisma, '9104', 'manual', ['q_2']);

  // 直接建行（不走 PUT），这样这条用例**独立**钉住提交那个调用点：
  // 否则 PUT 那条断言先红，提交这一半就永远没被验到。
  const response = await prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id, status: 'in-progress' },
  });
  await prisma.worksheetAnswer.create({
    data: { responseId: response.id, questionId: 'q_1', value: CHOICE(['A']), status: 'draft' },
  });

  const res = await post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(res.status, 409, `未开放的题不许交：${res.status}`);
  assert.equal((await res.json()).code, 'worksheet-step-locked');
  const row = await prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(row.status, 'draft', '被拒的提交不得把这行改成 submitted');
});

// ---------------------------------------------------------------------------
// ② 阴性对照：修 `manual` 不许动另外两档（少了这两条，「一律放行」也能全绿）
// ---------------------------------------------------------------------------

test('阴性对照 · open 档：没有开放清单也任何题都能存', async (t) => {
  const { put, prisma } = await withServer(t);
  const { worksheet, token } = await seed(prisma, '9105', 'open', null);

  for (const [questionId, value] of [['q_1', CHOICE(['A'])], ['q_2', FILL('H2O')]] as Array<[string, unknown]>) {
    const res = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId, value }, bearer(token));
    assert.equal(res.status, 200, `open 档不该拦任何题（${questionId}）：${res.status}`);
  }
  assert.equal(await prisma.worksheetAnswer.count(), 2);
});

test('阴性对照 · question-step 档仍然按**提交进度**顺序解锁（不许被改成看开放清单）', async (t) => {
  const { put, post, prisma } = await withServer(t);
  const { worksheet, token } = await seed(prisma, '9106', 'question-step', null);

  // 没交 q_1 ⇒ q_2 必须被拦（这一档的判据是 statuses）
  const blocked = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(token));
  assert.equal(blocked.status, 409, 'question-step 档下没交前一道就不许往后写');
  assert.equal((await blocked.json()).code, 'worksheet-step-locked');

  const save = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_1', value: CHOICE(['A']) }, bearer(token));
  assert.equal(save.status, 200, `前置条件：q_1 存得进去：${await save.text()}`);
  const submit = await post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'q_1' }, bearer(token));
  assert.equal(submit.status, 200, `前置条件：q_1 交得上去：${await submit.text()}`);

  // 交完 q_1 ⇒ q_2 解锁。这一条是「我的修法没有把这一档一起锁死」的判据：
  // 若把 manual 的开放清单判据误用到所有档上，这里会永远 409。
  const after = await put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(token));
  assert.equal(after.status, 200, `交完前一道之后必须解锁：${after.status}`);
});
