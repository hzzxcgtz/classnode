import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const uploadsBase = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
  : path.join(__dirname, '../../uploads');

const chatDir = path.join(uploadsBase, 'chat');
const avatarDir = path.join(uploadsBase, 'avatars');
fs.mkdirSync(chatDir, { recursive: true });
fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    cb(null, file.fieldname === 'avatar' ? avatarDir : chatDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const prefix = file.fieldname === 'avatar' ? 'avatar' : 'chat';
    cb(null, `${prefix}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 聊天文件上传
router.post('/', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    const url = `/uploads/chat/${req.file.filename}`;
    res.json({ success: true, url, name: req.file.originalname, size: req.file.size });
  } catch (error) {
    res.status(500).json({ error: '上传失败' });
  }
});

// 头像图片上传
router.post('/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    const url = `/uploads/avatars/${req.file.filename}`;
    // 生成圆形裁剪的 SVG 包裹层
    const svgContent = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath></defs><image href="${url}" x="0" y="0" width="40" height="40" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/></svg>`;
    res.json({ success: true, url, svgContent, name: req.file.originalname });
  } catch (error) {
    res.status(500).json({ error: '头像上传失败' });
  }
});

export default router;
