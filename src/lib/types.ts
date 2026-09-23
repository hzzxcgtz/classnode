export interface InitStatus {
  initialized: boolean;
  authenticated: boolean;
  hasAgents: boolean;
  hasClasses: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  logo: string | null;
  platform: string;
  apiUrl: string | null;
  apiKey: string;
  hasApiKey: boolean;
  botId: string | null;
  extra: string | null;
  enabled: boolean;
  greeting: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  /**
   * 关联到的**去重后**的课堂数。
   *
   * ⚠️ **只有管理页的列表接口（`GET /api/agents`）会填它**，所以是可选的 ——
   * 这个类型是复用类型：课堂详情里下发的 `agents[]`（`GET /api/classroom/code/:code`
   * 等）走的是同一条类型，那些端点不算这个数。声明成必填会逼那些构造点塞假值。
   */
  classroomCount?: number;
}

/**
 * 一个「关联到的课堂」—— 智能体 / 探究网页的卡片上「关联课堂」入口与
 * 「无法删除」弹窗共用同一份形状。
 *
 * `mode` 是可选：网页侧的两条查询都带了它，但界面不依赖它存在。
 */
export interface RelatedClassroom {
  id: string;
  /** 服务端已经回退过：标题为空时是 `'未命名课堂'`。 */
  title: string;
  /** `'active' | 'paused' | 'ended'`。 */
  status: string;
  mode?: string;
}

export interface ClassroomSummary {
  id: string;
  code: string | null;
  title: string | null;
  mode: 'standard' | 'group' | 'advanced';
  status: 'active' | 'paused' | 'ended';
  allowStudentStop: boolean;
  allowStudentExport: boolean;
  allowFollowUps: boolean;
  createdAt?: string;
  endedAt?: string | null;
  agents?: AgentSummary[];
  /**
   * 各组的材料。⚠️ **`agentId` 已随 P2 的 `ClassroomGroupMaterial` 一并消失**
   * （`ClassroomGroup.agentId` 那一列被删掉了），而且 `agent` / `webapp` **都可以是 `null`**
   * ——「这组没配这种材料」是合法状态，高级模式下**不回落**到课堂级数组。
   * 学生端取材料一律走 `@/lib/classroom-material` 的两个解析函数，不要在这里自己找组。
   */
  groups?: Array<{
    id: string;
    name: string;
    groupId?: string;
    agent?: AgentSummary | null;
    webapp?: ClassroomWebappSummary | null;
    [key: string]: unknown;
  }>;
  students?: unknown[];
  agentIds?: string[];
}

/**
 * 课堂三个模块的标识与三态取值。与后端 server/src/services/classroom-module-state.ts
 * 的 ModuleKey / ModuleState 逐字对齐 —— 两边各写一份就会漂移，改这里必须同步改那边。
 */
export type ClassroomModuleKey = 'learning-sheet' | 'explorer' | 'companion';
export type ClassroomModuleState = 'open' | 'preview' | 'hidden';

/** 单个模块的态。读端点 GET /code/:code 与 GET /:id 恒返回三个（缺失按默认态补齐）。 */
export interface ClassroomModuleSetting {
  moduleKey: ClassroomModuleKey;
  state: ClassroomModuleState;
}

/**
 * 探究空间「关联网页」的对外形状（`loadClassroomWebapps`，`server/src/routes/webapps.ts`）。
 *
 * **只有这三个字段**：`id` 与 `entryPath` 够学生端拼出
 * `http://${location.hostname}:${webappPort}/webapps/${id}/${entryPath}`，`name` 是显示名。
 * `Webapp` 表里任何指向文件系统的字段（绝对路径、`webappsRoot()` 之下的相对路径）
 * **一律不进响应** —— 多一个字段就是把服务端的目录结构告诉客户端。
 */
export interface ClassroomWebappSummary {
  id: string;
  name: string;
  entryPath: string;
}

