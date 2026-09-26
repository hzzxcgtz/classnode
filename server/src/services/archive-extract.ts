/**
 * ★ 探究网页上传的**唯一解压入口**。
 *
 * 🔴 为什么要有这个文件，而不是让路由自己 `new AdmZip`：
 *   ① **限值策略只写一处**（`WEBAPP_LIMITS` 传进来），三种格式不会各有一套；
 *   ② `.zip` 那条路走的是**已经审过的** `safeExtractZip`（我们自己逐条校验路径与体积），
 *      `.rar` / `.7z` 走 7z-wasm（7-Zip 自己解压，我们事后走一遍内存 FS 再拷出来）。
 *      两条路的保证强度**不一样**，把它们并排写在一个函数里，这件事才看得见。
 *
 * ⚠️ **不要把这个文件接到 `routes/export.ts` 的备份恢复上去。** 那三处的上限是
 * 1GB / 300MB，走 7z-wasm 的话（实测解压后 120MB 的包会让进程 RSS 到 1184MB，约 10x）
 * 会在内存上直接死。那边继续用 `safeExtractZip`。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { safeExtractZip } from './upload-security.js';

const _require = createRequire(import.meta.url);

export type ArchiveKind = 'zip' | 'rar' | '7z';

export interface ArchiveLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxSingleFileBytes: number;
}

/** 教师能看懂的上传失败。路由据类型回 400，其余错误回 500。 */
export class ArchiveError extends Error {}

const KIND_BY_EXTENSION: Record<string, ArchiveKind> = {
  '.zip': 'zip',
  '.rar': 'rar',
  '.7z': '7z',
};

/**
 * 后缀 → 归档种类。**大小写不敏感** —— 教师导出的包叫 `SITE.ZIP` / `资源.RAR` 很常见，
 * 用 `endsWith('.zip')` 那种写法会把它们静默判成「不支持的类型」。
 */
export function archiveKindOf(filename: string): ArchiveKind | null {
  return KIND_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? null;
}

export interface SevenZipListing {
  fileCount: number;
  declaredTotalBytes: number;
  declaredMaxFileBytes: number;
  encrypted: boolean;
}

/**
 * 解析 `7z l -slt -ba` 的输出。
 *
 * ⚠️ **只取数字与标记，绝不取 `Path`。** 实测：含非 ASCII 文件名时这段文本会乱码
 * （`图片` → `￥ﾛﾾ￧ﾉﾇ`，UTF-8 字节被当半个假名读了）。路径一律等解压完从内存 FS 里读
 * —— 那里的名字**是对的**（三种格式都验过）。
 *
 * 块以空行分隔。`Folder = +` 是目录，不计入文件数与体积。
 */
export function parseSevenZipListing(text: string): SevenZipListing {
  let fileCount = 0;
  let declaredTotalBytes = 0;
  let declaredMaxFileBytes = 0;
  let encrypted = false;

  // 🔴 **先把 CRLF / 裸 CR 归一成 LF，这不是洁癖。** T2 复核实测过：喂 `\r\n` 进来时
  //    `'\n\n'` 这个分隔符**根本不出现**，整份输出塌成**一个**块；那个块里恰好有
  //    `Folder = +`（目录行），于是每一条 `continue` 都命中、返回**全零**。
  //    全零的列表会**静默通过每一条 declared-size 限值** —— 而那是挡在实测 1184MB
  //    内存事件前面的**唯一**一道闸门。低概率 + 失败时大开，所以在这里堵死。
  //    `\r\n?` 一条同时覆盖 CRLF 与**裸 CR**：裸 CR 的机理与后果**完全相同**（也塌成
  //    一块、也返回全零），实测过。
  //    （当前 7z-wasm 经 Emscripten 输出的是 LF，所以这是**保险**，不是修 bug。）
  const normalized = text.replace(/\r\n?/g, '\n');

  for (const block of normalized.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^Encrypted = \+$/m.test(trimmed)) encrypted = true;
    if (/^Folder = \+$/m.test(trimmed)) continue;
    const size = Number((trimmed.match(/^Size = (\d+)$/m) ?? [])[1] ?? 0);
    if (!Number.isFinite(size) || size < 0) continue;
    fileCount += 1;
    declaredTotalBytes += size;
    declaredMaxFileBytes = Math.max(declaredMaxFileBytes, size);
  }

  return { fileCount, declaredTotalBytes, declaredMaxFileBytes, encrypted };
}

