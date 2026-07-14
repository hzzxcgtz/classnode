import { Router } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import { hashPassword, SCRYPT_PREFIX, verifyPassword } from '../services/password-security.js';
import {
  createTeacherSession,
  destroyTeacherSession,
  hasTeacherSession,
  isLoopbackRequest,
  requireTeacher,
  revokeAllTeacherSessions,
} from '../middleware/auth.js';

const router: Router = Router();
type LoginAttempt = { count: number; blockedUntil: number; lastAttemptAt: number };
const loginAttempts = new Map<string, LoginAttempt>();
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60_000;
const LOGIN_BLOCK_MS = 60_000;
const MAX_LOGIN_ATTEMPT_CLIENTS = 5_000;

function clientKey(req: import('express').Request): string {
  return req.socket.remoteAddress || 'unknown';
}

/** 将同一来源的连续错误限制在短时间窗口内，避免历史误输长期影响教师登录。 */
export function nextLoginAttempt(previous: LoginAttempt | undefined, now = Date.now()): LoginAttempt {
  const reset = !previous
    || now - previous.lastAttemptAt >= LOGIN_ATTEMPT_WINDOW_MS
    || (previous.blockedUntil > 0 && previous.blockedUntil <= now);
  const count = reset ? 1 : previous.count + 1;
  return { count, blockedUntil: count >= 5 ? now + LOGIN_BLOCK_MS : 0, lastAttemptAt: now };
}

function getCurrentLoginAttempt(key: string, now: number): LoginAttempt | undefined {
  const attempt = loginAttempts.get(key);
  if (!attempt) return undefined;
  if (now - attempt.lastAttemptAt >= LOGIN_ATTEMPT_WINDOW_MS || (attempt.blockedUntil > 0 && attempt.blockedUntil <= now)) {
    loginAttempts.delete(key);
    return undefined;
  }
  return attempt;
}

function pruneLoginAttempts(now: number): void {
  if (loginAttempts.size < MAX_LOGIN_ATTEMPT_CLIENTS) return;
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.lastAttemptAt >= LOGIN_ATTEMPT_WINDOW_MS && attempt.blockedUntil <= now) loginAttempts.delete(key);
  }
  while (loginAttempts.size >= MAX_LOGIN_ATTEMPT_CLIENTS) {
    const oldestKey = loginAttempts.keys().next().value;
    if (!oldestKey) break;
    loginAttempts.delete(oldestKey);
  }
}

router.get('/init-status', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const password = await prisma.setting.findUnique({ where: { key: 'admin_password' } });
    const hasAgents = await prisma.agent.count() > 0;
    const hasClasses = await prisma.class.count() > 0;
    res.json({ initialized: !!password, authenticated: hasTeacherSession(req), hasAgents, hasClasses });
  } catch {
    res.status(500).json({ error: '检查失败' });
  }
});

router.post('/admin-password', async (req, res) => {
  // 首次初始化决定教师控制台的归属，只允许在安装本应用的教师电脑上完成。
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: '请在教师电脑本机完成首次密码设置' });
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const existing = await prisma.setting.findUnique({ where: { key: 'admin_password' } });
    if (existing) return res.status(409).json({ error: '管理密码已设置，请使用修改密码功能' });
    const { password } = req.body;
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: '密码至少8位' });
    }
    await prisma.setting.create({ data: { key: 'admin_password', value: hashPassword(password) } });
    createTeacherSession(res);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '设置密码失败' });
  }
});

router.post('/verify-password', async (req, res) => {
  try {
    const key = clientKey(req);
    const now = Date.now();
    const attempt = getCurrentLoginAttempt(key, now);
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
    }
    const prisma: PrismaClient = req.app.get('prisma');
    const stored = await prisma.setting.findUnique({ where: { key: 'admin_password' } });
    if (!stored) return res.json({ verified: true, firstTime: true });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const verified = verifyPassword(password, stored.value);
    if (!verified) {
      pruneLoginAttempts(now);
      loginAttempts.set(key, nextLoginAttempt(attempt, now));
      return res.status(401).json({ verified: false, firstTime: false, error: '密码错误' });
    }
    loginAttempts.delete(key);
    if (!stored.value.startsWith(`${SCRYPT_PREFIX}$`)) {
      await prisma.setting.update({ where: { key: 'admin_password' }, data: { value: hashPassword(password) } });
    }
    createTeacherSession(res);
    res.json({ verified: true, firstTime: false });
  } catch {
    res.status(500).json({ error: '验证失败' });
  }
});

router.get('/session', (req, res) => {
  res.json({ authenticated: hasTeacherSession(req) });
});

router.post('/logout', (req, res) => {
  destroyTeacherSession(req, res);
  res.json({ success: true });
});

router.post('/change-password', requireTeacher, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: '新密码至少8位' });
    }
    const prisma: PrismaClient = req.app.get('prisma');
    const stored = await prisma.setting.findUnique({ where: { key: 'admin_password' } });
    if (!stored || typeof currentPassword !== 'string' || !verifyPassword(currentPassword, stored.value)) {
      return res.status(401).json({ error: '当前密码错误' });
    }
    await prisma.setting.update({ where: { key: 'admin_password' }, data: { value: hashPassword(newPassword) } });
    revokeAllTeacherSessions();
    createTeacherSession(res);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '修改密码失败' });
  }
});

router.post('/reset-password', async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: '只能从本机控制面板重置密码' });
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const temporaryPassword = crypto.randomBytes(9).toString('base64url');
    await prisma.setting.upsert({
      where: { key: 'admin_password' },
      update: { value: hashPassword(temporaryPassword) },
      create: { key: 'admin_password', value: hashPassword(temporaryPassword) },
    });
    revokeAllTeacherSessions();
    res.json({ success: true, temporaryPassword, message: '已生成临时密码，请登录后立即修改' });
  } catch {
    res.status(500).json({ error: '重置密码失败' });
  }
});

router.use(requireTeacher);

router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const settings = await prisma.setting.findMany({ where: { key: { not: 'admin_password' } } });
    const result: Record<string, string> = {};
    settings.forEach((s: Prisma.SettingGetPayload<object>) => { result[s.key] = s.value; });
    res.json(result);
  } catch {
    res.status(500).json({ error: '获取设置失败' });
  }
});

router.put('/:key', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { key } = req.params;
    if (key === 'admin_password') return res.status(400).json({ error: '请使用修改密码接口' });
    const value = typeof req.body?.value === 'string' ? req.body.value : '';
    const setting = await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    if (key === 'bind-ip') req.app.get('io')?.emit('nic-changed', { ip: value });
    res.json(setting);
  } catch {
    res.status(500).json({ error: '保存设置失败' });
  }
});

export default router;
