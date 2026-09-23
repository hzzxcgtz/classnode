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
// 🔴 答案键的名单**只有一份**（服务端的 `ANSWER_KEYS`）。这里曾经抄过一份自己的
// 三元素副本，而它不会跟着注册表漂 —— M4a 往黑名单里加了 `correctOrder` / `pairs` /
// `placement` 之后，那份副本让这条**泄漏红线**用例对三个新的答案键完全失明，
// 而它仍然是绿的。
import { ANSWER_KEYS } from '../services/worksheet-questions.js';

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
 *      `autoGrade` 关是 `null`；返回体含 `{ isCorrect, gradeState, score }` 三个判分字段。
 *      ⚠️ 这里曾经写着「返回体**不含 `score`**（规格 §3-S）」—— **那句话已作废**，
 *      规格 §12 明写 M4 重开了 §3-S（奖励由得分驱动；三态之后 `score` 也不再可推导）。
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
 * 夹具里**每一种答案字段都有** —— 剥离测试要逐个字段证明「学生端搜不到」而
 * 「教师端搜得到」。少放一个，那个字段的断言就是恒真的
 * （搜不到的真正原因是夹具里没有它）。下面第三条阳性对照还会逐个键断言
 * 「库里那一份没被动过」，所以每个键都必须**真的**出现在某道题里。
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
    {
      // 排序题：答案是 `correctOrder`（`items` 是学生看到的初始顺序，要留给他）。
      // ⚠️ 两者**必须不同** —— 相同等于「学生什么都不做就是满分」。
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
      // 连线题：答案是 `pairs`；`left` / `right` 必须留给学生。
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
      // 归类题：答案是 `placement`；`items` / `zones` 必须留给学生。
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

/**
 * 递归收集一棵 JSON 里出现过的**所有键名**（不是字符串包含 —— 键名判据必须精确）。
 * 照 `worksheet-board.test.ts` 的那一个：判据一（键名级）在本文件里比字符串包含更硬。
 */
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
 * 🔴 **多空填空题（M4a）的答案在第二层**：`data.blanks = [{ answers: [...] }, …]`。
 *
 * 这条用例存在的唯一理由：上面那条红线用例的判据在**键名/字面量**层，而 A1 的第一版
 * `stripAnswers` 只 `delete data[key]`（顶层），多空题的第二层答案**原样跟着
 * `student-view` 下发** —— 一次 `GET` 就让全班拿到每一个空的可接受答案，
 * 而上面那条**全绿**。
 *
 * 这里刻意**不改**上面那份夹具（它背着判分与整卷交齐的用例），而是另起一份最小夹具：
 * 一道多空填空题，一路走到真实的 `student-view` 端点上。
 */
test('🔴 多空填空题：第二层（blanks[*].answers）的答案也不得跟着 student-view 下发', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  // 哨兵值都是独一无二的串（`H2O` 这种会和别处撞），搜不到才说明真被剥了。
  const worksheet = await db.prisma.worksheet.create({
    data: {
      title: '多空填空',
      description: null,
      settings: SAMPLE_SETTINGS,
      content: {
        schemaVersion: 1,
        nodes: [{
          id: 'q_1',
          type: 'fill-blank',
          prompt: '水的化学式是____，二氧化碳的化学式是____',
          inputMode: 'keyboard',
          data: { blanks: [{ answers: ['哨兵甲A', '哨兵甲B'] }, { answers: ['哨兵乙A'] }] },
          children: [],
        }],
      },
    },
  });
  const { classroom, participant } = await seedClassroom(db.prisma, '9003');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  const raw = await (await server.get(`/api/worksheets/${worksheet.id}/student-view`, bearer(token))).text();

  for (const sentinel of ['哨兵甲A', '哨兵甲B', '哨兵乙A']) {
    assert.ok(!raw.includes(sentinel), `多空题的答案「${sentinel}」跟着 student-view 下发了（规格 §5.4 红线）：${raw}`);
  }
  // 阳性对照：**题目本身必须还在，而且空的数量要对**。
  // 一个「把 `blanks` 整个删掉」的实现也能让上面三条通过 —— 那不是更安全，是把这道题
  // 变成一道**没有空的填空题**（学生端画不出输入框）。
  const body = JSON.parse(raw) as { content: { nodes: Array<{ data: Record<string, unknown> }> } };
  assert.equal(body.content.nodes.length, 1, '题目必须在');
  const blanks = body.content.nodes[0].data.blanks as Array<Record<string, unknown>>;
  assert.equal(blanks.length, 2, '两个空一个都不能少（学生端按数量画输入框）');
  assert.deepEqual(blanks, [{}, {}], '每个空只剩一个空对象 —— 答案没了，空还在');
});

