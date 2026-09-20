import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, setStudentSessionToken } from '@/lib/api';
import type { AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import { API_BASE_URL, fixSvgUrl } from './avatar-utils';
import type { ChatToast, StudentChatMessage, TeacherMessage } from './classroom-types';
import { useStudentSession } from './identity/use-student-session';
import { useChatSocket } from './chat/use-chat-socket';

export interface ClassroomSessionOptions {
  router: { push: (href: string) => void };
  // 下面这些 ref 由 page.tsx 创建，按对象身份同时交给外壳与面板（M0 Ruling 8）。
  // 任何一侧重新声明都会拿到另一个对象，静默破坏停止生成 / 发送闸门 / 卸载清理。
  wsRef: { current: Socket | null };
  statusSocketRef: { current: Socket | null };
  chatConnectionGenerationRef: { current: number };
  seenNotifIdsRef: { current: Set<string> };
  sendingRef: { current: boolean };
  identityConflictTimerRef: { current: number | null };
  teacherNotifTimerRef: { current: number | null };
  streamingBufferRef: { current: string };
  streamingRafRef: { current: number | null };
}

/**
 * 课堂会话外壳：step 状态机、身份选择所需的状态、以及全部加载/进入/退出逻辑。
 * M1a 之前这些都长在 chat-panel.tsx 里，面板同时承担了「学伴模块渲染」与「整页编排」两件事。
 */
export function useClassroomSession(options: ClassroomSessionOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const SOCKET_URL = API_BASE_URL;

  const [code, setCode] = useState('');
  // step 词表（§4.2）：loading → identity → home（常驻门户）→ shell（外壳，Task 5 建）。
  // 身份确认后落点是 **home** 而不是某个模块 —— 学生进入课堂先看到门户是三件套的前提。
  const [step, setStep] = useState<'loading' | 'identity' | 'home' | 'shell'>('loading');
  const [joiningClassroom, setJoiningClassroom] = useState(false);
  const [classroom, setClassroom] = useState<StudentClassroom | null>(null);
  const [students, setStudents] = useState<ClassroomStudentSummary[]>([]);
  const [avatarSvgs, setAvatarSvgs] = useState<Record<number, string>>({});
  const [avatarTokenCount, setAvatarTokenCount] = useState(0);
  const [allStudentAvatars, setAllStudentAvatars] = useState<AvatarSummary[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<ClassroomStudentSummary | null>(null);
  const [identitySearch, setIdentitySearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teacherMsgs, setTeacherMsgs] = useState<TeacherMessage[]>([]);
  const [onlineStudentIds, setOnlineStudentIds] = useState<Set<string>>(new Set());
  // 下面这些状态由面板渲染，但写入点在本文件的 loadClassroom / loadMessages /
  // handleIdentityConfirm / handleSwitchIdentity 里，其中挂载恢复路径上的写入发生在
  // 面板挂载之前（面板只在 step === 'shell' 时才渲染），所以所有者必须是外壳。
  const [messages, setMessages] = useState<StudentChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [waitingAI, setWaitingAI] = useState(false);
  const [paused, setPaused] = useState(false);
  const [agentDisabled, setAgentDisabled] = useState(false);
  const [shieldWarning, setShieldWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<ChatToast | null>(null);
  // 下面这批状态的写入点同样在 useChatSocket 的回调里。M1a Task 3 把该 hook 上移到本文件
  // 之前，它们住在面板里，靠「面板挂载/卸载」隐式重置；socket 归外壳后，面板在
  // step !== 'shell' 时会卸载（socket 仍在），所以所有者必须是外壳，否则 socket 回调写进
  // 卸载中的面板会被丢弃。面板重新挂载时的隐式重置，由 handleIdentityConfirm 显式补齐。
  const [connected, setConnected] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [teacherNotifBubble, setTeacherNotifBubble] = useState<string | null>(null);
  const [blacklisted, setBlacklisted] = useState(false);
  const joiningRef = useRef(false);

  async function loadClassroom(classroomCode?: string, sessionStudentId?: string) {
    try {
      setLoadError(null);
      const cr = await api.getClassroomByCode(classroomCode || code);
      setClassroom(cr);
      if (cr.status === 'paused') setPaused(true);
      // 如果是从缓存恢复会话，检查该学生/小组绑定的智能体是否停用
      if (sessionStudentId && (cr.mode === 'group' || cr.mode === 'advanced') && cr.groups) {
        // 需要先获取学生的 groupId
        try {
          const sts = await api.getClassroomStudents(cr.id);
          const myStudent = sts.find((student) => student.id === sessionStudentId);
          if (myStudent?.groupId) {
            const g = cr.groups.find((group) => group.id === myStudent.groupId);
            if (g?.agent?.enabled === false) setAgentDisabled(true);
          }
        } catch {}
      } else {
        if (cr.agents?.[0]?.enabled === false) setAgentDisabled(true);
      }
      return cr;
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : '课堂不存在或已结束');
    }
  }

  async function loadMessages(classroomId: string, studentId: string) {
    setLoadingMessages(true);
    try {
      const msgs = await api.getStudentMessages(classroomId, studentId);
      if (msgs && msgs.length > 0) {
        // 找到最后一个 AI 回答的索引，只有它保留追问建议
        let lastAssistantIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant') { lastAssistantIdx = i; break; }
        }
        setMessages(msgs.map((m, i: number) => ({
          role: m.role,
          content: m.content,
          roundIndex: m.roundIndex,
          id: m.id,
          fileUrls: m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : undefined,
          fileNames: m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : undefined,
          followUps: (i === lastAssistantIdx && m.followUps) ? (typeof m.followUps === 'string' ? JSON.parse(m.followUps) : m.followUps) : undefined,
        })));
      }
    } catch {} finally {
      setLoadingMessages(false);
    }
  }

  const fetchStudentTokens = async () => {
    if (!selectedStudent?.studentId) return;
    try {
      const result = await api.getStudentTokens(selectedStudent.id);
      setAvatarTokenCount(result.tokens || 0);
    } catch {}
  };

  const handleIdentityConfirm = async () => {
    if (!selectedStudent || joiningRef.current) return;
    joiningRef.current = true;
    setJoiningClassroom(true);
    let token: string;
    try {
      const session = await api.createStudentSession(code, selectedStudent.id);
      token = session.token;
      setStudentSessionToken(token);
    } catch (error: unknown) {
      setToast({ msg: error instanceof Error ? error.message : '无法进入课堂', type: 'error' });
      joiningRef.current = false;
      setJoiningClassroom(false);
      return;
    }
    // 会话级状态复位，与 setStep('home') 同批提交，保证面板首帧看到的就是复位值。
    // （Task 4 起落点是首页；面板要到学生点开学伴卡片才挂载，那之前这批值已经就位。）
    // 上移前面板每次挂载都会用 useState 的初始值重新初始化这批状态；上移后它们由外壳
    // 持有、不随面板挂载而重置，所以在这里显式补齐同样的语义 —— 否则「切换身份」后会
    // 残留上一位学生的黑屏蒙版 / 连接错误提示。
    setConnected(true);
    setConnectionError(null);
    setStreamingContent('');
    setThinkingContent('');
    setTeacherNotifBubble(null);
    setBlacklisted(false);
    // 落点是首页门户（§4.2）：学生自己从卡片里选今天要做什么，而不是被直接丢进某个模块。
    setStep('home');
    // 保存会话到 localStorage
    localStorage.setItem(`chat_session_${code}`, JSON.stringify({
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      token,
      timestamp: Date.now(),
    }));
    // 加载头像库（仅显示教师创建的供选择）+ 头像 SVG 映射（含学生自己的）
    api.getAvatars('student').then(data => { setAllStudentAvatars(data); }).catch(() => {});
    api.getAvatarsAll('student').then(data => { const m: Record<number, string> = {}; data.forEach((avatar) => { m[avatar.id] = fixSvgUrl(avatar.svgContent); }); setAvatarSvgs(m); }).catch(() => {});
    fetchStudentTokens();
    // 加载该学生的历史对话
    if (classroom?.id) {
      await loadMessages(classroom.id, selectedStudent.id);
    }
    await startChatSession(selectedStudent.id, selectedStudent.name, undefined, token);
    joiningRef.current = false;
    setJoiningClassroom(false);
  };

  const handleSwitchIdentity = () => {
    if (waitingAI) return;
    // 断开当前连接
    const o = optionsRef.current;
    o.chatConnectionGenerationRef.current += 1;
    if (o.wsRef.current) {
      o.wsRef.current.disconnect();
      o.wsRef.current = null;
    }
    localStorage.removeItem(`chat_session_${code}`);
    setStudentSessionToken();
    setMessages([]);
    setSelectedStudent(null);
    setShieldWarning(null);
    setStep('identity');
  };

  const handleExit = () => {
    if (waitingAI) return;
    const o = optionsRef.current;
    o.chatConnectionGenerationRef.current += 1;
    if (o.wsRef.current) { o.wsRef.current.disconnect(); o.wsRef.current = null; }
    if (o.statusSocketRef.current) { o.statusSocketRef.current.disconnect(); o.statusSocketRef.current = null; }
    localStorage.removeItem(`chat_session_${code}`);
    setStudentSessionToken();
    o.router.push('/');
  };

  // 课堂已结束（15 秒轮询兜底发现「已结束」状态，或 API 报「课堂已结束/互动码无效」）。
  // 与 handleExit 刻意不同：不主动断 socket、不清学生 token、没有 waitingAI 闸门 ——
  // 课堂已经结束了，这里只清本地会话、提示、整页回首页。这三步与 useChatSocket 的
  // classroom-ended 处理等价（那边用 optionsRef.current.code，同一会话期取值相同），
  // 也就是说外壳内目前有两份同样的三行逻辑 —— 合并要动 ChatSocketOptions，留给 M1b。
  // 必须 useCallback：[code] 之外身份稳定，否则面板的轮询 effect 每次渲染都会重建
  // setInterval —— 流式回复期间渲染频繁，15 秒的兜底轮询将几乎永不触发。
  const handleClassroomEnded = useCallback(() => {
    localStorage.removeItem(`chat_session_${code}`);
    setToast({ msg: '课堂已结束', type: 'info' });
    optionsRef.current.router.push('/');
  }, [code]);

  // 面板「重试」按钮的编排（对应面板 chat-panel.tsx 的错误态卡片）：按 URL 里的互动码
  // 重建课堂与历史消息，再续接会话；取不到本地会话就退回身份选择页。
  // M1a 之前这段长在面板按钮的 onClick 里，属于「渲染在模块 DOM 里的页面编排」。
  const handleRetryRestore = () => {
    const tryRestore = async () => {
      const codeFromUrl = new URLSearchParams(window.location.search).get('code') || '';
      setLoadError(null);
      const cr = await loadClassroom(codeFromUrl);
      if (cr) {
        try {
          const saved = localStorage.getItem(`chat_session_${codeFromUrl}`);
          if (saved) {
            const session = JSON.parse(saved);
            loadMessages(cr.id, session.studentId);
            startChatSession(session.studentId, session.studentName, codeFromUrl);
            api.getAvatarsAll('student').then(data => {
              const m: Record<number, string> = {};
              data.forEach((avatar) => { m[avatar.id] = fixSvgUrl(avatar.svgContent); });
              setAvatarSvgs(m);
            }).catch(() => {});
          } else {
            setStep('identity');
          }
        } catch {
          setStep('identity');
        }
      }
    };
    void tryRestore();
  };

  // 实时通信归外壳：socket 与 step 状态机同处一个 hook，会话生命周期只有一个持有者。
  // useChatSocket 必须先于 useStudentSession 调用 —— 后者的 options 在 render 期就求值，
  // 直接读下面这个 const。这是普通 TDZ 约束（const 声明顺序），不是运行期时序：
  // 顺序写反会在首帧直接抛 ReferenceError，而不是静默退化成「没有 socket 的聊天页」。
  const { startChatSession } = useChatSocket({
    code,
    router: options.router,
    SOCKET_URL,
    wsRef: options.wsRef,
    sendingRef: options.sendingRef,
    chatConnectionGenerationRef: options.chatConnectionGenerationRef,
    identityConflictTimerRef: options.identityConflictTimerRef,
    teacherNotifTimerRef: options.teacherNotifTimerRef,
    streamingBufferRef: options.streamingBufferRef,
    streamingRafRef: options.streamingRafRef,
    seenNotifIdsRef: options.seenNotifIdsRef,
    setAgentDisabled,
    setAvatarTokenCount,
    setBlacklisted,
    setClassroom,
    setConnected,
    setConnectionError,
    setMessages,
    setPaused,
    setSelectedStudent,
    setShieldWarning,
    setStep,
    setStreamingContent,
    setTeacherMsgs,
    setTeacherNotifBubble,
    setThinkingContent,
    setToast,
    setWaitingAI,
  });

  // 同步错误检测：loadClassroom 失败后从 'loading' 切换到 'identity' 以显示错误
  useEffect(() => {
    if (step === 'loading' && loadError) {
      setStep('identity');
    }
  }, [loadError, step]);

  // 初始化时从 localStorage 恢复已见教师消息 ID。必须排在挂载恢复 effect 之前，
  // 否则恢复路径会把未水合的集合写回 localStorage（丢失去重记录）。
  useEffect(() => {
    try {
      const saved = localStorage.getItem('_seen_notif_ids');
      if (saved) optionsRef.current.seenNotifIdsRef.current = new Set(JSON.parse(saved));
    } catch {}
  }, []);

  // 会话恢复逻辑抽到 useStudentSession。它接收的 startChatSession 就是上面
  // useChatSocket 的返回值，同一渲染周期内已初始化，不再依赖「面板先挂载」这条时序。
  const { restoreSessionFromUrl } = useStudentSession({
    router: options.router,
    seenNotifIdsRef: options.seenNotifIdsRef,
    loadClassroom, loadMessages, startChatSession,
    setCode, setSelectedStudent, setStep, setTeacherMsgs,
    setAvatarSvgs, setAllStudentAvatars, setAvatarTokenCount,
  });

  useEffect(() => {
    void restoreSessionFromUrl(Date.now()).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : '学生端初始化失败，请刷新后重试');
      setStep('identity');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 仅在首次挂载恢复 URL 中的本地会话

  useEffect(() => {
    if (step === 'identity' && classroom?.id) {
      api.getClassroomStudents(classroom.id).then(data => {
        setStudents(data);
        // 加载头像 SVG 映射
        api.getAvatarsAll('student').then(avatars => {
          const m: Record<number, string> = {};
          avatars.forEach((avatar) => { m[avatar.id] = fixSvgUrl(avatar.svgContent); });
          setAvatarSvgs(m);
        }).catch(() => {});
      }).catch(() => {});
      // 连接状态监听 socket，获取已登录学生列表
      (async () => {
        const { io } = await import('socket.io-client');
        const statusSocketRef = optionsRef.current.statusSocketRef;
        if (statusSocketRef.current) statusSocketRef.current.disconnect();
        const sk = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        sk.on('connect', () => sk.emit('listen-classroom-status', classroom.id));
        sk.on('online-students', (data: { studentIds: string[] }) => setOnlineStudentIds(new Set(data.studentIds)));
        statusSocketRef.current = sk;
      })();
    }
    // 离开身份选择页时断开状态监听
    return () => {
      const statusSocketRef = optionsRef.current.statusSocketRef;
      if (statusSocketRef.current) {
        statusSocketRef.current.disconnect();
        statusSocketRef.current = null;
      }
    };
  }, [step, classroom?.id, SOCKET_URL]);

  // 如果选中的学生被登录了，取消选中。必须留在外壳里：它只读外壳状态
  // （onlineStudentIds / selectedStudent / setSelectedStudent），且 onlineStudentIds
  // 由上面那条身份页 socket effect 实时更新。M1a 之前这段长在面板里，而面板当时恒挂载，
  // 所以它在身份选择页上是活的 —— 学生在身份页选中一位离线同学后，该同学从另一台设备
  // 登录会立刻清空选择、置灰确认按钮，避免确认时走服务端「后登录踢先登录」分支把对方踢下线。
  // 面板改为只在 step === 'shell' 时挂载后这段会失去身份页窗口，故上移到外壳恢复基线行为。
  // 依赖数组与基线完全一致（无 step / active 闸门）。
  useEffect(() => {
    if (selectedStudent && onlineStudentIds.has(selectedStudent.id)) {
      setSelectedStudent(null);
    }
  }, [onlineStudentIds, selectedStudent]); // setSelectedStudent 是 useState setter，引用稳定

  return {
    // 状态
    code,
    step,
    joiningClassroom,
    classroom,
    students,
    avatarSvgs,
    avatarTokenCount,
    allStudentAvatars,
    selectedStudent,
    identitySearch,
    loadError,
    teacherMsgs,
    onlineStudentIds,
    messages,
    loadingMessages,
    waitingAI,
    paused,
    agentDisabled,
    shieldWarning,
    toast,
    connected,
    connectionError,
    streamingContent,
    thinkingContent,
    teacherNotifBubble,
    blacklisted,
    // setter
    setCode,
    setStep,
    setJoiningClassroom,
    setClassroom,
    setStudents,
    setAvatarSvgs,
    setAvatarTokenCount,
    setAllStudentAvatars,
    setSelectedStudent,
    setIdentitySearch,
    setLoadError,
    setTeacherMsgs,
    setOnlineStudentIds,
    setMessages,
    setLoadingMessages,
    setWaitingAI,
    setPaused,
    setAgentDisabled,
    setShieldWarning,
    setToast,
    setConnectionError,
    setStreamingContent,
    setThinkingContent,
    setTeacherNotifBubble,
    // 逻辑
    loadClassroom,
    loadMessages,
    fetchStudentTokens,
    handleIdentityConfirm,
    handleSwitchIdentity,
    handleExit,
    handleClassroomEnded,
    handleRetryRestore,
    startChatSession,
  };
}
