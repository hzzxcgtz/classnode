import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { safeExtractZip } from '../services/upload-security.js';
import { scanExternalDeps } from '../services/webapp-external-deps.js';
import { webappsRoot } from '../services/webapp-host.js';

const _require = createRequire(import.meta.url);
const router: Router = Router();

/**
 * 上传上限。集中在这里，教师端提示文案与它对齐（不要让两处各写一个数字）。
 */
export const WEBAPP_LIMITS = {
  maxFiles: 500,
  maxSingleFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
} as const;

/**
 * 扩展名白名单（规格 §5.2）。
 *
 * ⚠️ **服务端脚本一个都不给**：本模块只做静态托管，`.php` / `.jsp` / `.asp` / `.cgi`
 * 之类被下载走也不会执行，但放它们进来等于给未来的某个配置错误留一个执行面。
 * 这一类是**显式拒绝**而不是「不在白名单里所以顺带被拒」—— 理由是拒绝时的文案要
 * 说得具体（「本模块只托管静态网页」比「扩展名不支持」有用）。
 */
const REJECTED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'jsp', 'jspx', 'asp', 'aspx', 'cgi', 'pl', 'py', 'rb', 'sh',
]);

const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm',
  'wasm', 'txt', 'csv', 'md',
]);

/**
 * 扫描外部依赖时值得读的文件类型。二进制（图片/字体/音视频/wasm）读成 utf8 只是浪费。
 * 单文件读取上限另有一道 —— 见 EXTERNAL_DEP_READ_LIMIT。
 */
const SCANNABLE_EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md']);
const EXTERNAL_DEP_READ_LIMIT = 2 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WebappUploadFile {
  path: string;
  size: number;
}

/**
 * 上传校验。**顺序本身是设计**，每一步都写清了为什么排在那个位置。
 *
 * ⚠️ 本函数**不是**唯一一道防线，也不能被当成唯一一道：
 * `safeExtractZip`（upload-security.ts:61）防的是**写出目录**（路径穿越/绝对路径/总量），
 * 本函数防的是**托管不该托管的东西**（扩展名、入口、服务端脚本）。
 * ZIP 经 safeExtractZip 解压后**必须再跑一次本函数** —— 只查路径与体积那一层
 * 对 `.php` 一个字都不会说。
 */
