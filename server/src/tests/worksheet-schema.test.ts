import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ensureWorksheetAnswerColumns, ensureWorksheetTables } from '../services/worksheet-schema.js';

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

/** 比对用的归一化：只允许差一个行尾分号（以及缩进/换行）。 */
function normalizeDdl(sql: string): string {
  return sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
}

/**
 * 🔴 **手写 DDL 必须与 `prisma db push` 的产物逐表逐字一致。**
 *
 * `worksheet-schema.ts` 的注释把这条写成了规矩，但在此之前**没有任何东西在检查它** ——
 * 规矩靠人记得。而漏掉一个类型的表现是：桌面版下次 `db push` 认为库与 schema 不一致，
 * **静默重建这张表**；同时 `index.ts` 里按 `sqlite_master` 探测的同步块**不会重跑**
 * （表还在），两边从此分叉。
 *
 * 判据的来源是 `before()` 里那个用**当前** `schema.prisma` `db push` 出来的模板库 ——
 * 所以改 `schema.prisma` 而不同步 `worksheet-schema.ts`，这条用例就红。
 * （M4a 实测抓到过一次：`Float` 在 SQLite 上 db push 写的是 `REAL`，
 * 而规格里那段手写的是 `DOUBLE PRECISION`。）
 */
test('🔴 手写建表 DDL 与 prisma db push 的产物逐表逐字一致（差一个类型下次 db push 就重建）', async () => {
  const { db, file } = makeCopy('ddl');
  const template = new PrismaClient({ datasources: { db: { url: `file:${TEMPLATE_DB}` } } });
  try {
    // 把 4 张表删掉，再让被测函数按手写 DDL 建回来 —— 比的是「建出来的东西」，
    // 不是「文件里写了什么字符串」。
    for (const t of DROP_ORDER) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    }
    await ensureWorksheetTables(db);

    const names = [...WORKSHEET_TABLES, ...INDEX_NAMES];
    const placeholders = names.map(() => '?').join(', ');
    const read = async (client: PrismaClient): Promise<Map<string, string>> => {
      const rows = await client.$queryRawUnsafe<{ name: string; sql: string }[]>(
        `SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name IN (${placeholders})`,
        ...names,
      );
      return new Map(rows.map((row) => [row.name, row.sql]));
    };

    const ours = await read(db);
    const theirs = await read(template);

    // 前置条件：**两边都要有全部 10 项**。少一项就跳过比对的话，这条用例会在
    // 「表根本没建出来」时静默通过 —— 那正是它要挡的东西。
    assert.deepEqual([...ours.keys()].sort(), [...names].sort(), '手写 DDL 应建出 4 张表 + 6 个索引');
    assert.deepEqual([...theirs.keys()].sort(), [...names].sort(), 'db push 的产物里也应有这 10 项');

    for (const name of names) {
      assert.equal(
        normalizeDdl(ours.get(name) ?? ''),
        normalizeDdl(theirs.get(name) ?? ''),
        `「${name}」的手写 DDL 与 prisma db push 的产物不一致 —— ` +
        '桌面版下次 db push 会重建它，而 index.ts 里按 sqlite_master 探测的同步块不会重跑，两边分叉。' +
        '修法：把 db push 的输出逐字抄回 worksheet-schema.ts 的 TABLES。',
      );
    }
  } finally {
    await db.$disconnect();
    await template.$disconnect();
    fs.rmSync(file, { force: true });
  }
});

/**
 * 🔴 **加列 + 回填旧行**（M4a）。
 *
 * 这条用例存在的理由是两个「错了不报错」的性质：
 *   1. 不回填 ⇒ 升级后所有历史作答的 `gradeState` 都是 null ⇒ 看板把它们当成
 *      「没判过」⇒ **正确率的分母凭空变小**，而屏幕上没有任何东西变红；
 *   2. 回填的 `WHERE` 少了 `gradeState IS NULL` ⇒ 每次启动都把新判的 `partial`
 *      覆盖成 `correct`/`incorrect` ⇒ 半对从此消失，看起来只是「分算错了」。
 *
 * 库的形状用 `ALTER TABLE … DROP COLUMN` 造（SQLite 3.35+）：模板库是**新**形状，
 * 而这里要的是**升级前**的形状。比手抄一份老 DDL 更可靠 —— 手抄的那份会随
 * `schema.prisma` 一起漂。
 */
