import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTeacherConfirm } from '@/lib/components';
import { getApiBaseUrl } from '@/lib/api-base';
import type { AgentSummary, RelatedClassroom } from '@/lib/types';

type Notice = { message: string; type: 'success' | 'error' };

/** 卡片上「关联课堂」弹窗的状态。`classrooms` 为空数组时是「读到了、确实没有」。 */
export interface RelatedClassroomsState {
  agent: AgentSummary;
  classrooms: RelatedClassroom[];
}

export function useAgentController({ onNotice, onDeleteBlocked }: {
  onNotice: (notice: Notice) => void;
  onDeleteBlocked: (agent: AgentSummary, classrooms: RelatedClassroom[]) => void;
}) {
  const { askConfirmation, confirmationDialog } = useTeacherConfirm();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const [relatedClassrooms, setRelatedClassrooms] = useState<RelatedClassroomsState | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
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
        // 把清单一起交给弹窗 —— 它已经在这个响应里了，不要再发一次请求。
        if (mountedRef.current) callbacksRef.current.onDeleteBlocked(agent, usage.classrooms);
        return;
      }
      if (!await askConfirmation({
        title: '删除这个 AI 智能体？',
        message: `「${agent.name}」的接入配置会被删除，且无法恢复。`,
        confirmLabel: '删除智能体',
        tone: 'danger',
      })) return;
      await api.deleteAgent(agent.id);
      await loadAgents();
    } catch (error) {
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `无法删除“${agent.name}”：${error instanceof Error ? error.message : '请求失败'}`, type: 'error' });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [askConfirmation, loadAgents]);

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

  /**
   * 打开「关联课堂」弹窗。
   *
   * ⚠️ **点击时才请求**，不在卡片挂载时取：列表接口只给计数，清单要靠 `:id/usage`，
   * 若每张卡片自己挂载即取，一页 12 张卡就是 12 个请求（N+1）。
   *
   * ⚠️ 先开弹窗（清单为空、`relatedLoading` 为真）再取数：让「正在读取」有一个
   * 明确的载体，而不是点下去什么都不发生。
   */
  const openRelatedClassrooms = useCallback(async (agent: AgentSummary) => {
    setRelatedClassrooms({ agent, classrooms: [] });
    setRelatedLoading(true);
    try {
      const usage = await api.checkAgentUsage(agent.id);
      if (mountedRef.current) setRelatedClassrooms({ agent, classrooms: usage.classrooms });
    } catch (error) {
      // 读不到就关掉弹窗并明说 —— 留一个空清单会让教师以为「确实没有关联」，
      // 而那是与「没读到」完全不同的结论。
      if (mountedRef.current) {
        setRelatedClassrooms(null);
        callbacksRef.current.onNotice({ message: `无法读取“${agent.name}”的关联课堂：${error instanceof Error ? error.message : '请求失败'}`, type: 'error' });
      }
    } finally {
      if (mountedRef.current) setRelatedLoading(false);
    }
  }, []);

  const closeRelatedClassrooms = useCallback(() => {
    setRelatedClassrooms(null);
    setRelatedLoading(false);
  }, []);

  return {
    agents, loading, testing, busyOperation,
    relatedClassrooms, relatedLoading, openRelatedClassrooms, closeRelatedClassrooms,
    loadAgents, toggleAgent, deleteAgent, testAgent, confirmationDialog,
  };
}
