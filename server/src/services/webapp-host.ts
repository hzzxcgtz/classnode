import { maintenanceGate } from './data-maintenance.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Server } from 'node:http';
import { SDK_PATH, SDK_SOURCE, SHOT_PATH, injectSdk } from './webapp-sdk.js';
import { lanAccessGate } from '../middleware/request-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 记录两个 SDK 脚本的请求 —— 这是**一条诊断，不是访问日志**。
 *
 * 它回答一个用别的方式回答不了的问题：**这台设备走的是哪一档截图？**
 *   · 请求过 `shot.js` ⇒ 页面里没有大 canvas，走的是 snapdom 光栅化那一档；
 *   · 没请求过 ⇒ 走的是 canvas 直读那一档（或者 `captureFrame` 根本没跑到 ——
 *     后者由 socket 那侧的 `webapp-frameless` 告警指出来）。
 *
 * 老 iPad 上报「有浏览位置、没有图片」时，**这一行就是第一刀**：两档的失败原因
 * 完全不同（一档是 `toDataURL` 被污染，另一档是整个截图库的行为），不先分开就只能猜。
 *
 * ⚠️ **带 UA 是必需的，不是顺手**：同一个服务端同时接着几十台设备，不带 UA 就分不清
 * 那一行是 iPad 发的还是桌面机发的 —— 而这次要查的恰好是**设备差异**。
 * ⚠️ 带远端地址：同一型号可能有多台学生机。地址是局域网内网地址，不是公网标识。
 * ⚠️ **量级有界**：`shot.js` 每个 iframe 生命周期只请求一次（SDK 加载成功后不再重取），
 * SDK 本身每个 HTML 文档一次 —— **不是每帧一条**。
 */
function logScriptRequest(kind: 'sdk' | 'shot', req: express.Request): void {
  const agent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '(无 UA)';
  const label = kind === 'shot' ? 'shot.js（DOM 光栅化档）' : 'sdk.js';
  console.log(`[webapp-host] 📥 ${label} ← ${req.socket.remoteAddress || '?'} | ${agent}`);
}

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
 * 托管网页的根目录。两个分支都必须是 **uploads 的兄弟目录**，不是它的子目录（规格 §5.2）。
 *
 * ⚠️ **兜底分支绝不能写成 `uploads/webapps`。** 主服务把整个 uploadsDir 挂在 `/uploads`
 * 上（index.ts，无白名单），嵌进 uploads 就等于把教师上传的任意 HTML 也暴露在**应用自己的
 * 源**上 —— 那个源里有教师 session 和全部 `/api`，正是 sandbox 要隔开的东西。
 * 实测过：`/uploads/webapps/x/index.html` 与托管源的同一文件同字节返回 200。
 *
 * 注意 routes 层与 services 层的兜底深度不同：编译产物在 server/dist/services/，
 * 所以 '../..' 才是 server/。**照抄本函数的兜底，不要照抄 routes/upload.ts 的
 * '../../uploads'**（那是从 dist/routes/ 往上两级）。
 */
export function webappsRoot(): string {
  const base = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'webapps')
    : path.join(__dirname, '../../webapps');
  return base;
}

/**
 * 纯字符串解析：把「/webapps 挂载点之后」的 URL 路径映射成 webappsRoot 之下的候选绝对路径。
 * 越界 / 点段 / 非法编码一律返回 null。
 *
 * **不含任何文件系统访问**，理由见下面 resolveWebappFile 的说明。
 */
function resolveCandidatePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // 非法百分号编码
  }
  if (decoded.includes('\0')) return null; // NUL 截断

  const segments = decoded.split('/').filter(segment => segment.length > 0);

  // 一个判断同时管两件事，因为它们判的是同一个前缀：
  //   · '.' / '..' —— 本函数一律拒绝，不论归一化后是否仍在根内。
  //   · 任意以 '.' 开头的段 —— dotfiles: 'deny' 的语义（.env、.git/config、.hidden/x.html）。
  //
  // ⚠️ **这里拒掉 '..' 并不会让本中间件比它下面的 express.static 更严**（实测过）：
  // 这类请求会 next() 落到 express.static，而 static 是**归一化**处理的 ——
  // 归一化后仍在根内的路径它照常送出（`root/CLAMP.html` 存在时，
  // `/webapps/probe/../CLAMP.html` 返回 200），只有**逃出根**的才 404。
  // 也就是说：本中间件实际应答的路径**从不含 '..'**，含 '..' 的一律沿用旧行为。
  if (segments.some(segment => segment.startsWith('.'))) return null;

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  // 上面已经拒掉了 '..'，所以这一句在数学上不可能触发。留着是因为那条「不可能」依赖
  // 上面的判断不被后人改动，而这里是安全边界 —— 断言比注释可靠。
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;

  return resolved;
}

/** lstatSync 的安全包装：读不到（不存在 / 权限 / 路径过长）一律当作「不是符号链接」。 */
/**
 * 目标经 realpath 解析后是否落在 **webappsRoot 之外**。
 *
 * 这是本文件里唯一的权威包含性判定。**为什么不用 lstat / 逐段 lstat**：
 * `lstatSync` 不跟随**最后一个**分量，但**跟随中间分量** —— 于是
 * `<root>/dirlink/secret.html`（`dirlink` 是指向根外的目录链接）被 lstat 成一个
 * **普通文件**，判定「不是链接」，一路放行到 `readFileSync` / `express.static`
 * 把根外内容原样送出。实测复现过：`/webapps/dirlink/secret.html` → 200 + 泄漏。
 * 逐段 lstat 是想把同一类推理再做一遍，仍然是在「猜路径里有没有链接」；
 * `realpathSync` **一次性解析所有中间分量与叶子分量（含 `..`）**，判定退化成一次
 * 前缀比较 —— 问题整个消失，而不是被逐个分量地绕。
 *
 * ⚠️ **两边都要 realpath**：webappsRoot 本身也可能含链接。这不是理论顾虑 ——
 * macOS 上 `/tmp` 本身就是指向 `/private/tmp` 的链接，只解析一边会让
 * `realRoot` = `/tmp/x/webapps` 与 `realTarget` = `/private/tmp/x/webapps/a.html`
 * 前缀对不上，**整个目录全部误判为逃逸而 404**。
 */
function realpathEscapes(root: string, candidate: string): boolean {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    // 根都读不到 → 下游本来就会 404，不当作「逃逸」（否则会把它变成中间件应答的 404，
    // 反而改变了「非 HTML 交给 static」的既有语义）。
    return false;
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(candidate);
  } catch {
    // ENOENT（文件不存在，是**正常业务路径**，不是攻击）、ELOOP（链接成环）、
    // EACCES、ENAMETOOLONG —— 一律当作「不是逃逸」，交给下游 404。
    // ⚠️ 必须吞掉：这是请求路径上最常见的分支，抛出去就是未捕获异常。
    // 而且打不开的路径也不可能是泄漏源 —— 泄漏的前提是「读得到根外的东西」。
    return false;
  }

  if (realTarget === realRoot) return false;
  // ⚠️ 必须带 path.sep：只 startsWith(realRoot) 会把 `/a/bc` 判成在 `/a/b` 之下。
  return !realTarget.startsWith(realRoot + path.sep);
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
 *
 * ⚠️ **解析结果逃出根的一律拒绝**（唯一一处文件系统访问是 realpath，见 realpathEscapes）。
 * 逃逸的路径会被 readFileSync / express.static 一路跟随，把根外的内容原样送出。
 *
 * ⚠️ **但返回 null 本身拦不住它** —— 调用方对 null 的既有语义是 `next()` 交给
 * express.static，而 **static 会跟随链接**（实测 `/webapps/link.html` → 200 +
 * 正文含 OUTSIDE-LEAKED）。所以中间件必须把「逃逸」这一类单独摘出来**直接 404**，
 * 用下面的 `escapesWebappsRoot`。只加本函数里的判断、不改中间件，等于没修。
 */
