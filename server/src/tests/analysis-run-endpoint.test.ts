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
// ★ 2026-10-07：下面那条「本地有结论的行不许被 AI 盖掉」要**自己证明前置条件**
//（本地判分对那道题真的有结论）—— 否则用例是空的。
import { grade, type QuestionNode } from '../services/worksheet-questions.js';

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
async function startFakeCoze(answer: string): Promise<{ base: string; close: () => void; hits: string[]; messages: string[]; setAnswer: (next: string) => void }> {
  /* ★ 2026-10-07：支持两次调用之间换「模型」的产出 —— 「补跑不动整体解读」那一条靠它才验得出来。 */
  let current = answer;
  const hits: string[] = [];
  // 真正发出去的那段提示词（`additional_messages[*].content`）。**只有在这里才验得到**：
  // 界面上的预览没有这段文本，`buildAnalysisMessage` 的用例又够不到「题面 → 载荷 → 提示词」这条线。
  const messages: string[] = [];
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { hits.push(`${req.method} ${req.path}`); next(); });
  app.post('/v1/files/upload', (_req, res) => { res.json({ code: 0, data: { id: 'file-1' } }); });
  app.post('/v3/chat', (req, res) => {
    const sent = (req.body as { additional_messages?: Array<{ content?: unknown }> } | undefined)?.additional_messages ?? [];
    for (const message of sent) {
      if (typeof message.content === 'string') messages.push(message.content);
    }
    res.json({ code: 0, data: { id: 'chat-1', conversation_id: 'conv-1', bot_id: 'bot-1', status: 'in_progress', created_at: 1 } });
  });
  app.get('/v3/chat/retrieve', (_req, res) => {
    res.json({ code: 0, data: { id: 'chat-1', conversation_id: 'conv-1', bot_id: 'bot-1', status: 'completed', created_at: 1 } });
  });
  app.get('/v3/chat/message/list', (_req, res) => {
    res.json({
      code: 0,
      data: [{
        id: 'm1', conversation_id: 'conv-1', role: 'assistant', content: current,
        content_type: 'text', type: 'answer', created_at: 1, updated_at: 1,
      }],
    });
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close(), hits, messages, setAnswer: (next: string) => { current = next; } };
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

/** 一个参与者的作答值（笔迹），下面几处都要用。 */
const INK_VALUE = {
  format: 'ink/v1', canvas: { w: 320, h: 240 },
  strokes: [{ points: [[0.1, 0.1], [0.9, 0.9]], width: 0.01, color: '#111111' }],
};

/**
 * 一节标准模式的课 + 一份绘图学习单 + 每个名册条目一份已提交的笔迹作答。返回那几个 id。
 *
 * ★ 2026-10-07（教师：标签改用「姓名 + 学号」）—— 夹具**必须有真名**：
 * 没有 `studentId` 的参与者拿不到姓名，标签会退化成「未命名参与者#xxxx」，
 * 而模型收到的名单就是那一串 ⇒ 这些用例里所有假 Coze 的回答都得跟着编。
 */
async function seed(
  p: PrismaClient,
  opts: {
    analysisAgentId?: string | null; withAnswer?: boolean; node?: Prisma.InputJsonValue;
    /** `group: true` 造一个**组**参与者（组名就是标签，不带尾号）。 */
    roster?: Array<{ name: string; studentNo?: string | null; group?: boolean }>;
  } = {},
) {
  const worksheet = await p.worksheet.create({
    data: {
      title: '学习单',
      content: { schemaVersion: 1, nodes: [opts.node ?? DRAWING] },
      settings: { analysisAgentId: opts.analysisAgentId ?? null },
    },
  });
  const classroom = await p.classroom.create({ data: { title: '课', code: `70${Math.floor(Math.random() * 90 + 10)}`, status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const roster = opts.roster ?? [{ name: '张伟', studentNo: '7' }];
  const participants: string[] = [];
  for (const [index, entry] of roster.entries()) {
    let participantId: string;
    if (entry.group) {
      const group = await p.classroomGroup.create({ data: { classroomId: classroom.id, name: entry.name } });
      participantId = (await p.classroomStudent.create({
        data: { classroomId: classroom.id, type: 'group', groupId: group.id },
      })).id;
    } else {
      const klass = await p.class.create({ data: { name: `测试班${index}` } });
      const student = await p.student.create({
        data: { classId: klass.id, name: entry.name, studentNo: entry.studentNo ?? null },
      });
      participantId = (await p.classroomStudent.create({
        data: { classroomId: classroom.id, type: 'student', studentId: student.id },
      })).id;
    }
    participants.push(participantId);
    const response = await p.worksheetResponse.create({
      data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId },
    });
    if (opts.withAnswer !== false) {
      await p.worksheetAnswer.create({
        data: { responseId: response.id, questionId: 'q3', status: 'submitted', value: INK_VALUE },
      });
    }
  }
  return { worksheet, classroom, participants };
}

/** 「张伟#7」这种标签在假 Coze 的回答里要逐字写对 —— 写错就等于模型没认出名册上的人。 */
const ZHANG = '张伟#7';
const LI = '李四#12';
const TWO_STUDENTS = [{ name: '张伟', studentNo: '7' }, { name: '李四', studentNo: '12' }];

/** 造一个分析智能体；`apiUrl` 指向假端点。 */
async function makeAgent(p: PrismaClient, platform: string, apiUrl: string | null) {
  return p.agent.create({
    data: { name: '分析助手', platform, apiKey: 'fake-key', botId: 'bot-1', apiUrl, enabled: true, purpose: 'analysis' },
  });
}

test('🔴 成功路径：写回 narrative/agentId/model，且**一个载荷字段都不动**', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('整体情况：多数人画成了满月。典型错误见 张伟#7。');
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

/*
  ★ 2026-10-07（教师：全班 40 人一起交给智能体）——
  模型漏人时，**这一轮拿到的分照样要落库**，并把「缺谁」一并存下来给教师面板。
  🔴 原来是全有或全无：40 人的班上模型少写一行 ⇒ 整次 502、**一个学生的分都不落库**。
*/
test('★ 模型漏人 ⇒ 照样写（拿到几份存几份），并点名报出缺谁', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"可以再补一个判断分支。"}]}</classnode-scores>');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  // ⚠️ 这一题要**开了 AI 评分**才会走逐生分数那条路（`aiScoringConfigOf`：`data.aiScoringEnabled === true`）。
  // 两个**已提交**的学生：模型只评了其中一个，另一个要点名报出来。
  const { worksheet, classroom } = await seed(p, {
    analysisAgentId: agent.id,
    node: { ...(DRAWING as Record<string, unknown>), data: { aiScoringEnabled: true, aiScoringMaxScore: 5 } } as Prisma.InputJsonValue,
    roster: TWO_STUDENTS,
  });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 200, '漏一个人不再整次失败 —— 40 人班上那等于全丢');
  const row = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  const perStudent = row.perStudent as { scores?: unknown[]; missing?: unknown[] } | null;
  assert.equal(perStudent?.scores?.length, 1, '这一轮拿到的那一份要落库');
  assert.equal(perStudent?.missing?.length, 1, '缺的那一个要点名存下来（教师据此补跑）');
  assert.ok(row.narrative, '解读也要照存（它是独立的一份）');
});

