import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import settings from '../routes/settings.js';
import { hashPassword } from '../services/password-security.js';
import { revokeAllTeacherSessions } from '../middleware/auth.js';

test('desktop reset accepts a chosen password, rejects empty input, revokes sessions and clears login block', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-desktop-password-'));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, 'test.db')}` } } });
  await prisma.$executeRawUnsafe('CREATE TABLE Setting (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL)');
  const app = express(); app.use(express.json()); app.set('prisma', prisma); app.use('/api/settings', settings);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/settings`;
  const post = (route: string, password?: string) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(route === '/reset-password' ? { newPassword: password } : { password }) });
  try {
    await prisma.setting.create({ data: { key: 'admin_password', value: hashPassword('old-password') } });
    const oldLogin = await post('/verify-password', 'old-password');
    const cookie = oldLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal(oldLogin.status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await post('/verify-password', 'wrong')).status, 401);
    assert.equal((await post('/verify-password', 'old-password')).status, 429);
    for (const invalid of [undefined, '', 123, null, {}, []]) {
      const response = await fetch(base + '/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: invalid }) });
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(base + '/session', { headers: { cookie } }).then(r => r.json()) as { authenticated: boolean }).authenticated, true);
    const newPassword = '我的新密码-Abc&123';
    const reset = await post('/reset-password', newPassword); assert.equal(reset.status, 200);
    const result = await reset.json() as Record<string, unknown>;
    assert.equal(result.success, true);
    assert.equal(result.temporaryPassword, undefined);
    assert.ok(!JSON.stringify(result).includes(newPassword));
    const session = await fetch(base + '/session', { headers: { cookie } });
    assert.equal((await session.json() as { authenticated: boolean }).authenticated, false);
    assert.equal((await post('/verify-password', 'old-password')).status, 401);
    const login = await post('/verify-password', newPassword);
    assert.equal(login.status, 200); assert.equal((await login.json() as { verified: boolean }).verified, true);
    assert.ok(login.headers.get('set-cookie'));
    const stored = await prisma.setting.findUniqueOrThrow({ where: { key: 'admin_password' } });
    assert.ok(stored.value.startsWith('scrypt$')); assert.notEqual(stored.value, newPassword);
    assert.equal((await fetch(base + '/desktop-info')).status, 200);
    const badNetwork = await fetch(base + '/desktop-network', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: '203.0.113.1' }) });
    assert.equal(badNetwork.status, 400);
  } finally {
    revokeAllTeacherSessions(); await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
