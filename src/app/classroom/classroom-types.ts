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
 * 「每个模块都满足它」说的是外壳一定把这六件事给到面板；**面板自己的 props 会更多**
 * （学伴面板几十个，见下面的 ChatPanelProps），契约是共同的下限而不是完整清单。
 *
 * `active` 与 `state` 是两件不同的事，不能合成一个字段：
 *   · `active` = **此刻是否可见**。切走的模块仍然挂载（§4.5），所以「挂载」≠「可见」；
 *   · `state`  = **教师设定的三态**（开放 / 预告 / 隐藏）。它决定模块在首页与 Tab 栏能否
 *     进入，与此刻在不在前台无关 —— 一个 `preview` 的模块可以在前台，一个 `open` 的
 *     模块也可以在后台。
 *
 * `toast` / `setToast` 是 M1b-2 Task 11 补进契约的第五、六项，它们**不是**可选的装饰：
 * 外壳的 Toast 归属规则是「**前台那一层**渲染，别的层拿到 null」（T4 消除双份叠加的做法），
 * 而提示的 3 秒自动关闭计时器长在 `<Toast>` 组件内部（`lib/components.tsx`）——**没人渲染
 * 它就没有任何计时器**。规则本身是无条件的、按层而不是按模块类型分的，所以任何一层当前台时
 * 都必须能渲染：占位面板也不例外，否则「点未开放的 Tab ⇒ 提示『老师还没开放』」（§4.4）在
 * 「前台是占位模块」这个配置下会静默失效，`avatar-rewarded` 的提示还会滞留在会话状态里，
 * 等学生切回首页时才突然弹出几分钟前的旧提示。
 *
 * 为什么不把「不会渲染 Toast 的层」在外壳里列成一张表、由外壳转给首页：那张表会随 M2/M3
 * 把占位换成真面板而**过期**（学习单变成真面板后外壳仍把它的提示转给首页），而且首页的
 * Toast 渲染在 `useOverlayPortal(active)` 里（`visibility` 由首页自己的 `active` 决定），
 * 要让它替别的前台层显示提示，就得把 Toast 从这里摘出去单独无条件渲染 —— 反而动了
 * Ruling 5 立下的「portal 必须显式按 active 收敛」这条唯一的收口。契约加一项则让
 * 「外壳给了、模块没接住」变成**编译错误**（`ModulePlaceholderProps extends` 本接口）。
 */
export interface ModulePanelProps {
  /** 此刻是否可见。 */
  active: boolean;
  /** 教师设定的三态（由外壳按 MODULE_KEY_BY_ID 从 classroom.modules 读出）。 */
  state: ModuleState;
  classroom: ClassroomInfo | null;
  session: StudentSession | null;
  /** 会话级浮动提示。**只在前台层非 null**（见上面的归属规则）；非前台层拿到 null。 */
  toast: ChatToast | null;
  /** 关闭提示 = 清空会话级的 `toast`（与首页、学伴面板同一个 setter）。 */
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
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
   * 「一直可见」，那正是这道闸要防的事。
   *
   * Task 5 起由外壳（`shell/classroom-shell.tsx`）传入真实值：`activeModuleId === 'companion'`，
   * 也就是**首页在前台、或前台是另一个模块、或课堂已结束分支下都不为真**。
   * Task 7 又补了第二个条件：**前台层已经滑到位**（`front && settled`）。理由是面板里的
   * 页面级读取含 `transform` —— 标记条的坐标来自 `getBoundingClientRect()`，若在滑动途中
   * 翻真，量到的是被平移过的坐标，而 transform 不改布局尺寸、容器的 ResizeObserver 不会
   * 触发，那个偏移会被永久固定下来。反方向不受影响：离场层**当场**失去 `active`（不等动画），
   * 五处副作用的收手必须即时。
   * 外壳的入参类型是 `Omit<ChatPanelProps, 'active'>`，所以「谁来传」在类型上只剩外壳一个
   * 答案 —— 把这条从 `Omit` 里放出来（或给它加默认值），五处门就会静默退回空操作且没有
   * 任何编译期信号。
   */
  active: boolean;
  // —— 外壳状态：面板只读 ——
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  /**
   * 换头像用的两项（M1b-3 T2 起**面板自己不再消费**，外壳从同一个 `chat` 对象里读）。
   *
   * 它们留在这个接口上而不是搬去外壳的入参，是因为 `chat` 就是 `Omit<ChatPanelProps,
   * 'active'>` —— 会话级状态仍然只在这一处声明，外壳拿到的还是**同一份**类型。T2 把换头像
   * 的入口收敛到顶栏之后，面板头那枚「头像 + 机会计数」是这两个字段在本文件里的最后两个
   * 读者（同批撤除的有 `setAvatarSvgs` / `setSelectedStudent` / `setAllStudentAvatars` /
   * `fetchStudentTokens` 的解构）。删掉这里的字段会立刻在 `shell/classroom-shell.tsx` 的
   * `chat.avatarTokenCount` 上报错，所以「误删」这一路有编译期信号。
   */
  avatarTokenCount: number;
  allStudentAvatars: AvatarSummary[];
  /**
   * 老师消息（M1b-3 T3 起**面板自己不再消费**，外壳从同一个 `chat` 对象里读）。
   *
   * TS 上仍留在这个接口里，理由与上面 `avatarTokenCount` 那两项逐字相同：`chat` 就是
   * `Omit<ChatPanelProps, 'active'>`，会话级状态只在这一处声明。搬去顶栏的是**入口与下拉**
   * （外壳的 `ModuleTabBar` + 那条 portal），数据一直都在会话手里。
   */
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
  /**
   * 探究助手按需推流：本课堂此刻有没有教师在看探究助手视图（P2 / Ruling 9）。
   *
   * 与上面几项同源 —— 写入点在 `use-chat-socket` 的回调里（socket 的家），所有者是会话层。
   * **不能改成由探究助手面板自己订阅**：初值只在 `join-classroom` 成功后下发一次，而那个
   * 时刻面板还没挂载（惰性挂载），面板自己订阅会永远停在「没人看」，学生端在源头就不推，
   * 教师图墙空着且没有任何报错。学生端唯一的消费者是探究助手面板（外壳从 `chat` 里读它
   * 再传下去）。
   */
  webappWatching: boolean;