export function validateWebappUpload(
  files: readonly WebappUploadFile[],
  entryHint?: string,
): { ok: true; entry: string } | { ok: false; reason: string } {
  // 1. 路径安全最先 —— 它关乎「能不能写出目录」，比任何业务校验都优先。
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      return { ok: false, reason: `不允许绝对路径：${file.path}` };
    }
    const segments = normalized.split('/');
    if (segments.some(s => s === '..' || s === '.' || s === '')) {
      return { ok: false, reason: `路径含非法片段：${file.path}` };
    }
  }

  // 2. 数量与体积。放在扩展名前 —— 一个 5000 文件的包不值得逐个查扩展名。
  if (files.length > WEBAPP_LIMITS.maxFiles) {
    return { ok: false, reason: `文件数超过上限 ${WEBAPP_LIMITS.maxFiles}` };
  }
  let total = 0;
  for (const file of files) {
    if (file.size > WEBAPP_LIMITS.maxSingleFileBytes) {
      return { ok: false, reason: `单个文件超过上限 ${WEBAPP_LIMITS.maxSingleFileBytes / 1024 / 1024}MB：${file.path}` };
    }
    total += file.size;
  }
  if (total > WEBAPP_LIMITS.maxTotalBytes) {
    return { ok: false, reason: `总大小超过上限 ${WEBAPP_LIMITS.maxTotalBytes / 1024 / 1024}MB` };
  }

  // 3. 扩展名。
  for (const file of files) {
    const name = file.path.replace(/\\/g, '/').split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return { ok: false, reason: `文件必须有扩展名：${file.path}` };
    const ext = name.slice(dot + 1).toLowerCase();
    if (REJECTED_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `本模块只托管静态网页，不接受服务端脚本：${file.path}` };
    }
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `不支持的文件类型 .${ext}：${file.path}` };
    }
  }

  // 4. 入口。放在最后 —— 前面都过了才谈得上「入口是哪个」。
  //    大小写不敏感：教师导出时写成 INDEX.HTML 很常见。
  const htmlFiles = files.filter(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm'));
  if (htmlFiles.length === 0) {
    return { ok: false, reason: '压缩包/所选文件中必须包含入口 HTML（如 index.html）' };
  }
  // 教师显式指定的一律优先，压过下面的 index.html 启发式。
  if (entryHint) {
    const hit = files.find(f => f.path === entryHint);
    if (!hit) return { ok: false, reason: `指定的入口文件不存在：${entryHint}` };
    return { ok: true, entry: hit.path };
  }
  // **优先挑 index.html**，找不到才退回「第一个 .html」。
  //
  // 为什么不能只用「第一个」：ZIP 路径下「第一个」是 `walkTree` 的 readdir 顺序
  // （约等于字典序），而不是任何人的选择。规格 §5.2 那句「首个 .html 作入口」的语境是
  // **教师多选文件时的勾选顺序**，搬到 ZIP 上就失去了原意 —— 一个再常规不过的站点
  // （about.html / contact.html / index.html）会被判成 `about.html`，学生打开看到的是
  // 「关于」页而不是首页。那是「上传成功但打不开**对的那个首页**」。
  //
  // 只在「没有显式 entryHint」时生效，且**找不到 index.html 时行为与从前逐字一致**
  // （仍退回 htmlFiles[0]）—— 没有 index.html 的包不能被判成「没有入口」。
  const indexFile = htmlFiles.find(f => {
    const base = (f.path.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
    return base === 'index.html' || base === 'index.htm';
  });
  return { ok: true, entry: (indexFile ?? htmlFiles[0]).path };
}

// ── 磁盘路径 ────────────────────────────────────────────────────────

/**
 * 把「webappsRoot 之下的相对路径」解析成绝对路径；越界一律返回 null。
 *
 * ⚠️ 这是删盘路径上唯一的一道闸门 —— 照 agents.ts:69-76 的 `deleteManagedLogo` 手法：
 * **先证明目标确实在受管根目录之内，再动手**。一个被污染的 id（或将来某次改成
 * 从请求里取目录名）没有这道判断就是任意删除。
 */
export function resolveInsideWebappsRoot(relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  // `.` / `..` 一律拒绝，**不论归一化后是否仍在根内** —— 与 T1 的 resolveWebappFile 同款取舍。
  // `./x` 归一化后确实是 `<root>/x`（没越界），但那样一来「这个函数安全」就依赖读者
  // 在心算归一化结果，而不是依赖一个可以直接断言的性质。安全边界上宁可选后者。
  // 反斜杠先归一成 `/`，免得 Windows 写法（`..\..\x`）绕过按 `/` 切分的判断。
  const segments = relativePath.replace(/\\/g, '/').split('/');
  if (segments.some(s => s === '.' || s === '..')) return null;
  const root = path.resolve(webappsRoot());
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * 删除某个网页的磁盘目录。返回是否真的删了。
 *
 * id 由服务端 randomUUID 生成，但删盘这件事**不接受「它一定是安全的」这种假设** ——
 * 两道判断（uuid 形状 + 根目录之内）都过了才动手。
 */
export function removeWebappDir(id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false;
  const target = resolveInsideWebappsRoot(id);
  if (!target) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

/**
 * 建（或确认）某个网页的存储目录。
 *
 * ⚠️ **必须自己 mkdir**：Tauri 侧只预建 `$DATA_DIR/webapps`，dev 下 `<server>/webapps`
 * 根本不存在（webapp-host.ts 的兜底分支），不建的话**首次上传就失败**。
 * 照抄 routes/upload.ts:20-21 的既有做法。
 */
function createWebappDir(id: string): string {
  const target = resolveInsideWebappsRoot(id);
  if (!target) throw new Error('存储目录越界');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

/** 把包内相对路径安全地解析到某个目录之下；越界返回 null。 */
function resolveInDir(root: string, relativePath: string): string | null {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(s => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some(s => s === '.' || s === '..')) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (!target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

// ── 解压后的树 ──────────────────────────────────────────────────────

function walkTree(root: string): { files: WebappUploadFile[]; symlinks: string[] } {
  const files: WebappUploadFile[] = [];
  const symlinks: string[] = [];

  const visit = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      // ⚠️ 先判符号链接再判目录：`isDirectory()` 对符号链接可能为真（取决于平台），
      // 一旦递归进去就等于跟着链接走出了根 —— 那正是 T1 审查实测到的洞
      // （`ln -s ../OUTSIDE.html webapps/link.html` → 200 且正文泄漏）。
      // 本函数**从不递归进符号链接，也从不用 statSync/readFileSync**（那两个默认跟随）。
      if (entry.isSymbolicLink()) {
        symlinks.push(rel);
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue; // FIFO / socket 之类一律忽略
      let size = 0;
      try {
        size = fs.lstatSync(abs).size;
      } catch {
        continue;
      }
      files.push({ path: rel, size });
    }
  };

  visit(root, '');
  return { files, symlinks };
}

/**
 * 列出解压出的树里所有符号链接（包内相对路径）。
 *
 * 裁定（T1 审查 M3）：解压后**发现任何符号链接就拒绝整个上传**，不是默默删掉 ——
 * 默默删掉会让教师的包「看起来传成功了但少了东西」，而教师没有任何办法知道。
 */
export function findSymlinks(root: string): string[] {
  return walkTree(root).symlinks;
}

function isHtmlPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

/**
 * 清掉 macOS「压缩」带进来的元数据：顶层 `__MACOSX/` 与任意位置的 `._*` / `.DS_Store`。
 *
 * 为什么必须清（不是洁癖，是功能性故障）：
 *   · `__MACOSX/myproject/._index.html` 同样以 `.html` 结尾，会参与**入口判定**，
 *     有可能被选成入口 —— 那是一个 AppleDouble 二进制块，浏览器打开是白屏。
 *   · 「唯一顶层项是目录」的提升规则会被 `__MACOSX` 直接打破，于是教师在 Finder 里
 *     压缩一个文件夹上传，得到的是「上传成功但打不开」—— 本模块最想避免的那个故障。
 * 这些条目对网页本身没有任何作用，删掉是安全的。
 *
 * ⚠️ 调用时机：**必须在符号链接闸门之后**。本函数会删东西，不能跑在安全判断之前。
 */
function pruneMacMetadata(root: string): void {
  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // 符号链接在更早的闸门里已经被判死；走到这里说明没有符号链接，
      // 但仍显式跳过，避免本函数成为「跟着链接删到根外」的那一处。
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && entry.name === '__MACOSX') {
          fs.rmSync(abs, { recursive: true, force: true });
          continue;
        }
        visit(abs, depth + 1);
        continue;
      }
      if (entry.name === '.DS_Store' || entry.name.startsWith('._')) {
        try {
          fs.rmSync(abs, { force: true });
        } catch {}
      }
    }
  };
  visit(root, 0);
}

/**
 * ZIP 有多层根目录是常态（教师压缩时选了文件夹 ⇒ 包里是 `myproject/index.html`）。
 * 不处理会得到一个「上传成功但打不开」的经典故障。
 *
 * 判定条件三者同时成立才动手：唯一顶层项、它是目录、它（递归）含 HTML。
 * 「含 HTML」这一条不能省：一个只装资源的包提升它没有意义，反而把结构拆散了。
 *
 * 只提升**一层**。两层以上（`a/b/index.html`）通常意味着教师有意保留了结构，
 * 而且再提一层就可能把 `pages/` 这类有意义的目录吃掉。
 */
export function hoistSingleRoot(dest: string): { hoisted: boolean; prefix: string } {
  let entries: string[];
  try {
    entries = fs.readdirSync(dest);
  } catch {
    return { hoisted: false, prefix: '' };
  }
  if (entries.length !== 1) return { hoisted: false, prefix: '' };

  const only = path.join(dest, entries[0]);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(only);
  } catch {
    return { hoisted: false, prefix: '' };
  }
  if (!stat.isDirectory()) return { hoisted: false, prefix: '' };
  if (!walkTree(only).files.some(f => isHtmlPath(f.path))) return { hoisted: false, prefix: '' };

  for (const child of fs.readdirSync(only)) {
    fs.renameSync(path.join(only, child), path.join(dest, child));
  }
  fs.rmdirSync(only);
  return { hoisted: true, prefix: entries[0] };
}

