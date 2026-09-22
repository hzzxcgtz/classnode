'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/lib/socket';
import type { WebappPresenceUpdate } from '@/lib/socket-events';
import type { ClassroomCardStudent, ClassroomWebappSummary } from '@/lib/types';

/**
 * ⚠️ 这里曾经有一个**事件抽屉**：每个学生留最近 200 条操作事件（点击 / 输入 /
 * 滚动 / 跳转 / 前后台切换），格子上显示「点击 X · 输入 Y · 上报 Z」。
 * 那块**没有回来，也不该回来**（P2.2 用户裁定：点击 / 输入 / 跳转不记录）。
 *
 * P2.2 的 T5 只恢复了**文字档**：`visibility` 与 `scroll` 两项，由服务端收成
 * **每个学生每个网页一条当前状态**（`webapp-student-presence`），不是流水账。
 * 于是这里显示的是「这个学生现在有没有在用」——「已打开 / 已切走」「滚到 N%」，
 * 而不是一列事件。
 */
export interface StudentMonitorState {
  dataUrl: string | null;
  /** 最新一帧的**服务端**时刻（`webapp-student-frame` 的 `at`）。 */
  at: number;
  webappId: string;
  /** 收到的帧**总数**（本地的「第几次」，与服务端记的 frameCount 是两回事）。 */
  frameCount: number;
  /** 文字档的当前状态（`webapp-student-presence`）。`null` = 这个学生一个字都没报过。 */
  presence: WebappPresenceUpdate | null;
  /**
   * 学生**设备**上已经放弃采集（`webapp-student-capture-blocked`）。
   *
   * 🔴 与「等待画面…」是两件事：那句说的是「第一帧还在路上」（会自愈），
   * 这句说的是「SDK 试过、失败了、并退避了」（不会自愈）。实测来源见契约里的注释。
   */
  captureBlocked: boolean;
}

function emptyState(webappId: string): StudentMonitorState {
  return { dataUrl: null, at: 0, webappId, frameCount: 0, presence: null, captureBlocked: false };
}

export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * 没有画面时那一格显示什么。
 *
 * ⚠️ **「已打开」与「等待画面…」必须是两句不同的话** —— 它们说的是两件不同的事：
 *   · 已打开    —— 收到了文字档，这个学生**确实**开着这个网页（画面关掉时只有它给得出）；
 *   · 等待画面… —— 一个信号都没收到，而本课堂**开着画面**：多半是第一帧还在路上
 *                  （学生端首帧有 0~3 秒抖动），也可能这个学生还没打开网页；
 *   · 未打开    —— 一个信号都没收到，而本课堂**关掉了画面**：永远不会有帧，
 *                  而文字档也没来过 ⇒ 说得出口的只有「没打开」。
 * 这三句以前是同一句 `online ? '等待画面…' : '未在线'`，于是「关掉画面的课堂上
 * 学生正开着网页」和「学生根本没打开」在图墙上一模一样 —— 这个功能要解决的正是它。
 */
export function tileCaption(
  online: boolean,
  captureEnabled: boolean,
  presence: WebappPresenceUpdate | null,
  captureBlocked = false,
): { label: string; detail: string } {
  if (presence) {
    return {
      label: presence.visible ? '已打开' : '已切走',
      // depth 为 0 时不说「滚到 0%」：0 既可能是没滚，也可能只是没报过 —— 两种都不值得显示。
      detail: presence.visible && presence.depth > 0 ? `滚到 ${presence.depth}%` : '',
    };
  }
  if (!online) return { label: '未在线', detail: '' };
  // ⚠️ 这两句的**顺序**是有意的：先判「设备拍不出来」再判「等待画面…」。
  // 反过来的话，一句说「第一帧还在路上」会盖住「这台设备根本拍不出来」这个事实 ——
  // 而那正是这两句话要分开的理由。见 captureBlocked 的注释与契约里的实测来源。
  if (captureBlocked) return { label: '拍不出画面', detail: '设备不支持，文字档仍在' };
  return { label: captureEnabled ? '等待画面…' : '未打开', detail: '' };
}

