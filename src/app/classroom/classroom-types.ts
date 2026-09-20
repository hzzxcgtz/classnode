import type { Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { AgentSummary, AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
// 模块词汇表（ModuleId / ModuleState 与后端 moduleKey 的双向映射）住在
// lib/classroom-modules.ts：教师端也读那两张表，另写一份必然漂移。
// 这里只做转出，让外壳能从本文件一处取到模块契约相关的全部类型。
import type { ModuleId, ModuleState } from '@/lib/classroom-modules';

export type { ModuleId, ModuleState };

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
/**
 * 模块三态变更事件。两个字段都是 string 而非 lib/types 里的联合类型：这是线缆上的
 * 原始载荷，取值必须过 isClassroomModuleKey / isClassroomModuleState 才能当联合类型用。
 */
export type ModuleStateEvent = { moduleKey: string; state: string };
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

/**
 * 模块面板契约（§4.3）：外壳与模块之间**唯一**的接口。模块自行响应 `active` 变化
 * （如探究助手在此向 iframe 发挂起信号）；外壳不关心模块内部，模块不关心有几个兄弟。
 * 加一个模块 = 加一个组件。
 *
 * 「每个模块都满足它」说的是外壳一定把这四件事给到面板；**面板自己的 props 会更多**
 * （学伴面板几十个，见下面的 ChatPanelProps），契约是共同的下限而不是完整清单。
 *
 * `active` 与 `state` 是两件不同的事，不能合成一个字段：
 *   · `active` = **此刻是否可见**。切走的模块仍然挂载（§4.5），所以「挂载」≠「可见」；
 *   · `state`  = **教师设定的三态**（开放 / 预告 / 隐藏）。它决定模块在首页与 Tab 栏能否
 *     进入，与此刻在不在前台无关 —— 一个 `preview` 的模块可以在前台，一个 `open` 的
 *     模块也可以在后台。
 */
export interface ModulePanelProps {
  /** 此刻是否可见。 */
  active: boolean;
  /** 教师设定的三态（由外壳按 MODULE_KEY_BY_ID 从 classroom.modules 读出）。 */
  state: ModuleState;
  classroom: ClassroomInfo | null;
  session: StudentSession | null;
}

/**
 * 学伴面板的 props —— 满足 `ModulePanelProps` 的语义，但**不是** `extends` 它。
 *
 * 两条理由，都是当下的事实而非取舍：
 *   1. 契约里的 `session` 在本面板叫 `selectedStudent`。那是 M1a 就定下的名字，横跨
 *      use-classroom-session.ts（hook 的返回值）与 page.tsx 的传参；改名要动那两个
 *      已验收的文件，不属于「定义契约」这件事。
 *   2. 契约里的 `state` 本面板暂时无人读：教师改态后的「提示 + 送回首页」由外壳负责
 *      （Task 6）。为此刻没人读的字段要求 page.tsx 传值，只会传一个假值进去。
 * 所以关系是「面板接住契约的语义，名字与落地分两步走」；Task 5/6 让面板真的需要
 * `state` 时，再把它加进来（届时 `extends` 才是准确的写法）。
 */
export interface ChatPanelProps {
  /**
   * 此刻这个模块是否对用户可见（M1b-2 Task 1 引入，Task 3 定稿为**必填**）。
   *
   * 面板常驻后「挂载」不再等于「可见」（§4.5：惰性挂载 + 一旦挂载永不卸载），所以面板里
   * 所有页面级副作用都挂在这道闸上。**不给默认值**：默认 `true` 会把「外壳忘了传」伪装成
   * 「一直可见」，那正是这道闸要防的事。Task 5 的外壳传入真实值；今天 page.tsx 只在
   * `step === 'shell'` 时挂载面板，所以传 `active`（恒真，与基线逐字一致 —— `'chat'`
   * 改名 `'shell'` 是 Task 4 的事，语义未变）。
   */
  active: boolean;
  // —— 外壳状态：面板只读 ——
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  avatarTokenCount: number;
  allStudentAvatars: AvatarSummary[];
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
  // 它们的所有者也随之上移（面板在 step !== 'shell' 时会卸载，不能持有 socket 写入的状态）。
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

/**
 * 学伴面板确实满足 `ModulePanelProps` 的**结构锚点**。
 *
 * 为什么需要它：`ModulePanelProps` 今天没有 `extends` 它的实现者（三条理由见上面的注释），
 * 于是「学伴面板满足契约」这句话只活在一段注释里 —— 注释拦不住漂移。这个别名把「面板至少
 * 得接住 `active` 与 `classroom`」变成编译期事实：`active` 一旦被删掉或改宽（例如退回
 * `active?: boolean`）、`classroom` 一旦换了类型，这里立刻报错。
 *
 * 为什么 `Omit` 掉 `state` 与 `session`：这两项今天的名字/落地还没对齐（`session` 在本面板叫
 * `selectedStudent`；`state` 面板尚未读）。要求它们就位，只能往 `page.tsx` 传假值 ——
 * 那是把闸门伪装成通过。`Omit` 之后剩下的两项恰好是「两边名字一致且都已落地」的部分。
 *
 * ⚠️ 断言必须落在 `AssertTrue` 这种**要求 `T extends true`** 的位置上才算数：
 * `type X = 条件 ? true : never` 只是求值成 `never`，别名本身依旧合法、**不报错**；
 * 而 `AssertTrue<never>` 也不报错（`never` 可赋给一切）。所以失败分支写 `false`。
 * 二者都由本任务实测确认。
 */
type AssertTrue<T extends true> = T;

/** 学伴面板与模块契约的结构锚点，见上。导出理由同 `lib/classroom-modules.ts`：避免 unused-vars 警告。 */
export type _ContractCheck = AssertTrue<ChatPanelProps extends Omit<ModulePanelProps, 'state' | 'session'> ? true : false>;
