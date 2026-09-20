import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Application } from 'express';
import type { Server } from 'node:http';
import { SDK_PATH, injectSdk } from './webapp-sdk.js';

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

/**
 * 把「/webapps 挂载点之后」的 URL 路径解析成 webappsRoot 之下的绝对路径。
 *
 * 返回 null 表示**必须拒绝**，调用方一律按「不存在」处理（不区分拒绝原因，避免把
 * 「文件没有」和「被挡了」的差异透给探测者）。
 *
 * **为什么抽成纯函数**：路径穿越用 curl 证明是不可靠的 —— HTTP 客户端与中间层常会在
 * 请求发出**之前**就把 '..' 折叠掉，于是「没打出穿越」既可能是被挡了、也可能是根本没发出去。
 * 对字符串直接断言与被规范化与否无关。中间件里那份 curl 证据见测试与报告。
 */
export function resolveWebappFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // 非法百分号编码
  }
  if (decoded.includes('\0')) return null; // NUL 截断

  const segments = decoded.split('/').filter(segment => segment.length > 0);

  // 一个判断同时管两件事，因为它们判的是同一个前缀：
  //   · '.' / '..' —— 路径穿越。**刻意不做「归一化后仍在根内就放行」的宽容处理**：
  //     宽容会让本中间件比它下面的 express.static 更松，于是「其余路径的行为一个字
  //     都没变」这句话就不成立了。
  //   · 任意以 '.' 开头的段 —— dotfiles: 'deny' 的语义（.env、.git/config、.hidden/x.html）。
  if (segments.some(segment => segment.startsWith('.'))) return null;

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  // 上面已经拒掉了 '..'，所以这一句在数学上不可能触发。留着是因为那条「不可能」依赖
  // 上面的判断不被后人改动，而这里是安全边界 —— 断言比注释可靠。
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}

/**
 * 重新计算并缓存 webappOrigin。
 *
 * 只有两处调用，都是「这个值的输入刚刚变了」的那一瞬：启动时一次（index.ts），
 * 以及 bind-ip 被改时一次（routes/settings.ts）。**刻意不让任何 GET 顺手刷新** ——
 * 那会让读接口带上副作用。
 *
 * 端口从 app.get('webappPort') 读、IP 交给 app 注入的 resolveSelectedIp —— 两者都不是
 * 本函数自己推算的，所以这里没有第二套端口/网卡逻辑。
 * 本函数不会 reject（唯一的 I/O 是读设置，失败已兜底）。
 */
export async function refreshWebappOrigin(app: Application): Promise<void> {
  const port = app.get('webappPort');
  const resolveSelectedIp = app.get('resolveSelectedIp');
  if (!port || typeof resolveSelectedIp !== 'function') return;
  const prisma = app.get('prisma');
  const setting = await prisma?.setting.findUnique({ where: { key: 'bind-ip' } }).catch(() => null);
  // 空串表示「自动选择」，与未设置同义 —— 一并交给解析函数去走 NIC 枚举。
  app.set('webappOrigin', `http://${resolveSelectedIp(setting?.value || null)}:${port}`);
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

  // 注入 SDK：只拦 .html，其余一律 next() 交给下面的 express.static。
  //
  // ⚠️ 为什么必须拦在静态之前：express.static 没有改写响应体的钩子，而 SDK 注入
  // 必须在 `</head>` 前插一个 <script>。让静态服务先处理，响应就已经发出去了。
  //
  // ⚠️ 为什么只拦 .html 而不是自己实现整个静态服务：非 HTML 资源（css/js/图片/字体）
  // 继续走 express.static，它已经验证过的行为（dotfiles:deny、路径穿越防护、缓存头）
  // 一个字都不用重新证明。**改动面越小，要重新证明的东西越少。**
  //
  // 本中间件只在「路径解析成功 + 是 .html + 读得到」三个条件同时成立时才应答；
  // 其余**全部** next() 下去 —— 这样「非 HTML 路径的行为一个字都没变」才是可证的，
  // 而不是靠枚举。
  app.use('/webapps', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const resolved = resolveWebappFile(opts.webappsRoot, req.path);
    if (!resolved) return next(); // 穿越/点文件/编码非法 → 交给 static 走它原有的拒绝语义

    let target = resolved;
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    } catch {
      return next(); // 不存在 → 交给 static 产出标准的 404
    }
    // 用后缀判断而不是 Content-Type：后者要先读文件才知道，而读文件是有代价的。
    if (!target.toLowerCase().endsWith('.html')) return next();

    let html: string;
    try {
      html = fs.readFileSync(target, 'utf8');
    } catch {
      return next();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // HTML 必须 no-store —— 与下面 static 那侧同样的理由（CLAUDE.md 的既有硬约束）。
    res.setHeader('Cache-Control', 'no-store');
    // ⚠️ 本服务绝不设 X-Frame-Options：主服务 index.ts 全局设的那条 DENY 会把 iframe 封死。
    res.send(injectSdk(html, { sdkPath: SDK_PATH }));
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
