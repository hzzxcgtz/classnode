import { ATTACHMENT_IMAGE_URL, resolveAttachmentFile } from './upload-paths.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export class ImageRotationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const ROTATABLE_IMAGE_URL = ATTACHMENT_IMAGE_URL;
const busy = new Set<string>();
export const imageVersion = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export async function readRotatableImage(directory: string, url: string) {
  if (!ROTATABLE_IMAGE_URL.test(url)) throw new ImageRotationError('只支持已上传的 JPG、PNG 或 WebP 图片', 400);
  const file = url.startsWith('/uploads/chat/') ? path.join(directory, path.basename(url)) : resolveAttachmentFile(path.dirname(directory), url);
  if (!file) throw new ImageRotationError('图片已不存在或路径无效', 404);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ImageRotationError('图片路径无效', 400);
    const data = await fs.readFile(file);
    return { file, data, version: imageVersion(data) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ImageRotationError('图片已不存在', 404);
    throw error;
  }
}
/** Write a complete replacement atomically; stale previews cannot overwrite newer rotations. */
export async function rotateStoredImage(directory: string, url: string, degrees: unknown, version: unknown) {
  if (![90, 180, 270, -90, -180, -270].includes(degrees as number) || typeof degrees !== 'number') throw new ImageRotationError('旋转角度必须是 90° 的整数倍', 400);
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) throw new ImageRotationError('请重新打开图片后再保存', 400);
  if (busy.has(url)) throw new ImageRotationError('图片正在保存，请稍后重试', 409);
  busy.add(url);
  let temp: string | undefined;
  try {
    const source = await readRotatableImage(directory, url);
    if (source.version !== version) throw new ImageRotationError('图片方向已被其他人修改，请重新打开图片后再调整', 409);
    // Normalize camera EXIF first, so the saved rotation matches the browser preview.
    const result = await sharp(source.data, { limitInputPixels: 40_000_000 }).autoOrient().rotate(degrees).toBuffer();
    temp = `${source.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, result, { flag: 'wx' });
    await fs.rename(temp, source.file);
    return { url, version: imageVersion(result) };
  } finally {
    busy.delete(url);
    if (temp) await fs.rm(temp, { force: true }).catch(() => {});
  }
}

export function containsImageUrl(value: unknown, url: string): boolean {
  if (value === url) return true;
  if (Array.isArray(value)) return value.some(item => containsImageUrl(item, url));
  return !!value && typeof value === 'object' && Object.values(value).some(item => containsImageUrl(item, url));
}

/** Notify only owners with a reference to this image and their classroom teachers. */
export async function imageRotationRooms(prisma: Pick<import('@prisma/client').PrismaClient, 'worksheetAnswer' | 'worksheetAnswerReview' | 'message'>, url: string,
  owner?: {classroomId: string; studentId: string} | null): Promise<string[]> {
  const rooms = new Set<string>();
  const add = (classroomId: string, participantId: string) => {
    rooms.add(`participant:${classroomId}:${participantId}`);
    rooms.add(`teacher:${classroomId}`);
  };
  if (owner) add(owner.classroomId, owner.studentId);
  const [answers, reviews, messages] = await Promise.all([
    prisma.worksheetAnswer.findMany({ select: { value: true, response: { select: { classroomId: true, participantId: true } } } }),
    prisma.worksheetAnswerReview.findMany({ select: { value: true, answer: { select: { response: { select: { classroomId: true, participantId: true } } } } } }),
    prisma.message.findMany({ where: { fileUrls: { contains: url } }, select: { fileUrls: true, classroomId: true, studentId: true } }),
  ]);
  for (const row of answers) if (containsImageUrl(row.value, url)) add(row.response.classroomId, row.response.participantId);
  for (const row of reviews) if (containsImageUrl(row.value, url)) add(row.answer.response.classroomId, row.answer.response.participantId);
  for (const row of messages) {
    try { if (containsImageUrl(JSON.parse(row.fileUrls || '[]'), url)) add(row.classroomId, row.studentId); } catch { /* malformed legacy attachments */ }
  }
  return [...rooms];
}
