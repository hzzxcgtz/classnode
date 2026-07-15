import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base';
import type { AgentSummary } from '@/lib/types';

export function useAgentLogo(agent: AgentSummary | null) {
  const fileRef = useRef<HTMLInputElement>(null);
  const localUrlRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(() => agent?.logo ? (agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo) : null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const revokeLocal = () => { if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; } };
  useEffect(() => () => revokeLocal(), []);
  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    revokeLocal(); localUrlRef.current = URL.createObjectURL(file); setPreview(localUrlRef.current); setRemoteUrl(null); setRemoved(false);
  };
  const applyRemote = (url: string) => { revokeLocal(); if (fileRef.current) fileRef.current.value = ''; setPreview(url); setRemoteUrl(url); setRemoved(false); };
  const remove = () => { revokeLocal(); if (fileRef.current) fileRef.current.value = ''; setPreview(null); setRemoteUrl(null); setRemoved(true); };
  const resetForPlatform = (platform: string) => {
    revokeLocal();
    if (fileRef.current) fileRef.current.value = '';
    const savedLogo = agent && agent.platform === platform ? agent.logo : null;
    setPreview(savedLogo ? (savedLogo.startsWith('/') ? `${getApiBaseUrl()}${savedLogo}` : savedLogo) : null);
    setRemoteUrl(null);
    setRemoved(Boolean(agent && agent.platform !== platform));
  };
  const appendTo = (form: FormData) => {
    const file = fileRef.current?.files?.[0];
    if (file) form.append('logo', file); else if (remoteUrl && !removed) form.append('logo', remoteUrl); else if (agent && removed) form.append('removeLogo', 'true');
  };
  return { fileRef, preview, selectFile, applyRemote, remove, resetForPlatform, appendTo };
}
