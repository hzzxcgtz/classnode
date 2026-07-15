import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import type { ErrorRequestHandler } from 'express';
import { detectSafeChatFile, detectSafeImage } from '../services/upload-security.js';
import { getStudentSession } from '../middleware/student-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const uploadsBase = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
  : path.join(__dirname, '../../uploads');

const chatDir = path.join(uploadsBase, 'chat');
const avatarDir = path.join(uploadsBase, 'avatars');
fs.mkdirSync(chatDir, { recursive: true });
fs.mkdirSync(avatarDir, { recursive: true });

const UPLOAD_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const CHAT_UPLOAD_NAME = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|txt)$/i;
const AVATAR_UPLOAD_NAME = /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i;

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    cb(null, file.fieldname === 'avatar' ? avatarDir : chatDir);
  },
  filename: (_req, file, cb) => {
    const prefix = file.fieldname === 'avatar' ? 'avatar' : 'chat';
    cb(null, `${prefix}-${crypto.randomUUID()}.upload`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * 教师上传沿用控制台会话；学生上传则必须仍属于一间进行中或暂停中的课堂。
 * 这样旧令牌在课堂结束、学生被移出课堂后都不能继续占用本机存储空间。
 */
export async function requireActiveStudentUpload(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> {
  const session = getStudentSession(req);
  if (!session) return next();
  try {
    const prisma = req.app.get('prisma') as import('@prisma/client').PrismaClient;
    const membership = await prisma.classroomStudent.findFirst({
      where: {
        classroomId: session.classroomId,
        id: session.studentId,
        classroom: { status: { in: ['active', 'paused'] } },
      },
      select: { id: true },
    });
    if (!membership) {
      res.status(403).json({ error: '课堂已结束或学生会话无效，不能上传文件' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: '暂时无法校验课堂状态，请稍后重试' });
  }
}

function collectReferencedChatFiles(fileUrls: (string | null)[]): Set<string> {
  const referenced = new Set<string>();
  for (const value of fileUrls) {
    if (!value) continue;
    try {
      const urls = JSON.parse(value);
      if (!Array.isArray(urls)) continue;
      for (const url of urls) {
        if (typeof url !== 'string' || !url.startsWith('/uploads/chat/')) continue;
        const name = url.slice('/uploads/chat/'.length);
        if (CHAT_UPLOAD_NAME.test(name)) referenced.add(name);
      }
    } catch {
      // 保留无法解析的历史记录；对应文件会在下次教师主动清理时处理。
    }
  }
  return referenced;
}

function collectReferencedAvatarFiles(svgContents: string[]): Set<string> {
  const referenced = new Set<string>();
  for (const svg of svgContents) {
    const matches = svg.matchAll(/href="\/uploads\/avatars\/([^"/]+)"/g);
    for (const match of matches) {
      if (AVATAR_UPLOAD_NAME.test(match[1])) referenced.add(match[1]);
    }
  }
  return referenced;
}

async function removeExpiredUnreferencedFiles(directory: string, referenced: Set<string>, filePattern: RegExp, now: number): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.promises.readdir(directory);
  } catch {
    return removed;
  }
  await Promise.all(entries.map(async (name) => {
    if (!filePattern.test(name) || referenced.has(name)) return;
    const filePath = path.join(directory, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (now - stat.mtimeMs < UPLOAD_ORPHAN_GRACE_MS) return;
      await fs.promises.unlink(filePath);
      removed++;
    } catch {
      // 文件可能在扫描时被其他请求删除，忽略即可。
    }
  }));
  return removed;
}

/** 清理未被课堂消息或头像记录引用、且已超过宽限期的上传文件。 */
export async function cleanupOrphanedUploads(
  prisma: Pick<import('@prisma/client').PrismaClient, 'message' | 'avatar'>,
  options: { now?: number; chatDirectory?: string; avatarDirectory?: string } = {},
): Promise<{ chat: number; avatars: number }> {
  const now = options.now ?? Date.now();
  const [messages, avatars] = await Promise.all([
    prisma.message.findMany({ select: { fileUrls: true } }),
    prisma.avatar.findMany({ select: { svgContent: true } }),
  ]);
  const chat = await removeExpiredUnreferencedFiles(
    options.chatDirectory ?? chatDir,
    collectReferencedChatFiles(messages.map(message => message.fileUrls)),
    CHAT_UPLOAD_NAME,
    now,
  );
  const avatarFiles = await removeExpiredUnreferencedFiles(
    options.avatarDirectory ?? avatarDir,
    collectReferencedAvatarFiles(avatars.map(avatar => avatar.svgContent)),
    AVATAR_UPLOAD_NAME,
    now,
  );
  return { chat, avatars: avatarFiles };
}

// 聊天文件上传
router.post('/', requireActiveStudentUpload, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    const content = fs.readFileSync(req.file.path);
    const kind = detectSafeChatFile(content, req.file.originalname);
    if (!kind) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '文件内容与允许的图片、PDF、Word 或文本格式不符' });
    }
    const safeName = `chat-${crypto.randomUUID()}.${kind}`;
    fs.renameSync(req.file.path, path.join(chatDir, safeName));
    const url = `/uploads/chat/${safeName}`;
    res.json({ success: true, url, name: req.file.originalname, size: req.file.size });
  } catch (error) {
    res.status(500).json({ error: '上传失败' });
  }
});

// 头像图片上传
router.post('/avatar', requireActiveStudentUpload, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    const content = fs.readFileSync(req.file.path);
    const kind = detectSafeImage(content);
    if (!kind) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '头像仅支持有效的 JPEG、PNG 或 WebP 图片' });
    }
    const safeName = `avatar-${crypto.randomUUID()}.${kind}`;
    fs.renameSync(req.file.path, path.join(avatarDir, safeName));
    const url = `/uploads/avatars/${safeName}`;
    // 生成圆形裁剪的 SVG 包裹层
    const svgContent = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath></defs><image href="${url}" x="0" y="0" width="40" height="40" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/></svg>`;
    res.json({ success: true, url, svgContent, name: req.file.originalname });
  } catch (error) {
    res.status(500).json({ error: '头像上传失败' });
  }
});

/** 将 Multer 的默认 HTML/文本错误转换为前端可直接展示的 JSON。 */
const handleUploadError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: '文件不能超过 20MB' });
    return;
  }
  if (error) {
    console.error('[upload] request failed:', error);
    res.status(400).json({ error: '上传请求无效' });
    return;
  }
  next();
};
router.use(handleUploadError);

export default router;
