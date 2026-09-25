/**
 * ★ API Token 共享（第 3 步）：管理端点的行为。
 *
 * 这几条端点最要紧的不是「能增能删」，是**两个不说就会静默出错的判据**：
 *   · 🔴 出参**永不包含明文 Token**（出去的方向一律掩码）；
 *   · 🔴 改的时候**不带 `token` 字段就不许动它** —— 界面回显的是掩码、提交时也不回传，
 *     写成 `encrypt(token ?? '')` 会把一份好凭据覆盖成空串的密文，而**任何地方都不会报**。
 *
 * 以及那条**删除守卫**：被智能体用着的凭据删不掉，而且要**说清是哪几个** ——
 * 只靠外键的话，数据库回一个 500 级的错误，教师只看到「删除失败」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import platformTokenRoutes from '../routes/platform-tokens.js';
import { decrypt, isEncrypted } from '../services/crypto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');
const TOKEN = 'pat_abcdefghijklmnop_qrstuvwx';

async function start(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-token-routes-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), 'DATABASE_URL 必须指向临时目录');
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/platform-tokens', platformTokenRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform-tokens`;

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = async (method: string, suffix: string, body?: unknown) => {
    const res = await fetch(`${base}${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
  };
  return { prisma, call };
}

test('🔴 出参永不包含明文 Token（只给掩码）', async (t) => {
  const { call } = await start(t);
  const created = await call('POST', '/', { label: '张老师的号', token: TOKEN });
  assert.equal(created.status, 200);
  assert.equal(created.json?.maskedToken, 'pat_*********************uvwx');
  assert.equal(JSON.stringify(created.json).includes(TOKEN), false, '★ 创建响应里不许出现明文');

  const listed = await call('GET', '/');
  assert.equal(JSON.stringify(listed.json).includes(TOKEN), false, '★ 列表响应里不许出现明文');
  assert.equal((listed.json as unknown as { maskedToken: string }[])[0].maskedToken, 'pat_*********************uvwx');
});

test('落库的是密文，不是明文', async (t) => {
  const { prisma, call } = await start(t);
  await call('POST', '/', { label: '号', token: TOKEN });
  const row = (await prisma.platformToken.findMany())[0];
  assert.equal(row.token.includes(TOKEN), false, '库里不许有明文');
  assert.ok(isEncrypted(row.token));
  assert.equal(decrypt(row.token), TOKEN);
});

test('备注与 Token 都是必填（一份没有名字的凭据在列表里等于没有）', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('POST', '/', { token: TOKEN })).status, 400);
  assert.equal((await call('POST', '/', { label: '  ', token: TOKEN })).status, 400);
  assert.equal((await call('POST', '/', { label: '号' })).status, 400);
  assert.equal((await call('POST', '/', { label: '号', token: '  ' })).status, 400);
});

test('🔴 改的时候不带 token 字段 ⇒ **不动它**（回显的是掩码，提交时也不回传）', async (t) => {
  const { prisma, call } = await start(t);
  const id = (await call('POST', '/', { label: '旧名', token: TOKEN })).json?.id as string;
  const before = (await prisma.platformToken.findUnique({ where: { id } }))?.token;

  // 只改备注与有效期（界面就是这个形状：Token 那一格显示掩码，用户没动它）
  const updated = await call('PUT', `/${id}`, { label: '新名', expiresAt: '2026-12-31T00:00:00.000Z' });
  assert.equal(updated.status, 200);
  assert.equal(updated.json?.label, '新名');

  const after = await prisma.platformToken.findUnique({ where: { id } });
  assert.equal(after?.token, before, '★ 不带 token 的更新不许碰它 —— 覆盖成空串的密文任何地方都不会报');
  assert.equal(decrypt(after!.token), TOKEN);
  assert.equal(after?.expiresAt?.toISOString(), '2026-12-31T00:00:00.000Z');
});

test('🔴 显式 `expiresAt: null` ⇒ 清掉有效期（回到「未设置」那个要被催促的状态）', async (t) => {
  const { call } = await start(t);
  const id = (await call('POST', '/', { label: '号', token: TOKEN, expiresAt: '2026-12-31T00:00:00.000Z' })).json?.id as string;
  assert.equal((await call('PUT', `/${id}`, { expiresAt: null })).json?.expiresAt, null);
});

test('🔴 被智能体用着的凭据**删不掉**，而且要说清是哪几个', async (t) => {
  const { prisma, call } = await start(t);
  const id = (await call('POST', '/', { label: '号', token: TOKEN })).json?.id as string;
  await prisma.agent.create({ data: { name: '学伴A', platform: 'coze', apiKey: 'x', enabled: true, credentialId: id } });
  await prisma.agent.create({ data: { name: '分析型', platform: 'coze', apiKey: 'x', enabled: true, credentialId: id } });

  const refused = await call('DELETE', `/${id}`);
  assert.equal(refused.status, 400);
  assert.match(String(refused.json?.error), /学伴A/, '必须点名 —— 「删除失败」说不出原因等于没说');
  assert.match(String(refused.json?.error), /分析型/);
  assert.equal(await prisma.platformToken.count(), 1, '★ 被拒之后凭据必须还在');

  // 引用面那条端点给出同一份清单（删除前提示与改值前提示共用它）
  const usage = await call('GET', `/${id}/usage`);
  assert.equal(usage.json?.used, true);
  assert.equal(usage.json?.agentCount, 2);
});

test('没被用着的凭据可以删；已经不存在的回 404', async (t) => {
  const { prisma, call } = await start(t);
  const id = (await call('POST', '/', { label: '号', token: TOKEN })).json?.id as string;
  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal(await prisma.platformToken.count(), 0);
  assert.equal((await call('DELETE', `/${id}`)).status, 404);
});

test('有效期格式不对 ⇒ 400，不写库', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('POST', '/', { label: '号', token: TOKEN, expiresAt: '不是日期' })).status, 400);
});
