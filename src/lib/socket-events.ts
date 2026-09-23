export interface ServerToClientEvents {
  [event: string]: (...args: never[]) => void;
  // 服务端 join-classroom 成功后下发（server/src/socket/index.ts 的 socket.emit('joined', …)）。
  // 学生端目前不监听它（首屏与兜底都走 GET /code/:code 轮询），但声明按真实 payload 写，
  // 免得以后有人照着旧的 { classroomId, blacklisted } 去用而拿到 undefined。
  joined: (data: {
    classroomId: string;
    agents: { id: string; name: string; logo: string | null; platform: string }[];
    // P2 起每组的材料是 `{ agent, webapp }`，**两个都可以是 `null`**
    // （`ClassroomGroupMaterial` 解析而来，见 server/src/socket/index.ts 的 `emit('joined')`
    // 与 services/group-material-resolve.ts 的 GroupMaterialView）。`agentId` 已随那一列删掉。
    groups: {
      id: string;
      name: string;
      agent: { id: string; name: string; logo: string | null; platform: string; enabled: boolean; greeting: string | null } | null;
      webapp: { id: string; name: string; entryPath: string } | null;
    }[];
    blacklisted: boolean;
  }) => void;
  'student-auth-error': (data: { error: string }) => void;
  'teacher-auth-error': (data: { error: string }) => void;
  'classroom-ended': () => void;
  'classroom-paused': () => void;
  'classroom-resumed': () => void;
  'allow-stop-changed': (data: { allow: boolean }) => void;
  'allow-export-changed': (data: { allow: boolean }) => void;
  'follow-ups-changed': (data: { allow: boolean }) => void;
  // 教师端 PUT /:id/modules/:moduleKey 后向 classroom:<id> 与 teacher:<id> 双发。
  'module-state-changed': (data: { moduleKey: string; state: string }) => void;
  'avatar-rewarded': (data: { tokens: number }) => void;
  'online-students': (data: { classroomId: string; studentIds: string[] }) => void;
  'export-progress': (data: { progress: number; stage: string }) => void;
  // ── 探究空间实时监控（P2 / 规格 §5.5）────────────────────────────────
  // 事件名与载荷由 T5 定死，T6（学生端面板）与 T7（教师看板）都照这里写，不得自行发明。
  //
  // ⚠️ **文字档只恢复了两项**（P2.2 的 T5）：`visibility` 与 `scroll`。
  // 点击 / 输入 / 页面内跳转**不采集**，那条通道没有回来，也不要加回来。
  //
  // 教师看板：只发给 `teacher:<id>:webapp` 房间里的人（= 正开着探究空间视图的教师）。
  // 没有教师订阅时服务端**一个字节都不转发**（Ruling 9 的按需推流）。
  // 缩略图：每个学生每个网页**只保留最新一帧**，旧的直接被覆盖（不是追加）。
  'webapp-student-frame': (data: { studentId: string; webappId: string; dataUrl: string; at: number }) => void;
  // 文字档：每个学生每个网页的**当前状态**（不是流水账 —— 服务端只留一条，见
  // server/src/socket/index.ts 的 WebappPresenceEntry）。载荷与 `webapp-frame` 同款，
  // 就是「这个键现在长什么样」。
  'webapp-student-presence': (data: WebappPresenceUpdate) => void;
  /**
   * 服务端 → 教师端：**这个学生的设备拍不出这个网页的画面**。
   *
   * 🔴 与「等待画面…」**必须是两句不同的话**（本文件既有原则：已打开 / 等待画面… / 未打开
   * 说的是三件不同的事）。这一句说的是：**SDK 已经试过、失败了、并退避了**。
   *
   * 实测背景（2026-09-22）：老 iPad 上的纯 DOM 网页，snapdom 生成的那张 SVG 在 Safari 15
   * 上解码不出来 ⇒ 永远没有缩略图。这是平台限制（见 `server/vendor/README.md`），
   * 不是待修的 bug —— 所以教师端要能把这句说出来，而不是让学生那一格永远停在
   * 「等待画面…」（那句话说的是「第一帧还在路上」）。
   *
   * ⚠️ 载荷里**只有身份与时刻**，没有任何画面或内容。
   */
  'webapp-student-capture-blocked': (data: { studentId: string; webappId: string; at: number }) => void;
  // 学生端：本课堂此刻的按需推流档位。
  //   · 学生在 join-classroom 成功后**立刻**收到一次（决定要不要开始截图）；
  //   · 教师订阅时下发 watching:true；
  //   · 教师全部离开时**延迟 15 秒**才下发 watching:false（防刷新抖动，Ruling 9）。
  // ⚠️ **逐学生下发**（`broadcastWebappDemand`），不是广播：`detail` 只有被点开详情的
  //    那一个学生为真。⚠️ 载荷里的 `detail` **不是**截图间隔 —— 间隔由 SDK 自己按
  //    「关注度基准 × 设备耗时降档」算，这里只给「教师想多快」那一维（见 SDK 的
  //    FRAME_INTERVAL_BASE）。服务端不下发耗时档位，SDK 也不自己判断有没有人在看。
  'webapp-monitor-demand': (data: WebappDemand) => void;

  /**
   * 服务端 → 教师：某学生**此刻在看哪个模块**（`null` = 首页）。P2.3 的看板「跟随」模式用。
   *
   * ⚠️ 教师**中途**进来看板时，服务端会为课堂里每个已知状态**各补发一条**（回放）——
   * 学生只在变化时上报，不回放的话，那些"已经在某个模块里待着"的学生会显示成
   * "不知道他在哪"，而他们明明正开着。
   */
  'student-module-focus': (data: { studentId: string; moduleId: string | null; at: number }) => void;

  /**
   * 服务端 → 教师：**某参与者的某道题有了一次作答**（保存或者提交单题）。学习单看板格子的数据源。
   *
   * 🔴 房间是 **`teacher:<classroomId>`**，不是 `classroom:<id>`（那是**学生**房间）：
   * 载荷里带着每名学生的作答状态与对错，发到学生房间等于把全班情况广播给全班。
   * 这条由 `server/src/tests/worksheet-realtime.test.ts` 钉住 —— 那条用例先跑一次真实的
   * `join-teacher-board` 量出房间前缀，再与路由实际广播的房间比对，并正面断言它不是学生房间。
   *
   * ⚠️ **只发「刚落库的那一行」**（不是请求体）：看板看到的必须是库里的真相。
   * `isCorrect` / `gradeState` / `score` 三者**同生共死**：为 `null` = 没开自动判分
   * 或这题是主观题（`grade()` 回 `null`）。
   *
   * ⚠️ 这里曾经写着「规格 §3-S：不下发 `score`」—— **那句话已作废**（规格 §12 明写
   * M4 重开了 §3-S）：奖励显示现在**由得分驱动**，不下发 `score` 恰恰等于画不出奖励。
   * 三态之后 `score` 也**不再可由 `isCorrect` 推导**（`false` 同时覆盖 incorrect 与 partial）。
   *
   * ⚠️ 没有历史回放、也没有拉取历史的 REST 端点：看板只知道**打开之后**发生的作答，
   * 所以格子上「一条都没收到」的情形**不能说成「还没开始作答」**（见
   * `src/app/teacher/classroom/worksheet-tile-state.ts` 的 `no-progress`）。
   */
  'worksheet-answer-updated': (data: {
    classroomId: string;
    /** 参与者 id（= 课堂参与者 `ClassroomStudent.id`，小组模式下就是那个组）。 */
    participantId: string;
    /** 哪一题。看板的「正在做第 N 题」完全靠它（规格 §3-H / §5.7）。 */
    questionId: string;
    /** `'draft'`（保存）或 `'submitted'`（提交本题）。 */
    status: string;
    /**
     * 🔴 **协议字段，只增不改**：语义已收窄为「**全对**」（规格 §12），由 `gradeState` 派生。
     * 改名 ⇒ 前端拿到 `undefined` ⇒ 静默不画 ✓/✗，**没有任何报错**。
     * `null` = 没判分（主观题 / 关了自动判分）。
     */
    isCorrect: boolean | null;
    /**
     * ★ M4a 新增：三态（`correct` / `partial` / `incorrect`），`null` = 没判分。
     * 看板的 ◐ 半对档只能来自它 —— `isCorrect: false` 推不出「是错还是半对」。
     */
    gradeState: string | null;
    /**
     * ★ M4a 新增：这道题拿到的**绝对数**（教师逐题填的档），`null` = 没判分。
     * ⚠️ 与 `gradeState` 同生共死，别只读一个。
     */
    score: number | null;
    /** 教师标记「已查看」的时刻（ISO 串），没看过是 `null`。 */
    reviewedAt: string | null;
  }) => void;
}