/*
  ★ 2026-10-07（教师问：「只补这几个人的话，**AI 对整体的分析是不是也要更新呢**？」）——
  答案：**要，但不能在这一轮里更新**。补跑只发了几个人，模型给的那段「整体解读」说的就是这几个人，
  拿它盖掉全班那份是错的。⇒ 补跑**只补分、不动整体解读**；「整体解读是按几个人写的」由面板
  自己对照着说出来（人齐了提示教师重新生成一遍）。
  这条用例把「不动整体解读」钉死：第二次跑之前**换掉模型产出**，跑完解读必须还是第一次那段。
*/
test('★ 只补这几个人：只发他们、把分并进去、**不动整体解读**', async (t) => {
  const db = await openTempDb();
  const first = '全班整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>';
  const fake = await startFakeCoze(first);
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, {
    analysisAgentId: agent.id,
    node: { ...(DRAWING as Record<string, unknown>), data: { aiScoringEnabled: true, aiScoringMaxScore: 5 } } as Prisma.InputJsonValue,
    roster: TWO_STUDENTS,
  });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });

  // 第一次：全班（模型只评了其中一个）
  const full = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(full.status, 200);
  const afterFull = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  const firstNarrative = afterFull.narrative;
  const firstPerStudent = afterFull.perStudent as { scores: Array<{ studentId: string }>; missing?: string[] };
  assert.equal(firstPerStudent.scores.length, 1);
  assert.equal(firstPerStudent.missing?.length, 1);
  const missingId = firstPerStudent.missing![0];

  /*
   * 第二次：只补那一个（模型这次给的是**另一段**解读 —— 它不该被采用）。
   * 🔴 标签写的是**李四**的，不是「这批里的第一个」：新标签由名册派生，补跑时不会变形。
   *    老的下标派生写法下李四在全量里是 `User_002`、在这批里是 `User_001` ——
   *    也就是说**教师刚核对过的那张图与补跑发出去的那张根本不是同一套标签**。
   */
  fake.setAnswer('只看了看这一个同学。<classnode-scores>{"scores":[{"student":"' + LI + '","score":5,"reason":"补上了","advice":"很好。"}]}</classnode-scores>');
  const scopedUrl = `${runUrl(srv.base, worksheet.id, 'q3', classroom.id)}&only=${missingId}`;
  const scoped = await fetch(scopedUrl, { method: 'POST' });
  assert.equal(scoped.status, 200, '补跑不该失败');
  const afterScoped = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  assert.equal(afterScoped.narrative, firstNarrative, '补跑把「全班整体解读」换成了「只看了这一个同学」——那正是教师担心的那件事');
  const merged = afterScoped.perStudent as { scores: Array<{ studentId: string }>; missing?: string[] };
  assert.equal(merged.scores.length, 2, '补跑要把缺的那个人补上，并保留之前那位');
  assert.equal(merged.missing, undefined, '人齐了就不该再报「缺谁」');
  // 回给界面的也必须还是存下来的那段（否则面板会拿「只看了一个人」那段当全班结论显示）。
  const body = await scoped.json() as { narrative?: string };
  assert.equal(body.narrative, firstNarrative);
});