/**
 * 🔴 **本任务最重要的一条**：`student-view` 的返回体里搜不到任何答案字段。
 *
 * 「测试绿了」与「剥离真的生效了」是两件事，所以本用例有三层：
 *   · 学生的返回体里答案键**一个都搜不到**（名单是 `ANSWER_KEYS`，逐字遍历）；
 *   · 同一份学习单走**教师端**读，每一个键**都在**（证明夹具里确实有答案）；
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

  // 阳性对照 ①：题**在**。一个 `res.json({})` 的实现也能让上面那几条通过。
  const body = JSON.parse(raw) as {
    id: string; title: string; description: string;
    content: { nodes: Array<{ id: string; prompt: string; data: Record<string, unknown> }> };
    settings: Record<string, unknown>;
  };
  assert.equal(body.id, worksheet.id);
  assert.equal(body.title, '光合作用学习单');
  assert.equal(body.description, '第一课时');
  assert.equal(body.content.nodes.length, 6, '六道题一道都不能少');
  assert.equal(body.content.nodes[0].prompt, '光合作用需要哪些条件？');
  assert.deepEqual(
    body.content.nodes[0].data.options,
    [{ key: 'A', text: '只有水' }, { key: 'B', text: '光能和二氧化碳' }],
    '选项要留给学生（剥掉的只有答案）',
  );

  // ⚠️ `settings` 只给学生需要的**五**个字段（B3 的两个 + D5 的奖励两项 + M4a 的半对档）——
  //    整份原样丢出去会连带下发第一批用不到的 `defaultInputMode`，前端就多一个能读错的开关。
  //    🔴 这是一条**逐字**的断言，键多一个少一个都会红：学生端下发什么必须有人明确决定过。
  //    （M4a 加 `halfStep` 时这条用例**一起改了** —— 那是**有意的决定**，不是把测试改松：
  //    学生端要拿半对档才知道「半对」该画几个，见 `src/lib/worksheet-reward.ts`。）
  //    奖励三项在这里是**默认档**（夹具没配），下面另有一条用例钉「配过的档会原样下发」。
  assert.deepEqual(body.settings, {
    allowResubmit: true, autoGrade: true, rewardStyle: 'star', rewardStep: 1, halfStep: 0,
  });

  // 阳性对照 ②：同一份学习单走**教师端**读，每一个答案键都必须在 ——
  // 否则上面那几条可能只是因为夹具里根本没有答案。
  const teacherRaw = await (await server.get(`/api/worksheets/${worksheet.id}`)).text();
  for (const key of ANSWER_KEYS) {
    assert.ok(teacherRaw.includes(key), `教师端读同一份时必须能看到「${key}」—— 否则剥离测试是空的`);
  }

  // 阳性对照 ③：库里的行没被动过。「写库时删掉答案」也能让最上面那几条变绿，
  // 而那会让教师的答案键永久消失 —— 比泄露更糟的修法。
  const stored = await db.prisma.worksheet.findUniqueOrThrow({ where: { id: worksheet.id } });
  const storedRaw = JSON.stringify(stored.content);
  for (const key of ANSWER_KEYS) {
    assert.ok(storedRaw.includes(key), `剥离只发生在**返回前**，库里的「${key}」一个字节都不许动`);
  }
});

/**
 * 奖励形式（规格 §9.2，D5）：**配过的那一档要原样到学生手里**，坏值落到默认档。
 *
 * 🔴 这条用例存在的理由是「静默丢键」这一类失效：`PUT /api/worksheets/:id` 是
 * **整份替换** `settings`（`data.settings = normalizeSettings(body.settings)`），
 * 所以 `normalizeSettings` 少认一个键，教师配好的「花朵 ×3」就会被一次改标题的保存
 * 悄悄改回星星 —— 保存照常 200，界面上没有任何提示，只有学生第二天发现奖励变了样。
 *
 * 四层，缺一层都可能是假绿：
 *   ① 配过的档**原样下发**（不是默认值 —— 夹具里的默认档就是星星/1）；
 *   ② **只改标题**的 `PUT` 不许动 settings（证明那条路不会顺手把奖励抹掉）；
 *   ③ 坏值（不认识的样式、越界的步长）落到默认档，而不是把坏值存进去；
 *   ④ 库里**手工改过**的行（缺这三个键）也要能读出默认档，不能 500。
 *
 * ★ M4a（B2）：半对档 `halfStep` 加进来时，这四层**每层都要带上它** —— 它是最新加的那个键，
 * 也正因为如此最容易在某一条路上漏掉（服务端写入口 / 读出口 / 前端默认 / 前端读回，
 * 少一处就静默抹除，见 `worksheet-routes.test.ts` 里那条整份发回的哨兵）。
 */
test('奖励形式：配过的档原样下发；只改标题的 PUT 不动它；坏值落到默认档', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma, '带奖励设置的学习单', {
    allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard',
    // ⚠️ 三个值**都不是默认档**（默认是 star / 1 / 0）：配默认值的话，「原样下发」与
    // 「那个键被整个丢掉、读的时候补默认」是同一个观测，下面 ① 就废了。
    rewardStyle: 'flower', rewardStep: 3, halfStep: 2,
  });
  const { classroom, participant } = await seedClassroom(db.prisma, '9008');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const settingsOf = async (id: string) =>
    (await (await server.get(`/api/worksheets/${id}/student-view`, bearer(token))).json() as {
      settings: Record<string, unknown>;
    }).settings;

  // ① 配过的档原样下发
  assert.deepEqual(await settingsOf(worksheet.id), {
    allowResubmit: true, autoGrade: true, rewardStyle: 'flower', rewardStep: 3, halfStep: 2,
  });

  // ② 只改标题 ⇒ settings 一个字节都不许动（也就不会有「保存一次奖励跑回默认」）
  const before = JSON.stringify((await db.prisma.worksheet.findUniqueOrThrow({ where: { id: worksheet.id } })).settings);
  const putRes = await server.put(`/api/worksheets/${worksheet.id}`, { title: '改过名的学习单' });
  assert.equal(putRes.status, 200, JSON.stringify(await putRes.json()));
  const after = JSON.stringify((await db.prisma.worksheet.findUniqueOrThrow({ where: { id: worksheet.id } })).settings);
  assert.equal(after, before, '只改标题的那次 PUT 不得动 settings');
  assert.equal(JSON.parse(after).rewardStyle, 'flower');
  assert.equal(JSON.parse(after).halfStep, 2, '半对档同样不许被这次 PUT 动到');

  // ③ 坏值落到默认档（而不是把「第四档」存进库）
  //    ⚠️ 半对档的域是 `0/1/2/3/5`（含 0，`HALF_STEPS`），与 `rewardStep` 的 1/2/3/5 **不同**：
  //    所以这里两边都用越界值（4），它们各自的默认值却是 1 与 0 —— 别指望它们落成同一个数。
  const badPut = await server.put(`/api/worksheets/${worksheet.id}`, {
    settings: { allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStyle: '彩虹', rewardStep: 4, halfStep: 4 },
  });
  assert.equal(badPut.status, 200, JSON.stringify(await badPut.json()));
  const bad = JSON.parse(JSON.stringify((await db.prisma.worksheet.findUniqueOrThrow({ where: { id: worksheet.id } })).settings));
  assert.deepEqual(
    { rewardStyle: bad.rewardStyle, rewardStep: bad.rewardStep, halfStep: bad.halfStep },
    { rewardStyle: 'star', rewardStep: 1, halfStep: 0 },
    '不认识的样式与越界的步长都必须落到各自的默认档（半对档的默认是 0，不是 1）',
  );

  // ④ 库里手工改过的行（`settings` 里根本没有这三个键）⇒ 默认档，不是 500。
  //    ⚠️ 用**另一间课堂**：课堂级容器是 `@@unique([classroomId, worksheetId])` 而不是
  //    「一间课堂一份」，往同一间课堂再挂一份会让「这个学生该拿哪一份」变成模糊的
  //    （`loadClassroomLevelWorksheetId` 取的是第一条）—— 那样这一条断言的失败原因
  //    会是一句 403，与它要证明的事无关。
  const handEdited = await seedWorksheet(db.prisma, '手改过的学习单', { allowResubmit: true, autoGrade: true });
  const other = await seedClassroom(db.prisma, '9009');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: other.classroom.id, worksheetId: handEdited.id } });
  const otherToken = createStudentToken(other.classroom.id, other.participant.id);
  const handEditedSettings = (await (await server.get(
    `/api/worksheets/${handEdited.id}/student-view`, bearer(otherToken),
  )).json() as { settings: Record<string, unknown> }).settings;
  assert.deepEqual(handEditedSettings, {
    allowResubmit: true, autoGrade: true, rewardStyle: 'star', rewardStep: 1, halfStep: 0,
  });
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

