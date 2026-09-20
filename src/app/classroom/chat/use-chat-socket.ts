import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import { api, setStudentSessionToken } from '@/lib/api';
import { applyModuleState, isClassroomModuleKey, isClassroomModuleState } from '@/lib/classroom-modules';
import type { ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
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
  setSelectedStudent: Dispatch<SetStateAction<ClassroomStudentSummary | null>>;
  setShieldWarning: Dispatch<SetStateAction<string | null>>;
  setStep: Dispatch<SetStateAction<'loading' | 'identity' | 'chat'>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setTeacherMsgs: Dispatch<SetStateAction<{ message: string; time: string }[]>>;
  setTeacherNotifBubble: Dispatch<SetStateAction<string | null>>;
  setThinkingContent: Dispatch<SetStateAction<string>>;
  setToast: Dispatch<SetStateAction<{ msg: string; type: 'success' | 'error' | 'info' } | null>>;
  setWaitingAI: Dispatch<SetStateAction<boolean>>;
}

export function useChatSocket(options: ChatSocketOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

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
        localStorage.removeItem(`chat_session_${joinCode}`);
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
        localStorage.removeItem(`chat_session_${optionsRef.current.code}`);
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

      socket.on('identity-conflict', (data: SocketErrorEvent) => {
        optionsRef.current.setMessages(prev => [...prev, { role: 'system', content: '⚠️ ' + data.error }]);
        optionsRef.current.setWaitingAI(false);
        optionsRef.current.setConnected(false);
        // 断开后清除会话，回到身份选择页
        localStorage.removeItem(`chat_session_${optionsRef.current.code}`);
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
          optionsRef.current.setToast({ msg: '🎉 老师奖励了你一次更换头像的机会！点击姓名旁的⭐即可更换', type: 'success' });
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


      socket.on('allow-stop-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowStudentStop: data.allow } : prev);
      });

      socket.on('allow-export-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowStudentExport: data.allow } : prev);
      });

      socket.on('follow-ups-changed', (data: PermissionEvent) => {
        optionsRef.current.setClassroom((prev) => prev ? { ...prev, allowFollowUps: data.allow } : prev);
      });

      // 教师端改模块三态后，服务端向 classroom:<id> 与 teacher:<id> 双发。
      // 这条订阅是学生端的实时路径；兜底是上面 connect 回调里的补读（覆盖连接成立前的空窗
      // 与断线期间）。面板那条 15 秒轮询（chat-panel.tsx 的 poll）读的是 status / agents /
      // paused，拿到 cr 后不调用 setClassroom，不参与三态。设计 §4.4 要求实时，这条不能省。
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
