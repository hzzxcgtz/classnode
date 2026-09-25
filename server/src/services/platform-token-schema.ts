import type { PrismaClient } from '@prisma/client';

/**
 * ★ 2026-09-25：老库升级路径上的 `PlatformToken` 表 + `Agent.credentialId` 列。
 *
 * 抽成一个函数（而不是像早年的几处那样直接写在 `index.ts` 里）是为了**能被用例真跑一遍** ——
 * 与 `worksheet-schema.ts` 同一个理由：写在 `index.ts` 的启动块里就永远测不到，
 * 而这里错了的症状是「老用户升级之后 token 相关的一切都报 no such table/column」。
 *
 * ── 与 `prisma db push` 的关系 ────────────────────────────────────────────
 *
 * 🔴 **下面那条 `CREATE TABLE` 是逐字抄自 `prisma db push` 在探针库上生成的产物**
 * （`SELECT sql FROM sqlite_master WHERE name='PlatformToken'`），不是照着 schema 手写的。
 * 本仓对这两条路有明确纪律：手写 DDL 必须与 prisma 生成的**逐字一致**，
 * 否则全新安装与升级安装会长成两个不同的库，而两边各自都能跑。
 *
 * ⚠️ **`credentialId` 的外键形状两者不同**，这是 SQLite 的限制，不是疏忽：
 * prisma 生成的是**表级命名约束**
 * （`CONSTRAINT "Agent_credentialId_fkey" FOREIGN KEY (...) REFERENCES ... ON DELETE RESTRICT`），
 * 而 `ALTER TABLE ADD COLUMN` **造不出表级约束**，只能给列级 `REFERENCES`。
 * ⇒ 语义相同（`ON DELETE RESTRICT` 两边都生效），差的是一个约束名。
 * 选择**补上列级 `REFERENCES`** 而不是干脆不加：不补的话，全新安装会拦、升级安装不会，
 * 而「同一个操作在两台机器上行为不同」比「两边都不拦」更难查。
 *
 * ⚠️ Prisma 生成 DDL 时**不给外键列自动加索引**（要 `@@index` 才加），所以这里也不加。
 */
export async function ensurePlatformTokenSchema(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='PlatformToken'`,
  );
  if (tables.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE TABLE "PlatformToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`);
    console.log('[server] Created PlatformToken table');
  }

  const agentColumns = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Agent')`);
  if (!agentColumns.some((column) => column.name === 'credentialId')) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Agent" ADD COLUMN "credentialId" TEXT REFERENCES "PlatformToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
    console.log('[server] Added credentialId column to Agent');
  }
}
