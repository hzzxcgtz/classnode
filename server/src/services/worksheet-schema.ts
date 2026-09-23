import type { PrismaClient } from '@prisma/client';

/**
 * 4 张新表的建表 DDL。
 *
 * 🔴 **必须与 `prisma db push` 到空库后 dump 出来的输出逐字一致** —— 否则桌面版下次
 * `db push` 会再重建一次，而 `index.ts` 里按 `sqlite_master` 探测的同步块不会重跑，
 * 两边分叉。DDL 来源见规格 §4.1.2（在 /tmp 探针库上 dump，不碰真实库）。
 *
 * 已实测对齐：`DATABASE_URL="file:/tmp/wsv.db" prisma db push --skip-generate` 后
 * `SELECT sql FROM sqlite_master` 的输出与本文件**逐字一致**
 * （差异只有本文件按 SQL 语句补的行尾分号）。改了任何一边都要重新对一次。
 * ⇒ `pnpm test` 里那条「建表产物与 db push 产物逐表逐字相同」的用例就是这条的机器化
 * （`worksheet-schema.test.ts`），改 DDL 忘了同步会红。
 *
 * 🔴 **`"score"` 必须写成 `REAL`，不是 `DOUBLE PRECISION`**：Prisma 对 SQLite 的
 * `Float` 落库时写的就是 `REAL`。实测（`/tmp` 探针库）：用 `DOUBLE PRECISION` 建出来的列，
 * 下一次 `db push` 会被判成「与 schema 不一致」而**静默重建整张表**；写成 `REAL` 时
 * `db push` 原样回一句「The database is already in sync」。两边都实测过，数据都不丢，
 * 但重建是这节课上 40 人 × 20 题那张表不该付的代价。
 * ⚠️ 同理，`server/src/index.ts` 里那条 `ALTER TABLE` 也写 `REAL`（同一个理由）。
 *
 * 建表顺序与 `prisma db push` 的输出一致（Worksheet 无依赖，ClassroomWorksheet 依赖它，
 * WorksheetResponse 依赖 Classroom / Worksheet / ClassroomStudent，WorksheetAnswer 最后）。
 * ⚠️ 这个顺序**不是** SQLite 的要求 —— 它不校验外键目标、允许前向引用；之所以保持，
 * 只是为了与 db push 的输出逐字对齐，从而让上面那条「逐字一致」的比对继续成立。
 */
const TABLES: Array<{ name: string; createTable: string; indexes: Array<{ name: string; sql: string }> }> = [
  {
    name: 'Worksheet',
    createTable: `CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);`,
    indexes: [],
  },
  {
    name: 'ClassroomWorksheet',
    createTable: `CREATE TABLE "ClassroomWorksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomWorksheet_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomWorksheet_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);`,
    indexes: [
      { name: 'ClassroomWorksheet_worksheetId_idx', sql: `CREATE INDEX "ClassroomWorksheet_worksheetId_idx" ON "ClassroomWorksheet"("worksheetId");` },
      { name: 'ClassroomWorksheet_classroomId_worksheetId_key', sql: `CREATE UNIQUE INDEX "ClassroomWorksheet_classroomId_worksheetId_key" ON "ClassroomWorksheet"("classroomId", "worksheetId");` },
    ],
  },
  {
    name: 'WorksheetResponse',
    createTable: `CREATE TABLE "WorksheetResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not-started',
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorksheetResponse_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorksheetResponse_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorksheetResponse_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ClassroomStudent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);`,
    indexes: [
      { name: 'WorksheetResponse_classroomId_idx', sql: `CREATE INDEX "WorksheetResponse_classroomId_idx" ON "WorksheetResponse"("classroomId");` },
      { name: 'WorksheetResponse_classroomId_worksheetId_participantId_key', sql: `CREATE UNIQUE INDEX "WorksheetResponse_classroomId_worksheetId_participantId_key" ON "WorksheetResponse"("classroomId", "worksheetId", "participantId");` },
    ],
  },
  {
    name: 'WorksheetAnswer',
    createTable: `CREATE TABLE "WorksheetAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unanswered',
    "isCorrect" BOOLEAN,
    "gradeState" TEXT,
    "score" REAL,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME,
    CONSTRAINT "WorksheetAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "WorksheetResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);`,
    indexes: [
      { name: 'WorksheetAnswer_responseId_idx', sql: `CREATE INDEX "WorksheetAnswer_responseId_idx" ON "WorksheetAnswer"("responseId");` },
      { name: 'WorksheetAnswer_responseId_questionId_key', sql: `CREATE UNIQUE INDEX "WorksheetAnswer_responseId_questionId_key" ON "WorksheetAnswer"("responseId", "questionId");` },
    ],
  },
];

/**
 * 幂等地建出学习单相关的 4 张表及其 6 个具名索引。
 *
 * 探测用 `sqlite_master` 而不是 `PRAGMA table_info`：这几张是**新表**，
 * 不存在「表在但缺列」的中间态；用表名 / 索引名探测更直接，
 * 也让「第二次调用不重复建」可断言。
 *
 * 🔴 **索引必须与表分开、按名逐个探测**（同 `index.ts` 里 ClassroomModule / ClassroomWebapp /
 * WebappUsage 的做法）：只判断表存在是不够的 —— 那样「表建好但索引创建失败」的中间态
 * （建表成功、建索引时断电/报错）会**永久**缺唯一键，而 `WorksheetResponse` /
 * `WorksheetAnswer` 的 upsert 与关联查询正依赖那几个唯一索引。按名探测后，
 * 这种半成品库能在下次启动自愈。
 *
 * 返回值区分两件事：`created` 只放**表**名，`indexesCreated` 只放**索引**名 ——
 * 合在一起会让调用方无法区分「建了表」与「补了索引」，日志也会说谎。
 *
 * ⚠️ 名字一律**不带引号地**做参数绑定（`?`），不拼进 SQL 字符串 —— 名字列表是常量，
 * 但少一处字符串拼接就少一处将来被改成动态输入的口子。
 */
