import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
const router: Router = Router();

// 获取所有设置
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const settings = await prisma.setting.findMany();
    const result: Record<string, string> = {};
    settings.forEach((s: Prisma.SettingGetPayload<{}>) => { result[s.key] = s.value; });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 更新/创建设置
router.put('/:key', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { key } = req.params;
    const { value } = req.body;
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: '保存设置失败' });
  }
});

// 设置管理密码（首次安装）
router.post('/admin-password', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    await prisma.setting.upsert({
      where: { key: 'admin_password' },
      update: { value: hashed },
      create: { key: 'admin_password', value: hashed },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '设置密码失败' });
  }
});

// 验证管理密码
router.post('/verify-password', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { password } = req.body;
    const stored = await prisma.setting.findUnique({
      where: { key: 'admin_password' },
    });
    if (!stored) {
      // 首次使用，未设置密码
      return res.json({ verified: true, firstTime: true });
    }
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    const verified = hashed === stored.value;
    res.json({ verified, firstTime: false });
  } catch (error) {
    res.status(500).json({ error: '验证失败' });
  }
});

// 检查是否已初始化
router.get('/init-status', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const password = await prisma.setting.findUnique({
      where: { key: 'admin_password' },
    });
    const hasAgents = await prisma.agent.count() > 0;
    const hasClasses = await prisma.class.count() > 0;
    res.json({
      initialized: !!password,
      hasAgents,
      hasClasses,
    });
  } catch (error) {
    res.status(500).json({ error: '检查失败' });
  }
});

// 重置管理密码为默认密码（从控制面板调用）
router.post('/reset-password', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const defaultPassword = '123456';
    const hashed = crypto.createHash('sha256').update(defaultPassword).digest('hex');
    await prisma.setting.upsert({
      where: { key: 'admin_password' },
      update: { value: hashed },
      create: { key: 'admin_password', value: hashed },
    });
    res.json({ success: true, message: '密码已重置为 123456' });
  } catch (error) {
    res.status(500).json({ error: '重置密码失败' });
  }
});

export default router;
