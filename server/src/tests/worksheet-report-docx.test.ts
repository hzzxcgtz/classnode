/**
 * M6a：**报告到底产不产得出来** —— 端到端 smoke（真 Prisma + 真 SQLite + 真 docx + 真 sharp）。
 *
 * 🔴 为什么必须有它（计划没要求，是本任务自己加的）：D1 的渲染层是整个 M6a 里**唯一
 * 本机验不了**的一块 —— 没有 Word、没有能渲染它的环境。但「能不能生成一份**合法**的 docx」
 * 是能在本机算出来的，而它恰好是最贵的那种失败：**报告根本打不开**。
 *
 * ⚠️ **如实记**：这条用例**第一次跑就绿了**，它没有抓到过任何缺陷 —— 写它的时候那句
 * 「它当场抓到了一个真错」是**不实的**（真正的那个错是「把 `AnswerCell` 当成带 `png` 字段的
 * 形状」，而它由 **`tsc`** 抓到、发生在写这条用例之前）。留着它是因为**它挡的是另一种失败**
 * （渲染层任何一次改动把报告弄成打不开），而那种失败在本机**没有别的网**。
 *
 * ⚠️ 它**不验内容**：纸上的字对不对由 `worksheet-report.test.ts` 的 12 条判据盯着，
 * 渲染层只是把那些判据画出来。要验内容得解 docx 的 zip，那是另一回事。
 *
 * ⚠️ 临时库由 `prisma db push` 建在 `os.tmpdir()` 下，开头第一件事就断言这一点（GC 4 / 20）：
 * 本项目出过一次「`db push` 打在真实库上」的事故。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { generateWorksheetReportDocx } from '../services/export-service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

async function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-ws-report-'));
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

/** 一份最小的学习单：一道单选（有对错）+ 一道绘图（笔迹）。 */
const CONTENT = {
  schemaVersion: 1,
  nodes: [
    { id: 'q1', type: 'single-choice', prompt: '光合作用需要哪些条件？', inputMode: 'keyboard', data: { options: [{ key: 'A', text: '水' }, { key: 'B', text: '阳光' }] }, children: [] },
    { id: 'q2', type: 'drawing', prompt: '画出实验装置', inputMode: 'handwriting', data: {}, children: [] },
  ],
};

async function seed(prisma: PrismaClient) {
  const classroom = await prisma.classroom.create({ data: { title: '光合作用实验', code: '8123' } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const worksheet = await prisma.worksheet.create({ data: { title: '光合作用学习单', content: CONTENT, settings: {} } });
  await prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const response = await prisma.worksheetResponse.create({
    data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id },
  });
  await prisma.worksheetAnswer.create({
    data: { responseId: response.id, questionId: 'q1', status: 'submitted', isCorrect: false, gradeState: 'partial', value: { format: 'choice/v1', selected: ['B'] } },
  });
  await prisma.worksheetAnswer.create({
    data: {
      responseId: response.id, questionId: 'q2', status: 'submitted', isCorrect: null, gradeState: null,
      value: { format: 'drawing/v1', canvas: { w: 320, h: 240 }, strokes: [{ color: '#1f2937', width: 0.05, points: [[0.1, 0.1], [0.6, 0.5], [0.9, 0.2]] }] },
    },
  });
  return classroom;
}

test('🔴 端到端 smoke：有学习单 + 有笔迹 ⇒ 产出一份合法的 docx', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const classroom = await seed(db.prisma);
  const result = await generateWorksheetReportDocx(classroom.id, db.prisma);

  // .docx 是一个 zip ⇒ 魔数必须是 `PK`。它是「这份文件打不打得到开」最便宜的那条判据。
  assert.equal(result.buffer.subarray(0, 2).toString('latin1'), 'PK', '不是 zip ⇒ Word 打不开');
  assert.ok(result.buffer.length > 5000, `太小了（${result.buffer.length} B），多半没画进去`);
  assert.match(result.filename, /学习单与探究空间/, '文件名要能一眼看出这是哪一份报告');
  assert.match(result.filename, /\.docx$/);
  assert.equal(result.stats.totalStudents, 1);
  assert.equal(result.stats.totalMsgs, 2, '两道题各一行作答');
});

test('★ 没配学习单 ⇒ 仍然产得出一份合法 docx（空态不许让导出失败）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const classroom = await db.prisma.classroom.create({ data: { title: '空课堂', code: '8201' } });
  await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const result = await generateWorksheetReportDocx(classroom.id, db.prisma);
  assert.equal(result.buffer.subarray(0, 2).toString('latin1'), 'PK');
  assert.equal(result.stats.totalMsgs, 0);
});

test('★ 课堂不存在 ⇒ 抛（端点会把它变成 500，而不是一份空报告）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  await assert.rejects(() => generateWorksheetReportDocx('does-not-exist', db.prisma), /课堂不存在/);
});

