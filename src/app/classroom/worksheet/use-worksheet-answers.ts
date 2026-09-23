'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getApiBaseUrl } from '@/lib/api-base';
import { getStudentSessionAuthorization } from '@/lib/api';
import type { WorksheetQuestionNode } from '@/lib/types';
import {
  buildAnswerValue,
  draftFromValue,
  isDraftEmpty,
  type AnswerDraft,
  type WorksheetAnswerValue,
} from '@/lib/worksheet-questions';
import type { ChatToast } from '../classroom-types';
import {
  dropQueueItem,
  isPermanentFailure,
  permanentFailureMessage,
  readQueue,
  replayOrder,
  upsertQueueItem,
  worksheetQueueKey,
  writeQueue,
  type WorksheetQueueItem,
} from './worksheet-queue';

/**
 * 学生端作答的**唯一写入通道**：本地状态 → 防抖 1.5s → `PUT /api/worksheets/:id/answers`。
 *
 * 三条不变量（规格 §8.3），每一条都在下面的代码里各有一处对应：
 *   1. **本地先落，零延迟**：学生按下选项/敲字的那一刻界面就变了，不等网络。
 *   2. **绝不静默丢数据**：每一条作答先写进 `localStorage` 的队列，**只有服务端返回 200
 *      才从队列里摘掉**。断网、刷新、切走模块、iPad 锁屏，醒来后队列还在、还会重放。
 *   3. **永久失败要说话**：4xx（含 `allowResubmit: false` 的 409）从队列里丢弃，
 *      **并且弹一句提示** —— 丢弃是对的（重放一万次也是同一个答案），
 *      但静默丢弃正是本节要防的那件事。判据在 `worksheet-queue.ts` 的
 *      `isPermanentFailure`，那里有完整理由。
 *
 * ⚠️ **提交某题之前必须先 flush**（`submit()` 的第一步）：服务端对「还没作答就提交」回 400
 * （`routes/worksheets.ts`），而此刻这一题的作答完全可能还躺在队列里（断网 / 刚敲完还没到
 * 1.5s）。不 flush 就提交，学生看到的是一句莫名其妙的「请先作答再提交本题」。
 *
 * ⚠️ 全程走**裸 `fetch`** 而不是 `api.*` 的 `request()`：那条路把非 2xx 一律抛成一个
 * `Error`，**状态码丢了** —— 而本模块的全部要害正是「4xx 与 5xx 要分开处置」。
 * 这不是绕开 API 层，是 API 层今天没有「带状态码的失败」这个形状（`api.ts` 的
 * `request()` 只 throw message）。将来它有了，这里应该改回去。
 */

/** 一道题在服务端的状态。`undefined` = 还没提交过（也没保存过）。 */
export type WorksheetQuestionStatus = 'draft' | 'submitted';

/** 一次 `PUT` 的结果。`status: null` = 网络错误（连状态码都没有）⇒ 暂时失败。 */
type SaveOutcome = { ok: true } | { ok: false; status: number | null; error: string | null };

export interface UseWorksheetAnswersOptions {
  /** 课堂 id（队列键的一半）。 */
  classroomId: string | null;
  /** **参与者** id（队列键的另一半；小组模式下它不是学生）。 */
  participantId: string | null;
  /** 这一份学习单的 id；`null` = 还没有可作答的（不发任何请求）。 */
  worksheetId: string | null;
  /** 当前这份学习单的题目树。用来把输入态变成作答值、并在入队前校验题号。 */
  questions: WorksheetQuestionNode[];
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
}

