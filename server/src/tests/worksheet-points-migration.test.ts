import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ 2026-09-26（教师裁定）：「学习单设置里的默认给分就不要了，**已经在每小题中设置了**。」
 *
 * 🔴 这一条不能只删界面：`points` 为空的题**仍然**靠那两个学习单级的档判分
 *（`resolvePoints(node, pointsFromSettings(settings))` 是判分真正读的那条路）。
 * 所以先把它们**钉住**（按它当时继承到的值写成显式分值），再一路拆掉落回 ——
 * 分值的来源从**两个**变成一个。
 *
 * 纪律照 `worksheet-task-migration.ts` 那一套：
 *   1. 🔴 **不猜**：写的是**已经生效的那个值**（`pointsFromSettings(settings)`），
 *      不是新编的默认值 —— 一份把 3/2 改写成 1/0 的迁移会**静默改掉全卷的分**；
 *   2. 🔴 **幂等**：判据是「还有没有 `points` 为空的题」，它本身就幂等；
 *   3. 🔴 **逐题已填的一个字不动**（它早就脱离学习单级了）；
 *   4. 任务里的小题**同样要钉**（迁移之后题都在任务里）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateWorksheetPoints } from '../services/worksheet-points-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/prisma/build/index.js');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

type Node = {
  id: string; type: string; prompt: string; inputMode: string;
  data: Record<string, never>; children: Node[];
  points?: { full: number; half: number };
};
function q(id: string, points?: { full: number; half: number }): Node {
  return { id, type: 'short-answer', prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children: [], ...(points ? { points } : {}) };
}

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-points-migration-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [PRISMA_BIN, 'db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return prisma;
}

const content = (nodes: Node[]) => ({ schemaVersion: 1, nodes });

test('🔴 空着 `points` 的题被**钉成一个显式值**（取的是它当时继承到的那个）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', content: content([q('a'), q('b')]), settings: { rewardStep: 3, halfStep: 2 } },
  });

  const result = await migrateWorksheetPoints(prisma);

  assert.equal(result.migrated, 1);
  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  // 🔴 **3 / 2**，不是 1 / 0 —— 迁移写的是「它本来就吃到的那个值」。
  // 写成 DEFAULT_POINTS 会让这一份学习单全卷的分**静默变小**，而教师看不出任何异常。
  assert.deepEqual(after.nodes[0].points, { full: 3, half: 2 });
  assert.deepEqual(after.nodes[1].points, { full: 3, half: 2 });
});

test('🔴 逐题已填过的**一个字不动**（它早就脱离学习单级了）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', content: content([q('a', { full: 7, half: 1 }), q('b')]), settings: { rewardStep: 3, halfStep: 2 } },
  });

  await migrateWorksheetPoints(prisma);

  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.deepEqual(after.nodes[0].points, { full: 7, half: 1 }, '教师自己填的那个数不许被改写');
  assert.deepEqual(after.nodes[1].points, { full: 3, half: 2 }, '只有空着的那道被钉住');
});

test('🔴 任务里的小题**同样要钉**（迁移之后题都在任务里）', async (t) => {
  const prisma = await openTempDb(t);
  const task: Node = {
    id: 't_1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {},
    children: [q('a'), q('b', { full: 5, half: 0 })],
  };
  const ws = await prisma.worksheet.create({
    data: { title: '单', content: content([task]), settings: { rewardStep: 2, halfStep: 1 } },
  });

  await migrateWorksheetPoints(prisma);

  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.deepEqual(after.nodes[0].children[0].points, { full: 2, half: 1 });
  assert.deepEqual(after.nodes[0].children[1].points, { full: 5, half: 0 });
  // 🔴 **任务自己不该有 `points`**（它不能作答，裁定 ①a）—— 钉上去是噪音，
  // 因为判分/看板/导出/抽屉全都只看「可作答的题」，而库里看着像「任务有分」。
  assert.equal('points' in after.nodes[0], false);
});

test('🔴 任务身上已经有的 `points`（第一版迁移留下的）会被清掉', async (t) => {
  const prisma = await openTempDb(t);
  const task = { ...{
    id: 't_1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {}, children: [q('a', { full: 1, half: 0 })],
  }, points: { full: 2, half: 1 } } as unknown as Node;
  const ws = await prisma.worksheet.create({ data: { title: '单', content: content([task]), settings: {} } });

  const result = await migrateWorksheetPoints(prisma);

  assert.equal(result.migrated, 1, '清掉也算「动过」');
  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.equal('points' in after.nodes[0], false);
});

test('🔴 幂等：再跑一次什么都不做（判据是「还有没有空着的题」）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', content: content([q('a')]), settings: { rewardStep: 2, halfStep: 1 } },
  });

  assert.equal((await migrateWorksheetPoints(prisma)).migrated, 1);
  const first = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.equal((await migrateWorksheetPoints(prisma)).migrated, 0, '第二次没有可钉的题');
  const second = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.deepEqual(second, first, '逐字不变');
});

test('settings 里没有那两个键 ⇒ 用 `DEFAULT_POINTS`（1 / 0），不抛', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({ data: { title: '单', content: content([q('a')]), settings: {} } });

  await migrateWorksheetPoints(prisma);

  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.deepEqual(after.nodes[0].points, { full: 1, half: 0 });
});
