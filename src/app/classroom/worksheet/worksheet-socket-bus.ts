/**
 * ★ 2026-09-28：学生端与看板之间那两条**命令**的桥（**双向**，各一条）。
 *
 *   · **进站**（教师 → 学生）：`publishWorksheetClear` / `subscribeWorksheetClear` ——
 *     「教师清除了这名学生在这份学习单上的作答」；
 *   · **出站**（学生 → 教师）：`publishDraftPreview` / `subscribeDraftPreview` ——
 *     「他此刻正在写什么」（不写库，只喂看板那一格的实时预览）。
 *
 * 🔴 **两条都必须绕开 React state**，理由见下面「为什么是一条总线」那一段；
 * 而它们**只能**由 `useChatSocket` 收发 —— 学生端唯一进得了 `student:<id>` 房间、
 * 也唯一带着会话身份的那条连接在那里。
 *
 * ⚠️ 文件原名 `worksheet-clear-bus.ts`（只有进站一条）—— 出站加进来之后那个名字就是
 * 假的了，所以改了名。**别按旧名字去找它。**
 *
 * ── 为什么是一条总线，而不是会话层的 state ─────────────────────────────
 *
 * ── 为什么是一条总线，而不是会话层的 state ─────────────────────────────
 * 我第一版把它做成了 `useState`：socket 回调 → `setWorksheetClear` → 会话层 state →
 * 外壳 → 面板 → 学习单 hook。**教师报「学生在输入时清除该题 ⇒ 学生端浏览器假死」**，
 * 而我把那条链上的每一段读了三遍都没读出回路。读不出来就不该继续在上面加东西 ——
 * 所以换掉形状。
 *
 * 🔴 **形状本来就不对**：清除是一条**命令**（边沿触发、发生一次就没了），
 * 不是**状态**（电平触发、随时可读）。本仓既有那两个走 state 的
 *（`answersLocked` / `webappDemand`）**都是状态** —— 它们要能被随时读出来（面板惰性挂载
 * 之后仍要知道「此刻锁着吗」）。而这条命令**不需要被读**：它只在发生的那一刻有意义。
 * 拿 state 装命令的代价是**每一次投递都要让整棵会话树重渲染一遍**，而那条重渲染路径
 * 上有整个外壳、所有面板 —— 那是一大片我没能证明其无环的代码。
 *
 * ⇒ 总线上的投递**不经过任何 React 状态**：`useChatSocket` 收到事件就 publish，
 *   学习单 hook 自己在 effect 里 subscribe。链路上一个 setState 都没有。
 *
 * ⚠️ **模块级单例是有意的**，与 `@/lib/socket` 的 `getSocket()` 同一类（本项目已经这么做）。
 * 它不持有 React 状态，只持一份监听器清单 —— 卸载时退订，不会泄漏。
 *
 * ⚠️ **订阅之前发出的命令不会补发**（没有「回放」）。这是**要的**：
 *   换身份再切回来时学习单面板会重挂，而重放一条十几分钟前的清除指令会把学生
 *   **在那之后重新答的**内容抹掉。旧版靠一个 `seenClearTokenRef` 手工挡这件事，
 *   现在它变成结构性的（收不到就是收不到）。
 */

/** 一条清除指令。 */
export interface WorksheetClearCommand {
  /**
   * 单调递增的序号。
   * ⚠️ **不用 `Date.now()`**：同一毫秒内的两次清除会撞成同一个值，而那时第二次
   * 不会被处置（两个 token 相等）—— 两边都不报错。
   */
  token: number;
  classroomId: string;
  participantId: string;
  worksheetId: string;
  /** `null` = 整张清除；非空 = 只清了那一题。 */
  questionId: string | null;
}

type Listener = (command: WorksheetClearCommand) => void;

const listeners = new Set<Listener>();
let sequence = 0;

