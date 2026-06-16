/**
 * 匿名使用统计心跳
 *
 * 服务启动时向统计服务器发送一次匿名 GET 请求，用于统计版本、平台分布和活跃设备数。
 * 不会发送任何个人身份信息。
 * 用户完全无感知，静默失败不影响服务。
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// 统计服务器地址（打包前配置，用户无感知）
const PING_URL = 'http://hzzxcgtz.51vip.biz:20601/ping';
const PING_TIMEOUT = 3000;

let _version: string | null = null;

function getVersion(): string {
  if (_version) return _version;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    _version = pkg.version || '0.0.0';
  } catch {
    _version = '0.0.0';
  }
  return _version!;
}

/**
 * 生成或获取持久化的实例 ID，存储在 SQLite 的 Setting 表中。
 * 每次启动不变，用于估算「活跃设备数」。
 */
async function getInstanceId(prisma: PrismaClient): Promise<string> {
  const key = 'instance_id';
  try {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (existing) return existing.value;
    const id = crypto.randomUUID();
    await prisma.setting.create({ data: { key, value: id } });
    return id;
  } catch {
    const fallbackFile = path.join(root, '.instance_id');
    if (fs.existsSync(fallbackFile)) {
      return fs.readFileSync(fallbackFile, 'utf-8').trim();
    }
    const id = crypto.randomUUID();
    try {
      fs.writeFileSync(fallbackFile, id);
    } catch { /* ignore */ }
    return id;
  }
}

/**
 * 发送匿名心跳
 */
export async function sendPing(prisma: PrismaClient): Promise<void> {
  // 开发环境不发送统计
  if (process.env.NODE_ENV === 'development') return;

  try {
    const version = getVersion();
    const instanceId = await getInstanceId(prisma);

    const url = new URL(PING_URL);
    url.searchParams.set('v', version);
    url.searchParams.set('os', process.platform);
    url.searchParams.set('arch', process.arch);
    url.searchParams.set('id', instanceId);

    // 附加智能体配置数据（记录用户接入的平台和数量）
    try {
      const agents = await prisma.agent.findMany();
      const agentCoze = agents.filter(a => a.platform === 'coze').length;
      const agentCozeAgent = agents.filter(a => a.platform === 'coze-agent').length;
      const agentZhipuai = agents.filter(a => a.platform === 'zhipuai').length;
      const agentWenxin = agents.filter(a => a.platform === 'wenxin').length;
      url.searchParams.set('agent_coze', String(agentCoze));
      url.searchParams.set('agent_coze_agent', String(agentCozeAgent));
      url.searchParams.set('agent_zhipuai', String(agentZhipuai));
      url.searchParams.set('agent_wenxin', String(agentWenxin));
    } catch { /* 数据库未就绪时不发送 */ }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);

    await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch {
    // 静默失败，不影响服务
  }
}
