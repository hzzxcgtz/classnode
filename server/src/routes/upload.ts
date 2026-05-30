import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/chat'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `chat-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

fs.mkdirSync(path.join(__dirname, '../../uploads/chat'), { recursive: true });

// 文件上传
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

export default router;
