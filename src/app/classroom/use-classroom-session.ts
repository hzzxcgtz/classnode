import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, setStudentSessionToken } from '@/lib/api';
import type { AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import type { WebappDemand } from '@/lib/socket-events';
import { effectiveGroupAgent } from '@/lib/classroom-material';
import { API_BASE_URL, fixSvgUrl } from './avatar-utils';
import type { ChatToast, StudentChatMessage, TeacherMessage } from './classroom-types';
import { useStudentSession } from './identity/use-student-session';
import { useChatSocket } from './chat/use-chat-socket';
// ★ 2026-09-25：清「上次停在哪个模块」那条存档。**函数由键的所有者导出**，这里不写键名
//（键名一份拷贝的纪律由 `shell/last-module-storage.test.ts` 钉着）。
import { clearStoredModule } from './shell/use-module-tabs';

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
  // 面板挂载之前（面板要到学生自己点开学伴卡片才由外壳挂载），所以所有者必须是外壳。
  const [messages, setMessages] = useState<StudentChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [waitingAI, setWaitingAI] = useState(false);
  const [paused, setPaused] = useState(false);
  // ★ M5a：课堂级「锁定作答」。与 `paused` 同一类（专门 state + socket 事件），
  // 理由见 `use-chat-socket.ts` 的那两条监听器与 `classroom-types.ts` 的 `ModulePanelProps`。
  const [answersLocked, setAnswersLocked] = useState(false);
  /**
   * ★ 2026-09-30：教师「逐题开放」的清单（`{ [学习单 id]: [已开放的题 id…] }`）。
   *
   * 🔴 **初值不从这个 15 秒快照里取**（与上面 `answersLocked` 相反，这是刻意的）：
   *    学生端那份清单的**权威来源是面板自己那次 `student-view` 读取**（它比快照新，
   *    而且知道「是哪一份单」—— 高级模式下各组不同）。这里只承载 **socket 上那条广播**，
   *    面板按「广播里有没有这一份单的键」决定用哪个（见 `worksheet-panel.tsx`）。
   * ⚠️ 已知缺口：**socket 断线重连期间错过的那几条广播不会补发**（本仓既有的
   *    「不补发」纪律）⇒ 学生要刷新一次、或切走再切回面板才拿到最新清单。
   *    这与作答数据那条路是同一个性质（那条也不补发），不在本次扩大范围。
   */
  const [worksheetOpen, setWorksheetOpen] = useState<Record<string, string[]>>({});
  const [agentDisabled, setAgentDisabled] = useState(false);
  /**
   * 探究空间按需推流：本课堂此刻有没有教师在看探究空间视图（P2 / Ruling 9）。
   *
   * 初值只在 `join-classroom` 成功后由服务端下发一次，而探究空间面板是**惰性挂载**的
   * （学生点开才挂）—— 所以这条状态必须由会话层持有，面板只能读。写在 `use-chat-socket`
   * 的回调里（那批 socket 监听器的家），与 `paused` 同一类。
   */
  // 初值必须是「认不出就用默认」那一侧：在服务端下发第一条 demand 之前，
  // 学生端**不该**因为"还不知道设置"就当成关闭。
  const [webappDemand, setWebappDemand] = useState<WebappDemand>({
    watching: false,
    detail: false,
    captureEnabled: true,
    width: 320,
    frameIntervalMs: 10_000,
  });
  const [shieldWarning, setShieldWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<ChatToast | null>(null);
  // 下面这批状态的写入点同样在 useChatSocket 的回调里。M1a Task 3 把该 hook 上移到本文件
  // 之前，它们住在面板里，靠「面板挂载/卸载」隐式重置；socket 归外壳后，面板在
  // 学生没进入学伴（或已切到别的 Tab）时并不在写这些值的那一侧（socket 仍在），
  // 所以所有者必须是外壳，否则 socket 回调写进不可见的面板会被丢弃。
  // 面板重挂时的隐式重置，由 handleIdentityConfirm 显式补齐。
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
      // ★ M5a：与 `status` 同一条通道（这条快照就是 `api.getClassroomByCode`）。
      // ⚠️ **只置位、不清除** —— 与上面那行 `paused` 逐字同款：刷新页面/重进课堂时
      // 服务端说的是真话，而清除会把一次还没到达的广播态误判成「已解锁」。
      // `=== true` 是刻意的：老服务端不发这个字段 ⇒ 按「未锁定」处理。
      if (cr.answersLocked === true) setAnswersLocked(true);
      // 如果是从缓存恢复会话，检查该学生/小组绑定的智能体是否停用。
      // 🔴 「该用哪个智能体」不在本文件判断 —— 统一走 `@/lib/classroom-material` 的
      // `effectiveGroupAgent`（**高级模式不回落**）。这里原来是又一份「先找自己组的、
      // 找不到回落到 `classroom.agents[0]`」，而该数组在高级模式下曾是各组智能体的并集
      // ⇒ 没配智能体的组会按**别的组的**停用态显示（spec §1.2 ①）。取不到就是取不到，
      // 没有可停用的智能体 ⇒ 不置位（「本组没有智能体」与「智能体被停用」是两件事）。
      if (sessionStudentId && (cr.mode === 'group' || cr.mode === 'advanced') && cr.groups) {
        // 需要先获取学生的 groupId（它只在这个名单接口里下发）
        try {
          const sts = await api.getClassroomStudents(cr.id);
          const myStudent = sts.find((student) => student.id === sessionStudentId);
          if (effectiveGroupAgent(cr, myStudent)?.enabled === false) setAgentDisabled(true);
        } catch {}
      } else {
        if (effectiveGroupAgent(cr, null)?.enabled === false) setAgentDisabled(true);
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
    // ★ 2026-09-25（教师 2026-09-23 截图批注）：**进入时丢掉「上次停在哪个模块」那条存档**。
    // 🔴 只写 `setStep('home')` 是不够的：外壳挂载时那个恢复 effect
    //（`shell/use-module-tabs.ts`）会把存档读回来，把学生直接送进**上一个学生离开的模块**。
    // 共用 iPad 上这是必然发生的 —— 上一位留在探究空间，下一位一进来就在探究空间，
    // 而他什么都没点；教师看板跟着 `module-focus` 走，监测到的也是错的模块。
    // ⚠️ **刷新不走这里**（刷新走 `chat_session_<code>` 自动重连，不过身份页）⇒
    //    刷新仍然停在他原来那一块，P2.3 的行为一个字没动。
    // ⚠️ 顺序要紧：必须在 `setStep('home')` 之后、外壳挂载**之前** —— 挂载时那个 effect
    //    读的就是这条存档。
    clearStoredModule();
    // 保存会话到 localStorage
    try { localStorage.setItem(`chat_session_${code}`, JSON.stringify({
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      token,
      timestamp: Date.now(),
    })); } catch { setToast({ msg: '浏览器无法保存会话，刷新后需重新选择身份；当前课堂仍可使用。', type: 'error' }); }
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
    try { localStorage.removeItem(`chat_session_${code}`); } catch { /* 身份与令牌仍在内存中清除 */ }
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
    try { localStorage.removeItem(`chat_session_${code}`); } catch { /* 身份与令牌仍在内存中清除 */ }
    setStudentSessionToken();
    o.router.push('/');
  };

  // 课堂已结束（15 秒轮询兜底发现「已结束」状态，或 API 报「课堂已结束/互动码无效」）。
  // 与 handleExit 刻意不同：不主动断 socket、不清学生 token、没有 waitingAI 闸门 ——
  // 课堂已经结束了，这里只清本地会话、提示、整页回首页。这三步与 useChatSocket 的
  // classroom-ended 处理等价（那边用 optionsRef.current.code，同一会话期取值相同），
  // 也就是说外壳内目前有两份同样的三行逻辑 —— 合并要动 ChatSocketOptions，留给 M1b。
  // 必须 useCallback：[code] 之外身份稳定，否则下面那条轮询 effect 每次渲染都会重建
  // setInterval —— 流式回复期间渲染频繁，15 秒的兜底轮询将几乎永不触发。
  const handleClassroomEnded = useCallback(() => {
    try { localStorage.removeItem(`chat_session_${code}`); } catch { /* 身份与令牌仍在内存中清除 */ }
    setToast({ msg: '课堂已结束', type: 'info' });
    optionsRef.current.router.push('/');
  }, [code]);

  /**
   * 最近一次渲染时的 `classroom.modules` 对象身份，只给下面那条轮询判断「快照是否陈旧」用。
   *
   * 为什么必须是 ref 而不是把 `classroom.modules` 放进轮询 effect 的依赖：那样每来一次广播
   * （`applyModuleState` 换新数组）就会重建定时器，15 秒的兜底会被广播刷没。
   *
   * ⚠️ 本 effect 必须声明在轮询 effect **之前**：同一次提交里 effect 按声明顺序执行，而轮询
   * 一挂载就会立刻 `poll()` 一次 —— 排在后面的话，首次请求会拿着上一轮的初值去比。
   */
  const modulesSnapshotRef = useRef<StudentClassroom['modules'] | undefined>(undefined);
  useEffect(() => { modulesSnapshotRef.current = classroom?.modules; }, [classroom?.modules]);

  /**
   * 最近一次渲染时的 `paused` / `agentDisabled`，只给下面那条轮询判断「快照是否陈旧」用
   * （M1b-2 Task 11 补入）。
   *
   * 为什么与 `modules` 用**同一种手法**（而不发明新机制）：这三项在**同一条轮询响应**里落地
   * （`status` / `agents` / `modules` 都来自 `api.getClassroomByCode(code)`），陈旧窗口也是同一个
   * RTT。只给 `modules` 加守卫的话，同一个窗口里另外两项仍会把**广播之后**的状态写回
   * **广播之前**的视角：教师在 T0+RTT/2 停用智能体（socket `agent-disabled` 已落地
   * `setAgentDisabled(true)`），T0+RTT 到达的旧快照说「启用」⇒ 横幅与发送闸门回退，
   * 最长到下一轮（15 秒）。`paused` 同理（`classroom-paused` 广播被旧快照压掉）。
   *
   * 布尔量没有「数组身份」可比，所以比对的是**值**：发起请求时把当前值抓进局部量，
   * 落地时用函数式 setter 看 `prev` 是否仍是那一刻的值 —— 不同就是中间有广播落地过，
   * 跳过本轮。与 `modules` 那条一样是**往「保留更新值」的方向错**（宁可漏一次轮询的刷新，
   * 15 秒内自愈），不是往「复活陈旧值」的方向错。
   *
   * ⚠️ 本 effect 同样必须声明在轮询 effect **之前**（同一次提交里 effect 按声明顺序执行，
   * 而轮询一挂载就立刻 `poll()` 一次）。
   */
  const flagsSnapshotRef = useRef<{ paused: boolean; agentDisabled: boolean; answersLocked: boolean }>({
    paused: false, // 与上面几个 useState 的初值一致
    agentDisabled: false,
    answersLocked: false,
  });
  useEffect(() => { flagsSnapshotRef.current = { paused, agentDisabled, answersLocked }; }, [paused, agentDisabled, answersLocked]);

  // 课堂生命期轮询（15 秒）：课堂是否结束、智能体是否被停用、课堂是否暂停，外加三态兜底。
  // M1b-2 Task 6 把它从学伴面板（chat-panel.tsx 的 poll）搬到这里。
  //
  // **为什么必须搬**：这条观察的是**会话生命期**，与「学伴模块此刻是否可见」无关 —— 面板自
  // Task 4 起只在学生点开学伴卡片后才挂载（§4.5 惰性挂载，§4.8 低性能降级模式下还会
  // 「切走即销毁」），把会话生命期的观察者放进模块面板，等于让「学生点没点开学伴」决定课堂
  // 结束能不能被兜住。推送路径（use-chat-socket 的 `classroom-ended`）本身是会话级的、面板
  // 不挂载也收得到，所以真正的缺口是**它覆盖不到的那两个窗口**：socket 断线期间课堂结束
  // （重连成功时服务端 join-classroom 只回 `ai-error`「课堂不存在或已结束」，**不会**补发
  // `classroom-ended`，学生端只把它塞进 connectionError 横幅、停在原地），以及断线后没再
  // 连上的情况 —— 这两个窗口唯一的兜底就是这条轮询。宿主因此是本 hook（会话的持有者），
  // 而不是任何一个模块面板。T1 当初坚决不给它加 `active` 门，
  // 理由同此，本次搬迁不改变这一点。
  //
  // 四件事，前三件与搬迁前逐字一致：
  //   1. `status === 'ended'` → 清本地会话、提示、整页回首页（handleClassroomEnded）
  //   2. 分组/高级模式看当前小组绑定的智能体，其余看第一个 ⇒ agentDisabled
  //   3. `status === 'paused'` ⇒ paused
  //   4. **合并 `cr.modules`**（Task 6 新增，§4.11 B1）：M1b-1 在 use-chat-socket 的 connect
  //      回调里加的补读只覆盖「连接成立前」与「断线期间」两个窗口，「连接存活期间漏掉一次
  //      广播」此前**没有任何兜底** —— 这条轮询拿到了 `modules` 却把它丢掉。只合并 modules、
  //      不整对象覆盖，与 connect 补读同一口径（整对象覆盖会让一次陈旧读取复活
  //      status / allowStudentStop 等字段）。
  //
  // 闸门是 `step` 而不是 `active`：轮询窗口 =「已进入课堂」（首页或某个模块），这是会话相位，
  // 不是模块呈现。加载页与身份页不跑 —— 那里课堂还没进入，课堂结束该就地提示
  // （loadError / 身份确认失败），而不是静默整页跳转。
  //
  // 依赖里除原始值以外全是稳定引用：handleClassroomEnded 已 useCallback([code])（§4.10 C9
  // 点名过的坑），setPaused / setAgentDisabled / setClassroom 是 useState setter。任何一项
  // 变成每次渲染新建，15 秒的兜底就会退化成「几乎永不触发」。
  useEffect(() => {
    if (!code) return;
    if (step !== 'home' && step !== 'shell') return;
    const poll = async () => {
      // 只取**原始值**再交给解析函数，不把 `selectedStudent` 整个对象传进去：依赖数组里放的是
      // `selectedStudent?.groupId`（这个 effect 的注释上面写了为什么不能放整个对象 —— 身份一变
      // 就重建定时器，15 秒的兜底会被广播刷没）。传 `{ groupId }` 与传整个对象等价：
      // `effectiveGroupAgent` 只读 `groupId` 这一个字段。
      const groupId = selectedStudent?.groupId;
      // 发起请求那一刻的 `modules` 对象身份，用来在后面判断「这份快照是不是已经陈旧」。
      // 只读 ref，不进依赖：`classroom.modules` 一变就重建定时器，15 秒的兜底会被广播刷没。
      const modulesAtRequest = modulesSnapshotRef.current;
      // 同一刻的 paused / agentDisabled 值，同一用途（见上面 flagsSnapshotRef 的注释）。
      const flagsAtRequest = flagsSnapshotRef.current;
      try {
        const cr = await api.getClassroomByCode(code);
        if (cr.status === 'ended') {
          // 课堂已结束：清本地会话、提示、整页回首页 —— 编排归外壳
          handleClassroomEnded();
          return;
        }
        // 这一轮该看的智能体是不是被停用了 —— 取哪一个是 `effectiveGroupAgent` 一家的事
        // （**高级模式不回落**，与 `loadClassroom` 那处、以及 `chat-panel` / `student-home`
        // 两个展示点是同一个函数）。原来这里也有自己的一份「找组、回落课堂级」。
        // ⚠️ 轮询这一路**两个方向都会写**（停用后又被启用要能恢复），与 `loadClassroom` 那条
        // 「只置位、不清除」不同 —— 这里靠下面的陈旧守卫防止用旧快照把新值写回去。
        const freshAgentDisabled = effectiveGroupAgent(cr, { groupId })?.enabled === false;
        setAgentDisabled((prev) => (prev === flagsAtRequest.agentDisabled ? freshAgentDisabled : prev));
        const freshPaused = cr.status === 'paused';
        setPaused((prev) => (prev === flagsAtRequest.paused ? freshPaused : prev));
        // ★ M5a：锁定态走**同一条**陈旧守卫 —— 同一份快照、同一个 RTT，
        // 少了它，锁定广播会被一个在它之前发出的旧快照压回去（最长 15 秒）。
        const freshAnswersLocked = cr.answersLocked === true;
        setAnswersLocked((prev) => (prev === flagsAtRequest.answersLocked ? freshAnswersLocked : prev));
        // 三态兜底。`freshModules` 先落成局部量：旧服务端/老库可能真的不带这个字段，
        // 那种情况保留现有三态，不要把已就绪的态清成默认值。
        const freshModules = cr.modules;
        if (!freshModules) return;
        setClassroom((prev) => {
          if (!prev) return prev;
          // 陈旧快照守卫：请求发出之后有广播落地（`applyModuleState` 每次都换一个新数组）
          // ⇒ 这份响应的 `modules` 是**广播之前**的视角，合并回去会把老师刚改的态写回旧值
          // （例如广播已把 X 改成 hidden，随后到达的旧快照说 open）。跳过本轮，等下一轮 ——
          // 15 秒内自愈，而且往「保留更新值」的方向错。
          if (prev.modules !== modulesAtRequest) return prev;
          const current = prev.modules ?? [];
          // 只在真的变了时才写回。无条件 `{...prev, modules}` 会每 15 秒换一次 `classroom`
          // 的对象身份 ⇒ 整个外壳（含常驻的学伴面板）每 15 秒重渲染一次，老 iPad 上不值当。
          //
          // 逐**键**比较而不是指名 `moduleKey` / `state` 两个字段：今天两者等价
          // （`ClassroomModuleSetting` 只有这两个字段），但将来给元素加一个被 UI 读取的
          // 字段时，指名的写法会**静默压掉**它的合法更新。键集合来自元素自身，加了就自动比。
          //
          // ⚠️ 「键集合自动跟着元素长」只在新增字段**是 UI 字段**时是收益，方向反过来就是代价：
          // 若将来给元素加一个**非 UI 字段**（例如 `updatedAt`）且它在**同一状态**下会变化，
          // 逐键比较就会判成「变了」⇒ 换掉数组身份 ⇒ 每 15 秒整树重渲染一次（含常驻的学伴
          // 面板），恰好把这个守卫存在的意义抵消掉，且没有任何信号 —— 看起来只是「多渲染了
          // 几次」。所以将来加字段时：**要么只比一个稳定的字段集，要么加白名单**。
          const unchanged = current.length === freshModules.length
            && current.every((m, i) => {
              const next = freshModules[i];
              const keys = Object.keys(m) as (keyof typeof m)[];
              return keys.length === Object.keys(next).length && keys.every((key) => m[key] === next[key]);
            });
          return unchanged ? prev : { ...prev, modules: freshModules };
        });
      } catch (error: unknown) {
        // 课堂已结束（API 返回 404 或 400）
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('课堂已结束') || msg.includes('互动码无效')) {
          handleClassroomEnded();
        }
      }
    };
    poll(); // 立即执行一次
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [code, step, selectedStudent?.groupId, handleClassroomEnded, setAgentDisabled, setPaused, setClassroom]);

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
    setAnswersLocked,
    setWorksheetOpen,
    setSelectedStudent,
    setShieldWarning,
    setStep,
    setStreamingContent,
    setTeacherMsgs,
    setTeacherNotifBubble,
    setThinkingContent,
    setToast,
    setWaitingAI,
    setWebappDemand,
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
  // 面板不再住在身份页里（Task 5 起它由外壳挂载）后这段会失去身份页窗口，故上移到外壳
  // 恢复基线行为。依赖数组与基线完全一致（无 step / active 闸门）。
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
    answersLocked,
    worksheetOpen,
    agentDisabled,
    webappDemand,
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
    setAnswersLocked,
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
