import { useRef, useState } from 'react';
import type { AgentSummary } from '@/lib/types';
import type { AgentPlatform } from './agent-platforms';
import type { AgentCredentialValues } from './credentials-fields';

function readExtra(agent: AgentSummary | null): { projectId?: string; hasApiSecret?: boolean; apiSecretMask?: string } {
  try { return agent?.extra ? JSON.parse(agent.extra) : {}; } catch { return {}; }
}

export function useAgentFormFields(agent: AgentSummary | null) {
  const initialPlatform = (agent?.platform as AgentPlatform) || 'coze';
  const extra = readExtra(agent);
  const [name, setName] = useState(agent?.name || '');
  const [platform, setPlatformState] = useState<AgentPlatform>(initialPlatform);
  const [apiKey, setApiKey] = useState('');
  // ★ 2026-09-25：选中的共享 Token（`''` = 自带）。
  const [credentialId, setCredentialId] = useState(agent?.credentialId || '');
  const [apiUrl, setApiUrl] = useState(agent?.apiUrl || '');
  const [botId, setBotId] = useState(agent?.botId || '');
  const [projectId, setProjectId] = useState(extra.projectId || '');
  // ★ M7b：用途。默认「学伴」—— 与库里的 `DEFAULT 'tutoring'` 同一条默认值。
  // ⚠️ 缺字段的旧行按「学伴」算（那时还没有分析型这个概念）。
  const [purpose, setPurpose] = useState<string>(agent?.purpose || 'tutoring');
  const [apiSecret, setApiSecret] = useState('');
  const [greeting, setGreeting] = useState(agent?.greeting || '');
  const initialDrafts: Record<AgentPlatform, AgentCredentialValues & { name: string; greeting: string }> = {
    coze: { name: '', greeting: '', credentialId: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    'coze-agent': { name: '', greeting: '', credentialId: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    zhipuai: { name: '', greeting: '', credentialId: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    wenxin: { name: '', greeting: '', credentialId: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
  };
  if (agent) {
    initialDrafts[initialPlatform] = {
      name: agent.name || '', greeting: agent.greeting || '', credentialId: agent.credentialId || '',
      apiKey: '', apiUrl: agent.apiUrl || '',
      botId: agent.botId || '', projectId: extra.projectId || '', apiSecret: '',
    };
  }
  const draftsRef = useRef(initialDrafts);
  const samePlatformAsSaved = !!agent && platform === initialPlatform;

  const setPlatform = (next: AgentPlatform) => {
    if (next === platform) return;
    draftsRef.current[platform] = { name, greeting, credentialId, apiKey, apiUrl, botId, projectId, apiSecret };
    const nextDraft = draftsRef.current[next];
    setPlatformState(next);
    setName(nextDraft.name);
    setGreeting(nextDraft.greeting);
    setCredentialId(nextDraft.credentialId);
    setApiKey(nextDraft.apiKey);
    setApiUrl(nextDraft.apiUrl);
    setBotId(nextDraft.botId);
    setProjectId(nextDraft.projectId);
    setApiSecret(nextDraft.apiSecret);
  };

  const updateCredential = (field: keyof AgentCredentialValues, value: string) => {
    const setters: Record<keyof AgentCredentialValues, (next: string) => void> = {
      credentialId: setCredentialId,
      apiKey: setApiKey, apiUrl: setApiUrl, botId: setBotId, projectId: setProjectId, apiSecret: setApiSecret,
    };
    setters[field](value);
  };

  return {
    name, setName, platform, setPlatform, credentialId, apiKey, apiUrl, botId, projectId, apiSecret, greeting, setGreeting,
    purpose, setPurpose,
    setCredentialId, setApiKey, setApiUrl, setBotId, setProjectId, setApiSecret, updateCredential,
    hasSavedApiKey: samePlatformAsSaved && !!agent?.hasApiKey,
    hasSavedApiSecret: samePlatformAsSaved && !!extra.hasApiSecret,
    savedApiKeyLabel: samePlatformAsSaved ? agent?.apiKey : undefined,
    savedApiSecretLabel: samePlatformAsSaved ? extra.apiSecretMask : undefined,
    editingSavedPlatform: samePlatformAsSaved,
  };
}
