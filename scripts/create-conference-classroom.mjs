/**
 * 建一个课堂（教师 2026-10-08：「关联『三国』这个班，不分组，然后关联刚才的学习单，
 * 探究空间和智能学伴随便选」）。
 *
 * 🔴 **不自己拼表**：起真实的 `classroomRoutes`，POST 到 `/create`。
 *   理由：创建课堂要同时落 6 张表（Classroom / ClassroomClass / ClassroomAgent /
 *   ClassroomWebapp / ClassroomWorksheet / ClassroomModule），**标准模式还要给班里每一名
 *   学生各建一行 `ClassroomStudent` 与 `Interaction`**。漏任何一张，课堂都会"看起来建成了
 *   但里面是空的"，而那是静默的。走真实路由就不会漏。
 *   ⚠️ 路由**自身不查教师会话**（鉴权是 `index.ts` 注册时分层加的），所以本地起一个不带
 *   鉴权的 app 就能调 —— 这与仓里 `agent-webapp-usage.test.ts` 的做法一致。
 *   ⚠️ 用 `server/dist/`（已编译的 JS），不用 `server/src/*.ts`：源码里那些 `./x.js`
 *   说明符要靠 tsx 解析，直接用编译产物最稳。
 *
 * 用法（仓库根，需先 `pnpm build:server`）：
 *   npx tsx scripts/create-conference-classroom.mjs          # 干跑：只打印将要关联的项
 *   npx tsx scripts/create-conference-classroom.mjs --apply  # 真的创建
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');
// ⚠️ `express` 只装在 server/node_modules，根目录解析不到 ⇒ 也从 server 取（它是 CJS）。
const express = requireFromServer('express');
const classroomRoutes = (await import(path.join(ROOT, 'server/dist/routes/classroom.js'))).default;

const APPLY = process.argv.includes('--apply');
const CLASS_NAME = '三国班';
const AGENT_NAME = '数学连环画大主编';     // 学伴型（教师：「随便选」）
const WEBAPP_NAME = '套圈游戏-怎样才公平'; // 探究空间（教师：「随便选」）
const WORKSHEET_ID = '60c5540d-f7b1-4fdf-84c4-9a08a514aa9c';
const TITLE = '校园数学节（全题型测试）';

const prisma = new PrismaClient();
try {
  const cls = await prisma.class.findFirst({ where: { name: CLASS_NAME }, include: { students: true } });
  if (!cls) throw new Error(`找不到班级「${CLASS_NAME}」`);
  const agent = await prisma.agent.findFirst({ where: { name: AGENT_NAME, enabled: true } });
  if (!agent) throw new Error(`找不到已启用的智能体「${AGENT_NAME}」`);
  const webapp = await prisma.webapp.findFirst({ where: { name: WEBAPP_NAME } });
  if (!webapp) throw new Error(`找不到探究网页「${WEBAPP_NAME}」`);
  const worksheet = await prisma.worksheet.findUnique({ where: { id: WORKSHEET_ID } });
  if (!worksheet) throw new Error('找不到那份学习单');

  console.log('将要创建：');
  console.log(`  标题   : ${TITLE}`);
  console.log(`  模式   : standard（不分组）`);
  console.log(`  班级   : ${cls.name}（${cls.students.length} 名学生 ⇒ 会各建一行参与者）`);
  console.log(`  智能体 : ${agent.name}`);
  console.log(`  探究空间: ${webapp.name}`);
  console.log(`  学习单 : ${worksheet.title}`);

  if (!APPLY) { console.log('\n（干跑：没有创建。加 --apply 才建。）'); process.exit(0); }

  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.set('io', { emit() {} });   // 路由可能顺手广播，这里给个空壳
  app.use('/api/classroom', classroomRoutes);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/classroom/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: TITLE,
      classIds: [cls.id],
      agentIds: [agent.id],
      webappIds: [webapp.id],
      worksheetIds: [worksheet.id],
      mode: 'standard',
    }),
  });
  const payload = await response.json();
  server.close();

  if (!response.ok) throw new Error(`创建失败（${response.status}）：${payload.error ?? JSON.stringify(payload)}`);

  const created = payload;
  const [participants, interactions, links] = await Promise.all([
    prisma.classroomStudent.count({ where: { classroomId: created.id } }),
    prisma.interaction.count({ where: { classroomId: created.id } }),
    Promise.all([
      prisma.classroomClass.count({ where: { classroomId: created.id } }),
      prisma.classroomAgent.count({ where: { classroomId: created.id } }),
      prisma.classroomWorksheet.count({ where: { classroomId: created.id } }),
      prisma.classroomWebapp.count({ where: { classroomId: created.id } }).catch(() => -1),
    ]),
  ]);
  console.log('\n✅ 已创建');
  console.log('  id      :', created.id);
  console.log('  课堂码  :', created.code);
  console.log('  参与者  :', participants, '人 ｜ Interaction:', interactions, '行');
  console.log('  关联    : 班级', links[0], '· 智能体', links[1], '· 学习单', links[2], '· 网页', links[3]);
} finally {
  await prisma.$disconnect();
}
