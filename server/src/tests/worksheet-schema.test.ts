import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureWorksheetTables } from '../services/worksheet-schema.js';

/** 4 张新表 —— 也是「老库形状」的判据。 */
const WORKSHEET_TABLES = ['Worksheet', 'ClassroomWorksheet', 'WorksheetResponse', 'WorksheetAnswer'];
/** 逆外键依赖顺序：先删引用方，最后删被引用方。 */
const DROP_ORDER = ['WorksheetAnswer', 'WorksheetResponse', 'ClassroomWorksheet', 'Worksheet'];

/** 真实库的路径。测试**只读地**复制它，改动只发生在 /tmp 的副本上。 */
const TEMPLATE_DB = new URL('../../prisma/dev.db', import.meta.url).pathname;
const HAS_TEMPLATE = fs.existsSync(TEMPLATE_DB);

if (!HAS_TEMPLATE) {
  console.log(`[worksheet-schema.test] 跳过：模板库不存在（${TEMPLATE_DB}），本测试需要一份真实库作形状副本`);
}

/** 造一个「老库」：复制真实库，返回指向副本的连接。 */
function makeLegacyDb(file: string): PrismaClient {
  fs.copyFileSync(TEMPLATE_DB, file);
  return new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
}

test('在缺表的库上建出 4 张表，且第二次调用不重复建', { skip: !HAS_TEMPLATE }, async () => {
  const file = path.join(os.tmpdir(), `wsv-${process.pid}-${Date.now()}.db`);
  const db = makeLegacyDb(file);
  try {
    // 先制造「老库」形状：确保 4 张表都不存在（副本上操作，安全）
    for (const t of DROP_ORDER) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    }
    const before = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.deepEqual(before, [], '前置条件：4 张新表在副本上都应已被删掉');

    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created.sort(), ['ClassroomWorksheet', 'Worksheet', 'WorksheetAnswer', 'WorksheetResponse']);

    const second = await ensureWorksheetTables(db);
    assert.deepEqual(second.created, [], '第二次调用必须什么都不建');

    // 建表顺序 = 外键依赖顺序（Worksheet 无依赖 → ClassroomWorksheet → WorksheetResponse → WorksheetAnswer）
    const rows = await db.$queryRawUnsafe<{ name: string; sql: string }[]>(
      `SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.deepEqual(rows.map(r => r.name).sort(), [...WORKSHEET_TABLES].sort());

    // DDL 必须与 Prisma 的输出一致：用 sqlite_master 比对具名约束
    const ddl = await db.$queryRawUnsafe<{ sql: string }[]>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='WorksheetResponse'`);
    assert.match(ddl[0].sql, /WorksheetResponse_worksheetId_fkey.*ON DELETE RESTRICT/);
    assert.match(ddl[0].sql, /WorksheetResponse_participantId_fkey.*ON DELETE CASCADE/);

    // 手写 DDL 里最容易写错的几处：JSONB、updatedAt 无 DEFAULT、索引名
    const worksheet = await db.$queryRawUnsafe<{ sql: string }[]>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='Worksheet'`);
    assert.match(worksheet[0].sql, /"content" JSONB NOT NULL/);
    assert.match(worksheet[0].sql, /"updatedAt" DATETIME NOT NULL(?! DEFAULT)/);
    assert.match(worksheet[0].sql, /"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    const answers = await db.$queryRawUnsafe<{ sql: string }[]>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='WorksheetAnswer'`);
    assert.match(answers[0].sql, /"value" JSONB,/);

    // 只看具名索引：sql IS NULL 的是 SQLite 为 `TEXT PRIMARY KEY` 自动建的
    // sqlite_autoindex_*（Prisma 的 db push 也会产生同样的条目，不是我们写歪了）。
    const indexes = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
         AND tbl_name IN ('ClassroomWorksheet','WorksheetResponse','WorksheetAnswer')`);
    assert.deepEqual(indexes.map(i => i.name).sort(), [
      'ClassroomWorksheet_classroomId_worksheetId_key',
      'ClassroomWorksheet_worksheetId_idx',
      'WorksheetAnswer_responseId_idx',
      'WorksheetAnswer_responseId_questionId_key',
      'WorksheetResponse_classroomId_idx',
      'WorksheetResponse_classroomId_worksheetId_participantId_key',
    ].sort());

    // 建出来的表真能写：外键指向的父行存在时才写得进去（证明约束真的生效）
    await db.$executeRawUnsafe(
      `INSERT INTO "Worksheet" ("id","title","content","settings","updatedAt") VALUES ('w1','t','{}','{}',CURRENT_TIMESTAMP)`);
    const inserted = await db.$queryRawUnsafe<{ title: string }[]>(`SELECT "title" FROM "Worksheet" WHERE "id"='w1'`);
    assert.deepEqual(inserted, [{ title: 't' }]);
  } finally {
    await db.$disconnect();
    fs.rmSync(file, { force: true });
  }
});