// ── 上传临时文件 ────────────────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), 'classnode-webapp-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, _file, cb) => cb(null, `webapp-${crypto.randomUUID()}.upload`),
});

const upload = multer({
  storage,
  limits: {
    // 单个 zip 最大按「解压后总量上限」收 —— 压缩包比它自己的解压结果还大是没有意义的。
    fileSize: WEBAPP_LIMITS.maxTotalBytes,
    files: WEBAPP_LIMITS.maxFiles,
  },
});

// `files[]` 与 `files` 都收：字段名带不带方括号是前端拼 FormData 的写法差异，
// 不该让教师看到一个「没选文件」的假报错。
const webappUpload = upload.fields([
  { name: 'archive', maxCount: 1 },
  { name: 'files', maxCount: WEBAPP_LIMITS.maxFiles },
  { name: 'files[]', maxCount: WEBAPP_LIMITS.maxFiles },
]);

interface CollectedUploads {
  archive?: Express.Multer.File;
  loose: Express.Multer.File[];
}

function collectedFiles(req: import('express').Request): CollectedUploads {
  const map = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return {
    archive: map.archive?.[0],
    loose: [...(map.files ?? []), ...(map['files[]'] ?? [])],
  };
}

function discardUploads(files: CollectedUploads): void {
  for (const file of [...(files.archive ? [files.archive] : []), ...files.loose]) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

/**
 * multipart 的 filename 默认按 latin1 解码，中文名会变成乱码。
 * 只在出现非 ASCII 字符时尝试按 UTF-8 重新解释，并用往返校验确认（含 U+FFFD 就放弃原值）。
 */
function decodeUploadName(raw: string): string {
  if (!/[^\x00-\x7F]/.test(raw)) return raw;
  if ([...raw].some(ch => ch.charCodeAt(0) > 0xff)) return raw;
  const reinterpreted = Buffer.from(raw, 'latin1').toString('utf8');
  return reinterpreted.includes('�') ? raw : reinterpreted;
}

class UploadRejected extends Error {}

// ── 路由 ────────────────────────────────────────────────────────────

/** 对外形状：只给 id / name / entryPath 与时间戳，磁盘位置一概不出现在响应里。 */
const PUBLIC_WEBAPP_SELECT = {
  id: true,
  name: true,
  entryPath: true,
  createdAt: true,
  updatedAt: true,
} as const;

// 列出所有网页
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const webapps = await prisma.webapp.findMany({
      select: PUBLIC_WEBAPP_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    // 每个网页被多少个课堂关联 —— 管理页的概览条与「按关联状态筛选」都要用它。
    //
    // ⚠️ **一次取全再在 JS 里统计，不要在 map 里逐个 count**（那是 N+1：教师传了
    //    30 个网页就是 31 次查询）。`webapps` 为空时索性不发这条查询。
    //
    // 🔴 **必须 union 两张表**（与下面 `/:id/usage`、DELETE 守卫同一条口径）：
    //    `ClassroomWebapp`（课堂级，标准/分组模式）与
    //    `ClassroomGroupMaterial(kind='webapp')`（组级，高级模式每组一份）。
    //    只数前者时，高级模式下被小组引用的网页会显示成「未关联」——概览条的数字、
    //    「按关联状态筛选」的结果、卡片左边那条色条（`used = classroomCount > 0`）
    //    会一起说错，而教师照着去清理时删除守卫回 400 挡住，两边自相矛盾。
    const classroomCounts = new Map<string, Set<string>>();
    if (webapps.length > 0) {
      const ids = webapps.map(webapp => webapp.id);
      const [classroomLinks, groupMaterials] = await Promise.all([
        prisma.classroomWebapp.findMany({
          where: { webappId: { in: ids } },
          select: { webappId: true, classroomId: true },
        }),
        prisma.classroomGroupMaterial.findMany({
          where: { kind: 'webapp', targetId: { in: ids } },
          select: { targetId: true, group: { select: { classroomId: true } } },
        }),
      ]);
      // 按**课堂**去重，不是按行数。`ClassroomWebapp` 有 `@@unique([classroomId, webappId])`
      // ⇒ 课堂级那一支本来就「一行 = 一间课堂」，去重不改变它原来的数；
      // 组级那一支同一间课堂可以有多个组引用同一个网页，按行数会把它数成好几间课堂。
      // 口径与 `/:id/usage` 的 `classroomCount`（那里是 `byClassroomId` 那张表）一致。
      const addLink = (webappId: string, classroomId: string) => {
        const classrooms = classroomCounts.get(webappId) ?? new Set<string>();
        classrooms.add(classroomId);
        classroomCounts.set(webappId, classrooms);
      };
      for (const link of classroomLinks) addLink(link.webappId, link.classroomId);
      for (const material of groupMaterials) addLink(material.targetId, material.group.classroomId);
    }

    res.json(webapps.map(webapp => ({
      ...webapp,
      classroomCount: classroomCounts.get(webapp.id)?.size ?? 0,
    })));
  } catch (error) {
    console.error('[webapps] 获取网页列表失败:', error);
    res.status(500).json({ error: '获取网页列表失败' });
  }
});

