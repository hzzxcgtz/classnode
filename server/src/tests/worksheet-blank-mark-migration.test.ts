import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ 2026-09-29：把题干里**老形态的空**（一串下划线）统一成 `{填空域}`。
 *
 * 🔴 它修的是一个**实测出来的静默丢数据 bug**：`migrateFillBlankToInline`（2026-09-26）
 * 追加到题干末尾的是 `'________'`（8 个下划线），而客户端「按文本重新识别空」的那条路
 *（`recognizeBlanks`）**只认 `{填空域}`** ⇒ 教师在题干里多打一个字，那个空就被抹掉了
 *（2026-09-29 探针实测：读库后空数 1、编辑题干后空数 0）。`data.answers` 还在，
 * 但学生那边已经不画输入框了 —— 全程不报错。
 *
 * 教师这次的裁定：「填空的小括号和下划线要替换成 `{填空域}`」（粘贴导入那一批）——
 * 这一条是它的**存量那一半**：不改库里的老题，那个 bug 还在，而且新导入的空与老空
 * 会在同一句题干里并存（两种形态）。
 *
 * 纪律照 `worksheet-points-migration.ts` 那一套（备份 + 幂等 + 不猜）：
 *   1. 🔴 **只改「带 `blank` 标识、且那一段文字正好是下划线」的分段** ——
 *      题干里当普通文字用的下划线（`file_name`）不带标识，碰不到；
 *   2. 🔴 **`data.answers` 一个字不动**（空的**数量与先后都没变**，答案下标照旧）；
 *   3. 🔴 **空的身份照原样搬**（换一个就等于把答案作废）；
 *   4. 🔴 **幂等**：改完那一段是 `{填空域}`，不再匹配判据 ⇒ 每次启动都能安全地跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateBlankMarkText } from '../services/worksheet-blank-mark-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/prisma/build/index.js');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

type Node = {
  id: string; type: string; prompt: string;
  data: Record<string, unknown>; children: Node[];
};

/** 迁移写出来的那种形状：题干末尾一串 `________`，分段带 `blank` 标识。 */
function legacy(id: string, prompt: string, blanks: number, data: Record<string, unknown> = {}): Node {
  const at = prompt.length;
  return {
    id, type: 'fill-blank', prompt: prompt + '________'.repeat(blanks),
    data: {
      ...data,
      answers: Array.from({ length: blanks }, (_, index) => [`答案${index + 1}`]),
      promptRuns: Array.from({ length: blanks }, (_, index) => ({
        start: at + index * 8, end: at + (index + 1) * 8,
        bold: false, italic: false, underline: false, emphasis: false,
        color: '#1e293b', blank: `blank_${index + 1}`,
      })),
    },
    children: [],
  };
}

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-blankmark-migration-'));
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

const content = (nodes: Node[]) => ({ schemaVersion: 1, nodes: nodes as unknown as never });
const readNodes = async (prisma: PrismaClient, id: string): Promise<Node[]> =>
  ((await prisma.worksheet.findUnique({ where: { id } }))!.content as unknown as { nodes: Node[] }).nodes;
const blanksOf = (node: Node) =>
  (Array.isArray(node.data.promptRuns) ? node.data.promptRuns as Record<string, unknown>[] : [])
    .filter(run => typeof run.blank === 'string' && run.blank !== '')
    .map(run => ({ start: run.start as number, end: run.end as number, blank: run.blank as string }));

test('🔴 老占位串（8 个下划线）⇒ 换成 `{填空域}`，坐标与身份都跟着', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '单', settings: {}, content: content([legacy('a', '植物需要', 1)]) },
  });

  const result = await migrateBlankMarkText(prisma);
  assert.equal(result.migrated, 1);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.prompt, '植物需要{填空域}');
  assert.deepEqual(blanksOf(node), [{ start: 4, end: 9, blank: 'blank_1' }]);
  assert.deepEqual(node.data.answers, [['答案1']], '答案一个字都不许动');
});

test('🔴 多个空连着排（迁移的输出就是那样）⇒ 各自换成标记，坐标逐段平移', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '多', settings: {}, content: content([legacy('a', '植物需要', 3)]) },
  });

  await migrateBlankMarkText(prisma);

  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.prompt, '植物需要{填空域}{填空域}{填空域}');
  assert.deepEqual(blanksOf(node), [
    { start: 4, end: 9, blank: 'blank_1' },
    { start: 9, end: 14, blank: 'blank_2' },
    { start: 14, end: 19, blank: 'blank_3' },
  ]);
  assert.deepEqual(node.data.answers, [['答案1'], ['答案2'], ['答案3']]);
});

test('🔴 幂等：再跑一次一个字都不动（所以它每次启动都能安全地跑）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({
    data: { title: '幂等', settings: {}, content: content([legacy('a', '植物需要', 2)]) },
  });

  assert.equal((await migrateBlankMarkText(prisma)).migrated, 1);
  const after = await readNodes(prisma, ws.id);
  assert.equal((await migrateBlankMarkText(prisma)).migrated, 0, '第二次没东西可迁 ⇒ 不算迁过（也不白写一次库）');
  assert.deepEqual(await readNodes(prisma, ws.id), after, '题库一个字都不许变');
});