/**
 * `autoGrade` 关 ⇒ **不判分**（`null`），不是「判错」（`false`）—— 两者在界面上完全不同。
 *
 * ⚠️ 这条用例的名字与断言**在 B1 改过一次**，这是有意的决定、不是「把测试改松」：
 * 它原来钉的是「返回体**只能有** `isCorrect`」+「规格 §3-S：不建也不返回 `score`」。
 * 规格 §12 明写 **M4 重开了 §3-S**，理由有两条、各自独立成立：
 *   · 奖励显示现在**由得分驱动**（§9），不下发 `score` 恰恰等于学生端画不出奖励；
 *   · 三态之后 `score` **不再可由 `isCorrect` 推导**（`false` 同时覆盖
 *     `incorrect` 与 `partial`，两者的 `score` 是两个不同的数）。
 * ⇒ 现在钉的是「**三个判分字段同生共死**」：不判分时它们**全是** `null`。
 */
test('判分：autoGrade 关 ⇒ isCorrect / gradeState / score 三个字段同为 null', async (t) => {
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
  // 🔴 `isCorrect` **必须在**这个集合里（协议字段，只增不改），另外两个是 B1 新增的。
  assert.deepEqual(
    Object.keys(body).sort(),
    ['gradeState', 'isCorrect', 'score'],
    `返回体只许有这三个字段：${JSON.stringify(body)}`,
  );
  assert.equal(body.gradeState, null, '不判分 ⇒ 没有三态（**不是** incorrect）');
  assert.equal(body.score, null, '不判分 ⇒ 没有得分（**不是** 0）');

  const row = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.equal(row.status, 'submitted', '提交这一动作本身照常生效');
  assert.ok(row.submittedAt, 'submittedAt 必须写上');
  assert.equal(row.isCorrect, null);
  assert.equal(row.gradeState, null, '三个判分列一起落库、一起为空');
  assert.equal(row.score, null);
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

  // ★ 学习单级的档取 **2** 而不是默认的 1：默认档下 `score` 恰好等于旧布尔值的
  // `Number()`，「把 `state` 当 `score` 用」「忘了乘 `points.full`」两种错会**全绿**。
  const worksheet = await seedWorksheet(db.prisma, '判分学习单', {
    allowResubmit: true, autoGrade: true, defaultInputMode: 'keyboard', rewardStep: 2,
  });
  const { classroom, participant } = await seedClassroom(db.prisma, '9009');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const save = (questionId: string, value: unknown) =>
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId, value }, bearer(token));
  const submit = async (questionId: string) =>
    (await (await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId }, bearer(token))).json()) as {
      isCorrect: boolean | null; gradeState: string | null; score: number | null;
    };

  // 单选题：对
  await save('q_1', CHOICE(['B']));
  const q1Right = await submit('q_1');
  assert.equal(q1Right.isCorrect, true);
  assert.equal(q1Right.gradeState, 'correct', '三态必须由 gradeState 说出来，不能只靠 isCorrect');
  assert.equal(q1Right.score, 2, '得分用的是学习单级的档 2（不是默认的 1，也不是比例 1）');

  // 同一题改错、再提交 ⇒ **重新判分**（规格 §8.4：改已提交的题重新判分）
  await save('q_1', CHOICE(['A']));
  const q1Wrong = await submit('q_1');
  assert.equal(q1Wrong.isCorrect, false, '改过之后必须重新判分，不是沿用上一次的结论');
  assert.equal(q1Wrong.gradeState, 'incorrect');
  assert.equal(q1Wrong.score, 0, '判错是 0 分（不是「没得分」的 null —— 那是不判分）');

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
  assert.equal(shortAnswer.gradeState, null, '三态也一起是 null');
  assert.equal(shortAnswer.score, null, '得分也一起是 null（**不是 0**：0 是「判错」那个数）');
  assert.deepEqual(Object.keys(shortAnswer).sort(), ['gradeState', 'isCorrect', 'score']);

  const rows = await db.prisma.worksheetAnswer.findMany({ orderBy: { questionId: 'asc' } });
  assert.deepEqual(
    rows.map(r => [r.questionId, r.isCorrect, r.gradeState, r.score]),
    [
      ['q_1', false, 'incorrect', 0],
      ['q_2', false, 'incorrect', 0],
      // 主观题：三列**一起**是 null —— 「没判」在三个字段上是同一个回答。
      ['q_3', null, null, null],
    ],
    '三列必须一起落库；少写一列的表现是看板/奖励那一侧静默用一个默认值顶上',
  );
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

  // 六道题全部提交 ⇒ 整卷 submitted
  // ⚠️ 夹具里的题型在 M4a 扩到了 6 道，而「整卷交齐」判的是**全卷**（服务端递归数题目树）。
  // 只提交前几道就断言 `submitted` 会永远失败 —— 那不是这道题坏了，是夹具长大了。
  // 作答值的形状照 `AnswerDraft` 的联合（D1），这里只是把它当**不透明值**收发。
  await save('q_1', CHOICE(['B']));
  await submit('q_1');
  await save('q_2', FILL('H2O'));
  await submit('q_2');
  const half = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(half.status, 'in-progress', '还剩题没提交，整卷不能算交卷');

  await save('q_3', { format: 'text/v1', text: '冒泡' });
  await submit('q_3');
  await save('q_4', { format: 'order/v1', order: ['i2', 'i1'] });
  await submit('q_4');
  await save('q_5', { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }] });
  await submit('q_5');
  await save('q_6', { format: 'categorize/v1', assignment: { i1: 'z1' } });
  await submit('q_6');
  const whole = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(whole.status, 'submitted', '六道题都提交了 ⇒ 整卷 submitted');
  assert.ok(whole.submittedAt, '整卷的 submittedAt 必须写上');

  // 改一题：本题回 draft（规格 §8.4 的第三行），整卷回 in-progress
  await save('q_1', CHOICE(['A']));
  const q1 = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(q1.status, 'draft', 'allowResubmit 为真 ⇒ 改了就回到 draft');
  assert.equal(q1.submittedAt, null, 'draft 的题不该留着定稿时间戳');
  assert.equal(q1.isCorrect, null, 'draft 的题不该留着上一次的判分（看板会显示成「刚判过」）');
  // 整卷也回退。⚠️ 读的是**库里的那一行**（不是处理器的返回值）：`PUT /:id/answers`
  // 只回 `{ success, questionId, status }`，整卷那两列根本不在响应里 ——
  // 拿返回值断言等于什么都没断。
  //
  // 🔴 `submittedAt` 必须**一起**清掉：只拨 `status` 会持久化一行
  // `in-progress` + 上一次的交卷时间戳。今天没有代码读这两列，所以它不会立刻炸；
  // 但 §7.4 的看板一旦开始信这一行，拿到的就是一个**错的交卷时间**。
  // （规格 §5.3 只规定了正向，回退是实现自定的语义 —— 口径写在 `ensureResponse` 的注释里。）
  const rolledBack = await db.prisma.worksheetResponse.findFirstOrThrow();
  assert.equal(rolledBack.status, 'in-progress');
  assert.equal(rolledBack.submittedAt, null, '整卷回退必须同时清掉上一次的交卷时间戳，否则两列自相矛盾');

  // 再提交一次 ⇒ 重新判分（§8.4：「再次提交时重新判分并更新 submittedAt」）
  const resubmit = await (await submit('q_1')).json() as { isCorrect: boolean | null };
  assert.equal(resubmit.isCorrect, false, '改错了就该判错');
  const q1Again = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { questionId: 'q_1' } });
  assert.equal(q1Again.status, 'submitted');
  assert.ok(q1Again.submittedAt);
  assert.equal((await db.prisma.worksheetResponse.findFirstOrThrow()).status, 'submitted');
});

