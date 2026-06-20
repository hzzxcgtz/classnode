/**
 * 智能体连通性检测服务
 *
 * 启动时检测一次所有已启用智能体，不设置定时循环。
 * 手工检测由 agent 管理页面触发。
 */
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { testAgentAvailability } from './ai-proxy.js';
import { decrypt } from './crypto.js';

let prisma: PrismaClient | null = null;
let io: Server | null = null;

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
    const decryptedKey = (() => { try { return decrypt(agent.apiKey); } catch { return agent.apiKey; } })();
    const result = await testAgentAvailability({
      platform: agent.platform,
      apiUrl: agent.apiUrl || undefined,
      apiKey: decryptedKey,
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

/** 执行一次全量检测（被手工检测和启动检测共用） */
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

/**
 * 启动时检测一次（服务器启动时调用）
 * 仅检测已启用的智能体
 */
export async function startAgentChecker(prismaInstance: PrismaClient, ioInstance: Server): Promise<void> {
  prisma = prismaInstance;
  io = ioInstance;
  // 延迟 10 秒，避免启动时网络尚未稳定导致的假异常
  await new Promise(resolve => setTimeout(resolve, 10_000));
  await runCheckNow();
  // 不再设置定时循环
}
