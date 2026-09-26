/**
 * ★ 2026-09-26：把填空题的**空**从「题干外面一排输入框」迁成「题干文字中间的空」。
 *
 * 教师裁定：「填空是在**题目文字中间**输入，一道题可以包含多个填空区域」，
 * 而老填空题的题干里**一个空都没有**（空是 `data.blanks` 那个数量，答题框画在题干外面）
 * ⇒ 追加到题干末尾，让库里只留**一种**形状。
 *
 * 纪律照 `worksheet-points-migration.ts` 那一套（备份 + 完成标记 + 不猜 + 没东西可迁就不动）：
 *   1. 🔴 **不猜**：空的数量**照原样推出来**（多空 = `data.blanks.length`、单空 = 1），
 *      不是新编的；
 *   2. 🔴 **别的东西一个字不动**（`answers` / 别的 `data` 字段 / 别的题型）；
 *   3. 🔴 顺带把**手写作答**改回键盘（同一批裁定 ③：题干内输入与手写天然冲突）；
 *   4. ⚠️ **这一条迁移与前两条不同**：它**必须只跑一次**（由 `index.ts` 的完成标记把门），
 *      因为它的幂等判据**认不出**「一道刚建好、题干写了但还没插空的新填空题」与
 *      「一道老填空题」—— 两者都是「没有空」。判据不可靠时，唯一安全的就是只跑一次。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateFillBlankToInline } from '../services/worksheet-fill-blank-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

type Node = {
  id: string; type: string; prompt: string; inputMode?: string;
  data: Record<string, unknown>; children: Node[];
};

function fill(id: string, prompt: string, data: Record<string, unknown>, inputMode?: string): Node {
  return { id, type: 'fill-blank', prompt, data, children: [], ...(inputMode ? { inputMode } : {}) };
}

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fillblank-migration-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return prisma;
}

const content = (nodes: Node[]) => ({ schemaVersion: 1, nodes: nodes as unknown as never });
const readNodes = async (prisma: PrismaClient, id: string): Promise<Node[]> =>
  ((await prisma.worksheet.findUnique({ where: { id } }))!.content as unknown as { nodes: Node[] }).nodes;
/** 空（带 `blank: true` 的分段）在题干里出现的位置，按先后。 */
const blanksOf = (node: Node): { start: number; end: number }[] =>
  (Array.isArray(node.data.promptRuns) ? node.data.promptRuns as Record<string, unknown>[] : [])
    .filter(run => run.blank === true)
    .map(run => ({ start: run.start as number, end: run.end as number }));

test('🔴 单空的老填空题（没有 `data.blanks`）⇒ 题干末尾追加**一个**空，`answers` 一个字不动', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([fill('a', '植物光合作用释放的气体是？', { answers: ['氧气'] })]) },
  });

  const result = await migrateFillBlankToInline(prisma);

  assert.equal(result.migrated, 1);
  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.prompt.startsWith('植物光合作用释放的气体是？'), true, '原题干一个字不动');
  assert.ok(node.prompt.length > '植物光合作用释放的气体是？'.length, '题干变长了（多了那段占位）');
  const blanks = blanksOf(node);
  assert.equal(blanks.length, 1, '单空 ⇒ 追加一个空');
  // ⚠️ 下划线**不是空白**，`.trim()` 去不掉它 —— 直接比那段字面量。
  assert.equal(node.prompt.slice(blanks[0].start, blanks[0].end), '________', '空那一段是下划线占位');
  assert.deepEqual(node.data.answers, ['氧气'], '答案按位置配，一个字不许动');
});

test('🔴 多空（`data.blanks: [a,b,c]`）⇒ 追加**三个**空，且 `data.blanks` 删掉', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: {
      title: '多', settings: {},
      content: content([fill('a', '植物需要____和____才能生长？', { blanks: ['阳光', '水分', '空气'], answers: [['阳光'], ['水分'], ['空气']] })]),
    },
  });

  await migrateFillBlankToInline(prisma);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal(blanksOf(node).length, 3, '空的个数照 `blanks` 原样推出来');
  assert.equal('blanks' in node.data, false, '旧键必须删掉 —— 留着它库里就有两种形状');
  assert.deepEqual(node.data.answers, [['阳光'], ['水分'], ['空气']], '答案一个字不许动');
});

test('🔴 已经有空的题（新形状）一个字不动', async (t) => {
  const prisma = await openTempDb(t);
  const runs = [{ start: 0, end: 6, bold: false, italic: false, underline: false, emphasis: false, color: '#1e293b', blank: false },
    { start: 6, end: 14, bold: false, italic: false, underline: false, emphasis: false, color: '#1e293b', blank: true }];
  const ws = await prisma.worksheet.create({
    data: { title: '新', settings: {}, content: content([fill('a', '植物需要________才能生长', { answers: ['阳光'], promptRuns: runs })]) },
  });

  assert.equal((await migrateFillBlankToInline(prisma)).migrated, 0);
  const [node] = await readNodes(prisma, ws.id);
  assert.deepEqual(node.data.promptRuns, runs, '逐字不变');
});

test('别的题型一个字不动（哪怕它的 data 里有个叫 blanks 的键）', async (t) => {
  const prisma = await openTempDb(t);
  const other = { id: 'b', type: 'single-choice', prompt: '光合作用的产物是？', inputMode: 'keyboard', data: { blanks: ['x'] }, children: [] };
  const ws = await prisma.worksheet.create({ data: { title: '单', settings: {}, content: content([other as unknown as Node]) } });

  assert.equal((await migrateFillBlankToInline(prisma)).migrated, 0);
  const [node] = await readNodes(prisma, ws.id);
  assert.deepEqual(node.data, { blanks: ['x'] }, '不是填空题 ⇒ 一个字都不动');
});

test('🔴 手写作答的填空题改回键盘（裁定 ③）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '手', settings: {}, content: content([fill('a', '植物需要____才能生长', { answers: ['阳光'] }, 'handwriting')]) },
  });

  await migrateFillBlankToInline(prisma);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.inputMode, 'keyboard', '题干内输入与手写天然冲突');
  assert.equal(blanksOf(node).length, 1);
});

test('🔴 幂等：题干里已经有空、手写也改完了 ⇒ 再跑什么都不做，内容逐字不变', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([fill('a', '植物需要____才能生长', { answers: ['阳光'] })]) },
  });

  assert.equal((await migrateFillBlankToInline(prisma)).migrated, 1);
  const first = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.equal((await migrateFillBlankToInline(prisma)).migrated, 0, '第二次没有可迁的题');
  const second = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.deepEqual(second, first, '逐字不变');
});

test('任务里的小题同样要迁；坏数据不抛', async (t) => {
  const prisma = await openTempDb(t);
  const task: Node = {
    id: 't_1', type: 'task', prompt: '任务一', data: {},
    children: [fill('a', '植物需要____才能生长', { answers: ['阳光'] })],
  };
  await prisma.worksheet.create({ data: { title: '单', settings: {}, content: content([task]) } });
  await prisma.worksheet.create({ data: { title: '坏', settings: {}, content: { schemaVersion: 1 } as never } });

  const result = await migrateFillBlankToInline(prisma);

  assert.equal(result.migrated, 1, '只动了那一份有填空题的（坏的那份跳过、不抛）');
  assert.equal(await prisma.worksheet.count(), 2);
});
