import fs from 'node:fs';
import path from 'node:path';

// Keep legacy flat URLs valid; new student uploads are scoped by classroom and purpose.
export const ATTACHMENT_URL = /^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|pdf|doc|docx|txt)$/i;
export const ATTACHMENT_IMAGE_URL = /^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;
export function classroomUploadRelative(classroomId: string, kind: 'worksheet' | 'chat'): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(classroomId)) throw new Error('课堂标识无效');
  return `classrooms/${classroomId}/${kind}`;
}
/** Return only a regular file under uploads, rejecting symlinks in every component. */
export function resolveAttachmentFile(uploadsRoot: string, url: string): string | null {
  if (!ATTACHMENT_URL.test(url)) return null;
  const relative = url.slice('/uploads/'.length);
  let current = uploadsRoot;
  try {
    if (fs.lstatSync(current).isSymbolicLink()) return null;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
    return fs.statSync(current).isFile() ? current : null;
  } catch { return null; }
}
/** mkdir without following an unexpected symlink inside the user data directory. */
export function ensureAttachmentDirectory(uploadsRoot: string, relative: string): string {
  if (!/^(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))$/.test(relative)) throw new Error('附件目录无效');
  let current = uploadsRoot;
  fs.mkdirSync(current, { recursive: true });
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('附件目录无效');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('附件目录无效');
  }
  return current;
}
