import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ 2026-09-25：**任务制迁移** —— 把现有学习单的平铺题包进一个任务容器。
 *
 * 教师裁定 ④a：「自动包一层『任务一』」。
 *
 * 🔴 这次迁移动的是**每一份已有学习单的 `content`**，而它的三个下游全都按
 * 「`content` 是一列题」写的（学生端面板 / 教师看板矩阵 / 导出与 M7a 分析载荷）。
 * 所以四条纪律逐条有用例：
 *   1. **原节点一个字不动** —— 只是外面包一层 ⇒ 回滚 = 把那层剥掉；
 *   2. **幂等** —— 重复跑不套两层（判据 2026-09-25 改成「顶层出现过 task 就不动」，
 *      见「混合形状」那一条的注释：旧判据会再造一个同名的「任务一」⇒ 题号撞车）；
 *   3. **空学习单不造空任务** —— 不造一个没用的、教师也没要过的容器。
 *      ⚠️ 这**不再**是为了躲开校验：教师 2026-09-25 裁定「允许空任务」，
 *      `VALIDATORS['task']` 里那条已经删了（本条原话是「会把空任务判为不合法」，已过期）；
 *   4. **老作答仍然对得上** —— 作答按 `questionId` 存，而这次迁移**不改任何 id**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateWorksheetsToTasks } from '../services/worksheet-task-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

/** 一道最小但合法的题。⚠️ 形状写具体（不是 `unknown[]`）—— Prisma 的 `Json` 列要结构匹配。 */
// ⚠️ 必须是 `type` 而不是 `interface`：`interface` **没有隐式索引签名**，
//    因此不匹配 Prisma 的 `InputJsonValue`（那是个索引签名类型）。踩过一次。
type Node = {
  id: string;
  type: string;
  prompt: string;
  inputMode: string;
  data: Record<string, never>;
  children: Node[];
};
function q(id: string, type = 'short-answer'): Node {
  return { id, type, prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children: [] };
}

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-task-migration-'));
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

const content = (nodes: Node[]) => ({ schemaVersion: 1, nodes });

test('🔴 平铺的学习单被包进一个任务；**原节点一个字不动**', async (t) => {
  const prisma = await openTempDb(t);
  const original = [q('a'), q('b', 'single-choice')];
  const ws = await prisma.worksheet.create({
    data: { title: '单', content: content(original) , settings: {} },
  });

  const result = await migrateWorksheetsToTasks(prisma);
  assert.equal(result.migrated, 1);

  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.equal(after.nodes.length, 1, '顶层只剩一个任务');
  const task = after.nodes[0];
  assert.equal(task.type, 'task');
  assert.equal(task.prompt, '任务一', '⚠️ 迁移**不编说明** —— 与「有效期不猜」同一条纪律');
  assert.ok(task.id, '任务要有 id');
  // 🔴 纪律 1：原节点逐字不变（只被搬了一层，没有被改写）
  assert.deepEqual(task.children, original, '原节点一个字都不许动');
});

test('🔴 幂等：跑两次不会套两层', async (t) => {
  const prisma = await openTempDb(t);
  await prisma.worksheet.create({ data: { title: '单', content: content([q('a')]), settings: {} } });

  await migrateWorksheetsToTasks(prisma);
  const once = (await prisma.worksheet.findFirst())!.content as unknown as { nodes: Node[] };
  const second = await migrateWorksheetsToTasks(prisma);
  const twice = (await prisma.worksheet.findFirst())!.content as unknown as { nodes: Node[] };

  assert.equal(second.migrated, 0, '第二次没有可迁的');
  assert.deepEqual(twice, once, '★ 第二次跑不许改动任何东西');
  assert.equal(twice.nodes.length, 1);
  assert.equal(twice.nodes[0].children[0].type, 'short-answer', '★ 不许套第二层');
});

test('🔴 空的（或全是空数组的）学习单**不造空任务**', async (t) => {
  // 一个空学习单是**合法数据**；而 `VALIDATORS['task']` 会把「空任务」判为不合法
  // ⇒ 迁移不许把合法数据弄成不合法的。
  const prisma = await openTempDb(t);
  const empty = await prisma.worksheet.create({ data: { title: '空', content: content([]) , settings: {} } });

  const result = await migrateWorksheetsToTasks(prisma);

  const after = (await prisma.worksheet.findUnique({ where: { id: empty.id } }))!.content as { nodes: Node[] };
  assert.deepEqual(after.nodes, [], '★ 一个空任务都不许造出来');
  assert.equal(result.migrated, 0);
});

