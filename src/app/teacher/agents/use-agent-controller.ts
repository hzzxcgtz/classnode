import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import type { AgentSummary } from '@/lib/types';

type Notice = { message: string; type: 'success' | 'error' };

export function useAgentController({ onNotice, onDeleteBlocked }: {
  onNotice: (notice: Notice) => void;
  onDeleteBlocked: (agent: AgentSummary) => void;
}) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const callbacksRef = useRef({ onNotice, onDeleteBlocked });

  useEffect(() => {
    callbacksRef.current = { onNotice, onDeleteBlocked };
  }, [onNotice, onDeleteBlocked]);

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.getAgents();
      if (mountedRef.current) setAgents(data);
    } catch (error) {
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `智能体列表加载失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(loadAgents);
    let socket: { disconnect: () => void; on: (event: string, listener: () => void) => void } | undefined;
    let cancelled = false;
    void import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], reconnection: true });
      socket.on('agents-checked', () => { if (!cancelled) void loadAgents(); });
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      socket?.disconnect();
    };
  }, [loadAgents]);

  const toggleAgent = useCallback(async (agent: AgentSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const enabled = agent.enabled !== false;
    setBusyOperation(`${agent.id}:toggle`);
    const form = new FormData();
    form.append('enabled', enabled ? 'false' : 'true');
    try {
      await api.updateAgent(agent.id, form);
      await loadAgents();
    } catch (error) {
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `无法${enabled ? '停用' : '启用'}“${agent.name}”：${error instanceof Error ? error.message : '请求失败'}`, type: 'error' });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [loadAgents]);

  const deleteAgent = useCallback(async (agent: AgentSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOperation(`${agent.id}:delete`);
    try {
      const usage = await api.checkAgentUsage(agent.id);
      if (usage.used) {
        if (mountedRef.current) callbacksRef.current.onDeleteBlocked(agent);
        return;
      }
      if (!window.confirm(`确定删除 "${agent.name}" 吗？`)) return;
      await api.deleteAgent(agent.id);
      await loadAgents();
    } catch (error) {
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `无法删除“${agent.name}”：${error instanceof Error ? error.message : '请求失败'}`, type: 'error' });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [loadAgents]);

  const testAgent = useCallback(async (agent: AgentSummary) => {
    if (testing === agent.id) return;
    setTesting(agent.id);
    try {
      const result = await api.testAgent(agent.id);
      if (!mountedRef.current) return;
      setAgents(current => current.map(item => item.id === agent.id ? { ...item, lastCheckAt: new Date().toISOString(), lastCheckOk: result.success, lastCheckError: result.success ? null : (result.error || '连接失败') } : item));
      callbacksRef.current.onNotice({ message: result.success ? '连接成功' : `连接失败：${result.error || '请检查配置'}`, type: result.success ? 'success' : 'error' });
    } catch (error) {
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `测试请求失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      if (mountedRef.current) setTesting(null);
    }
  }, [testing]);

  return { agents, loading, testing, busyOperation, loadAgents, toggleAgent, deleteAgent, testAgent };
}
