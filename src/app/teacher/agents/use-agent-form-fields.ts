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
  const [apiUrl, setApiUrl] = useState(agent?.apiUrl || '');
  const [botId, setBotId] = useState(agent?.botId || '');
  const [projectId, setProjectId] = useState(extra.projectId || '');
  const [apiSecret, setApiSecret] = useState('');
  const [greeting, setGreeting] = useState(agent?.greeting || '');
  const initialDrafts: Record<AgentPlatform, AgentCredentialValues & { name: string; greeting: string }> = {
    coze: { name: '', greeting: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    'coze-agent': { name: '', greeting: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    zhipuai: { name: '', greeting: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
    wenxin: { name: '', greeting: '', apiKey: '', apiUrl: '', botId: '', projectId: '', apiSecret: '' },
  };
  if (agent) {
    initialDrafts[initialPlatform] = {
      name: agent.name || '', greeting: agent.greeting || '', apiKey: '', apiUrl: agent.apiUrl || '',
      botId: agent.botId || '', projectId: extra.projectId || '', apiSecret: '',
    };
  }
  const draftsRef = useRef(initialDrafts);
  const samePlatformAsSaved = !!agent && platform === initialPlatform;

  const setPlatform = (next: AgentPlatform) => {
    if (next === platform) return;
    draftsRef.current[platform] = { name, greeting, apiKey, apiUrl, botId, projectId, apiSecret };
    const nextDraft = draftsRef.current[next];
    setPlatformState(next);
    setName(nextDraft.name);
    setGreeting(nextDraft.greeting);
    setApiKey(nextDraft.apiKey);
    setApiUrl(nextDraft.apiUrl);
    setBotId(nextDraft.botId);
    setProjectId(nextDraft.projectId);
    setApiSecret(nextDraft.apiSecret);
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
    savedApiSecretLabel: samePlatformAsSaved ? extra.apiSecretMask : undefined,
    editingSavedPlatform: samePlatformAsSaved,
  };
}
