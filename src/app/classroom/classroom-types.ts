import type { AgentSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';

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

/** 学伴模块面板的契约。M1b 会在此基础上加 active / state 两个字段。 */
export interface ChatPanelProps {
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  avatarTokenCount: number;
  teacherMsgs: { message: string; time: string }[];
  setClassroom: (value: ClassroomInfo | null) => void;
  setAvatarTokenCount: (value: number) => void;
  setTeacherMsgs: (value: { message: string; time: string }[]) => void;
  /** 会话失效（student-auth-error）—— 外壳负责清会话并回到身份选择。 */
  onSessionInvalid: () => void;
  /** 课堂结束 —— 外壳负责收尾与导航。 */
  onClassroomEnded: () => void;
}