/*
  ★ 2026-10-07（教师：40 人一起交给智能体）—— **模型硬编的行也收不进来**。
  某个学生的作答这一版读不出来（快照没抓到、形状也认不出 ⇒ `kind: 'unknown'`），
  就算模型在机器块里给他编了一行，服务端也不认（`byLabel` 里没有他）⇒
  学生端不会出现「一个没有任何依据的分」。
*/
test('★ 读不出作答的学生：模型编的行不算数，他会出现在「评不了」而不是「补跑」里', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('');            // 拿到那位学生的**真标签**之后再 setAnswer
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom, participants } = await seed(p, {
    analysisAgentId: agent.id,
    node: { ...(DRAWING as Record<string, unknown>), data: { aiScoringEnabled: true, aiScoringMaxScore: 5 } } as Prisma.InputJsonValue,
    roster: TWO_STUDENTS,
  });
  // 第二位学生：已提交，但作答的**形状这一版读不出来**（不是 ink，也不是照片）⇒ `kind: 'unknown'`。
  const second = participants[1];
  await p.worksheetAnswer.updateMany({
    where: { responseId: (await p.worksheetResponse.findFirstOrThrow({ where: { participantId: second } })).id },
    data: { value: { format: 'nonsense/v9', whatever: true } },
  });
  const srv = await withServer(p);
  t.after(() => srv.close());
  const computed = await (await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' })).json() as {
    unscorableIds?: string[];
    entries: Array<{ studentId: string; anonLabel: string }>;
  };
  assert.deepEqual(computed.unscorableIds, [second], '读不出来的那位要单独报出来（教师据此让他重交，而不是补跑）');

  /*
   * 🔴 「模型硬编一行」要用那位学生**真实的标签**来编（从载荷里取）。
   *   老写法编的是 `User_002` —— 那是夹具的产物，不是模型会看到的字符串，
   *   于是这条用例证的东西比它看起来的少。
   */
  const secondLabel = computed.entries.find((entry) => entry.studentId === second)!.anonLabel;
  fake.setAnswer('整体不错。<classnode-scores>{"scores":'
    + `[{"student":"${ZHANG}","score":4,"reason":"思路清楚","advice":"再补一个分支。"},`
    + `{"student":"${secondLabel}","score":3,"reason":"看起来还行","advice":"多练。"}]}</classnode-scores>`);

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 200);
  const row = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  const perStudent = row.perStudent as { scores: Array<{ studentId: string }>; missing?: string[] } | null;
  assert.equal(perStudent?.scores.length, 1, '模型给读不出来的那位编的行**不许**落库');
  assert.deepEqual(perStudent?.missing, [second], '他没分 ⇒ 会出现在「缺谁」里（面板再把它归到「评不了」那一类）');
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

