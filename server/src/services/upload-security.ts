import fs from 'fs';
import path from 'path';

export type SafeFileKind = 'png' | 'jpg' | 'webp' | 'pdf' | 'doc' | 'docx' | 'txt';

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function detectSafeChatFile(buffer: Buffer, originalName: string): SafeFileKind | null {
  const ext = path.extname(originalName).toLowerCase();
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ext === '.doc') return 'doc';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && ext === '.docx') return 'docx';
  if (ext === '.txt' && !buffer.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return 'txt'; } catch { return null; }
  }
  return null;
}

export function detectSafeImage(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  const kind = detectSafeChatFile(buffer, 'image.png');
  return kind === 'png' || kind === 'jpg' || kind === 'webp' ? kind : null;
}

/** 保守 SVG 白名单：允许基础图形，拒绝脚本、事件、外部资源与可嵌 HTML。 */
export function sanitizeSvg(svg: string): string | null {
  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>$/i.test(trimmed) || trimmed.length > 200_000) return null;
  const forbidden = [
    /<\s*(script|foreignObject|iframe|object|embed|audio|video|canvas|style|link|meta)\b/i,
    /\son[a-z]+\s*=/i,
    /(?:javascript|vbscript)\s*:/i,
    /\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i,
    /url\s*\(\s*["']?\s*(?:https?:|\/\/|data:|javascript:)/i,
    /<!DOCTYPE|<!ENTITY/i,
  ];
  return forbidden.some(pattern => pattern.test(trimmed)) ? null : trimmed;
}

export interface ZipLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxSingleFileBytes: number;
}

export interface ZipEntryLike {
  entryName: string;
  isDirectory: boolean;
  header?: { size?: number };
  getData(): Buffer;
}

export interface ZipArchiveLike {
  getEntries(): ZipEntryLike[];
}

export function safeExtractZip(zip: ZipArchiveLike, destination: string, limits: ZipLimits): void {
  const root = path.resolve(destination);
  const entries = zip.getEntries();
  if (entries.length > limits.maxFiles) throw new Error(`压缩包文件数量超过 ${limits.maxFiles} 个`);
  let total = 0;
  for (const entry of entries) {
    const rawName = String(entry.entryName || '');
    const normalizedName = rawName.replace(/\\/g, '/');
    if (!normalizedName || normalizedName.startsWith('/') || /^[A-Za-z]:/.test(normalizedName)) throw new Error('压缩包包含非法路径');
    const parts = normalizedName.split('/').filter(Boolean);
    if (parts.some(part => part === '..' || part === '.')) throw new Error('压缩包包含路径穿越条目');
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('压缩包条目超出目标目录');
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    const declaredSize = Number(entry.header?.size || 0);
    if (declaredSize > limits.maxSingleFileBytes) throw new Error('压缩包包含过大的单个文件');
    total += declaredSize;
    if (total > limits.maxTotalBytes) throw new Error('压缩包解压后总体积过大');
    const data: Buffer = entry.getData();
    if (data.length !== declaredSize || data.length > limits.maxSingleFileBytes) throw new Error('压缩包文件大小异常');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { flag: 'w', mode: 0o600 });
  }
}
