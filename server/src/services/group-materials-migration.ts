import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * 「按组的课堂材料」的结构迁移（见 specs/2026-09-22-p2-group-materials.md §4.2）。
 *
 * 它做三件事，**顺序不能换**：
 *   ① 建 `ClassroomGroupMaterial` 表；
 *   ② 把 `ClassroomGroup.agentId` 每一行搬成一行 `kind='agent'`；
 *   ③ 把「课堂级网页」在**高级模式**的课堂里实体化成每组一份 ——
 *      ⚠️ 少了这一步就是**行为回归**：改成按组之后，每个组的「没配」都会触发
 *      「不回落」，那些课堂会突然什么都看不到。
 * 然后重建 `ClassroomGroup` 去掉 `agentId` 列。
 *
 * ⚠️ SQLite 不支持 `DROP COLUMN` 到我们需要的程度，所以是**表重建** —— 与
 * `participant-migration.ts:84-114` 同一套范式。那张表被两张子表外键引用，
 * 重建期间必须关掉外键，而 `PRAGMA foreign_keys` **按连接生效且事务内无效**。
 */

type TableInfoRow = { name: string; notnull: number };

const MIGRATION_MARKER = 'classroom-group-materials-migration-v1';

/**
 * 纯探测：`ClassroomGroup` 上还有没有 `agentId` 列。
 *
 * 抽成纯函数是为了能直接喂两种列形状做正反断言。
 * ⚠️ 空数组（表不存在 / 读不到）**不触发迁移** —— 全新安装的表由 db push 按新
 * schema 建出、本来就没有这一列；「表结构根本不对」是另一种情况，静默重建会掩盖它。
 */
export function needsGroupMaterialsMigration(columns: TableInfoRow[]): boolean {
  if (columns.length === 0) return false;
  return columns.some((column) => column.name === 'agentId');
}

/**
 * 建新表 + 搬数据 + 实体化 + 重建 ClassroomGroup（去掉 agentId）。
 *
 * ⚠️ 顺序是硬的：**实体化必须在 agentId 搬完之后、标记置位之前**。
 * ⚠️ 不得包进 `$transaction`（`PRAGMA foreign_keys` 在事务内无效）。
 */
