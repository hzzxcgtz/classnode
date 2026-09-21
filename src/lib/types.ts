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
  groups?: Array<{ id: string; name: string; agentId?: string; groupId?: string; agent?: AgentSummary; [key: string]: unknown }>;
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
 * 探究助手「关联网页」的对外形状（`loadClassroomWebapps`，`server/src/routes/webapps.ts`）。
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
  groups: Array<ClassroomCardGroup & { agent: AgentSummary }>;
  students: Array<{ studentId: string; totalRounds: number }>;
  _count: { students: number };
  participantCount: number;
  realStudentCount: number;
}

export interface StudentClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  agents: AgentSummary[];
  groups?: Array<ClassroomCardGroup & { agent: AgentSummary }>;
  modules: ClassroomModuleSetting[];
  /**
   * 探究助手托管服务的**端口**（P2；`GET /api/classroom/code/:code` 下发）。
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
  groups: Array<ClassroomCardGroup & { agent: AgentSummary }>;
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

export interface AdvancedClassroomGroupInput {
  name: string;
  agentId: string;
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
