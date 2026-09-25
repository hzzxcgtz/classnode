'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
// ★ 2026-09-26：新题的**默认分值**（1 / 0）—— 学习单级那两档不再参与判分之后，
// 逐题的值就是最终的值，种子取默认档。
import { DEFAULT_HALF_STEP, DEFAULT_REWARD_STEP } from '@/lib/worksheet-reward';
import type { QuestionPointsDraft, WorksheetDetail, WorksheetSettings, WorksheetUsage } from '@/lib/types';
import {
  buildPayload,
  contentReducer,
  createEmptyContent,
  createHistory,
  DEFAULT_SETTINGS,
  describePoints,
  DRAFT_INTERVAL_MS,
  draftKeyFor,
  findInvalidPoints,
  findPartialPoints,
  findUncommittedPointInput,
  POINTS_FULL_MIN,
  POINTS_MAX,
  type QuestionType,
  type RejectedPointInput,
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
  /**
   * 逐题分值那两格里**还没进 reducer** 的文本（按题 id），由 `PointsRow` 写、由 `save()` 读。
   *
   * 🔴 **它必须住在这一层，不能住在 `PointsRow` 里**（2026-09-24 审查实机复现的那个 bug）：
   * 教师把全对填成 `7.5`，那串字因为非法而进不了 `points`（只装整数），于是点保存发出去的是
   * **上一次的合法值** `4`，顶栏显示「已保存」，而框里还写着 `7.5` —— **界面在说假话**。
   * 组件本地的 `useState` 是 `save()` 看不见的；放在这一层，`save()` 才能拦下它。
   *
   * 它是**输入态**不是内容：不进撤销栈、不进载荷、不进 `dirty` 快照
   * （`content` 才决定这三件事）。
   */
  const [rejectedPoints, setRejectedPoints] = useState<Record<string, RejectedPointInput>>({});

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
    // 换了一份内容 ⇒ 所有签名都失效了。不清也只是留下一批永远不匹配的死条目，
    // 但清掉之后「屏幕上这两格是什么」这件事从头就是干净的。
    setRejectedPoints({});

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

  /**
   * 给 `save()` 读的 `rejectedPoints`。走 ref 而不是把它加进 `save` 的依赖 ——
   * 与上面的 `payloadRef` 同一个手法（`save` 是 `useCallback`，它不需要因为每一次击键重建）。
   */
  const rejectedPointsRef = useRef(rejectedPoints);
  useEffect(() => { rejectedPointsRef.current = rejectedPoints; }, [rejectedPoints]);

  /** `PointsRow` 写它：`null` = 那一题的两格现在都是合法的（或者已被清空）。 */
  const setPointsInput = useCallback((questionId: string, input: RejectedPointInput | null) => {
    setRejectedPoints((previous) => {
      if (input === null) {
        if (previous[questionId] === undefined) return previous;
        const next = { ...previous };
        delete next[questionId];
        return next;
      }
      return { ...previous, [questionId]: input };
    });
  }, []);

  const save = useCallback(async (): Promise<WorksheetDetail | null> => {
    if (savingRef.current) return null;
    const next = payloadRef.current;
    if (!next.title) {
      setSaveStatus({ kind: 'error', at: null, message: '学习单标题不能为空' });
      return null;
    }
    /**
     * 🔴 **三条拦阻，顺序有讲究。** 三条拦的都是「发出去的结果与教师屏幕上看到的不一样」，
     * 所以它们都必须在 `savingRef.current = true` **之前**返回 —— 那之后 return 会让防重入的
     * 旗子永远立着（`finally` 不跑），这个页面从此再也保存不了任何东西。
     *
     * 顺序：教师**刚打的字** → **库里那一份** → **只有一端**。
     * 一条题可能同时命中多条（`{full: 200}` 既越界又只填了一个），只报最先命中的那条 ——
     * 三条的出路都是同一个（把那两格改成合法且齐全的值）。
     */
    const uncommitted = findUncommittedPointInput(next.content, rejectedPointsRef.current);
    if (uncommitted.length > 0) {
      // 🔴 这条是 2026-09-24 审查实机复现出来的：教师看到框里写着 `7.5`、顶栏写着「已保存」，
      // 而真正发出去的是上一次的合法值 —— **界面在说假话，且没有任何报错**。
      // （brief Step 1 的「非整数即时提示」讲的是**不要拖到保存才报**，不是「不许拦」。）
      const message = `${describePoints(uncommitted)}填的不是合法分值（全对 ${POINTS_FULL_MIN}–${POINTS_MAX}、部分给分 0–${POINTS_MAX} 的整数）。请改成一个整数，或把那一格清空（清空 = 跟随学习单的两档）。`;
      setSaveStatus({ kind: 'error', at: null, message });
      callbacksRef.current.onNotice({ message: '保存失败：有分值填的不是合法整数', type: 'error' });
      return null;
    }
    const invalid = findInvalidPoints(next.content);
    if (invalid.length > 0) {
      // 这一条拦的是**库里那一份**：编辑器的输入路径产生不了越界值，所以命中的只可能是
      // 手工改过的行。不拦的后果是**静默改写** —— 服务端的 `normalizePointValue` 对越界值
      // 回落 `DEFAULT_POINTS`（200 变成 1），保存照常 200，而卡片上还写着 200。
      // ⚠️ ★ M4a/I1 之后，「全对填 0」也走这一条，而它的后果**不是静默改写**：
      // 服务端那一侧同样拒收（400，见 `isRejectedFullPointValue`）。所以这句话把两种
      // 后果分开写 —— 一句「服务端会把它换成 1」对着 0 就是假话（0 会让服务端直接拒绝）。
      const message = `${describePoints(invalid)}不是一个合法分值（全对 ${POINTS_FULL_MIN}–${POINTS_MAX}、部分给分 0–${POINTS_MAX} 的整数）。照这样保存，服务端会把你填的数换掉：越界的那一端回落默认档（全对 1 / 部分给分 0），两端都无效时整题改成「跟随学习单」；全对填 0 则会被直接拒绝（400）。所以先拦下。`;
      setSaveStatus({ kind: 'error', at: null, message });
      callbacksRef.current.onNotice({ message: '保存失败：有分值的取值不合法', type: 'error' });
      return null;
    }
    const partial = findPartialPoints(next.content);
    if (partial.length > 0) {
      // 🔴 半填的后果**不可见**：服务端的 `normalizePoints` 会把缺的那一端补成
      // `DEFAULT_POINTS`（全对 1 / 部分给分 0），**不是**补成学习单级的档 —— 于是
      // 「学习单级 `{full:3, half:2}` + 这题 `points:{full:7}`」判分时部分给分得 **0 分**，
      // 而教师以为自己只是把全对调成了 7。完整实测与推理见 `findPartialPoints`。
      // ★ 2026-09-25：指代改用**两级题号**（`任务一 · 2`）—— 与看板 / 抽屉 / 导出同一份。
      // 原来拼的是「第 N 题」（数组下标 +1），有任务之后那个号会**指错题**。
      const numbers = partial.map((item) => item.heading).join('、');
      const message = `${numbers} 的「全对 / 部分给分」只填了一个。两个框要么都填（全对 ${POINTS_FULL_MIN}–${POINTS_MAX}、部分给分 0–${POINTS_MAX} 的整数），要么都留空 = 跟随学习单的两档 —— 只填一个的话，另一个会按 0 分算，而界面上看不出来。`;
      setSaveStatus({ kind: 'error', at: null, message });
      callbacksRef.current.onNotice({ message: `保存失败：${numbers} 的分值只填了一个框`, type: 'error' });
      return null;
    }
    savingRef.current = true;
    setSaveStatus({ kind: 'saving', at: null, message: null });
    const currentId = worksheetIdRef.current;
    // 保存成功后这份草稿就多余了。⚠️ 键要在 id 变化**之前**取，
    // 否则新建那一支会去删一个不存在的键，把 `new` 那份留在本机。
    const keyBefore = draftKeyFor(currentId);
    // 保存前再读一次 `/usage`（规格 §6.4）：顶栏那句警告说的是「本单正在被 N 堂课使用」，
    // 读到的是几秒前的数字就可能少报一间课堂。**不 await** —— 它是给横幅用的，
    // 不该挡在保存前面；失败也只是这句警告晚一步。
    //
    // ⚠️ 那句警告的**后半句**（原先写「保存后学生端会**立即**看到变化」）是假的、已改：
    // 服务端对学习单**内容**变更**没有任何广播**（`PUT /api/worksheets/:id` 一个 socket 事件
    // 都不发；`routes/worksheets.ts` 里唯一的 `emit` 是作答变化，发给 `teacher:<id>`），
    // 学生端面板也只在**挂载时**拉一次 `student-view` ⇒ 学生要**刷新或重新进入**才看得到。
    // 所以 `refreshUsage` 的新鲜度只关系「几堂课在用」这一半，与「学生什么时候看到」无关 ——
    // 别因为后半句改了就顺手把这次刷新删掉。理由与待定项见规格 §3-J / §6.4 / §13-7。
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
      // 保存成功 ⇒ 屏幕上那两格与库里一致，输入态没有再留的意义。
      setRejectedPoints({});
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
    setRejectedPoints({});
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
        if (!saved) {
          // 🔴 `save()` 有三种 `null`，只有第一种是**静默**的：它自己那道防重入
          // （`savingRef.current`）直接 return，既不动 `saveStatus` 也不弹提示。
          // 不在这里说话，教师点「复制一份」就什么也看不到 —— 按钮只闪了一瞬
          // （`duplicating` 被置真又立刻置假），看起来像按钮坏了。
          // 另外两种（标题为空 / 请求失败）`save()` 自己会写 `saveStatus` 与提示，不重复。
          if (savingRef.current) {
            callbacksRef.current.onNotice({ message: '正在保存中，等这次保存完再点「复制一份」', type: 'error' });
          }
          return;
        }
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

  /**
   * ★ 2026-09-25：**加到哪儿**是参数。`parentId: null` = 顶层（散题），
   * 否则进指定的任务 —— 迁移之后顶层的题都在任务里，只看顶层的旧写法会让
   * 教师新加的题永远落在任务外面。
   */
  const addQuestion = useCallback((questionType: QuestionType, parentId: string | null = null) => {
    // ★ 2026-09-26（教师裁定）：新题的分值**落成真实数字**，于是框里显示的是数字而不是灰提示。
    // ⚠️ 它取的是**默认档**（1 / 0）：学习单级的那两档已经不再参与判分
    //（教师当天裁定「默认给分不要了，已经在每小题中设置了」），逐题的值就是最终的值。
    dispatch({
      kind: 'addQuestion', questionType, parentId,
      points: { full: DEFAULT_REWARD_STEP, half: DEFAULT_HALF_STEP },
    });
  }, []);

  /** ★ 2026-09-26：逐题的「允许自动评分」开关。 */
  const updateAutoGrade = useCallback((questionId: string, autoGrade: boolean) => {
    dispatch({ kind: 'updateAutoGrade', id: questionId, autoGrade });
  }, []);

  /** ★ 2026-09-26：部分给分的容错档（`null` = 缺省 = 旧规则）。 */
  const updateTolerance = useCallback((questionId: string, tolerance: number | null) => {
    dispatch({ kind: 'updateTolerance', id: questionId, tolerance });
  }, []);

  /** 新建一个任务容器（标题按序号预填，教师可改）。 */
  const addTask = useCallback(() => {
    dispatch({ kind: 'addTask' });
  }, []);

  const updatePrompt = useCallback((questionId: string, prompt: string) => {
    dispatch({ kind: 'updatePrompt', id: questionId, prompt });
  }, []);

  const updateData = useCallback((questionId: string, patch: Record<string, unknown>) => {
    dispatch({ kind: 'updateData', id: questionId, patch });
  }, []);

  /**
   * 逐题分值的写入口（规格 §12 裁定 4 / 5）。
   *
   * ⚠️ 与 `updatePrompt` / `updateData` **走同一个 reducer**（所以撤销栈、同值去重、
   * `dirty` 快照全都自动成立）—— 这里散一个 `setState` 就是 undo 开始漏的第一处，
   * 而它唯一的表现是「撤销时这个框不跟着回退」，没有任何报错。
   *
   * `points === undefined` = 教师把两个框都清空了 = **跟随学习单级**（不是「没填」）。
   */
  const updatePoints = useCallback((questionId: string, points: QuestionPointsDraft | undefined) => {
    dispatch({ kind: 'updatePoints', id: questionId, points });
  }, []);

  /**
   * 逐题作答方式（键盘 / 手写，★ M4b/D1）。
   *
   * ⚠️ 与上面三个写入口**逐字同一条规矩**：走同一个 reducer（撤销栈、同值去重、
   * `dirty` 快照都自动成立）。这里散一个 `setState` 就是 undo 开始漏的**第一处**，
   * 而它唯一的表现是「撤销时那一档不跟着回退」，没有任何报错。
   */
  const updateInputMode = useCallback((questionId: string, inputMode: 'keyboard' | 'handwriting') => {
    dispatch({ kind: 'updateInputMode', id: questionId, inputMode });
  }, []);

  const moveQuestion = useCallback((questionId: string, delta: -1 | 1) => {
    dispatch({ kind: 'move', id: questionId, delta });
  }, []);

  /** ★ 2026-09-26（spec 第 5 步）：拖拽落点 —— **一次到位、只占一格撤销**（不是连按 move）。 */
  const reorderQuestion = useCallback((questionId: string, toIndex: number) => {
    dispatch({ kind: 'reorder', id: questionId, toIndex });
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
    addQuestion, addTask, updateAutoGrade, updateTolerance, reorderQuestion, updatePrompt, updateData, updatePoints, updateInputMode, setPointsInput, moveQuestion, removeQuestion,
    rejectedPoints,
    save, duplicate, goBack, ensureUsage,
  };
}

