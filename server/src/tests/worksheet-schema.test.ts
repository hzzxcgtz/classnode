import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { ensureAnalysisClassroomColumn, ensureWorksheetAnswerColumns, ensureWorksheetTables } from '../services/worksheet-schema.js';

/**
 * 5 张新表 —— 也是「老库形状」的判据。
 * 🔴 这几行是**硬编**的：往 `worksheet-schema.ts` 的 `TABLES` 里加一张表而忘了加到这里，
 * 那条「逐字对拍」用例会**一个字都不检查**它（比对只遍历本数组）—— 加表时三处一起改：
 * 本数组 · `DROP_ORDER` · `INDEX_NAMES`，外加第一条用例里那个 `tbl_name IN (...)` 查询。
 */
const WORKSHEET_TABLES = ['Worksheet', 'ClassroomWorksheet', 'WorksheetResponse', 'WorksheetAnswer', 'WorksheetQuestionAnalysis'];
/** 逆外键依赖顺序：先删引用方，最后删被引用方。 */
const DROP_ORDER = ['WorksheetQuestionAnalysis', 'WorksheetAnswer', 'WorksheetResponse', 'ClassroomWorksheet', 'Worksheet'];
/** 7 个具名索引 —— 名字必须与 worksheet-schema.ts 里的定义逐一对应。 */
const INDEX_NAMES = [
  'ClassroomWorksheet_worksheetId_idx',
  'ClassroomWorksheet_classroomId_worksheetId_key',
  'WorksheetResponse_classroomId_idx',
  'WorksheetResponse_classroomId_worksheetId_participantId_key',
  'WorksheetAnswer_responseId_idx',
  'WorksheetAnswer_responseId_questionId_key',
  'WorksheetQuestionAnalysis_classroomId_worksheetId_questionId_key',
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
 * DROP 掉那 5 张表**得到「老库形状」。为什么不直接用 `db push` 的产物：那种库里 5 张表
 * 天生就是新形状，拿它测建表**永远绿**，而真实老库仍然是坏的。
 *
 * 🔴 全程只碰 /tmp，绝不碰 `server/prisma/dev.db`。
 */
before(() => {
  assert.ok(fs.existsSync(SCHEMA_SRC), `找不到 schema.prisma：${SCHEMA_SRC}`);
  assert.ok(fs.existsSync(PRISMA_BIN), `找不到 prisma CLI：${PRISMA_BIN}`);
  fs.copyFileSync(SCHEMA_SRC, SCHEMA_COPY);
  prepareTemporarySqliteFile(`file:${TEMPLATE_DB}`);
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

test('在缺表的库上建出 5 张表，且第二次调用不重复建', async () => {
  const { db, file } = makeCopy('legacy');
  try {
    // 先制造「老库」形状：确保 5 张表都不存在（副本上操作，安全）
    for (const t of DROP_ORDER) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    }
    const before_ = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.deepEqual(before_, [], '前置条件：5 张新表在副本上都应已被删掉');

    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created.sort(), [...WORKSHEET_TABLES].sort(),
      '建出的表名集合必须与 WORKSHEET_TABLES 完全一致（原先这里另抄了一份 4 个名字的字面量 —— 加表时它不漏红，只会与上面那两行断言打架）');
    assert.deepEqual(first.indexesCreated.sort(), [...INDEX_NAMES].sort(), '建表时 7 个具名索引应一并建出');

    const second = await ensureWorksheetTables(db);
    assert.deepEqual(second.created, [], '第二次调用必须什么都不建');
    assert.deepEqual(second.indexesCreated, [], '第二次调用必须不重复建索引');

    // 建表顺序与 prisma db push 的输出一致
    // （Worksheet 无依赖 → ClassroomWorksheet → WorksheetResponse → WorksheetAnswer → WorksheetQuestionAnalysis）
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
         AND tbl_name IN ('ClassroomWorksheet','WorksheetResponse','WorksheetAnswer','WorksheetQuestionAnalysis')`);
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
    // 把 5 张表删掉，再让被测函数按手写 DDL 建回来 —— 比的是「建出来的东西」，
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
    assert.deepEqual([...ours.keys()].sort(), [...names].sort(), '手写 DDL 应建出 5 张表 + 7 个索引');
    assert.deepEqual([...theirs.keys()].sort(), [...names].sort(), 'db push 的产物里也应有这 12 项');

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
 *      覆盖成 `correct`/`incorrect` ⇒ 部分给分从此消失，看起来只是「分算错了」。
 *
 * 库的形状用 `ALTER TABLE … DROP COLUMN` 造（SQLite 3.35+）：模板库是**新**形状，
 * 而这里要的是**升级前**的形状。比手抄一份老 DDL 更可靠 —— 手抄的那份会随
 * `schema.prisma` 一起漂。
 *
 * ⚠️ 本条测的是「**本次进程**加了列」那条路；「列已经在、但库里没有标记」那条路
 *（= 桌面版 `db push` 先加列的形状）由下面 `回填的边界` 那条用例单独钉。
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

    // 幂等：模拟 A2 之后新判的一行（部分给分），再跑一次启动流程。
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

/**
 * ★ 2026-09-28：作答活动三列（`createdAt` / `savedAt` / `saveCount`）。
 *
 * 它们是第 3 条（「正在答题的过程」）在服务端唯一的新数据。三条各自都要有**诚实的空值**：
 *   · `createdAt` —— 这一题**第一次**落库的时刻（首次 insert 时写一次，此后不动）；
 *   · `savedAt`   —— **最近一次保存**的时刻。🔴 **提交不推进它**：提交那一次的 `data` 里
 *     没有 `value`（它只改 status / 判分三列），不是一次内容写入。让它推进的话，
 *     学生交完卷什么都不动，「距上次保存」也会显示成「刚刚保存过」—— 一句假话；
 *   · `saveCount` —— 落库次数（同样是**保存**的次数）。
 *
 * 🔴 **旧行一律 NULL，含义是「不知道」**，读的一侧不许把 null 当成「刚刚」或「很久以前」。
 * 这里必须断言它 —— 「顺手写个 0 / now()」是最容易犯的错，而它的表现是
 * 全班历史作答都显示成「刚刚保存过」或者「保存过 0 次」，两句话都是编的。
 *
 * ⚠️ 列的类型必须与建表 DDL 一致（`DATETIME` / `INTEGER`）：写错的后果与
 * `REAL` vs `DOUBLE PRECISION` 那条逐字同源 —— 桌面版下一次 `db push` 会认为
 * 「与 schema 不一致」而**静默重建整张表**（那条注释在 `score` 上已经记过一次）。
 */
test('★ 作答活动三列：补上且类型与 DDL 一致；旧行一律 NULL（不许写 0 / now）', async () => {
  const { db, file } = makeCopy('activity-cols');
  try {
    // 造「升级前」的形状：把这三列删掉。
    for (const column of ['createdAt', 'savedAt', 'saveCount']) {
      await db.$executeRawUnsafe(`ALTER TABLE "WorksheetAnswer" DROP COLUMN "${column}"`);
    }
    const legacy = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
    assert.deepEqual(
      legacy.map((c) => c.name).filter((n) => ['createdAt', 'savedAt', 'saveCount'].includes(n)),
      [],
      '前置条件：三列都应已不在（这才是升级前的形状）',
    );

    await db.$executeRawUnsafe(`INSERT INTO "Classroom" ("id") VALUES ('c1')`);
    await db.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId") VALUES ('p1','c1')`);
    await db.$executeRawUnsafe(
      `INSERT INTO "Worksheet" ("id","title","content","settings","updatedAt") VALUES ('w1','t','{}','{}',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetResponse" ("id","classroomId","worksheetId","participantId","status","updatedAt")
       VALUES ('r1','c1','w1','p1','draft',CURRENT_TIMESTAMP)`);
    // 一段历史作答：它在这次升级之前就存在，谁也不知道它被保存过几次、什么时候保存的。
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetAnswer" ("id","responseId","questionId","status","value") VALUES
         ('a1','r1','q1','draft','{"format":"fill/v1","text":"H2O"}'),
         ('a2','r1','q2','submitted','{"format":"fill/v1","text":"CO2"}')`);

    const first = await ensureWorksheetAnswerColumns(db);
    // ⚠️ 只有这三列 —— `gradeState` / `score` 没被动过（它们的列在本用例里没删），
    // 所以它们**不该**出现在 `columnsAdded` 里。第一版这里写成了五项，是错的。
    assert.deepEqual(first.columnsAdded.slice().sort(), ['createdAt', 'saveCount', 'savedAt']);

    // 🔴 旧行必须是 NULL —— 不是一个顺手写的 0 / 当前时间。
    const rows = await db.$queryRawUnsafe<{ id: string; createdAt: unknown; savedAt: unknown; saveCount: unknown }[]>(
      `SELECT "id","createdAt","savedAt","saveCount" FROM "WorksheetAnswer" ORDER BY "id"`);
    assert.deepEqual(rows, [
      { id: 'a1', createdAt: null, savedAt: null, saveCount: null },
      { id: 'a2', createdAt: null, savedAt: null, saveCount: null },
    ], '🔴 旧行的三列必须是 NULL（「不知道」），不许写 0 或 now()');

    // 类型必须与 `worksheet-schema.ts` 的建表 DDL 一致。
    const typed = await db.$queryRawUnsafe<{ name: string; type: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
    const typeOf = (name: string) => typed.filter((c) => c.name === name)[0]?.type;
    assert.equal(typeOf('createdAt'), 'DATETIME');
    assert.equal(typeOf('savedAt'), 'DATETIME');
    assert.equal(typeOf('saveCount'), 'INTEGER');

    // 幂等：第二次调用不再加列。
    const second = await ensureWorksheetAnswerColumns(db);
    assert.deepEqual(second.columnsAdded, [], '第二次调用不该重复加列');
  } finally {
    await db.$disconnect();
    fs.rmSync(file, { force: true });
  }
});

/**
 * 🔴 **回填只在「第一次」跑，之后永不回头** —— 两层判据各自要挡的东西（B1）。
 *
 * 这条用例钉两件事，缺任何一件都会让回填在**某一条真实路径上**变成死代码或变成凶手：
 *
 * ① **列已经在了，回填照样要跑。** 桌面版的升级路径是
 *    `src-tauri/src/lib.rs` 先 `prisma db push`（`:340`，加出这两列）、**然后**才
 *    spawn 起 Node 服务（`:390`），本函数在服务起来之后才跑 ⇒ 那一刻 `columnsAdded`
 *    **恒为空**。所以「本次进程加了列才回填」这条判据在发行版上会让 M3 的历史作答
 *    **永远补不上**（E1 的「新列是权威」与 D3 的 `score` 兜底都建立在「回填已跑过」之上）。
 *    本用例的样本正是那个形状：模板库先天带两列（`columnsAdded` 为空）而**没有标记**。
 *
 * ② **标记在，就再也不回填。** A2 之后「部分给分」会落成 `isCorrect=false` +
 *    `gradeState=NULL`（B1 才写这两列），它与「M3 老行」在**列上完全同形** ——
 *    没有任何列能把两者区分开。少了标记，任何一次重启都会把它永久钉成
 *    `incorrect`/`score=NULL`，而它此后再也不被回填碰。
 *
 * ⚠️ 反证（brief 硬要求 2）：把标记那道 `if (!done)` 去掉 ⇒ 第 ② 段变红；
 * 把回填改成 `columnsAdded.includes('gradeState') && …` ⇒ 第 ① 段变红。
 */
test('🔴 回填的边界：列已在（桌面版 db push 加的）也要跑；标记写完之后再不回头', async () => {
  const { db, file } = makeCopy('backfill-once');
  try {
    await db.$executeRawUnsafe(`INSERT INTO "Classroom" ("id") VALUES ('c1')`);
    await db.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId") VALUES ('p1','c1')`);
    await db.$executeRawUnsafe(
      `INSERT INTO "Worksheet" ("id","title","content","settings","updatedAt") VALUES ('w1','t','{}','{}',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetResponse" ("id","classroomId","worksheetId","participantId","status","updatedAt")
       VALUES ('r1','c1','w1','p1','submitted',CURRENT_TIMESTAMP)`);

    // 前置条件：模板库先天就有这两列（= 桌面版 db push 之后的形状），且**没有**标记。
    const cols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
    assert.deepEqual(
      cols.map((c) => c.name).filter((n) => n === 'gradeState' || n === 'score').sort(),
      ['gradeState', 'score'],
      '前置条件：模板库天生带这两列（本用例测的就是「列不是本次加的」那条路）',
    );
    assert.equal(await db.setting.count(), 0, '前置条件：还没有任何标记');

    // 一段 M3 历史：`isCorrect` 是那时唯一的信息。
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetAnswer" ("id","responseId","questionId","status","isCorrect") VALUES
         ('a_right','r1','q1','submitted',1),
         ('a_wrong','r1','q2','submitted',0)`);

    // ── ① 列已有 ⇒ 回填**照样**要跑（桌面版升级路径）────────────────────
    const first = await ensureWorksheetAnswerColumns(db);
    assert.deepEqual(first.columnsAdded, [], '前置：这次是「列已经在了」，所以一列都没加');
    assert.equal(
      first.backfilled,
      2,
      '🔴 列不是本次加的，但这是这个库**第一次**具备回填条件 ⇒ 历史行必须补上。' +
      '若这条红了，说明判据被写成了「本次进程加了列才回填」——那在桌面版上是死代码。',
    );

    // ── ② 标记已写 ⇒ 之后新出现的同形行**不许**再被碰 ────────────────────
    // 这一行模拟「A2 之后写进来的部分给分」：与上面两行在列上完全同形
    //（`isCorrect=0` 且 `gradeState IS NULL` 且 `score IS NULL`），**无法靠列区分**。
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetAnswer" ("id","responseId","questionId","status","isCorrect")
       VALUES ('a_partial_after','r1','q3','submitted',0)`);
    const second = await ensureWorksheetAnswerColumns(db);
    assert.deepEqual(second.columnsAdded, []);
    assert.equal(
      second.backfilled,
      0,
      '🔴 标记已经写过 ⇒ 这一行**不许**被回填。红了就说明标记那道 `if` 没了，' +
      '而代价是：任何一次重启都把部分给分永久钉成 incorrect/score=NULL。',
    );
    const afterPartial = await db.$queryRawUnsafe<{ gradeState: string | null; score: number | null }[]>(
      `SELECT "gradeState","score" FROM "WorksheetAnswer" WHERE "id"='a_partial_after'`);
    assert.deepEqual(
      afterPartial,
      [{ gradeState: null, score: null }],
      'A2 形状的行必须**原样留着**（`gradeState` 保持 null，等 B1 之后的写入路径自己填）',
    );

    // 阳性对照：①里补上的历史行确实补对了 —— 否则上面两条可能只是「回填什么都没干」。
    const legacy = await db.$queryRawUnsafe<{ id: string; gradeState: string | null }[]>(
      `SELECT "id","gradeState" FROM "WorksheetAnswer" WHERE "id" IN ('a_right','a_wrong') ORDER BY "id"`);
    assert.deepEqual(legacy, [
      { id: 'a_right', gradeState: 'correct' },
      { id: 'a_wrong', gradeState: 'incorrect' },
    ]);
  } finally {
    await db.$disconnect();
    fs.rmSync(file, { force: true });
  }
});