test('🔴 反向：题干里**当普通文字用的下划线**不许被碰（它们不带 `blank` 标识）', async (t) => {
  const prisma = await openTempDb(t);
  // 🔴 这一条的夹具**必须让那一段文字正好是下划线、而 `blank` 是空串** ——
  // 只有这样两条判据才分得开。第一版把 `promptRuns` 写成空数组，于是**哪一条判据都不会
  // 被走到**（`usable` 本来就是空的），用例是**假绿**：变异检验把「必须带标识」那半条
  // 判据去掉之后它照样绿。
  // 今天的真实形态是 `file_name` / `变量 __` 这种正文（一整段普通分段），
  // 所以精确到「区间 = 纯下划线 + 无标识」才是能钉住这条纪律的最小夹具。
  const plain: Node = {
    id: 'a', type: 'fill-blank', prompt: '变量 __ 在这里是正文',
    data: {
      answers: [[]],
      promptRuns: [{ start: 3, end: 5, bold: false, italic: false, underline: false, emphasis: false, color: '#1e293b', blank: '' }],
    },
    children: [],
  };
  const ws = await prisma.worksheet.create({
    data: { title: '正文', settings: {}, content: content([plain]) },
  });

  assert.equal((await migrateBlankMarkText(prisma)).migrated, 0);
  const [node] = await readNodes(prisma, ws.id);
  assert.equal(node.prompt, '变量 __ 在这里是正文', '正文一个字都不动');
});

test('🔴 手打错的标记（`{填空区域}`，6 个字）也要统一成规范写法 —— 真库里撞到的那一条', async (t) => {
  // 🔴 这是**开发库里真实存在**的一道题：分段带着 `blank` 标识（2-8 / 9-15，各 6 个字），
  // 而文字是 `{填空区域}`（6 个字，不是 5 个）。`git log -S'{填空区域}'` 查过：
  // 这个串**从来没在源码里出现过** —— 是教师照着帮助文案手打的。
  // 它同样会在下次编辑题干时被 `recognizeBlanks` 抹掉（实测：读库后空数 2、编辑后 0）。
  // ⇒ 判据从「文字是一串下划线」放宽成「**带着标识、但文字不是那个标记**」。
  const prisma = await openTempDb(t);
  const prompt = '哈哈{填空区域}，{填空区域}';
  const node: Node = {
    id: 'a', type: 'choice-blank', prompt,
    data: {
      answers: [[], []],
      promptRuns: [
        { start: 2, end: 8, blank: 'b1' },
        { start: 9, end: 15, blank: 'b2' },
      ],
    },
    children: [],
  };
  const ws = await prisma.worksheet.create({
    data: { title: '手打错', settings: {}, content: content([node]) },
  });

  assert.equal((await migrateBlankMarkText(prisma)).migrated, 1);
  const [after] = await readNodes(prisma, ws.id);
  assert.equal(after.prompt, '哈哈{填空域}，{填空域}');
  assert.deepEqual(blanksOf(after), [
    { start: 2, end: 7, blank: 'b1' },
    { start: 8, end: 13, blank: 'b2' },
  ], '坐标要跟着变短（6 → 5），身份照旧');
  assert.deepEqual(after.data.answers, [[], []], '答案一个字都不动');
});

test('🔴 反向：**文字已经是那个标记**的空一个字都不动（幂等那一半）', async (t) => {
  const prisma = await openTempDb(t);
  const fresh: Node = {
    id: 'a', type: 'fill-blank', prompt: '植物需要{填空域}',
    data: { answers: [['氧气']], promptRuns: [{ start: 4, end: 9, blank: 'blank_1' }] },
    children: [],
  };
  const ws = await prisma.worksheet.create({
    data: { title: '新形态', settings: {}, content: content([fresh]) },
  });

  assert.equal((await migrateBlankMarkText(prisma)).migrated, 0);
  assert.deepEqual(await readNodes(prisma, ws.id), [fresh]);
});

test('🔴 反向：嵌套题（任务里的题）也要迁到，别的 `data` 字段一个字不动', async (t) => {
  const prisma = await openTempDb(t);
  const inner = legacy('inner', '需要', 1, { fillChoicePool: '甲、乙', fillScoring: 'per-blank' });
  const task: Node = { id: 't', type: 'task', prompt: '任务一', data: {}, children: [inner] };
  const ws = await prisma.worksheet.create({
    data: { title: '嵌套', settings: {}, content: content([task]) },
  });

  assert.equal((await migrateBlankMarkText(prisma)).migrated, 1);
  const [root] = await readNodes(prisma, ws.id);
  assert.equal(root.prompt, '任务一', '任务的题干不动');
  assert.equal(root.children[0].prompt, '需要{填空域}');
  assert.equal(root.children[0].data.fillChoicePool, '甲、乙', '别的 data 字段一个字不动');
  assert.equal(root.children[0].data.fillScoring, 'per-blank');
});