/**
 * 课堂材料里那一份**学习单**的最小读形状。
 *
 * 🔴 **P1 尚未落地**：今天 `Worksheet` 表不存在、没有任何地方写
 * `ClassroomGroupMaterial.kind='worksheet'`、`GET /api/classroom/active` 也不下发这个字段
 * ⇒ 凡是读它的地方（`@/lib/classroom-material` 的 `classroomMaterialsInUse`）**今天恒为空**。
 *
 * 那为什么还要定义它：教师端的「课堂卡片」必须按**三件套**分类显示材料引用
 * （用户 2026-09-23），而学习单那一类不能写成「以后再说」—— 读路径改一遍的代价远高于
 * 现在照 P1 规格（`specs/2026-09-23-p1-worksheet.md` §4.1：`Worksheet.title` ＋ 组材料
 * `kind='worksheet'`）把槽留出来。接上服务端那一天，界面**不用再改**。
 *
 * ⚠️ 字段名是 `title` 不是 `name`（`Worksheet` 模型就是这么定的），别顺手对齐成网页那套。
 */
export interface WorksheetMaterialSummary {
  id: string;
  title: string;
}

/**
 * 管理页（`/teacher/webapps/`）看到的网页形状 —— 与 `ClassroomWebappSummary` 同样是
 * `PUBLIC_WEBAPP_SELECT` 的子集，**没有任何磁盘路径字段**。
 */
export interface WebappSummary {
  id: string;
  name: string;
  entryPath: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 被多少个课堂关联。管理页的概览条（已关联 / 未关联）、「按关联状态筛选」与
   * 卡片左边那条色条都读它。
   *
   * ⚠️ 与 `AgentSummary.classroomCount` 不同，这里是**必填**：网页只有一个来源
   * （`GET /api/webapps`），而这个类型不被任何别的端点复用，没有「某些构造点不填」
   * 的问题。缺失就是 bug，让它编译期暴露比留个可选字段好。
   */
  classroomCount: number;
}

/**
 * 上传响应。
 *
 * ⚠️ `externalDeps` **只有数量与文件名，没有 URL** —— 这是服务端的结构性约束
 * （见 `routes/webapps.ts` 的 `scanExternalDepsSafe`），不是 UI 约定。
 * 界面上因此也只能说「本网页依赖 N 个外部资源」，不能列出具体地址。
 */
export interface WebappUploadResult extends WebappSummary {
  externalDeps: { count: number; files: string[] };
}

export interface StudentSessionResponse {
  token: string;
  expiresIn: number;
}

export interface AgentInfoResponse {
  name: string | null;
  iconUrl: string | null;
  greeting: string | null;
}

export interface AgentTestResponse {
  success: boolean;
  error?: string;
}

export interface ShieldWord {
  id: string;
  word: string;
  builtin: boolean;
  enabled: boolean;
}

export interface ShieldConfig {
  autoBlackCount: number;
  rateLimit: number;
}

export interface ShieldWordCategory {
  name: string;
  count: number;
  words: Array<Pick<ShieldWord, 'id' | 'word' | 'enabled'>>;
}

export interface ClassSummary {
  id: string;
  name: string;
  avatarId: number | null;
  createdAt?: string;
  _count: { groups: number; students: number };
  maleCount: number;
  femaleCount: number;
  avatarAssignedCount: number;
  rewardedCount: number;
  totalTokens: number;
  uploadedAvatarCount: number;
}

export interface StudentSummary {
  id: string;
  classId: string;
  name: string;
  studentNo: string | null;
  gender: string | null;
  tag: string | null;
  avatarId: number | null;
  avatarChangeTokens: number;
  createdAt?: string;
}

