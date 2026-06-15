import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

import { setupSocketHandlers } from './socket/index.js';
import agentRoutes from './routes/agents.js';
import classRoutes from './routes/classes.js';
import classroomRoutes from './routes/classroom.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import shieldRoutes from './routes/shield.js';
import changelogRoutes from './routes/changelogs.js';
import { startAgentChecker } from './services/agent-checker.js';
import './services/file-logger.js'; // 文件日志（必须在最前面，接管 console）
import uploadRoutes from './routes/upload.js';
import avatarRoutes from './routes/avatars.js';
import defaultShieldWords from './services/default-shield-words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

async function main() {
  const port = parseInt(process.env.PORT || '3001', 10);

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Middleware
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' }));
  // 上传文件的静态服务（从用户目录加载，兼容开发环境）
  const uploadsDir = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
    : path.join(__dirname, '../uploads');
  app.use('/uploads', express.static(uploadsDir));

  // Make prisma and io available to routes
  app.set('prisma', prisma);
  app.set('io', io);

  // 自动同步数据库 schema（兼容旧版数据库缺少新表/列的情况）
  try {
    const dbVersion = await prisma.$queryRawUnsafe<{ version: string }[]>(`SELECT sqlite_version() as version`);
    console.log(`[server] SQLite version: ${dbVersion[0].version}`);

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
  } catch (e) {
    console.warn('[server] Schema sync skipped:', e);
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

  // 前端静态文件（Next.js 静态导出产物）
  const frontendDir = path.join(__dirname, '../frontend');
  app.use(express.static(frontendDir));
  // 防御：如果构建时 out/ 被嵌套复制，也作为静态文件源
  const nestedFrontendDir = path.join(frontendDir, 'out');
  if (fs.existsSync(nestedFrontendDir)) {
    app.use(express.static(nestedFrontendDir));
    console.log(`[server] Also serving frontend from nested: ${nestedFrontendDir}`);
  }

  // Routes
  app.use('/api/agents', agentRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/classroom', classroomRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/shield', shieldRoutes);
  app.use('/api/changelogs', changelogRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/avatars', avatarRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', port, timestamp: new Date().toISOString() });
  });

  // Get server info
  app.get('/api/server-info', async (req, res) => {
    const interfaces = getLocalIPAddresses();
    let selectedIp = '';
    try {
      const setting = await prisma.setting.findUnique({ where: { key: 'bind-ip' } });
      if (setting) selectedIp = setting.value;
    } catch {}
    if (!selectedIp || !interfaces.some(i => i.ip === selectedIp)) {
      selectedIp = interfaces.length > 0 ? interfaces[0].ip : "localhost";
    }
    const fePort = parseInt(process.env.FRONTEND_PORT || String(port), 10);
    const studentUrl = `http://${selectedIp}:${fePort}/classroom`;
    res.json({
      port,
      localIPs: interfaces.map(i => i.ip),
      interfaces,
      selectedIp,
      urls: interfaces.map(i => `http://${i.ip}:${port}`),
      classroomUrl: interfaces.map(i => `http://${i.ip}:${parseInt(process.env.FRONTEND_PORT || String(port), 10)}`),
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
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[server] Received ${signal}, shutting down gracefully...`);
    httpServer.close();
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
