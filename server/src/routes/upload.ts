import { ATTACHMENT_URL, classroomUploadRelative, ensureAttachmentDirectory } from '../services/upload-paths.js';
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import type { ErrorRequestHandler } from 'express';
import { detectSafeChatFile, detectSafeImage } from '../services/upload-security.js';
import { getStudentSession } from '../middleware/student-auth.js';
import { hasTeacherSession } from '../middleware/auth.js';
import { containsImageUrl, imageRotationRooms, ImageRotationError, readRotatableImage, rotateStoredImage, ROTATABLE_IMAGE_URL } from '../services/image-rotation.js';

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
const CHAT_UPLOAD_NAME = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|txt|ogg)$/i;
const AVATAR_UPLOAD_NAME = /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const session = getStudentSession(req);
      const relative = session && !hasTeacherSession(req)
        ? classroomUploadRelative(session.classroomId, req.path.replace(/\/+$/, '') === '/worksheet-image' ? 'worksheet' : 'chat') : 'chat';
      cb(null, file.fieldname === 'avatar' ? avatarDir : ensureAttachmentDirectory(uploadsBase, relative));
    } catch (error) { cb(error as Error, ''); }
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
        if (typeof url !== 'string' || !ATTACHMENT_URL.test(url)) continue;
        const name = url.startsWith('/uploads/chat/') ? path.basename(url) : url.slice('/uploads/'.length);
        referenced.add(name);
      }
    } catch {
      // 保留无法解析的历史记录；对应文件会在下次教师主动清理时处理。
    }
  }
  return referenced;
}

function collectWorksheetImageFiles(contents: unknown[]): Set<string> {
  const referenced = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string' && ATTACHMENT_URL.test(value)) {
      const name = value.startsWith('/uploads/chat/') ? path.basename(value) : value.slice('/uploads/'.length);
      referenced.add(name);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  contents.forEach(visit);
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

async function removeExpiredUnreferencedFiles(directory: string, referenced: Set<string>, filePattern: RegExp, now: number, ownerDirectory?: string): Promise<number> {
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
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      if (now - stat.mtimeMs < UPLOAD_ORPHAN_GRACE_MS) return;
      await fs.promises.unlink(filePath);
      if (filePattern === CHAT_UPLOAD_NAME) await fs.promises.rm(path.join(ownerDirectory ?? path.join(path.dirname(directory), '.image-owners'), `${name}.json`), { force: true });
      removed++;
    } catch {
      // 文件可能在扫描时被其他请求删除，忽略即可。
    }
  }));
  return removed;
}

