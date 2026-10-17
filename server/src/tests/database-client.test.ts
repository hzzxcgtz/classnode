import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabaseClient, sqliteConnectionUrl } from '../services/database-client.js';

test('SQLite 连接池保留路径及其他参数，统一为单连接', () => {
  assert.equal(sqliteConnectionUrl('file:./dev.db'), 'file:./dev.db?connection_limit=1');
  assert.equal(sqliteConnectionUrl('file:/tmp/db.db?socket_timeout=2&connection_limit=8'), 'file:/tmp/db.db?socket_timeout=2&connection_limit=1');
});

test('学生读事务期间分析写入排队后成功，不因并发连接锁库失败', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-sqlite-concurrency-'));
  const db = createDatabaseClient(`file:${path.join(dir, 'test.db')}?socket_timeout=1`);
  t.after(async () => { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  await db.$executeRawUnsafe('CREATE TABLE probe (id INTEGER PRIMARY KEY, score INTEGER)');
  await db.$executeRawUnsafe('INSERT INTO probe VALUES (1, 0)');
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const snapshot = db.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT score FROM probe');
    entered();
    await new Promise(resolve => setTimeout(resolve, 50));
    return tx.$queryRawUnsafe<Array<{ score: number }>>('SELECT score FROM probe');
  });
  await reading;
  const [before] = await Promise.all([snapshot, db.$executeRawUnsafe('UPDATE probe SET score = 3 WHERE id = 1')]);
  assert.equal(before[0].score, 0);
  assert.equal((await db.$queryRawUnsafe<Array<{ score: number }>>('SELECT score FROM probe'))[0].score, 3);
});
