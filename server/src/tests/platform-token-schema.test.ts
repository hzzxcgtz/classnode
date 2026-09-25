/**
 * ★ API Token 共享（第 1 步）：**老库升级路径**上的建表与加列。
 *
 * 🔴 为什么值得单独一条用例：`ensurePlatformTokenSchema` 是给**已经装了旧版本**的库跑的
 * （`prisma db push` 没跑过、表不存在、`Agent` 上没有 `credentialId`）。
 * 这条路径**平时走不到** —— 开发机上 `db push` 早就把表建好了 ——
 * 而它错了的症状是老用户升级之后「token 相关的一切都报 no such table / no such column」。
 *
 * ⚠️ 这里比的是**列的形状**（名字 / 类型 / 非空 / 默认值），不是 DDL 文本 ——
 * 后者已经由「逐字抄自 `prisma db push` 产物」那条纪律保证（见服务文件头）。
 * 形状一致是「两边各自都能跑」的最低要求，也是这条用例能给的那一半。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensurePlatformTokenSchema } from '../services/platform-token-schema.js';

/** 老版本的 `Agent` —— 只看这里用得上的三列，够 `ALTER` 与断言了。 */
const LEGACY_AGENT = `CREATE TABLE "Agent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL
)`;

/** ⚠️ `notnull` 经 Prisma 的 `$queryRaw` 回来是 **BigInt**（SQLite 的 PRAGMA 全走整数）——
 *  写成 `number` 的话 `assert.equal(c.notnull, 0)` 会红成 `0n !== 0`，而那是用例的错、不是实现的错。
 *  拼进模板串时 BigInt 的 `toString` 给的是 `"0"` / `"1"`，正好可用。 */
interface ColumnInfo { name: string; type: string; notnull: bigint; dflt_value: string | null }

async function openLegacyDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-token-schema-'));
  const url = `file:${path.join(dir, 'legacy.db')}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // 手工造一个「旧库」：没有 PlatformToken、Agent 上没有 credentialId
  await prisma.$executeRawUnsafe(LEGACY_AGENT);
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return prisma;
}

async function columns(prisma: PrismaClient, table: string): Promise<ColumnInfo[]> {
  return prisma.$queryRawUnsafe<ColumnInfo[]>(`PRAGMA table_info('${table}')`);
}

test('🔴 老库：建出 PlatformToken 表、给 Agent 补上 credentialId', async (t) => {
  const prisma = await openLegacyDb(t);

  // 前提：这确实是一个「旧库」（少了表与列）—— 少了这两条，下面的断言可能是恒真的
  assert.equal((await columns(prisma, 'Agent')).some((c) => c.name === 'credentialId'), false, '前提：旧库没有这一列');

  await ensurePlatformTokenSchema(prisma);

  const cols = await columns(prisma, 'PlatformToken');
  assert.deepEqual(
    cols.map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value ?? ''}`),
    [
      'id:TEXT:1:',                       // PRIMARY KEY ⇒ notnull=1（SQLite 对 TEXT PK 的行为）
      'platform:TEXT:1:',
      'label:TEXT:1:',
      'token:TEXT:1:',
      'expiresAt:DATETIME:0:',            // ★ 可空 —— 迁移不猜日期，这一列必须能留空
      'createdAt:DATETIME:1:CURRENT_TIMESTAMP',
      'updatedAt:DATETIME:1:',
    ],
    'PlatformToken 的列形状必须与 prisma 生成的逐条一致',
  );

  const agentCol = (await columns(prisma, 'Agent')).find((c) => c.name === 'credentialId');
  assert.ok(agentCol, 'Agent 必须补上 credentialId');
  assert.equal(agentCol.type, 'TEXT');
  assert.equal(Number(agentCol.notnull), 0, '★ 可空是一条**真路**（老数据全是 NULL ⇒ 沿用自带 apiKey）');
});

test('🔴 幂等：重复跑不会报错，也不会改坏已有的列', async (t) => {
  const prisma = await openLegacyDb(t);
  await ensurePlatformTokenSchema(prisma);
  const before = await columns(prisma, 'PlatformToken');

  await ensurePlatformTokenSchema(prisma); // 第二次（进程重启会再跑一次）

  assert.deepEqual(await columns(prisma, 'PlatformToken'), before);
});

test('🔴 表已存在但缺列的半截库：也要把列补上', async (t) => {
  // 造一个「上一轮跑到一半」的库：表建好了，列没加上
  const prisma = await openLegacyDb(t);
  await prisma.$executeRawUnsafe(`CREATE TABLE "PlatformToken" (
    "id" TEXT NOT NULL PRIMARY KEY, "platform" TEXT NOT NULL, "label" TEXT NOT NULL,
    "token" TEXT NOT NULL, "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);

  await ensurePlatformTokenSchema(prisma);

  assert.equal((await columns(prisma, 'Agent')).some((c) => c.name === 'credentialId'), true);
});