/**
 * 🔴 `allowResubmit` 必须在**服务端**生效（规格 §8.4 那三层里的第一层）。
 *
 * 只靠学生端「不让他改」，这个设置就是对教师说的假话 —— 与答案剥离同一条原则：
 * **过滤在服务端执行，不在前端**（规格 §5.4）。
 *
 * 拒绝用 **409**（Conflict：当前状态不允许这个操作），**不是 400**：本文件里 400 已经
 * 表示「请求本身有问题」（缺 `questionId`、题不属于这份学习单）。混用会让 D2 的离线队列
 * 没法区分「这一条该丢弃」与「这一条该修参数重试」—— 那是队列永远卡死的成因。
 *
 * 阳性对照与它并排：默认（`allowResubmit: true`）时同一操作必须 200 且回到 `draft`。
 * 少了它，一个「所有 PUT 都 409」的实现也能让上面全绿。
 */
test('allowResubmit 为假 ⇒ 改已提交的题 409 且库里那行不动；为真（默认）⇒ 200 且回 draft', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const frozen = await seedWorksheet(db.prisma, '不可重交的学习单', { allowResubmit: false, autoGrade: true, defaultInputMode: 'keyboard' });
  const editable = await seedWorksheet(db.prisma, '可重交的学习单');
  const { classroom: frozenClass, participant: frozenStudent } = await seedClassroom(db.prisma, '9014');
  const { classroom: freeClass, participant: freeStudent } = await seedClassroom(db.prisma, '9015');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: frozenClass.id, worksheetId: frozen.id } });
  await db.prisma.classroomWorksheet.create({ data: { classroomId: freeClass.id, worksheetId: editable.id } });

  const save = (worksheetId: string, token: string, value: unknown) =>
    server.put(`/api/worksheets/${worksheetId}/answers`, { questionId: 'q_1', value }, bearer(token));
  const submit = (worksheetId: string, token: string) =>
    server.post(`/api/worksheets/${worksheetId}/answers/submit`, { questionId: 'q_1' }, bearer(token));

  // ── ① allowResubmit: false ────────────────────────────────────────────
  const frozenToken = createStudentToken(frozenClass.id, frozenStudent.id);
  assert.equal((await save(frozen.id, frozenToken, CHOICE(['A']))).status, 200, '第一次作答必须放行');
  const submitted = await submit(frozen.id, frozenToken);
  assert.equal(submitted.status, 200, JSON.stringify(await submitted.json()));

  const before = await db.prisma.worksheetAnswer.findFirstOrThrow();
  const beforeSnapshot = JSON.stringify(before);
  const answerCountBefore = await db.prisma.worksheetAnswer.count();
  const responseCountBefore = await db.prisma.worksheetResponse.count();

  const rejected = await save(frozen.id, frozenToken, CHOICE(['B']));
  const rejectedBody = await rejected.json() as { error?: string };
  assert.equal(
    rejected.status,
    409,
    `allowResubmit 为假时改已提交的题必须被拒（409 = 当前状态不允许）：${JSON.stringify(rejectedBody)}`,
  );
  assert.match(String(rejectedBody.error), /不可修改/, '要给学生一句能看懂的中文');

  // 🔴 不只看状态码：库里那一行**一个字节都不能变**。
  const after = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { id: before.id } });
  assert.equal(JSON.stringify(after), beforeSnapshot, '被拒的保存不得改动任何字段（含 value / status / submittedAt）');
  assert.equal(after.status, 'submitted');
  assert.deepEqual(after.value, CHOICE(['A']), 'value 必须还是被拒之前的那一次');
  assert.equal(await db.prisma.worksheetAnswer.count(), answerCountBefore, '被拒的保存不得建新行');
  assert.equal(await db.prisma.worksheetResponse.count(), responseCountBefore, '被拒的保存不得顺手建作答会话');

  // ── ② allowResubmit: true（默认）—— 阳性对照 ──────────────────────────
  const freeToken = createStudentToken(freeClass.id, freeStudent.id);
  await save(editable.id, freeToken, CHOICE(['A']));
  // ⚠️ 断言提交成功：否则下面那条 200 可能只是因为「这份还没提交过」
  assert.equal((await submit(editable.id, freeToken)).status, 200);

  const allowed = await save(editable.id, freeToken, CHOICE(['B']));
  assert.equal(allowed.status, 200, `默认 allowResubmit 为真时必须允许改：${JSON.stringify(await allowed.json())}`);
  const editableRow = await db.prisma.worksheetAnswer.findFirstOrThrow({ where: { response: { worksheetId: editable.id } } });
  assert.equal(editableRow.status, 'draft', '为真时改完要回到 draft');
  assert.deepEqual(editableRow.value, CHOICE(['B']));
  // ★ B1：三列**一起**清。只清 `isCorrect` 会留下一行「没判对、但有态有分」的自相矛盾
  // 形状 —— 学生端会照 `score` 画出一个库里已经不成立的奖励，而看板照 `gradeState`
  // 画一个 ✓/◐。（断言写在这里而不是另开一条：这条 `PUT` 与上面那个 409 是同一个
  // 处理器的两侧，分开写等于允许「一侧对、另一侧忘」通过。）
  assert.equal(editableRow.isCorrect, null, '改回 draft ⇒ isCorrect 清空');
  assert.equal(editableRow.gradeState, null, '改回 draft ⇒ gradeState 必须一起清（B1）');
  assert.equal(editableRow.score, null, '改回 draft ⇒ score 必须一起清（B1）');
});