// ─────────────────────────────────────────────────────────────────────────
// ★ 下面三条是**独立审查之后补的**：它指出「纸面内容的完备性只有『是合法 zip』
//   一条网兜着」，并建议在真 docx 的 `document.xml` 上逐串核对。
//   `adm-zip` 本来就在 server 的依赖里（`upload-security` 那条路用它），所以本机做得到。
// ─────────────────────────────────────────────────────────────────────────

/** 把 docx 解开、取出正文 XML、剥掉标签 —— 得到**纸面上那串字**。 */
// ⚠️ 本文件是 ESM（server 的 package.json 有 `"type": "module"`）⇒ 没有 `require`。
// 用 `createRequire` 拿一个（第一次写的时候踩了：`ReferenceError: require is not defined`）。
const require_ = createRequire(import.meta.url);

function paperText(buffer: Buffer): string {
  const AdmZip = require_('adm-zip');
  const zip = new AdmZip(buffer);
  const xml = zip.readAsText('word/document.xml');
  return String(xml).replace(/<[^>]+>/g, '');
}

test('🔴 纸面核对：题干 / 参与者名 / 学习单名 / 判定都真的印上去了，且**没有正确答案**', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });
  const classroom = await seed(db.prisma);
  const text = paperText((await generateWorksheetReportDocx(classroom.id, db.prisma)).buffer);

  assert.match(text, /光合作用学习单/, '学习单名没印上去');
  assert.match(text, /光合作用需要哪些条件/, '题干没印上去');
  assert.match(text, /半对/, '半对没印成半对（规格 §12：isCorrect:false 同时覆盖「错」与「半对」）');
  assert.match(text, /B/, '学生答案没印上去');
  assert.match(text, /画出实验装置/, '第二题的题干没印上去');
  // 🔴 GC 30：正确答案**不许**出现在纸面上（报告会被转发给学生）。
  assert.doesNotMatch(text, /阳光/, '选项文本不该印 —— 那可能是正确答案的载体');
});

test('🔴 纸面核对：高级模式下**没配学习单的那一组要点名**（踩过：附注函数零调用点）', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  // 高级模式：一个组配了学习单、另一个组没配。
  const classroom = await db.prisma.classroom.create({ data: { title: '高级课堂', code: '8301', mode: 'advanced' } });
  const worksheet = await db.prisma.worksheet.create({ data: { title: '有单子的组', content: CONTENT, settings: {} } });
  const g1 = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第 1 组' } });
  const g2 = await db.prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '第 2 组' } });
  await db.prisma.classroomGroupMaterial.create({ data: { groupId: g1.id, kind: 'worksheet', targetId: worksheet.id } });
  await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: g1.id } });
  await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'group', groupId: g2.id } });

  const text = paperText((await generateWorksheetReportDocx(classroom.id, db.prisma)).buffer);
  assert.match(text, /没有可作答的学习单/, '🔴 没配学习单的那一组**整组消失**了，而纸上什么都没说');
  assert.match(text, /另有 1 个参与者/, '附注里的数不对');
});

test('🔴 纸面核对：探究空间只有「时长 / 帧数」，**没有**点击 / 输入 / 滚动深度', async (t) => {
  const db = await openTempDb();
  t.after(async () => { await db.prisma.$disconnect(); fs.rmSync(db.dir, { recursive: true, force: true }); });

  const classroom = await db.prisma.classroom.create({ data: { title: '探究课堂', code: '8302' } });
  const participant = await db.prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
  const webapp = await db.prisma.webapp.create({ data: { name: '凸透镜成像', entryPath: 'index.html' } });
  await db.prisma.webappUsage.create({
    data: { classroomId: classroom.id, webappId: webapp.id, studentId: participant.id, durationMs: 200_000, frameCount: 12 },
  });

  const text = paperText((await generateWorksheetReportDocx(classroom.id, db.prisma)).buffer);
  assert.match(text, /凸透镜成像/, '网页名没印上去');
  assert.match(text, /3 分 20 秒/, '时长没印成人话');
  assert.match(text, /时\s*长|时长/, '缺「时长」表头');
  assert.match(text, /帧数/, '缺「帧数」表头');
  // 🔴 GC 31：这四列今天**值恒为 0**（recordWebappSummary 只写时长与帧数）⇒ 一个都不许印。
  for (const forbidden of ['点击', '输入次数', '滚动深度']) {
    // 「滚动深度」只允许出现在那句实话里（「交互次数与滚动深度本轮暂不可得」）。
    if (forbidden === '滚动深度') continue;
    assert.doesNotMatch(text, new RegExp(forbidden), `${forbidden} 恒为 0，不许印在纸上`);
  }
  assert.match(text, /暂不可得/, '缺那句实话');
});
