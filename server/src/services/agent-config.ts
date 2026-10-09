import type { AgentConfig } from './ai-proxy.js';
import { decrypt, isEncrypted } from './crypto.js';

/** 调用侧从库里读到的智能体行（只列这个函数要用的那几列，调用点不必先投影）。 */
export interface AgentConfigRow {
  platform: string;
  apiUrl: string | null;
  apiKey: string;
  botId: string | null;
  extra: string | null;
  /** ★ 2026-09-25：指向一份共享 Token。`null` / 缺字段 = 用自带的 `apiKey`。 */
  credentialId?: string | null;
}

/** 共享 Token 那一行（只要密文那一格）。 */
export interface AgentCredentialRow {
  token: string;
}

/**
 * ★ 2026-09-25：**「这个智能体此刻该用哪把钥匙」的唯一答案。**
 *
 * 🔴 为什么必须收口 —— 不是为了少写几行，是因为收口之前那条路的失败是**静默**的：
 * 改动前 `decrypt(agent.apiKey)` 这句话在 **7 处、4 个文件**里各写了一遍
 *（`routes/agents.ts` ×4 · `routes/worksheets.ts` · `services/agent-checker.ts` ·
 * `socket/index.ts`）。将来加第 8 个调用点、或者只改了其中 6 处，**没有任何东西会红** ——
 * 表现是「**某一条链路还在用旧 Token**」。
 * 🔴 而这次的 7 处里**已经有 4 处不在对话链路上**（测试连接 / 开场白 / 信息预览 / 定时检查）
 * ⇒ 漏掉它们的症状是：**对话已经用上新 Token 了，而「测试连接」还在报旧 Token 的错**，
 * 教师会去查一个根本不存在的问题。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *
 * `platform === 'coze'` **且**共享凭据在手上 ⇒ 用它；否则用自带的 `apiKey`。
 *
 * ⚠️ **只有 `coze`（Coze 低代码）走共享那条路**：`coze-agent` / 文心 / 智谱的凭据
 * 是不是账号级的，我**没有证据**（spec §目标 写明了今天不接它们）。判据里带上 `platform`
 * 就是为了这一条 —— 少了它，将来给别的平台误挂一份凭据时，**那个智能体会静默地换钥匙**。
 *
 * ⚠️ **凭据读不到时回落，不抛**：外键在升级路径上是**列级**的（见 `platform-token-schema.ts`），
 * 而且任何一条手工改过的库都可能留下悬空的 `credentialId`。回落到自带 `apiKey`
 * 至少行为与改动前一致；抛出去则是**整个课堂的智能体都用不了**，而现场只会看到「提问失败」。
 *
 * ⚠️ 解密的容错照抄原来那 7 处的写法：**读不出来就把原串当钥匙**（老库里存过未加密的值）。
 */
export function toAgentConfig(
  agent: AgentConfigRow,
  credential: AgentCredentialRow | null | undefined,
  extra?: { conversationId?: string; sessionId?: string },
): AgentConfig {
  const shared = agent.platform === 'coze' && agent.credentialId && credential ? decryptOrNull(credential.token) : null;
  return {
    platform: agent.platform,
    apiUrl: agent.apiUrl || undefined,
    apiKey: shared ?? decryptOrRaw(agent.apiKey),
    botId: agent.botId || undefined,
    extra: agent.extra || undefined,
    ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra?.conversationId ? { conversationId: extra.conversationId } : {}),
  };
}

/** 读得出来就用读出来的；读不出来把原串当钥匙（老库存过未加密的值）。 */
function decryptOrRaw(value: string): string {
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch {
    return value;
  }
}

/**
 * 共享凭据那一格：**用不了就回 null**（调用方据此回落到自带 `apiKey`）。
 *
 * 🔴 与上面 `decryptOrRaw` **刻意不对称**，理由是两列的性质不同：
 *   · `Agent.apiKey` 里**真的存在过**未加密的值（老版本就是这么存的）⇒ 非密文要照用；
 *   · `PlatformToken.token` 这张表**只由 `encrypt` 写入**（2026-09-25 新建的表）
 *     ⇒ 非密文**不是我们的数据**（手改过的库 / 搬错列），当它是坏的更安全。
 *
 * ⚠️ 这条不对称如果哪个下午被「顺手统一」掉，表现是：一份坏掉的凭据会**静默地**
 * 拿一串明文去请求平台 —— 而它看起来「有值、也传出去了」，最难查的那一类。
 */
function decryptOrNull(value: string): string | null {
  if (!isEncrypted(value)) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}
