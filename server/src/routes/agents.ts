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
import { toAgentConfig } from '../services/agent-config.js';
// ★ M7b：`purpose` 的归一化（**闸**的取值域住在那个零 import 的模块里）。
// ⚠️ `toPublicAgent` 是 `{ ...agent, ... }` ⇒ `purpose` 自动随列表下发，不必在那里补一行。
import { normalizeAgentPurpose } from '../services/agent-purpose.js';

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
    // ★ M7b：可按用途过滤（`?purpose=tutoring|analysis`）。**让服务端过滤**是为了让前端
    // 不必自己复述那条规则 —— 复述一遍就是第二份真源，而它漂了不会红。
    const purposeFilter = req.query.purpose;
    const where = purposeFilter === 'analysis' || purposeFilter === 'tutoring'
      ? { purpose: purposeFilter }
      : {};
    const agents = await prisma.agent.findMany({ where, orderBy: { createdAt: 'desc' } });
    await Promise.all(agents.map(agent => migrateAgentSecrets(prisma, agent)));

    // 每个智能体关联到的**去重后**的课堂数 —— 管理页的概览条与「按关联状态筛选」要用它。
    //
    // 🔴 **两条关联路径都要算**：`ClassroomAgent`（标准模式建的课堂）与
    // `ClassroomGroup`（分组/高级模式里每组绑的智能体）。只数前者的实现会让高级模式的
    // 课堂**从计数里整个消失，却不报任何错** —— 卡片显示「未关联」，而删除时守卫
    // （数的是两张表）回 400，界面与守卫自相矛盾。
    //
    // 去重按 `classroomId`：一个课堂可能同时经 `ClassroomAgent`（标准/分组模式）与
    // `ClassroomGroupMaterial`（高级模式每组一份）引用同一个智能体，所以这是常态而非边界。
    //
    // 🔴 组级那一支必须查 **`ClassroomGroupMaterial`**，不能再查 `ClassroomGroup.agentId`
    // —— 那一列已经不存在了（本改动的迁移把它搬进了新表）。查错表不会报错，只会让
    // 高级模式的课堂整个从清单里消失。
    //
    // ⚠️ **三次查询解决全部智能体，不要在 map 里逐个查**（那是 N+1）。
    const classroomIdsByAgent = new Map<string, Set<string>>();
    const agentIds = agents.map(agent => agent.id);
    if (agentIds.length > 0) {
      const [directRows, groupRows] = await Promise.all([
        prisma.classroomAgent.findMany({
          where: { agentId: { in: agentIds } },
          select: { agentId: true, classroomId: true },
        }),
        prisma.classroomGroupMaterial.findMany({
          where: { kind: 'agent', targetId: { in: agentIds } },
          select: { targetId: true, group: { select: { classroomId: true } } },
        }),
      ]);
      for (const row of [
        ...directRows,
        ...groupRows.map(row => ({ agentId: row.targetId, classroomId: row.group.classroomId })),
      ]) {
        const seen = classroomIdsByAgent.get(row.agentId) ?? new Set<string>();
        seen.add(row.classroomId);
        classroomIdsByAgent.set(row.agentId, seen);
      }
    }

    res.json(agents.map(agent => ({
      ...toPublicAgent(agent),
      classroomCount: classroomIdsByAgent.get(agent.id)?.size ?? 0,
    })));
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
    const { name, platform, apiUrl, apiKey, botId, extra, greeting, purpose, credentialId } = req.body;
    // ★ 2026-09-25：Coze 低代码的 Token 可以**选一份共享的**（`credentialId`）而不是自己填 ——
    // 同一个扣子账号做出来的多个智能体共用一份，换一次只需改那一份。
    // ⇒ 判据从「apiKey 必填」放宽成「**两者至少有一个**」。
    // ⚠️ 放宽的是**必填**，不是**校验**：下面仍然要求那个凭据真的存在（防一个悬空 id 落库）。
    const sharedCredentialId = typeof credentialId === 'string' && credentialId.trim() ? credentialId.trim() : null;
    if (!sharedCredentialId && (typeof apiKey !== 'string' || !apiKey.trim())) {
      return res.status(400).json({ error: '请填写 API 密钥，或者选一份共享的 API Token' });
    }
    if (sharedCredentialId) {
      const credential = await prisma.platformToken.findUnique({ where: { id: sharedCredentialId }, select: { id: true } });
      if (!credential) {
        discardUploadedLogo(req);
        return res.status(400).json({ error: '选中的 API Token 不存在，请刷新后重试' });
      }
    }
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
        // ⚠️ 选了共享凭据时这里**仍然写一份**（可能为空串）：`apiKey` 列是 NOT NULL，
        // 而且它同时是「改回自带 Token」时的回落值 —— 见 `toAgentConfig` 的判据。
        apiKey: typeof apiKey === 'string' && apiKey.trim() ? encrypt(apiKey) : encrypt(''),
        botId: botId || null,
        credentialId: sharedCredentialId,
        extra: storedExtra,
        greeting: greeting || null,
        // ★ M7b：坏值回落 `tutoring`（**保守方向** —— 见 `normalizeAgentPurpose` 的注释）
        purpose: normalizeAgentPurpose(purpose),
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
    const { name, platform, apiUrl, apiKey, botId, extra, enabled, greeting, purpose, credentialId } = req.body;
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
    // ★ 2026-09-25：共享凭据的三种语义（与 `readExpiresAt` 那条纪律同款）：
    //   · 字段**不在**请求里 ⇒ 这次不改它；
    //   · 空串 ⇒ **改回自带 Token**（清掉引用）；
    //   · 有值 ⇒ 接到那一份上（**必须真的存在**，否则会留下一个悬空 id —— 而它只会
    //     让 `toAgentConfig` 静默回落到自带 Token，教师以为自己换成了共享的）。
    if (credentialId !== undefined) {
      const nextId = typeof credentialId === 'string' && credentialId.trim() ? credentialId.trim() : null;
      if (nextId) {
        const credential = await prisma.platformToken.findUnique({ where: { id: nextId }, select: { id: true } });
        if (!credential) return res.status(400).json({ error: '选中的 API Token 不存在，请刷新后重试' });
      }
      // ⚠️ `data` 标注的是 `Prisma.AgentUpdateInput`（checked input）—— 它**没有**裸外键列
      // `credentialId`，只有关系 `credential`。写 `data.credentialId` 会编译失败（好事：
      // 类型把它挡住了）。清空用 `disconnect`。
      data.credential = nextId ? { connect: { id: nextId } } : { disconnect: true };
    }
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
    // ★ M7b：只在**明确传了**的时候改（`undefined` = 这次不动它）——
    // 与上面 `name`/`platform` 那条纪律同形。⚠️ 传坏值回落 `tutoring`，
    // 而 `tutoring` 是**会被学生看见**的那一侧 ⇒ 这是刻意的保守方向（不是安全的默认方向）。
    if (purpose !== undefined) data.purpose = normalizeAgentPurpose(purpose);
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
      // 查找使用了该智能体的活跃课堂（包括通过 classroomAgents 和组级材料两种方式）
      const allClassroomIds = new Set<string>();
      const classroomAgents = await prisma.classroomAgent.findMany({
        where: { agentId: agent.id },
        include: { classroom: { select: { id: true, status: true } } },
      });
      classroomAgents.forEach(ca => { if (ca.classroom.status !== 'ended') allClassroomIds.add(ca.classroom.id); });
      // 组级那一支同理必须查新表（`ClassroomGroup.agentId` 已删）。漏了这一支不会报错，
      // 只会让「高级模式下只经组级材料关联的课堂」收不到启停通知 ⇒ 学生继续对着一个
      // 教师以为已经停用的智能体说话。
      const groupMaterials = await prisma.classroomGroupMaterial.findMany({
        where: { kind: 'agent', targetId: agent.id },
        include: { group: { select: { classroom: { select: { id: true, status: true } } } } },
      });
      groupMaterials.forEach(m => { if (m.group.classroom.status !== 'ended') allClassroomIds.add(m.group.classroom.id); });
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
//
// ⚠️ 三个计数字段（`used` / `classroomCount` / `groupCount`）是**删除守卫的判据**
// （见本文件 DELETE /:id 的分支），任何改动都会连带改掉「能不能删」，
// 所以它们原样不动 —— 新增的 `classrooms` 只是给界面看的清单。
// ⚠️ `groupCount` 的来源换成了 `ClassroomGroupMaterial`（`kind='agent'`）
// —— 字段名与语义（「多少个小组用了它」）不变，只有底层那张表变了。
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const caCount = await prisma.classroomAgent.count({
      where: { agentId: req.params.id },
    });
    const cgCount = await prisma.classroomGroupMaterial.count({
      where: { kind: 'agent', targetId: req.params.id },
    });

    // 关联课堂清单必须 **union 两张表**：`ClassroomAgent`（标准/分组模式建的课堂）
    // 与 `ClassroomGroupMaterial`（高级模式里每组绑的智能体）。
    // 只查前者不会报错，只会让高级模式的课堂整个消失 —— 界面显示「没有关联」，
    // 教师照着去删，删除守卫却回 400，两边自相矛盾。
    //
    // 去重按 `classroomId`（照上面的 Set 写法）：同一个课堂既在 ClassroomAgent
    // 又在某个组级材料里时只出现一次，且保留先遇到的那条。
    const classroomAgents = await prisma.classroomAgent.findMany({
      where: { agentId: req.params.id },
      include: { classroom: { select: { id: true, title: true, status: true, mode: true } } },
    });
    const groupMaterials = await prisma.classroomGroupMaterial.findMany({
      where: { kind: 'agent', targetId: req.params.id },
      include: { group: { select: { classroom: { select: { id: true, title: true, status: true, mode: true } } } } },
    });
    const byClassroomId = new Map<string, { id: string; title: string; status: string; mode: string }>();
    const collect = (rows: Array<{ classroom: { id: string; title: string | null; status: string; mode: string } }>) => {
      rows.forEach(row => {
        if (byClassroomId.has(row.classroom.id)) return;
        byClassroomId.set(row.classroom.id, {
          id: row.classroom.id,
          title: row.classroom.title || '未命名课堂',
          status: row.classroom.status,
          mode: row.classroom.mode,
        });
      });
    };
    collect(classroomAgents);
    collect(groupMaterials.map(material => ({ classroom: material.group.classroom })));

    res.json({
      used: caCount > 0 || cgCount > 0,
      classroomCount: caCount,
      groupCount: cgCount,
      classrooms: [...byClassroomId.values()],
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
    // ⚠️ 组级那一支查 `ClassroomGroupMaterial`（`ClassroomGroup.agentId` 已删）。
    const [agent, caCount, cgCount, worksheets] = await Promise.all([
      prisma.agent.findUnique({ where: { id: req.params.id }, select: { logo: true } }),
      prisma.classroomAgent.count({ where: { agentId: req.params.id } }),
      prisma.classroomGroupMaterial.count({ where: { kind: 'agent', targetId: req.params.id } }),
      // ★ M7b（独立审查 M5）：**第三处引用**。`settings.analysisAgentId` 住在学习单的
      // JSON blob 里，两张关联表都数不到它 ⇒ 删掉一个正在被学习单引用的分析 bot，
      // 学习单里会留下一个**悬空 id**：矩阵浮层那边是响亮的（会说「不存在或已停用」），
      // 而学习单编辑器那一侧是**静默**的 —— 那个 id 不在候选项里，`<select>` 渲染不出它，
      // 教师看到的不是真实存着的值，而再保存一次会把悬空 id 接着存下去。
      // ⚠️ JSON 列在 SQLite 上没法用 Prisma 的 where 查内部字段 ⇒ 取回来在 JS 里筛
      //（学习单是几十行的量级，`select` 只取 id/title/settings）。
      prisma.worksheet.findMany({ select: { id: true, title: true, settings: true } }),
    ]);
    if (!agent) return res.status(404).json({ error: '智能体不存在' });
    const usedByWorksheets = worksheets.filter(
      (worksheet) => (worksheet.settings as Record<string, unknown> | null)?.analysisAgentId === req.params.id);
    if (caCount > 0 || cgCount > 0 || usedByWorksheets.length > 0) {
      const titles = usedByWorksheets.map((worksheet) => `《${worksheet.title}》`).join('、');
      return res.status(400).json({
        // 文案说「小组」而不是「分组」：`cgCount` 现在数的是**组级材料行**，
        // 一条行代表「某个小组用了这个智能体」—— 用「分组」会让教师去班级分组页找，
        // 而真正要解除的是课堂里那个小组的配置。
        error: `该智能体已关联 ${caCount} 个课堂和 ${cgCount} 个小组`
          + (usedByWorksheets.length > 0 ? `，还被学习单 ${titles} 指定为分析型智能体` : '')
          + '，无法删除。请先解除这些关联后再试。',
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
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      // ★ 2026-09-25：`toAgentConfig` 要用共享凭据决定使哪把钥匙，必须一起取。
      include: { credential: { select: { token: true } } },
    });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    // 有缓存且 30 分钟内拉取过则直接返回
    if (req.query.force !== 'true' && agent.greeting && agent.greetingFetchedAt) {
      const age = Date.now() - new Date(agent.greetingFetchedAt).getTime();
      if (age < 30 * 60 * 1000) {
        return res.json({ greeting: agent.greeting });
      }
    }

    // 无缓存或过期，从平台 API 重新拉取
    // ★ 收口：这一处从前自己 decrypt —— 它是 7 处之一。
    const config = toAgentConfig(agent, agent.credential);
    const greeting = await fetchAgentGreeting(config);

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
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      // ★ 2026-09-25：`toAgentConfig` 要用共享凭据决定使哪把钥匙，必须一起取。
      include: { credential: { select: { token: true } } },
    });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    // 先解密 API Key

    // 先尝试用标准方式获取
    // ★ 收口：这一处从前自己 decrypt —— 它是 7 处之一。
    const config = toAgentConfig(agent, agent.credential);
    let result = await fetchAgentInfo(config);

    // Coze Agent 无 botId 时，借用已有 Coze 智能体的 PAT 进行工作区发现
    if (!result && agent.platform === 'coze-agent') {
      const cozeAgent = await prisma.agent.findFirst({
        where: { platform: 'coze' },
        // ★ 这一处也是 7 处之一：它借的是「某个 coze 智能体」的 PAT，同样要走共享凭据。
        include: { credential: { select: { token: true } } },
      });
      if (cozeAgent) {
        const cozeDecryptedKey = toAgentConfig(cozeAgent, cozeAgent.credential).apiKey;
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
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      // ★ 2026-09-25：`toAgentConfig` 要用共享凭据决定使哪把钥匙，必须一起取。
      include: { credential: { select: { token: true } } },
    });
    if (!agent) return res.status(404).json({ error: '智能体不存在' });

    // ★ 收口：这一处从前自己 decrypt —— 它是 7 处之一。
    const config = toAgentConfig(agent, agent.credential);
    const result = await testAgentAvailability(config);

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