export interface ClassGroup {
  id: string;
  classId: string;
  name: string;
  studentIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentBatchCreateResponse {
  count: number;
  students: Array<Pick<StudentSummary, 'classId' | 'name' | 'studentNo' | 'gender'>>;
}

export type AvatarCategory = 'student' | 'class';
export type AvatarGender = 'boy' | 'girl' | 'neutral';

export interface AvatarSummary {
  id: number;
  name: string;
  svgContent: string;
  category: AvatarCategory;
  gender: AvatarGender;
  sortOrder: number;
  isActive: boolean;
  source?: string;
  createdAt?: string;
}

export interface AvatarBatchResult {
  success: boolean;
  count: number;
}

export interface AvatarRandomCandidate {
  svgContent: string;
  gender: AvatarGender;
}

export interface ClassroomStudentSummary {
  id: string; // ClassroomStudent.id：稳定的课堂参与者 ID
  participantType: 'student' | 'group';
  studentId: string | null; // 仅真实学生参与者存在
  name: string;
  studentNo: string | null;
  gender: string | null;
  avatarId: number | null;
  groupId: string | null;
  groupName?: string;
  status: string;
}

export interface ClassroomCardMessage {
  id?: string;
  content: string;
  role: string;
  createdAt: string;
  roundIndex?: number | null;
  fileUrls?: string | null;
  fileNames?: string | null;
  studentName?: string;
}

export interface ClassroomCardGroup {
  id: string;
  name: string;
  agentId?: string;
  code?: string | null;
}

export interface ClassroomCardStudent {
  id: string;
  participantId?: string;
  participantType?: 'student' | 'group';
  studentId: string | null;
  groupId: string | null;
  totalRounds: number;
  warningCount: number;
  blacklisted: boolean;
  status: string;
  student: StudentSummary;
  group?: ClassroomCardGroup | null;
  messages: ClassroomCardMessage[];
}

export interface ClassroomDetail extends Omit<ClassroomSummary, 'students' | 'groups'> {
  classes: Array<{ classId: string; class: ClassSummary }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  groups: Array<ClassroomCardGroup & { agent?: AgentSummary }>;
  students: ClassroomCardStudent[];
  groupMembersMap: Record<string, {
    groupName: string;
    members: Array<Pick<StudentSummary, 'id' | 'name' | 'studentNo'>>;
  }>;
  modules: ClassroomModuleSetting[];
  /**
   * 该课堂在 ClassroomModule 表里有没有行。
   *
   * `modules` 是补齐后的三项，「三态全是 preview」既可能是教师把三项都设成了预告、
   * 也可能是这个课堂从未设置过（老课堂零行兜底），前端单看 `modules` 分不出来。
   *
   * 可选：服务端读取模块行失败（老库 ClassroomModule 表不存在）时**不下结论**、不发这个
   * 字段，此时它是 `undefined`。读的地方必须用 `=== false` 判断「确定没有行」，别用 `!`
   * —— 那会把「不知道」当成「没有」。
   */
  hasModuleRows?: boolean;
  /**
   * 本课堂关联的探究网页。`GET /api/classroom/:id` 与 `/code/:code` **共用**
   * `loadClassroomWebapps`（`routes/webapps.ts`），两个端点的形状逐字相同 ——
   * 教师看板的探究空间视图按它渲染格子标题。
   *
   * 可选的理由同 `StudentClassroom.webapps`：查询失败（老库缺表）时服务端降级为
   * 空数组，更老的版本则根本不发这个字段；读的地方按「没有网页」处理。
   *
   * ⚠️ 教师端这条路径**没有** `webappPort`（那个只在 `/code/:code` 下发）：
   * 教师看板不需要自己拼地址，管理页的预览走 `/api/server-info` 的 `webappOrigin`。
   */
  webapps?: ClassroomWebappSummary[];
  /**
   * 探究空间画面的采集设置（P2.2，`Classroom` 表的三个标量列；`GET /api/classroom/:id`
   * 靠 `...classroom` 原样带出，`POST /:id/webapp-capture` 则返回归一化后的全量）。
   *
   * 三个都**可选**：老库加列之前建的行、或服务端降级响应都可能没有。
   * 🔴 读的地方方向必须是「**认不出 = 开 / 用默认**」——
   * `webappCaptureEnabled !== false`、`webappThumbnailWidth ?? 320`、
   * `webappFrameIntervalMs ?? 10000`，与 `server/src/services/webapp-capture.ts`
   * 的 `normalizeCaptureConfig` 对齐。写成 `!enabled` 或 `Boolean(enabled)`
   * 会把「不知道」渲染成「已关闭」，教师看到的是一个假的关闭态，
   * 然后他会去点一次「开启」，把一个本来开着的功能关掉。
   */
  webappCaptureEnabled?: boolean;
  webappThumbnailWidth?: number;
  webappFrameIntervalMs?: number;
}

export interface ClassroomHistoryItem extends ClassroomSummary {
  createdAt: string;
  endedAt: string | null;
  totalChars: number;
  totalRounds: number;
  participantCount: number;
  realStudentCount: number;
  _count: { students: number; interactions: number };
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
}

export interface ActiveClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  createdAt: string;
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  /**
   * ⚠️ `agent` / `webapp` **都可能为 `null`**：P2 起材料按组走，高级模式下「这组没配」
   * 是合法状态（`group-material-resolve.ts` 条件构造）。写成非空是**陈述上的谎言**，
   * 会让读的地方少一层判空。
   */
  groups: Array<ClassroomCardGroup & {
    agent: AgentSummary | null;
    webapp: ClassroomWebappSummary | null;
    /**
     * 🔴 **P1 尚未落地，今天服务端不下发这个字段**（见 `WorksheetMaterialSummary` 的注释）。
     * 这里先按 P1 的组材料形状声明成可选，为的是「接上就显示」而不是那时候再改读路径；
     * 缺字段时一律当 `null`（该组没配学习单），**不是**当成错误。
     */
    worksheet?: WorksheetMaterialSummary | null;
  }>;
  students: Array<{ studentId: string; totalRounds: number }>;
  _count: { students: number };
  participantCount: number;
  realStudentCount: number;
  /**
   * 本课堂关联的探究网页（`GET /api/classroom/active`，为管理页的「课堂设置」弹窗而发）。
   *
   * 单选之后**至多一条**；老数据里可能有多条，那种课堂在弹窗里会显示成
   * 「只有第一个生效，保存设置后多余的会被移除」—— 服务端确实会在保存时裁掉
   * （`trimExtraClassroomWebapps`）。
   *
   * 可选：服务端查询失败（老库缺表）时降级为空数组，更老的版本根本不发这个字段。
   * ⚠️ 因此「没发」与「空数组」在界面上都是「没有网页」—— 这与学生端 `webapps?` 同一条口径。
   */
  webapps?: ClassroomWebappSummary[];
  /**
   * 本课堂**课堂级**关联的学习单（P1 落地后才有）。
   *
   * 与 `webapps` 同构：**标准 / 分组模式**的权威来源；高级模式下权威来源是各组
   * （`groups[].worksheet`），这一条会是幽灵（服务端在该模式下不写它）。
   *
   * 🔴 今天服务端不查询也不下发它 —— 声明成可选正是为了如实表达「没发」与「空数组」在
   * 界面上是一回事（与 `webapps?` 同一条口径），而不是把「还没做」伪装成一个空数组。
   */
  worksheets?: WorksheetMaterialSummary[];
}

