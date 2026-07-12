import { useState } from 'react';
import type { AgentSummary } from '@/lib/types';
import type { AgentPlatform } from './agent-platforms';
import type { AgentCredentialValues } from './credentials-fields';

function readExtra(agent: AgentSummary | null): { projectId?: string; hasApiSecret?: boolean } {
  try { return agent?.extra ? JSON.parse(agent.extra) : {}; } catch { return {}; }
}

export function useAgentFormFields(agent: AgentSummary | null) {
  const initialPlatform = (agent?.platform as AgentPlatform) || 'coze';
  const extra = readExtra(agent);
  const [name, setName] = useState(agent?.name || '');
  const [platform, setPlatformState] = useState<AgentPlatform>(initialPlatform);
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState(agent?.apiUrl || '');
  const [botId, setBotId] = useState(agent?.botId || '');
  const [projectId, setProjectId] = useState(extra.projectId || '');
  const [apiSecret, setApiSecret] = useState('');
  const [greeting, setGreeting] = useState(agent?.greeting || '');
  const samePlatformAsSaved = !!agent && platform === initialPlatform;

  const setPlatform = (next: AgentPlatform) => {
    if (next === platform) return;
    setPlatformState(next);
    // 平台凭据不可复用；切换时清除旧平台字段，防止误提交。
    setApiKey('');
    setApiUrl('');
    setBotId('');
    setProjectId('');
    setApiSecret('');
  };

  const updateCredential = (field: keyof AgentCredentialValues, value: string) => {
    const setters: Record<keyof AgentCredentialValues, (next: string) => void> = {
      apiKey: setApiKey, apiUrl: setApiUrl, botId: setBotId, projectId: setProjectId, apiSecret: setApiSecret,
    };
    setters[field](value);
  };

  return {
    name, setName, platform, setPlatform, apiKey, apiUrl, botId, projectId, apiSecret, greeting, setGreeting,
    setApiKey, setApiUrl, setBotId, setProjectId, setApiSecret, updateCredential,
    hasSavedApiKey: samePlatformAsSaved && !!agent?.hasApiKey,
    hasSavedApiSecret: samePlatformAsSaved && !!extra.hasApiSecret,
    savedApiKeyLabel: samePlatformAsSaved ? agent?.apiKey : undefined,
    editingSavedPlatform: samePlatformAsSaved,
  };
}