test('🔴 表在、索引不在的半成品库：按名补回索引，且第二次调用返回空', async () => {
  const { db, file } = makeCopy('half');
  try {
    // 前置条件：表齐（db push 的产物），7 个具名索引由本用例删掉，模拟
    // 「建表成功但建索引失败」的中间态。
    for (const name of INDEX_NAMES) {
      await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
    }
    const gone = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('${INDEX_NAMES.join("','")}')`);
    assert.deepEqual(gone, [], '前置条件：7 个具名索引都应已被删掉');
    const tablesStillThere = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${WORKSHEET_TABLES.join("','")}')`);
    assert.equal(tablesStillThere.length, WORKSHEET_TABLES.length,
      '前置条件：这 5 张表都还在（这正是与上面那条用例的区别）');

    // 这条断言在修复前必定失败：旧实现只按表名探测，表在就 `continue`，
    // 一条索引都不会补，`indexesCreated` 甚至是 undefined。
    const first = await ensureWorksheetTables(db);
    assert.deepEqual(first.created, [], '表已存在，不应重复建表');
    assert.deepEqual(first.indexesCreated.sort(), [...INDEX_NAMES].sort(), '缺的 7 个索引都应被补回');

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

/* ── ★ M7a：给「加 classroomId 之前」那个形状的库补上 ──────────────────── */

/** M7a 中间形状（缺 classroomId）的建表 DDL —— 就是本批 I1 修之前那一版，逐字。 */
const OLD_ANALYSIS_DDL = `CREATE TABLE "WorksheetQuestionAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worksheetId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "payloadKind" TEXT NOT NULL,
    "aggregate" JSONB NOT NULL,
    "coveredCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narrative" TEXT,
    "perStudent" JSONB,
    "agentId" TEXT,
    "model" TEXT,
    CONSTRAINT "WorksheetQuestionAnalysis_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);`;

/** 把某一列是否存在读出来（判据用，不靠"看"）。 */
async function hasColumn(db: PrismaClient, table: string, column: string): Promise<boolean> {
  const cols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('${table}')`);
  return cols.some((c) => c.name === column);
}

test('🔴 M7a 迁移：老形状且**空** ⇒ 删掉重建（新形状带 classroomId）', async () => {
  const { db, file } = makeCopy('analysis-old-empty');
  try {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "WorksheetQuestionAnalysis"`);
    await db.$executeRawUnsafe(OLD_ANALYSIS_DDL);
    assert.equal(await hasColumn(db, 'WorksheetQuestionAnalysis', 'classroomId'), false, '前置：老形状');

    const result = await ensureAnalysisClassroomColumn(db);
    assert.deepEqual(result, { recreated: true, rowCount: 0 });
    await ensureWorksheetTables(db);
    assert.equal(await hasColumn(db, 'WorksheetQuestionAnalysis', 'classroomId'), true, '重建之后必须带新列');
  } finally {
    await db.$disconnect(); fs.rmSync(file, { force: true });
  }
});

