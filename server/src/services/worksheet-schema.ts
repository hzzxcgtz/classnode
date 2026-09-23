import type { PrismaClient } from '@prisma/client';

/**
 * 4 张新表的建表 DDL。
 *
 * 🔴 **必须与 `prisma db push` 到空库后 dump 出来的输出逐字一致** —— 否则桌面版下次
 * `db push` 会再重建一次，而 `index.ts` 里按 `sqlite_master` 探测的同步块不会重跑，
 * 两边分叉。DDL 来源见规格 §4.1.2（在 /tmp 探针库上 dump，不碰真实库）。
 *
 * 已实测对齐：`DATABASE_URL="file:/tmp/wsv.db" prisma db push --skip-generate` 后
 * `SELECT sql FROM sqlite_master` 的输出与规格 §4.1.2、与本文件**逐字一致**
 * （差异只有本文件按 SQL 语句补的行尾分号）。改了任何一边都要重新对一次。
 *
 * 建表顺序 = 外键依赖顺序：Worksheet 无依赖，ClassroomWorksheet 依赖它，
 * WorksheetResponse 依赖 Classroom / Worksheet / ClassroomStudent，WorksheetAnswer 最后。
 */
const TABLES: Array<{ name: string; statements: string[] }> = [
  {
    name: 'Worksheet',
    statements: [
      `CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);`,
    ],
  },
  {
    name: 'ClassroomWorksheet',
    statements: [
      `CREATE TABLE "ClassroomWorksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomWorksheet_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomWorksheet_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);`,
      `CREATE INDEX "ClassroomWorksheet_worksheetId_idx" ON "ClassroomWorksheet"("worksheetId");`,
      `CREATE UNIQUE INDEX "ClassroomWorksheet_classroomId_worksheetId_key" ON "ClassroomWorksheet"("classroomId", "worksheetId");`,
    ],
  },
  {
    name: 'WorksheetResponse',
    statements: [
      `CREATE TABLE "WorksheetResponse" (
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
      `CREATE INDEX "WorksheetResponse_classroomId_idx" ON "WorksheetResponse"("classroomId");`,
      `CREATE UNIQUE INDEX "WorksheetResponse_classroomId_worksheetId_participantId_key" ON "WorksheetResponse"("classroomId", "worksheetId", "participantId");`,
    ],
  },
  {
    name: 'WorksheetAnswer',
    statements: [
      `CREATE TABLE "WorksheetAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unanswered',
    "isCorrect" BOOLEAN,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME,
    CONSTRAINT "WorksheetAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "WorksheetResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);`,
      `CREATE INDEX "WorksheetAnswer_responseId_idx" ON "WorksheetAnswer"("responseId");`,
      `CREATE UNIQUE INDEX "WorksheetAnswer_responseId_questionId_key" ON "WorksheetAnswer"("responseId", "questionId");`,
    ],
  },
];

/**
 * 幂等地建出学习单相关的 4 张表。
 *
 * 探测用 `sqlite_master` 而不是 `PRAGMA table_info`：这几张是**新表**，
 * 不存在「表在但缺列」的中间态；用表名探测更直接，也让「第二次调用不重复建」可断言。
 *
 * ⚠️ 表名一律**不带引号地**做参数绑定（`?`），不拼进 SQL 字符串 —— 表名列表是常量，
 * 但少一处字符串拼接就少一处将来被改成动态输入的口子。
 */
export async function ensureWorksheetTables(prisma: PrismaClient): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table.name);
    if (rows.length > 0) continue;
    for (const sql of table.statements) await prisma.$executeRawUnsafe(sql);
    created.push(table.name);
  }
  if (created.length > 0) console.log(`[server] 学习单表已创建：${created.join(', ')}`);
  return { created };
}