/**
 * 探究空间按需推流的档位。服务端**逐学生**下发，每个学生收到的就是它自己该用的那一份。
 *
 * `watching=false` 时 `detail` 必然为假 —— 服务端保证不发出「没人在看但你在高频」
 * 这种组合（见 `broadcastWebappDemand`）。
 */
export interface WebappDemand {
  /** 本课堂此刻有没有教师在看探究空间视图。 */
  watching: boolean;
  /** 教师是否**点开了这个学生**的详情 —— 整间教室里只有那一个学生为真。 */
  detail: boolean;
  /**
   * 本课堂是否采集**画面**。false ⇒ 学生端不传任何图片，只传文字档
   * （可见性 + 滚动深度）—— 那是给跑不动的老设备用的便宜档。
   *
   * ⚠️ **服务端是唯一权威**：这三个值都由服务端按课堂设置归一化后下发（夹过范围），
   * 客户端只读不推导。`width` 与 `frameIntervalMs` 同理。
   */
  captureEnabled: boolean;
  /** 缩略图目标宽度（像素）。服务端已夹在 160~640。 */
  width: number;
  /** **本档**的截图基准周期（毫秒）。wall 与 detail 的差别已由服务端算好。 */
  frameIntervalMs: number;
}

export interface ClientToServerEvents {
  [event: string]: (...args: never[]) => void;
  'join-classroom': (data: { classroomCode: string; studentId: string; token?: string }) => void;
  'join-teacher-board': (classroomId: string) => void;
  'listen-classroom-status': (classroomId: string) => void;
  'send-message': (data: { classroomCode: string; studentId: string; content: string; fileUrls?: string[]; fileNames?: string[] }) => void;
  'stop-generation': () => void;
  'teacher-send-notification': (data: { classroomId: string; studentId?: string; groupId?: string; message: string }) => void;
  // ── 探究空间实时监控（P2 / 规格 §5.5）────────────────────────────────
  // 学生端 → 服务端。带 classroomId：服务端要拿它与 socket 会话比对（归属校验），
  // 光靠 socket 想定身份会让「同一条连接换课堂」这类错误无声通过。
  // ⚠️ 两条通道的**内容范围**不同，别把它们当成同一件事：
  //   · `webapp-frame` —— 定时快照（受 captureEnabled 影响，关掉就不发）；
  //   · `webapp-event` —— **文字档**（可见性 / 滚动深度），captureEnabled 为 false 时
  //     **照样要发** —— 那正是它的用武之地。
  'webapp-event': (data: { classroomId: string; webappId: string; events: WebappEvent[] }) => void;
  'webapp-frame': (data: { classroomId: string; webappId: string; dataUrl: string }) => void;
  /**
   * 学生端 → 服务端：**截图失败的诊断**（第 5 条通道的落点）。
   *
   * 🔴 存在的理由：Safari 在 iOS 上**不把跨源 iframe 单列成可检查目标**
   * （实测 2026-09-22：Mac 的「开发」菜单下那台 iPad 只有父页面一个目标），
   * 于是 SDK 在 iframe 里的 `console.warn` **结构上取不到** —— 老 iPad
   * 「有浏览位置、没有图片」的失败原因因此一直不可见。这条把它送到服务端日志。
   *
   * ⚠️ **载荷只有一个封闭枚举码 + 三个整数，没有任何自由字符串。**
   * 这条通道**不放松**「SDK 里装不下任何页面内容」那条保证 ——
   * 它把可上报的东西从「有无」细化到「哪一类」，范围没有变宽。
   */
  'webapp-diag': (data: {
    classroomId: string;
    webappId: string;
    /** 封闭枚举码，见 `use-explore-bridge.ts` 的 `DIAG_CODES` 与 SDK 的同名表。 */
    code: string;
    /** 含义随 code 而定（耗时 ms / 字符数），恒为非负整数。 */
    n: number;
    w: number;
    h: number;
  }) => void;
  // 教师端 → 服务端：视图挂载 / 卸载。服务端据此维护 `teacher:<id>:webapp` 房间，
  // 并按需广播 webapp-monitor-demand。⚠️ 卸载时必须发 unwatch，否则学生端永不停止推流。
  'watch-webapp-monitor': (data: { classroomId: string }) => void;
  'unwatch-webapp-monitor': (data: { classroomId: string }) => void;
  // 教师端 → 服务端：**点开了哪个学生**的详情（`studentId: null` = 关掉）。
  // 只影响那一个学生端的截图频率（wall → detail）。⚠️ 这条直接改变**学生设备**的开销，
  // 所以服务端按教师 cookie + 课堂绑定鉴权（与订阅同款）。
  'focus-webapp-student': (data: { classroomId: string; studentId: string | null }) => void;
  /**
   * 学生端 → 服务端：这个学生**此刻在看哪个模块**（`null` = 首页）。P2.3 的看板「跟随」模式用。
   *
   * ⚠️ 载荷里**只有"在哪个"，没有任何内容**。而且它是**变化时**才发（几十字节），
   * 不是心跳 —— 教师中途进来看板时由服务端**回放**当前状态，不靠学生重发。
   */
  'module-focus': (data: { classroomId: string; moduleId: string | null }) => void;
}