test('🔴 M7a 迁移：老形状**有数据** ⇒ 绝不删（宁可响亮地坏）', async () => {
  const { db, file } = makeCopy('analysis-old-data');
  try {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "WorksheetQuestionAnalysis"`);
    await db.$executeRawUnsafe(OLD_ANALYSIS_DDL);
    await db.$executeRawUnsafe(
      `INSERT INTO "Worksheet" ("id","title","content","settings","updatedAt") VALUES ('w1','t','{}','{}',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "WorksheetQuestionAnalysis" ("id","worksheetId","questionId","payloadKind","aggregate","coveredCount","totalCount")
       VALUES ('a1','w1','q1','text','[]',1,2)`);

    const result = await ensureAnalysisClassroomColumn(db);
    assert.deepEqual(result, { recreated: false, rowCount: 1 }, '有数据时不重建，且把行数报出来');
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "WorksheetQuestionAnalysis"`);
    assert.equal(Number(rows[0].n), 1, '数据一行都不许丢');
  } finally {
    await db.$disconnect(); fs.rmSync(file, { force: true });
  }
});

test('M7a 迁移：表不存在 / 已经是新形状 ⇒ 什么都不做', async () => {
  const { db, file } = makeCopy('analysis-noop');
  try {
    // 新形状（模板库就是新形状）
    assert.deepEqual(await ensureAnalysisClassroomColumn(db), { recreated: false, rowCount: 0 });
    // 表不存在
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "WorksheetQuestionAnalysis"`);
    assert.deepEqual(await ensureAnalysisClassroomColumn(db), { recreated: false, rowCount: 0 }, '表不在时不许抛、也不许建');
  } finally {
    await db.$disconnect(); fs.rmSync(file, { force: true });
  }
});
