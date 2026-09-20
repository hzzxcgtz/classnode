import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, setStudentSessionToken } from '@/lib/api';
import type { AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import { API_BASE_URL, fixSvgUrl } from './avatar-utils';
import type { ChatToast, StartChatSession, StudentChatMessage, TeacherMessage } from './classroom-types';
import { useStudentSession } from './identity/use-student-session';

export interface ClassroomSessionOptions {
  router: { push: (href: string) => void };
  // 下面 5 个 ref 由 page.tsx 创建，按对象身份同时交给外壳与面板（M0 Ruling 8）。
  // 任何一侧重新声明都会拿到另一个对象，静默破坏停止生成 / 发送闸门 / 卸载清理。
  wsRef: { current: Socket | null };
  statusSocketRef: { current: Socket | null };
  chatConnectionGenerationRef: { current: number };
  seenNotifIdsRef: { current: Set<string> };
  startChatSessionRef: { current: StartChatSession | null };
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
  const [step, setStep] = useState<'loading' | 'identity' | 'chat'>('loading');
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
  // 面板挂载之前（面板只在 step === 'chat' 时才渲染），所以所有者必须是外壳。
  const [messages, setMessages] = useState<StudentChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [waitingAI, setWaitingAI] = useState(false);
  const [paused, setPaused] = useState(false);
  const [agentDisabled, setAgentDisabled] = useState(false);
  const [shieldWarning, setShieldWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<ChatToast | null>(null);
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
    setStep('chat');
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

  // startChatSession 仍归面板的 useChatSocket（学伴模块自己的 socket）。这里通过
  // startChatSessionRef 取它，而不是把函数本身提到外壳：两侧必须拿到同一个函数对象
  // （M0 Ruling 8）。所有调用点都在 setStep('chat') 之后、隔着一次网络 await，
  // 那时面板已挂载并完成注册。
  const startChatSession: StartChatSession = (studentId, studentName, classroomCode, token) => {
    const start = optionsRef.current.startChatSessionRef.current;
    return start ? start(studentId, studentName, classroomCode, token) : Promise.resolve();
  };

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

  // 会话恢复逻辑抽到 useStudentSession。它接收的 startChatSession 是面板 useChatSocket
  // 的实现（经 startChatSessionRef 透传），因此这里没有 TDZ 约束 —— 真正的顺序约束
  // 变成了「面板必须先挂载」，由上面适配函数的注释说明。
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
    // 逻辑
    loadClassroom,
    loadMessages,
    fetchStudentTokens,
    handleIdentityConfirm,
    handleSwitchIdentity,
    handleExit,
  };
}