test('🔴 加列 + 回填：旧行的 gradeState 由 isCorrect 派生；再次调用不覆盖新判的分', async () => {
  const { db, file } = makeCopy('cols');
  try {
    // 造「升级前」的形状：把两列删掉（索引不受影响，它们在别的列上）。
    for (const column of ['gradeState', 'score']) {
      await db.$executeRawUnsafe(`ALTER TABLE "WorksheetAnswer" DROP COLUMN "${column}"`);
    }
    const legacyCols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
    assert.deepEqual(
      legacyCols.map((c) => c.name).filter((name) => name === 'gradeState' || name === 'score'),
      [],
      '前置条件：两列都应已不在（这才是升级前的形状）',
    );

    // 放进三种旧行：判对、判错、以及**从来没判过**（未作答 / 关了自动判分）。
    // ⚠️ 父行必须真造出来：`WorksheetResponse` 的外键指向 Classroom 与 ClassroomStudent，
    // 而 SQLite 的连接默认开着 `foreign_keys`（外键失败是 `FOREIGN KEY constraint failed`）。
    // 这两个模型的标量列里只有 `ClassroomStudent.classroomId` 没有默认值。
    await db.$executeRawUnsafe(`INSERT INTO "Classroom" ("id") VALUES ('c1')`);
    await db.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId") VALUES ('p1','c1')`);
    await db.$executeRawUnsafe(
      `INSERT INTO "Worksheet" ("id","title","content","settings","updatedAt") VALUES ('w1','t','{}','{}',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetResponse" ("id","classroomId","worksheetId","participantId","status","updatedAt")
       VALUES ('r1','c1','w1','p1','submitted',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetAnswer" ("id","responseId","questionId","status","isCorrect") VALUES
         ('a_right','r1','q1','submitted',1),
         ('a_wrong','r1','q2','submitted',0),
         ('a_ungraded','r1','q3','submitted',NULL)`);

    const first = await ensureWorksheetAnswerColumns(db);
    assert.deepEqual(first.columnsAdded.sort(), ['gradeState', 'score'], '两列都应被补上');
    assert.equal(first.backfilled, 2, '只有 isCorrect 非空的那两行该被回填');

    const rows = await db.$queryRawUnsafe<{ id: string; gradeState: string | null; score: number | null }[]>(
      `SELECT "id","gradeState","score" FROM "WorksheetAnswer" ORDER BY "id"`);
    assert.deepEqual(rows, [
      // ⚠️ `score` **必须是 null**：旧行没有逐题分值，任何写死的数（1？）都是编的 ——
      // 写进去等于声称「全班历史作答每一题都正好值 1 分」，而那个数谁都没填过。
      { id: 'a_right', gradeState: 'correct', score: null },
      { id: 'a_ungraded', gradeState: null, score: null },
      { id: 'a_wrong', gradeState: 'incorrect', score: null },
    ]);

    // 列的类型必须是 `REAL`：Prisma 的 `Float` 落库写的就是它，写 `DOUBLE PRECISION`
    // 会让桌面版下一次 `db push` 认为「与 schema 不一致」而静默重建整张表（已实测）。
    const typed = await db.$queryRawUnsafe<{ name: string; type: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
    assert.equal(typed.filter((c) => c.name === 'score')[0]?.type, 'REAL');
    assert.equal(typed.filter((c) => c.name === 'gradeState')[0]?.type, 'TEXT');

    // 幂等：模拟 A2 之后新判的一行（半对），再跑一次启动流程。
    await db.$executeRawUnsafe(
      `UPDATE "WorksheetAnswer" SET "gradeState"='partial', "score"=0.5, "isCorrect"=0 WHERE "id"='a_right'`);
    const second = await ensureWorksheetAnswerColumns(db);
    assert.deepEqual(second.columnsAdded, [], '第二次调用不该重复加列');
    assert.equal(second.backfilled, 0, '第二次调用不该回填任何行');

    const after = await db.$queryRawUnsafe<{ id: string; gradeState: string | null; score: number | null }[]>(
      `SELECT "id","gradeState","score" FROM "WorksheetAnswer" WHERE "id"='a_right'`);
    assert.deepEqual(
      after,
      [{ id: 'a_right', gradeState: 'partial', score: 0.5 }],
      '🔴 幂等：新判的 partial 与 score 不得被回填覆盖（WHERE 少了 gradeState IS NULL 就会）',
    );
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
