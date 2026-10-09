'use client';

import { normalizeGeneration, generationFor, retainCurrentGeneration, type WorksheetGeneration } from './worksheet-generation';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getApiBaseUrl } from '@/lib/api-base';
import { getStudentSessionAuthorization } from '@/lib/api';
import type { WorksheetGradeState, WorksheetQuestionNode } from '@/lib/types';
import {
  buildAnswerValue,
  isDraftEmpty,
  type AnswerDraft,
  type WorksheetAnswerValue,
} from '@/lib/worksheet-questions';
import type { ChatToast } from '../classroom-types';
import { downsampleInkValue } from '@/lib/worksheet-ink';
import { publishDraftPreview, subscribeWorksheetClear } from './worksheet-socket-bus';
import {
  classifyFailure,
  shouldFlushOnLockChange,
  dropQueueItem,
  dropQuestionFromQueue,
  emptyEditAction,
  hydrateAnswers,
  permanentFailureMessage,
  readCorrectBlanks,
  readQueue,
  replayOrder,
  scoreFromWire,
  sessionExpiredMessage,
  upsertQueueItem,
  worksheetQueueKey,
  writeQueue,
  type SavedAnswerRow,
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
 *      `classifyFailure`，那里有完整理由。
 *
 * 🔴 第 2 条对 **401（会话过期）** 有额外的分量：服务端的学生 token 用每进程随机的密钥签，
 * **服务端每重启一次所有学生 token 就失效一次**，所以 401 的成因全在服务端、与学生的答案
 * 无关。它因此**不是永久失败、绝不出队** —— 队列留在 `localStorage`，刷新页面重新建会话
 * 会把它整个重放。详见 `worksheet-queue.ts` 的 `sessionExpiredMessage`。
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

/**
 * 一道题的**得分**。`null` = 没判分（主观题 / 关掉自动判分）—— **不是「0 分」**：
 * 「不知道」与「答错了」在奖励上都不画东西，但把它们混成一个数，将来做统计时
 * 就会把没判的题算成答错。
 *
 * ★ M4a：**它是绝对值**（教师逐题填的那个数，规格 §12），不再是 0/1 的比例 ——
 * 「全对 5 分」就是 `5`。唯一一处换算点在 `scoreFromWire`（`worksheet-queue.ts`）。
 */
export type WorksheetScore = number | null;

// ⚠️ `scoreFromWire`（线缆上的一行 → 得分）**在 `worksheet-queue.ts`**：水合这一侧
// （`hydrateAnswers`）也要用它，而那个文件是**纯逻辑、被 `node --test` 跑**的那一个 ——
// 「`null` 不是 `0`」与「旧行用 `isCorrect` 兜底」这两条判据必须有用例钉着。定义只有一处。

/** 一次 `PUT` 的结果。`status: null` = 网络错误（连状态码都没有）⇒ 暂时失败。 */
type SaveOutcome =
  | { ok: true }
  | { ok: false; status: number | null; error: string | null; code: string | null };

export interface UseWorksheetAnswersOptions {
  /** 课堂 id（队列键的一半）。 */
  classroomId: string | null;
  /** **参与者** id（队列键的另一半；小组模式下它不是学生）。 */
  participantId: string | null;
  /** 这一份学习单的 id；`null` = 还没有可作答的（不发任何请求）。 */
  worksheetId: string | null;
  /** 当前这份学习单的题目树。用来把输入态变成作答值、并在入队前校验题号。 */
  questions: WorksheetQuestionNode[];
  /**
   * **服务端已有的作答**（`GET /api/worksheets/:id/answers` 的 `rows`）。
   *
   * 🔴 这是「学生做了一半刷新页面后，做好的题没了」的修法本体：保存成功的那一刻
   * 队列就出队了（规格 §8.3），所以「已经保存成功的作答」在客户端**一点留底都没有**，
   * 只有服务端有。不把它读回来，刷新后必然是空白。
   *
   * ⚠️ **引用必须稳定**：水合 effect 的依赖里有它，而那个 effect 的开头会
   * **整个替换** `drafts` / `statuses` / `scores`。每次渲染都传一个新数组的话，
   * 学生每敲一个字都会被一次水合抹掉。调用方请把它放进**每次请求只建一次**的那个
   * state 里（`worksheet-panel.tsx` 的 `load` 就是这么做的），不要现 map 一份。
   */
  savedAnswers: SavedAnswerRow[];
  generation?: WorksheetGeneration;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  /**
   * ★ M5a：这间课堂此刻是否锁定了作答。
   *
   * 用途两个：`submit` 前**跳过** flush（锁期间 flush 必然吃 409），
   * 以及「锁定到达的那一瞬尽力把队列发一次」。
   *
   * ⚠️ **不要**改成读 `classroom?.answersLocked`（那个快照 15 秒才刷新一次）——
   * 它由会话层的专门 state + socket 事件供着，一路 props 递到本 hook。
   */
  answersLocked: boolean;

  /**
   * ★ 2026-09-28：收到清除指令后，让**面板**重拉一次服务端那一份
   *（面板里就是 `setReloadToken((n) => n + 1)`）。
   *
   * 🔴 重水合**不在这里手写**：它唯一的产出地是面板那条 `[queueKey, savedAnswers]`
   * 的 effect。本 hook 第一版把 `hydrateAnswers` + 六个 setter 搬进了 socket 回调那条路，
   * 教师报「学生在输入时清除该题 ⇒ 学生端浏览器假死」—— 那条回路我没能读清成因，
   * 而**读不出来的回路不该继续在上面加东西**。改成让既有的那条路去做。
   */
  onCleared: () => void;
}

export interface UseWorksheetAnswersResult {
  /** 每道题界面上的输入态。 */
  drafts: Record<string, AnswerDraft>;
  /** 每道题在服务端的状态（只由**服务端确认过的事件**写入，见下面 `applyStatus`）。 */
  statuses: Record<string, WorksheetQuestionStatus>;
  /**
   * 每道题的**得分**（教师逐题填的那个绝对数；旧行按 `isCorrect` 兜底）。键不在 = 没判过分。
   *
   * 🔴 它是**呈现层**的输入，不是数据：星星 / 花朵 / 分数**不落库**（规格 §9.1）。
   * 这里只存「服务端判定的那个得分」，画成什么由 `lib/worksheet-reward.ts` 决定。
   * 唯一的写入点是 `submit()` 拿到 200 之后（得分只可能来自服务端的判分），
   * 以及保存成功把已提交的题拨回 `draft` 时**清掉**它（那时服务端那一行的
   * `isCorrect` / `score` 已被清成 `null`，留着旧的会让星星停在一个库里已不成立的判分上）。
   */
  scores: Record<string, WorksheetScore>;
  gradeStates: Record<string, WorksheetGradeState | null>;
  wrongBlankIndexes: Record<string, number[]>;
  /** ★ 2026-09-27：答错的空的正确答案（空下标 → 那一个答案）。**只在已提交的题上有内容**。 */
correctBlanks: Record<string, Record<string, string>>;
  /** 本次页面停留期间，每道题新获得奖励的次数；只用于驱动一次性庆祝动效。 */
  rewardBursts: Record<string, number>;
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
/**
 * ★ 2026-09-28：「正在输入」那条实时通道的节流与体积预算。
 * ⚠️ 节流**远小于** `SAVE_DEBOUNCE_MS` 是这条通道存在的全部理由（见 `emitPreview`）。
 * 预算比落库那条（64 KiB）小得多：它每 300ms 就可能走一次，而落库是 1.5 秒一次。
 */
const PREVIEW_THROTTLE_MS = 300;
const PREVIEW_BUDGET_CHARS = 16384;

export function useWorksheetAnswers({
  classroomId,
  participantId,
  worksheetId,
  questions,
  savedAnswers,
  generation,
  setToast,
  answersLocked,
  onCleared,
}: UseWorksheetAnswersOptions): UseWorksheetAnswersResult {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [statuses, setStatuses] = useState<Record<string, WorksheetQuestionStatus>>({});
  const [scores, setScores] = useState<Record<string, WorksheetScore>>({});
  const [gradeStates, setGradeStates] = useState<Record<string, WorksheetGradeState | null>>({});
  const [wrongBlankIndexes, setWrongBlankIndexes] = useState<Record<string, number[]>>({});
  const [correctBlanks, setCorrectBlanks] = useState<Record<string, Record<string, string>>>({});
  const [rewardBursts, setRewardBursts] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [debouncing, setDebouncing] = useState(false);

  /** 队列的**内存权威**。`localStorage` 是它的镜像（每写必同步）。 */
  const pendingRef = useRef<WorksheetQueueItem[]>([]);
  const generationRef = useRef(normalizeGeneration(generation));
  useEffect(() => { if (generation) generationRef.current = generation; }, [generation]);
  const storageWarningRef = useRef(false);
  /**
   * ★ 2026-10-09（审计 §B4b）：**此刻正在发的那一条**（`flush` 取走的快照），没有就是 `null`。
   *
   * 🔴 为什么非要有它：`flush` 是「取队首快照 → `await putAnswer` → 出队」，
   * **在途这一段里那一条仍然留在队列里**，而 `lastSentRef` 要等 200 回来才写 ⇒
   * 学生这时把这一题删干净，`setDraft` 会以为「这一题从没交出去过」而把它摘掉 ——
   * 可那个 PUT 照样落库：屏幕空、库里有、队列里没有任何一条会去纠正它。
   * 判据（`emptyEditAction`）要的就是这一个事实，所以这里给它留痕。
   *
   * ⚠️ 记号必须在 `await` **之前**落下、在它**之后**清掉（`answer-inflight-wiring.test.ts` 钉着顺序）。
   */
  const inFlightRef = useRef<WorksheetQueueItem | null>(null);
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
  // ★ M5a：`submit` 是个 `useCallback`，读 state 会让它每变一次就换一个新身份
  // （`WorksheetPanel` 那侧的 effect 依赖它）。镜像进 ref 是照 `worksheetIdRef` 的写法。
  const answersLockedRef = useRef(answersLocked);
  answersLockedRef.current = answersLocked;

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
    if (key) {
      let persisted = false;
      try { persisted = writeQueue(window.localStorage, key, items); } catch {}
      if (!persisted && !storageWarningRef.current) {
        storageWarningRef.current = true;
        setToastRef.current({ msg: '浏览器无法保存离线草稿，当前内容仍在内存中；请勿刷新或关闭页面。', type: 'error' });
      }
    }
  }, []);

  // ── 水合：挂载 / 换键 / 服务端作答到达时，把三个来源合成一份界面态 ───────────
  //
  // 三个来源，**优先级从低到高**：
  //   ① 什么都没有 ⇒ 空白（一道没做过的题就该是空白）；
  //   ② **服务端已有的作答**（`savedAnswers`）⇒ 填回输入框 + 状态 + 得分。
  //      这是「刷新后做好的题还在」的那一条 —— 保存成功就出队了，服务端是**唯一**的留底；
  //   ③ **本地队列**（`localStorage`，还没保存成功的）⇒ 覆盖 ②。
  //
  // 🔴 ③ 必须赢过 ②，判据与理由都写在 `hydrateAnswers` 里（`worksheet-queue.ts`）。
  //    这一段的职责只是把它的产物灌进 state 与 ref —— **合并规则一个字都不在这里**，
  //    因为它必须是一条能被 `node --test` 直接跑到的用例（`worksheet-queue.test.ts` 第 5 节）。
  //
  // ⚠️ 这里**顺手重置** drafts / statuses / scores / lastSent：换了参与者或学习单，上一个的
  // 输入态、作答态与得分都不再适用。不清的话，新学生会带着上一个学生的草稿与星星出现在屏幕上。
  //
  // ⚠️ 依赖里的两个值都必须**引用稳定**，否则这个 effect 会在学生打字的中途重跑，
  // 把刚敲进去的东西整体抹掉：`queueKey` 是字符串（天然稳定），`savedAnswers` 的稳定性
  // 由调用方保证（见 `UseWorksheetAnswersOptions` 那条注释）。它在这里是**依赖项**
  // （不是 ref）：作答读回来的那一刻正是水合该发生的时刻，漏了它，
  // 服务端的作答永远填不回屏幕 —— 那正是这次要修的 bug。
  useEffect(() => {
    const previousQueueKey = queueKeyRef.current;
    queueKeyRef.current = queueKey;
    setSubmitting({});
    setOffline(false);
    if (!queueKey) {
      pendingRef.current = [];
      setPendingCount(0);
      setDrafts({});
      setStatuses({});
      setScores({});
      setGradeStates({});
      setWrongBlankIndexes({});
      setRewardBursts({});
      lastSentRef.current = {};
      return;
    }
    let stored: WorksheetQueueItem[] = [];
    try { stored = storageWarningRef.current && previousQueueKey === queueKey ? pendingRef.current : readQueue(window.localStorage, queueKey); } catch {}
    const queued = retainCurrentGeneration(stored, generationRef.current);
    try { writeQueue(window.localStorage, queueKey, queued); } catch {}
    pendingRef.current = queued;
    setPendingCount(queued.length);

    // ⚠️ 题目树**经 ref 读**，且**故意不进依赖**（依赖只有 `queueKey` 与 `savedAnswers`）：
    // 调用方在「还没读完」时给的是现写的 `[]`（`worksheet-panel.tsx` 的
    // `load.kind === 'ready' ? … : []`），把它列进依赖会让这条 effect **每次渲染都重跑**
    // —— 而它的第一件事就是整体替换 drafts / statuses / scores，
    // 于是一个 `setDrafts({})` → 重渲染 → 新 `[]` → 再重跑的**死循环**（学生屏幕上
    // 的字全被抹掉，而且 CPU 打满）。
    // 读 ref 之所以**时机正确**：`questions` 与 `savedAnswers` 是**同一次 `setLoad`**
    // 灌进来的（`Promise.all` 那一处），而 `questionsRef` 的赋值 effect 声明在这条之前
    // ⇒ 同一次提交里它先跑（React 按声明顺序执行 effect）。
    const merged = hydrateAnswers(savedAnswers, queued, questionsRef.current);
    setDrafts(merged.drafts);
    setStatuses(merged.statuses);
    setScores(merged.scores);
    setGradeStates(merged.gradeStates);
    setWrongBlankIndexes(merged.wrongBlankIndexes);
    setCorrectBlanks(merged.correctBlanks ?? {});
    setRewardBursts({});
    // `lastSentRef` **由水合结果整个替换**（不是「只填不删」）：换了参与者 / 换了一份学习单，
    // 上一个的「发过什么」不再适用。
    //
    // ⚠️ 这里与队列那一条是**刻意不对称**的，别顺手把它们看齐：
    //   · 服务端回读得来的行 ⇒ **填**（库里确实有这一行，所以学生随后清空它时必须发一条
    //     「清空」出去，否则服务端会一直留着学生已经删掉的答案）；
    //   · 队列里那一条 ⇒ **不填**（它还没被服务端确认过 —— 可能发出去过、200 丢在路上了，
    //     也可能根本没发出去，我们**不知道**库里有没有这一行。填了的代价是：学生随后清空
    //     这个字段 ⇒ 我们发一条「清空」⇒ 若服务端本来没有这一行，它就凭空多出一行
    //     `value` 为 NULL 的作答，教师看板立刻把这名学生显示成「已开始作答」，
    //     而这一题之后还能被提交成一个空答案。不填的代价小得多）。
    //   判据与取舍写在 `hydrateAnswers` 里，两边是同一个函数产出的，不会漂移。
    lastSentRef.current = merged.lastSent;

    // 上一次会话遗留的队列（刷新 / 断网关掉页面）在这里立刻排队重放一次。
    if (queued.length > 0) setDebouncing(true);
  }, [queueKey, savedAnswers]);

  /**
   * ★ 2026-09-28（教师第 4 条）：教师在**看板**上清掉了这名学生在这份学习单上的作答。
   *
   * 🔴 **指令是走 props 进来的，不是这里自己订阅 socket。** 这一点是实测栽出来的：
   * 学生端**不用** `@/lib/socket` 那个单例（那是**教师端**的）—— 学生有两条自己建的连接，
   * 而只有 `useChatSocket` 那条发 `join-classroom` ⇒ 只有它进得了 `student:<id>` 房间。
   * 我第一版在这里调了 `useSocket()`，那开出的是**第三条从没 join 过的连接**：
   * 广播永远收不到，而**两边都不报错**（服务端照发、日志干净、学生屏幕上什么都不动），
   * 教师看到的正是「清了没反应，刷新才清」。
   * ⚠️ 也不能「这里自己再开一条并 join」：服务端对同一学生**只保留一条连接**
   *（重复 join 会踢掉旧的）⇒ 那会把学生的聊天连接踢断。
   * ⇒ 与 `answersLocked` / `webappDemand` 同一条路：socket 事件挂在 `useChatSocket`，
   *   状态归会话层，外壳转手进来。
   *
   * 两件事，缺一不可：
   *   ① **丢掉这个 scope 的待保存项**（`pendingRef` + `localStorage` 的镜像一起，走
   *      `commitQueue` 那唯一一个写入点）—— 不丢的话，学生那一次 1.5 秒防抖保存会把内容
   *      **写回去**，教师看到的是「清了又回来了」；
   *   ② **本地状态按「服务端已经没有这一份」重水合**。
   *      ⚠️ 复用水合那条函数（`hydrateAnswers`），不手写一份「怎么把一题清空」：
   *      那份规则有测试、且是 drafts/statuses/scores/lastSent 唯一的产出地。
   *
   * ⚠️ `lastSentRef` 也要跟着重算（`merged.lastSent`）：它记的是「这一题发过什么」，
   * 而服务端那一行已经被删了 —— 留着它的后果是学生随后清空这个字段时会发一条「清空」
   * 给一个**不存在的行**，服务端据此建出一行空作答。
   */
  /**
   * ★ 2026-09-28（教师第 4 条）：教师在**看板**上清掉了这名学生在这份学习单上的作答。
   *
   * 🔴 **指令走总线（`worksheet-clear-bus.ts`），不经过任何 React state / prop。**
   * 这条链的形状换过两次，每一次的原因都值得记下来：
   *   ① 第一版在本 hook 里调 `useSocket()` 订阅 —— 那是**教师端**的单例，学生这边用它会
   *      新开一条从没 `join-classroom` 过的连接 ⇒ 广播永远收不到，而**两边都不报错**
   *      （服务端日志干净、事件照发、学生屏幕上什么都不动）。学生端唯一在
   *      `student:<id>` 房间里的连接是 `useChatSocket` 那条；
   *   ② 第二版把指令做成会话层 state，经外壳 → 面板 → 本 hook。教师报
   *      **「学生在输入时清除该题 ⇒ 学生端浏览器假死」**，而我在那条链上读了三遍
   *      都没读出回路 —— **读不出来就不该继续在上面加东西**；
   *   ③ 现在这条：`useChatSocket` 收到事件就 publish，本 hook 自己 subscribe。
   *      **链路上一个 setState 都没有** ⇒ 结构上不可能由这次投递引起重渲染。
   *      形状本来就该这样：清除是一条**命令**（边沿触发），不是**状态**（电平触发）。
   *
   * 两件事，缺一不可：
   *   ① **丢掉这个 scope 的待保存项** —— 不丢的话，学生那一次 1.5 秒防抖保存（或队列里
   *      已有的那一条）会把内容**写回去**，而服务端那一行刚被删掉 ⇒ 教师看到
   *      「清了又回来了」；
   *   ② **让面板重拉服务端那一份**（`onCleared`）。重水合交给面板那条**已经跑了很久、
   *      有测试的** effect（`[queueKey, savedAnswers]`）—— 它本来就是这件事唯一的产出地，
   *      第一版手写的第二份既多余、又是我没能读清成因的那条回路的一部分。
   *
   * ⚠️ 订阅**之前**发出的命令收不到（总线没有回放），这正是要的：换身份再切回来时面板
   *    会重挂，重放一条十几分钟前的指令会把学生**在那之后重新答的**内容抹掉。
   *    旧版靠一个 `seenClearTokenRef` 手工挡这件事，现在是结构性的。
   */
  useEffect(() => {
    return subscribeWorksheetClear((command) => {
      // ⚠️ 对不上时**要吭声**：那意味着教师的动作在这台设备上什么也没发生，
      // 而屏幕上没有任何东西会提示这件事（本仓反复吃的一类缺陷）。
      if (command.classroomId !== classroomId) { console.warn('[worksheet] 清除指令被丢：不是这间课堂'); return; }
      if (command.participantId !== participantId) { console.warn('[worksheet] 清除指令被丢：不是这个参与者'); return; }
      if (command.worksheetId !== worksheetId) { console.warn('[worksheet] 清除指令被丢：不是这份学习单'); return; }

      // ① 丢掉这个 scope 的待保存项。整张清除时丢**全部**（这份 hook 就是逐份学习单的）。
      if (command.generation) generationRef.current = normalizeGeneration(command.generation);
      const scope = command.questionId;
      commitQueue(scope === null ? [] : pendingRef.current.filter((item) => item.questionId !== scope));

      // ② 让面板重拉服务端那一份；重水合由它那条既有 effect 完成
      //   （它同时会把 `lastSentRef` 按新的服务端数据重算，所以这里也不用手工碰它）。
      onCleared();
    });
    // ⚠️ `onCleared` 必须是**稳定引用**（面板里 useCallback 过）：它进了依赖。
  }, [classroomId, participantId, worksheetId, commitQueue, onCleared]);

  // ── 写入通道 ────────────────────────────────────────────────────────────

  const putAnswer = useCallback(async (worksheetIdForSave: string, item: WorksheetQueueItem): Promise<SaveOutcome> => {
    const body: Record<string, unknown> = { questionId: item.questionId, generation: item.generation ?? '0:0' };
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
      // ★ M5a：服务端那句 409 带一个机器可读的 `code`（`answers-locked`）。
      // 🔴 一定要读它：靠状态码分不出「锁定」与「本题不许重交」（两者都是 409），
      // 靠中文文案判则会在改文案时静默失效（后果是学生的作答被真的丢掉）。
      const code = payload && typeof payload.code === 'string' ? payload.code : null;
      return { ok: false, status: res.status, error: message, code };
    } catch {
      // 连请求都没发出去（断网 / DNS / 被中断）⇒ `status` 为 null ⇒ **暂时失败**，
      // 由调用方留在队列里等下一次。绝不在这里把作答丢掉。
      return { ok: false, status: null, error: null, code: null };
    }
  }, []);

  const flushRef = useRef<Promise<void> | null>(null);
  /**
   * 会话**当前**是不是过期的（上一次尝试吃了 401）。
   *
   * 两个用途，缺一不可：
   *   · **别重复弹同一句**。会话过期后学生每敲一次字都会走一遍 flush、每遍都吃一个 401，
   *     不设这道闸就是每 1.5 秒弹一次同样的话 —— 而噪音的结局是学生**不再看提示**，
   *     那比不提示还糟。
   *   · **给 `submit()` 一个判据**：那时这一题必然还在队列里，而
   *     「先等网络恢复再提交」对 401 是一句错话（网络是好的，是登录状态过期了）。
   * 保存成功即置回 false：那说明会话已经好了（多半是刷新过），下一次过期该重新说话。
   */
  const sessionExpiredRef = useRef(false);

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
        // ★ 在途留痕（见 `inFlightRef`）。⚠️ 清掉的那一句在 `finally` 里：这一条无论是
        // 成功、失败还是抛出去，都必须清 —— 留着它会让**之后**每一次空编辑都按「在途」处置
        // （为一道从未存过的题发一串「清空」）。
        inFlightRef.current = next;
        let outcome: SaveOutcome;
        try {
          outcome = await putAnswer(target, next);
        } finally {
          inFlightRef.current = null;
        }
        if ((next.generation ?? '0:0') !== generationFor(generationRef.current, next.questionId)) continue;
        if (outcome.ok) {
          // ★ 只有服务端 200 才出队（规格 §8.3）。
          sessionExpiredRef.current = false;
          lastSentRef.current[next.questionId] = next.value;
          commitQueue(dropQueueItem(pendingRef.current, next));
          if (next.value !== null) {
            // 服务端在 `PUT` 里把这一行拨回 `draft`（`allowResubmit` 为假且已提交时
            // 它根本不会走到这里 —— 那种情况是 409，走下面那条分支）。
            setStatuses((prev) => (prev[next.questionId] === 'submitted' ? { ...prev, [next.questionId]: 'draft' } : prev));
            // ⚠️ 得分必须**跟着清**：同一条 `PUT` 的 `update` 把 `isCorrect` 与 `score`
            // 一起写成了 `null`（那一段注释写着理由：改回 draft 却留着上次的 `true`，
            // 看板会显示成「这题刚判对」）。不清这里，学生会看着一颗已经作废的星星继续改答案。
            setScores((prev) => (prev[next.questionId] === undefined ? prev : { ...prev, [next.questionId]: null }));
            setGradeStates((prev) => ({ ...prev, [next.questionId]: null }));
            setWrongBlankIndexes((prev) => ({ ...prev, [next.questionId]: [] }));
          }
          setOffline(false);
          continue;
        }
        // 🔴 出队的判据**只有 `'permanent'` 这一档**，而它的定义在
        // `worksheet-queue.ts` 的 `classifyFailure`（测试断言的也正是那一个函数 ——
        // 这里若自己写 `status >= 400`，测试就会变成一条不看实现的假绿）。
        const kind = classifyFailure(outcome.status, outcome.code);
        if (kind === 'locked') {
          // ★ M5a：锁定期保存被拒 —— **保留这一条、不设 offline、不弹提示**。
          // 🔴 保留是关键：按永久失败处置会把它从队列里丢掉，而学生在锁定前写的东西
          //    就**真的没了**（`localStorage` 是唯一那份）。
          // 不弹提示的理由：锁定态本身就在屏幕上（面板那句「老师已锁定作答」），
          // 每 1.5 秒弹一次同样的话只会让学生不再看提示。
          // `break` 而不是 `continue`：锁还在，后面每一条都会是同一个 409 —— 白打服务端。
          break;
        }
        if (kind === 'permanent') {
          if (outcome.code === 'answers-cleared') onCleared();
          // 永久失败：出队**并说话**。留着重试只会让队列永远清不空（服务端每次都拒）。
          commitQueue(dropQueueItem(pendingRef.current, next));
          setToastRef.current({
            msg: permanentFailureMessage(outcome.status as number, outcome.error),
            type: 'error',
          });
          continue;
        }
        if (kind === 'session-expired') {
          // 🔴 **不出队**（理由见 `worksheet-queue.ts` 的 `sessionExpiredMessage`）：
          // 队列留在 `localStorage`，刷新页面重新建会话会把它整个重放，答案一条都不会少。
          // ⚠️ `break` 而不是 `continue`：token 已经失效，后面每一条都会是同一个 401，
          // 继续发只是白打服务端。⚠️ 也**不设 `offline`**：网络是好的，说「离线」是另一句谎话。
          if (!sessionExpiredRef.current) {
            sessionExpiredRef.current = true;
            setToastRef.current({ msg: sessionExpiredMessage(), type: 'error' });
          }
          break;
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
  }, [commitQueue, putAnswer, onCleared]);

  /** 防抖计时器。每次改动重置 —— 学生连着敲字时只在停手 1.5s 后发一次。 */
  const timerRef = useRef<number | null>(null);

  const enqueue = useCallback((item: WorksheetQueueItem) => {
    commitQueue(upsertQueueItem(pendingRef.current, { ...item, generation: generationFor(generationRef.current, item.questionId) }));
    setDebouncing(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [commitQueue, flush]);

  /**
   * ★ M5a：锁态**翻转**的那一瞬，若队列非空就立刻试一次（不等 1.5 秒防抖）。
   *
   * 🔴 **两个沿都要**（判据在 `shouldFlushOnLockChange`，那里写了完整理由与代价）：
   *   · 上升沿（未锁 → 锁）—— 救「广播还在路上、队列先到」那一档，大概率被拒、不是 bug；
   *   · 下降沿（锁 → 未锁）—— 规格 §3.3 逐字要求「解锁后继续重发」。
   *     **只写上升沿是一个已经发生过的错误**（独立审查抓到的）：锁前写的那一条会一直不发出，
   *     直到学生碰一下别的东西 —— 那段时间屏幕上是他刚写的字、库里是旧的。
   *
   * ⚠️ 判据是**边沿**，不是电平：电平会在每次渲染后重跑。而 `flush` 的依赖里没有
   * `answersLocked`，`[answersLocked, flush]` 这个依赖数组恰好只在锁态翻转时触发一次。
   */
  const wasLockedRef = useRef(answersLocked);
  useEffect(() => {
    const wasLocked = wasLockedRef.current;
    wasLockedRef.current = answersLocked;
    if (shouldFlushOnLockChange(wasLocked, answersLocked, pendingRef.current.length)) void flush();
  }, [answersLocked, flush]);

  /**
   * ★ 2026-09-28：把「他此刻正在写什么」发出去（**不写库、只喂看板那一格的预览**）。
   *
   * 🔴 **它存在的理由就是 `SAVE_DEBOUNCE_MS`（1500ms）那条防抖**：学生的作答**落库**
   * 要等他停手 1.5 秒（不防抖就是每敲一个字一次写库 + 一次广播），而教师看板上那一格
   * 要跟得上学生的手。⇒ 两条通道各司其职：
   *   · **落库**（`worksheet-answer-updated`）：慢、可靠、是**真相**；
   *   · **这一条**：快（节流 300ms）、不写库、**只是预览**。
   * ⚠️ 所以看板上「格子里的实时内容」与「库里的已保存内容」**不是同一份** ——
   * 教师看到的是学生在写什么，不是已经存下了什么。这一点在界面上要能读出来。
   *
   * ⚠️ **节流 300ms，且是「拖尾」式**：第一次敲键排一个 300ms 的计时器，之后每一次敲键
   * 只更新「最新那一份」而不重置计时器 ⇒ 打字过程中每 300ms 最多一条，
   * 停手后 300ms 内最后那一份也会发出去。
   *
   * ⚠️ **笔迹要先抽稀**（`downsampleInkValue`）：实测一幅认真的画约 335 KB，
   * 按 300ms 的节流原样发就是每秒一兆。抽稀后的值**只喂预览**，不写库、不进队列。
   */
  const previewTimerRef = useRef<number | null>(null);
  const previewLatestRef = useRef<{ questionId: string; value: unknown } | null>(null);
  const emitPreview = useCallback((questionId: string, value: unknown) => {
    // 两个 id 不全时不发（换学生 / 换学习单的间隙里没有可投递的坐标）。
    if (!classroomId || !worksheetId) return;
    previewLatestRef.current = { questionId, value: downsampleInkValue(value, PREVIEW_BUDGET_CHARS) };
    if (previewTimerRef.current !== null) return;
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      const item = previewLatestRef.current;
      if (!item) return;
      publishDraftPreview({ classroomId, worksheetId, questionId: item.questionId, value: item.value });
    }, PREVIEW_THROTTLE_MS);
  }, [classroomId, worksheetId]);
  // 卸载时收掉那个计时器（它一跑就会往一条可能已经关掉的连接上写）。
  useEffect(() => () => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
  }, []);

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
    // ★ 实时预览（不写库）。⚠️ 放在这里而不是 flush 里：flush 要等 1.5 秒，
    // 而这一条的全部意义就是**不等那 1.5 秒**。
    emitPreview(node.id, value);
    if (value) {
      enqueue({ questionId: node.id, value, at: Date.now() });
      return;
    }
    // 🔴 空的之后有**三档**处置，判据本体在 `emptyEditAction`（`worksheet-queue.ts`）里，
    //    这里只分派。⚠️ 中间的 `inFlight` 那一项是 2026-10-09 审计 §B4b 补的：
    //    在途那一条仍然在队列里，而 `lastSentRef` 还没写上它 —— 少了它，「正在发」会被
    //    当成「从没发过」而摘掉，可那个 PUT 照样落库。
    const action = emptyEditAction({
      confirmed: lastSentRef.current[node.id] !== undefined,
      inFlight: inFlightRef.current?.questionId === node.id,
      pending: pendingRef.current.some((item) => item.questionId === node.id),
    });
    if (action === 'drop-pending') {
      commitQueue(dropQuestionFromQueue(pendingRef.current, node.id));
      return;
    }
    if (action === 'enqueue-clear') {
      enqueue({ questionId: node.id, value: null, at: Date.now() });
    }
  }, [commitQueue, enqueue, emitPreview]);

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
      // ★ M5a：锁定期**不发 flush** —— 那一步是 PUT，而 PUT 锁定期必然吃 409。
      // 跳过它，直接看队列：队列里还有这一题 ⇒ 屏幕上那份还没存住 ⇒ **拦下并说明**。
      // 🔴 不拦的后果是把「库里那份旧的」交上去，而学生从屏幕上分不清哪部分存住了
      //    （规格 §3.3 的修正条款：拦下 + 一句明说，是更小的谎）。
      if (!answersLockedRef.current) {
        await flush();
      }
      if (pendingRef.current.some((item) => item.questionId === node.id)) {
        // ⚠️ 三种成因，文案必须分开：401 是登录状态过期（网络是好的），
        // 说成「等网络恢复」会让学生去检查 Wi-Fi —— 一次白费的排查。
        // ★ M5a 第三档：课堂被锁定 ⇒ 也不是网络问题。
        setToastRef.current({
          msg: answersLockedRef.current
            ? '这一题有还没保存的改动，锁定期间只能提交已保存的内容'
            : sessionExpiredRef.current
              ? sessionExpiredMessage()
              : '这一题还没保存成功，先等网络恢复再提交',
          type: answersLockedRef.current || sessionExpiredRef.current ? 'error' : 'info',
        });
        return;
      }
      let res: Response;
      try {
        res = await fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(target)}/answers/submit`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getStudentSessionAuthorization() },
          body: JSON.stringify({ questionId: node.id, generation: generationFor(generationRef.current, node.id) }),
        });
      } catch {
        // 提交失败**不进队列**：作答本身已经在服务端了（上面刚 flush 过），学生再点一次即可，
        // 没有任何数据会因此丢掉。所以这里只是提示，不改队列 —— 与保存那条路刻意不同。
        setToastRef.current({ msg: '网络不太好，这一题没提交上，再点一次试试', type: 'error' });
        return;
      }
      if (res.ok) {
        setStatuses((prev) => ({ ...prev, [node.id]: 'submitted' }));
        // 判分结果就在这个响应体里（`{ isCorrect, gradeState, score }`）。
        // ⚠️ 传**整行**（不是 `payload?.isCorrect`）：`score` 优先、`isCorrect` 兜底 ——
        // 后者是给**升级前落库的旧行**用的（A1 没回填 `score`），而这条响应体两者都在。
        // ⚠️ 读失败**不**当 0 分：`scoreFromWire(null)` 是 `null`（没判分），
        // 学生只是少一个奖励，而不是被判错（见那个函数的注释）。
        const payload = await res.json().catch(() => null);
        const awardedScore = scoreFromWire(payload);
        setScores((prev) => ({ ...prev, [node.id]: awardedScore }));
        const gradeState = payload?.gradeState === 'correct' || payload?.gradeState === 'partial' || payload?.gradeState === 'incorrect'
          ? payload.gradeState as WorksheetGradeState
          : null;
        const wrong = Array.isArray(payload?.wrongBlankIndexes)
          ? payload.wrongBlankIndexes.filter((value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0)
          : [];
        setGradeStates((prev) => ({ ...prev, [node.id]: gradeState }));
        setWrongBlankIndexes((prev) => ({ ...prev, [node.id]: wrong }));
        // ★ 2026-09-27：读法搬去了 `worksheet-queue.ts` 的 `readCorrectBlanks` ——
      //    它原来只在这里实现过一次，而**刷新那条路漏了**（学生一刷新正确答案就整块消失）。
      //    两处合成一处之后不会再漏第二次。
      setCorrectBlanks((prev) => ({ ...prev, [node.id]: readCorrectBlanks(payload?.correctBlanks) }));
        // 只庆祝这一次新提交得到的“全部答对”。水合旧答案不会写这里，所以刷新不会重播。
        if (gradeState === 'correct' && awardedScore !== null && awardedScore > 0) {
          setRewardBursts((prev) => ({ ...prev, [node.id]: (prev[node.id] ?? 0) + 1 }));
        }
        setOffline(false);
        return;
      }
      const payload = await res.json().catch(() => null);
      const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : null;
      // ⚠️ 401 的服务端原话是 `middleware/auth.ts` 的「教师会话已失效，请重新登录」——
      // 那是说给教师的，学生没有教师会话可登。照抄过来就是一句谎话，所以不走那条回落。
      if (res.status === 401) sessionExpiredRef.current = true;
      setToastRef.current({
        msg: res.status === 401
          ? sessionExpiredMessage()
          : message || (res.status >= 500 ? '服务端出了点问题，这一题没提交上，再点一次试试' : `提交失败（错误 ${res.status}）`),
        type: 'error',
      });
    } finally {
      setSubmitting((prev) => ({ ...prev, [node.id]: false }));
    }
  }, [flush]);

  return {
    drafts,
    statuses,
    scores,
    gradeStates,
    wrongBlankIndexes,
    correctBlanks,
    rewardBursts,
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
