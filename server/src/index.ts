import express from 'express';
import cors from 'cors';
import { createServer, type ServerResponse } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

// 文件日志必须在最前面导入，确保任何后续模块加载失败都能被记录
import './services/file-logger.js';

import { setupSocketHandlers } from './socket/index.js';
import agentRoutes from './routes/agents.js';
import classRoutes from './routes/classes.js';
import classroomRoutes from './routes/classroom.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import shieldRoutes from './routes/shield.js';
import changelogRoutes from './routes/changelogs.js';
import { startAgentChecker } from './services/agent-checker.js';
import { sendPing } from './services/ping.js';
import uploadRoutes, { cleanupOrphanedUploads } from './routes/upload.js';
import avatarRoutes from './routes/avatars.js';
import systemRoutes from './routes/system.js';
import upgradeRoutes, { checkForUpdateOnStartup } from './routes/upgrade.js';
import webappRoutes from './routes/webapps.js';
import defaultShieldWords from './services/default-shield-words.js';
import { requireTeacher } from './middleware/auth.js';
import { getStudentSession } from './middleware/student-auth.js';
import { migrateClassroomParticipants } from './services/participant-migration.js';
import { ensureGroupMaterials } from './services/group-materials-migration.js';
import { ensureAnalysisClassroomColumn, ensureWorksheetAnswerColumns, ensureWorksheetTables } from './services/worksheet-schema.js';
import { worksheetAccessGate, worksheetRoutes } from './routes/worksheets.js';
import { resolveWebappPort, startWebappHost, webappsRoot } from './services/webapp-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

/**
 * 备份当前 SQLite 库，文件名带 `label` 以区分是哪一次迁移产生的。
 *
 * ⚠️ `label` 是**已有备份文件名的组成部分**：参与者迁移传 `'participant-migration'`，
 * 产出的 `before-participant-migration-<stamp>.db` 与历史备份逐字一致，
 * 变更 label 会让老备份与新备份看起来像两套东西。
 */
function backupDatabase(label: string): string | null {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl.startsWith('file:')) return null;
  const configuredPath = databaseUrl.slice('file:'.length);
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(databasePath)) return null;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `before-${label}-${stamp}.db`);
  fs.copyFileSync(databasePath, backupPath);
  return backupPath;
}