export interface UseWorksheetAnswersResult {
  /** 每道题界面上的输入态。 */
  drafts: Record<string, AnswerDraft>;
  /** 每道题在服务端的状态（只由**服务端确认过的事件**写入，见下面 `applyStatus`）。 */
  statuses: Record<string, WorksheetQuestionStatus>;
  /** 正在提交的题（按钮转圈、防连点）。 */
  submitting: Record<string, boolean>;
  /** 队列里还有几条没发出去。 */
  pendingCount: number;
  /**
   * 上一次尝试是**暂时失败**（5xx / 网络错误）或浏览器自报离线。
   *
   * 🔴 它与 `pendingCount` 是两件事，不能合成一件：刚敲完一个字、防抖还没到点的
   * 那 1.5s 里 `pendingCount` 也是 1 —— 拿它当「离线」会让顶栏在**每一次击键**时
   * 闪一下琥珀色。琥珀色说的是「试过了，没成功」。
   */
  offline: boolean;
  /** 有改动在防抖窗口里、或有请求在途、或队列非空。 */
  saving: boolean;
  setDraft: (node: WorksheetQuestionNode, draft: AnswerDraft) => void;
  submit: (node: WorksheetQuestionNode) => Promise<void>;
}

/** 防抖时长（规格 §8.3 的 1.5s）。 */
const SAVE_DEBOUNCE_MS = 1500;