export function resolveWebappFile(root: string, urlPath: string): string | null {
  const resolved = resolveCandidatePath(root, urlPath);
  if (!resolved) return null;
  if (realpathEscapes(root, resolved)) return null;
  return resolved;
}

/**
 * 该请求解析后是否逃出了 webappsRoot。
 *
 * 存在的唯一理由：`resolveWebappFile` 返回的 null 有两个语义完全不同的来源 ——
 * 「static 对这些输入有正确语义」（含 '..' 归一化后仍在根内、dotfiles: deny）与
 * 「逃出根，static 会跟随链接把根外内容送出」。前者可以安全 next()，**后者必须直接 404**。
 * 中间件用本函数把后者摘出来。两层共用同一个 `resolveCandidatePath` 与同一个
 * `realpathEscapes`，不会各写一套判据。
 */
export function escapesWebappsRoot(root: string, urlPath: string): boolean {
  const resolved = resolveCandidatePath(root, urlPath);
  if (!resolved) return false;
  return realpathEscapes(root, resolved);
}

export interface StartWebappHostOptions {
  port: number;
  /** 主服务端口。用来拒绝「webapp 端口 == 服务端口」这个危险的配置，见 Ruling 4。 */
  serverPort: number;
  lanAccessEnabled: boolean | (() => boolean);
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
      `❌ 探究空间托管端口(${opts.port}) 不能与服务端口相同。` +
      `同源 iframe 会让 sandbox 隔离失效，已拒绝启动该服务。` +
      `请设置 CLASSNODE_WEBAPP_PORT 为其他端口。`,
    );
    return null;
  }

  const app = express();
  app.use(maintenanceGate);

  app.use(lanAccessGate(() => typeof opts.lanAccessEnabled === 'function'
    ? opts.lanAccessEnabled() : opts.lanAccessEnabled));

  // SDK 脚本。⚠️ 挂载必须在静态之前，否则会被 /webapps 的静态中间件抢走。
  app.get(SDK_PATH, (req, res) => {
    logScriptRequest('sdk', req);
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store'); // 与 HTML 同样的理由：升级后不能留旧的
    res.send(readSdkSource());
  });

  // 按需加载的 DOM 截图库（供应商产物，见 server/vendor/README.md）。
  //
  // **只有「页面里没有大 canvas」的纯 DOM 网页才会请求它。** 有大 canvas 的网页走 SDK
  // 的第一档直读，永远不下载这 83KB（gzip）—— 这就是规格 §5.4 说的「按需加载截图库」。
  // 所以本路由可以是独立文件而不进学生端 bundle：它的下载时机由页面形态决定。
  app.get(SHOT_PATH, (req, res) => {
    logScriptRequest('shot', req);
    const source = readShotSource();
    if (source === null) {
      // ⚠️ 缺文件时**明确报 503**，不要静默送一个空响应。空响应在浏览器那头表现为
      // 「脚本加载成功、但没有 window.snapdom」，SDK 会以为加载失败并重试或放弃，
      // 排查时要从「文件到底有没有被打进安装包」一路倒查 —— 不如在这里直说。
      console.error(`❌ 缺少 DOM 截图库文件：${shotPath()}（见 server/vendor/README.md）`);
      res.status(503).type('text/plain').send('shot library missing');
      return;
    }
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store'); // 与 SDK/HTML 同一理由：升级后不能留旧的
    res.send(source);
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
    // 解析失败（含 '..' / 点文件 / 编码非法）一律 next() 交给 express.static，
    // **不在这里自己 404**。理由是「其余路径的行为一个字都没变」：
    // static 对这些输入有它自己的既有语义（归一化后送出、或 404），照搬它比另立一套安全。
    // ⚠️ 副作用（实测过，见 T4/T6 注意事项）：含 '..' 但归一化后仍在根内的 **.html**
    // 会由 static 原样送出，因而**绕过 SDK 注入**。学生端用规整路径即可避开，未修。
    if (!resolved) {
      // ⚠️ **逃出根的那一类不能 next()。** 上面那些 null 之所以能安全交给 static，
      // 是因为 static 对它们有正确语义（归一化 / dotfiles: deny）；但对逃出根的目标，
      // static 的「既有语义」就是**跟随链接**把它读出来 —— 实测
      // `/webapps/leaflink.html`（叶子链接）与 `/webapps/dirlink/secret.html`
      // （**中间分量**是目录链接）都返回 200 且正文是根外文件的内容。
      // 所以这里直接 404，不走 fall-through。这是本中间件唯一一处自己应答 404 的地方。
      if (escapesWebappsRoot(opts.webappsRoot, req.path)) {
        res.status(404).end();
        return;
      }
      return next();
    }

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
      setHeaders: (res, filePath) => {
        // 只有 HTML 必须 no-store（CLAUDE.md 的既有约束）：托管网页与主前端是同一类
        // 东西 —— 升级后浏览器留着旧 HTML 会去请求已删的 JS chunk。
        // ⚠️ **只对 .html 设**：媒体（mp4/mp3/webp）按 uuid 目录寻址，教师重传即换 uuid，
        // 缓存是安全的；对所有文件一律 no-store 会让老 iPad 每次刷新都全量重下。
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  return await new Promise<Server | null>((resolve) => {
    const server = app.listen(opts.port, '0.0.0.0', () => {
      console.log(`📦 探究空间托管服务 http://0.0.0.0:${opts.port}`);
      resolve(server);
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      // Ruling 1：本服务起不来**不能**拖垮主服务。EADDRINUSE 只 warn。
      console.error(`⚠️ 探究空间托管服务启动失败（${error.code}）：${error.message}`);
      console.error('   主服务继续运行；学生端的探究空间将无法加载。');
      resolve(null);
    });
  });
}

/**
 * 送给浏览器的 SDK 源码。
 *
 * T1 时这里返回一个占位串，T4 换成真正的源码 —— **函数体一行之差**，
 * 调用点（上面的 `app.get(SDK_PATH, …)`）一个字都没动。
 *
 * ⚠️ 之所以让 webapp-sdk.ts **导出字符串**而不是让本文件去读一个 .js 文件：
 * `tsc` 不拷资源文件，独立文件会让 dev（读 src/）与打包产物（读 dist/）走上
 * 两条不同的路径。详见 webapp-sdk.ts 里 SDK_SOURCE 的说明。
 */
function readSdkSource(): string {
  return SDK_SOURCE;
}

/**
 * 供应商化的 DOM 截图库在磁盘上的位置。
 *
 * ⚠️ **`'../..'` 的深度与 `webappsRoot()` 同源**：产物在 `server/dist/services/`，
 * 往上两级才是 `server/`；打包后是 `resources/server/dist/services/` → `resources/server/`。
 * **不要照抄 `routes/upload.ts` 的 `'../../uploads'`**（那是从 `dist/routes/` 往上两级，
 * 深度相同但基准不同）。dev 与打包走同一条路径，是这里唯一要保证的事。
 */
function shotPath(): string {
  return path.join(__dirname, '../../vendor/snapdom.js');
}

/**
 * 读一次，之后常驻内存。
 *
 * 247KB 常驻是可以接受的；每次请求都 `readFileSync` 则会让每个学生的每次页面加载
 * 都摸一次磁盘 —— 而这是个老 iPad 场景，页面加载本来就不宽裕。
 *
 * **不做「文件变了自动重读」**：升级会重启服务，缓存自然失效。反过来，加上 mtime 检查
 * 只会多一条要维护、且几乎不会被走到的分支。
 *
 * 读不到就返回 `null`，由调用点决定怎么应答（现在是 503 + 一行能直接指向 README 的报错）。
 */
let shotCache: string | null | undefined;
function readShotSource(): string | null {
  if (shotCache !== undefined) return shotCache;
  try {
    shotCache = fs.readFileSync(shotPath(), 'utf8');
  } catch {
    shotCache = null;
  }
  return shotCache;
}