  // —— 外壳 setter：面板自身仍要写这些状态 ——
  // （setClassroom / setAvatarTokenCount / setTeacherMsgs 过去只有面板的 useChatSocket
  //   在写，随 hook 上移后已从面板契约中移除。setLoadError 与 setStep 过去只有面板的
  //   重试卡片在写，随重试逻辑上移后也已移除。setPaused 与 setAgentDisabled 过去只有
  //   面板的 15 秒轮询在写，M1b-2 Task 6 把轮询搬进 use-classroom-session 后同样移除。）
  // ⚠️ 下面这三项 setter（setSelectedStudent / setAvatarSvgs / setAllStudentAvatars）与
  //    `fetchStudentTokens` 本身，M1b-3 T2 起**面板自己也不再调用** —— 它们的读者只剩换头像
  //    的收尾（`finishAvatarChange`），而那个调用点已经上移到外壳。字段仍然留在这里，理由与
  //    上面 `avatarTokenCount` 那一段相同（同一份 `chat` 类型、同一处声明）。
  setSelectedStudent: Dispatch<SetStateAction<StudentSession | null>>;
  setAvatarSvgs: Dispatch<SetStateAction<Record<number, string>>>;
  setAllStudentAvatars: Dispatch<SetStateAction<AvatarSummary[]>>;
  setMessages: Dispatch<SetStateAction<StudentChatMessage[]>>;
  setWaitingAI: Dispatch<SetStateAction<boolean>>;
  setShieldWarning: Dispatch<SetStateAction<string | null>>;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setThinkingContent: Dispatch<SetStateAction<string>>;
  setTeacherNotifBubble: Dispatch<SetStateAction<string | null>>;

