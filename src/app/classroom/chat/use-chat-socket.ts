import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import { api, setStudentSessionToken } from '@/lib/api';
import { applyModuleState, isClassroomModuleKey, isClassroomModuleState } from '@/lib/classroom-modules';
import type { ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
// ★ 2026-09-30：「逐题开放」那条广播的载荷要收干净（判据在那个文件里，有用例）。
import { normalizeOpenQuestions } from '@/lib/worksheet-answer-mode';
import { publishWorksheetClear, subscribeDraftPreview } from '../worksheet/worksheet-socket-bus';
// 线缆上的类型住在 socket-events（与 ServerToClientEvents 的声明同处），不从
// classroom-types 转一手 —— 那边只是**消费**它。
import type { WebappDemand } from '@/lib/socket-events';
import type {
  AiResponseEvent, AvatarRewardEvent, ModuleStateEvent, PermissionEvent, ShieldWarnEvent,
  SocketErrorEvent, SocketTextEvent, StudentChatMessage, StudentIdEvent,
  TeacherNotificationEvent,
} from '../classroom-types';

interface ChatSocketOptions {
  // 组件内读取的值
  code: string;
  router: { push: (href: string) => void };
  SOCKET_URL: string;
  // 组件内声明的 ref（同一批 ref 在 page.tsx 的其它逻辑里仍在用，因此由外部传入）
  wsRef: { current: Socket | null };
  sendingRef: { current: boolean };
  chatConnectionGenerationRef: { current: number };
  identityConflictTimerRef: { current: number | null };
  teacherNotifTimerRef: { current: number | null };
  streamingBufferRef: { current: string };
  streamingRafRef: { current: number | null };
  seenNotifIdsRef: { current: Set<string> };
  // 状态写入
  setAgentDisabled: Dispatch<SetStateAction<boolean>>;
  setAvatarTokenCount: Dispatch<SetStateAction<number>>;
  setBlacklisted: Dispatch<SetStateAction<boolean>>;
  setClassroom: Dispatch<SetStateAction<StudentClassroom | null>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<StudentChatMessage[]>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  /**
   * ★ M5a：课堂级「锁定作答」。与 `setPaused` 同一类 —— 专门 state + socket 事件，
   * 不依赖那个 15 秒才刷新一次的快照对象（锁定要**立刻**生效）。
   */
  setAnswersLocked: Dispatch<SetStateAction<boolean>>;
  /**
   * ★ 2026-09-30：教师「逐题开放」的清单变了（按学习单分键）。
   *
   * ⚠️ 与 `setAnswersLocked`（一个布尔）不同，这个要**记住是哪一份单** ——
   * 高级模式下各组拿的是不同的单，写错键会让另一组的卷子跟着变。
   * 判据（收干净 id 列表）在 `@/lib/worksheet-answer-mode` 的 `normalizeOpenQuestions`，
   * 这里只把它搬进 state（**一个 setState、一处判据**）。
   */
  setWorksheetOpen: Dispatch<SetStateAction<Record<string, string[]>>>;
  setSelectedStudent: Dispatch<SetStateAction<ClassroomStudentSummary | null>>;
  setShieldWarning: Dispatch<SetStateAction<string | null>>;
  setStep: Dispatch<SetStateAction<'loading' | 'identity' | 'home' | 'shell'>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setTeacherMsgs: Dispatch<SetStateAction<{ message: string; time: string }[]>>;
  setTeacherNotifBubble: Dispatch<SetStateAction<string | null>>;
  setThinkingContent: Dispatch<SetStateAction<string>>;
  setToast: Dispatch<SetStateAction<{ msg: string; type: 'success' | 'error' | 'info' } | null>>;
  setWaitingAI: Dispatch<SetStateAction<boolean>>;
  /**
   * 探究空间按需推流：本课堂此刻有没有教师在看探究空间视图（P2）。
   *
   * 归会话层而不是面板：初值只在 `join-classroom` 成功后下发一次，而面板是惰性挂载的
   * （见上面那条订阅的注释）。会话级的布尔量，与 `paused` / `agentDisabled` 同一类。
   */
  setWebappDemand: Dispatch<SetStateAction<WebappDemand>>;
}

export function useChatSocket(options: ChatSocketOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  /**
   * ★ 2026-09-28：把「他此刻正在写什么」转发到服务端（**不写库**）。
   *
   * 🔴 **必须从这里发**：这条连接是学生端唯一带着**会话身份**的那一条
   *（服务端要拿 `socket.data.classroomId` 核身份才敢往教师房间转发）。
   * 学习单那一侧只往总线上 publish —— 它自己开一条 socket 会新开一条**没有身份**的连接
   *（而且服务端对同一学生只保留一条连接，另开一条会把聊天这条踢断）。
   *
   * ⚠️ 读的是 `optionsRef.current.wsRef.current`（**发的那一刻**才读）：
   * 连接会被重建（换身份 / 重连），闭包里抓着旧的那条就再也发不出去了。
   */
  useEffect(() => subscribeDraftPreview((preview) => {
    optionsRef.current.wsRef.current?.emit('worksheet-draft-preview', preview);
  }), []);

  const startChatSession = async (studentId: string, studentName: string, classroomCode?: string, token?: string) => {
    const joinCode = classroomCode || optionsRef.current.code;
    try {
      if (optionsRef.current.wsRef.current) optionsRef.current.wsRef.current.disconnect();
      const generation = ++optionsRef.current.chatConnectionGenerationRef.current;
      const { io } = await import('socket.io-client');
      if (generation !== optionsRef.current.chatConnectionGenerationRef.current) return;
      const socket = io(optionsRef.current.SOCKET_URL, { transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        socket.emit('join-classroom', { classroomCode: joinCode, studentId, token });
        optionsRef.current.setConnected(true);
        // 三态补读：广播只在连接存活时能收到，而这个连接成立前有两条空窗 ——
        // 学生停在身份选择页时（外壳的 loadClassroom 只跑一次，identity 确认不重读课堂），
        // 以及断线期间（服务端重连后回的 joined 不带三态，别处也没有监听它的补写逻辑）。
        // 只合并 modules：整对象覆盖会让一次陈旧读取复活 status / allowStudentStop 等字段。
        // 代际守卫查两次（发起前与落盘前），否则死连接的迟到响应会写进新会话。
        if (generation !== optionsRef.current.chatConnectionGenerationRef.current) return;
        api.getClassroomByCode(joinCode)
          .then((cr) => {
            if (generation !== optionsRef.current.chatConnectionGenerationRef.current) return;
            optionsRef.current.setClassroom((prev) => prev ? { ...prev, modules: cr.modules } : prev);
          })
          .catch(() => { /* 尽力而为的补读：socket 自有错误出口，这里不打扰学生 */ });
      });

      const flushStreaming = () => {
        if (optionsRef.current.streamingRafRef.current) { cancelAnimationFrame(optionsRef.current.streamingRafRef.current); optionsRef.current.streamingRafRef.current = null; }
        optionsRef.current.streamingBufferRef.current = '';
      };

      socket.on('ai-response', (data: AiResponseEvent) => {
        optionsRef.current.sendingRef.current = false;
        flushStreaming();
        optionsRef.current.setThinkingContent('');
        // 清除上一条 AI 回答的追问建议，只保留最新一条
        optionsRef.current.setMessages(prev => {
          const cleaned = prev.map(m => m.role === 'assistant' ? { ...m, followUps: undefined } : m);
          return [...cleaned, {
            role: 'assistant',
            content: data.content,
            roundIndex: data.roundIndex,
            id: data.messageId,
            followUps: data.followUps,
          }];
        });
        optionsRef.current.setStreamingContent('');
        optionsRef.current.setWaitingAI(false);
      });

      socket.on('ai-thinking', () => {
        flushStreaming();
        optionsRef.current.setWaitingAI(true);
        optionsRef.current.setStreamingContent('');
        optionsRef.current.setThinkingContent('');
      });

      socket.on('ai-chunk', (data: SocketTextEvent) => {
        optionsRef.current.streamingBufferRef.current += data.content;
        if (!optionsRef.current.streamingRafRef.current) {
          optionsRef.current.streamingRafRef.current = requestAnimationFrame(() => {
            optionsRef.current.streamingRafRef.current = null;
            optionsRef.current.setStreamingContent(optionsRef.current.streamingBufferRef.current);
          });
        }
      });

      socket.on('ai-thinking-content', (data: SocketTextEvent) => {
        optionsRef.current.setThinkingContent(prev => prev + data.content);
      });

      socket.on('ai-error', (data: SocketErrorEvent) => {
        optionsRef.current.sendingRef.current = false;
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setThinkingContent('');
        optionsRef.current.setConnectionError(data.error || 'AI 回复遇到了问题，请稍后重试');
      });

      socket.on('student-auth-error', (data: SocketErrorEvent) => {
        optionsRef.current.sendingRef.current = false;
        setStudentSessionToken();
        try { localStorage.removeItem(`chat_session_${joinCode}`); } catch {}
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setConnectionError(data.error || '学生会话已失效，请重新选择身份');
        socket.disconnect();
        optionsRef.current.setSelectedStudent(null);
        optionsRef.current.setMessages([]);
        optionsRef.current.setStep('identity');
      });

      socket.on('agent-disabled', () => {
        optionsRef.current.sendingRef.current = false;
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setAgentDisabled(true);
      });

      socket.on('agent-enabled', () => {
        optionsRef.current.setAgentDisabled(false);
      });

      socket.on('classroom-ended', () => {
        try { localStorage.removeItem(`chat_session_${optionsRef.current.code}`); } catch {}
        optionsRef.current.setToast({ msg: '课堂已结束', type: 'info' });
        optionsRef.current.router.push('/');
      });

      socket.on('classroom-paused', () => {
        optionsRef.current.sendingRef.current = false;
        if (optionsRef.current.streamingRafRef.current) { cancelAnimationFrame(optionsRef.current.streamingRafRef.current); optionsRef.current.streamingRafRef.current = null; }
        optionsRef.current.streamingBufferRef.current = '';
        optionsRef.current.setPaused(true);
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setStreamingContent('');
        optionsRef.current.setThinkingContent('');
      });

      socket.on('classroom-resumed', () => {
        optionsRef.current.setPaused(false);
      });

      // ★ M5a：锁定/解锁作答。与 `classroom-paused` 不同，这里**不做**流式收尾 ——
      // 锁定管的是学习单的作答（另一个模块），与学伴的流没有关系。
      socket.on('answers-locked', () => {
        optionsRef.current.setAnswersLocked(true);
      });

      socket.on('answers-unlocked', () => {
        optionsRef.current.setAnswersLocked(false);
      });

      // ★ 2026-09-30：教师在**看板**上逐题开放。载荷带状态本身（见 `socket-events.ts`
      // 那一条的注释：它是**列表**，不能用 15 秒前的快照兜底）。
      // ⚠️ 只**并进**那一份单的键，别的单原样保留 —— 高级模式下别组的进度不许被抹掉。
      socket.on('worksheet-open-changed', (data) => {
        const worksheetId = typeof data?.worksheetId === 'string' ? data.worksheetId : '';
        if (!worksheetId) return;   // 认不出的载荷 ⇒ 一个字都不动（宁可不动也不写错键）
        const questionIds = normalizeOpenQuestions(data?.questionIds);
        optionsRef.current.setWorksheetOpen((previous) => ({ ...previous, [worksheetId]: questionIds }));
      });

      // ★ 2026-09-28（教师第 4 条）：教师在**看板**上清除了这名学生在这份学习单上的作答。
      //
      // 🔴 **这个订阅必须挂在这里，不能挂进学习单面板** —— 现在这条连接是唯一进得了
      // `student:<id>` 房间的那一条（`join-classroom` 只在本文件发）。面板自己订阅的话：
      //   · 用 `@/lib/socket` 的 `useSocket()` ⇒ 那是**教师端**的单例，学生这边用它会新开
      //     一条从没 join 过的连接，广播永远收不到，而**两边都不报错**（实测栽过）；
      //   · 自己再开一条并 join ⇒ 服务端对同一学生只保留一条连接，会**把聊天这条踢断**。
      //
      // 🔴 **发到总线上，不写 React state。** 第一版写成了会话层 state（→ 外壳 → 面板），
      // 而那条链上每一次投递都要让整棵会话树重渲染一遍；教师报「学生在输入时清除该题
      // ⇒ 学生端浏览器假死」，而我在那条链上读了三遍都没读出回路。命令（边沿触发）
      // 本来就该走总线而不是 state（电平触发）—— 见 `worksheet-clear-bus.ts` 那一段。
      socket.on('worksheet-answers-cleared', (data) => {
        publishWorksheetClear(data);
      });

      socket.on('ai-busy', (data: SocketErrorEvent & { keepWaiting?: boolean }) => {
        if (!data.keepWaiting) { optionsRef.current.sendingRef.current = false; optionsRef.current.setWaitingAI(false); }
        optionsRef.current.setToast({ msg: data.error || '上一条回答尚未结束', type: 'error' });
      });
      socket.on('identity-conflict', (data: SocketErrorEvent) => {
        setStudentSessionToken();
        optionsRef.current.setMessages(prev => [...prev, { role: 'system', content: '⚠️ ' + data.error }]);
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setConnected(false);
        // 断开后清除会话，回到身份选择页
        try { localStorage.removeItem(`chat_session_${optionsRef.current.code}`); } catch {}
        if (optionsRef.current.identityConflictTimerRef.current) window.clearTimeout(optionsRef.current.identityConflictTimerRef.current);
        optionsRef.current.identityConflictTimerRef.current = window.setTimeout(() => {
          if (generation !== optionsRef.current.chatConnectionGenerationRef.current) return;
          if (optionsRef.current.wsRef.current) optionsRef.current.wsRef.current.disconnect();
          optionsRef.current.wsRef.current = null;
          optionsRef.current.setStep('identity');
          optionsRef.current.setSelectedStudent(null);
          optionsRef.current.setMessages([]);
        }, 2000);
      });

      socket.on('disconnect', () => { optionsRef.current.sendingRef.current = false; optionsRef.current.setWaitingAI(false); optionsRef.current.setConnected(false); });
      socket.on('connect_error', () => { optionsRef.current.sendingRef.current = false; optionsRef.current.setWaitingAI(false); optionsRef.current.setConnected(false); });

      socket.on('error', (err: string) => {
        optionsRef.current.sendingRef.current = false;
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setMessages(prev => [...prev, { role: 'system', content: '⚠️ ' + err }]);
      });

      socket.on('messages-cleared', (data: StudentIdEvent) => {
        if (data.studentId === studentId) {
          optionsRef.current.setMessages([]);
          optionsRef.current.setStreamingContent('');
          optionsRef.current.setWaitingAI(false);
        }
      });

      socket.on('avatar-rewarded', (data: AvatarRewardEvent) => {
        if (data?.tokens) {
          optionsRef.current.setAvatarTokenCount(data.tokens);
          // ⚠️ 入口指向**屏幕最上方那一行里你的头像**（外壳 `ModuleTabBar` 里的学生 chip）。
          // 措辞有两条硬要求，改一次就要重新对一遍：
          //   ① **入口要是当下真正可点的那一个**。M1b-3 T2 撤掉了面板头上那枚「⭐ N」角标与
          //      首页的换头像按钮，奖励到达的这一刻屏幕上**没有任何星形图标** —— 旧文案
          //      「点击姓名旁的⭐」会让拿到奖励的学生找不到入口。
          //   ② **必须排他**。「你的头像」这个说法不排他：同一屏的首页白卡里、紧挨学生姓名
          //      还有第二枚「你的头像」（70×70、比 chip 那枚 36px 圆更显眼，1280px 下同样
          //      成立），它是 `<span>` / `cursor: auto`，点下去**没有任何反应** —— 学生按字面
          //      去点它，得到的只是「没反应」。所以这里说的是**位置**（屏幕最上方那一行），
          //      屏幕上长得像头像的东西里只有那一行里的这枚在顶栏内。
          //
          // ⚠️ 「chip 是不是按钮」的开关**不是** `avatarTokenCount`：真实开关在
          // `module-tab-bar.tsx` 的 `changeable`（`selectedStudent?.studentId`）—— 真实学生
          // 参与者**永远**是可点的 `<button>`，小组参与者拿到不可点的 `<span>`（小组没有这项
          // 能力，服务端的 `avatarChangeTokens` 长在 `Student` 上）。上面的
          // `setAvatarTokenCount` 只决定**点下去之后**走哪个分支：tokens > 0 开弹窗，否则由
          // `handleChangeAvatar` 说一句「换头像的机会由老师奖励」。奖励到达时 tokens > 0，
          // 所以这句话说出口时点它一定开弹窗。
          optionsRef.current.setToast({ msg: '🎉 老师奖励了你一次更换头像的机会！点击屏幕最上方那一行里你的头像即可更换', type: 'success' });
        }
      });

      socket.on('teacher-notification', (data: TeacherNotificationEvent) => {
        // 通过唯一 ID 去重（Db 持久化后，防止缓存重放 / socket 重连产生的重复）
        if (data.id && optionsRef.current.seenNotifIdsRef.current.has(data.id)) return;
        if (data.id) optionsRef.current.seenNotifIdsRef.current.add(data.id);
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        optionsRef.current.setTeacherMsgs(prev => [...prev, { message: data.message, time: timeStr }]);
        optionsRef.current.setTeacherNotifBubble(data.message);
        if (optionsRef.current.teacherNotifTimerRef.current) window.clearTimeout(optionsRef.current.teacherNotifTimerRef.current);
        optionsRef.current.teacherNotifTimerRef.current = window.setTimeout(() => {
          if (generation === optionsRef.current.chatConnectionGenerationRef.current) optionsRef.current.setTeacherNotifBubble(null);
        }, 15000);
      });

      socket.on('shield-warned', (data: ShieldWarnEvent) => {
        // 🔴 **收回「等待 AI」闸门**（2026-10-09 审计 §B2）。服务端在这条路上**直接 `return`**
        //（`server/src/socket/index.ts` 的 `emit('shield-warned')` 之后），**根本不会调用 AI**
        // ⇒ 这一轮到此为止，不会再有任何事件来收这个闸门。
        // 不收的后果是一处**没有出口的死路**：输入框 `disabled`、发送键被 `waitingAI` 挡住、
        // 屏幕上那条「正在思考」永不消失；唯一可点的「停止生成」只在 `allowStudentStop !== false`
        // 时才渲染 ⇒ 关掉该开关的课堂上，学生连一条都再发不出去，只能刷新页面。
        // ⚠️ 另外十一个「这一轮到此为止」的处理器全都收了（名单与理由见
        //    `waiting-gate.test.ts`）—— 少这一条，正是它一直没被发现的原因。
        optionsRef.current.sendingRef.current = false;
        optionsRef.current.setWaitingAI(false);
        const name = data.studentName || '学生';
        optionsRef.current.setShieldWarning(`${name}同学你好，课堂交流请使用文明用语哦！请修改你的提问。`);
        // 将对话区域中上一条学生消息替换为过滤后的内容
        optionsRef.current.setMessages(prev => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'user') {
              next[i] = { ...next[i], content: data.filteredContent || next[i].content };
              break;
            }
          }
          return next;
        });
      });

      socket.on('student-blacklisted', (data: StudentIdEvent) => {
        if (data.studentId && data.studentId !== studentId) return;
        optionsRef.current.setBlacklisted(true);
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setStreamingContent('');
        optionsRef.current.setShieldWarning(null);
      });

      socket.on('student-unblacklisted', (data: StudentIdEvent) => {
        if (data.studentId && data.studentId !== studentId) return;
        optionsRef.current.setBlacklisted(false);
        optionsRef.current.setShieldWarning(null);
        // 移除自动黑屏消息
        optionsRef.current.setMessages(prev => prev.filter(m => !(m.role === 'system' && typeof m.content === 'string' && m.content.includes('自动黑屏'))));
      });


      socket.on('allow-ask-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowStudentAsk: data.allow } : prev);
      });

      socket.on('allow-stop-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowStudentStop: data.allow } : prev);
      });

      socket.on('allow-export-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowStudentExport: data.allow } : prev);
      });

      socket.on('follow-ups-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowFollowUps: data.allow } : prev);
      });

      // 探究空间按需推流（P2 / Ruling 9）：本课堂此刻有没有教师在看探究空间视图。
      //
      // ⚠️ **必须在这里订阅，不能等到探究空间面板挂载才订阅。** 服务端在
      // `join-classroom` 成功后**立刻**发一次（那是学生端唯一的初值来源），而面板是
      // **惰性挂载**的（学生切到探究空间才挂，§4.8 的内存门槛）—— 学生从进课堂到点开
      // 探究空间之间隔着任意长的时间，那时这条消息早就过去了，而 socket.io 的事件不会
      // 为「当时没有监听者」留档。后果是**完全无声**的：面板一直以为没人看 ⇒ 学生端在
      // 源头就不推 ⇒ 教师图墙一直空着，两边都不报错。
      // （T5 在服务端专门补了这条 join 时的下发，就是为了「教师先开看板、学生后进课堂」
      //   这个顺序 —— 客户端这一半必须同样按「会话一建立就收」来做，否则那个修补白做。）
      //
      // 载荷**只有** `watching` 一个字段（T5 定死的契约）：截图降频的档位不在这里，
      // 耗时是学生设备自己测的，档位由 SDK 自己升降。
      socket.on('webapp-monitor-demand', (data: {
        watching?: unknown; detail?: unknown;
        captureEnabled?: unknown; width?: unknown; frameIntervalMs?: unknown;
      } | null) => {
        const watching = data?.watching;
        const detail = data?.detail;
        // 字段逐个过类型守卫（载荷是线缆上的值，null/undefined 都会走到这里）。
        // ⚠️ `detail` 再与 `watching` 取一次「与」：服务端已经保证不会发出
        // 「没人在看但你在高频」的组合，这里**再挡一次**是因为那个组合的代价不对称 ——
        // 它会让学生的老 iPad 无端按 2 秒一帧烧自己，而没有任何界面对得上。
        if (typeof watching !== 'boolean') return;

        // ⚠️ 下面三个的兜底方向必须与 SDK 一致：**认不出就用默认，绝不能让"认不出"
        //    变成"关掉"** —— 那会让所有课堂静默地停止截图，且没有任何报错。
        //    服务端已经归一化过一遍，这里只为「老服务端 / 半截载荷」兜底。
        const captureEnabled = data?.captureEnabled;
        const width = Number(data?.width);
        const frameIntervalMs = Number(data?.frameIntervalMs);

        optionsRef.current.setWebappDemand({
          watching,
          detail: watching && detail === true,
          captureEnabled: captureEnabled !== false,
          width: Number.isFinite(width) && width > 0 ? width : 320,
          frameIntervalMs: Number.isFinite(frameIntervalMs) && frameIntervalMs > 0 ? frameIntervalMs : 10_000,
        });
      });

      // 教师端改模块三态后，服务端向 classroom:<id> 与 teacher:<id> 双发。
      // 这条订阅是学生端的实时路径；兜底有两条，都在别处：
      //   1. 上面 connect 回调里的补读 —— 覆盖「连接成立前」与「断线期间」两个空窗；
      //   2. `use-classroom-session.ts` 的 15 秒轮询 —— M1b-2 Task 6 起它把 `cr.modules`
      //      合并回来，覆盖「连接存活期间漏掉一次广播」（此前这条轮询拿到了 modules
      //      却丢掉，是该窗口唯一的缺口）。两条兜底都只合并 modules。
      // 设计 §4.4 要求实时，这条不能省。
      // 载荷是线缆上的值，先过类型守卫 —— 连 null / undefined 都会走到这里，所以不能直接解构。
      socket.on('module-state-changed', (data: ModuleStateEvent) => {
        const { moduleKey, state } = data ?? {};
        if (!isClassroomModuleKey(moduleKey) || !isClassroomModuleState(state)) return;
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, modules: applyModuleState(prev.modules, moduleKey, state) } : prev);
      });

      optionsRef.current.wsRef.current = socket;
    } catch {
      optionsRef.current.setConnected(false);
    }
  };

  return { startChatSession };
}