// ⚠️ 这里**曾经**还有 `WebappEvent` —— 学生操作行为事件（click / input / scroll /
// navigate / visibility / report）的契约形状。它随整条事件链路一起删除了：
// 现在跨这条链路的数据只有缩略图帧（`webapp-student-frame` 的 dataUrl），
// 而帧的形状没有独立的类型：它只有 `{ studentId, webappId, dataUrl, at }` 四项，
// 就直接写在上面那条事件签名里，不再单开一个接口。
// ── ↑ 上面那段是 T2 的记述。P2.2 的 T5 把 `WebappEvent` **按更窄的契约**恢复了。 ──

/**
 * 文字档事件 —— 学生端上报的**唯一**一种事件。
 *
 * 🔴 **恰好四个字段，没有任何自由文本字段。**
 *   · `to` 是短枚举字面量（'visible' | 'hidden'），`scroll` 时恒为空串；
 *   · `depth` 是一个十分位整数（0 / 10 / … / 100），`visibility` 时恒为 0；
 *   · `at` 是一个时间戳。
 *
 * ⚠️ 旧的 `selector` / `inputType` / `length` 三项**一项都没有回来**，而且**不许**
 * 加回来：那三项正是「点了哪个元素」「输入框里有多少字符」的载体，用户明确不要。
 * 窄契约本身就是一个**更强的隐私位置** —— 不是「删剩下的残渣」。
 *
 * ⚠️ 保证是**两层的**，两边都独立地做白名单式重建：
 *   · 学生端父页面（`src/app/classroom/explore/use-explore-bridge.ts` 的 `toWebappEvent`）；
 *   · 服务端（`server/src/socket/index.ts` 的 `sanitizeWebappEvent`）。
 * 两层是刻意的：每一层都假定上一层可能已经坏了。
 */
export interface WebappEvent {
  kind: 'visibility' | 'scroll';
  /** visibility: 'visible' | 'hidden'；scroll: ''（不是"没有字段"，是空串）。 */
  to: string;
  /** scroll: 0/10/…/100；visibility: 0。 */
  depth: number;
  at: number;
}

/**
 * 服务端转给教师看板的**当前状态**（不是事件流）。
 *
 * 与 `WebappEvent` 的区别是**时态**：那条是「刚刚发生了什么」，这条是「现在是什么样」。
 * 教师图墙要的是后者 —— 一个学生滚了 30 下，图墙上该显示的是「滚到 60%」，
 * 而不是 30 条流水。服务端因此**只留一条**（覆盖式），这个载荷就是它。
 */
export interface WebappPresenceUpdate {
  studentId: string;
  webappId: string;
  /** 学生此刻是不是在前台看着这个网页。 */
  visible: boolean;
  /** 学生此刻的滚动深度（十分位，0 表示没滚 / 还在顶部）。 */
  depth: number;
  /** 服务端**收到**这条状态的时刻（不用客户端时钟）。 */
  at: number;
  /** 本节课里可见性**切换过几次**（一个计数，不是一条流水）。 */
  switches: number;
}