// 单个网页
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const webapp = await prisma.webapp.findUnique({
      where: { id: req.params.id },
      select: PUBLIC_WEBAPP_SELECT,
    });
    if (!webapp) return res.status(404).json({ error: '网页不存在' });
    res.json(webapp);
  } catch (error) {
    res.status(500).json({ error: '获取网页失败' });
  }
});

// 检查网页是否被课堂使用（照 agents.ts 的同名端点）
//
// `used` / `classroomCount` 是删除守卫的判据，原样不动；`classrooms` 是新增的课堂清单，
// 给「无法删除」弹窗和卡片上的「关联课堂」入口用。
//
// 🔴 **必须 union 两张表**：`ClassroomWebapp`（课堂级，标准/分组模式）与
// `ClassroomGroupMaterial(kind='webapp')`（组级，高级模式每组一份）。
// 网页这一侧**今天只有课堂级一条路径**，加了组级之后变**两条** —— 这正是最容易漏的地方。
// 只查前者不会报错，只会让「用了这个网页的高级课堂」整个从清单里消失 ⇒
// 界面显示「没有关联」、教师照着去删、删除守卫却回 400，两边自相矛盾。
// ⚠️ 两条路径都命中同一个课堂时要去重（照 agents.ts 的 Set 写法），
// 否则 `classroomCount` 会把同一间课堂数两次。
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomLinks = await prisma.classroomWebapp.findMany({
      where: { webappId: req.params.id },
      include: { classroom: { select: { id: true, title: true, status: true, mode: true } } },
    });
    const groupMaterials = await prisma.classroomGroupMaterial.findMany({
      where: { kind: 'webapp', targetId: req.params.id },
      include: { group: { select: { classroom: { select: { id: true, title: true, status: true, mode: true } } } } },
    });
    const byClassroomId = new Map<string, { id: string; title: string; status: string; mode: string }>();
    const collect = (rows: Array<{ classroom: { id: string; title: string | null; status: string; mode: string } }>) => {
      rows.forEach(row => {
        if (byClassroomId.has(row.classroom.id)) return;
        byClassroomId.set(row.classroom.id, {
          id: row.classroom.id,
          title: row.classroom.title || '未命名课堂',
          status: row.classroom.status,
          mode: row.classroom.mode,
        });
      });
    };
    collect(classroomLinks);
    collect(groupMaterials.map(material => ({ classroom: material.group.classroom })));
    const classrooms = [...byClassroomId.values()];
    res.json({
      used: classrooms.length > 0,
      classroomCount: classrooms.length,
      classrooms,
    });
  } catch (error) {
    res.status(500).json({ error: '查询失败' });
  }
});

