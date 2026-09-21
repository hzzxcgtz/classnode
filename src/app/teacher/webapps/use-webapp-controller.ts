import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { WebappSummary } from '@/lib/types';

type Notice = { message: string; type: 'success' | 'error' };

/**
 * 网页列表的数据层 + **删除前的使用量守卫**。
 *
 * 守卫的必要性（照 `use-agent-controller.ts:70-89` 的既有做法）：服务端 `DELETE /:id`
 * 在网页被课堂引用时会 400，但**只在按下删除之后**才知道。先查一次 usage，
 * 被引用就换成「无法删除」弹窗 —— 教师看到的是「为什么不能删、去哪儿解」，
 * 而不是一条 `HTTP 400`。
 *
 * ⚠️ 服务端那道判断**不能因此省掉**：这里查完到真正 DELETE 之间网页仍可能被某个
 * 正在创建的课堂引用。前端这道管的是文案，服务端那道管的是数据。
 */
export function useWebappController({ onNotice, onDeleteBlocked }: {
  onNotice: (notice: Notice) => void;
  onDeleteBlocked: (webapp: WebappSummary) => void;
}) {
  const [webapps, setWebapps] = useState<WebappSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const callbacksRef = useRef({ onNotice, onDeleteBlocked });

  useEffect(() => {
    callbacksRef.current = { onNotice, onDeleteBlocked };
  }, [onNotice, onDeleteBlocked]);

  const loadWebapps = useCallback(async () => {
    try {
      const data = await api.getWebapps();
      if (mountedRef.current) setWebapps(data);
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `网页列表加载失败：${error instanceof Error ? error.message : '请求异常'}`,
          type: 'error',
        });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(loadWebapps);
    return () => { mountedRef.current = false; };
  }, [loadWebapps]);

  const deleteWebapp = useCallback(async (webapp: WebappSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOperation(`${webapp.id}:delete`);
    try {
      const usage = await api.checkWebappUsage(webapp.id);
      if (usage.used) {
        if (mountedRef.current) callbacksRef.current.onDeleteBlocked(webapp);
        return;
      }
      if (!window.confirm(`确定删除 "${webapp.name}" 吗？网页文件会一并删除，且无法恢复。`)) return;
      await api.deleteWebapp(webapp.id);
      await loadWebapps();
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `已删除「${webapp.name}」`, type: 'success' });
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `无法删除“${webapp.name}”：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [loadWebapps]);

  return { webapps, loading, busyOperation, loadWebapps, deleteWebapp };
}