/**
 * 🔴 **409 / 401 的契约不得因为 B1 加了两列而变**（本用例是 B1 新增的）。
 *
 * 这条 `PUT` 的 `update` 里现在多了 `gradeState` / `score` 两个赋值，所以「被拒的保存
 * 一个字节都不动」这句话必须**重新证明一次**（上面那条用例的整行 JSON 快照也会盖住它，
 * 但那是顺带的，不是为它写的）。用例刻意用**半对**的行做样本：它是唯一一种
 * 「`isCorrect` 是 `false`、而这一行**有**非空得分」的形状 —— 拿一条 `incorrect` 的行
 * 测，`score` 恰好是 0，与「没清干净」的区别在有些实现里看不出来。
 *
 * 401 那一半同理：提交端点在 B1 里改了响应体形状，而**鉴权那一层与响应体形状无关** ——
 * 没有学生会话时它必须仍然是 401（不是 500，也不是一个「形状对了但泄漏了」的 200）。
 */
test('契约不变（B1）：半对的行被 409 拒绝时三列原样；学生端端点无会话仍是 401', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await db.prisma.worksheet.create({
    data: {
      title: '半对且不可重交的学习单',
      content: {
        schemaVersion: 1,
        nodes: [{
          id: 'm_1', type: 'multi-choice', prompt: '下列哪些是光合作用的原料？', inputMode: 'keyboard',
          points: { full: 3, half: 2 },
          data: {
            options: [{ key: 'A', text: '水' }, { key: 'B', text: '氧气' }, { key: 'C', text: '二氧化碳' }],
            correctKeys: ['A', 'C'], partialCredit: 'allow-missing',
          },
          children: [],
        }],
      },
      settings: { allowResubmit: false, autoGrade: true, defaultInputMode: 'keyboard' },
    },
  });
  const { classroom, participant } = await seedClassroom(db.prisma, '9021');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);

  // 先落一个**半对**的行：`isCorrect=false` + `gradeState='partial'` + `score=2`。
  await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'm_1', value: CHOICE(['A']) }, bearer(token));
  const submitted = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'm_1' }, bearer(token));
  assert.equal(submitted.status, 200, JSON.stringify(await submitted.json()));
  const before = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.deepEqual(
    [before.isCorrect, before.gradeState, before.score],
    [false, 'partial', 2],
    '前置条件：这一行必须是半对（否则下面测的不是它）',
  );

  // ① 409：改已提交的题被拒 ⇒ 三个判分列原样（含 `isCorrect=false` 这个**不是**「错」的值）。
  const rejected = await server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId: 'm_1', value: CHOICE(['A', 'B']) }, bearer(token));
  assert.equal(rejected.status, 409, await rejected.text());
  const after = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.deepEqual(
    [after.isCorrect, after.gradeState, after.score, after.status],
    [false, 'partial', 2, 'submitted'],
    '被拒的保存不得改动 value / status / submittedAt，也不得改动判分的三列',
  );

  // ② 401：没有学生会话（只带教师 cookie）⇒ 401，且**不得**落一个形状正确的 200。
  const asTeacher = await server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId: 'm_1' });
  assert.equal(asTeacher.status, 401, await asTeacher.text());
  const stillThere = await db.prisma.worksheetAnswer.findFirstOrThrow();
  assert.deepEqual([stillThere.gradeState, stillThere.score], ['partial', 2], '被拒的提交不得改动判分列');
});

