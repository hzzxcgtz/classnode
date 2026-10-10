import express from 'express';
import { createServer, type ServerResponse } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

// 文件日志必须在最前面导入，确保任何后续模块加载失败都能被记录
import './services/file-logger.js';

import { resetSocketData, setupSocketHandlers } from './socket/index.js';
import agentRoutes from './routes/agents.js';
import platformTokenRoutes from './routes/platform-tokens.js';
import classRoutes from './routes/classes.js';
import classroomRoutes, { classroomAccessGate } from './routes/classroom.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import shieldRoutes from './routes/shield.js';
import changelogRoutes from './routes/changelogs.js';
import { startAgentChecker } from './services/agent-checker.js';
import uploadRoutes, { cleanupOrphanedUploads } from './routes/upload.js';
import avatarRoutes from './routes/avatars.js';
import systemRoutes from './routes/system.js';
import upgradeRoutes, { checkForUpdateOnStartup } from './routes/upgrade.js';
import webappRoutes from './routes/webapps.js';
import { seedShieldWords } from './services/seed-shield-words.js';
import { revokeAllTeacherSessions, requireTeacher } from './middleware/auth.js';
import { installRequestSecurity, isLanRequestAllowed, isTrustedRequestOrigin, requestCorsOptions, type OriginPolicy } from './middleware/request-security.js';
import { revokeAllStudentSessions, getStudentSession } from './middleware/student-auth.js';
import { maintenanceGate, maintenanceBusy, trackDataTask } from './services/data-maintenance.js';
import { recoverInterruptedMaintenance } from './services/full-backup.js';
import { upgradeDatabase } from './services/database-upgrade.js';
import { protectSvgAsset } from './services/svg-sanitizer.js';
import { worksheetAccessGate, worksheetRoutes } from './routes/worksheets.js';
import { resolveWebappPort, startWebappHost, webappsRoot } from './services/webapp-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

async function main() {
  recoverInterruptedMaintenance();
  await upgradeDatabase(prisma);
  const port = parseInt(process.env.PORT || '3001', 10);

  const app = express();
  const webappPort = resolveWebappPort(port);
  const originPolicy: OriginPolicy = {
    webappPort,
    frontendPort: process.env.NODE_ENV === 'development'
      ? Number(process.env.FRONTEND_PORT || port - 1) : undefined,
    https: process.env.CLASSNODE_HTTPS === 'true',
  };
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: (req, callback) => callback(null, requestCorsOptions(req as import('node:http').IncomingMessage, originPolicy)),
    allowRequest: (req, callback) => callback(null,
      !maintenanceBusy() && isTrustedRequestOrigin(req, originPolicy)
      && isLanRequestAllowed(req.socket.remoteAddress, app.get('lanAccessEnabled') !== false)),
  });

  // Middleware
  app.use(maintenanceGate);
  installRequestSecurity(app, originPolicy);
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
    setHeaders: protectSvgAsset,
  }));

  // Make prisma and io available to routes
  app.set('prisma', prisma);
  app.set('io', io);
  app.set('dataMaintenanceHooks', {
    refresh: async () => {
      const lan = await prisma.setting.findUnique({ where: { key: 'lan-access' } });
      app.set('lanAccessEnabled', lan?.value !== 'false');
    },
    committed: () => {
      resetSocketData(io, app);
      revokeAllTeacherSessions();
      revokeAllStudentSessions();
    },
  });
  const lanAccessSetting = await prisma.setting.findUnique({ where: { key: 'lan-access' } }).catch(() => null);
  app.set('lanAccessEnabled', lanAccessSetting?.value !== 'false');

  // 探究空间托管服务的端口。**只在这里算一次**，路由层经 app.get('webappPort') 取值
  // （与 prisma / io / lanAccessEnabled 同一套注入方式）。
  // 下发的是端口而不是拼好的 URL：客户端本来就知道自己是从哪个 IP 进来的
  // （location.hostname），自己拼永远正确、也不存在缓存陈旧。教师端的 /api/server-info
  // 另给完整 URL —— 那里是每请求实算的。
  app.set('webappPort', webappPort);

  io.use((socket, next) => {
    if (isLanRequestAllowed(socket.handshake.address, app.get('lanAccessEnabled') !== false)) return next();
    next(new Error('教师已关闭局域网访问'));
  });

  // 上传后未发送消息、取消头像更换等情况会留下临时文件；延迟清理不打断课堂操作。
  const cleanUploads = () => trackDataTask(() => cleanupOrphanedUploads(prisma))
    .then(result => {
      const { chat, avatars } = result || { chat: 0, avatars: 0 };
      if (chat || avatars) console.log(`[uploads] Removed ${chat} chat and ${avatars} avatar orphan(s)`);
    })
    .catch(error => console.warn('[uploads] Orphan cleanup failed:', error));
  void cleanUploads();
  const uploadCleanupTimer = setInterval(cleanUploads, 6 * 60 * 60 * 1000);
  uploadCleanupTimer.unref();

  // 自动填充默认屏蔽词（仅首次启动时，词库为空时跳过）
  try {
    console.log('[server] Initializing default shield words');
    const seeded = await seedShieldWords(prisma);
    console.log(`[server] Default shield words ready (${seeded} added)`);
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
  // ★ 2026-09-25：共享 API Token（Coze 低代码）。与智能体同一道教师门。
  app.use('/api/platform-tokens', requireTeacher, platformTokenRoutes);
  app.use('/api/classes', requireTeacher, classRoutes);
  app.use('/api/classroom', classroomAccessGate, classroomRoutes);
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
    lanAccessEnabled: () => app.get('lanAccessEnabled') !== false,
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
