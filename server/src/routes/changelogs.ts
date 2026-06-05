import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const CHANGELOGS_DIR = path.join(__dirname, '../../changelogs');

router.get('/', (_req, res) => {
  try {
    const files = fs.readdirSync(CHANGELOGS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();
    const entries = files.map(file => {
      const content = fs.readFileSync(path.join(CHANGELOGS_DIR, file), 'utf-8');
      // 从文件名提取版本号（如 v1.2.3.md → 1.2.3）
      const version = file.replace(/\.md$/, '');
      // 从内容查找日期（如 ## [1.2.3] — 2026-06-05）
      const dateMatch = content.match(/—\s*(\d{4}-\d{2}-\d{2})/);
      return { version, date: dateMatch ? dateMatch[1] : null, content };
    });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: '获取更新日志失败' });
  }
});

export default router;
