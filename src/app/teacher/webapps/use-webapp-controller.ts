import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTeacherConfirm } from '@/lib/components';
import type { WebappSummary, RelatedClassroom } from '@/lib/types';

type Notice = { message: string; type: 'success' | 'error' };

/** 卡片上「关联课堂」弹窗的状态。`classrooms` 为空数组时是「读到了、确实没有」。 */
export interface RelatedClassroomsState {
  webapp: WebappSummary;
  classrooms: RelatedClassroom[];
}

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
  onDeleteBlocked: (webapp: WebappSummary, classrooms: RelatedClassroom[]) => void;
}) {
  const { askConfirmation, confirmationDialog } = useTeacherConfirm();
  const [webapps, setWebapps] = useState<WebappSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const [relatedClassrooms, setRelatedClassrooms] = useState<RelatedClassroomsState | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
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
        // 清单已经在这个响应里了 —— 一并交给弹窗，不要为了展示再请求一次。
        if (mountedRef.current) callbacksRef.current.onDeleteBlocked(webapp, usage.classrooms);
        return;
      }
      if (!await askConfirmation({
        title: '删除这个探究网页？',
        message: `「${webapp.name}」及其网页文件会被一并删除，且无法恢复。`,
        confirmLabel: '删除网页',
        tone: 'danger',
      })) return;
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
  }, [askConfirmation, loadWebapps]);

  /**
   * 打开「关联课堂」弹窗。⚠️ **点击时才请求** —— 列表接口只给计数，清单在 `:id/usage` 里，
   * 让每张卡片挂载即取会变成一页 12 个请求（N+1）。
   *
   * 先开弹窗（空清单 + `relatedLoading`）再取数，让「正在读取」有明确的载体。
   */
  const openRelatedClassrooms = useCallback(async (webapp: WebappSummary) => {
    setRelatedClassrooms({ webapp, classrooms: [] });
    setRelatedLoading(true);
    try {
      const usage = await api.checkWebappUsage(webapp.id);
      if (mountedRef.current) setRelatedClassrooms({ webapp, classrooms: usage.classrooms });
    } catch (error) {
      // 读不到就关掉并明说 —— 留一个空清单会让教师以为「确实没有关联」。
      if (mountedRef.current) {
        setRelatedClassrooms(null);
        callbacksRef.current.onNotice({
          message: `无法读取“${webapp.name}”的关联课堂：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
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
    webapps, loading, busyOperation,
    relatedClassrooms, relatedLoading, openRelatedClassrooms, closeRelatedClassrooms,
    loadWebapps, deleteWebapp, confirmationDialog,
  };
}
