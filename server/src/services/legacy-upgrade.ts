import type { PrismaClient } from "@prisma/client";
import { migrateClassroomParticipants } from './participant-migration.js';
import { ensureGroupMaterials } from './group-materials-migration.js';
import { ensureAnalysisClassroomColumn, ensureWorksheetAnswerColumns, ensureWorksheetTables } from './worksheet-schema.js';
import { ensurePlatformTokenSchema } from './platform-token-schema.js';
import { migratePlatformTokens } from './platform-token-migration.js';
import { migrateWorksheetsToTasks } from './worksheet-task-migration.js';
import { migrateWorksheetPoints } from './worksheet-points-migration.js';
import { migrateWorksheetPromptStyle } from './worksheet-prompt-migration.js';
import { migrateFillBlankToInline } from './worksheet-fill-blank-migration.js';
import { migrateBlankMarkText } from './worksheet-blank-mark-migration.js';

export async function migrateLegacyDatabase(prisma: PrismaClient, backupDatabase: (label: string) => string | null): Promise<void> {
  // 自动同步数据库 schema（兼容旧版数据库缺少新表/列的情况）
  try {
    const dbVersion = await prisma.$queryRawUnsafe<{ version: string }[]>(`SELECT sqlite_version() as version`);
    console.log(`[server] SQLite version: ${dbVersion[0].version}`);

    // 检查学习单的 4 张表是否存在（P1 新增）。
    //
    // 位置与 ClassroomModule / Webapp 同款理由：排在下面前面那些 legacy 条件语句
    // **之前**，这样无论后面哪条老语句抛错（控制流会直接跳到外层 catch），这 4 张表
    // 都已经建好了。只把内层 try/catch 套在末尾挡不住这种「前面先炸」。
    // 可依赖 Classroom / ClassroomStudent 表已存在：那是安装时 `prisma db push`
    // 建的基础 schema，不是本同步块建的（本块建的两张新表都带指向它们的外键）。
    //
    // ⚠️ DDL 在 services/worksheet-schema.ts 里，与 schema.prisma 的定义**逐字对齐**
    // （含外键约束名、索引名、JSONB、updatedAt 无 DEFAULT）。对齐不是靠眼睛：
    // DDL 由 `prisma db push` 到一个空库后 dump sqlite_master 得到，见规格 §4.1.2 与
    // task-A1-report.md 的实测记录。改了 schema 就要同步改那里。
    //
    // 两种分叉的自愈能力**不一样**，别记混：
    //   · **表的形状**不会自愈。`ensureWorksheetTables` 只按表名探测**存在性** ——
    //     列多了少了、外键约束变了，它一概看不出来（表在，就直接跳过）。于是下次
    //     `db push` 会按 schema.prisma 重建表，两边就此不一致。
    //   · **索引会按名自愈**。每张表的索引是逐个按名到 sqlite_master 里查的，
    //     缺哪个补哪个 —— 「表建好了但建索引那一步失败」的中间态能在下次启动补回来。
    try {
      // ★ M7a：**必须在建表之前**跑 —— 它管的是「表在、但形状是旧的（缺 classroomId）」。
      // 建表函数只按表名探测存在性，不管列，所以旧形状不会自愈。
      await ensureAnalysisClassroomColumn(prisma);
      await ensureWorksheetTables(prisma);
    } catch (error) {
      throw error;
    }

    // 检查 ClassroomModule 表是否存在（v1.7 新增）。
    //
    // 位置是刻意的：它排在下面所有 legacy 条件语句**之前**执行，而不是排在它们后面。
    // 原因：缺少这张表的库，恰恰就是会执行下面那些条件 ALTER 的老库，两者失败是相关的。
    // 若把它放在同一个 try 的末尾，前面任一条老语句
    // 抛错都会让控制流直接跳到 catch，块里的 CREATE TABLE 根本没机会被进入 —— 只把一个
    // 内层 try/catch 套在末尾，只能挡住块内自身的部分失败，挡不住这种「前面先炸」。
    // 提前之后，无论后面哪条老语句抛错，这张表都已经建好了。可依赖 Classroom 表已存在：
    // 那是安装时 `prisma db push` 建的基础 schema，不是本同步块建的。
    //
    // 内层 try/catch 仍然保留，防的是块内自身的部分失败（例如建表成功但索引失败），
    // 失败以 warn 留痕点明后果，不静默吞掉。
    try {
      const moduleTable = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='ClassroomModule'`
      );
      if (moduleTable.length === 0) {
        console.log('[server] ClassroomModule table not found, creating...');
        await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomModule" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "classroomId" TEXT NOT NULL,
          "moduleKey" TEXT NOT NULL,
          "state" TEXT NOT NULL DEFAULT 'preview',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ClassroomModule_classroomId_fkey" FOREIGN KEY ("classroomId")
            REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`);
        console.log('[server] ClassroomModule table created');
      }
      // 索引同样按名探测：若曾出现「表建好但索引创建失败」的中间态，可在下次启动自愈。
      // 只判断表存在是不够的——那样中间态会永久缺唯一键，而课堂模块的 upsert 依赖它。
      const moduleIndexes = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ClassroomModule_classroomId_moduleKey_key', 'ClassroomModule_classroomId_idx')`
      );
      const moduleIndexNames = moduleIndexes.map(i => i.name);
      if (!moduleIndexNames.includes('ClassroomModule_classroomId_moduleKey_key')) {
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomModule_classroomId_moduleKey_key" ON "ClassroomModule"("classroomId", "moduleKey")`);
        console.log('[server] ClassroomModule unique index created');
      }
      if (!moduleIndexNames.includes('ClassroomModule_classroomId_idx')) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomModule_classroomId_idx" ON "ClassroomModule"("classroomId")`);
        console.log('[server] ClassroomModule classroomId index created');
      }
    } catch (e) {
      throw e;
    }

    // 检查 Webapp / ClassroomWebapp 表是否存在（探究空间，v1.7 新增）。
    //
    // 位置与 ClassroomModule 同款理由：排在下面前面那些 legacy 条件语句**之前**，
    // 这样无论后面哪条老语句抛错，这两张表都已经建好了。
    // 依赖「Classroom 表已存在」—— 那是安装时 prisma db push 建的基础 schema。
    //
    // ⚠️ 下面的 DDL 与 schema.prisma 里 Webapp / ClassroomWebapp 的定义**逐字对齐**
    // （含外键约束名与索引名）。改了 schema 就要同步改这里，否则下次 db push 会重建表，
    // 而本同步块按表名探测、不会重跑，两边就此不一致 —— 同 ClassroomModule :194-196 的告诫。
    // 对齐不是靠眼睛：DDL 由 `prisma db push` 到一个空库后 dump sqlite_master 得到，
    // 见 task-3-report.md 的实测记录。
    try {
      const webappTables = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Webapp', 'ClassroomWebapp')`
      );
      const webappTableNames = webappTables.map(t => t.name);
      if (!webappTableNames.includes('Webapp')) {
        console.log('[server] Webapp table not found, creating...');
        await prisma.$executeRawUnsafe(`CREATE TABLE "Webapp" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "entryPath" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        )`);
        console.log('[server] Webapp table created');
      }
      if (!webappTableNames.includes('ClassroomWebapp')) {
        console.log('[server] ClassroomWebapp table not found, creating...');
        await prisma.$executeRawUnsafe(`CREATE TABLE "ClassroomWebapp" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "classroomId" TEXT NOT NULL,
          "webappId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ClassroomWebapp_classroomId_fkey" FOREIGN KEY ("classroomId")
            REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ClassroomWebapp_webappId_fkey" FOREIGN KEY ("webappId")
            REFERENCES "Webapp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`);
        console.log('[server] ClassroomWebapp table created');
      }
      // 索引同样按名探测（同 ClassroomModule）：只判断表存在不够 —— 那样
      // 「表建好但索引创建失败」的中间态会永久缺唯一键，而关联查询依赖它。
      const webappIndexes = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ClassroomWebapp_classroomId_webappId_key', 'ClassroomWebapp_webappId_idx')`
      );
      const webappIndexNames = webappIndexes.map(i => i.name);
      if (!webappIndexNames.includes('ClassroomWebapp_classroomId_webappId_key')) {
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ClassroomWebapp_classroomId_webappId_key" ON "ClassroomWebapp"("classroomId", "webappId")`);
        console.log('[server] ClassroomWebapp unique index created');
      }
      if (!webappIndexNames.includes('ClassroomWebapp_webappId_idx')) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "ClassroomWebapp_webappId_idx" ON "ClassroomWebapp"("webappId")`);
        console.log('[server] ClassroomWebapp webappId index created');
      }
    } catch (e) {
      throw e;
    }

    // 检查 WebappUsage 表是否存在（探究空间的使用汇总，v1.7 新增）。
    //
    // 为什么不挂在上面那个 Webapp 的 try 里：那样任何一步失败都会让**两条**同步都被
    // 跳过，而两者依赖的东西不同 —— 本表的外键同时指向 Classroom 与 Webapp，
    // 所以它必须排在「Webapp / ClassroomWebapp 已建好」**之后**（同一个 try 里
    // 语句顺序恰好也满足，但拆开才能让失败面各自收窄）。
    //
    // ⚠️ 下面的 DDL 与 schema.prisma 里 WebappUsage 的定义**逐字对齐**（含外键约束名
    // 与三个索引名）。它不是手抄的：由 `DATABASE_URL=file:/tmp/… npx prisma db push`
    // 到一个空库后 `sqlite3 … ".schema WebappUsage"` dump 得到，见 task-5-report.md。
    // 改了 schema 就要照同一条命令重新 dump，否则下次 db push 会重建表，而本同步块
    // 按表名探测、不会重跑，两边就此不一致 —— 同 ClassroomModule :194-196 的告诫。
    try {
      const usageTables = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='WebappUsage'`
      );
      if (usageTables.length === 0) {
        console.log('[server] WebappUsage table not found, creating...');
        await prisma.$executeRawUnsafe(`CREATE TABLE "WebappUsage" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "classroomId" TEXT NOT NULL,
          "webappId" TEXT NOT NULL,
          "studentId" TEXT NOT NULL,
          "durationMs" INTEGER NOT NULL DEFAULT 0,
          "clicks" INTEGER NOT NULL DEFAULT 0,
          "inputs" INTEGER NOT NULL DEFAULT 0,
          "maxDepth" INTEGER NOT NULL DEFAULT 0,
          "reports" INTEGER NOT NULL DEFAULT 0,
          "frameCount" INTEGER NOT NULL DEFAULT 0,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "WebappUsage_classroomId_fkey" FOREIGN KEY ("classroomId")
            REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "WebappUsage_webappId_fkey" FOREIGN KEY ("webappId")
            REFERENCES "Webapp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`);
        console.log('[server] WebappUsage table created');
      }
      // 索引同样按名探测（同 ClassroomModule）：只判断表存在不够 —— 那样
      // 「表建好但索引创建失败」的中间态会永久缺唯一键，而写入依赖它。
      const usageIndexes = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('WebappUsage_classroomId_studentId_webappId_key', 'WebappUsage_classroomId_idx', 'WebappUsage_webappId_idx')`
      );
      const usageIndexNames = usageIndexes.map(i => i.name);
      if (!usageIndexNames.includes('WebappUsage_classroomId_studentId_webappId_key')) {
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "WebappUsage_classroomId_studentId_webappId_key" ON "WebappUsage"("classroomId", "studentId", "webappId")`);
        console.log('[server] WebappUsage unique index created');
      }
      if (!usageIndexNames.includes('WebappUsage_classroomId_idx')) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "WebappUsage_classroomId_idx" ON "WebappUsage"("classroomId")`);
        console.log('[server] WebappUsage classroomId index created');
      }
      if (!usageIndexNames.includes('WebappUsage_webappId_idx')) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "WebappUsage_webappId_idx" ON "WebappUsage"("webappId")`);
        console.log('[server] WebappUsage webappId index created');
      }
    } catch (e) {
      throw e;
    }

    // 创建缺失的表和字段（不同 Prisma schema 版本间迁移）
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' AND name='Avatar'`);
    if (tables.length === 0) {
      console.log('[server] Avatar table not found, creating...');
      await prisma.$executeRawUnsafe(`CREATE TABLE "Avatar" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "svgContent" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'student',
        "gender" TEXT NOT NULL DEFAULT 'neutral',
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "source" TEXT NOT NULL DEFAULT 'teacher',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('[server] Avatar table created');
    }

    // ★ M7b：`Agent.purpose`（`tutoring` / `analysis`）。
    // ⚠️ 必须带 DEFAULT —— SQLite 的 ALTER 加不了「NOT NULL 且无默认值」的列。
    const agentCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Agent')`);
    if (!agentCols.map(c => c.name).includes('purpose')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Agent" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'tutoring'`);
      console.log('[server] Added purpose column to Agent');
    }

    // 检查 Student 表是否有新列
    const studentCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Student')`);
    const studentColNames = studentCols.map(c => c.name);
    if (!studentColNames.includes('avatarId')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Student" ADD COLUMN "avatarId" INTEGER REFERENCES "Avatar"("id")`);
      console.log('[server] Added avatarId column to Student');
    }
    if (!studentColNames.includes('avatarChangeTokens')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Student" ADD COLUMN "avatarChangeTokens" INTEGER NOT NULL DEFAULT 0`);
      console.log('[server] Added avatarChangeTokens column to Student');
    }
    if (!studentColNames.includes('gender')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Student" ADD COLUMN "gender" TEXT`);
      console.log('[server] Added gender column to Student');
    }

    // 检查 Class 表是否有 avatarId 列
    const classCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Class')`);
    if (!classCols.map(c => c.name).includes('avatarId')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Class" ADD COLUMN "avatarId" INTEGER REFERENCES "Avatar"("id")`);
      console.log('[server] Added avatarId column to Class');
    }

    // 检查 TeacherNotification 表是否存在（v1.4.6 新增）
    const notifTable = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' AND name='TeacherNotification'`);
    if (notifTable.length === 0) {
      console.log('[server] TeacherNotification table not found, creating...');
      await prisma.$executeRawUnsafe(`CREATE TABLE "TeacherNotification" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "classroomId" TEXT NOT NULL REFERENCES "Classroom"("id") ON DELETE CASCADE,
        "studentId" TEXT,
        "content" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "TeacherNotification_classroomId_createdAt_idx" ON "TeacherNotification"("classroomId", "createdAt")`);
      console.log('[server] TeacherNotification table created');
    } else {
      // 检查是否有 groupId 列（v1.4.6 新增）
      const notifCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('TeacherNotification')`);
      if (!notifCols.map(c => c.name).includes('groupId')) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "TeacherNotification" ADD COLUMN "groupId" TEXT`);
        console.log('[server] Added groupId column to TeacherNotification');
      }
    }

    // 检查 Classroom 表是否有 allowStudentExport 列
    const classroomCols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Classroom')`);
    const classroomColNames = classroomCols.map(c => c.name);
    if (!classroomColNames.includes('allowStudentExport')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "allowStudentExport" BOOLEAN NOT NULL DEFAULT 1`);
      console.log('[server] Added allowStudentExport column to Classroom');
    }
    // 探究空间的三项按课堂设置（P2.2）。默认值 = 改动前的行为（开、320 宽、10 秒）。
    if (!classroomColNames.includes('webappCaptureEnabled')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "webappCaptureEnabled" BOOLEAN NOT NULL DEFAULT 1`);
      console.log('[server] Added webappCaptureEnabled column to Classroom');
    }
    if (!classroomColNames.includes('webappThumbnailWidth')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "webappThumbnailWidth" INTEGER NOT NULL DEFAULT 320`);
      console.log('[server] Added webappThumbnailWidth column to Classroom');
    }
    if (!classroomColNames.includes('webappFrameIntervalMs')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "webappFrameIntervalMs" INTEGER NOT NULL DEFAULT 10000`);
      console.log('[server] Added webappFrameIntervalMs column to Classroom');
    }
    // ★ 2026-09-25：详情档的教师覆盖值。**这一列刻意可空，且默认 NULL** ——
    // `NULL` = 没调过 ⇒ 详情档按基准派生（P2.2 的原行为）。
    // ⚠️ **不要给它 `DEFAULT 2000`**：那会让所有老课堂的详情档从「跟随基准」变成固定 2 秒
    //    —— 基准 30 秒的慢设备课堂会因此被**静默提速三倍**，而那是教师当初特意避开的。
    //    （与上面三列方向相反：那三列是「认不出就当默认」，这一列是「认不出就当没调过」。）
    if (!classroomColNames.includes('webappDetailIntervalMs')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "webappDetailIntervalMs" INTEGER`);
      console.log('[server] Added webappDetailIntervalMs column to Classroom');
    }
    // ★ 2026-09-25：是否允许学生提问。默认**允许**（`DEFAULT 1`）—— 与
    // `allowStudentStop` / `allowStudentExport` 同一方向（认不出就当开）。
    // ⚠️ 若这里写成 0，所有老课堂会**静默地禁止学生提问**，而教师端那条开关显示「关」，
    //    看起来像是他自己关的。
    if (!classroomColNames.includes('allowStudentAsk')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "allowStudentAsk" BOOLEAN NOT NULL DEFAULT 1`);
      console.log('[server] Added allowStudentAsk column to Classroom');
    }
    // M5a：课堂级「锁定作答」。默认未锁定 ⇒ `DEFAULT 0`（布尔列的先例见上面几行）。
    if (!classroomColNames.includes('answersLocked')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "answersLocked" BOOLEAN NOT NULL DEFAULT 0`);
      console.log('[server] Added answersLocked column to Classroom');
    }
    // ★ 2026-09-30：课堂级「逐题开放」（学习单 `answerMode: 'manual'` 那一档）。
    // 🔴 **可空、无默认值**（与上面几列方向相反）—— 老课堂读出来是 NULL，而 NULL 的含义
    //    是「一份单都没开放过」：那正是这个新功能在老课堂里该有的样子。
    //    给个 `DEFAULT '{}'` 看着更整齐，但那就等于宣称「已经开过一次了」，而两种说法
    //    在代码里是同一个分支 —— 多一个会漂的表示没有任何收益。
    // ⚠️ 类型写 `JSONB`：Prisma 给 SQLite 的 Json 列发的就是它（见 `.schema Worksheet`
    //    的 content/settings）。写成 TEXT 照样能跑，只是两份 DDL 从此长得不一样。
    if (!classroomColNames.includes('worksheetOpen')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "worksheetOpen" JSONB`);
      console.log('[server] Added worksheetOpen column to Classroom');
    }

    // M4a：三态判分结果与数值得分（规格 §12）——加列 + 回填旧行。
    // ⚠️ 实现在 `services/worksheet-schema.ts` 里（**不是**内联在这儿）：那两列的类型
    // 与那句回填各有一个「错了不报错」的性质，内联在启动流程里就没有任何东西测得动它们。
    // 抽出去之后 `worksheet-schema.test.ts` 能在 /tmp 的探针库上真跑一遍。
    // 细节理由见那个函数的注释（`REAL` 而不是 `DOUBLE PRECISION`、`isCorrect` 只增不改、
    // 回填不写 `score` 的由头）。
    await ensureWorksheetAnswerColumns(prisma);
    // ★ 2026-09-25：共享 API Token（`PlatformToken` 表 + `Agent.credentialId` 列）。
    // ⚠️ 必须在这个 try 块里、且在下面那条迁移**之前** —— 迁移要写的就是这张表。
    await ensurePlatformTokenSchema(prisma);
  } catch (e) {
    throw e;
  }

  // ★ 2026-09-25：把现有 Coze 低代码智能体的 Token 抽成共享的 `PlatformToken`。
  // 与参与者迁移**没有顺序依赖**（它只碰 `Agent` 与 `PlatformToken`），但它依赖上面那次
  // `ensurePlatformTokenSchema` —— 所以排在这里（schema 同步之后）。
  // ⚠️ 备份 + 完成标记的做法与下面那条逐字相同：动的是**凭据**，出问题要能退回上一个库。
  try {
    const tokenMigrationKey = 'platform-token-migration-v1';
    const tokenMigrationDone = await prisma.setting.findUnique({ where: { key: tokenMigrationKey } });
    if (!tokenMigrationDone) {
      const backupPath = backupDatabase('platform-token-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    const migrated = await migratePlatformTokens(prisma);
    if (!tokenMigrationDone) {
      await prisma.setting.upsert({ where: { key: tokenMigrationKey }, update: { value: 'completed' }, create: { key: tokenMigrationKey, value: 'completed' } });
    }
    // ⚠️ 只在**真的做了事**时打日志：这个方法每次启动都会跑（幂等），
    //    每次都打一行「已迁移 0 份」只会让日志里全是噪声，真出问题时更难找。
    if (migrated.tokens > 0 || migrated.linked > 0) {
      console.log(`[server] Platform token migration: ${migrated.tokens} 份凭据，${migrated.linked} 个智能体接上`);
    }
  } catch (e) {
    console.error('[server] Platform token migration failed:', e);
    throw e;
  }

  // ★ 2026-09-25：**学习单任务制** —— 把现有平铺的题包进一个「任务一」容器。
  // 教师裁定 ④a。做法与上面那条逐字相同（备份 + 完成标记 + 幂等）。
  //
  // 🔴 为什么要备份：它动的是**每一份已有学习单的 `content`**，而那个字段的四个下游
  //（学生端面板 / 看板矩阵 / 导出 / M7a 分析载荷）全都按「`content` 是一列题」写的。
  // 迁移**只包一层、不改任何 id**，所以老作答仍然对得上 —— 但那是推理，备份才是退路。
  //
  // ⚠️ 迁移函数**自己**的幂等判据是「顶层还有没有非 task 的节点」，不依赖这个标记；
  //    标记只用来决定**要不要再备份一次**（与参与者迁移同一个理由：不给同一件事反复留档）。
  try {
    const taskMigrationKey = 'worksheet-task-migration-v1';
    const taskMigrationDone = await prisma.setting.findUnique({ where: { key: taskMigrationKey } });
    if (!taskMigrationDone) {
      const backupPath = backupDatabase('worksheet-task-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    const taskMigrated = await migrateWorksheetsToTasks(prisma);
    if (!taskMigrationDone) {
      await prisma.setting.upsert({ where: { key: taskMigrationKey }, update: { value: 'completed' }, create: { key: taskMigrationKey, value: 'completed' } });
    }
    // ⚠️ 只在**真的迁了**时打日志：它每次启动都会跑（幂等），每次都打一行「迁了 0 份」
    //    会让日志里全是噪声，真出问题时更难找。
    if (taskMigrated.migrated > 0) {
      console.log(`[server] Worksheet task migration: ${taskMigrated.migrated} 份学习单已包进任务`);
    }

    // ★ 2026-09-26：把逐题分值**钉住**（教师裁定：学习单级的默认给分不要了）。
    // 与上面那一段逐字同形：备份 + 完成标记 + **只在真的迁了时**打日志。
    // 🔴 迁移函数自己的幂等判据（「还有没有 `points` 为空的题」）与这个标记是**两件事** ——
    // 标记只决定要不要再备份一次（与参与者迁移同一个理由）。
    const pointsMigrationKey = 'worksheet-points-migration-v1';
    const pointsMigrationDone = await prisma.setting.findUnique({ where: { key: pointsMigrationKey } });
    if (!pointsMigrationDone) {
      const backupPath = backupDatabase('worksheet-points-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    const pointsMigrated = await migrateWorksheetPoints(prisma);
    if (!pointsMigrationDone) {
      await prisma.setting.upsert({ where: { key: pointsMigrationKey }, update: { value: 'completed' }, create: { key: pointsMigrationKey, value: 'completed' } });
    }
    if (pointsMigrated.migrated > 0) {
      console.log(`[server] Worksheet points migration: ${pointsMigrated.migrated} 份学习单的逐题分值已钉住`);
    }

    // ★ 2026-09-26：把题干的**整段样式**（`promptStyle`）迁成**分段**（`promptRuns`）——
    // 教师要求「下划线和着重号，并且可以只选择下面的部分文字来设置」。
    // 与上面两段逐字同形：备份 + 完成标记 + **只在真的迁了时**打日志。
    // 🔴 这一步是**格式来源从两个变成一个**的那一半：客户端在那个「临时桥」删掉之后
    // 只认 `promptRuns`，所以本迁移必须在那之前跑过（它每次启动都会跑，幂等）。
    const promptMigrationKey = 'worksheet-prompt-runs-migration-v1';
    const promptMigrationDone = await prisma.setting.findUnique({ where: { key: promptMigrationKey } });
    if (!promptMigrationDone) {
      const backupPath = backupDatabase('worksheet-prompt-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    const promptMigrated = await migrateWorksheetPromptStyle(prisma);
    if (!promptMigrationDone) {
      await prisma.setting.upsert({ where: { key: promptMigrationKey }, update: { value: 'completed' }, create: { key: promptMigrationKey, value: 'completed' } });
    }
    if (promptMigrated.migrated > 0) {
      console.log(`[server] Worksheet prompt migration: ${promptMigrated.migrated} 份学习单的题干格式已转成分段`);
    }

    // ★ 2026-09-26：填空题的**空**从「题干外面一排输入框」迁到「题干文字中间」
    //（教师裁定：「填空是在题目文字中间输入，一道题可以包含多个填空区域」）。
    //
    // 🔴 **这一次与前两次不同：它必须只跑一次。** 前两条迁移的幂等判据本身幂等
    //（「还有没有空着的 `points`」/「还有没有 `promptStyle`」），所以每次启动都跑是安全的；
    // 而这一条的判据**认不出**「一道刚建好、题干写了但还没插空的新填空题」与
    // 「一道老填空题」—— 两者都是「没有空」。照前两次那样每次启动都跑 ⇒
    // **每重启一次就给那道新题多追加一个空**。判据不可靠时，唯一安全的就是只跑一次。
    // ★ 2026-09-26：**接回来了。** 它上面那两条前置条件现在都到了：
    //   · 学生端会把题干里的空画成输入框（spec 第 3 步，`PromptText` 的 `blanks`）；
    //   · 编辑器与判分都认新的答案形状（每空一份，spec 第 4 步）。
    // ⚠️ 它**只跑一次**（完成标记把门）—— 它的幂等判据认不出「刚建好、还没插空的新填空题」
    // 与「一道老填空题」（两者都是「没有空」），照前两条那样每次启动都跑会让新题
    // 每重启一次就多追加一个空。理由写在迁移自己的文件头。
    const fillBlankMigrationKey = 'worksheet-fill-blank-inline-migration-v1';
    const fillBlankDone = await prisma.setting.findUnique({ where: { key: fillBlankMigrationKey } });
    if (!fillBlankDone) {
      const backupPath = backupDatabase('worksheet-fill-blank-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
      const fillBlankMigrated = await migrateFillBlankToInline(prisma);
      await prisma.setting.upsert({ where: { key: fillBlankMigrationKey }, update: { value: 'completed' }, create: { key: fillBlankMigrationKey, value: 'completed' } });
      if (fillBlankMigrated.migrated > 0) {
        console.log(`[server] Worksheet fill-blank migration: ${fillBlankMigrated.migrated} 份学习单的填空已挪进题干`);
      }
    }

    // ★ 2026-09-29：把题干里**老形态的空**（一串下划线）统一成 `{填空域}`。
    //
    // 🔴 它修的是上面那条迁移留下的一个**静默丢数据的 bug**：上一段追加的占位串是
    // `'________'`，而客户端「按文本重新识别空」那条路只认 `{填空域}` ⇒ 教师在题干里
    // 多打一个字，那个空就没了（2026-09-29 探针实测：读库后空数 1、编辑后 0）。
    //
    // ⚠️ 与上面那条**不同的地方**：它**每次启动都跑**（不必只跑一次）——
    // 判据（「带 `blank` 标识、且那一段文字正好是下划线」）本身幂等，改完就不再匹配。
    // 完成标记只决定**要不要再备份一次**（与 points / prompt 那两条同源）。
    // ⚠️ 位置：必须排在上面那条**之后**（同一次启动里，那条刚写下的 `________` 这次就一起收掉）。
    const blankMarkMigrationKey = 'worksheet-blank-mark-migration-v1';
    const blankMarkDone = await prisma.setting.findUnique({ where: { key: blankMarkMigrationKey } });
    if (!blankMarkDone) {
      const backupPath = backupDatabase('worksheet-blank-mark-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    const blankMarkMigrated = await migrateBlankMarkText(prisma);
    if (!blankMarkDone) {
      await prisma.setting.upsert({ where: { key: blankMarkMigrationKey }, update: { value: 'completed' }, create: { key: blankMarkMigrationKey, value: 'completed' } });
    }
    if (blankMarkMigrated.migrated > 0) {
      console.log(`[server] Worksheet blank mark migration: ${blankMarkMigrated.migrated} 份学习单的空标记已统一`);
    }
  } catch (e) {
    console.error('[server] Worksheet task migration failed:', e);
    throw e;
  }

  // v1.7：小组不再伪装为 Student。首次迁移先备份，成功后记录标记避免重复备份。
  try {
    const migrationKey = 'participant-model-migration-v1';
    const completed = await prisma.setting.findUnique({ where: { key: migrationKey } });
    if (!completed) {
      const backupPath = backupDatabase('participant-migration');
      if (backupPath) console.log(`[server] Database backup created: ${backupPath}`);
    }
    await migrateClassroomParticipants(prisma);
    if (!completed) {
      await prisma.setting.upsert({ where: { key: migrationKey }, update: { value: 'completed' }, create: { key: migrationKey, value: 'completed' } });
    }
    console.log('[server] Classroom participant migration complete');
  } catch (e) {
    console.error('[server] Classroom participant migration failed:', e);
    throw e;
  }

  // 「按组的课堂材料」：新增 ClassroomGroupMaterial，并把 ClassroomGroup.agentId 迁进去、删列。
  // ⚠️ 必须排在上面那条参与者迁移之后 —— 那条保证 ClassroomGroup 的结构已经是它预期的形状。
  try {
    await ensureGroupMaterials(prisma, backupDatabase);
  } catch (e) {
    console.error('[server] Classroom group materials migration failed:', e);
    throw e;
  }

}