export interface SafeExtractOptions {
  /** multer 落在临时目录里的那个文件。 */
  sourcePath: string;
  /** 教师上传时的原始文件名 —— **只看后缀**，决定走哪条路。 */
  originalName: string;
  /** 解压目标。校验失败时调用方负责把整个目录删掉。 */
  destination: string;
  limits: ArchiveLimits;
}

/**
 * 唯一的解压入口。**先判后缀，再分派**。
 *
 * ⚠️ 后缀与内容不符是存在的（rar 改名成 `.zip`）：zip 那条会走 AdmZip 然后失败，
 * 文案说「请确认是一个有效的 ZIP 文件」—— 这是**故意**的，比「不支持的文件类型」有用
 * （后者会让教师去改后缀，而问题不在后缀）。
 */
export async function safeExtractArchive(opts: SafeExtractOptions): Promise<{ kind: ArchiveKind }> {
  const kind = archiveKindOf(opts.originalName);
  if (!kind) throw new ArchiveError('只支持 ZIP / RAR / 7Z 压缩包');

  if (kind === 'zip') {
    const AdmZip = _require('adm-zip');
    let zip: unknown;
    try {
      zip = new AdmZip(opts.sourcePath);
    } catch {
      throw new ArchiveError('压缩包无法读取，请确认是一个有效的 ZIP 文件');
    }
    try {
      // 🔴 原样沿用既有实现：逐条校验路径穿越 / 绝对路径 / 声明体积 vs 实际体积 / 总量，
      //    再以 mode 0o600 落盘。这条路的保证是**我们自己写的**，不要包一层改动它。
      safeExtractZip(zip as Parameters<typeof safeExtractZip>[0], opts.destination, opts.limits);
    } catch (error) {
      throw new ArchiveError(`压缩包解压失败：${error instanceof Error ? error.message : '内容异常'}`);
    }
    return { kind };
  }

  return extractWithSevenZip(kind, opts);
}

/** emscripten 模块的形状（`require('7z-wasm')` 的返回值）。只列我们用到的。 */
interface SevenZipModule {
  FS: {
    mkdir(p: string): void;
    chdir(p: string): void;
    open(p: string, mode: string): number;
    write(stream: number, data: Uint8Array, offset: number, length: number): void;
    close(stream: number): void;
    readdir(p: string): string[];
    lstat(p: string): { mode: number; size: number };
    isDir(mode: number): boolean;
    isLink(mode: number): boolean;
    readFile(p: string): Uint8Array;
  };
  callMain(args: string[]): number;
}

const MEMFS_ARCHIVE = '/in/a';
const MEMFS_OUTPUT = '/out';

/**
 * 起一个实例，把归档写进它的内存 FS，`chdir` 到输出目录。
 *
 * ⚠️ **每次上传起一个新实例，不要池化，也不要跨请求留一个。** 实测：内存不会及时还回来
 * （解完一个小包后 RSS 从 46MB 停在 65MB）。上传是低频操作，这个代价可以接受；
 * 而留一个全局实例会把这份内存**永久**挂住。
 * ⚠️ 同一个实例可以连着调多次 `callMain`（实测 `l` → `x` → `l` 三次全返回 0），
 * 所以列表和解压**共用这一个实例**，不必起两个。
 */
