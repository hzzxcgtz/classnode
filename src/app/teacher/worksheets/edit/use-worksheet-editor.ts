'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { WorksheetDetail, WorksheetSettings, WorksheetUsage } from '@/lib/types';
import {
  buildPayload,
  contentReducer,
  createEmptyContent,
  createHistory,
  DEFAULT_SETTINGS,
  DRAFT_INTERVAL_MS,
  draftKeyFor,
  type QuestionType,
  normalizeLoadedContent,
  normalizeLoadedSettings,
  parseDraft,
  type WorksheetDraft,
} from './worksheet-editor-core';

/**
 * ⚠️ 本文件**重新导出**纯函数内核（`worksheet-editor-core.ts`）的全部符号，
 * 所以页面侧既有的 import 路径不用改。纯函数的新家在那个文件里 ——
 * **它可以被 `node --test` 直接跑**（回归网 `worksheet-editor-core.test.ts` 就在它旁边），
 * 而本文件不行：这里有 React、路由与网络。
 */
export * from './worksheet-editor-core';

/** 编辑器地址。`id` 走查询参数（静态导出没有动态路由，规格 §3-X）—— 与 C1 的 `editorHref` 同形。 */
function editorHref(id: string): string {
  return `/teacher/worksheets/edit/?id=${encodeURIComponent(id)}`;
}

export interface EditorNotice {
  message: string;
  type: 'success' | 'error';
}

export interface SaveStatus {
  kind: 'idle' | 'saving' | 'saved' | 'error';
  /** `kind === 'saved'` 时刻，用于顶栏的「已保存 14:32」。 */
  at: number | null;
  /** `kind === 'error'` 时的原因（服务端原话，例如逐题的校验明细）。 */
  message: string | null;
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // 隐私模式 / 站点数据被禁：草稿是尽力而为，不能因此打断编辑。
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 同上 */
  }
}

function removeLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/**
 * 学习单编辑器的数据层。
 *
 * 分工：本文件管**内容状态、历史、草稿、网络**；`page.tsx` 管版式与确认弹窗；
 * `question-card.tsx` 管一道题的输入控件。这样 `window.confirm` 的文案与
 * 「删题要说清已收到多少份作答」这类**界面判断**都留在页面里，
 * 而不是埋在状态机里。
 *
 * `id` 为 `null` ⇒ 空白编辑器（「新建」与「编辑」是同一个页面）。
 */