/**
 * 探究助手的**实时订阅**（P2.2 的 T7；P2.3 看板合成时从 `webapp-monitor-view.tsx`
 * 原样搬到这里）。
 *
 * 🔴 **全看板只有这一份订阅。** 搬出来的理由不是「好看」：看板合成之后每个学生的格子
 * 都要显示他自己的那一份画面/文字档，而一份订阅 if 塞进格子里就是 **N 个格子 N 份订阅、
 * N 次 watch/unwatch** —— 订阅数一多，服务端按需推流的闸门（Ruling 9）就被搅乱了，
 * 而且每次重渲染都可能重新配对一次 watch/unwatch。
 * ⇒ 因此这个 hook 在 `page.tsx` 里**只调用一次**，每格从它返回的 state 里取自己那一条。
 *
 * 三条不变量：
 *   1. **调用一次即订阅、卸载即退订**。退订（`unwatch-webapp-monitor`）不是可选项：
 *      少了它服务端的 `hasWatchers` 恒为真 ⇒ **学生端永不停止推流**，
 *      Ruling 9 的按需推流整个白做（后果是学生的老 iPad 一直在截图上传，而没人在看）。
 *   2. **房间名由 T5 定死**（`teacher:<classroomId>:webapp`），服务端在收到
 *      `watch-webapp-monitor` 时自己 join —— 客户端**没有** join 房间这个动作，
 *      Socket.IO 的房间里没有客户端侧的 join。所以这里只发事件。
 *   3. **只认本课堂名册上的学生**：`webapp-student-frame` 的载荷里没有 classroomId
 *      （契约如此），房间就是归属判据。但教师从课堂 X 切到 Y 时两条 effect 会在同一
 *      tick 里交替，万一有一帧漏进来，按 studentId 建格会凭空多出一块图墙格子 ——
 *      所以名册之外的直接丢掉。
 */