test('🔴 指定的智能体是**学伴** ⇒ 400，且一次网络都不发（独立审查 I2）', async (t) => {
  // 为什么这条要紧：`purpose` 那道闸原先**是单向的** —— 学生看不到分析型（挡了），
  // 但分析这条路**什么型都收**。两条现实路径：① 教师把一个 bot 从「分析」改回「学伴」
  // （同一个 bot，学生也在跟它聊）⇒ 从那以后全班作业发到那个学生天天聊的 bot 上；
  // ② 任何能写 `settings.analysisAgentId` 的路径（导入 / 手改 / 复制学习单）。
  const db = await openTempDb();
  const fake = await startFakeCoze('不该被调用的解读');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const tutor = await p.agent.create({
    data: { name: '学伴', platform: 'coze', apiKey: 'k', botId: 'bot-1', apiUrl: fake.base, enabled: true, purpose: 'tutoring' },
  });
  const { worksheet, classroom } = await seed(p, { analysisAgentId: tutor.id });
  const srv = await withServer(p);
  t.after(() => srv.close());
  await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 400, '学伴 bot 不能接收全班作业');
  assert.match(String((await run.json() as Record<string, unknown>).error), /学伴|分析型/);
  assert.deepEqual(fake.hits, [], '🔴 一个字节都不许发出去');
  const row = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  assert.equal(row.narrative, null, '也不许写库');
});

test('★ 教师初始图：只有**真的带初始图**的绘图题，提示词里才有那句「初始图不算学生的作答」', async (t) => {
  // 🔴 为什么要在端到端这一层再验一遍（`analysis-agent.test.ts` 已经验了拼装那一侧）：
  //    这句话的去留由**四级接力**决定 —— 题面 → `hasDrawingStarter` 判据 → 载荷标记 → 提示词。
  //    任何一级接错（判据认错形状 / 忘了从题面传到载荷 / 每道题都置真）都**只**在
  //    「发给平台的那段文本」上表现出来，而界面上的预览里没有这段文本
  //    ⇒ 只有假端点收到的 `additional_messages` 能验到它。
  const db = await openTempDb();
  const fake = await startFakeCoze('按要求给出解读。');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const srv = await withServer(p);
  t.after(() => srv.close());

  const drawing = (data: Prisma.InputJsonObject): Prisma.InputJsonValue =>
    ({ id: 'q3', type: 'drawing', prompt: '画出水循环的过程', inputMode: 'handwriting', data, children: [] });
  const cases: Array<{ why: string; node: Prisma.InputJsonValue; expectNote: boolean }> = [
    {
      why: '绘图题 + 教师给的初始图（合法形状 `{ tool, data }`）',
      node: drawing({ drawingStarter: { tool: 'flowchart', data: { nodes: [], edges: [] } } }),
      expectNote: true,
    },
    { why: '绘图题但没有初始图', node: drawing({}), expectNote: false },
    {
      // 手改/复制来的字段：前端 `readDrawingStarter` 也不认（题型不是 drawing）。
      why: '问答题上挂着同名字段',
      node: {
        id: 'q3', type: 'short-answer', prompt: '说说你的看法', inputMode: 'keyboard',
        data: { drawingStarter: { tool: 'flowchart', data: {} } }, children: [],
      },
      expectNote: false,
    },
  ];

  for (const item of cases) {
    const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: item.node });
    const post = await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
    if (post.status !== 200) assert.fail(`${item.why}：生成载荷 HTTP ${post.status}: ${await post.text()}`);
    const before = fake.messages.length;
    const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
    if (run.status !== 200) assert.fail(`${item.why}：run HTTP ${run.status}: ${await run.text()}`);
    const sent = fake.messages.slice(before).join('\n');
    assert.ok(sent.length > 0, `${item.why}：假端点没收到提示词 —— 这条用例就没验到东西`);
    assert.equal(
      sent.includes('不要把初始图当作学生的成果'), item.expectNote,
      item.expectNote
        ? `${item.why}：提示词里缺了「初始图不算学生的作答」—— 位图快照是完整那张图，模型会把教师画的那半张算成学生的成果`
        : `${item.why}：提示词提到了初始图，可这题没有（或不该算）—— 模型会去找一段不存在的底稿`,
    );
  }
});