/** 清理未被课堂消息、学习单或头像记录引用，且已超过宽限期的上传文件。 */
export async function cleanupOrphanedUploads(
  prisma: Pick<import('@prisma/client').PrismaClient, 'message' | 'avatar' | 'worksheet' | 'worksheetAnswer' | 'worksheetAnswerReview' | 'classroomAnnotation'>,
  options: { now?: number; chatDirectory?: string; avatarDirectory?: string } = {},
): Promise<{ chat: number; avatars: number }> {
  const now = options.now ?? Date.now();
  const [messages, avatars, worksheets, worksheetAnswers, reviews, annotations] = await Promise.all([
    prisma.message.findMany({ select: { fileUrls: true } }),
    prisma.avatar.findMany({ select: { svgContent: true } }),
    prisma.worksheet.findMany({ select: { content: true, settings: true } }),
    prisma.worksheetAnswer.findMany({ select: { value: true } }),
    prisma.worksheetAnswerReview.findMany({ select: { value: true, question: true } }),
    prisma.classroomAnnotation.findMany({ select: { target: true, document: true } }),
  ]);
  const chatReferences = collectReferencedChatFiles(messages.map(message => message.fileUrls));
  collectWorksheetImageFiles(worksheets.map(worksheet => worksheet.content)).forEach(name => chatReferences.add(name));
  collectWorksheetImageFiles(worksheets.map(worksheet => worksheet.settings)).forEach(name => chatReferences.add(name));
  // 照片作答存在答案行里，不在学习单题面中；漏掉会在 24 小时后被误当作孤儿删除。
  collectWorksheetImageFiles(worksheetAnswers.map(answer => answer.value)).forEach(name => chatReferences.add(name));
  // Older drafts and their frozen question/rubric images remain valid history assets.
  collectWorksheetImageFiles(reviews.flatMap(review => [review.value, review.question])).forEach(name => chatReferences.add(name));
  collectWorksheetImageFiles(annotations.filter(row => {
    const document = row.document as {kind?: string; strokes?: unknown[]} | null;
    return document?.kind === 'image' && !!document.strokes?.length;
  }).map(row => row.target)).forEach(name => chatReferences.add(name));
  const chat = await removeExpiredUnreferencedFiles(
    options.chatDirectory ?? chatDir,
    chatReferences,
    CHAT_UPLOAD_NAME,
    now,
  );
  // Flat references and new classroom paths are tracked together, including historical reviews.
  const root = path.dirname(options.chatDirectory ?? chatDir);
  let scoped = 0;
  const classroomRoot = path.join(root, 'classrooms');
  const classroomStat = await fs.promises.lstat(classroomRoot).catch(() => null);
  const classrooms = classroomStat?.isDirectory() && !classroomStat.isSymbolicLink()
    ? await fs.promises.readdir(classroomRoot, { withFileTypes: true }).catch(() => []) : [];
  for (const classroom of classrooms) {
    if (!classroom.isDirectory() || classroom.isSymbolicLink() || !/^[A-Za-z0-9_-]{1,128}$/.test(classroom.name)) continue;
    for (const kind of ['worksheet', 'chat']) {
      const prefix = `classrooms/${classroom.name}/${kind}/`;
      const directory = path.join(root, prefix);
      const stat = await fs.promises.lstat(directory).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      const names = new Set([...chatReferences].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)));
      scoped += await removeExpiredUnreferencedFiles(directory, names, CHAT_UPLOAD_NAME, now, path.join(root, '.image-owners'));
    }
  }
  const avatarFiles = await removeExpiredUnreferencedFiles(
    options.avatarDirectory ?? avatarDir,
    collectReferencedAvatarFiles(avatars.map(avatar => avatar.svgContent)),
    AVATAR_UPLOAD_NAME,
    now,
  );
  return { chat: chat + scoped, avatars: avatarFiles };
}