export async function ensureWorksheetTables(
  prisma: PrismaClient,
): Promise<{ created: string[]; indexesCreated: string[] }> {
  const created: string[] = [];
  const indexesCreated: string[] = [];
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table.name);
    if (rows.length === 0) {
      await prisma.$executeRawUnsafe(table.createTable);
      created.push(table.name);
    }
    if (table.indexes.length === 0) continue;
    const placeholders = table.indexes.map(() => '?').join(', ');
    const found = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN (${placeholders})`,
      ...table.indexes.map((i) => i.name));
    const foundNames = new Set(found.map((i) => i.name));
    for (const index of table.indexes) {
      if (foundNames.has(index.name)) continue;
      await prisma.$executeRawUnsafe(index.sql);
      indexesCreated.push(index.name);
    }
  }
  if (created.length > 0) console.log(`[server] 学习单表已创建：${created.join(', ')}`);
  if (indexesCreated.length > 0) console.log(`[server] 学习单索引已创建：${indexesCreated.join(', ')}`);
  return { created, indexesCreated };
}

/**
 * M4a：给**已有库**的 `WorksheetAnswer` 补 `gradeState` / `score` 两列，并把旧行回填。
 *
 * 🔴 **为什么不放在 `index.ts` 里内联**：回填那两条 SQL 有两个「错了不报错」的性质，
 * 而内联在启动流程里**没有任何东西能测它们**。抽到这里之后
 * `worksheet-schema.test.ts` 能在 /tmp 的探针库上真跑一遍（见那两条用例）。
 *
 * 🔴 **列的类型写 `REAL` 而不是 `DOUBLE PRECISION`**：Prisma 对 SQLite 的 `Float` 落库
 * 写的就是 `REAL`（本文件的建表 DDL 也是它）。实测：写 `DOUBLE PRECISION` 的话，
 * 桌面版下一次 `db push` 会认为「与 schema 不一致」而**静默重建这张表**；
 * 写 `REAL` 时 `db push` 回一句「already in sync」、一个字节都不动。两条路都实测过、
 * 数据都不丢，但重建是课上那张 40 人 × 20 题的表不该付的代价。
 *
 * 🔴 **`isCorrect` 只增不改** —— 它是协议字段，全仓 21 行代码在读它（含学生端
 * `use-worksheet-answers.ts` 的 `scoreFromWire`）。改名 ⇒ 前端拿到 `undefined`
 * ⇒ 不画奖励，**且没有任何报错**。这里只加两列，那一列原样留着。
 *
 * ⚠️ 表不存在时**什么都不做**（返回 `columnsAdded: []`）：建表是
 * `ensureWorksheetTables` 的职责，而且 `db push` 出来的新库天生就有这两列。
 */
export async function ensureWorksheetAnswerColumns(
  prisma: PrismaClient,
): Promise<{ columnsAdded: string[]; backfilled: number }> {
  const columnsAdded: string[] = [];
  const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('WorksheetAnswer')`);
  if (cols.length === 0) return { columnsAdded, backfilled: 0 };

  if (!cols.some((c) => c.name === 'gradeState')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorksheetAnswer" ADD COLUMN "gradeState" TEXT`);
    columnsAdded.push('gradeState');
  }
  if (!cols.some((c) => c.name === 'score')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorksheetAnswer" ADD COLUMN "score" REAL`);
    columnsAdded.push('score');
  }

  // 🔴 **回填**：旧行的 `isCorrect` 是那时**全部**的信息（当时没有半对）。不回填的话，
  // 升级后所有历史作答的 `gradeState` 都是 null ⇒ 看板把它们当成「没判过」
  // ⇒ 正确率的分母凭空变小，且没有任何报错。
  //
  // ⚠️ `WHERE gradeState IS NULL AND isCorrect IS NOT NULL` 是**幂等的关键**：
  // 每次启动都会跑，缺了这两个条件就会把新判的 `partial` 覆盖成 `correct`/`incorrect`
  // —— 半对从此消失，而它看起来只是「分算错了」。
  //
  // ⚠️ **`isCorrect` 不回填成 `score`**：旧行没有逐题分值，任何写死的数（1？）都是编的。
  // `score` 留 null，读的一侧按 `gradeState` 兜底（B1 处理）。写一个 1 进去等于声称
  // 「全班历史作答每一题都正好值 1 分」，而那个数谁都没填过。
  const backfilled = await prisma.$executeRawUnsafe(
    `UPDATE "WorksheetAnswer" SET "gradeState" = CASE WHEN "isCorrect" THEN 'correct' ELSE 'incorrect' END
     WHERE "gradeState" IS NULL AND "isCorrect" IS NOT NULL`,
  );
  if (columnsAdded.length > 0) console.log(`[server] 学习单作答表已加列：${columnsAdded.join(', ')}`);
  if (backfilled > 0) console.log(`[server] 学习单作答表已回填 gradeState：${backfilled} 行`);
  return { columnsAdded, backfilled };
}