export interface StudentClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  agents: AgentSummary[];
  /**
   * 各组的材料（`GET /code/:code` 与 `join-classroom` 的 `joined` 事件）。
   *
   * 🔴 **`agent` / `webapp` 都可为 `null`，且高级模式下这是「该组没有这种材料」的唯一表达
   * —— 不得回落到 `agents[]` / `webapps[]`**（那是课堂级数组，高级模式下曾是各组材料的
   * 并集 ⇒ 回落到它等于让学生静默地用别的组的智能体/网页）。解析一律经
   * `@/lib/classroom-material` 的 `effectiveGroupAgent` / `effectiveGroupWebapp`。
   *
   * ⚠️ `agent` 的**运行时**形状是 `AgentSummary` 的子集（服务端 `GroupMaterialView`：
   * `id` / `name` / `logo` / `platform` / `enabled` / `greeting`）—— 声明按 `AgentSummary`
   * 是为了与 `agents[]` 同一个类型、读 `enabled` / `greeting` 时不必分支；但**不要**从这个
   * 对象上读 `apiUrl` / `apiKey` / `hasApiKey` 之类的管理字段，服务端在这里根本不下发。
   *
   * 可选：更老的服务端不发这个字段；标准模式下服务端也刻意不发（`groups` 为 `undefined`）。
   */
  groups?: Array<ClassroomCardGroup & { agent: AgentSummary | null; webapp: ClassroomWebappSummary | null }>;
  modules: ClassroomModuleSetting[];
  /**
   * 探究空间托管服务的**端口**（P2；`GET /api/classroom/code/:code` 下发）。
   *
   * ⚠️ 是端口而**不是**拼好的 URL：学生端本来就知道自己是从哪个 IP / 域名进来的
   * （`location.hostname`），所以自己拼出来的源永远正确、无缓存、不会陈旧 ——
   * 一个由服务端拼好的绝对 URL 反而会在「服务端挑的绑定 IP 与学生实际用的入口不同」
   * 时把人送到一个打不开的地址上。服务端侧的理由见 `server/src/routes/classroom.ts`。
   *
   * 可选：托管服务起不来时服务端拿到的是 `undefined`（Ruling 1：托管服务故障不拖垮主服务），
   * 更老的版本则根本不发这个字段 —— 读的地方必须按「不可用」处理，不能当成 0。
   */
  webappPort?: number;
  /**
   * 本课堂关联的网页，按关联顺序；查询失败（老库缺表）时服务端降级为空数组。
   *
   * 可选的理由同上（旧服务端不发这个字段），与 `hasModuleRows?` 同一条口径：
   * 「没发」与「发了但是空」在 UI 上都是「老师还没添加网页」，但读路径不能因为
   * 字段缺失就崩。
   */
  webapps?: ClassroomWebappSummary[];
}