/*
  ★ 2026-10-07：**两条路径必须得到同一组标签。**
  教师在图上核对「第 3 格是谁」（那张图由 `layoutSheets` + `payloadLabels` 画），
  面板上的「第 3 格」读的是 GET 载荷里的 `entries[].anonLabel`，而发出去的那一份
  又是 run 端点自己重算的一遍。三处只要有一处喂了不同的名册，就会**静默**对不上 ——
  分数于是贴到另一个人头上，而屏幕上什么都没有缺一块。
  ⇒ 判据：run 端点**真发出去的那段提示词**里点名的标签，与 GET 载荷里的标签逐字相等。
*/
test('★ 重渲（GET 载荷）与再发送（run 提示词）用的是同一组标签', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('整体不错。');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, {
    analysisAgentId: agent.id,
    // 🔴 必须**开着 AI 评分**：评分那一段（含点名名单）只在开启时才拼进提示词 ——
    //    关着的话那段提示词里根本没有标签，这条判据就变成恒真的了（夹具塌了）。
    node: { ...(DRAWING as Record<string, unknown>), data: { aiScoringEnabled: true, aiScoringMaxScore: 5 } } as Prisma.InputJsonValue,
    roster: TWO_STUDENTS,
  });
  const srv = await withServer(p);
  t.after(() => srv.close());

  // 生成（把 aggregate 与总人数存下来）—— 这一步走的是「新分析」那条路径
  const post = await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  if (post.status !== 200) assert.fail(`生成载荷 HTTP ${post.status}: ${await post.text()}`);
  // 面板读的载荷（**重渲**那条路径）：`entries[].anonLabel` 就是教师在图上核对用的标签
  const payload = await (await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id))).json() as {
    entries: Array<{ anonLabel: string }>;
  };
  const fromPayload = payload.entries.map((entry) => entry.anonLabel);
  // ⚠️ 比**集合**不比顺序：条目顺序按 `studentId`（uuid）排，与名册顺序无关。
  assert.deepEqual([...fromPayload].sort(), [ZHANG, LI].sort(), 'GET 载荷上的标签');

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 200, await run.text());
  const sent = fake.messages.join('\n');
  for (const label of fromPayload) {
    assert.ok(sent.includes(label), `发出去的提示词里没有 ${label} —— 两条路径喂了不同的名册`);
  }
});

/*
  ★ 2026-10-07：**接线**也要钉 —— 上面那些单元判据证的是 `parseAiAnalysisResult` 认得别名，
  可它认不认**取决于端点有没有把姓名喂进去**。喂不进去的表现是「模型只回姓名时整班收不到分」，
  而屏幕上一片正常（只是一批人进了「缺谁」）—— 单测对这一层是**恒真**的。
*/
test('★ 端到端：模型只回姓名（丢掉 #学号），分照样收得到', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"张伟","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, {
    analysisAgentId: agent.id,
    node: { ...(DRAWING as Record<string, unknown>), data: { aiScoringEnabled: true, aiScoringMaxScore: 5 } } as Prisma.InputJsonValue,
  });
  const srv = await withServer(p);
  t.after(() => srv.close());

  const post = await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  if (post.status !== 200) assert.fail(`生成载荷 HTTP ${post.status}: ${await post.text()}`);
  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 200, await run.text());

  const row = await p.worksheetQuestionAnalysis.findFirstOrThrow({ where: { worksheetId: worksheet.id } });
  const perStudent = row.perStudent as { scores: Array<{ studentId: string }>; missing?: string[] } | null;
  assert.equal(perStudent?.scores.length, 1, '只回姓名也要收得到 —— 端点必须把姓名喂进解析那一侧');
  assert.equal(perStudent?.missing, undefined);
});

