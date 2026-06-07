import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
const router: Router = Router();

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || (() => {
  console.warn('[Settings] 使用默认加密密钥，生产环境请设置 ENCRYPTION_KEY 环境变量');
  return crypto.createHash('sha256').update('classnode-default-key-2024').digest('hex').slice(0, 32);
})();

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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

export default router;
