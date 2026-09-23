import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ensureWorksheetTables } from '../services/worksheet-schema.js';

/** 4 张新表 —— 也是「老库形状」的判据。 */
const WORKSHEET_TABLES = ['Worksheet', 'ClassroomWorksheet', 'WorksheetResponse', 'WorksheetAnswer'];
/** 逆外键依赖顺序：先删引用方，最后删被引用方。 */
const DROP_ORDER = ['WorksheetAnswer', 'WorksheetResponse', 'ClassroomWorksheet', 'Worksheet'];
/** 6 个具名索引 —— 名字必须与 worksheet-schema.ts 里的定义逐一对应。 */
const INDEX_NAMES = [
  'ClassroomWorksheet_worksheetId_idx',
  'ClassroomWorksheet_classroomId_worksheetId_key',
  'WorksheetResponse_classroomId_idx',
  'WorksheetResponse_classroomId_worksheetId_participantId_key',
  'WorksheetAnswer_responseId_idx',
  'WorksheetAnswer_responseId_questionId_key',
];

const SCHEMA_SRC = new URL('../../prisma/schema.prisma', import.meta.url).pathname;
const PRISMA_BIN = new URL('../../node_modules/.bin/prisma', import.meta.url).pathname;

/** 本次运行的唯一后缀 —— 所有产物都落在这个前缀下，互不干扰。 */
const RUN_ID = `${process.pid}-${Date.now()}`;
const SCHEMA_COPY = path.join(os.tmpdir(), `wsv-schema-${RUN_ID}.prisma`);
const TEMPLATE_DB = path.join(os.tmpdir(), `wsv-template-${RUN_ID}.db`);

/**
 * 自造模板库 —— **不再依赖 `server/prisma/dev.db`**。
 *
 * 那个文件被 `.gitignore` 的 `*.db` 忽略，于是原来 `{ skip: !HAS_TEMPLATE }` 的写法在
 * 任何全新克隆上都会静默跳过，而本阶段唯一的硬要求（手写 DDL 与 Prisma 输出逐字一致）
 * 就一个断言都没跑，`pnpm test` 却依然是绿的 —— 这正是本项目反复出现的假绿形态。
 *
 * 造法：把 `schema.prisma` 复制到 /tmp，`db push` 到一个 /tmp 的空库，再**由用例自己
 * DROP 掉那 4 张表**得到「老库形状」。为什么不直接用 `db push` 的产物：那种库里 4 张表
 * 天生就是新形状，拿它测建表**永远绿**，而真实老库仍然是坏的。
 *
 * 🔴 全程只碰 /tmp，绝不碰 `server/prisma/dev.db`。
 */
before(() => {
  assert.ok(fs.existsSync(SCHEMA_SRC), `找不到 schema.prisma：${SCHEMA_SRC}`);
  assert.ok(fs.existsSync(PRISMA_BIN), `找不到 prisma CLI：${PRISMA_BIN}`);
  fs.copyFileSync(SCHEMA_SRC, SCHEMA_COPY);
  const r = spawnSync(PRISMA_BIN, ['db', 'push', '--schema', SCHEMA_COPY, '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: `file:${TEMPLATE_DB}` },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `prisma db push 失败，无法造出模板库：\n${r.stdout}\n${r.stderr}`);
  assert.ok(fs.existsSync(TEMPLATE_DB), '模板库应当已被 prisma db push 建出来');
});

after(() => {
  fs.rmSync(SCHEMA_COPY, { force: true });
  fs.rmSync(TEMPLATE_DB, { force: true });
});

/** 复制模板库到独立文件，返回连接与路径 —— 改动只发生在副本上。 */
function makeCopy(tag: string): { db: PrismaClient; file: string } {
  const file = path.join(os.tmpdir(), `wsv-${tag}-${RUN_ID}.db`);
  fs.copyFileSync(TEMPLATE_DB, file);
  return { db: new PrismaClient({ datasources: { db: { url: `file:${file}` } } }), file };
}

test('在缺表的库上建出 4 张表，且第二次调用不重复建', async () => {
  const { db, file } = makeCopy('legacy');
  try {
    // 先制造「老库」形状：确保 4 张表都不存在（副本上操作，安全）
    for (const t of DROP_ORDER) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    }
    const before_ = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.deepEqual(before_, [], '前置条件：4 张新表在副本上都应已被删掉');

    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created.sort(), ['ClassroomWorksheet', 'Worksheet', 'WorksheetAnswer', 'WorksheetResponse']);
    assert.deepEqual(first.indexesCreated.sort(), [...INDEX_NAMES].sort(), '建表时 6 个具名索引应一并建出');

    const second = await ensureWorksheetTables(db);
    assert.deepEqual(second.created, [], '第二次调用必须什么都不建');
    assert.deepEqual(second.indexesCreated, [], '第二次调用必须不重复建索引');

    // 建表顺序与 prisma db push 的输出一致（Worksheet 无依赖 → ClassroomWorksheet → WorksheetResponse → WorksheetAnswer）
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
    assert.deepEqual(indexes.map(i => i.name).sort(), [...INDEX_NAMES].sort());

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

test('🔴 表在、索引不在的半成品库：按名补回索引，且第二次调用返回空', async () => {
  const { db, file } = makeCopy('half');
  try {
    // 前置条件：表齐（db push 的产物），6 个具名索引由本用例删掉，模拟
    // 「建表成功但建索引失败」的中间态。
    for (const name of INDEX_NAMES) {
      await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
    }
    const gone = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('${INDEX_NAMES.join("','")}')`);
    assert.deepEqual(gone, [], '前置条件：6 个具名索引都应已被删掉');
    const tablesStillThere = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.equal(tablesStillThere.length, 4, '前置条件：4 张表都还在（这正是与上面那条用例的区别）');

    // 这条断言在修复前必定失败：旧实现只按表名探测，表在就 `continue`，
    // 一条索引都不会补，`indexesCreated` 甚至是 undefined。
    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created, [], '表已存在，不应重复建表');
    assert.deepEqual(first.indexesCreated.sort(), [...INDEX_NAMES].sort(), '缺的 6 个索引都应被补回');

    const restored = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('${INDEX_NAMES.join("','")}')`);
    assert.deepEqual(restored.map(i => i.name).sort(), [...INDEX_NAMES].sort(), '索引必须真的落到库里');

    // 唯一索引真的恢复了唯一性约束（补回的 DDL 不是「建了个同名普通索引」）
    const uniqueSql = await db.$queryRawUnsafe<{ sql: string }[]>(
      `SELECT sql FROM sqlite_master WHERE type='index' AND name='WorksheetAnswer_responseId_questionId_key'`);
    assert.match(uniqueSql[0].sql, /^CREATE UNIQUE INDEX/);

    const second = await ensureWorksheetTables(db);
    assert.deepEqual(second.created, [], '第二次调用必须什么都不建');
    assert.deepEqual(second.indexesCreated, [], '第二次调用必须什么都不补 —— 否则每次启动都重复建索引');
  } finally {
    await db.$disconnect();
    fs.rmSync(file, { force: true });
  }
});
