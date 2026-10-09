/**
 * 给一份学习单指定**分析型智能体**（`settings.analysisAgentId`）。
 *
 * 🔴 为什么需要一个脚本：不指定它，**AI 分析按钮是禁用的**（`analysisAgentId` 默认 `null`，
 *    而且这是刻意的 —— 「默认指定一个等于默认把全班作业发出去」，见 `normalizeSettings` 的注释）。
 *    于是「灌了数据却点不动分析」这件事看起来像数据出了问题，其实只是漏了这一步。
 *
 * 🔴 **整份 `settings` 写全**，而且是**调服务端自己的 `normalizeSettings`** 写 ——
 *    不在这里手抄一份键表。手抄的下场：`PUT /api/worksheets/:id` 是整份替换，
 *    少认一个键那个键就被**静默丢掉**（教师配好的奖励档、透度、背景全没了，
 *    而界面上没有任何提示）。调它本人 ⇒ 键表永远跟着服务端走。
 *    ⚠️ 用 `server/dist/`（编译产物）：`src/routes/worksheets.ts` 里 import 了 express 等
 *       只在 `server/node_modules` 里的包，从仓根直接 import 源码解析不到。
 *
 * 用法（仓库根，需先 `pnpm build:server`）：
 *   npx tsx scripts/set-worksheet-analysis-agent.mjs --worksheet <id> --agent <id>
 *   npx tsx scripts/set-worksheet-analysis-agent.mjs --worksheet <id> --agent <id> --apply
 *   # 不给 --agent 时打印「库里有哪些分析型智能体」供挑选
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');
const { normalizeSettings } = await import(path.join(ROOT, 'server/dist/routes/worksheets.js'));

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes('--apply');
const WORKSHEET_ID = argOf('worksheet');
const AGENT_ID = argOf('agent');

const prisma = new PrismaClient();
try {
  /** 只列 `purpose === 'analysis'` 的 —— 别的档**服务端会拒**（见下面那道双向闸）。 */
  const analysisAgents = await prisma.agent.findMany({
    where: { purpose: 'analysis' },
    select: { id: true, name: true, enabled: true, platform: true },
    orderBy: { name: 'asc' },
  });
  if (analysisAgents.length === 0) {
    console.log('库里一个「分析型」智能体都没有 —— 先去 /teacher/agents/ 建一个，用途选「分析」。');
    process.exit(0);
  }
  if (!WORKSHEET_ID) {
    console.log('可用的分析型智能体（用 --worksheet <id> --agent <id> 指定）：');
    for (const agent of analysisAgents) console.log(`  ${agent.enabled ? '●' : '○'} ${agent.name}  ${agent.id}  [${agent.platform}]`);
    process.exit(0);
  }

  const worksheet = await prisma.worksheet.findUnique({ where: { id: WORKSHEET_ID }, select: { title: true, settings: true } });
  if (!worksheet) throw new Error(`找不到学习单 ${WORKSHEET_ID}`);

  const current = normalizeSettings(worksheet.settings ?? {});
  const before = current.analysisAgentId;

  if (!AGENT_ID) {
    console.log(`学习单「${worksheet.title}」当前的分析智能体：${before ?? '(未指定 ⇒ 分析按钮禁用)'}`);
    console.log('可用的分析型智能体：');
    for (const agent of analysisAgents) console.log(`  ${agent.enabled ? '●' : '○'} ${agent.name}  ${agent.id}`);
    process.exit(0);
  }

  const agent = analysisAgents.find((item) => item.id === AGENT_ID);
  if (!agent) {
    // 🔴 这一道不是多余的：分析路由里有一道**双向闸**（`agent.purpose !== 'analysis'` 就 400），
    //    拿一个学伴型智能体来配，数据全灌好之后才会在点分析的瞬间被拒。
    throw new Error(`智能体 ${AGENT_ID} 不存在，或它的用途不是「分析」（学伴型不能接收全班作业，服务端会拒）`);
  }
  if (!agent.enabled) console.log(`⚠️ 「${agent.name}」当前是**停用**状态 —— 分析时会报「不存在或已停用」。`);

  console.log(`学习单：${worksheet.title}`);
  console.log(`分析智能体：${before ?? '(未指定)'} → ${agent.name}（${agent.id}）`);

  if (!APPLY) {
    console.log('\n（干跑：没有写库。加 --apply 才写。）');
    process.exit(0);
  }

  const next = normalizeSettings({ ...(current), analysisAgentId: agent.id });
  await prisma.worksheet.update({ where: { id: WORKSHEET_ID }, data: { settings: next } });

  const back = normalizeSettings((await prisma.worksheet.findUnique({ where: { id: WORKSHEET_ID }, select: { settings: true } })).settings ?? {});
  const keys = Object.keys(back);
  console.log(`\n✅ 已写入。settings 共 ${keys.length} 个键：${keys.join(' ')}`);
  console.log(`   读回来是：${back.analysisAgentId === agent.id ? '✅ ' + agent.name : '❌ ' + String(back.analysisAgentId)}`);
} finally {
  await prisma.$disconnect();
}