export async function ensureGroupMaterials(
  prisma: PrismaClient,
  backup: (label: string) => string | null,
): Promise<'skipped' | 'migrated'> {
  const done = await prisma.setting.findUnique({ where: { key: MIGRATION_MARKER } }).catch(() => null);
  if (done) return 'skipped';

  const columns = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('ClassroomGroup')`);
  if (!needsGroupMaterialsMigration(columns)) {
    await prisma.setting.upsert({
      where: { key: MIGRATION_MARKER },
      update: { value: 'skipped' },
      create: { key: MIGRATION_MARKER, value: 'skipped' },
    });
    return 'skipped';
  }

  // 改的是结构 + 搬数据，没有备份就没有回滚依据 ⇒ 失败必须中止。
  const backupPath = backup('classroom-group-materials');
  if (!backupPath) throw new Error('[server] 课堂材料迁移中止：备份失败，未改动任何表结构');
  console.log(`[server] Database backup created: ${backupPath}`);

  // ① 建新表。DDL 逐字取自「在临时库上 db push 后 dump 出来的权威输出」
  //    （计划 Task 1 Step 1）。**必须与 Prisma 的输出逐字一致** —— 否则桌面版
  //    下次 db push 会再重建一次，而按 table_info 探测的同步块不会重跑，两边分叉。
  // ⚠️ 下面这几段 SQL 的**缩进与换行也是「逐字」的一部分**：SQLite 把 `CREATE TABLE`
  //    的原文存进 `sqlite_master.sql`，闭合括号前多两个空格就会让存储文本与权威 DDL
  //    出现差异（`db push` 后的 dump 是 `)` 顶格）。改这几段时不要顺手重排缩进。
  await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomGroupMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomGroupMaterial_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ClassroomGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroupMaterial_kind_targetId_idx" ON "ClassroomGroupMaterial"("kind", "targetId")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomGroupMaterial_groupId_kind_key" ON "ClassroomGroupMaterial"("groupId", "kind")`);

  // ② 搬 agentId。⚠️ `@default(uuid())` 是 **Prisma 客户端**生成的，
  //    手写 SQL 必须自己给 id —— 所以逐行在 JS 里生成，不用 SQL 拼 uuid。
  //    量级是「每节课每组一行」，几十行，逐条没有性能问题，
  //    而 SQL 拼出来的 uuid 格式一旦与客户端不同，会带来很难查的后续问题。
  const legacyGroups = await prisma.$queryRawUnsafe<{ id: string; agentId: string | null }[]>(
    `SELECT "id", "agentId" FROM "ClassroomGroup"`,
  );
  for (const group of legacyGroups) {
    if (!group.agentId) continue;
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "ClassroomGroupMaterial" ("id","groupId","kind","targetId") VALUES (?, ?, 'agent', ?)`,
      randomUUID(), group.id, group.agentId,
    );
  }

  // ③ 实体化：高级模式 + 有课堂级网页 ⇒ 给它的**每个组**写一行 kind='webapp'。
  //    少了这一步，改成按组之后每个组都会「没配」⇒ 触发「不回落」⇒ 已经存在的
  //    课堂突然什么都看不到。这是**行为回归**，不是清理。
  //    判据是 `Classroom.mode = 'advanced'`；标准/分组模式继续用课堂级网页，不动。
  //
  // ⚠️ 两处必须**先探测再查**，不能直接写进 SQL：
  //    · `Classroom.mode` 不是 index.ts 的同步块补的列之一（见 index.ts:357-379），
  //      老库可能没有它。schema 里它是 `@default("standard")` ⇒「没有这一列」在语义上
  //      就等于「全部标准模式」，此时不该实体化。
  //    · `ClassroomWebapp` 比 `ClassroomGroup` 晚出现，老库里可能整张表都没有 ⇒
  //      没有课堂级网页也就没有可实体化的东西。
  //    硬查会抛错，而 index.ts 对这条迁移是 rethrow 的 ⇒ **老库升上来服务直接起不来**。
  const classroomColumns = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('Classroom')`);
  const hasModeColumn = classroomColumns.some((column) => column.name === 'mode');
  const classroomWebappTable = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ClassroomWebapp'`,
  );
  if (hasModeColumn && classroomWebappTable.length > 0) {
    const advancedWithWebapp = await prisma.$queryRawUnsafe<{ classroomId: string; webappId: string }[]>(
      `SELECT c."id" AS classroomId, cw."webappId" AS webappId
         FROM "Classroom" c
         JOIN "ClassroomWebapp" cw ON cw."classroomId" = c."id"
        WHERE c."mode" = 'advanced'`,
    );
    for (const row of advancedWithWebapp) {
      const groups = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "ClassroomGroup" WHERE "classroomId" = ?`, row.classroomId,
      );
      for (const group of groups) {
        await prisma.$executeRawUnsafe(
          `INSERT OR IGNORE INTO "ClassroomGroupMaterial" ("id","groupId","kind","targetId") VALUES (?, ?, 'webapp', ?)`,
          randomUUID(), group.id, row.webappId,
        );
      }
    }
  } else {
    console.log('[server] Classroom 无 mode 列或无 ClassroomWebapp 表，跳过网页实体化（等价于无课堂级网页）');
  }

  // ④ 重建 ClassroomGroup 去掉 agentId。
  // ⚠️ 顺序必须 DROP 旧表 → RENAME 新表（不能反过来）：SQLite ≥3.25 的
  //    ALTER TABLE ... RENAME 会改写其它表里指向被改表名的 REFERENCES 子句，
  //    先 RENAME 旧表会把子表的外键指到一个临时表名上。
  // ⚠️ 必须走 INSERT SELECT 把列显式列出来（重建后列少了）。
  // ⚠️ 不得包进 $transaction —— `PRAGMA foreign_keys` 在事务内无效，而这张表
  //    被 ClassroomStudent（ON DELETE SET NULL）与 ClassroomGroupMember
  //    （ON DELETE CASCADE）引用，pragma 没生效时 DROP TABLE 的隐式 DELETE
  //    会**静默毁掉子表数据**。
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE "new_ClassroomGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceClassGroupId" TEXT,
    CONSTRAINT "ClassroomGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "new_ClassroomGroup" ("id","classroomId","name","sourceClassGroupId")
      SELECT "id","classroomId","name","sourceClassGroupId" FROM "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "new_ClassroomGroup" RENAME TO "ClassroomGroup"`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId")`);
  } finally {
    await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  }

  await prisma.setting.upsert({
    where: { key: MIGRATION_MARKER },
    update: { value: 'completed' },
    create: { key: MIGRATION_MARKER, value: 'completed' },
  });
  console.log('[server] Classroom group materials migration complete');
  return 'migrated';
}
