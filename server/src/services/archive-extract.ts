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

  // 🔴 **先把 CRLF 归一成 LF，这不是洁癖。** T2 复核实测过：喂 `\r\n` 进来时
  //    `'\n\n'` 这个分隔符**根本不出现**，整份输出塌成**一个**块；那个块里恰好有
  //    `Folder = +`（目录行），于是每一条 `continue` 都命中、返回**全零**。
  //    全零的列表会**静默通过每一条 declared-size 限值** —— 而那是挡在实测 1184MB
  //    内存事件前面的**唯一**一道闸门。低概率 + 失败时大开，所以在这里堵死。
  //    （当前 7z-wasm 经 Emscripten 输出的是 LF，所以这是**保险**，不是修 bug。）
  const normalized = text.replace(/\r\n/g, '\n');

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