// Keep upload ownership beside the files so restarting the service does not lose it.
// This hidden directory cannot be fetched through the public uploads static route.
const imageOwnerDir = path.join(uploadsBase, '.image-owners');
function rememberImageOwner(req: import('express').Request, url: string) {
  const session = getStudentSession(req);
  fs.mkdirSync(imageOwnerDir, { recursive: true });
  const owner = hasTeacherSession(req) || !session ? { kind: 'teacher' } : { kind: 'student', classroomId: session.classroomId, studentId: session.studentId };
  fs.writeFileSync(path.join(imageOwnerDir, `${path.basename(url)}.json`), JSON.stringify(owner), { flag: 'wx' });
}
async function canRotateImage(req: import('express').Request, url: string): Promise<boolean> {
  if (hasTeacherSession(req)) return true;
  const session = getStudentSession(req);
  if (!session) return false;
  try {
    const owner = JSON.parse(await fs.promises.readFile(path.join(imageOwnerDir, `${path.basename(url)}.json`), 'utf8'));
    return owner.kind === 'student' && owner.classroomId === session.classroomId && owner.studentId === session.studentId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
  }
  // Images from earlier versions have no receipt; use their existing answer/message scope.
  const prisma = req.app.get('prisma') as import('@prisma/client').PrismaClient;
  const scope = { response: { classroomId: session.classroomId, participantId: session.studentId } };
  const [answers, reviews, messages] = await Promise.all([
    prisma.worksheetAnswer.findMany({ where: scope, select: { value: true } }),
    prisma.worksheetAnswerReview.findMany({ where: { answer: scope }, select: { value: true } }),
    prisma.message.findMany({ where: { classroomId: session.classroomId, studentId: session.studentId, role: 'user', fileUrls: { not: null } }, select: { fileUrls: true } }),
  ]);
  return answers.some(row => containsImageUrl(row.value, url)) || reviews.some(row => containsImageUrl(row.value, url)) || messages.some(row => {
    try { return containsImageUrl(JSON.parse(row.fileUrls || '[]'), url); } catch { return false; }
  });
}
async function imageOrientationRequest(req: import('express').Request, res: import('express').Response, save: boolean) {
  try {
    if (!hasTeacherSession(req) && !getStudentSession(req)) return res.status(401).json({ error: '请先登录后再调整图片' });
    const url = save ? req.body?.url : req.query.url;
    if (typeof url !== 'string' || !ROTATABLE_IMAGE_URL.test(url)) return res.status(400).json({ error: '图片地址无效' });
    if (!await canRotateImage(req, url)) return res.status(403).json({ error: '只能调整自己上传的图片' });
    const result = save ? await rotateStoredImage(chatDir, url, req.body?.degrees, req.body?.version) : await readRotatableImage(chatDir, url);
    if (save) {
      const io = req.app.get('io') as import('socket.io').Server | undefined;
      if (io) {
        try {
          let owner = getStudentSession(req);
          if (!owner) {
            try {
              const receipt = JSON.parse(await fs.promises.readFile(path.join(imageOwnerDir, `${path.basename(url)}.json`), 'utf8'));
              if (receipt.kind === 'student') owner = receipt;
            } catch { /* Existing images are resolved through their stored references. */ }
          }
          const rooms = await imageRotationRooms(req.app.get('prisma'), url, owner);
          if (rooms.length) io.to(rooms).emit('image-orientation-updated', { url, version: result.version });
        } catch (error) {
          // The file is already saved: a notification failure must not report a failed rotation.
          console.warn('[image-rotation] Could not broadcast orientation update', error);
        }
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, url, version: result.version });
  } catch (error) {
    return res.status(error instanceof ImageRotationError ? error.status : 500).json({ error: error instanceof ImageRotationError ? error.message : '图片方向保存失败，原图片未更改，请重试' });
  }
}
router.get('/image-orientation', requireActiveStudentUpload, (req, res) => { void imageOrientationRequest(req, res, false); });
router.post('/image-orientation', requireActiveStudentUpload, (req, res) => { void imageOrientationRequest(req, res, true); });

// 学习单题干与选择题选项配图：单独校验图片真实内容，不能沿用聊天附件的文档格式。
router.post('/worksheet-image', requireActiveStudentUpload, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择图片' });
    }
    const content = fs.readFileSync(req.file.path);
    const kind = detectSafeImage(content);
    if (!kind) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '题目配图仅支持有效的 JPEG、PNG 或 WebP 图片' });
    }
    const safeName = `chat-${crypto.randomUUID()}.${kind}`;
    const target = path.join(path.dirname(req.file.path), safeName);
    fs.renameSync(req.file.path, target);
    const url = '/uploads/' + path.relative(uploadsBase, target).split(path.sep).join('/');
    rememberImageOwner(req, url);
    res.json({ success: true, url, name: req.file.originalname, size: req.file.size });
  } catch {
    res.status(500).json({ error: '题目配图上传失败' });
  }
});

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
      return res.status(400).json({ error: '文件内容与允许的图片、PDF、Word、文本或 Ogg/Opus 语音格式不符' });
    }
    const safeName = `chat-${crypto.randomUUID()}.${kind}`;
    const target = path.join(path.dirname(req.file.path), safeName);
    fs.renameSync(req.file.path, target);
    const url = '/uploads/' + path.relative(uploadsBase, target).split(path.sep).join('/');
    rememberImageOwner(req, url);
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
