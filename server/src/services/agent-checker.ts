/**
 * 智能体连通性定时检测服务
 *
 * 按可配置的时间间隔周期性地测试所有已启用智能体的 API 连通性，
 * 将检测结果更新到 Agent 表的 lastCheckAt / lastCheckOk / lastCheckError 字段。
 */
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { testAgentConnection } from './ai-proxy.js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let prisma: PrismaClient | null = null;
let io: Server | null = null;

/** 默认检测间隔（分钟） */
const DEFAULT_INTERVAL_MINUTES = 10;

/** 获取当前配置的检测间隔（分钟） */
async function getIntervalMinutes(): Promise<number> {
  try {
    if (!prisma) return DEFAULT_INTERVAL_MINUTES;
    const setting = await prisma.setting.findUnique({
      where: { key: 'agent_check_interval' },
    });
    const val = parseInt(setting?.value || String(DEFAULT_INTERVAL_MINUTES), 10);
    return Math.max(val, 1);
  } catch {
    return DEFAULT_INTERVAL_MINUTES;
  }
}

/** 检查单个智能体的连通性，返回是否成功 */
async function checkAgent(agent: {
  id: string;
  name: string;
  platform: string;
  apiUrl: string | null;
  apiKey: string;
  botId: string | null;
  extra: string | null;
}): Promise<boolean> {
  try {
    const result = await testAgentConnection({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: agent.apiKey,
      botId: agent.botId || undefined,
      extra: agent.extra || undefined,
    });
    await prisma!.agent.update({
      where: { id: agent.id },
      data: {
        lastCheckAt: new Date(),
        lastCheckOk: result.success,
        lastCheckError: result.success ? null : (result.error || '连接失败'),
      },
    });
    return result.success;
  } catch (error: any) {
    await prisma!.agent.update({
      where: { id: agent.id },
      data: {
        lastCheckAt: new Date(),
        lastCheckOk: false,
        lastCheckError: error?.message || '检测异常',
      },
    });
    return false;
  }
}

/** 执行一次全量检测 */
export async function runCheckNow(): Promise<void> {
  if (!prisma) return;
  try {
    const agents = await prisma.agent.findMany({ where: { enabled: true }, select: { id: true, name: true, platform: true, apiUrl: true, apiKey: true, botId: true, extra: true } });
    if (agents.length === 0) return;
    console.log(`[AgentChecker] 开始检测 ${agents.length} 个智能体...`);
    const results = await Promise.all(agents.map(checkAgent));
    const failed = agents.filter((_, i) => !results[i]).map(a => a.name);
    const clients = io?.engine?.clientsCount ?? 0;
    console.log(`[AgentChecker] 检测完成, socket clients: ${clients}, 异常: ${failed.length > 0 ? failed.join(', ') : '无'}`);
    io?.emit('agents-checked', { failed });
  } catch (e) {
    console.error('[AgentChecker] 检测异常:', e);
  }
}

/** 安排下一次定时检测 */
async function scheduleNext(): Promise<void> {
  if (intervalHandle) clearInterval(intervalHandle);
  const minutes = await getIntervalMinutes();
  intervalHandle = setInterval(runCheckNow, minutes * 60 * 1000);
  console.log(`[AgentChecker] 定时检测已启动，间隔 ${minutes} 分钟`);
}

/**
 * 启动定时检测（服务器启动时调用）
 * 首次启动会立即执行一次检测
 */
export async function startAgentChecker(prismaInstance: PrismaClient, ioInstance: Server): Promise<void> {
  prisma = prismaInstance;
  io = ioInstance;
  // 延迟首次检测，避免启动时网络尚未稳定导致的假异常
  await new Promise(resolve => setTimeout(resolve, 10_000));
  await runCheckNow();
  // 然后按间隔定时执行
  await scheduleNext();
}

/**
 * 重启定时器（设置变更后调用）
 */
export async function restartAgentChecker(): Promise<void> {
  if (!prisma) return;
  if (intervalHandle) clearInterval(intervalHandle);
  await scheduleNext();
}