test('🔴 老作答仍然对得上（迁移不改任何 questionId）', async (t) => {
  const prisma = await openTempDb(t);
  const ws = await prisma.worksheet.create({ data: { title: '单', content: content([q('a'), q('b')]), settings: {} } });
  const cls = await prisma.classroom.create({ data: { title: '课', code: '7001', status: 'active' } });
  const part = await prisma.classroomStudent.create({ data: { classroomId: cls.id, type: 'student' } });
  // ⚠️ 作答挂在 `WorksheetResponse` 上（`WorksheetAnswer` 只有 `responseId` 一条外键），
  //    不是直接挂课堂 —— 这是本仓 `WorksheetAnswer` 的形状。
  const response = await prisma.worksheetResponse.create({
    data: { classroomId: cls.id, worksheetId: ws.id, participantId: part.id, status: 'submitted' },
  });
  await prisma.worksheetAnswer.create({
    data: { responseId: response.id, questionId: 'a', status: 'submitted', value: { format: 'text/v1', text: '答了' } },
  });

  await migrateWorksheetsToTasks(prisma);

  // 作答行**一个字没动**（迁移只碰 `Worksheet.content`，不碰作答）
  const answers = await prisma.worksheetAnswer.findMany();
  assert.equal(answers.length, 1);
  assert.equal(answers[0].questionId, 'a', '★ questionId 不变 ⇒ 老作答仍然指得到那道题');
  // 而那道题的 id 也确实还在树里（包了一层之后仍然找得到）
  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content as unknown as { nodes: Node[] };
  assert.deepEqual(after.nodes[0].children.map((c) => c.id), ['a', 'b']);
});

test('已经是任务制的学习单**不动**（哪怕它已经有多个任务）', async (t) => {
  const prisma = await openTempDb(t);
  const already = content([
    { id: 't1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {}, children: [q('a')] },
    { id: 't2', type: 'task', prompt: '任务二', inputMode: 'keyboard', data: {}, children: [q('b')] },
  ]);
  const ws = await prisma.worksheet.create({ data: { title: '已是任务制', content: already, settings: {} } });

  const result = await migrateWorksheetsToTasks(prisma);

  assert.equal(result.migrated, 0, '★ 顶层全是任务 ⇒ 没有可迁的');
  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.deepEqual(after, already, '逐字不变');
});

test('🔴 混合形状：顶层**已经有任务** ⇒ 整份不动（不把散题再收一遍）', async (t) => {
  // ⚠️ 本条 2026-09-25 **改过判据**（推翻它原来的写法，见下）。
  //
  // 原判据是「顶层还有没有非 task 的节点」⇒ 顶层有任务、又混着散题时，会把散题**再收一个**
  // 名为「任务一」的容器 —— 而容器名是**恒定**的 `'任务一'` ⇒ 同屏出现两个「任务一」，
  // 题号也逐字撞车（`任务一 · 1` 出现两次）。而整批第 3/4 步的修复理由就是「题号不能撞」，
  // 这是它自己造出来的撞号。
  //
  // 新判据：**顶层出现过 task 就不动**。理由：迁移是**一次性升级**，它只该处理
  // 「还没有任何任务」的学习单；顶层已经有任务，说明这份单要么迁过了、要么是教师
  // 自己做的分组 —— 两种都不该被迁移改写。
  // ⚠️ 原注释里那条理由（「迁移可能中途崩过」）**在这份实现里不成立**：每次
  // `prisma.worksheet.update` 只写**一行**、是原子的，不存在「一份单迁了一半」。
  const prisma = await openTempDb(t);
  const existingTask = { id: 't1', type: 'task', prompt: '任务一', inputMode: 'keyboard', data: {}, children: [q('a')] };
  const loose = q('b');
  const before = content([existingTask, loose]);
  const ws = await prisma.worksheet.create({ data: { title: '混合', content: before, settings: {} } });

  const result = await migrateWorksheetsToTasks(prisma);

  assert.equal(result.migrated, 0, '顶层已经有任务 ⇒ 这份单不动');
  const after = (await prisma.worksheet.findUnique({ where: { id: ws.id } }))!.content;
  assert.deepEqual(after, before, '逐字不变 —— 散题留在原位，不会多出一个同名的「任务一」');
});