/* ══════════════════════════════════════════════════════════════════════════
   ★ 2026-10-07（教师：「AI 的评分是要写回的，要参与总分的统计」）
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 一道**绘图题**：本地判分对它恒回 `null`（`judge` 认 ink 值 ⇒ 不判）
 * ⇒ 行里非空的判分三列**只可能来自 AI**。
 * ⚠️ `points.full` 必须是 10：不写它的话 `resolvePoints(node, DEFAULT_POINTS)` 给的是 1，
 * 于是「4/5 × 10 = 8」这条判据会在一个恒为 1 的分母上退化。
 */
const DRAWING_AI = {
  ...(DRAWING as Record<string, unknown>),
  points: { full: 10, half: 5 },
  data: { aiScoringEnabled: true, aiScoringMaxScore: 5 },
} as Prisma.InputJsonValue;

/** 一次「生成载荷 + run」——下面每一条都要走这两步。 */
async function generateAndRun(srv: { base: string }, worksheetId: string, classroomId: string) {
  const post = await fetch(payloadUrl(srv.base, worksheetId, 'q3', classroomId), { method: 'POST' });
  if (post.status !== 200) assert.fail(`生成载荷 HTTP ${post.status}: ${await post.text()}`);
  return fetch(runUrl(srv.base, worksheetId, 'q3', classroomId), { method: 'POST' });
}

/** 某一行的判分三列（**整组**读 —— 只读一个会把「三列不一致」漏过去）。 */
async function gradeOf(p: PrismaClient, responseId: string) {
  const row = await p.worksheetAnswer.findFirstOrThrow({ where: { responseId, questionId: 'q3' } });
  return { isCorrect: row.isCorrect, gradeState: row.gradeState, score: row.score };
}

test('★ 写回：AI 的分进了成绩（教师：「AI 的评分是要写回的，要参与总分的统计」）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: DRAWING_AI });
  const srv = await withServer(p);
  t.after(() => srv.close());

  const run = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(run.status, 200, await run.text());

  const response = await p.worksheetResponse.findFirstOrThrow({ where: { classroomId: classroom.id } });
  assert.deepEqual(
    await gradeOf(p, response.id),
    { isCorrect: false, gradeState: 'partial', score: 8 },
    'AI 给 4/5、题目 10 分 ⇒ 记 8 分（教师给的例子）',
  );
});

test('🔴 AI 明说判不了（score: null）⇒ 三列一个字都不动', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":null,"reason":"图太糊","advice":"重新拍一张。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: DRAWING_AI });
  const srv = await withServer(p);
  t.after(() => srv.close());

  // 行里**原有的**值（上一轮留下的 / 教师手工改过）
  await p.worksheetAnswer.updateMany({ data: { isCorrect: true, gradeState: 'correct', score: 10 } });

  const run = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(run.status, 200, await run.text());

  const response = await p.worksheetResponse.findFirstOrThrow({ where: { classroomId: classroom.id } });
  assert.deepEqual(
    await gradeOf(p, response.id),
    { isCorrect: true, gradeState: 'correct', score: 10 },
    'AI 说判不了 ⇒ 一个字段都不许动（保留行里原有的值）',
  );
});

