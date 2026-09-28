'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import type { WorksheetBoard, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { applyLiveRows, mergeProgress, restProgress, type LiveRowPatch } from './worksheet-board-data';
import type { ParticipantWorksheetProgress } from './worksheet-tile-state';

/**
 * 教师看板**学习单数据的唯一来源**（★ 2026-09-28，教师裁定 ①：统一数据层）。
 *
 * ── 它替掉了什么 ─────────────────────────────────────────────────────
 * 在此之前，同一份数据有**三套各自为政的取法**：
 *   · **格子**：只吃 `worksheet-answer-updated` 广播，**从不读历史** ⇒ 教师刷新一次页面
 *     全班掉回「还没收到作答」；学生离开再回来（没有保存动作 ⇒ 没有广播）格子也不知道。
 *     这是教师报的第 1 条 bug，而它的根因就是「格子是唯一没接两条腿的消费方」；
 *   · **矩阵**：REST 当底 + 广播当增量，自己 30 秒轮询，**只在矩阵开着时**才拉；
 *   · **抽屉**：每次打开重拉一次整批（`loadWorksheetBoard`）。
 * ⇒ 三处各拉各的，节拍不同、新鲜度不同，而「谁该拉」这件事没有任何一处说得清。
 *
 * ── 现在的形状 ───────────────────────────────────────────────────────
 * **REST 快照当底 + 广播当增量 + 一个下界防陈旧**（合并规则在 `worksheet-board-data.ts`，
 * 是纯函数、有测试）。矩阵 M5b 早就是这么做的 —— 本次是把**格子与抽屉也接到同一份上**。
 *
 * 🔴 **轮询是常开的**（`BOARD_SNAPSHOT_INTERVAL_MS`），不再只在矩阵开着时跑。
 * 这一点是第 1 条的修法本体：格子没有别的办法知道「在自己打开之前发生过什么」。
 * 两个闸挡住白烧的电：课堂上没有学习单时不拉；页面不可见时跳过这一拍。
 *
 * ⚠️ **过期的字段不许清空**（与原来那两处 `load*` 同一条规矩）：某一次拉失败时
 * 保留上一次的快照，抽屉/格子会如实说「还没读到」而不是画一个看起来「全班都没作答」的空表。
 */

/** 作答行快照的节拍。与看板既有的「会走的表」（30 秒一格）同频，不引入第三个节拍。 */
export const BOARD_SNAPSHOT_INTERVAL_MS = 30_000;
/** 题目树的节拍。教师课上改单**不广播**（规格 §3-J 只警告不拦），所以只能靠定期重拉。 */
export const BOARD_NODES_INTERVAL_MS = 60_000;

export interface WorksheetBoardData {
  /** 最近一次成功拿到的那份快照；`null` = 一次都还没到（第一次打开时总要先来一趟）。 */
  board: WorksheetBoard | null;
  loading: boolean;
  /**
   * ★ 快照**发起**的时刻（浏览器时钟）—— 广播陈旧与否的下界。
   * ⚠️ 是「发起」不是「回来」：在途的那几条广播，其写库早于回来的时刻，若拿下界是「回来」
   * 就会被误判成陈旧、更新被丢掉。
   */
  snapshotAt: number;
  /** 学习单 id → 题目树（`content.nodes`）。键不在 = 还没加载到。 */
  nodesByWorksheet: Record<string, WorksheetQuestionNode[]>;
  /**
   * ★ 学习单 id → `settings`。奖励换算（`resolveRewardScale`）要用它。
   * 原来只留了 `nodes`，于是「该生目前拿到的奖励」在教师端**一处都画不出来**。
   */
  settingsByWorksheet: Record<string, WorksheetSettings>;
  /** ★ 合并后的逐参与者进度（格子与矩阵都吃它）。 */
  progress: Record<string, ParticipantWorksheetProgress>;
  /** 立刻重拉一次（教师清除了数据之后调它）。 */
  refresh: () => void;
  /** 就地更新一行的「已查看」时间（不重拉整批 —— 教师是逐题点的，重拉会让滚动位置跳）。 */
  markReviewed: (worksheetId: string, participantId: string, questionId: string, reviewedAt: string | null) => void;
}

