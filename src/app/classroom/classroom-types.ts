import type { AgentSummary } from '@/lib/types';

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
