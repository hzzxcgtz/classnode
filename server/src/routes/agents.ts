import { Router } from 'express';
import { Agent, Prisma, PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { testAgentAvailability, fetchAgentGreeting, fetchAgentInfo, discoverCozeBotWithPat } from '../services/ai-proxy.js';
import { encrypt, decrypt, isEncrypted } from '../services/crypto.js';
import { detectSafeImage, sanitizeSvg } from '../services/upload-security.js';
import { maskAgentSecret, shouldPreserveAgentSecret } from '../services/agent-secret-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

/** 管理员可配置平台网关，但不允许服务端请求本机或私有网段，避免误访问教师电脑内网服务。 */
function validateAgentApiUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'API 地址格式无效';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return '自定义 API 地址必须使用 HTTPS';
    if (host === 'localhost' || host.endsWith('.localhost') || isPrivateIpv4(host) || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      return '自定义 API 地址不能指向本机或私有网络';
    }
    return null;
  } catch {
    return 'API 地址格式无效';
  }
}

// File upload config for agent logos
const storage = multer.diskStorage({
  destination: process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'logos')
    : path.join(__dirname, '../../uploads/logos'),
  filename: (_req, file, cb) => {
    cb(null, `logo-${crypto.randomUUID()}.upload`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Ensure upload directory exists
const logosDir = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'logos')
  : path.join(__dirname, '../../uploads/logos');
fs.mkdirSync(logosDir, { recursive: true });

const MANAGED_LOGO_FILE = /^logo-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|svg)$/i;

function deleteManagedLogo(logo: string | null | undefined): void {
  if (!logo?.startsWith('/uploads/logos/')) return;
  const name = logo.slice('/uploads/logos/'.length);
  if (!MANAGED_LOGO_FILE.test(name)) return;
  try { fs.unlinkSync(path.join(logosDir, name)); } catch {}
}

function discardUploadedLogo(req: import('express').Request): void {
  if (!req.file) return;
  try { fs.unlinkSync(req.file.path); } catch {}
}

function secureLogoUpload(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  if (!req.file) return next();
  try {
    const content = fs.readFileSync(req.file.path);
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    let safeExt: string | null = detectSafeImage(content);
    if (originalExt === '.svg') {
      const safeSvg = sanitizeSvg(content.toString('utf8'));
      if (safeSvg) {
        fs.writeFileSync(req.file.path, safeSvg, 'utf8');
        safeExt = 'svg';
      }
    }
    if (!safeExt) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Logo 文件内容无效，仅支持安全的 PNG、JPEG、WebP 或 SVG' });
      return;
    }
    const safeName = `logo-${crypto.randomUUID()}.${safeExt}`;
    fs.renameSync(req.file.path, path.join(logosDir, safeName));
    req.file.filename = safeName;
    req.file.path = path.join(logosDir, safeName);
    next();
  } catch {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: 'Logo 文件校验失败' });
  }
}

/** 解密 agent 对象中的 apiKey */
function toPublicAgent(agent: Agent | null) {
  if (!agent) return agent;
  let rawKey = agent.apiKey || '';
  try {
    if (isEncrypted(rawKey)) rawKey = decrypt(rawKey);
  } catch { rawKey = ''; }
  let publicExtra: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(agent.extra || '{}');
    let rawSecret = typeof parsed.apiSecret === 'string' ? parsed.apiSecret : '';
    try {
      if (rawSecret && isEncrypted(rawSecret)) rawSecret = decrypt(rawSecret);
    } catch { rawSecret = ''; }
    publicExtra = {
      ...parsed,
      apiSecret: undefined,
      hasApiSecret: !!rawSecret,
      apiSecretMask: rawSecret ? maskAgentSecret(rawSecret) : undefined,
    };
  } catch {}
  return { ...agent, apiKey: maskAgentSecret(rawKey), hasApiKey: !!rawKey, extra: JSON.stringify(publicExtra) };
}

/** 加密 apiKey（仅未加密的原始值才加密） */
function encryptApiKey(apiKey: string): string {
  if (isEncrypted(apiKey)) return apiKey;
  return encrypt(apiKey);
}

