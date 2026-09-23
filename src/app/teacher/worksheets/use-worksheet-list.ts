import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { WorksheetSummary, WorksheetUsage } from '@/lib/types';

type Notice = { message: string; type: 'success' | 'error' };

/** 卡片上「引用情况」弹窗的状态。`usage` 为 `null` 时是「弹窗开着、还在读」。 */
export interface WorksheetUsageDialogState {
  worksheet: WorksheetSummary;
  usage: WorksheetUsage | null;
}

/** 搜索去抖：服务端搜索是每个按键一次请求，300ms 是「打字停顿」与「响应感」的折中。 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 学习单列表的数据层 + **删除前的使用量守卫**。
 *
 * 守卫的必要性（照 `use-webapp-controller.ts:63` 的既有做法）：`DELETE /api/worksheets/:id`
 * 在三样引用任一样非零时回 400，但**只在按下删除之后**才知道。先查一次 usage，
 * 被引用就换成「无法删除」弹窗 —— 教师看到的是「为什么不能删、接下来能做什么」，
 * 而不是一个 `HTTP 400`。
 *
 * ⚠️ 服务端那道判断**不能因此省掉**：这里查完到真正 DELETE 之间，学习单仍可能被某个
 * 正在创建的课堂引用。前端这道管的是文案，服务端那道管的是数据。
 *
 * 🔴 **分页与搜索是服务端的**（`GET /api/worksheets` 是本仓唯一一个服务端分页的端点），
 * 所以 `page` / `pageSize` / `search` 的状态由本 hook 持有 —— 它要在删除之后把
 * 越界的页码收回来，而那是「知道 `total` 的人」才能做的事。页面只管把 `Pagination`
 * 接上去。
 */