export function useWebappMonitor({ classroomId, roster, webapps, focusStudentId, needsExploreFrames }: {
  classroomId: string;
  /** 本课堂**名册**（`classroom.students`）：只用来丢掉名册外的帧，不驱动渲染。 */
  roster: readonly ClassroomCardStudent[];
  /**
   * 只用于首帧的兜底 webappId（学生还没上报过任何网页时，格子的 `webappId` 该是什么）。
   *
   * ⚠️ 不进订阅 effect 的依赖：它变化时重挂会多一对 watch/unwatch，而重挂期间的那几帧会丢。
   */
  webapps: readonly ClassroomWebappSummary[];
  /**
   * 教师**点开**了哪个学生的探究详情（`null` = 没点开）。
   *
   * ⚠️ 这是**服务端自己的状态**，不跟着客户端卸载消失：`null` 那一次必须真的发出去，
   * 否则教师切到别处再切回来时，那个学生会莫名一直在 2 秒一帧烧自己的设备
   * —— 而教师根本没点开他，两边都不报错。
   */
  focusStudentId: string | null;
  /**
   * 看板此刻**需不需要**探究助手的实时数据。
   *
   * ⚠️ **这是成本闸门，不是优化。** 一旦 watch，服务端就认为「有教师在监控」，
   * 全班学生立刻按档位开始**截图推流** —— 那是老 iPad 上最贵的一件事（实测 55~68ms/帧）。
   * 而看板合成之后，教师**打开看板**就会走到这里，哪怕一格都不会显示探究内容。
   *
   * 判据：**跟随模式**下每一格都可能是探究助手 ⇒ 要；**指定模式**下只有指定的正是
   * 探究助手时 ⇒ 才要。少了这条，一个「指定看智能学伴」的课堂会让 40 台设备
   * 白白每 10 秒光栅化一次整页，而屏幕上根本没有一处用到那些图。
   */
  needsExploreFrames: boolean;
}): Record<string, StudentMonitorState> {
  const { on, emit } = useSocket();
  const [states, setStates] = useState<Record<string, StudentMonitorState>>({});
  /**
   * 名册的 ref 镜像：下面那两个订阅回调**不是**每次渲染重建的（重建会在切换途中漏事件），
   * 所以它们读到的必须是当下名册，经 ref 读而不是经闭包。
   */
  const rosterRef = useRef<Set<string>>(new Set());
  useEffect(() => { rosterRef.current = new Set(roster.map(s => s.id)); }, [roster]);

  useEffect(() => {
    if (!classroomId) return;
    // ⚠️ 不需要画面时**不下发 watch** —— 那一步就是「让全班开始截图」的开关。
    if (!needsExploreFrames) return;
    const firstWebappId = webapps[0]?.id ?? '';
    emit('watch-webapp-monitor', { classroomId });

    const merge = (studentId: string, patch: (prev: StudentMonitorState) => StudentMonitorState) => {
      setStates(prev => {
        const current = prev[studentId] ?? emptyState(firstWebappId);
        return { ...prev, [studentId]: patch(current) };
      });
    };

    const unsubFrame = on('webapp-student-frame', data => {
      if (!rosterRef.current.has(data.studentId)) return;
      merge(data.studentId, prev => ({
        ...prev,
        dataUrl: data.dataUrl,
        at: data.at,
        webappId: data.webappId,
        frameCount: prev.frameCount + 1,
      }));
    });

    // 文字档：服务端把它收成了**当前状态**（不是事件流），所以这里就是覆盖式地存下来，
    // 不做任何累积 —— 累积会让「这个学生现在滚到哪」变成一个要遍历历史才能回答的问题。
    const unsubPresence = on('webapp-student-presence', data => {
      if (!rosterRef.current.has(data.studentId)) return;
      merge(data.studentId, prev => ({
        ...prev,
        webappId: data.webappId,
        presence: {
          studentId: data.studentId,
          webappId: data.webappId,
          visible: data.visible,
          depth: data.depth,
          at: data.at,
          switches: data.switches,
        },
      }));
    });

    const unsubCaptureBlocked = on('webapp-student-capture-blocked', data => {
      if (!rosterRef.current.has(data.studentId)) return;
      // 只置真、不置假：这台设备**这一节课**就是拍不出来了（SDK 已退避）。
      // 学生刷新页面后 SDK 会重来，但那是新的一轮 —— 那时他若成功，帧会到达，
      // 图墙自然就显示画面了（caption 只在没有帧时才用得上）。
      merge(data.studentId, prev => ({ ...prev, webappId: data.webappId, captureBlocked: true }));
    });

    return () => {
      // ⚠️ **先退订再解绑**（顺序无关，但退订必须真的发生）。这条 emit 是整个按需推流
      // 的「关闸」信号；漏掉它的表现是「学生端一直推，而教师已经走了」，全程无报错。
      emit('unwatch-webapp-monitor', { classroomId });
      unsubFrame?.();
      unsubPresence?.();
      unsubCaptureBlocked?.();
    };
    // `webapps` 只用于首帧的兜底 webappId，不进依赖（理由见上面的 prop 注释）。
    // ⚠️ `needsExploreFrames` **必须**在依赖里：它从 false 变 true 时要真的去 watch，
    //    变 false 时靠 cleanup 退订 —— 少了它，教师切到「指定 · 智能学伴」之后
    //    学生还在推流，而屏幕上已经一处都不用了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, needsExploreFrames, emit, on]);

  /**
   * 教师点开 / 关掉某个学生的详情 ⇒ 只让**那个学生**转高频截图（wall → detail）。
   *
   * ⚠️ **卸载时要发一次 `studentId: null`。** 详情面板是本地 React 状态，组件一卸载它
   * 自然就没了；但服务端那份 `focus` 是**它自己的**状态，不会跟着客户端的卸载消失。
   * 少了这个 cleanup，教师切到别处再切回来时，那个学生会莫名一直在 2 秒一帧烧自己的设备。
   *
   * （服务端在 unwatch / 课堂结束时也会清 focus，那是第二道保险：这条 cleanup 走的是
   *   「教师还订阅着、只是关了抽屉」这条更细的路径。）
   */
  useEffect(() => {
    if (!classroomId) return;
    emit('focus-webapp-student', { classroomId, studentId: focusStudentId });
    return () => { emit('focus-webapp-student', { classroomId, studentId: null }); };
  }, [classroomId, focusStudentId, emit]);

  return states;
}