function encryptExtraSecrets(extra?: string | null): string | null {
  if (!extra) return null;
  const parsed = JSON.parse(extra);
  if (parsed.apiSecret && !isEncrypted(parsed.apiSecret)) parsed.apiSecret = encrypt(parsed.apiSecret);
  return JSON.stringify(parsed);
}

async function migrateAgentSecrets(prisma: PrismaClient, agent: Agent): Promise<void> {
  const apiKey = agent.apiKey && !isEncrypted(agent.apiKey) ? encrypt(agent.apiKey) : agent.apiKey;
  let extra = agent.extra;
  try { extra = encryptExtraSecrets(agent.extra); } catch {}
  if (apiKey !== agent.apiKey || extra !== agent.extra) {
    await prisma.agent.update({ where: { id: agent.id }, data: { apiKey, extra } });
  }
}

// 获取所有智能体
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    await Promise.all(agents.map(agent => migrateAgentSecrets(prisma, agent)));
    res.json(agents.map(toPublicAgent));
  } catch (error) {
    res.status(500).json({ error: '获取智能体列表失败' });
  }
});

/**
 * 直接获取智能体信息（无需保存，用于新建时预览）
 */
router.post('/info-preview', async (req, res) => {
  try {
    const { platform, botId, apiKey, apiUrl, projectId, apiSecret } = req.body as Record<string, string | undefined>;
    if (!platform || !botId || !apiKey) {
      return res.status(400).json({ error: '缺少必要参数 platform、botId、apiKey' });
    }
    const apiUrlError = validateAgentApiUrl(apiUrl);
    if (apiUrlError) return res.status(400).json({ error: apiUrlError });
    const result = await fetchAgentInfo({
      platform,
      apiUrl: (apiUrl && apiUrl !== 'undefined' ? apiUrl : undefined),
      apiKey,
      botId,
      extra: JSON.stringify({ projectId, apiSecret }),
    });
    if (!result) {
      return res.json({ name: null, iconUrl: null, greeting: null });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取智能体信息失败' });
  }
});

// 获取单个智能体
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });
    await migrateAgentSecrets(prisma, agent);
    res.json(toPublicAgent(agent));
  } catch (error) {
    res.status(500).json({ error: '获取智能体失败' });
  }
});

// 创建智能体
router.post('/', upload.single('logo'), secureLogoUpload, async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, platform, apiUrl, apiKey, botId, extra, greeting } = req.body;
    if (typeof apiKey !== 'string' || !apiKey.trim()) return res.status(400).json({ error: 'API 密钥不能为空' });
    const apiUrlError = validateAgentApiUrl(apiUrl);
    if (apiUrlError) {
      discardUploadedLogo(req);
      return res.status(400).json({ error: apiUrlError });
    }
    let storedExtra = extra || null;
    if (extra) {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(extra); } catch {
        discardUploadedLogo(req);
        return res.status(400).json({ error: '扩展配置格式无效，请重新填写' });
      }
      if (typeof parsed.apiSecret === 'string' && parsed.apiSecret) parsed.apiSecret = encryptApiKey(parsed.apiSecret);
      storedExtra = encryptExtraSecrets(JSON.stringify(parsed));
    }
    const logo = req.file ? `/uploads/logos/${req.file.filename}` : (req.body.logo || null);

    const agent = await prisma.agent.create({
      data: {
        name,
        platform,
        apiUrl: apiUrl || null,
        apiKey: encrypt(apiKey),
        botId: botId || null,
        extra: storedExtra,
        greeting: greeting || null,
        logo,
      },
    });

    res.json(toPublicAgent(agent));
  } catch (error) {
    discardUploadedLogo(req);
    console.error('[agents] 创建智能体失败:', error);
    res.status(500).json({ error: '创建智能体失败' });
  }
});