test('★ 写回只动**这个课堂**的行（同一份学习单被两个班同时引用）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: DRAWING_AI });
  const srv = await withServer(p);
  t.after(() => srv.close());

  /*
   * 另一个班：**同一份学习单**（`Worksheet` 本来就可以被多个课堂引用）+ 另一个参与者与作答行。
   *
   * ⚠️ 这条**不是**「写回的 `where` 少带一个 `classroomId`」的哨兵 —— 那一句我试过了，
   *   去掉它这条**照样绿**：`participantId` 是 `ClassroomStudent.id`，本身就是课堂内的，
   *   所以 `worksheetId + participantId IN (…)` 已经足够唯一。
   * 它证的是**真实的那一条**：写回只在**本课堂的参与者名单**里找行，别的班那一行不会被动
   *   （名单来自本课堂分析存的 `aggregate`）。那种写法下两个屏幕都不报错，
   *   而 B 班学生的分被 A 班的分析改掉 —— 所以这条留着。
   */
  const otherClassroom = await p.classroom.create({ data: { title: '另一个班', code: '7099', status: 'active', mode: 'standard' } });
  await p.classroomWorksheet.create({ data: { classroomId: otherClassroom.id, worksheetId: worksheet.id } });
  const otherParticipant = await p.classroomStudent.create({ data: { classroomId: otherClassroom.id, type: 'student' } });
  const otherResponse = await p.worksheetResponse.create({
    data: { classroomId: otherClassroom.id, worksheetId: worksheet.id, participantId: otherParticipant.id },
  });
  await p.worksheetAnswer.create({
    data: {
      responseId: otherResponse.id, questionId: 'q3', status: 'submitted', value: INK_VALUE,
      isCorrect: false, gradeState: 'incorrect', score: 3,
    },
  });

  const run = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(run.status, 200, await run.text());

  assert.deepEqual(
    await gradeOf(p, otherResponse.id),
    { isCorrect: false, gradeState: 'incorrect', score: 3 },
    '别的班那一行被改了 —— 写回的 where 少了 classroomId',
  );
});

test('★ 补跑（?only=）不许把没参与这一轮的学生改掉', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze('');
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom, participants } = await seed(p, {
    analysisAgentId: agent.id, node: DRAWING_AI, roster: TWO_STUDENTS,
  });
  const srv = await withServer(p);
  t.after(() => srv.close());

  // 第一次：两个人都拿到分
  fake.setAnswer('整体不错。<classnode-scores>{"scores":['
    + `{"student":"${ZHANG}","score":2,"reason":"刚起步","advice":"再补细节。"},`
    + `{"student":"${LI}","score":5,"reason":"完整","advice":"很好。"}]}</classnode-scores>`);
  const first = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(first.status, 200, await first.text());

  const responseOf = async (participantId: string) =>
    (await p.worksheetResponse.findFirstOrThrow({ where: { participantId } })).id;
  const [zhang, li] = participants;
  assert.equal((await gradeOf(p, await responseOf(zhang))).score, 4, '张伟：2/5 × 10');
  assert.equal((await gradeOf(p, await responseOf(li))).score, 10, '李四：5/5 × 10');

  // 补跑：只发张伟一个人，给他一个新分
  fake.setAnswer(`只看了这一个。<classnode-scores>{"scores":[{"student":"${ZHANG}","score":5,"reason":"补上了","advice":"很好。"}]}</classnode-scores>`);
  const scoped = await fetch(`${runUrl(srv.base, worksheet.id, 'q3', classroom.id)}&only=${zhang}`, { method: 'POST' });
  assert.equal(scoped.status, 200, await scoped.text());

  assert.equal((await gradeOf(p, await responseOf(zhang))).score, 10, '补跑的那一个人以**新分**为准（教师决定 3）');
  assert.equal((await gradeOf(p, await responseOf(li))).score, 10, '没参与这一轮的人**保留原值**，不许被清掉');
});

test('★ 参与者是「组」时也写得进去（标签是组名，键还是 ClassroomStudent.id）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"第一组","score":5,"reason":"完整","advice":"很好。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, {
    analysisAgentId: agent.id, node: DRAWING_AI, roster: [{ name: '第一组', group: true }],
  });
  const srv = await withServer(p);
  t.after(() => srv.close());

  const run = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(run.status, 200, await run.text());

  const response = await p.worksheetResponse.findFirstOrThrow({ where: { classroomId: classroom.id } });
  assert.equal(
    (await gradeOf(p, response.id)).score, 10,
    '组参与者的作答行也要写回 —— 写回这一侧按 participantId 找行，没有学生/组的分支',
  );
});

