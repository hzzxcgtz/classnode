/**
 * 把 AI 分析**真正会发给模型的那张联系表**渲出来，落成 PNG 供人核对。
 *
 * 🔴 为什么需要它：`drawing.image` 那张快照是**这个链路唯一的入口**
 *    （`analysis-payload.ts` 的 `readDrawingRaster`）—— 快照不在 / 路径不对 / 形状不对，
 *    联系表里那一格就是**空的**，而生成载荷那一步**不会报错**（它只处理结构化数据）。
 *    真正的失败只会出现在「模型说这题大家都没画」这种**看起来像教学结论**的话里。
 *    ⇒ 所以在发给模型之前，先把那张图渲出来**看一眼**。
 *
 * ⚠️ 它**不发任何 AI 请求**：
 *      · `POST /analysis/:questionId` 只算载荷（`aggregate`），不碰模型；
 *      · `GET  /analysis/:questionId/sheet/:index` 只按已存的载荷渲图。
 *    要真发请求的是 `POST …/run` —— 那个**不在这里**（它会把全班作业发给第三方平台）。
 *
 * 用法（仓库根，需先 `pnpm build:server`）：
 *   npx tsx scripts/verify-analysis-sheets.mjs --classroom <码或id> --worksheet <id> --out /tmp/sheets
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');
// ⚠️ `express` 只装在 server/node_modules，从仓根解析不到 ⇒ 也从 server 取（与建课堂那个脚本同理）。
const express = requireFromServer('express');
const worksheetRoutes = (await import(path.join(ROOT, 'server/dist/routes/worksheets.js'))).default;

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CLASSROOM_ARG = argOf('classroom');
const WORKSHEET_ID = argOf('worksheet');
const OUT = argOf('out', path.join(ROOT, '.dev', 'analysis-sheets'));

const prisma = new PrismaClient();
let server;
try {
  const classroom = await prisma.classroom.findFirst({
    where: { OR: [{ id: CLASSROOM_ARG }, { code: CLASSROOM_ARG }, { title: CLASSROOM_ARG }] },
    orderBy: { createdAt: 'desc' },
  });
  if (!classroom) throw new Error(`找不到课堂 ${CLASSROOM_ARG}`);
  const worksheet = await prisma.worksheet.findUnique({ where: { id: WORKSHEET_ID } });
  if (!worksheet) throw new Error(`找不到学习单 ${WORKSHEET_ID}`);

  // 有作答的题才有分析可言 —— 按库里实际存在的 questionId 走，不猜。
  const rows = await prisma.$queryRaw`
    SELECT a.questionId AS questionId, COUNT(*) AS n
    FROM WorksheetAnswer a JOIN WorksheetResponse r ON a.responseId = r.id
    WHERE r.classroomId = ${classroom.id} AND r.worksheetId = ${WORKSHEET_ID}
    GROUP BY a.questionId ORDER BY n DESC`;
  if (rows.length === 0) throw new Error('这个课堂在这份学习单上一条作答都没有 —— 先灌数据');

  // ⚠️ 路由自身不查教师会话（鉴权是 `index.ts` 注册时分层的）⇒ 本地起一个不带鉴权的 app 就能调。
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { emit() {} });
  app.use('/api/worksheets', worksheetRoutes);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/worksheets/${WORKSHEET_ID}`;

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`课堂 ${classroom.title}（${classroom.code}）· 学习单 ${worksheet.title}`);
  console.log(`共 ${rows.length} 道题有作答 · 联系表落到 ${OUT}\n`);

  let failed = 0;
  for (const row of rows) {
    const questionId = String(row.questionId);
    const n = Number(row.n);
    const label = questionId.replace(/[^\w.-]+/g, '_');
    const made = await fetch(`${base}/analysis/${questionId}?classroomId=${classroom.id}`, { method: 'POST' });
    const payload = await made.json().catch(() => ({}));
    if (!made.ok) {
      failed += 1;
      console.log(`✗ ${questionId}  作答 ${n}  —— 生成载荷失败（${made.status}）：${payload.error ?? ''}`);
      continue;
    }
    const kind = payload.payloadKind ?? payload.kind ?? '(?)';
    const sheets = Number(payload.sheetCount ?? (Array.isArray(payload.sheets) ? payload.sheets.length : 0));
    const written = [];
    for (let index = 0; index < Math.max(sheets, 1); index += 1) {
      const sheet = await fetch(`${base}/analysis/${questionId}/sheet/${index}?classroomId=${classroom.id}`);
      if (sheet.status === 404) break;
      if (!sheet.ok) {
        failed += 1;
        const body = await sheet.json().catch(() => ({}));
        console.log(`✗ ${questionId} 第 ${index} 张渲不出来（${sheet.status}）：${body.error ?? ''}`);
        break;
      }
      const file = path.join(OUT, `${label}-${index}.png`);
      fs.writeFileSync(file, Buffer.from(await sheet.arrayBuffer()));
      written.push(file);
    }
    console.log(`● ${questionId}  作答 ${n}  · 载荷 ${kind} · 联系表 ${sheets} 张 → ${written.length} 张已落盘`);
  }
  console.log(failed === 0 ? '\n✅ 全部渲染成功。' : `\n❌ 有 ${failed} 处失败（见上）。`);
} finally {
  if (server) server.close();
  await prisma.$disconnect();
}