// 更新智能体
router.put('/:id', upload.single('logo'), secureLogoUpload, async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, platform, apiUrl, apiKey, botId, extra, enabled, greeting } = req.body;
    const previousAgent = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { logo: true } });
    if (!previousAgent) {
      discardUploadedLogo(req);
      return res.status(404).json({ error: '智能体不存在' });
    }
    const apiUrlError = validateAgentApiUrl(apiUrl);
    if (apiUrlError) {
      discardUploadedLogo(req);
      return res.status(400).json({ error: apiUrlError });
    }

    const data: Prisma.AgentUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (platform !== undefined) data.platform = platform;
    if (apiUrl !== undefined) data.apiUrl = apiUrl;
    if (typeof apiKey === 'string' && apiKey.trim()) data.apiKey = encryptApiKey(apiKey.trim());
    if (botId !== undefined) data.botId = botId;
    if (extra !== undefined) {
      let incoming: Record<string, unknown>;
      try { incoming = JSON.parse(extra || '{}'); } catch {
        discardUploadedLogo(req);
        return res.status(400).json({ error: '扩展配置格式无效，请重新填写' });
      }
      const existing = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { extra: true, platform: true } });
      let previous: Record<string, unknown> = {};
      try { previous = JSON.parse(existing?.extra || '{}'); } catch {}
      const remainsOnSamePlatform = shouldPreserveAgentSecret(existing?.platform, platform);
      if (!incoming.apiSecret && previous.apiSecret && remainsOnSamePlatform) incoming.apiSecret = previous.apiSecret;
      else if (typeof incoming.apiSecret === 'string' && incoming.apiSecret) incoming.apiSecret = encryptApiKey(incoming.apiSecret);
      data.extra = JSON.stringify(incoming);
    }
            if (greeting !== undefined) data.greeting = greeting || null;
    if (enabled !== undefined) data.enabled = enabled === 'true' || enabled === true;
    if (req.file) data.logo = `/uploads/logos/${req.file.filename}`;
    else if (req.body.logo && typeof req.body.logo === 'string' && req.body.logo.startsWith('http')) data.logo = req.body.logo;
    if (req.body.removeLogo === 'true') data.logo = null;

    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
    });
    if (previousAgent.logo !== agent.logo) deleteManagedLogo(previousAgent.logo);

    // 启用/停用状态变更时，通过 socket 实时通知学生
    if (enabled !== undefined) {
      const io: import('socket.io').Server = req.app.get('io');
      // 查找使用了该智能体的活跃课堂（包括通过 classroomAgents 和 groups 两种方式）
      const allClassroomIds = new Set<string>();
      const classroomAgents = await prisma.classroomAgent.findMany({
        where: { agentId: agent.id },
        include: { classroom: { select: { id: true, status: true } } },
      });
      classroomAgents.forEach(ca => { if (ca.classroom.status !== 'ended') allClassroomIds.add(ca.classroom.id); });
      const classroomGroups = await prisma.classroomGroup.findMany({
        where: { agentId: agent.id },
        include: { classroom: { select: { id: true, status: true } } },
      });
      classroomGroups.forEach(cg => { if (cg.classroom.status !== 'ended') allClassroomIds.add(cg.classroom.id); });
      const eventName = agent.enabled ? 'agent-enabled' : 'agent-disabled';
      for (const classroomId of allClassroomIds) {
        io.to(`classroom:${classroomId}`).emit(eventName, { classroomId, agentName: agent.name });
        io.to(`teacher:${classroomId}`).emit(eventName, { classroomId, agentName: agent.name });
      }
    }

    res.json(toPublicAgent(agent));
  } catch (error) {
    discardUploadedLogo(req);
    console.error(`[agents] 更新智能体失败 (${req.params.id}):`, error);
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
    const [agent, caCount, cgCount] = await Promise.all([
      prisma.agent.findUnique({ where: { id: req.params.id }, select: { logo: true } }),
      prisma.classroomAgent.count({ where: { agentId: req.params.id } }),
      prisma.classroomGroup.count({ where: { agentId: req.params.id } }),
    ]);
    if (!agent) return res.status(404).json({ error: '智能体不存在' });
    if (caCount > 0 || cgCount > 0) {
      return res.status(400).json({
        error: `该智能体已关联 ${caCount} 个课堂和 ${cgCount} 个分组，无法删除。请先删除关联的课堂后再试。`,
      });
    }

    await prisma.agent.delete({ where: { id: req.params.id } });
    deleteManagedLogo(agent.logo);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除智能体失败' });
  }
});

