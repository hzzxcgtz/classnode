import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ 2026-09-26：把**整段的** `promptStyle` 迁成**分段**的 `promptRuns`。
 *
 * 🔴 为什么要有这一次迁移：第 2 步把题干的渲染并成了一处（`PromptText`），它只认
 * `promptRuns`。为了让那一步不把**已经设过格式的老题**当场弄掉格式，那里挂了一个
 * **临时桥**（`readPromptRunsFor` 回落 `promptStyle`）。本次迁完之后那个桥就删掉 ——
 * 格式的来源从**两个**变成一个，这才是这一改真正的收益。
 *
 * 纪律照 `worksheet-points-migration.ts` 那一套：
 *   1. 🔴 **不猜**：写进去的是这道题**当时已经生效**的那份样式（`promptStyle` 里那三个
 *      字段原样搬）。判据不是「新格式应该长什么样」；
 *   2. 🔴 **幂等**：判据是「还有没有 `promptStyle`」，它本身就幂等；
 *   3. 🔴 **没格式的题不造东西**：整段样式本来就是默认 ⇒ 只把那个键**删掉**，
 *      不写一条「全是默认」的分段（那是噪音，读的一侧本来就会补默认）；
 *   4. 任务里的小题**同样要迁**（题都在任务里）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateWorksheetPromptStyle } from '../services/worksheet-prompt-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

type Node = {
  id: string; type: string; prompt: string; inputMode: string;
  data: Record<string, unknown>; children: Node[];
};

function q(id: string, prompt: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'short-answer', prompt, inputMode: 'keyboard', data, children: [] };
}

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-prompt-migration-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  prepareTemporarySqliteFile(url);
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return prisma;
}

/**
 * ⚠️ `as never`：Prisma 的 `Json` 入参是 `InputJsonValue`，而 `data: Record<string, unknown>`
 * 里的 `unknown` 进不去（`points` 那个迁移测试用的是 `Record<string, never>` 才绕开，
 * 而这里要往 `data` 里放真的样式对象）。窄化走 `as never` 与写库那一侧同形。
 */
const content = (nodes: Node[]) => ({ schemaVersion: 1, nodes: nodes as unknown as never });
const readNodes = async (prisma: PrismaClient, id: string): Promise<Node[]> =>
  ((await prisma.worksheet.findUnique({ where: { id } }))!.content as unknown as { nodes: Node[] }).nodes;

test('🔴 设过格式的题 ⇒ 变成一条覆盖全段的 `promptRuns`，`promptStyle` 没了', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '光合作用的产物是？', { promptStyle: { bold: true, italic: false, color: '#b91c1c' } })]) },
  });

  const result = await migrateWorksheetPromptStyle(prisma);

  assert.equal(result.migrated, 1);
  const [node] = await readNodes(prisma, ws.id);
  assert.equal('promptStyle' in node.data, false, '旧键必须删掉 —— 留着一个没人读的键就是一句谎话');
  // 🔴 写的是**当时已经生效**的那三个字段（不是新编的默认值）。
  assert.deepEqual(node.data.promptRuns, [{
    // ⚠️ `end` 是**题干长度**（`光合作用的产物是？` 9 个字）—— 我第一版手写了个 8。
    start: 0, end: 9, bold: true, italic: false, underline: false, emphasis: false, color: '#b91c1c',
  }]);
});

test('🔴 整段样式本来就是默认 ⇒ **只删键**，不写一条「全是默认」的分段', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '光合作用', { promptStyle: { bold: false, italic: false, color: '#1e293b' } })]) },
  });

  const result = await migrateWorksheetPromptStyle(prisma);

  assert.equal(result.migrated, 1, '删掉那个键也算「动过」');
  const [node] = await readNodes(prisma, ws.id);
  assert.equal('promptStyle' in node.data, false);
  // 读的一侧（`readPromptRuns`）对「没有 promptRuns」的答案本来就是「一条默认分段」，
  // 所以写一条全是默认的分段是**纯噪音**。
  assert.equal('promptRuns' in node.data, false);
});

test('没设过格式的题**一个字不动**（连 `data` 的身份都不换）', async (t) => {
  const prisma = await openTempDb(t);
  const other = { imageUrl: '/uploads/chat/x.png' };
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '光合作用', other), q('b', '呼吸作用')]) },
  });

  assert.equal((await migrateWorksheetPromptStyle(prisma)).migrated, 0);
  const [first] = await readNodes(prisma, ws.id);
  assert.deepEqual(first.data, other, '别的 data 字段一个都不许碰');
});

test('任务里的小题**同样要迁**', async (t) => {
  const prisma = await openTempDb(t);
  const task: Node = {
    id: 't_1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {},
    children: [q('a', '光合作用', { promptStyle: { bold: true, italic: true, color: '#1e293b' } }), q('b', '呼吸作用')],
  };
  const ws = await prisma.worksheet.create({ data: { title: '单', settings: {}, content: content([task]) } });

  await migrateWorksheetPromptStyle(prisma);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.children[0].data.promptRuns !== undefined, true);
  assert.equal('promptStyle' in node.children[0].data, false);
  assert.deepEqual(node.children[1].data, {}, '没格式的那道小题一个字不动');
});

test('题干为空 ⇒ 只删键（空文本没有分段可写）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '', { promptStyle: { bold: true, italic: false, color: '#1e293b' } })]) },
  });

  await migrateWorksheetPromptStyle(prisma);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal('promptStyle' in node.data, false);
  assert.equal('promptRuns' in node.data, false, '题干是空的 ⇒ 位置一个都没有，写一条 0..0 的空段是坏的');
});

test('🔴 已经有 `promptRuns` 的题不动它（那是新编辑器写的，比迁移更权威）', async (t) => {
  const prisma = await openTempDb(t);
  const runs = [{ start: 0, end: 3, bold: true, italic: false, underline: true, emphasis: false, color: '#15803d' }];
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '光合作用', { promptRuns: runs })]) },
  });

  assert.equal((await migrateWorksheetPromptStyle(prisma)).migrated, 0);
  const [node] = await readNodes(prisma, ws.id);
  assert.deepEqual(node.data.promptRuns, runs, '逐字不变');
});

test('🔴 幂等：再跑一次什么都不做，内容逐字不变', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([q('a', '光合作用', { promptStyle: { bold: true, italic: false, color: '#1e293b' } })]) },
  });

  assert.equal((await migrateWorksheetPromptStyle(prisma)).migrated, 1);
  const first = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.equal((await migrateWorksheetPromptStyle(prisma)).migrated, 0, '第二次没有可迁的题');
  const second = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.deepEqual(second, first, '逐字不变');
});

test('坏数据不抛：`promptStyle` 不是对象 / `content` 没有 nodes', async (t) => {
  const prisma = await openTempDb(t);
  await prisma.worksheet.create({ data: { title: '单', settings: {}, content: content([q('a', '光合作用', { promptStyle: 'nonsense' })]) } });
  await prisma.worksheet.create({ data: { title: '空', settings: {}, content: { schemaVersion: 1 } as never } });

  const result = await migrateWorksheetPromptStyle(prisma);

  assert.equal(result.migrated, 0, '认不出的一律不碰 —— 抛出去会让服务起不来');
  assert.equal(await prisma.worksheet.count(), 2);
});
