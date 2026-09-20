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
  // 下面这批状态的写入点在 useChatSocket 的回调里；M1a Task 3 把该 hook 上移到外壳后，
  // 它们的所有者也随之上移（面板在 step !== 'chat' 时会卸载，不能持有 socket 写入的状态）。
  connected: boolean;
  connectionError: string | null;
  streamingContent: string;
  thinkingContent: string;
  teacherNotifBubble: string | null;
  blacklisted: boolean;

  // —— 外壳 setter：面板自身仍要写这些状态 ——
  // （setClassroom / setAvatarTokenCount / setTeacherMsgs 过去只有面板的 useChatSocket
  //   在写，随 hook 上移后已从面板契约中移除。setLoadError 与 setStep 过去只有面板的
  //   重试卡片在写，随重试逻辑上移后也已移除。）
  setSelectedStudent: Dispatch<SetStateAction<StudentSession | null>>;
  setAvatarSvgs: Dispatch<SetStateAction<Record<number, string>>>;
  setAllStudentAvatars: Dispatch<SetStateAction<AvatarSummary[]>>;
  setMessages: Dispatch<SetStateAction<StudentChatMessage[]>>;
  setWaitingAI: Dispatch<SetStateAction<boolean>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  setAgentDisabled: Dispatch<SetStateAction<boolean>>;
  setShieldWarning: Dispatch<SetStateAction<string | null>>;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setThinkingContent: Dispatch<SetStateAction<string>>;
  setTeacherNotifBubble: Dispatch<SetStateAction<string | null>>;

  // —— 外壳逻辑：面板的顶部栏、错误态重试卡片与轮询兜底调用 ——
  // 上移前，面板的重试卡片直接持有 loadClassroom / loadMessages / startChatSession /
  // setStep、轮询兜底直接持有 router —— 那都是渲染在模块 DOM 里的页面编排。现在面板
  // 只留按钮与调用点，编排全部由外壳提供，面板不再持有任何整页导航入口。
  fetchStudentTokens: () => Promise<void>;
  onSwitchIdentity: () => void;
  onExit: () => void;
  /** 课堂已结束（轮询兜底发现）：外壳清本地会话、提示并整页回首页。 */
  onClassroomEnded: () => void;
  /** 错误态的「重试」：外壳按 URL 互动码恢复课堂、历史消息与会话。 */
  onRetryRestore: () => void;

  // —— 共享 ref：按对象身份透传，两侧必须是同一个对象（M0 Ruling 8）——
  // socket 上移后，其内部使用的 ref 仍由 page.tsx 声明，同时交给外壳（useChatSocket）
  // 与面板（卸载清理、发送闸门、停止生成），任何一侧重新声明都会拿到另一个对象。
  // 面板持有的是长生命周期对象，卸载时不会像过去的 useRef 那样拿到全新初值，
  // 所以卸载清理必须把它们复位成初值，而不是只 cancel。
  // （seenNotifIdsRef 只被 useChatSocket 使用，已随 hook 上移到外壳，面板不再接收。）
  wsRef: { current: Socket | null };
  statusSocketRef: { current: Socket | null };
  chatConnectionGenerationRef: { current: number };
  sendingRef: { current: boolean };
  identityConflictTimerRef: { current: number | null };
  teacherNotifTimerRef: { current: number | null };
  streamingBufferRef: { current: string };
  streamingRafRef: { current: number | null };
}