// 获取智能体开场白（从平台 API）
router.get('/:id/greeting', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    // 有缓存且 30 分钟内拉取过则直接返回
    if (req.query.force !== 'true' && agent.greeting && agent.greetingFetchedAt) {
      const age = Date.now() - new Date(agent.greetingFetchedAt).getTime();
      if (age < 30 * 60 * 1000) {
        return res.json({ greeting: agent.greeting });
      }
    }

    // 无缓存或过期，从平台 API 重新拉取
    const decryptedKey = isEncrypted(agent.apiKey) ? decrypt(agent.apiKey) : agent.apiKey;
    const greeting = await fetchAgentGreeting({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: decryptedKey,
      botId: agent.botId || undefined,
      extra: agent.extra || undefined,
    });

    // 缓存到数据库（无论有无结果都更新时间戳，避免每次调用都去拉）
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        greeting: greeting || agent.greeting,
        greetingFetchedAt: new Date(),
      },
    });

    res.json({ greeting: greeting || null });
  } catch (error) {
    res.status(500).json({ error: '获取开场白失败' });
  }
});

/**
 * 从平台 API 获取智能体完整信息（名称、头像、开场白）
 */
router.get('/:id/info', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    // 先解密 API Key
    const decryptedKey = isEncrypted(agent.apiKey) ? decrypt(agent.apiKey) : agent.apiKey;

    // 先尝试用标准方式获取
    let result = await fetchAgentInfo({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: decryptedKey,
      botId: agent.botId || undefined,
      extra: agent.extra || undefined,
    });

    // Coze Agent 无 botId 时，借用已有 Coze 智能体的 PAT 进行工作区发现
    if (!result && agent.platform === 'coze-agent') {
      const cozeAgent = await prisma.agent.findFirst({
        where: { platform: 'coze' },
      });
      if (cozeAgent) {
        const cozeDecryptedKey = isEncrypted(cozeAgent.apiKey) ? decrypt(cozeAgent.apiKey) : cozeAgent.apiKey;
        const discovered = await discoverCozeBotWithPat(cozeDecryptedKey, agent.name);
        if (discovered) {
          const baseUrl = 'https://api.coze.cn';
          const infoRes = await fetch(`${baseUrl}/v1/bot/get_online_info?bot_id=${discovered.botId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cozeDecryptedKey}` },
          });
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            const r: { name?: string; iconUrl?: string; greeting?: string } = {};
            if (infoData?.data?.name) r.name = infoData.data.name;
            if (discovered.iconUrl) r.iconUrl = discovered.iconUrl;
            if (infoData?.data?.onboarding_info?.prologue) {
              r.greeting = infoData.data.onboarding_info.prologue;
            } else if (infoData?.data?.onboarding_info_v2?.prologue) {
              r.greeting = infoData.data.onboarding_info_v2.prologue;
            }
            if (Object.keys(r).length > 0) result = r;
          }
        }
      }
    }

    if (!result) {
      return res.json({ name: null, iconUrl: null, greeting: null });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取智能体信息失败' });
  }
});

// 连通性测试
router.post('/:id/test', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    const decryptedKey = isEncrypted(agent.apiKey) ? decrypt(agent.apiKey) : agent.apiKey;
    const result = await testAgentAvailability({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: decryptedKey,
      botId: agent.botId || undefined,
      extra: agent.extra || undefined,
    });

    // 将测试结果持久化到数据库
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        lastCheckAt: new Date(),
        lastCheckOk: result.success,
        lastCheckError: result.success ? null : (result.error || '连接失败'),
      },
    });

    // 测试成功后通知所有客户端清除该智能体的异常提醒
    if (result.success) {
      const io: import('socket.io').Server = req.app.get('io');
      io.emit('agent-test-passed', agent.name);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '测试失败' });
  }
});

// 测试 socket 事件推送
router.post('/test-emit', (req, res) => {
  const io = req.app.get('io');
  if (io) {
    io.emit('agents-checked');
    res.json({ success: true, clientsCount: io.engine?.clientsCount ?? 0 });
  } else {
    res.json({ success: false, error: 'io not found' });
  }
});

export default router;