test('🔴 草稿行一个字都不写（草稿行的判分三列必须是 null）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: DRAWING_AI });
  const srv = await withServer(p);
  t.after(() => srv.close());

  /*
   * ⚠️ 时序必须是**生成时已提交 → 分析期间学生改回草稿 → run**（真实场景：教师点了分析，
   *   一两分钟里学生又动了一下这道题）。反过来先改草稿的话，载荷里根本没有他 ⇒
   *   网关直接 400，这条用例就变成在考别的东西了。
   */
  const post = await fetch(payloadUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  if (post.status !== 200) assert.fail(`生成载荷 HTTP ${post.status}: ${await post.text()}`);
  await p.worksheetAnswer.updateMany({ data: { status: 'draft' } });

  const run = await fetch(runUrl(srv.base, worksheet.id, 'q3', classroom.id), { method: 'POST' });
  assert.equal(run.status, 200, await run.text());

  const response = await p.worksheetResponse.findFirstOrThrow({ where: { classroomId: classroom.id } });
  assert.deepEqual(
    await gradeOf(p, response.id),
    { isCorrect: null, gradeState: null, score: null },
    '草稿行被写进了分 ⇒ 「草稿行三列皆空」那条不变量破了，而学生端会照 score 画出一个库里的草稿不该有的奖励',
  );
});

/**
 * 一道**混合填空题**：第 1、2 空本地自动判，第 3 空交给 AI。
 * 🔴 本地判分对它**有结论**（算的是**本地那几个空**，3 分）—— `grade()` 的 `mixedFill` 那一支。
 */
const MIXED_FILL = {
  id: 'q3', type: 'fill-blank', prompt: '填一填', inputMode: 'keyboard',
  points: { full: 10, half: 5 },
  data: {
    answers: [['甲'], ['乙'], []],
    fillBlankSettings: {
      a: { mode: 'inline', gradingMode: 'auto', maxScore: 2 },
      b: { mode: 'pool', gradingMode: 'auto', maxScore: 1 },
      c: { mode: 'text', gradingMode: 'ai', maxScore: 5 },
    },
  },
  children: [],
} as Prisma.InputJsonValue;
/** 学生那份作答：前两空填对，第三空是交给 AI 的那一个。 */
const MIXED_FILL_VALUE = { format: 'fill-multi/v1', texts: ['甲', '乙', '我的想法'] };

test('🔴 本地判分**有结论**的行不许被 AI 盖掉（混合填空题）', async (t) => {
  const db = await openTempDb();
  const fake = await startFakeCoze(
    '整体不错。<classnode-scores>{"scores":[{"student":"' + ZHANG + '","score":4,"reason":"思路清楚","advice":"再补一个分支。"}]}</classnode-scores>',
  );
  t.after(async () => { fake.close(); await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const p = db.prisma;
  const agent = await makeAgent(p, 'coze', fake.base);
  const { worksheet, classroom } = await seed(p, { analysisAgentId: agent.id, node: MIXED_FILL });
  await p.worksheetAnswer.updateMany({ data: { value: MIXED_FILL_VALUE } });
  const srv = await withServer(p);
  t.after(() => srv.close());

  // 🔴 前置：本地判分对这道题**确实有结论**。没有结论 ⇒ 这条用例什么都证不了（假绿），先修夹具。
  assert.deepEqual(
    grade(MIXED_FILL as unknown as QuestionNode, MIXED_FILL_VALUE, { full: 10, half: 5 }),
    { state: 'correct', score: 3 },
    '本地判分对这道题必须**有结论**（只算本地那两个空 = 2+1 分）—— 否则这条用例是空的',
  );

  // 模拟学生提交时本地判分落下的那一份
  await p.worksheetAnswer.updateMany({ data: { isCorrect: true, gradeState: 'correct', score: 3 } });

  const run = await generateAndRun(srv, worksheet.id, classroom.id);
  assert.equal(run.status, 200, await run.text());

  const response = await p.worksheetResponse.findFirstOrThrow({ where: { classroomId: classroom.id } });
  assert.deepEqual(
    await gradeOf(p, response.id),
    { isCorrect: true, gradeState: 'correct', score: 3 },
    'AI 的整题分（4/5 × 10 = 8）盖掉了本地判分 —— 而它算的只是本地那两个空。'
    + '「混合填空怎么算总分」是一个既有的未决问题，那类题**不在写回范围内**',
  );
});
