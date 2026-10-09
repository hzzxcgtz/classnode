import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
/**
 * ★ API Token 共享（第 1 步）：把现有 `coze` 智能体的 Token 抽成 `PlatformToken` 记录。
 *
 * 🔴 一条决定实现形态的事实：`crypto.ts` 的 `encrypt` **每次都用一个随机 IV**
 * （`crypto.randomBytes(12)`）⇒ **同一个 Token 的密文每次都不一样**。
 * 所以「按 Token 去重」**必须解密后比明文**，比密文会把每个智能体都判成一份新的。
 * 本文件第 1 条用例专门把这个前提钉住 —— 它是后面所有去重逻辑的地基。
 *
 * 🔴 迁移的三条纪律（spec §六），逐条有用例：
 *   1. 原 `apiKey` 一个字不动（回滚的路，也是「自带 Token」那条路的数据）；
 *   2. `expiresAt` **迁移不猜** ⇒ 留空，不是 `now + 30d`；
 *   3. 幂等 —— 重复跑不会造出第二份同样的凭据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../services/crypto.js';
import { migratePlatformTokens } from '../services/platform-token-migration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/prisma/build/index.js');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

/** 一个真正的扣子 Token 长这样（长度足够走 `maskAgentSecret` 的掩码分支）。 */
const TOKEN_A = 'pat_abcdefghijklmnop_qrstuvwx';
const TOKEN_B = 'pat_zyxwvutsrqponmlk_jihgfedc';

async function openTempDb(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-token-migration-'));
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

test('🔴 前提：同一个 Token 两次加密的**密文不同**（所以去重只能比明文）', () => {
  const a = encrypt(TOKEN_A);
  const b = encrypt(TOKEN_A);
  assert.notEqual(a, b, '随机 IV 下密文必须不同 —— 若这条红了，说明加密换了实现，下面的去重逻辑要重看');
  assert.equal(decrypt(a), TOKEN_A);
  assert.equal(decrypt(b), TOKEN_A);
});

test('🔴 同 Token 的多个智能体合成一份凭据；原 apiKey 一个字不动；有效期留空', async (t) => {
  const prisma = await openTempDb(t);

  // ⚠️ 两条**故意**用不同的密文写库（模拟真实数据：它们本来就是各自加密的）
  const agentA = await prisma.agent.create({
    data: { name: '学伴A', platform: 'coze', apiKey: encrypt(TOKEN_A), botId: '1', enabled: true },
  });
  const agentB = await prisma.agent.create({
    data: { name: '分析型', platform: 'coze', apiKey: encrypt(TOKEN_A), botId: '2', enabled: true, purpose: 'analysis' },
  });
  const agentC = await prisma.agent.create({
    data: { name: '别的号', platform: 'coze', apiKey: encrypt(TOKEN_B), botId: '3', enabled: true },
  });
  // 非 coze：**不该**被碰（spec §目标：今天只接 `coze`）
  const zhipu = await prisma.agent.create({
    data: { name: '智谱', platform: 'zhipuai', apiKey: encrypt(TOKEN_B), enabled: true },
  });

  const before = await prisma.agent.findMany({ select: { id: true, apiKey: true } });

  const result = await migratePlatformTokens(prisma);

  const tokens = await prisma.platformToken.findMany({ orderBy: { createdAt: 'asc' } });
  assert.equal(tokens.length, 2, 'TOKEN_A 一份、TOKEN_B 一份');
  assert.equal(result.linked, 3, '三个 coze 智能体被接上');

  const byId = new Map((await prisma.agent.findMany({ select: { id: true, credentialId: true } })).map((a) => [a.id, a.credentialId]));
  const linkA = byId.get(agentA.id);
  assert.ok(linkA, '学伴A 该被接上');
  assert.equal(byId.get(agentB.id), linkA, '★ 同一个 Token 的两个智能体必须指向**同一份**凭据');
  assert.notEqual(byId.get(agentC.id), linkA, '不同 Token 不该被合并');
  assert.equal(byId.get(zhipu.id), null, '非 coze 的智能体不该被接上');

  // 🔴 纪律 1：原 apiKey 一个字不动
  const after = await prisma.agent.findMany({ select: { id: true, apiKey: true } });
  assert.deepEqual(after, before, '★ 迁移不许改 apiKey —— 它是回滚的路，也是「自带 Token」那条路的数据');

  // 🔴 纪律 2：有效期**不猜**
  for (const token of tokens) {
    assert.equal(token.expiresAt, null, '迁移不给日期：写 now+30d 是造一批假倒计时');
    assert.ok(token.label.length > 0, 'label 必填 —— 一份没有名字的凭据在列表里等于没有');
  }
  // 凭证里存的确实是**明文 Token 的密文**（能解回原值）
  assert.deepEqual(tokens.map((x) => decrypt(x.token)).sort(), [TOKEN_A, TOKEN_B].sort());
});

test('🔴 幂等：同一批数据跑两次，凭据不会翻倍', async (t) => {
  const prisma = await openTempDb(t);
  await prisma.agent.create({ data: { name: 'A', platform: 'coze', apiKey: encrypt(TOKEN_A), enabled: true } });
  await prisma.agent.create({ data: { name: 'B', platform: 'coze', apiKey: encrypt(TOKEN_A), enabled: true } });

  await migratePlatformTokens(prisma);
  const first = await prisma.platformToken.count();
  await migratePlatformTokens(prisma);
  const second = await prisma.platformToken.count();

  assert.equal(first, 1, '第一次跑：一份');
  assert.equal(second, 1, '★ 第二次跑不许再造一份（迁移可能中途崩过，标记没写上）');
});

test('🔴 中途崩过的迁移：已有凭据时**只补接线**，不再造一份', async (t) => {
  // 🔴 这一条才是「比对密文」与「比对明文」的分水岭 ——
  //    上面那条幂等用例其实只走到 `pending.length === 0` 的**早退**，
  //    真正防「跑到一半崩过」的 `known` 表它一句都没碰到（**假绿**）。
  //    这里手工造出那个中间态：凭据已建好、A 已接上、B 还是 `credentialId = null`。
  const prisma = await openTempDb(t);
  const token = await prisma.platformToken.create({
    data: { platform: 'coze', label: '已有的', token: encrypt(TOKEN_A) },
  });
  await prisma.agent.create({
    data: { name: 'A', platform: 'coze', apiKey: encrypt(TOKEN_A), enabled: true, credentialId: token.id },
  });
  const b = await prisma.agent.create({
    // ⚠️ 密文与 A 的**不同**（随机 IV）—— 比密文的实现会在这里判成一份新凭据
    data: { name: 'B', platform: 'coze', apiKey: encrypt(TOKEN_A), enabled: true },
  });

  const result = await migratePlatformTokens(prisma);

  assert.equal(await prisma.platformToken.count(), 1, '★ 不许再造一份');
  assert.equal(result.tokens, 0, '一份都没新建');
  assert.equal(result.linked, 1, '只补了 B 这一根接线');
  assert.equal((await prisma.agent.findUnique({ where: { id: b.id } }))?.credentialId, token.id,
    'B 该被接到**已有**那份上');
});

test('没有 coze 智能体时，什么都不做（不造空凭据）', async (t) => {
  const prisma = await openTempDb(t);
  await prisma.agent.create({ data: { name: '智谱', platform: 'zhipuai', apiKey: encrypt(TOKEN_A), enabled: true } });
  const result = await migratePlatformTokens(prisma);
  assert.equal(await prisma.platformToken.count(), 0);
  assert.equal(result.linked, 0);
});