export function useWorksheetList({ onNotice, onDeleteBlocked }: {
  onNotice: (notice: Notice) => void;
  /** 三样引用里至少一样非零 ⇒ 交给页面开「无法删除」弹窗（连同这次已经取到的 usage）。 */
  onDeleteBlocked: (worksheet: WorksheetSummary, usage: WorksheetUsage) => void;
}) {
  const [worksheets, setWorksheets] = useState<WorksheetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败时**不能退化成空态**：`worksheets` 为空 + `loading` 为假会被渲染成
   * 「还没有学习单，去建一个吧」—— 而真相是「没读到」。一句 3 秒就消失的 toast
   * 挡不住这个误判（教师可能真去建一份重复的）。所以失败单独留一个状态。
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [search, setSearchState] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  /**
   * 「引用情况」弹窗。`usage` 为 `null` ⟺ **弹窗开着、还在读** —— 这就是「加载中」的
   * 全部状态，不再单开一个 `usageLoading` 布尔：两个状态说同一件事，迟早会说岔。
   * 「读到了、结果是空」是 `usage` 非 `null` 且三个计数都是 0，两者在类型上就分得开。
   */
  const [usageDialog, setUsageDialog] = useState<WorksheetUsageDialogState | null>(null);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  /**
   * 只认**最后一次**发出的请求。这不是洁癖：删除最后一页的最后一条时，hook 会先纠正页码
   * 再重拉，两个请求同时在飞 —— 没有这个序号，先发的那个后到就会把教师按回一个空页。
   * 搜索去抖也会连发（打字停顿一次就一次），同一道理。
   */
  const requestIdRef = useRef(0);
  const callbacksRef = useRef({ onNotice, onDeleteBlocked });

  useEffect(() => {
    callbacksRef.current = { onNotice, onDeleteBlocked };
  }, [onNotice, onDeleteBlocked]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await api.getWorksheets({ page, pageSize, search: appliedSearch });
      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      // 删掉最后一页的最后一条之后，`page` 会指到一个不存在的页。服务端这时老实回
      // `items: []` + 真实的 `total`（**这不是错误**）。直接纠正到最后一页，
      // 而不是渲染一次「没有符合条件的学习单」再让教师自己点回去 ——
      // 那句话会把「页码越界」说成「你筛没了」。
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (data.items.length === 0 && data.total > 0 && page > lastPage) {
        setPage(lastPage);
        return; // 保持 loading：下一次请求马上就到，中间不闪一个空态
      }

      setWorksheets(data.items);
      setTotal(data.total);
      setLoadError(null);
      setLoading(false);
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : '请求异常');
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(load);
    return () => { mountedRef.current = false; };
  }, [load]);

  /** 搜索词变化时**回到第 1 页**：留在第 5 页上看一份只剩 2 条的结果是没有意义的。 */
  const updateSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const retry = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    void load();
  }, [load]);

  const deleteWorksheet = useCallback(async (worksheet: WorksheetSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOperation(`${worksheet.id}:delete`);
    try {
      const usage = await api.getWorksheetUsage(worksheet.id);
      if (usage.used) {
        // 清单已经在这个响应里了 —— 一并交给弹窗，不要为了展示再请求一次。
        if (mountedRef.current) callbacksRef.current.onDeleteBlocked(worksheet, usage);
        return;
      }
      // 这里 `used` 为假 ⇒ 三样都为 0。确认文案据此把「删了什么」说死，
      // 不用「可能会影响」这种含糊话。
      if (!window.confirm(`确定删除「${worksheet.title}」吗？它没有被课堂或小组使用，也没有收到过作答。删除后无法恢复。`)) return;
      try {
        await api.deleteWorksheet(worksheet.id);
      } catch (deleteError) {
        // 竞态：查完 usage 到真正 DELETE 之间它被引用了。服务端这时回 400 + 一段描述，
        // 但这里**不用那段描述**：它的措辞是为「一行字」写的，而这里要弹出完整弹窗
        // （清单 + 每一样各是什么 + 哪几间课堂）。所以重查一次 usage，走同一个
        // 「无法删除」弹窗 —— 那里的措辞与服务端共用同一批发给前端的数字。
        // （历史：那段描述里曾经有「请先从这些课堂或小组中移除后再试」这句指向不存在
        // 操作的误导，服务端已在 `routes/worksheets.ts` 的 `describeUsage` 里改掉。）
        const retried = await api.getWorksheetUsage(worksheet.id).catch(() => null);
        if (retried?.used) {
          if (mountedRef.current) callbacksRef.current.onDeleteBlocked(worksheet, retried);
          return;
        }
        throw deleteError;
      }
      await load();
      if (mountedRef.current) callbacksRef.current.onNotice({ message: `已删除「${worksheet.title}」`, type: 'success' });
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `无法删除「${worksheet.title}」：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [load]);

  /**
   * 复制一份 —— 也是删除守卫给出的两条出路之一（另一条是编辑）。
   *
   * 复制之后**跳到第 1 页**：列表按 `updatedAt` 倒序，副本一定是最新的那一条，
   * 所以它一定在第 1 页的第一张。停在第 3 页上让教师自己去翻，等于把刚做的事藏起来。
   * （`page === 1` 时参数没变、effect 不会重跑，所以那一支要显式 `load()`。）
   */
  const duplicateWorksheet = useCallback(async (worksheet: WorksheetSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOperation(`${worksheet.id}:duplicate`);
    try {
      const copy = await api.duplicateWorksheet(worksheet.id);
      if (!mountedRef.current) return;
      if (page === 1) await load();
      else setPage(1);
      if (mountedRef.current) {
        callbacksRef.current.onNotice({ message: `已复制为「${copy.title}」`, type: 'success' });
      }
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `复制「${worksheet.title}」失败：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }, [load, page]);

  /**
   * 打开「引用情况」弹窗。⚠️ **点击时才请求** —— 列表接口只给计数，明细在 `:id/usage` 里，
   * 让每张卡片挂载即取会变成一页 12 个请求（N+1）。
   *
   * 先开弹窗（`usage: null`）再取数：「正在读取」因此有一个明确的载体，
   * 而不是点击之后到响应之前毫无反馈的一片空白。
   */
  const openUsageDialog = useCallback(async (worksheet: WorksheetSummary) => {
    setUsageDialog({ worksheet, usage: null });
    try {
      const usage = await api.getWorksheetUsage(worksheet.id);
      if (mountedRef.current) setUsageDialog({ worksheet, usage });
    } catch (error) {
      // 读不到就关掉并明说 —— 留一个空清单会让教师以为「确实没有关联」。
      if (!mountedRef.current) return;
      setUsageDialog(null);
      callbacksRef.current.onNotice({
        message: `无法读取「${worksheet.title}」的引用情况：${error instanceof Error ? error.message : '请求失败'}`,
        type: 'error',
      });
    }
  }, []);

  const closeUsageDialog = useCallback(() => setUsageDialog(null), []);

  return {
    worksheets, total, loading, loadError,
    page, pageSize, search, setSearch: updateSearch, setPage, setPageSize: changePageSize,
    busyOperation, retry,
    deleteWorksheet, duplicateWorksheet,
    usageDialog, openUsageDialog, closeUsageDialog,
  };
}