export interface ClassroomSettingsGroup {
  id: string;
  name: string;
  agentId: string;
}

export interface DashboardClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  /** ⚠️ 同 `ActiveClassroom.groups`：`agent` / `webapp` 都可为 `null`（`/all` 也走 `resolveGroupMaterialViews`）。 */
  groups: Array<ClassroomCardGroup & { agent: AgentSummary | null; webapp: ClassroomWebappSummary | null }>;
  _count: { students: number; interactions: number };
  participantCount: number;
  realStudentCount: number;
}

export interface StorageStats {
  avatars: {
    teacher: { count: number; totalSize: number; totalSizeText: string };
    student: { count: number; totalSize: number; totalSizeText: string };
  };
  classIcons: { count: number; totalSize: number; totalSizeText: string };
  agentLogos: { count: number; totalSize: number; totalSizeText: string };
  classroomAttachments: {
    totalCount: number;
    totalSize: number;
    totalSizeText: string;
    classrooms: Array<{
      id: string;
      title: string | null;
      status: string;
      interactionCount: number;
      totalRounds: number;
      attachmentCount: number;
      totalSize: number;
      totalSizeText: string;
    }>;
  };
  agentUsage: Array<{ id: string; name: string; platform: string; classroomCount: number; totalCalls: number; totalChars: number }>;
}

export interface TeacherNotification {
  id: string;
  classroomId: string;
  studentId: string | null;
  content: string;
  createdAt: string;
}

/** 高级模式每个小组要提交的材料。
 *
 * 🔴 `agentId` / `webappId` 都可以是 `null`，含义是**该组显式「不指定」这种材料** ——
 * 它与「这个字段没传」在服务端归一成同一件事（都会不落库，见 `create-advanced` 的
 * `toId`）。高级模式下**不回落课堂级材料**：某组没指定智能体，那组的学生就没有智能体，
 * 不会静默拿到别的组的。
 */
export interface AdvancedClassroomGroupInput {
  name: string;
  agentId: string | null;
  webappId: string | null;
  studentIds: string[];
}

export interface ClassroomMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  roundIndex: number | null;
  agentId: string | null;
  fileUrls?: string | null;
  fileNames?: string | null;
  followUps?: string | string[] | null;
  classroomStudent?: {
    id: string;
    student?: Pick<StudentSummary, 'id' | 'name' | 'studentNo' | 'gender' | 'avatarId'> | null;
    group?: Pick<ClassroomCardGroup, 'id' | 'name'> | null;
  };
}

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  source: string;
}

export interface AvatarUploadResponse {
  success: boolean;
  url: string;
  svgContent: string;
  name: string;
}

export interface ClassroomWarning {
  id: string;
  classroomId: string;
  studentId: string | null;
  word: string;
  content: string;
  createdAt: string;
  studentName?: string;
}

export interface ClassroomWarningSummary {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'ended';
  code: string;
  className: string;
  warningCount: number;
  createdAt: string;
}

export interface ExportConversationStudent {
  studentId?: string;
  name: string;
  studentNo?: string | null;
  gender?: string | null;
  totalRounds?: number;
  messages: Array<{
    role: string;
    content: string;
    time: string;
    roundIndex?: number | null;
    agentId?: string | null;
    agentName?: string | null;
    fileUrls?: string[];
    fileNames?: string[];
  }>;
}

export interface ConversationExportReport {
  title: string;
  code: string | null;
  mode: string;
  createdAt: string;
  endedAt: string | null;
  classes: string[];
  agents: Array<{ id: string; name: string; platform: string }>;
  teacherNotifications: Array<{ content: string; time: string; targetStudentId: string | null }>;
  students: ExportConversationStudent[];
}

export interface StatsExportReport {
  title: string;
  exportedAt: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}