/**
 * 发一条清除指令。**由 `useChatSocket` 调用**（那是唯一进得了 `student:<id>` 房间的连接）。
 *
 * ⚠️ **遍历的是副本**（`[...listeners]`）—— 防的是「**投递途中新订阅的监听器也收到这一条**」。
 *
 * ⊘ 这里原先写的理由是「监听器在处置途中退订会让后面的被跳过」，**那句是错的**（我写了一条
 * 假注释，靠 mutation 检查抓出来的）：`Set` 的迭代规范保证「删掉**当前**元素不影响后续」，
 * 所以「自己退订自己」在直接遍历下也是安全的。真正有区别的是**新增**：直接遍历 `Set`
 * 会访问到迭代途中加进去的元素（规范如此），于是一个在处置途中挂上来的监听器
 * 会收到**它订阅之前**发出的那一条 —— 那正好破坏了本文件承诺的「不补发」，
 * 而它又是一条**结构性**保证（`use-worksheet-answers` 靠它挡「换身份重挂时被旧指令抹掉」）。
 */
export function publishWorksheetClear(data: {
  classroomId: string;
  participantId: string;
  worksheetId: string;
  questionId?: string | null;
}): void {
  sequence += 1;
  const command: WorksheetClearCommand = {
    token: sequence,
    classroomId: data.classroomId,
    participantId: data.participantId,
    worksheetId: data.worksheetId,
    questionId: data.questionId ?? null,
  };
  for (const listener of [...listeners]) listener(command);
}

/** 订阅清除指令；返回退订函数（直接给 `useEffect` 的返回值用）。 */
export function subscribeWorksheetClear(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/* ═══════════════════════════════════════════════════════════════════════
   出站：学生 → 教师（「他此刻正在写什么」）
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 一条「正在输入」的预览。
 *
 * 🔴 **它不是一份可以回读的状态，而是一次性的播报** —— 收到就用、没有就什么都不显示。
 * 所以不存历史、不回放、也不与库里的作答行合并（两者刻意分开：
 * 「格子里的实时内容」与「库里的已保存内容」**不是同一份**，见看板那一侧的注释）。
 */
export interface DraftPreview {
  /**
   * 哪一间课堂。🔴 **服务端要拿它核身份**（与 `socket.data.classroomId` 比）——
   * 不核的话，一个学生可以往**别的课堂**的看板里灌内容。
   * ⚠️ 客户端送来的这个值**只是「他以为自己在哪」**，判据在服务端那一侧。
   */
  classroomId: string;
  /**
   * 哪一份学习单。⚠️ 服务端**不从库里推**（socket 只记了课堂，不知道学生在看哪一份）——
   * 所以这个值必须由客户端带，而它只用来**转发**（看板按 participantId + worksheetId 归档）。
   */
  worksheetId: string;
  /** 哪一道题（**必须**带上：没带题号的话看板不知道这个内容该画在哪一题上）。 */
  questionId: string;
  /** 此刻那一题的值。⚠️ 可能是**降过采样**的笔迹（见 `downsampleInkValue`）。 */
  value: unknown;
}

type DraftListener = (preview: DraftPreview) => void;
const draftListeners = new Set<DraftListener>();

/**
 * 发一条输入预览。**由学习单的作答 hook 调用**（它才知道学生正在写哪一题）。
 *
 * ⚠️ **节流由调用方负责**：这一层只做投递。理由与清除那条相反 ——
 * 清除是低频事件（教师点一下），这里是**每次敲键都要走**的地方，
 * 节流策略得和「谁在什么时机调用」放在一起才读得通。
 */
export function publishDraftPreview(preview: DraftPreview): void {
  for (const listener of [...draftListeners]) listener(preview);
}

/** 订阅输入预览。**由 `useChatSocket` 调用**（它负责把这条转发到服务端）。 */
export function subscribeDraftPreview(listener: DraftListener): () => void {
  draftListeners.add(listener);
  return () => { draftListeners.delete(listener); };
}

/** 仅供测试：清空两条通道的全部监听器与序号（用例之间不互相污染）。 */
export function resetWorksheetClearBusForTest(): void {
  listeners.clear();
  draftListeners.clear();
  sequence = 0;
}