async function openSevenZip(sourcePath: string): Promise<{ sz: SevenZipModule; read: () => string }> {
  const SevenZip = _require('7z-wasm');
  let output = '';
  // ⚠️ emscripten 的 stdout 钩子给的是**字符码数字**，不是字符串（我第一版探针就栽在这，
  //    把输出拼成了一串数字）。两种都要接。
  const capture = (c: number | string) => { output += typeof c === 'number' ? String.fromCharCode(c) : c; };
  const sz: SevenZipModule = await SevenZip({ stdout: capture, stderr: capture });

  const bytes = new Uint8Array(fs.readFileSync(sourcePath));
  sz.FS.mkdir('/in');
  const stream = sz.FS.open(MEMFS_ARCHIVE, 'w+');
  sz.FS.write(stream, bytes, 0, bytes.length);
  sz.FS.close(stream);
  sz.FS.mkdir(MEMFS_OUTPUT);
  sz.FS.chdir(MEMFS_OUTPUT);

  return { sz, read: () => { const v = output; return v; }, };
}

/**
 * `callMain` 的失败方式**实测有两种，都要接**：
 *   · 返回非 0 退出码 —— 把 `.jpg` 改名成 `.rar`：返回 `2`，打印 `Cannot open the file as archive`；
 *   · **抛出一个裸数字** —— 头部加密的 `.7z`：抛 `262608`，**不是 Error 对象**。
 *
 * 只 catch 不查返回码 ⇒ 假压缩包被当成「成功、解出 0 个文件」；只查返回码不 catch ⇒ 加密包
 * 冒泡成 500。**两条缺一不可。**
 */
function callMainChecked(sz: SevenZipModule, args: string[]): number {
  try {
    return sz.callMain(args);
  } catch (error) {
    console.warn('[archive] 7z 内部错误:', error);
    return -1;
  }
}

/** 把列表那一步的音量收起来：**先列表再解压**，体积在这就拒掉。 */
function assertWithinLimits(listing: SevenZipListing, limits: ArchiveLimits): void {
  if (listing.encrypted) throw new ArchiveError('不支持带密码的压缩包，请先解压后重新打包');
  if (listing.fileCount > limits.maxFiles) throw new ArchiveError(`压缩包文件数量超过 ${limits.maxFiles} 个`);
  if (listing.declaredMaxFileBytes > limits.maxSingleFileBytes) {
    throw new ArchiveError(`压缩包包含过大的单个文件（上限 ${limits.maxSingleFileBytes / 1024 / 1024}MB）`);
  }
  if (listing.declaredTotalBytes > limits.maxTotalBytes) {
    throw new ArchiveError(`压缩包解压后总体积过大（上限 ${limits.maxTotalBytes / 1024 / 1024}MB）`);
  }
}

async function extractWithSevenZip(kind: ArchiveKind, opts: SafeExtractOptions): Promise<{ kind: ArchiveKind }> {
  const { sz, read } = await openSevenZip(opts.sourcePath);

  // ── 第一关：列表。**必须在解压之前** —— 超限的包一个字节都不许展开。 ──
  const listCode = callMainChecked(sz, ['l', '-slt', '-ba', MEMFS_ARCHIVE]);
  if (listCode !== 0) {
    // 头部加密的 7z 就死在这里（它连清单都读不出来）。文案要与下面那条「带密码」区分开：
    // 那一条是**读得出清单、但条目标了 Encrypted**，这一条是**根本读不出来**。
    throw new ArchiveError('压缩包读不了，可能是加密的或已损坏');
  }
  assertWithinLimits(parseSevenZipListing(read()), opts.limits);

  return extractBody(kind, sz, opts);
}

/** Task 5 实现。 */
async function extractBody(kind: ArchiveKind, _sz: SevenZipModule, _opts: SafeExtractOptions): Promise<{ kind: ArchiveKind }> {
  throw new ArchiveError('解压那一步还没做');
}