export function useWorksheetBoard(classroomId: string | null): WorksheetBoardData {
  const { on } = useSocket();
  /**
   * 快照 + 它的两个时刻**放在同一个 state 对象里** —— 分成三个 state 的话，
   * React 的批处理能让「新 board 配旧 fetchedAt」短暂出现，而那个组合会算出一份错的进度。
   */
  const [snapshot, setSnapshot] = useState<{
    board: WorksheetBoard;
    /** 发起请求的时刻（下界）。 */
    startedAt: number;
    /** 响应到达的时刻（把服务端时长换算进浏览器时钟的锚点）。 */
    fetchedAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [nodesByWorksheet, setNodesByWorksheet] = useState<Record<string, WorksheetQuestionNode[]>>({});
  const [settingsByWorksheet, setSettingsByWorksheet] = useState<Record<string, WorksheetSettings>>({});
  /** 逐参与者的**广播增量**（`worksheet-answer-updated` 攒出来的）—— 供**格子**读。 */
  const [live, setLive] = useState<Record<string, ParticipantWorksheetProgress>>({});
  /**
   * ★ 乙档 / 丙档：广播带来的**逐行内容** —— 供**抽屉**读（它读 `answerRows`，不是 `progress`）。
   *
   * 为什么是两个 state 而不是一个：它们回答两个问题、粒度也不同（广播一次只带**一行**的
   * 内容，却会整体推进「正在做第几题」）。合并成一个会让格子与抽屉各自需要的形状互相将就。
   * ⚠️ 但**下界是同一个**（`snapshot.startedAt`）—— 两处若各用一个判据，屏幕上会出现
   * 「格子说已提交、抽屉说作答中」这种同一份数据的两种说法，而两边都不报错。
   */
  const [liveRows, setLiveRows] = useState<
    Record<string, Record<string, LiveRowPatch & { lastArrivedAt: number | null }>>
  >({});
  /**
   * 当前这份快照里有哪几份学习单 —— 下面那个 60 秒的题目树节拍要用它。
   *
   * ⚠️ 走 ref 而不是进 effect 的依赖：进依赖的话每次快照到达都会把那个定时器
   * **清掉重建**（30 秒一次），于是 60 秒的节拍实际上被重置成「每次快照之后 60 秒」，
   * 而它与快照的节拍不同频、会漂。用 ref 读「此刻是哪几份」，定时器本身只建一次。
   */
  const worksheetIdsRef = useRef<string[]>([]);
  useEffect(() => {
    worksheetIdsRef.current = snapshot ? snapshot.board.worksheets.map((worksheet) => worksheet.id) : [];
  }, [snapshot]);

  /** 拉「课堂里在用的那几份学习单」的题目树**与 settings**。 */
  const loadNodes = useCallback(async (worksheetIds: string[]) => {
    if (worksheetIds.length === 0) return;
    const loaded = await Promise.all(worksheetIds.map(async (worksheetId) => {
      try {
        const detail = await api.getWorksheet(worksheetId);
        return [worksheetId, detail.content.nodes, detail.settings] as const;
      } catch {
        return null;   // 拉不到就**保留已有的那一份**（见文件头那条规矩）
      }
    }));
    setNodesByWorksheet((prev) => {
      const next = { ...prev };
      for (const entry of loaded) { if (entry) next[entry[0]] = entry[1]; }
      return next;
    });
    setSettingsByWorksheet((prev) => {
      const next = { ...prev };
      for (const entry of loaded) { if (entry) next[entry[0]] = entry[2]; }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    if (!classroomId) return;
    // ⚠️ 先记时刻**再**发请求（「发起」而不是「回来」）—— 这样任何**早于**它的广播，
    // 其对应的那次写库一定在服务端读这个快照之前，下界才是安全的那一侧。
    const startedAt = Date.now();
    setLoading(true);
    void (async () => {
      try {
        const board = await api.getWorksheetBoard(classroomId);
        setSnapshot({ board, startedAt, fetchedAt: Date.now() });
        // 顺带把题目树与 settings 补齐：抽屉的题号 / 题型 / 奖励换算全靠它们，
        // 而它们可能与首屏那次不同（教师课上加题，规格 §3-J 只警告不拦）。
        void loadNodes(board.worksheets.map((worksheet) => worksheet.id));
      } catch {
        // 状态由 `board === null` + `loading === false` 表达，抽屉里那一段文案负责说。
        // ⚠️ 失败时**不动** snapshot（保留上一次的），见文件头。
      } finally {
        setLoading(false);
      }
    })();
  }, [classroomId, loadNodes]);

  // 首屏 + 常开轮询。⚠️ 这是第 1 条的修法本体：格子没有别的办法知道
  // 「在自己打开之前发生过什么」。矩阵原来那一条「只在开着时轮询」的规矩随之作废 ——
  // 它当时成立的前提是「只有矩阵在用这份数据」。
  useEffect(() => {
    if (!classroomId) return;
    refresh();
    const timer = window.setInterval(() => {
      // ⚠️ 页面不可见时跳过这一拍：教师切到别的标签页去了，拉回来也没人看。
      // （不是「停止轮询」—— 切回来之后下一次 interval 会自然恢复，不需要额外的监听。）
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refresh();
    }, BOARD_SNAPSHOT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [classroomId, refresh]);

  // 题目树的独立节拍（60 秒）。
  useEffect(() => {
    if (!classroomId) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadNodes(worksheetIdsRef.current);
    }, BOARD_NODES_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [classroomId, loadNodes]);

  // 广播增量。房间是 `teacher:<id>`，只在**落库成功之后**由服务端发出。
  useEffect(() => {
    if (!classroomId) return;
    return on('worksheet-answer-updated', (data) => {
      const { classroomId: from, participantId, questionId, status } = data ?? {};
      // ⚠️ 判 `classroomId` 而不是只信房间：`join-teacher-board` 会先离开上一个课堂的房间
      // 再进新的，比对一下是零成本的第二道闸（防「切换课堂时混进上一个课堂的进度」这类
      // 不报错的串台）。
      if (from !== classroomId) return;
      if (typeof participantId !== 'string' || !participantId) return;
      if (typeof questionId !== 'string' || !questionId) return;
      // 线缆上的 `status` 是自由字符串。认不出的值**整条丢掉**：存进去会让格子对这一题
      // 画不出颜色（既不是未答、也不是在答、也不是已交）。
      if (status !== 'draft' && status !== 'submitted') return;
      const at = Date.now();
      setLive((prev) => {
        const current = prev[participantId];
        return {
          ...prev,
          [participantId]: {
            cells: { ...(current?.cells ?? {}), [questionId]: status },
            lastQuestionId: questionId,
            lastAt: at,
          },
        };
      });
      // ★ 乙档 / 丙档：内容与作答过程（抽屉那一侧读它）。
      // ⚠️ `valueOmitted` 的处置在 `applyLiveRows` 里（它**不许**覆盖快照里已有的内容）——
      // 这里只负责把广播原样收下来，一条判断都不做。
      setLiveRows((prev) => ({
        ...prev,
        [participantId]: {
          ...(prev[participantId] ?? {}),
          [questionId]: {
            status,
            value: data.value,
            valueOmitted: data.valueOmitted === true,
            savedAt: typeof data.savedAt === 'string' ? data.savedAt : null,
            saveCount: typeof data.saveCount === 'number' ? data.saveCount : null,
            lastArrivedAt: at,
          },
        },
      }));
    });
  }, [classroomId, on]);

  /** 快照那一份的进度（跨时钟换算在这里做一次，见 `restProgress`）。 */
  const rest = useMemo(
    () => (snapshot ? restProgress(snapshot.board, snapshot.fetchedAt) : {}),
    [snapshot],
  );
  const progress = useMemo(
    () => (snapshot ? mergeProgress(rest, live, snapshot.startedAt) : {}),
    [snapshot, rest, live],
  );

  const markReviewed = useCallback((
    worksheetId: string, participantId: string, questionId: string, reviewedAt: string | null,
  ) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        board: {
          ...prev.board,
          worksheets: prev.board.worksheets.map((worksheet) => worksheet.id !== worksheetId ? worksheet : {
            ...worksheet,
            participants: worksheet.participants.map((participant) => participant.participantId !== participantId ? participant : {
              ...participant,
              answerRows: participant.answerRows.map((row) => row.questionId !== questionId ? row : { ...row, reviewedAt }),
            }),
          }),
        },
      };
    });
  }, []);

  /**
   * ★ 抽屉读的那一份 = 快照 **+ 逐行的广播补丁**。
   * ⚠️ 与 `progress` 走的是两条路（那条按参与者整份覆盖），但**下界同一个** ——
   * 见 `liveRows` 的注释。
   */
  const boardWithLive = useMemo(
    () => (snapshot ? applyLiveRows(snapshot.board, liveRows, snapshot.startedAt) : null),
    [snapshot, liveRows],
  );

  return {
    board: boardWithLive,
    loading,
    // ⚠️ 一次都没拉到过时下界是 0：那意味着**所有**广播都被采信（`lastAt > 0` 恒真）。
    // 这是保守的一侧 —— 没有快照可比时，广播是唯一的真相来源，不该把它丢掉。
    snapshotAt: snapshot?.startedAt ?? 0,
    nodesByWorksheet,
    settingsByWorksheet,
    progress,
    refresh,
    markReviewed,
  };
}