// ---------------------------------------------------------------------------
// ⑥ 鉴权边角：教师 cookie 打学生端端点、目标已被删
// ---------------------------------------------------------------------------

/**
 * 闸门对**教师**是放行的（它是混装路由，教师端端点也要走它）⇒ 学生端的处理器
 * **必须自己**处理「没有学生会话」。少了这一步，教师误点学生端 URL 会拿到 500
 * （`student.studentId` 打在 null 上），而日志里只有一句 TypeError。
 */
test('鉴权：教师 cookie 打学生端四个端点 ⇒ 401（不是 500）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom } = await seedClassroom(db.prisma, '9012');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });

  const res = await Promise.all([
    server.get(`/api/worksheets/${worksheet.id}/student-view`),
    // ⚠️ 第四条是本任务（水合修复）新增的：**没有学生会话时它必须是 401，不是 500** ——
    // 闸门认的是「有没有学生 token」，而教师 cookie 也能过闸门 ⇒ 处理器自己那一层
    // `requireOwnWorksheet` 是唯一的防线。漏了它，教师误点这个 URL 会得到一句 TypeError。
    server.get(`/api/worksheets/${worksheet.id}/answers`),
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

// ---------------------------------------------------------------------------
// ⑦ 学生已有的作答回读（`GET /:id/answers`）—— 「刷新后做好的题没了」的修复
// ---------------------------------------------------------------------------

/**
 * 🔴 **「学生做了一半刷新页面后，做好的题没了」** —— 这一条钉的就是它。
 *
 * 成因不是数据丢了，而是**服务端从来不下发**：`WorksheetAnswer` 的行一直在库里，
 * 而 `student-view` 只回 `{ id, title, description, content, settings }`；学生端的
 * `localStorage` 队列又**只留还没保存成功的条目**（PUT 一 200 就出队）⇒ 保存成功的题
 * 在客户端没有任何留底，刷新即空白。
 *
 * 所以本用例刻意分**两段**，它们回答的是两个不同的问题：
 *   · ①「**数据丢没丢**」—— 直接查库，那三行必须原样还在（这是分水岭：库里有 = 没丢）；
 *   · ②「**刷新后学生还能不能看到**」—— 换成刷新后重建的**新 token**，重新 GET，
 *     那三题必须带着 `value` / `status` / `submittedAt` / `isCorrect` 一起回来。
 *
 * ⚠️ 只断言 ① 是一条**假绿**：库里有而学生看不到，正是这次要修的那个 bug。
 * 只断言 ② 也不够：一个「回读时现编一份」的实现也能让它绿，而学生的作答其实早没了。
 *
 * ★ **反证**：把新端点摘掉（或把 `worksheetAccessGate` 的学生放行集回退成三条），
 * ② 立刻变红（403 / 404）—— 这条用例测的正是「有没有把已有的作答发回去」。
 */
test('刷新：已保存的作答仍在库里，且刷新后仍能读回（value/status/submittedAt/isCorrect）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9016');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const save = (questionId: string, value: unknown) =>
    server.put(`/api/worksheets/${worksheet.id}/answers`, { questionId, value }, bearer(token));
  const submit = (questionId: string) =>
    server.post(`/api/worksheets/${worksheet.id}/answers/submit`, { questionId }, bearer(token));

  // ── 学生做完整卷：q_1 答**错**、q_2 答**错**、q_3 问答（不判分）、q_4~q_6 新题型 ──
  // ⚠️ 两道客观题刻意都答错，且答的是一个**正确里没有的字符串**（`CO2` / `A`）——
  // 下面靠它做「下发的是学生自己写的那个值、不是正确答案」的阳性对照。
  await save('q_1', CHOICE(['A']));
  await submit('q_1');
  await save('q_2', FILL('CO2'));
  await submit('q_2');
  await save('q_3', { format: 'text/v1', text: '叶子冒泡' });
  await submit('q_3');
  // M4a 新增的三道题也要作答：整卷交齐判的是**全卷**（见 `ensureResponse`）。
  await save('q_4', { format: 'order/v1', order: ['i2', 'i1'] });
  await submit('q_4');
  await save('q_5', { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r2' }] });
  await submit('q_5');
  await save('q_6', { format: 'categorize/v1', assignment: { i1: 'z1' } });
  await submit('q_6');

  // ── ① 数据丢没丢：直接查库（分水岭）────────────────────────────────────
  const stored = await db.prisma.worksheetAnswer.findMany({ orderBy: { questionId: 'asc' } });
  assert.equal(stored.length, 6, '六道题的作答必须都在库里 —— 这是「数据没丢」的直接证据');
  assert.equal((await db.prisma.worksheetResponse.findFirstOrThrow()).status, 'submitted');

  // ── 「刷新页面」：会话重建（新 token），重新读一次 ─────────────────────────
  const refreshed = createStudentToken(classroom.id, participant.id);
  const res = await server.get(`/api/worksheets/${worksheet.id}/answers`, bearer(refreshed));
  const raw = await res.text();
  assert.equal(res.status, 200, raw);
  const body = JSON.parse(raw) as {
    rows: Array<{
      questionId: string; value: unknown; status: string;
      submittedAt: string | null; isCorrect: boolean | null;
      gradeState: string | null; score: number | null;
    }>;
  };

  // ── ② 刷新后学生还能不能看到 ──────────────────────────────────────────
  // ⚠️ 信封那个键是 `rows`（「作答行」），**不是** `answers` —— 后者是 `ANSWER_KEYS`
  // 里**正确答案**那个字段的名字，见 `routes/worksheets.ts` 那段注释。逐字钉住它，
  // 免得将来有人「顺手改个更自然的名字」而把下面那条键名扫描变成一处误报。
  assert.deepEqual(Object.keys(body), ['rows'], `信封只能是 rows：${raw}`);
  const byId = new Map(body.rows.map(row => [row.questionId, row]));
  assert.equal(body.rows.length, 6, `六道题的作答一道都不能少：${raw}`);
  assert.deepEqual(
    [...byId.keys()].sort(),
    ['q_1', 'q_2', 'q_3', 'q_4', 'q_5', 'q_6'],
    'key 是 questionId —— 前端靠它把作答贴回对应的题（规格 §3-P：题 id 稳定）',
  );

  const q1 = byId.get('q_1')!;
  assert.deepEqual(q1.value, CHOICE(['A']), '回读的必须是**学生自己写的那个值**');
  assert.equal(q1.status, 'submitted');
  assert.ok(q1.submittedAt, 'submittedAt 要带上（「什么时候交的」是看板与回顾的输入）');
  assert.equal(q1.isCorrect, false, '答错了就如实回 false —— 奖励要靠它才能在刷新后重新画出来');
  // ★ B1：三态与得分也必须撑得过刷新（这一条端点的存在理由就是「刷新后奖励消失」，
  // 而 M4a 的奖励**由得分驱动** ⇒ 只回 `isCorrect` 的话刷新后照样画不出奖励）。
  assert.equal(q1.gradeState, 'incorrect', '三态要回读出来（看板的 ◐/✓/✗ 靠它）');
  assert.equal(q1.score, 0, '判错是 0 分 —— 学习单级没配 `rewardStep` ⇒ 全对档 = 默认的 1');

  const q2 = byId.get('q_2')!;
  assert.deepEqual(q2.value, FILL('CO2'));
  assert.equal(q2.status, 'submitted');
  assert.ok(q2.submittedAt);
  assert.equal(q2.isCorrect, false);
  assert.equal(q2.gradeState, 'incorrect');
  assert.equal(q2.score, 0);

  const q3 = byId.get('q_3')!;
  assert.deepEqual(q3.value, { format: 'text/v1', text: '叶子冒泡' });
  assert.equal(q3.status, 'submitted');
  assert.equal(q3.isCorrect, null, '主观题不判分 ⇒ null（**不是** false）');
  assert.equal(q3.gradeState, null, '三态一起是 null —— 「没判」不是「判错」');
  assert.equal(q3.score, null, '得分一起是 null —— 「没判」不是 0 分');

  // ── ③ 🔴 安全：这条新路径不得把正确答案捎出来（规格 §5.4）───────────────
  // 判据一（键名级、递归）：`ANSWER_KEYS` 一个都不许作为**键**出现 —— **整份响应**都扫，
  // 不排除任何子树。（曾短暂地排除过每行作答的 `value`，理由是 `match/v1` / `categorize/v1`
  // 的字段名与黑名单里 `pairs` / `placement` 撞名；**那个理由已经作废** ——
  // 2026-09-23 裁定把作答值的键名改成 `links` / `assignment`，撞名从协议侧消失了。
  // 排除子树这件事本身是危险的：它正好会漏掉「答案被塞进学生自己的作答里」这一类。）
  const keys = collectKeys(JSON.parse(raw));
  for (const key of ANSWER_KEYS) {
    assert.ok(!keys.has(key), `回读响应里出现了答案键「${key}」（规格 §5.4 红线）：${raw}`);
  }

  // 判据一之补强：行的**形状**也要钉死 —— 多出任何一个键都可能是捎带出来的题目数据。
  // ⚠️ B1 往这个集合里加了 `gradeState` / `score` 两个键，那是**有意的协议变更**
  // （规格 §12），不是「红线松了」：两个键都是判分结果，与题目数据无关 ——
  // 而上面那条键名级红线照样逐字扫整份响应，`ANSWER_KEYS` 仍然一个都不许出现。
  for (const row of body.rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['gradeState', 'isCorrect', 'questionId', 'score', 'status', 'submittedAt', 'value'],
      `每一行只许有这几个键（多一个就可能是捎带出来的题目数据）：${raw}`,
    );
  }

  // 判据二（原文级）：`ANSWER_KEYS` 每一个连**字面量**都不该有（键名级漏掉的编码形式）。
  for (const literal of ANSWER_KEYS) {
    assert.ok(!raw.includes(literal), `回读响应原文里不该出现「${literal}」：${raw}`);
  }
  // 判据三（**阳性对照**，两条缺一不可）：
  //   · 学生写的那个错答案**在** —— 否则「搜不到正确答案」可能只是因为响应是空的；
  //   · 正确答案（`H2O` / 单选的正确项 `B`）**不在** —— 这才是这条真正要证明的事。
  assert.ok(raw.includes('CO2'), '学生自己写的作答必须在响应里（否则上面「搜不到」是空的）');
  assert.ok(!raw.includes('H2O'), `正确答案不得随作答回读一起下发：${raw}`);
  // ⚠️ 单选的正确项是一个字母（`B`），拿子串搜它会与 uuid / 时间戳里的同名字母混淆，
  // 所以那一半用**值相等**来断，而不是 `includes`：q_1 的 value 里只能有 `A`。
  assert.deepEqual(q1.value, CHOICE(['A']), '单选题回读的是学生选的那一项，不是正确项');

  // 阳性对照（夹具侧）：同一份学习单走**教师端**读时答案是**在**的 ——
  // 少了它，上面那几条「搜不到」可能只是因为夹具里根本没有答案。
  const teacherRaw = await (await server.get(`/api/worksheets/${worksheet.id}`)).text();
  assert.ok(teacherRaw.includes('H2O') && teacherRaw.includes('correctKeys'), '夹具里必须有答案，否则红线断言无效');
});

/**
 * 边界与越权（三条，都是「新端点必须和另外三条学生形状同款」）：
 *   · 还没作答 ⇒ `{ rows: [] }`，**不是** 404/500（没开始是合法状态）；
 *   · 高级模式下**别人组**那一份 ⇒ 403（与 `student-view` 同一条判据，
 *     `requireOwnWorksheet` 是三条学生路径共用的前置校验）；
 *   · 教师 cookie ⇒ 401（闸门放行 ≠ 有学生会话；少了这一步会 500）。
 */
test('回读：没作答是空数组；别人组那份 403；教师 cookie 401', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(path.dirname(db.file), { recursive: true, force: true }); });
  const server = await startServer(t, db.prisma);

  // ① 空
  const worksheet = await seedWorksheet(db.prisma);
  const { classroom, participant } = await seedClassroom(db.prisma, '9017');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const token = createStudentToken(classroom.id, participant.id);
  const empty = await server.get(`/api/worksheets/${worksheet.id}/answers`, bearer(token));
  const emptyRaw = await empty.text();
  assert.equal(empty.status, 200, emptyRaw);
  assert.deepEqual(JSON.parse(emptyRaw), { rows: [] }, '没开始作答 = 空数组，不是 404、也不是 500');
  // ⚠️ 空响应对**没有作答会话**的学生同样成立：读路径不得顺手建一行
  // `WorksheetResponse`（那会让教师看板把一个什么都没做的学生显示成「已开始作答」）。
  assert.equal(await db.prisma.worksheetResponse.count(), 0, '读作答不得留下作答会话');

  // ② 越权：高级模式下 A 组的学生读 B 组那一份的作答 ⇒ 403
  const { classroom: advClass, worksheetA, worksheetB, participantA } = await seedAdvancedClassroom(db.prisma, '9018');
  const tokenA = createStudentToken(advClass.id, participantA.id);
  const stolen = await server.get(`/api/worksheets/${worksheetB.id}/answers`, bearer(tokenA));
  assert.equal(stolen.status, 403, `不得读别人组那份的作答：${await stolen.text()}`);
  // 阳性对照：同一 token 读**自己组**那份必须 200
  const own = await server.get(`/api/worksheets/${worksheetA.id}/answers`, bearer(tokenA));
  assert.equal(own.status, 200, JSON.stringify(await own.json()));

  // ③ 教师 cookie（闸门放行，但没有学生会话）⇒ 401，不是 500
  const asTeacher = await server.get(`/api/worksheets/${worksheet.id}/answers`);
  assert.equal(asTeacher.status, 401, await asTeacher.text());

  // ④ **「清空」的往返**：学生做过一题、又把它删干净（客户端为此**不发 `value` 键**，
  //    见 `use-worksheet-answers.ts` 的 `putAnswer`）⇒ 库里那一行还在、`value` 是 SQL NULL。
  //    回读时它必须解析成 `null`，前端才认得出「这一题是空的」而不是「这一题有值但读不出来」。
  //    ⚠️ 这一条钉的是**列的类型**：`value` 是 `Json?`，Prisma 读 SQL NULL 回来的是 `null`
  //    而不是 `undefined`（后者会被 `JSON.stringify` 整个丢掉，字段直接消失 ——
  //    前端拿到的就是「没有这个键」，两种都还能跑，但形状必须是有人决定过的）。
  const { classroom: clearClass, participant: clearStudent } = await seedClassroom(db.prisma, '9019');
  const clearWs = await seedWorksheet(db.prisma, '会被清空的学习单');
  await db.prisma.classroomWorksheet.create({ data: { classroomId: clearClass.id, worksheetId: clearWs.id } });
  const clearToken = createStudentToken(clearClass.id, clearStudent.id);
  await server.put(`/api/worksheets/${clearWs.id}/answers`, { questionId: 'q_2', value: FILL('H2O') }, bearer(clearToken));
  const cleared = await server.put(`/api/worksheets/${clearWs.id}/answers`, { questionId: 'q_2' }, bearer(clearToken));
  assert.equal(cleared.status, 200, JSON.stringify(await cleared.json()));
  const clearedBody = await (await server.get(`/api/worksheets/${clearWs.id}/answers`, bearer(clearToken))).json() as {
    rows: Array<{ questionId: string; value: unknown; status: string }>;
  };
  assert.equal(clearedBody.rows.length, 1, '清空**不删行** —— 那一行还在，只是值是空的');
  assert.equal(clearedBody.rows[0].questionId, 'q_2');
  assert.equal(clearedBody.rows[0].value, null, '清空过的行回读时 `value` 必须是 null');
  assert.equal(clearedBody.rows[0].status, 'draft', '清空之后回到 draft');
});
