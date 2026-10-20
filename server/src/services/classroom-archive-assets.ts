import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** No network fetching or arbitrary file reads. Refuse symlinks at every component. */
export function archiveSource(root: string, relative: string): string | null {
  const parts = relative.split('/');
  if (!relative || parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f:]/.test(p))) return null;
  let current = root;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return null;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
    return fs.statSync(current).isFile() ? current : null;
  } catch { return null; }
}
export const archiveLink = (name: string) => name.split('/').map(encodeURIComponent).join('/');
export function archiveName(name: string) {
  return (name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim() || '未命名').slice(0, 80);
}
export interface ArchiveInventory { name: string; size: number; sha256: string }
export class ArchiveAssets {
  readonly inventory: ArchiveInventory[] = [];
  readonly warnings: string[] = [];
  private readonly references = new Map<string, string | null>();
  private total = 0;
  constructor(readonly directory: string, readonly uploads: string, readonly webapps: string) {}
  addWarning(text: string) { if (!this.warnings.includes(text)) this.warnings.push(text); }
  copy(source: string, target: string): void {
    const stat = fs.statSync(source);
    if (this.inventory.length >= 50000 || stat.size > 500 * 1024 * 1024 || this.total + stat.size > 1024 * 1024 * 1024) throw new Error('课堂资料超过 1 GB 或文件数量上限，请先整理附件后重试。');
    fs.mkdirSync(path.dirname(path.join(this.directory, target)), { recursive: true });
    fs.copyFileSync(source, path.join(this.directory, target));
    // Hash the actual exported bytes; no unbounded read of the original file.
    const file = path.join(this.directory, target);
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let n: number;
      while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
    } finally { fs.closeSync(fd); }
    this.total += stat.size;
    this.inventory.push({ name: target, size: fs.statSync(file).size, sha256: hash.digest('hex') });
  }
  attachment(raw: string): string | null {
    let relative: string;
    try { relative = decodeURIComponent(raw.split(/[?#]/)[0]).replace(/^\/uploads\//, ''); } catch { relative = ''; }
    if (!raw.startsWith('/uploads/')) return null;
    if (this.references.has(relative)) return this.references.get(relative) ?? null;
    const source = archiveSource(this.uploads, relative);
    let target: string | null = null;
    if (source && /^(chat|avatars|logos)\//.test(relative)) {
      target = `附件/文件/${String(this.references.size + 1).padStart(4, '0')}-${archiveName(path.basename(source))}`;
      this.copy(source, target);
    } else this.addWarning(`附件未找到或路径不受支持：${raw}`);
    this.references.set(relative, target);
    return target;
  }
  scan(value: unknown): void {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\/uploads\/(?:chat|avatars|logos)\/[^\s<>"'`\]\[)]+/g)) this.attachment(match[0]);
    } else if (Array.isArray(value)) value.forEach(v => this.scan(v));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => this.scan(v));
  }
  webapp(id: string, index: number, name: string, entryPath: string): string | null {
    const prefix = `探究网页/${index + 1}-${archiveName(name)}`;
    let count = 0;
    const visit = (relative: string) => {
      const candidate = path.join(this.webapps, relative);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(candidate); } catch { this.addWarning(`探究网页「${name}」的文件缺失。`); return; }
      if (stat.isSymbolicLink()) { this.addWarning(`探究网页「${name}」含符号链接，未导出该项。`); return; }
      if (stat.isDirectory()) for (const child of fs.readdirSync(candidate).sort()) visit(`${relative}/${child}`);
      else {
        const source = archiveSource(this.webapps, relative);
        if (!source) { this.addWarning(`探究网页「${name}」存在无法读取的文件。`); return; }
        this.copy(source, `${prefix}/${relative.slice(id.length + 1)}`);
        count++;
      }
    };
    // Reject root and id traversal before walking a package.
    if (!id || /[\\/\x00-\x1f:]/.test(id) || id === '.' || id === '..' || !fs.existsSync(this.webapps) || fs.lstatSync(this.webapps).isSymbolicLink()) {
      this.addWarning(`探究网页「${name}」的目录不可用。`); return null;
    }
    visit(id);
    const entry = archiveSource(this.webapps, `${id}/${entryPath}`);
    if (!entry || !count) { this.addWarning(`探究网页「${name}」的入口文件缺失。`); return null; }
    return `${prefix}/${entryPath}`;
  }
}
