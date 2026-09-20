import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { AgentSummary, AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';

export type ChatAgent = Pick<AgentSummary, 'name' | 'logo'> | null | undefined;
export type StudentChatMessage = {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  fileUrls?: string[];
  fileUrl?: string;
  fileNames?: string[];
  fileName?: string;
  followUps?: string[];
  roundIndex?: number | null;
};
export type SocketTextEvent = { content: string };
export type AiResponseEvent = SocketTextEvent & { roundIndex?: number | null; messageId?: string; followUps?: string[] };
export type SocketErrorEvent = { error?: string };
export type StudentIdEvent = { studentId?: string };
export type AvatarRewardEvent = { tokens?: number };
export type TeacherNotificationEvent = { id?: string; message: string };
export type ShieldWarnEvent = { studentName?: string; filteredContent?: string };
export type PermissionEvent = { allow: boolean };
export type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string; confidence: number };
};
export type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};
export type BrowserSpeechRecognitionErrorEvent = Event & { error: string; message?: string };
export type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
export type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

/** 外壳持有的课堂信息。M1a 先用 StudentClassroom 的别名，M1b 需要时再收窄。 */
export type ClassroomInfo = StudentClassroom;

/** 外壳持有的学生身份。 */
export type StudentSession = ClassroomStudentSummary;

/** 教师消息（外壳持有，面板只读）。 */
export type TeacherMessage = { message: string; time: string };

/** 学生端浮动提示（外壳持有，面板渲染）。 */
export type ChatToast = { msg: string; type: 'success' | 'error' | 'info' };

/** 面板 useChatSocket 提供的实时通信入口；面板挂载后注册进 startChatSessionRef 交给外壳。 */
export type StartChatSession = (
  studentId: string,
  studentName: string,
  classroomCode?: string,
  token?: string,
) => Promise<void>;

/** 学伴模块面板的契约。M1b 会在此基础上加 active / state 两个字段。 */
export interface ChatPanelProps {
  // —— 外壳状态：面板只读 ——
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  avatarTokenCount: number;
  allStudentAvatars: AvatarSummary[];
  onlineStudentIds: Set<string>;
  teacherMsgs: TeacherMessage[];
  messages: StudentChatMessage[];
  loadingMessages: boolean;
  waitingAI: boolean;
  paused: boolean;
  agentDisabled: boolean;
  shieldWarning: string | null;
  toast: ChatToast | null;
  loadError: string | null;

  // —— 外壳 setter：面板自身与面板的 useChatSocket 都要写这些状态 ——
  setStep: Dispatch<SetStateAction<'loading' | 'identity' | 'chat'>>;
  setClassroom: Dispatch<SetStateAction<ClassroomInfo | null>>;
  setSelectedStudent: Dispatch<SetStateAction<StudentSession | null>>;
  setAvatarSvgs: Dispatch<SetStateAction<Record<number, string>>>;
  setAvatarTokenCount: Dispatch<SetStateAction<number>>;
  setAllStudentAvatars: Dispatch<SetStateAction<AvatarSummary[]>>;
  setTeacherMsgs: Dispatch<SetStateAction<TeacherMessage[]>>;
  setMessages: Dispatch<SetStateAction<StudentChatMessage[]>>;
  setWaitingAI: Dispatch<SetStateAction<boolean>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  setAgentDisabled: Dispatch<SetStateAction<boolean>>;
  setShieldWarning: Dispatch<SetStateAction<string | null>>;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;

  // —— 外壳逻辑：面板的重试卡片与顶部栏调用 ——
  loadClassroom: (classroomCode?: string, sessionStudentId?: string) => Promise<StudentClassroom | undefined>;
  loadMessages: (classroomId: string, studentId: string) => Promise<void>;
  fetchStudentTokens: () => Promise<void>;
  onSwitchIdentity: () => void;
  onExit: () => void;

  // —— 路由入口 ——
  router: { push: (href: string) => void };

  // —— 共享 ref：按对象身份透传，两侧必须是同一个对象（M0 Ruling 8）——
  wsRef: { current: Socket | null };
  statusSocketRef: { current: Socket | null };
  chatConnectionGenerationRef: { current: number };
  seenNotifIdsRef: { current: Set<string> };
  startChatSessionRef: { current: StartChatSession | null };
}