  // —— 外壳逻辑：面板只留调用点，编排全在外壳 ——
  // 上移前，面板的重试卡片直接持有 loadClassroom / loadMessages / startChatSession /
  // setStep，轮询兜底直接持有 router —— 那都是渲染在模块 DOM 里的页面编排。现在面板
  // 只留按钮与调用点，编排全部由外壳提供，面板不再持有任何整页导航入口。
  // （onClassroomEnded 过去由面板的 15 秒轮询调用，M1b-2 Task 6 把轮询搬进
  //   use-classroom-session 后已从面板契约中移除：课堂生命期不属于模块呈现。）
  // M1b-3 T4 撤掉面板整行头部之后，「面板的顶部栏」这个调用点不再存在：下面四项里只有
  // `onExit`（错误态重试卡片的「返回首页」）与 `onRetryRestore` 还留着面板自己的调用点，
  // 另两项的实际消费者只剩外壳。四项**都**仍是活字段（外壳从同一个 `chat` 对象里读它们），
  // 所以一个都不删。
  fetchStudentTokens: () => Promise<void>;
  /**
   * 切换身份。M1b-3 T4 起**面板自己不再消费**：它在本文件里最后的读者是面板头那枚
   * 「切换」按钮，随整行头部一并撤除。消费者只剩外壳 —— `shell/classroom-shell.tsx`
   * 从同一个 `chat` 对象里读它并接给顶栏的操作组。字段留在契约上的理由与上面
   * `teacherMsgs` 那一段逐字相同（`chat` 就是 `Omit<ChatPanelProps, 'active'>`）。
   */
  onSwitchIdentity: () => void;
  /** 退出课堂。面板**仍有一个**调用点（错误态重试卡片的「返回首页」），所以它不是死字段。 */
  onExit: () => void;
  /** 错误态的「重试」：外壳按 URL 互动码恢复课堂、历史消息与会话。 */
  onRetryRestore: () => void;

  // —— 共享 ref：按对象身份透传，两侧必须是同一个对象（M0 Ruling 8）——
  // socket 上移后，其内部使用的 ref 仍由 page.tsx 声明，同时交给外壳（useChatSocket）
  // 与面板（发送闸门、停止生成），任何一侧重新声明都会拿到另一个对象。
  // 面板持有的是长生命周期对象，卸载时不会像过去的 useRef 那样拿到全新初值，
  // 所以卸载清理必须把它们复位成初值，而不是只 cancel。
  // （seenNotifIdsRef 只被 useChatSocket 使用，已随 hook 上移到外壳，面板不再接收。）
  // ⚠️ 面板**只读/只 emit**，绝不 disconnect（M1b-2 收尾修）：连接的归属在外壳，
  // 消费者在自己的挂载/卸载周期里拆生产者的连接会让严格模式的模拟卸载直接掐断活连接。
  // statusSocketRef 因此从面板契约中移除 —— 它此前唯一的用途就是那条越权的清理。
  wsRef: { current: Socket | null };
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
 * 得接住 `active`、`classroom`、`toast` 与 `setToast`」变成编译期事实：这四项**被删掉、
 * 被改名、或类型改到不兼容**，这里立刻报错。
 *
 * ⚠️ **它抓不住「把契约改宽」**（例如 `ModulePanelProps` 里 `active: boolean` 退回
 * `active?: boolean`、或 `toast` 放宽成可选）。`T extends U` 只要求 `T` 满足 `U`，而
 * **放宽 `U` 是削弱约束** —— 必填的实现依然满足可选的契约，断言照旧是 `true`。本任务实测
 * 确认过：把契约改成可选，`tsc` exit 0 不报错。要抓这个方向得反向断言或做精确匹配。
 * 真正硬的那道门是 `ModulePlaceholderProps extends ModulePanelProps` 加上 JSX 调用点
 * 缺 prop 的报错，那一条是真的。
 *
 * 为什么 `Omit` 掉 `state` 与 `session`：这两项今天的名字/落地还没对齐（`session` 在本面板叫
 * `selectedStudent`；`state` 面板尚未读）。要求它们就位，只能往 `page.tsx` 传假值 ——
 * 那是把闸门伪装成通过。`Omit` 之后剩下的四项恰好是「两边名字一致且都已落地」的部分
 * （`toast` / `setToast` 由 Task 11 补进契约，面板本来就在用这两个名字）。
 *
 * ⚠️ 断言必须落在 `AssertTrue` 这种**要求 `T extends true`** 的位置上才算数：
 * `type X = 条件 ? true : never` 只是求值成 `never`，别名本身依旧合法、**不报错**；
 * 而 `AssertTrue<never>` 也不报错（`never` 可赋给一切）。所以失败分支写 `false`。
 * 二者都由本任务实测确认。
 */
type AssertTrue<T extends true> = T;

/** 学伴面板与模块契约的结构锚点，见上。导出理由同 `lib/classroom-modules.ts`：避免 unused-vars 警告。 */
export type _ContractCheck = AssertTrue<ChatPanelProps extends Omit<ModulePanelProps, 'state' | 'session'> ? true : false>;