/**
 * 上传网页。两条路径：
 *   · `archive`：单个 .zip，解压到 `<webappsRoot>/<uuid>/`
 *   · `files` / `files[]`：多选文件，逐个拷进 `<webappsRoot>/<uuid>/`
 *
 * 解压**直接落在最终目录**（不是先解到临时目录再搬）：少一次全量拷贝，
 * 而 uuid 是刚生成的、库里还没有行，没有任何客户端知道这个地址。
 * 校验失败时把整个目录 `rmSync` 掉，不留半成品。
 */
router.post('/', webappUpload, async (req, res) => {
  const uploaded = collectedFiles(req);
  const id = crypto.randomUUID();
  let dest: string;

  try {
    dest = createWebappDir(id);
  } catch (error) {
    discardUploads(uploaded);
    console.error('[webapps] 创建存储目录失败:', error);
    return res.status(500).json({ error: '创建存储目录失败' });
  }

  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const name = (rawName || '未命名网页').slice(0, 120);
    let entryHint = typeof body.entryHint === 'string' && body.entryHint.trim() ? body.entryHint.trim() : undefined;

    if (uploaded.archive) {
      if (path.extname(uploaded.archive.originalname).toLowerCase() !== '.zip') {
        throw new UploadRejected('网页压缩包必须是 .zip 文件');
      }
      const AdmZip = _require('adm-zip');
      let zip: unknown;
      try {
        zip = new AdmZip(uploaded.archive.path);
      } catch {
        throw new UploadRejected('压缩包无法读取，请确认是一个有效的 ZIP 文件');
      }
      try {
        // 第一层：防写出目录（路径穿越 / 绝对路径 / 总量 / 单文件）。
        // ⚠️ 这一层对扩展名一个字都不会说 —— 所以下面还要跑 validateWebappUpload。
        safeExtractZip(zip as Parameters<typeof safeExtractZip>[0], dest, WEBAPP_LIMITS);
      } catch (error) {
        throw new UploadRejected(`压缩包解压失败：${error instanceof Error ? error.message : '内容异常'}`);
      }
    } else if (uploaded.loose.length > 0) {
      // 先按清单做一次前置校验，注定被拒的包不必先落到磁盘上。
      const listing = uploaded.loose.map(file => ({
        path: decodeUploadName(file.originalname),
        size: file.size,
        source: file.path,
      }));
      const pre = validateWebappUpload(listing, entryHint);
      if (!pre.ok) throw new UploadRejected(pre.reason);
      for (const item of listing) {
        const target = resolveInDir(dest, item.path);
        if (!target) throw new UploadRejected(`路径非法：${item.path}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(item.source, target);
      }
    } else {
      throw new UploadRejected('请选择要上传的网页压缩包（.zip）或网页文件');
    }

    // ── 符号链接闸门（T1 审查 M3）────────────────────────────────
    // 解压/拷贝完成后遍历整棵树，**发现任何符号链接就拒绝整个上传**。
    // 不默默删掉：那会让教师的包「看起来传成功了但少了东西」，而教师无从知道。
    //
    // ⚠️ 实测（见测试与报告）：safeExtractZip 用 fs.writeFileSync 落盘，ZIP 里
    // mode=0o120777 的条目会被**摊平成普通文件**，所以今天的 ZIP 路径根本产生不出
    // 符号链接 —— 这道闸门防的是**别的写入路径**（将来换成别的解压器、教师手工
    // 往 webappsRoot 里放文件），以及 T1 已实测的「静态服务会跟随符号链接」。
    // 它是深度防御，不是当前唯一的防线；这一点不含糊其辞。
    const links = findSymlinks(dest);
    if (links.length > 0) {
      throw new UploadRejected(`压缩包内含符号链接，已拒绝整个上传：${links.slice(0, 3).join('、')}`);
    }

    pruneMacMetadata(dest);

    const hoist = hoistSingleRoot(dest);
    if (hoist.hoisted && entryHint?.startsWith(`${hoist.prefix}/`)) {
      entryHint = entryHint.slice(hoist.prefix.length + 1);
    }

    const listing = walkTree(dest).files;
    // 第二层：扩展名、入口、服务端脚本。safeExtractZip 只管路径与体积，这一层不能省。
    const verdict = validateWebappUpload(listing, entryHint);
    if (!verdict.ok) throw new UploadRejected(verdict.reason);

    const externalDeps = scanExternalDepsSafe(dest, listing);

    const webapp = await prisma.webapp.create({
      data: { id, name, entryPath: verdict.entry },
      select: PUBLIC_WEBAPP_SELECT,
    });
    res.json({ ...webapp, externalDeps });
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    if (error instanceof UploadRejected) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[webapps] 上传网页失败:', error);
    res.status(500).json({ error: '上传网页失败' });
  } finally {
    discardUploads(uploaded);
  }
});

/**
 * 列出某个网页包里的 HTML 入口候选。
 *
 * 存在的唯一理由：`PUT /:id` 允许教师改指另一个入口，而**没有这个列表，UI 就只能让教师
 * 手打一个路径** —— 打错了服务端会 400（「指定的入口文件不存在」），但教师在那之前
 * 无从知道包里到底有哪些 HTML。
 *
 * ⚠️ **只回 HTML，不回整棵树**：整棵树会把服务端的目录结构（哪些资源、怎么组织）
 * 顺带告诉客户端，而这里需要的信息只有「入口能选哪几个」。路径是**包内相对路径**，
 * 绝对路径与 `webappsRoot` 都不出现在响应里（与 PUBLIC_WEBAPP_SELECT 同一条口径）。
 *
 * 上限 500 与 WEBAPP_LIMITS.maxFiles 对齐：超过它的包上传时就被拒了，这里只是兜底。
 */
router.get('/:id/entries', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const webapp = await prisma.webapp.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!webapp) return res.status(404).json({ error: '网页不存在' });
    const dir = resolveInsideWebappsRoot(req.params.id);
    if (!dir) return res.status(404).json({ error: '网页不存在' });
    const entries = walkTree(dir).files
      .map(file => file.path)
      .filter(isHtmlPath)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, WEBAPP_LIMITS.maxFiles);
    res.json({ entries });
  } catch (error) {
    console.error('[webapps] 列出入口失败:', error);
    res.status(500).json({ error: '列出入口失败' });
  }
});

/**
 * 更新网页：**只做两件事** —— 改名，或改指另一个入口 HTML。
 *
 * ⚠️ **它不做什么（说清边界比说清功能重要）：**
 *   · **不接受替换网页内容。** 没有 `archive` / `files` 字段，传了也一律忽略。
 *     内容变了应当是**新建一个 Webapp**，而不是就地替换 —— 否则已经引用它的课堂
 *     （`ClassroomWebapp` 行指向的是这个 id）会在教师毫无察觉的情况下**静默换内容**，
 *     学生看到的网页中途变了，而课堂记录里没有任何痕迹指向那次替换。
 *   · 不能改 `id`（它就是磁盘目录名，改了等于换一个网页）。
 *   · 不能改关联的课堂（那是课堂创建/编辑路径的事，不是本资源的属性）。
 *
 * 入口可以改是因为「多 HTML 时取第一个」只是启发式（按遍历顺序），一个包里同时有
 * `index.html` 与 `demo.html` 时教师可能想要后者，而重传整个包的代价太大。
 */
router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const existing = await prisma.webapp.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: '网页不存在' });

    const data: { name?: string; entryPath?: string } = {};
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120);

    if (typeof body.entryPath === 'string' && body.entryPath.trim()) {
      const wanted = body.entryPath.trim();
      const dir = resolveInsideWebappsRoot(req.params.id);
      const target = dir ? resolveInDir(dir, wanted) : null;
      // 入口必须真实存在且是 HTML —— 否则教师会得到一个「保存成功但打不开」的网页，
      // 而那正是本模块最想避免的故障类型。
      if (!target || !fs.existsSync(target) || !isHtmlPath(wanted)) {
        return res.status(400).json({ error: '指定的入口文件不存在' });
      }
      data.entryPath = wanted;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: '没有需要更新的内容' });

    const webapp = await prisma.webapp.update({
      where: { id: req.params.id },
      data,
      select: PUBLIC_WEBAPP_SELECT,
    });
    res.json(webapp);
  } catch (error) {
    console.error('[webapps] 更新网页失败:', error);
    res.status(500).json({ error: '更新网页失败' });
  }
});

// 删除网页（照 agents.ts:353-376）
router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const webapp = await prisma.webapp.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!webapp) return res.status(404).json({ error: '网页不存在' });

    // 🔴 两条关联路径都要数：课堂级（`ClassroomWebapp`）与组级
    // （`ClassroomGroupMaterial(kind='webapp')`，高级模式每组一份）。
    // 漏掉组级那一支 ⇒ 删掉一个只被组级材料引用的网页，留下一行**悬空 targetId**
    // （`targetId` 没有真外键，数据库不会拦），那个组从此读不到网页、界面显示成「未配置」，
    // 而教师以为自己只是删了一个没人用的网页。
    const [classroomCount, groupMaterialCount] = await Promise.all([
      prisma.classroomWebapp.count({ where: { webappId: req.params.id } }),
      prisma.classroomGroupMaterial.count({ where: { kind: 'webapp', targetId: req.params.id } }),
    ]);
    if (classroomCount > 0 || groupMaterialCount > 0) {
      return res.status(400).json({
        error: `该网页已被 ${classroomCount} 个课堂和 ${groupMaterialCount} 个小组使用，无法删除。请先从这些课堂中移除后再试。`,
      });
    }

    await prisma.webapp.delete({ where: { id: req.params.id } });
    removeWebappDir(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[webapps] 删除网页失败:', error);
    res.status(500).json({ error: '删除网页失败' });
  }
});

/**
 * 扫描外部依赖。
 *
 * ⚠️ 只是提醒，**绝不阻断上传** —— 所以整段包在 try/catch 里：一个扫描器的 bug
 * 不该让教师传不了网页。
 *
 * ⚠️ 返回值**只有数量与文件名，没有 URL**。scanExternalDeps 的 url 字段只保证
 * 「识别出这是一条外部依赖」，不保证完整（CSS 里含 `;` 的地址会被截断，Google Fonts
 * 就是），T2 的字段文档明确要求消费方不要原样展示。**字段不存在，后面的人就没法
 * 顺手把它列出来给教师看** —— 这是结构性约束，不是 UI 约定。
 */
function scanExternalDepsSafe(dest: string, listing: readonly WebappUploadFile[]): { count: number; files: string[] } {
  try {
    const sources: { path: string; content: string }[] = [];
    for (const file of listing) {
      const ext = (file.path.split('.').pop() ?? '').toLowerCase();
      if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
      if (file.size > EXTERNAL_DEP_READ_LIMIT) continue;
      const target = resolveInDir(dest, file.path);
      if (!target) continue;
      sources.push({ path: file.path, content: fs.readFileSync(target, 'utf8') });
    }
    const deps = scanExternalDeps(sources);
    return { count: deps.length, files: [...new Set(deps.map(d => d.file))] };
  } catch (error) {
    console.warn('[webapps] 外部依赖扫描失败（不阻断上传）:', error);
    return { count: 0, files: [] };
  }
}

/**
 * 课堂关联的网页，下发给学生端与教师端看板。
 *
 * ⚠️ **只发 id / name / entryPath** —— 学生端拼 URL 只需要 `id` 与 `entryPath`
 * （`${origin}/webapps/${id}/${entryPath}`）。多发一个字段就等于把服务端的目录结构
 * 告诉客户端。`id` 就是磁盘目录名，这是设计上刻意对齐的，但磁盘**根路径**不出现在响应里。
 *
 * ⚠️ 两处（`GET /api/classroom/code/:code` 与 `GET /api/classroom/:id`）**共用本函数**，
 * 避免两条路径口径不一。
 *
 * ⚠️ 读路径不可失败：ClassroomWebapp 表缺失（老库启动 DDL 被跳过）时降级为空数组，
 * 绝不能因为查不到网页把学生挡在课堂门外 —— 与 classroom.ts 里 modules 的处理同款。
 */
export async function loadClassroomWebapps(
  prisma: PrismaClient,
  classroomId: string,
): Promise<{ id: string; name: string; entryPath: string }[]> {
  type Row = { webapp: { id: string; name: string; entryPath: string } };
  let rows: Row[] = [];
  try {
    rows = await prisma.classroomWebapp.findMany({
      where: { classroomId },
      select: { webapp: { select: { id: true, name: true, entryPath: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  } catch {
    // 老库缺表时 Prisma 拒绝的是一个 Promise，而「模型整个不存在」时是**同步**抛。
    // 用 try/catch 而不是 `.catch()`：后者接不住同步那种，会让整个读端点 500 ——
    // 也就是「因为查不到网页，学生进不了课堂」，正是这里要避免的。
    return [];
  }
  return rows.map(row => ({ id: row.webapp.id, name: row.webapp.name, entryPath: row.webapp.entryPath }));
}

/** 把 Multer 的默认 HTML/文本错误转换为前端可直接展示的 JSON（照 upload.ts 的 handleUploadError）。 */
const handleUploadError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      // ⚠️ 这里必须报 maxTotalBytes，不是 maxSingleFileBytes：multer 的 `limits.fileSize`
      // 是**单个上传文件在磁盘上的大小**（zip 本体），上面设的就是 maxTotalBytes(80MB)。
      // 曾经写的是 maxSingleFileBytes(25MB) —— 教师传一个 84MB 的 zip 会被告知「不能超过
      // 25MB」，而他实际撞的是 80MB 那道闸门，数字对不上。单文件 25MB 那条限制由
      // validateWebappUpload 在**解压后逐个文件**判（那里的文案才是 25MB），两条闸门不同。
      res.status(400).json({ error: `上传文件不能超过 ${WEBAPP_LIMITS.maxTotalBytes / 1024 / 1024}MB` });
      return;
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `文件数超过上限 ${WEBAPP_LIMITS.maxFiles}` });
      return;
    }
    res.status(400).json({ error: '上传请求无效' });
    return;
  }
  if (error) {
    console.error('[webapps] 上传请求失败:', error);
    res.status(400).json({ error: '上传请求无效' });
    return;
  }
  next();
};
router.use(handleUploadError);

export { router as webappRoutes };
export default router;