export function useWorksheetAnswers({
  classroomId,
  participantId,
  worksheetId,
  questions,
  setToast,
}: UseWorksheetAnswersOptions): UseWorksheetAnswersResult {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [statuses, setStatuses] = useState<Record<string, WorksheetQuestionStatus>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [debouncing, setDebouncing] = useState(false);

  /** 队列的**内存权威**。`localStorage` 是它的镜像（每写必同步）。 */
  const pendingRef = useRef<WorksheetQueueItem[]>([]);
  /**
   * 每一题**上一次成功落库**的值。
   *
   * 存在的唯一理由是「清空」：学生把输入框删干净时，服务端那一行必须被清掉，
   * 否则教师看板上留着一条学生已经删掉的答案。而**从来没有存过**的题不该收到一次清空 ——
   * 服务端会因此为它建出一行（`value` 为 SQL NULL 的作答），教师看板立刻把这名学生
   * 显示成「已开始作答」，且这一题之后还能被「提交」成一个空答案。
   * 所以判据是「发过」而不是「现在是空的」。
   */
  const lastSentRef = useRef<Record<string, WorksheetAnswerValue | null>>({});
  /** 队列键。换学生 / 换课堂 / 换学习单都要重新水合（见文件头）。 */
  const queueKey = classroomId && participantId ? worksheetQueueKey(classroomId, participantId) : null;

  /** 题目树的即时镜像：flush 的回调不是每次渲染重建的，闭包里读到的必须是**当下**的题。 */
  const questionsRef = useRef(questions);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  const setToastRef = useRef(setToast);
  useEffect(() => { setToastRef.current = setToast; }, [setToast]);
  const worksheetIdRef = useRef(worksheetId);
  useEffect(() => { worksheetIdRef.current = worksheetId; }, [worksheetId]);

  /**
   * 队列键的 ref 镜像。
   *
   * 🔴 **必须经 ref 读，不能靠闭包**：`commitQueue` 是「写入存储」的唯一出口，而卸载时
   * 那条尽力而为的 flush 拿到的是**首次渲染**那一版的闭包 —— 闭包里的 `queueKey` 当时
   * 还是 `null`（参与者还没确定），于是那一次出队**不会写进存储**：队列在内存里清零了、
   * 存储里还留着旧的那几条，下一次挂载会把已经发出去过的作答**重放一遍**。
   */
  const queueKeyRef = useRef<string | null>(null);

  /** 把队列同步到 state 与存储。**唯一的写入点** —— 两处各写一次必然漂移。 */
  const commitQueue = useCallback((items: WorksheetQueueItem[]) => {
    pendingRef.current = items;
    setPendingCount(items.length);
    const key = queueKeyRef.current;
    if (key) writeQueue(window.localStorage, key, items);
  }, []);

  // ── 水合：挂载 / 换键时把存储里的队列读回来 ────────────────────────────────
  //
  // ⚠️ 这里**顺手重置** drafts / statuses / lastSent：换了参与者或学习单，上一个的输入态
  // 与「发过什么」都不再适用。不清的话，新学生会带着上一个学生的草稿出现在屏幕上。
  useEffect(() => {
    queueKeyRef.current = queueKey;
    setDrafts({});
    setStatuses({});
    setSubmitting({});
    setOffline(false);
    lastSentRef.current = {};
    if (!queueKey) {
      pendingRef.current = [];
      setPendingCount(0);
      return;
    }
    const hydrated = readQueue(window.localStorage, queueKey);
    pendingRef.current = hydrated;
    setPendingCount(hydrated.length);
    // 🔴 **把队列里还没发出去的作答填回输入框。** 刷新一下不该让答案从屏幕上消失 ——
    // 队列还在（数据没丢），但输入框空着的话，学生会以为自己白写了，然后**重新敲一遍**；
    // 更糟的是他会先清空那个字段，而「清空」在 `setDraft` 里是一条真实的操作
    // （有内容 ⇒ 覆盖；空的且发过 ⇒ 入队一条清空；空的且没发过 ⇒ 出队）。
    const restored: Record<string, AnswerDraft> = {};
    hydrated.forEach((item) => {
      // `value === null` 是「清空这一题」的标记，不是一份作答 —— 它没有可填回的内容。
      if (item.value !== null) restored[item.questionId] = draftFromValue(item.value);
    });
    setDrafts(restored);
    // ⚠️ **刻意不填 `lastSentRef`**：队列里这一条还没被服务端确认过（可能发出去过、
    // 200 丢在路上了，也可能根本没发出去），我们**不知道**库里有没有这一行。
    // 填了的代价是：学生随后清空这个字段 ⇒ 我们发一条「清空」⇒ 若服务端本来没有这一行，
    // 它就凭空多出一行 `value` 为 NULL 的作答，教师看板立刻把这名学生显示成「已开始作答」，
    // 而这一题之后还能被提交成一个空答案。不填的代价小得多（极少数情况下库里留着一个
    // 学生已经删掉的值），所以选不填。
    // 上一次会话遗留的作答（刷新 / 断网关掉页面）在这里立刻排队重放一次。
    if (hydrated.length > 0) setDebouncing(true);
  }, [queueKey]);

  // ── 写入通道 ────────────────────────────────────────────────────────────

  const putAnswer = useCallback(async (worksheetIdForSave: string, item: WorksheetQueueItem): Promise<SaveOutcome> => {
    const body: Record<string, unknown> = { questionId: item.questionId };
    // ⚠️ `null` = 清空这一题：**不发这个键**。服务端的 `toJsonValue` 把「没有 value」
    // 收成 SQL NULL（那正是「这一题的作答被清空了」），而 `JSON.stringify` 会把
    // `undefined` 整个丢掉 —— 所以这里不写 `value: undefined`，而是根本不写。
    if (item.value !== null) body.value = item.value;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(worksheetIdForSave)}/answers`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getStudentSessionAuthorization() },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      const payload = await res.json().catch(() => null);
      const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : null;
      return { ok: false, status: res.status, error: message };
    } catch {
      // 连请求都没发出去（断网 / DNS / 被中断）⇒ `status` 为 null ⇒ **暂时失败**，
      // 由调用方留在队列里等下一次。绝不在这里把作答丢掉。
      return { ok: false, status: null, error: null };
    }
  }, []);

  const flushRef = useRef<Promise<void> | null>(null);

  /**
   * 把队列**排干**。
   *
   * ⚠️ 返回同一个 Promise 而不是「在途时直接 return」：`submit()` 的第一步就是它，
   * 而「已经有一次 flush 在跑」恰恰是提交前最常见的状态（学生刚敲完就点提交）。
   * 直接 return 会让提交抢在保存前面到达服务端 ⇒ 400「请先作答再提交本题」。
   *
   * 循环里**每一步都重新取队首**（而不是先快照一份列表）：flush 在途时学生可能又敲了字，
   * 那一条也必须在这一轮里发出去。`replayOrder` 保证顺序仍是「动手的先后」。
   */
  const flush = useCallback((): Promise<void> => {
    if (flushRef.current) return flushRef.current;
    // 收尾单独挂在外面（而不是 `.finally` 里引用 `run` 自己）：`run` 在那个回调里是
    // TDZ 边缘的写法，靠「Promise 回调一定在微任务里跑」才成立 —— 那不是一段应该
    // 留给读者去推的东西。`.catch` 只是兜住「未处理的拒绝」：`putAnswer` 已经把
    // 所有失败都收成了返回值，这条链正常不会拒绝。
    const run = (async () => {
      const target = worksheetIdRef.current;
      if (!target) return;
      for (;;) {
        const next = replayOrder(pendingRef.current)[0];
        if (!next) break;
        const outcome = await putAnswer(target, next);
        if (outcome.ok) {
          // ★ 只有服务端 200 才出队（规格 §8.3）。
          lastSentRef.current[next.questionId] = next.value;
          commitQueue(dropQueueItem(pendingRef.current, next.questionId));
          if (next.value !== null) {
            // 服务端在 `PUT` 里把这一行拨回 `draft`（`allowResubmit` 为假且已提交时
            // 它根本不会走到这里 —— 那种情况是 409，走下面那条分支）。
            setStatuses((prev) => (prev[next.questionId] === 'submitted' ? { ...prev, [next.questionId]: 'draft' } : prev));
          }
          setOffline(false);
          continue;
        }
        if (isPermanentFailure(outcome.status)) {
          // 永久失败：出队**并说话**。留着重试只会让队列永远清不空（服务端每次都拒）。
          commitQueue(dropQueueItem(pendingRef.current, next.questionId));
          setToastRef.current({
            msg: permanentFailureMessage(outcome.status as number, outcome.error),
            type: 'error',
          });
          continue;
        }
        // 暂时失败（5xx / 网络）：**这一条和后面全部留着**，顶栏转琥珀。
        setOffline(true);
        break;
      }
    })().catch(() => { /* 见上：正常不会走到这里 */ });
    flushRef.current = run;
    void run.then(() => {
      // ⚠️ 只有「没有别的 flush 顶上来」时才清空：清掉别人正在跑的那一个会让
      // `submit()` 拿到一个已经完成的 Promise，从而抢在保存前面提交。
      if (flushRef.current === run) flushRef.current = null;
      setDebouncing(false);
    });
    return run;
  }, [commitQueue, putAnswer]);

  /** 防抖计时器。每次改动重置 —— 学生连着敲字时只在停手 1.5s 后发一次。 */
  const timerRef = useRef<number | null>(null);

  const enqueue = useCallback((item: WorksheetQueueItem) => {
    commitQueue(upsertQueueItem(pendingRef.current, item));
    setDebouncing(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [commitQueue, flush]);

  /**
   * 学生的每一次输入。**本地状态立即变**（零延迟），然后进队列。
   *
   * 三种情形，第三条是最容易被漏掉的：
   *   ① 有内容 ⇒ 入队（覆盖同题的旧条目）；
   *   ② 空的、但**这一题发出去过** ⇒ 入队一条「清空」；
   *   ③ 空的、且从没发出去过 ⇒ **把它从队列里摘掉**。不摘的话，学生敲了「光」又删掉，
   *      队列里那条「光」会照常发出去 —— 学生屏幕上明明是空的。
   */
  const setDraft = useCallback((node: WorksheetQuestionNode, draft: AnswerDraft) => {
    setDrafts((prev) => ({ ...prev, [node.id]: draft }));
    const value = buildAnswerValue(node, draft);
    if (value) {
      enqueue({ questionId: node.id, value, at: Date.now() });
      return;
    }
    if (lastSentRef.current[node.id] !== undefined) {
      enqueue({ questionId: node.id, value: null, at: Date.now() });
      return;
    }
    if (pendingRef.current.some((item) => item.questionId === node.id)) {
      commitQueue(dropQueueItem(pendingRef.current, node.id));
    }
  }, [commitQueue, enqueue]);

  // ── 断网恢复后自动重放（规格 §8.3）────────────────────────────────────────
  useEffect(() => {
    // ⚠️ 初次挂载时**主动问一次** `navigator.onLine`：`offline` 事件只在「状态变化」时触发，
    // 而学生完全可能是**带着断网**打开这一页的（教室 Wi-Fi 掉了之后刷新）—— 那样顶栏会
    // 一直显示「已保存 ✓」，直到第一次保存失败为止。那段时间里的这句「已保存」是假话。
    // 判据只取 `=== false`：`navigator.onLine` 的**真**不可信（连上但是门户认证的 Wi-Fi
    // 也报 true），**假**则相当可靠（网卡没连上）。
    if (window.navigator.onLine === false) setOffline(true);
    const handleOnline = () => {
      setOffline(false);
      void flush();
    };
    // `offline` 事件只更新指示器，不做事 —— 浏览器自己会拒绝请求，那条路已经被
    // `putAnswer` 的 catch 覆盖了。但没有它的话，学生在断网期间的顶栏不会有任何变化，
    // 直到第一次保存失败为止。
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flush]);

  // 挂载 / 换键时重放上一次会话遗留的队列（见上面水合那一段）。
  useEffect(() => {
    if (pendingRef.current.length === 0) return;
    void flush();
  }, [queueKey, flush]);

  // 卸载时**尽力**发一次（不 await：卸载不能等网络）。发不出去也不丢 ——
  // 队列已经在 localStorage 里，下一次挂载会重放。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (pendingRef.current.length > 0) void flush();
    };
    // 只在真正卸载时跑：`flush` 的身份变化不该触发一次卸载清理（那会在每次换键时多发一轮）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 提交单题。
   *
   * 顺序是硬要求：**先 flush，再确认队列里没有这一题，最后才提交**。少了第一步，
   * 服务端对「还没作答就提交」回 400（`routes/worksheets.ts` 的显式检查）；
   * 少了第二步，那个 400 会以「请先作答再提交本题」的样子出现，而学生明明答了 ——
   * 一句把网络问题说成学生问题的谎话。
   */
  const submit = useCallback(async (node: WorksheetQuestionNode) => {
    const target = worksheetIdRef.current;
    if (!target) return;
    setSubmitting((prev) => ({ ...prev, [node.id]: true }));
    try {
      await flush();
      if (pendingRef.current.some((item) => item.questionId === node.id)) {
        setToastRef.current({ msg: '这一题还没保存成功，先等网络恢复再提交', type: 'info' });
        return;
      }
      let res: Response;
      try {
        res = await fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(target)}/answers/submit`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getStudentSessionAuthorization() },
          body: JSON.stringify({ questionId: node.id }),
        });
      } catch {
        // 提交失败**不进队列**：作答本身已经在服务端了（上面刚 flush 过），学生再点一次即可，
        // 没有任何数据会因此丢掉。所以这里只是提示，不改队列 —— 与保存那条路刻意不同。
        setToastRef.current({ msg: '网络不太好，这一题没提交上，再点一次试试', type: 'error' });
        return;
      }
      if (res.ok) {
        setStatuses((prev) => ({ ...prev, [node.id]: 'submitted' }));
        setOffline(false);
        return;
      }
      const payload = await res.json().catch(() => null);
      const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : null;
      setToastRef.current({
        msg: message || (res.status >= 500 ? '服务端出了点问题，这一题没提交上，再点一次试试' : `提交失败（错误 ${res.status}）`),
        type: 'error',
      });
    } finally {
      setSubmitting((prev) => ({ ...prev, [node.id]: false }));
    }
  }, [flush]);

  return {
    drafts,
    statuses,
    submitting,
    pendingCount,
    offline,
    saving: debouncing || pendingCount > 0,
    setDraft,
    submit,
  };
}

/** 供面板判「这一题现在该显示哪个状态」用：`✓ 已提交` / `◐ 作答中` / 空白。 */
export function questionDisplayState(
  status: WorksheetQuestionStatus | undefined,
  draft: AnswerDraft | undefined,
): 'submitted' | 'drafting' | 'empty' {
  if (status === 'submitted') return 'submitted';
  if (draft && !isDraftEmpty(draft)) return 'drafting';
  if (status === 'draft') return 'drafting';
  return 'empty';
}
