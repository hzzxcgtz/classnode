import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AgentSummary } from '@/lib/types';
import { validateAgentCredentials } from './credentials-fields';
import type { AgentPlatform } from './agent-platforms';

interface FormActionOptions {
  agent: AgentSummary | null;
  values: { name: string; platform: AgentPlatform; apiKey: string; apiUrl: string; botId: string; projectId: string; apiSecret: string; greeting: string };
  hasSavedApiKey: boolean;
  hasSavedApiSecret: boolean;
  setName: (value: string) => void;
  setGreeting: (value: string) => void;
  applyRemoteLogo: (url: string) => void;
  appendLogoTo: (form: FormData) => void;
  onSaved: () => void;
}

export function useAgentFormActions(options: FormActionOptions) {
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  useEffect(() => {
    // React Strict Mode 会在开发环境执行一次 setup → cleanup → setup。
    // 每次 effect 生效时都恢复 mounted 状态，否则第一次模拟 cleanup 后，
    // 保存成功也不会关闭弹窗，finally 也无法解除“保存中”。
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const clearError = (field: string) => setFieldErrors(previous => { const next = { ...previous }; delete next[field]; return next; });
  const clearErrors = () => setFieldErrors({});

  const fetchInfo = async () => {
    const { agent, values, hasSavedApiKey, setName, setGreeting, applyRemoteLogo } = optionsRef.current;
    if (!values.botId.trim() || (!hasSavedApiKey && !values.apiKey.trim())) {
      setToast({ msg: '请先填写 Bot ID 和 API Token 后再获取信息', type: 'error' }); return;
    }
    setFetchingInfo(true);
    try {
      const stored = agent && !values.apiKey && !values.apiSecret;
      const response = stored ? await api.getAgentInfo(agent.id) : await api.getAgentInfoDirect({ platform: values.platform, botId: values.botId.trim(), apiKey: values.apiKey.trim(), apiUrl: values.apiUrl.trim() || undefined, projectId: values.projectId.trim(), apiSecret: values.apiSecret.trim() });
      if (!mountedRef.current) return;
      if (response.name) setName(response.name);
      if (response.iconUrl) applyRemoteLogo(response.iconUrl);
      if (response.greeting) setGreeting(response.greeting);
      if (!response.name && !response.iconUrl) setToast({ msg: '未能从 Coze 获取到智能体信息，请检查 Bot ID 和 API Token 是否正确', type: 'error' });
    } catch (error) {
      if (mountedRef.current) setToast({ msg: `获取信息失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally { if (mountedRef.current) setFetchingInfo(false); }
  };

  const submit = async () => {
    if (savingRef.current) return;
    const { agent, values, hasSavedApiKey, hasSavedApiSecret, appendLogoTo, onSaved } = optionsRef.current;
    const errors = validateAgentCredentials(values.platform, values, hasSavedApiKey, hasSavedApiSecret);
    if (!values.name.trim()) errors.name = '请填写智能体名称';
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }
    savingRef.current = true; setSaving(true);
    try {
      const form = new FormData();
      form.append('name', values.name.trim()); form.append('platform', values.platform);
      if (values.apiKey.trim()) form.append('apiKey', values.apiKey.trim());
      if (agent || values.apiUrl.trim()) form.append('apiUrl', values.apiUrl.trim());
      if (agent || values.botId.trim()) form.append('botId', values.botId.trim());
      if (values.platform === 'coze-agent') form.append('extra', JSON.stringify({ projectId: values.projectId.trim() }));
      else if (values.platform === 'zhipuai') form.append('extra', JSON.stringify({ apiSecret: values.apiSecret.trim() }));
      else if (agent) form.append('extra', '{}');
      appendLogoTo(form); form.append('greeting', values.greeting || '');
      if (agent) await api.updateAgent(agent.id, form); else await api.createAgent(form);
      if (mountedRef.current) onSaved();
    } catch (error) {
      if (mountedRef.current) setFieldErrors({ submit: error instanceof Error ? error.message : '保存失败' });
    } finally {
      savingRef.current = false; if (mountedRef.current) setSaving(false);
    }
  };

  return { fetchingInfo, saving, fieldErrors, toast, setToast, clearError, clearErrors, fetchInfo, submit };
}
