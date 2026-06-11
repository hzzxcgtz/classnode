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
import uploadRoutes from './routes/upload.js';
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

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', port, timestamp: new Date().toISOString() });
  });

  // Get server info
  app.get('/api/server-info', (_req, res) => {
    const interfaces = getLocalIPAddresses();
    res.json({
      port,
      localIPs: interfaces,
      urls: interfaces.map((ip: string) => `http://${ip}:${port}`),
      classroomUrl: interfaces.map((ip: string) => `http://${ip}:${parseInt(process.env.FRONTEND_PORT || String(port), 10)}`),
    });
  });

  // Socket.IO setup
  setupSocketHandlers(io, prisma, app);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🚀 ClassNode Server running on port ${port}`);
    const interfaces = getLocalIPAddresses();
    interfaces.forEach((ip: string) => {
      console.log(`   http://${ip}:${port}`);
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

function getLocalIPAddresses(): string[] {
  const { networkInterfaces } = os;
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

main().catch((e) => {
  console.error('Server failed to start:', e);
  process.exit(1);
});
