import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Server } from 'node:http';
import { SDK_PATH } from './webapp-sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 独立源服务的端口。
 *
 * 默认「服务端口 + 1」而不是写死 4002：dev 下服务在 4001、桌面端在 3001（硬编码于
 * src-tauri/src/lib.rs:27），+1 让两边都对。可用 CLASSNODE_WEBAPP_PORT 覆盖。
 *
 * 非法值（非数字、超出 1..65535）**回落到默认**而不是抛错 —— 端口是启动路径上的配置，
 * 一个手滑的拼写不该让整个服务起不来。
 */
export function resolveWebappPort(serverPort: number): number {
  const raw = process.env.CLASSNODE_WEBAPP_PORT;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  }
  return serverPort + 1;
}

/**
 * 托管网页的根目录。
 *
 * 与 uploads 平级（规格 §5.2）。注意 routes 层与 services 层的兜底深度不同：
 * 编译产物在 server/dist/services/，所以 '../..' 才是 server/。**照抄本函数的兜底，
 * 不要照抄 routes/upload.ts:16 的 '../../uploads'**（那是从 dist/routes/ 往上两级）。
 */
export function webappsRoot(): string {
  const base = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'webapps')
    : path.join(__dirname, '../../uploads/webapps');
  return base;
}

export interface StartWebappHostOptions {
  port: number;
  /** 主服务端口。用来拒绝「webapp 端口 == 服务端口」这个危险的配置，见 Ruling 4。 */
  serverPort: number;
  lanAccessEnabled: boolean;
  webappsRoot: string;
}

/**
 * 独立源的静态托管服务（规格 §5.1）。
 *
 * **它不继承主 app 的任何中间件**，理由逐条都有出处：
 *   · `server/src/index.ts:71` 全局设了 `X-Frame-Options: DENY` —— 照抄这段会把
 *     iframe 直接封死。本服务**绝不设这个头**。
 *   · `:67` 的 `cors({ origin: true, credentials: true })` 与规格要求的
 *     「不带任何 cookie」冲突。本服务不设 cors，也不读 cookie。
 *   · `:75` 的 `express.json()` / `:77-80` 的 `/api` no-store / 各种 API 路由
 *     —— 本服务**一个都不挂**。
 *
 * LAN gate 是**保留**的（与主服务 `:98-101` 同款）：它按 remoteAddress 判、与 cookie
 * 无关，所以不与「不带 cookie」冲突。不保留的话，教师关掉局域网访问后，局域网内仍能
 * 直接拉到托管网页。
 */
export async function startWebappHost(
  opts: StartWebappHostOptions,
): Promise<Server | null> {
  // Ruling 4：同源 + allow-same-origin + allow-scripts 是危险组合
  // （iframe 可自行摘除 sandbox 并触达父页面）。端口相同意味着隔离静默失效。
  // **不自动 +1** —— 自动改端口会让「用户配了什么」与「实际监听什么」不一致。
  if (opts.port === opts.serverPort) {
    console.error(
      `❌ 探究助手托管端口(${opts.port}) 不能与服务端口相同。` +
      `同源 iframe 会让 sandbox 隔离失效，已拒绝启动该服务。` +
      `请设置 CLASSNODE_WEBAPP_PORT 为其他端口。`,
    );
    return null;
  }

  const app = express();

  const isLoopback = (address?: string) =>
    address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

  app.use((req, res, next) => {
    if (opts.lanAccessEnabled || isLoopback(req.socket.remoteAddress)) return next();
    res.status(403).send('教师已关闭局域网访问');
  });

  // SDK 脚本。⚠️ 挂载必须在静态之前，否则会被 /webapps 的静态中间件抢走。
  app.get(SDK_PATH, (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store'); // 与 HTML 同样的理由：升级后不能留旧的
    res.send(readSdkSource());
  });

  app.use(
    '/webapps',
    express.static(opts.webappsRoot, {
      index: ['index.html'],
      redirect: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        // 关键：静态 HTML 必须 no-store（CLAUDE.md 的既有约束）。托管网页与主前端
        // 是同一类东西 —— 升级后浏览器留着旧 HTML 会去请求已删的 JS chunk。
        res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  return await new Promise<Server | null>((resolve) => {
    const server = app.listen(opts.port, '0.0.0.0', () => {
      console.log(`📦 探究助手托管服务 http://0.0.0.0:${opts.port}`);
      resolve(server);
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      // Ruling 1：本服务起不来**不能**拖垮主服务。EADDRINUSE 只 warn。
      console.error(`⚠️ 探究助手托管服务启动失败（${error.code}）：${error.message}`);
      console.error('   主服务继续运行；学生端的探究助手将无法加载。');
      resolve(null);
    });
  });
}

function readSdkSource(): string {
  return '/* ClassNode SDK — 实现见 Task 4 */\n';
}