export function useWorksheetEditor({ id, onNotice }: {
  id: string | null;
  onNotice: (notice: EditorNotice) => void;
}) {
  const router = useRouter();

  const [worksheetId, setWorksheetId] = useState<string | null>(id);
  const [history, dispatch] = useReducer(contentReducer, undefined, () => createHistory(createEmptyContent()));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [settings, setSettings] = useState<WorksheetSettings>(DEFAULT_SETTINGS);
  /**
   * 已保存状态的快照。`null` = **还没加载完**，此时 `dirty` 一律为假 ——
   * 加载中途不能报「有未保存改动」，也不能把一份空学习单写进草稿。
   */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle', at: null, message: null });
  const [usage, setUsage] = useState<WorksheetUsage | null>(null);
  const [draftFound, setDraftFound] = useState<{ key: string; draft: WorksheetDraft } | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const duplicatingRef = useRef(false);
  /**
   * 已经加载过的学习单 id。`undefined` 是「一次都没加载」的哨兵值 ——
   * 与 `null`（「加载空白编辑器」）必须分得开，否则首次进入 `?id=` 缺省的页面时
   * 加载会被自己那道防重入判据挡掉。
   */
  const loadedIdRef = useRef<string | null | undefined>(undefined);
  /** 最新的 `worksheetId`，给那些不该因 id 变化而重建的回调读。 */
  const worksheetIdRef = useRef<string | null>(id);
  const callbacksRef = useRef({ onNotice });

  useEffect(() => { callbacksRef.current = { onNotice }; }, [onNotice]);
  useEffect(() => { worksheetIdRef.current = worksheetId; }, [worksheetId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const payload = useMemo(
    () => buildPayload(title, description, settings, history.present),
    [title, description, settings, history.present],
  );
  const snapshot = useMemo(() => JSON.stringify(payload), [payload]);
  const dirty = baseline !== null && snapshot !== baseline;

  // —— 引用情况（规格 §6.4 的顶栏警告）────────────────────────────────

  const refreshUsage = useCallback(async (targetId: string): Promise<WorksheetUsage | null> => {
    try {
      const next = await api.getWorksheetUsage(targetId);
      if (mountedRef.current && loadedIdRef.current === targetId) setUsage(next);
      return next;
    } catch {
      // 读不到就保持原值（通常是 null）。**不要**清成「没人用」——
      // 那是把「没读到」说成「确实没有」，顶栏会安静地少掉那句该有的警告。
      return null;
    }
  }, []);

  const usageRef = useRef<WorksheetUsage | null>(null);
  useEffect(() => { usageRef.current = usage; }, [usage]);

  /** 删题确认要用「已收到多少份作答」。有缓存就用缓存，没有才补一次请求。 */
  const ensureUsage = useCallback(async (): Promise<WorksheetUsage | null> => {
    const targetId = worksheetIdRef.current;
    if (!targetId) return null;
    if (usageRef.current) return usageRef.current;
    return refreshUsage(targetId);
  }, [refreshUsage]);

  // —— 加载 ──────────────────────────────────────────────────────────

  const offerDraft = useCallback((key: string, serverUpdatedAt: string | null) => {
    const raw = readLocalStorage(key);
    const draft = parseDraft(raw);
    if (!draft) {
      // 形状不对的残留直接清掉，否则每次打开编辑页都要白解析一遍。
      if (raw !== null) removeLocalStorage(key);
      return;
    }
    if (serverUpdatedAt) {
      const serverAt = Date.parse(serverUpdatedAt);
      // 服务端上的版本不比草稿旧 ⇒ 草稿已经被覆盖进去了（例如上次保存成功但清理失败）。
      // ⚠️ 这条比较依赖「服务端与本机是同一台机器上的同一个时钟」—— 本应用是本地部署的
      // 桌面应用，成立；若将来服务端能跑在别处，这里要改成带偏移量的比较。
      if (Number.isFinite(serverAt) && draft.savedAt <= serverAt) {
        removeLocalStorage(key);
        return;
      }
    }
    setDraftFound({ key, draft });
  }, []);

  const load = useCallback(async (targetId: string | null) => {
    loadedIdRef.current = targetId;
    setLoading(true);
    setLoadError(null);
    setDraftFound(null);
    setUsage(null);

    if (!targetId) {
      const content = createEmptyContent();
      dispatch({ kind: 'reset', content });
      setTitle('');
      setDescription('');
      setSettings(DEFAULT_SETTINGS);
      setBaseline(JSON.stringify(buildPayload('', '', DEFAULT_SETTINGS, content)));
      setWorksheetId(null);
      setSaveStatus({ kind: 'idle', at: null, message: null });
      setLoading(false);
      offerDraft(draftKeyFor(null), null);
      return;
    }

    try {
      const detail = await api.getWorksheet(targetId);
      if (!mountedRef.current || loadedIdRef.current !== targetId) return;
      const content = normalizeLoadedContent(detail.content);
      const loadedTitle = typeof detail.title === 'string' ? detail.title : '';
      const loadedDescription = typeof detail.description === 'string' ? detail.description : '';
      const loadedSettings = normalizeLoadedSettings(detail.settings);
      dispatch({ kind: 'reset', content });
      setTitle(loadedTitle);
      setDescription(loadedDescription);
      setSettings(loadedSettings);
      setBaseline(JSON.stringify(buildPayload(loadedTitle, loadedDescription, loadedSettings, content)));
      setWorksheetId(targetId);
      setSaveStatus({ kind: 'idle', at: null, message: null });
      setLoading(false);
      void refreshUsage(targetId);
      offerDraft(draftKeyFor(targetId), typeof detail.updatedAt === 'string' ? detail.updatedAt : null);
    } catch (error) {
      if (!mountedRef.current || loadedIdRef.current !== targetId) return;
      setLoadError(error instanceof Error ? error.message : '请求异常');
      setLoading(false);
    }
  }, [offerDraft, refreshUsage]);

  useEffect(() => {
    // 防重入：新建 / 复制之后本页会自己把 URL 换掉，那次 prop 变化不该再拉一遍。
    if (loadedIdRef.current === id) return;
    void load(id);
  }, [id, load]);

  /** 新建 / 复制之后把地址换成真实 id —— 用 `replace`，这样「返回」仍然回到列表。 */
  useEffect(() => {
    if (worksheetId && worksheetId !== id) router.replace(editorHref(worksheetId));
  }, [worksheetId, id, router]);

  const retryLoad = useCallback(() => { void load(worksheetIdRef.current); }, [load]);

  // —— 保存 ──────────────────────────────────────────────────────────

  const payloadRef = useRef(payload);
  useEffect(() => { payloadRef.current = payload; }, [payload]);

  const save = useCallback(async (): Promise<WorksheetDetail | null> => {
    if (savingRef.current) return null;
    const next = payloadRef.current;
    if (!next.title) {
      setSaveStatus({ kind: 'error', at: null, message: '学习单标题不能为空' });
      return null;
    }
    savingRef.current = true;
    setSaveStatus({ kind: 'saving', at: null, message: null });
    const currentId = worksheetIdRef.current;
    // 保存成功后这份草稿就多余了。⚠️ 键要在 id 变化**之前**取，
    // 否则新建那一支会去删一个不存在的键，把 `new` 那份留在本机。
    const keyBefore = draftKeyFor(currentId);
    // 保存前再读一次 `/usage`（规格 §6.4）：顶栏那句警告说的是「保存会立刻传到学生端」，
    // 读到的是几秒前的数字就可能少报一间课堂。**不 await** —— 它是给横幅用的，
    // 不该挡在保存前面；失败也只是这句警告晚一步。
    if (currentId) void refreshUsage(currentId);
    try {
      const saved = currentId
        ? await api.updateWorksheet(currentId, next)
        : await api.createWorksheet(next);
      if (!mountedRef.current) return saved;
      removeLocalStorage(keyBefore);
      // ⚠️ 那份草稿已经过期了（保存的就是当前屏幕上的内容），横幅必须一起收掉：
      // 留着它，教师在保存之后再点一次「恢复」就会用旧草稿盖掉刚保存的东西。
      setDraftFound(null);
      // 基线取**刚发出去的那份载荷**，不是服务端的回包：回包会把
      // 「保存期间教师继续打的字」覆盖掉。载荷已经与本地状态同构
      // （见 `buildPayload` 的 trim），所以拿它当基线是准的。
      setBaseline(JSON.stringify(next));
      setSaveStatus({ kind: 'saved', at: Date.now(), message: null });
      if (!currentId) {
        worksheetIdRef.current = saved.id;
        loadedIdRef.current = saved.id;
        setWorksheetId(saved.id);
      }
      // 引用计数不阻塞保存 —— 它只影响顶栏那句警告的新鲜度。
      void refreshUsage(saved.id);
      callbacksRef.current.onNotice({ message: '已保存', type: 'success' });
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败';
      if (mountedRef.current) setSaveStatus({ kind: 'error', at: null, message });
      // ⚠️ 保存失败**不清草稿**：那份草稿现在是本机上唯一的一份，清掉就是丢数据。
      callbacksRef.current.onNotice({ message: `保存失败：${message}`, type: 'error' });
      return null;
    } finally {
      savingRef.current = false;
    }
  }, [refreshUsage]);

  // —— 草稿（只写 localStorage，规格 §3-Y）────────────────────────────

  const draftStateRef = useRef({ key: draftKeyFor(id), dirty: false, payload: { title: '', description: '', settings: DEFAULT_SETTINGS, content: createEmptyContent() } });
  const draftPayload = useMemo(
    () => ({ title, description, settings, content: history.present }),
    [title, description, settings, history.present],
  );
  useEffect(() => {
    draftStateRef.current = { key: draftKeyFor(worksheetId), dirty, payload: draftPayload };
  }, [worksheetId, dirty, draftPayload]);

  const writeDraft = useCallback(() => {
    const state = draftStateRef.current;
    if (!state.dirty) return;
    writeLocalStorage(state.key, JSON.stringify({ savedAt: Date.now(), ...state.payload }));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(writeDraft, DRAFT_INTERVAL_MS);
    const onBlur = () => writeDraft();
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') writeDraft(); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 卸载前再写一次（点「返回」、点卡片跳走都会走到这里）——
      // 不然最后 10 秒的改动会静悄悄地没了。
      writeDraft();
    };
  }, [writeDraft]);

  const acceptDraft = useCallback(() => {
    const found = draftFound;
    if (!found) return;
    setTitle(found.draft.title);
    setDescription(found.draft.description);
    setSettings(found.draft.settings);
    // `reset`：恢复草稿是**换一个基线**，不是可撤销的一步。
    // 恢复之后 `dirty` 自然为真（基线仍是服务端那份），所以保存按钮会亮起来。
    dispatch({ kind: 'reset', content: found.draft.content });
    setDraftFound(null);
  }, [draftFound]);

  const discardDraft = useCallback(() => {
    if (!draftFound) return;
    removeLocalStorage(draftFound.key);
    setDraftFound(null);
  }, [draftFound]);

  // —— 离开 / 复制 ───────────────────────────────────────────────────

  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const goBack = useCallback(() => {
    if (dirtyRef.current) {
      const confirmed = window.confirm(
        '这份学习单有未保存的改动。返回列表后它不会出现在学习单里，改动会留在本机草稿中，下次打开编辑页时会提示恢复。确定返回吗？',
      );
      if (!confirmed) return;
      // 先把当前状态落成草稿再说「改动会留在草稿里」—— 否则那句是假的（最多差 10 秒）。
      writeDraft();
    }
    router.push('/teacher/worksheets/');
  }, [router, writeDraft]);

  const duplicate = useCallback(async (): Promise<void> => {
    if (duplicatingRef.current) return;
    duplicatingRef.current = true;
    setDuplicating(true);
    try {
      let sourceId = worksheetIdRef.current;
      // 复制的是**服务端上的版本**。有未保存的改动就先存一次，
      // 否则教师会拿到一份缺了刚才那些改动的副本（而且他多半不会发现）。
      if (!sourceId || dirtyRef.current) {
        const saved = await save();
        if (!saved) return;
        sourceId = saved.id;
      }
      const copy = await api.duplicateWorksheet(sourceId);
      if (!mountedRef.current) return;
      // 显式加载副本，而不是等 URL 变化触发加载：路由软跳转是否重跑 effect
      // 不该成为「页面显示的是不是副本」的判据（显示旧内容而地址是新的，就是一种撒谎）。
      await load(copy.id);
      callbacksRef.current.onNotice({ message: `已复制为「${copy.title}」，已切到副本`, type: 'success' });
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `复制失败：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
      }
    } finally {
      duplicatingRef.current = false;
      if (mountedRef.current) setDuplicating(false);
    }
  }, [load, save]);

  // —— 快捷键 ────────────────────────────────────────────────────────

  /**
   * `Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z`（Windows 上还有 `Ctrl+Y`）重做、`Cmd/Ctrl+S` 保存。
   *
   * ⚠️ 焦点在题干 / 选项输入框里时**也拦**（不按 `event.target` 放行）。看起来像是
   * 抢了浏览器的文本框撤销，其实不是：历史栈是**每次改动一条**（见 `contentReducer`），
   * 所以在这里按 `Cmd+Z` 退掉的正是上一个字符，与原生文本撤销的行为一致 ——
   * 而放行的后果是两种撤销各退各的、数值与光标错位。顶栏那两个按钮是给
   * 不知道快捷键的教师的，与这里走同一个 reducer。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      // `Ctrl+Y` 是 Windows 的重做习惯；macOS 上的 `Cmd+Y` 不是，别抢。
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey);
      if (key === 'y' && !redo) return;
      event.preventDefault();
      dispatch({ kind: redo ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  /** 有未保存改动时拦一下关标签页 / 刷新。文案由浏览器给，这里只需要拦。 */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // —— 暴露给页面的动作 ───────────────────────────────────────────────

  const addQuestion = useCallback((questionType: QuestionType) => {
    dispatch({ kind: 'add', questionType });
  }, []);

  const updatePrompt = useCallback((questionId: string, prompt: string) => {
    dispatch({ kind: 'updatePrompt', id: questionId, prompt });
  }, []);

  const updateData = useCallback((questionId: string, patch: Record<string, unknown>) => {
    dispatch({ kind: 'updateData', id: questionId, patch });
  }, []);

  const moveQuestion = useCallback((questionId: string, delta: -1 | 1) => {
    dispatch({ kind: 'move', id: questionId, delta });
  }, []);

  const removeQuestion = useCallback((questionId: string) => {
    dispatch({ kind: 'remove', id: questionId });
  }, []);

  const undo = useCallback(() => dispatch({ kind: 'undo' }), []);
  const redo = useCallback(() => dispatch({ kind: 'redo' }), []);

  const updateSettings = useCallback((patch: Partial<WorksheetSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return {
    worksheetId,
    title, setTitle,
    description, setDescription,
    settings, updateSettings,
    content: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo, redo,
    loading, loadError, retryLoad,
    dirty,
    saveStatus,
    usage,
    draftFound, acceptDraft, discardDraft,
    duplicating,
    addQuestion, updatePrompt, updateData, moveQuestion, removeQuestion,
    save, duplicate, goBack, ensureUsage,
  };
}