async function main() {
  const port = parseInt(process.env.PORT || '3001', 10);

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  // API 中包含教师配置、学生名单和对话内容；避免浏览器或代理复用旧响应。
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // 上传文件的静态服务（从用户目录加载，兼容开发环境）
  const uploadsDir = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
    : path.join(__dirname, '../uploads');
  app.use('/uploads', express.static(uploadsDir, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
  }));

  // Make prisma and io available to routes
  app.set('prisma', prisma);
  app.set('io', io);
  const lanAccessSetting = await prisma.setting.findUnique({ where: { key: 'lan-access' } }).catch(() => null);
  app.set('lanAccessEnabled', lanAccessSetting?.value !== 'false');

  // 探究空间托管服务的端口。**只在这里算一次**，路由层经 app.get('webappPort') 取值
  // （与 prisma / io / lanAccessEnabled 同一套注入方式）。
  // 下发的是端口而不是拼好的 URL：客户端本来就知道自己是从哪个 IP 进来的
  // （location.hostname），自己拼永远正确、也不存在缓存陈旧。教师端的 /api/server-info
  // 另给完整 URL —— 那里是每请求实算的。
  const webappPort = resolveWebappPort(port);
  app.set('webappPort', webappPort);

  const isLoopbackAddress = (address?: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  app.use((req, res, next) => {
    if (app.get('lanAccessEnabled') !== false || isLoopbackAddress(req.socket.remoteAddress)) return next();
    res.status(403).json({ error: '教师已关闭局域网访问' });
  });
  io.use((socket, next) => {
    if (app.get('lanAccessEnabled') !== false || isLoopbackAddress(socket.handshake.address)) return next();
    next(new Error('教师已关闭局域网访问'));
  });

  // 上传后未发送消息、取消头像更换等情况会留下临时文件；延迟清理不打断课堂操作。
  const cleanUploads = () => cleanupOrphanedUploads(prisma)
    .then(({ chat, avatars }) => {
      if (chat || avatars) console.log(`[uploads] Removed ${chat} chat and ${avatars} avatar orphan(s)`);
    })
    .catch(error => console.warn('[uploads] Orphan cleanup failed:', error));
  void cleanUploads();
  const uploadCleanupTimer = setInterval(cleanUploads, 6 * 60 * 60 * 1000);
  uploadCleanupTimer.unref();

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
      console.warn('[server] 学习单建表失败，学习单功能可能不可用：', error);
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
      console.warn('[server] ClassroomModule schema sync failed (module tri-state will be unavailable):', e);
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
      console.warn('[server] Webapp schema sync failed (探究空间 will be unavailable):', e);
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
      console.warn('[server] WebappUsage schema sync failed (课堂结束的使用汇总 will be unavailable):', e);
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
    // M5a：课堂级「锁定作答」。默认未锁定 ⇒ `DEFAULT 0`（布尔列的先例见上面几行）。
    if (!classroomColNames.includes('answersLocked')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "answersLocked" BOOLEAN NOT NULL DEFAULT 0`);
      console.log('[server] Added answersLocked column to Classroom');
    }

    // M4a：三态判分结果与数值得分（规格 §12）——加列 + 回填旧行。
    // ⚠️ 实现在 `services/worksheet-schema.ts` 里（**不是**内联在这儿）：那两列的类型
    // 与那句回填各有一个「错了不报错」的性质，内联在启动流程里就没有任何东西测得动它们。
    // 抽出去之后 `worksheet-schema.test.ts` 能在 /tmp 的探针库上真跑一遍。
    // 细节理由见那个函数的注释（`REAL` 而不是 `DOUBLE PRECISION`、`isCorrect` 只增不改、
    // 回填不写 `score` 的由头）。
    await ensureWorksheetAnswerColumns(prisma);
  } catch (e) {
    console.warn('[server] Schema sync skipped:', e);
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

  // 自动填充默认屏蔽词（仅首次启动时，词库为空时跳过）
  try {
    const builtinCount = await prisma.shieldWord.count({ where: { builtin: true } });
    if (builtinCount === 0) {
      for (const word of defaultShieldWords) {
        const existing = await prisma.shieldWord.findUnique({ where: { word } });
        if (!existing) {
          await prisma.shieldWord.create({ data: { word, builtin: true } });
        }
      }
      if (defaultShieldWords.length > 0) {
        console.log(`[server] Auto-seeded ${defaultShieldWords.length} default shield words`);
      }
    }
  } catch (e) {
    console.warn('[server] Failed to auto-seed shield words:', e);
  }

  // 启动智能体连通性定时检测
  startAgentChecker(prisma, io).catch(e =>
    console.warn('[server] Failed to start agent checker:', e),
  );

  // 生产版由后端同源提供打包后的前端。开发环境由 Next.js dev server
  // 单独提供，禁止回退到 server/frontend 中可能过期的静态构建。
  if (process.env.NODE_ENV !== 'development') {
    const frontendDir = path.join(__dirname, '../frontend');
    const frontendStaticOptions = {
      setHeaders(res: ServerResponse, filePath: string) {
        // Next 的带哈希资源可以长期缓存；HTML 必须每次重新验证，否则
        // Safari 可能在应用升级后继续引用上一版本已不存在的 JS 文件。
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, max-age=0');
        } else if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    };
    app.use(express.static(frontendDir, frontendStaticOptions));
    // 防御：如果构建时 out/ 被嵌套复制，也作为静态文件源
    const nestedFrontendDir = path.join(frontendDir, 'out');
    if (fs.existsSync(nestedFrontendDir)) {
      app.use(express.static(nestedFrontendDir, frontendStaticOptions));
      console.log(`[server] Also serving frontend from nested: ${nestedFrontendDir}`);
    }
  }

  // Routes
  app.use('/api/agents', requireTeacher, agentRoutes);
  app.use('/api/classes', requireTeacher, classRoutes);
  app.use('/api/classroom', (req, res, next) => {
    const publicStudentAccess =
      (req.method === 'POST' && /^\/code\/[^/]+\/student-session\/?$/.test(req.path)) ||
      (req.method === 'GET' && (
      /^\/code\/[^/]+\/?$/.test(req.path) ||
      /^\/[^/]+\/students\/?$/.test(req.path)
    ));
    if (publicStudentAccess) return next();
    const student = getStudentSession(req);
    const messageMatch = req.path.match(/^\/([^/]+)\/student\/([^/]+)\/messages\/?$/);
    const notificationMatch = req.path.match(/^\/([^/]+)\/notifications\/?$/);
    if (req.method === 'GET' && student && (
      (messageMatch && student.classroomId === messageMatch[1] && student.studentId === messageMatch[2]) ||
      (notificationMatch && student.classroomId === notificationMatch[1] && (!req.query.studentId || req.query.studentId === student.studentId))
    )) return next();
    requireTeacher(req, res, next);
  }, classroomRoutes);
  app.use('/api/export', requireTeacher, exportRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/shield', requireTeacher, shieldRoutes);
  app.use('/api/changelogs', requireTeacher, changelogRoutes);
  app.use('/api/upload', (req, res, next) => {
    if (getStudentSession(req)) return next();
    requireTeacher(req, res, next);
  }, uploadRoutes);
  app.use('/api/avatars', (req, res, next) => {
    if (req.method === 'GET' && !/^\/student-tokens\//.test(req.path)) return next();
    const student = getStudentSession(req);
    const selfMatch = req.path.match(/^\/student-self\/([^/]+)\/?$/);
    const tokenMatch = req.path.match(/^\/student-tokens\/([^/]+)\/?$/);
    if (student && (
      (req.method === 'PUT' && selfMatch?.[1] === student.studentId) ||
      (req.method === 'GET' && tokenMatch?.[1] === student.studentId)
    )) return next();
    requireTeacher(req, res, next);
  }, avatarRoutes);
  app.use('/api/system', requireTeacher, systemRoutes);
  app.use('/api/upgrade', requireTeacher, upgradeRoutes);
  // 探究空间的网页管理**全部是教师端**，没有学生可访问的端点。
  // 学生靠 iframe 直接向托管源（另一个端口）取静态文件，不经过 /api。
  // ⚠️ **绝不给本路由开学生 token 通道**：一旦开了，学生就能列出全库网页。
  app.use('/api/webapps', requireTeacher, webappRoutes);
  // 学习单：教师端 CRUD 与学生端读取/作答**同一条路由混装**，所以这里的闸门是安全的关键。
  //
  // 判据（学生只放行三种形状、其余一律拦下）实现在 `worksheetAccessGate` 里，
  // 而不是内联在这个箭头函数里 —— 理由是**可测性**：挂在 `app.use` 里的匿名中间件
  // 测试拿不到（`index.ts` 一 import 就 `main()` 起服务），测试只能自己再抄一份，
  // 于是「鉴权写了但没生效」这一类假绿跑不掉也没人发现。放在 routes/worksheets.ts
  // 里，测试引用的就是**这一个**函数。
  //
  // ⚠️ 三种学生形状是：`GET /:id/student-view`、`PUT /:id/answers`、
  //    `POST /:id/answers/submit`。**「已查看」是 `POST /:id/review`，不在其中** ⇒
  //    自然走教师那一支。改动那段正则时务必确认它仍然不匹配 review。
  // ⚠️ 路由处理器**内部**还必须校验：该学生所属参与者的学习单解析结果 `=== :id`。
  //    这里只校验「是本课堂的学生」，不够 —— 高级模式下不同组拿的是不同的学习单。
  app.use('/api/worksheets', worksheetAccessGate, worksheetRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', port, timestamp: new Date().toISOString() });
  });

  // Get server info
  app.get('/api/server-info', requireTeacher, async (req, res) => {
    const interfaces = getLocalIPAddresses();
    let selectedIp = '';
    try {
      const setting = await prisma.setting.findUnique({ where: { key: 'bind-ip' } });
      if (setting) selectedIp = setting.value;
    } catch {}
    if (!selectedIp || !interfaces.some(i => i.ip === selectedIp)) {
      selectedIp = interfaces.length > 0 ? interfaces[0].ip : "localhost";
    }
    const defaultFrontendPort = process.env.NODE_ENV === 'development' ? '4000' : String(port);
    const fePort = parseInt(process.env.FRONTEND_PORT || defaultFrontendPort, 10);
    const studentUrl = `http://${selectedIp}:${fePort}/classroom`;
    res.json({
      port,
      localIPs: interfaces.map(i => i.ip),
      interfaces,
      selectedIp,
      studentUrl,
      // 探究空间托管服务的源。端口来自 main() 里那一个 webappPort 变量，不在这里重算。
      webappOrigin: `http://${selectedIp}:${webappPort}`,
      urls: interfaces.map(i => `http://${i.ip}:${port}`),
      classroomUrl: interfaces.map(i => `http://${i.ip}:${fePort}`),
    });
  });

  // Socket.IO setup
  setupSocketHandlers(io, prisma, app);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🚀 ClassNode Server running on port ${port}`);
    const interfaces = getLocalIPAddresses();
    interfaces.forEach((iface: { name: string; label: string; ip: string }) => {
      console.log(`   http://${iface.ip}:${port}  (${iface.label})`);
    });
    // 匿名心跳统计（需先通过设置配置 ping_url）
    sendPing(prisma);
    // 每次服务启动后仅检查一次版本；失败不影响课堂服务正常运行。
    void checkForUpdateOnStartup()
      .then((result) => console.log(result.hasUpdate
        ? `[upgrade] 发现新版本 v${result.latestVersion}`
        : `[upgrade] 已是最新版本 v${result.currentVersion}`))
      .catch((error) => console.warn('[upgrade] 后台检查失败:', error instanceof Error ? error.message : String(error)));
  });

  // 探究空间托管服务：独立源的第二个 Express 实例（规格 §5.1）。
  // 它起不来**不能**拖垮主服务 —— EADDRINUSE 时 startWebappHost 只 warn 并返回 null。
  const webappServer = await startWebappHost({
    port: webappPort,
    serverPort: port,
    lanAccessEnabled: app.get('lanAccessEnabled') !== false,
    webappsRoot: webappsRoot(),
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[server] Received ${signal}, shutting down gracefully...`);
    httpServer.close();
    // 与 httpServer.close() 对称：两个监听同进程（Ruling 1），退出路径上把第二个监听
    // 也显式停掉，不再接收新连接。
    // ⚠️ 这一行**不是必需的**：紧接着的 process.exit(0) 无论如何都会终止进程并释放端口。
    // 留着是为了保持「先停止接客、再断 DB、最后退出」这个顺序完整。
    // null 表示该服务因端口相同或 EADDRINUSE 没起来。
    webappServer?.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function friendlyName(name: string): string {
  if (name === 'en0') return 'Wi-Fi';
  if (name === 'en1') return '以太网';
  if (name.startsWith('en')) return `以太网 (${name})`;
  if (name.startsWith('eth')) return '以太网';
  if (name.startsWith('wlan') || name.startsWith('wlp') || name.startsWith('wl')) return 'Wi-Fi';
  if (name.startsWith('以太网') || name === '以太网' || name === 'Ethernet') return '以太网';
  if (name === 'Wi-Fi' || name === 'WiFi' || name.startsWith('WLAN')) return 'Wi-Fi';
  if (name.startsWith('本地连接')) return '本地连接';
  return name;
}

function getLocalIPAddresses(): { name: string; label: string; ip: string }[] {
  const { networkInterfaces } = os;
  const interfaces = networkInterfaces();
  const result: { name: string; label: string; ip: string }[] = [];
  const virtualPatterns = [
    /^utun\d*$/i, /^awdl\d*$/i, /^llw\d*$/i, /^anpi\d*$/i, /^ap\d*$/i,
    /^docker\d*$/i, /^veth\d*$/i, /^virbr\d*$/i, /^vmnet\d*$/i,
    /^vEthernet/i, /vmware/i, /virtualbox/i, /bridge\d*$/i,
  ];
  for (const name of Object.keys(interfaces)) {
    if (virtualPatterns.some(p => p.test(name))) continue;
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push({ name, label: friendlyName(name), ip: iface.address });
      }
    }
  }
  return result;
}

main().catch((e) => {
  console.error('Server failed to start:', e);
  process.exit(1);
});
