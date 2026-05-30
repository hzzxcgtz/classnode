import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { testAgentConnection } from '../services/ai-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

// File upload config for agent logos
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/logos'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Ensure upload directory exists
fs.mkdirSync(path.join(__dirname, '../../uploads/logos'), { recursive: true });

// 获取所有智能体
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: '获取智能体列表失败' });
  }
});

// 获取单个智能体
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: '获取智能体失败' });
  }
});

// 创建智能体
router.post('/', upload.single('logo'), async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, platform, subject, grade, apiUrl, apiKey, botId, extra } = req.body;
    const logo = req.file ? `/uploads/logos/${req.file.filename}` : null;

    const agent = await prisma.agent.create({
      data: {
        name,
        platform,
        subject: subject || null,
        grade: grade || null,
        apiUrl: apiUrl || null,
        apiKey,
        botId: botId || null,
        extra: extra || null,
        logo,
      },
    });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: '创建智能体失败' });
  }
});

// 更新智能体
router.put('/:id', upload.single('logo'), async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, platform, subject, grade, apiUrl, apiKey, botId, extra, enabled } = req.body;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (platform !== undefined) data.platform = platform;
    if (subject !== undefined) data.subject = subject;
    if (grade !== undefined) data.grade = grade;
    if (apiUrl !== undefined) data.apiUrl = apiUrl;
    if (apiKey !== undefined) data.apiKey = apiKey;
    if (botId !== undefined) data.botId = botId;
    if (extra !== undefined) data.extra = extra;
    if (enabled !== undefined) data.enabled = enabled === 'true' || enabled === true;
    if (req.file) data.logo = `/uploads/logos/${req.file.filename}`;
    if (req.body.removeLogo === 'true') data.logo = null;

    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
    });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: '更新智能体失败' });
  }
});

// 检查智能体是否被课堂使用
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const caCount = await prisma.classroomAgent.count({
      where: { agentId: req.params.id },
    });
    const cgCount = await prisma.classroomGroup.count({
      where: { agentId: req.params.id },
    });
    res.json({
      used: caCount > 0 || cgCount > 0,
      classroomCount: caCount,
      groupCount: cgCount,
    });
  } catch (error) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 删除智能体
router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    // 检查是否有课堂关联此智能体
    const caCount = await prisma.classroomAgent.count({
      where: { agentId: req.params.id },
    });
    if (caCount > 0) {
      return res.status(400).json({
        error: `该智能体已关联 ${caCount} 个课堂，无法删除。请先删除关联的课堂后再试。`,
      });
    }

    await prisma.agent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除智能体失败' });
  }
});

// 连通性测试
router.post('/:id/test', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    const result = await testAgentConnection({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: agent.apiKey,
      botId: agent.botId || undefined,
      extra: agent.extra || undefined,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '测试失败' });
  }
});

export default router;
