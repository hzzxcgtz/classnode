import type { AgentPlatform } from './agent-platforms';

interface CozeInfoAvailability {
  platform: AgentPlatform;
  botId: string;
  credentialId: string;
  apiKey: string;
  hasSavedApiKey: boolean;
}

/** 自动获取 Coze 资料的入口条件；共享令牌与自定义令牌是两条等价的凭据路径。 */
export function canFetchCozeAgentInfo(values: CozeInfoAvailability): boolean {
  return values.platform === 'coze'
    && Boolean(values.botId.trim())
    && (Boolean(values.credentialId) || values.hasSavedApiKey || Boolean(values.apiKey.trim()));
}
