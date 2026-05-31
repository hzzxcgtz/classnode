import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import { setupSocketHandlers } from './socket/index.js';
import agentRoutes from './routes/agents.js';
import classRoutes from './routes/classes.js';
import classroomRoutes from './routes/classroom.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import uploadRoutes from './routes/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '0.0.0.0', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

async function main() {
  const preferredPort = parseInt(process.env.PORT || '3001', 10);
  const port = await findAvailablePort(preferredPort);

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
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Make prisma and io available to routes
  app.set('prisma', prisma);
  app.set('io', io);

  // 前端静态文件（Next.js 静态导出产物）
  const frontendDir = path.join(__dirname, '../frontend');
  app.use(express.static(frontendDir));

  // Routes
  app.use('/api/agents', agentRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/classroom', classroomRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/settings', settingsRoutes);
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
      classroomUrl: interfaces.map((ip: string) => `http://${ip}:${parseInt(process.env.FRONTEND_PORT || '3000', 10)}`),
    });
  });

  // Socket.IO setup
  setupSocketHandlers(io, prisma);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🚀 ClassNode Server running on port ${port}`);
    const interfaces = getLocalIPAddresses();
    interfaces.forEach((ip: string) => {
      console.log(`   http://${ip}:${port}`);
    });
  });
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
