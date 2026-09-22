import { getApiBaseUrl } from './api-base';
import type { ActiveClassroom, AdvancedClassroomGroupInput, AgentInfoResponse, AgentSummary, AgentTestResponse, AvatarBatchResult, AvatarRandomCandidate, AvatarSummary, AvatarUploadResponse, BackupFile, ClassGroup, ClassSummary, ClassroomDetail, ClassroomHistoryItem, ClassroomMessage, ClassroomModuleKey, ClassroomModuleState, ClassroomStudentSummary, ClassroomSummary, ClassroomWarning, ClassroomWarningSummary, ConversationExportReport, DashboardClassroom, InitStatus, ShieldConfig, ShieldWord, ShieldWordCategory, StatsExportReport, StorageStats, StudentBatchCreateResponse, StudentClassroom, StudentSessionResponse, StudentSummary, TeacherNotification, WebappSummary, WebappUploadResult, RelatedClassroom } from './types';

let studentSessionToken = '';

const FORM_REQUEST_TIMEOUT_MS = 15_000;

export function setStudentSessionToken(token?: string): void {
  studentSessionToken = token || '';
}

export function getStudentSessionAuthorization(): Record<string, string> {
  return studentSessionToken ? { Authorization: `Bearer ${studentSessionToken}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(studentSessionToken ? { Authorization: `Bearer ${studentSessionToken}` } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('verify-password')) {
    window.dispatchEvent(new CustomEvent('classnode-teacher-session-expired'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `请求失败 (HTTP ${res.status})` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function formRequest<T>(path: string, method: 'POST' | 'PUT', body: FormData): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FORM_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      body,
      credentials: 'include',
      headers: getStudentSessionAuthorization(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({ error: `请求失败 (HTTP ${res.status})` }));
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('classnode-teacher-session-expired'));
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('保存请求超时，请确认 ClassNode 服务正在运行后重试');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  // Health
  health: () => request<{ status: string }>('/api/health'),

  // Settings
  getSettings: () => request<Record<string, string>>('/api/settings'),
  updateSetting: (key: string, value: string) =>
    request(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  setAdminPassword: (password: string) =>
    request('/api/settings/admin-password', { method: 'POST', body: JSON.stringify({ password }) }),
  verifyPassword: (password: string) =>
    request<{ verified: boolean; firstTime: boolean }>('/api/settings/verify-password', {
      method: 'POST', body: JSON.stringify({ password }),
    }),
  getSession: () => request<{ authenticated: boolean }>('/api/settings/session'),
  logout: () => request('/api/settings/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/api/settings/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  getInitStatus: () =>
    request<InitStatus>('/api/settings/init-status'),

  // Agents
  getAgents: () => request<AgentSummary[]>('/api/agents'),
  getAgent: (id: string) => request<AgentSummary>(`/api/agents/${id}`),
  createAgent: (data: FormData) =>
    formRequest<AgentSummary>('/api/agents', 'POST', data),
  updateAgent: (id: string, data: FormData) =>
    formRequest<AgentSummary>(`/api/agents/${id}`, 'PUT', data),
  deleteAgent: (id: string) => request(`/api/agents/${id}`, { method: 'DELETE' }),
  // ⚠️ `used` / `classroomCount` / `groupCount` 是**删除守卫的判据**，口径不要动。
  //    `classrooms` 是新增的清单：两个维度（classroomAgent + classroomGroup）**去重后**
  //    的结果，所以它的长度可能小于 `classroomCount + groupCount` —— 高级模式建的课堂
  //    在两张表里都有行，那是常态。
  checkAgentUsage: (id: string) =>
    request<{ used: boolean; classroomCount: number; groupCount: number; classrooms: RelatedClassroom[] }>(`/api/agents/${id}/usage`),
  getAgentGreeting: (id: string, force?: boolean) =>
    request<{ greeting: string | null }>(`/api/agents/${id}/greeting${force ? '?force=true' : ''}`),
  getAgentInfo: (id: string) =>
    request<AgentInfoResponse>(`/api/agents/${id}/info`),
  getAgentInfoDirect: (params: { platform: string; botId: string; apiKey: string; apiUrl?: string; projectId?: string; apiSecret?: string }) =>
    request<AgentInfoResponse>('/api/agents/info-preview', {
      method: 'POST', body: JSON.stringify(params),
    }),
  testAgent: (id: string) => request<AgentTestResponse>(`/api/agents/${id}/test`, { method: 'POST' }),

  // Classes
  getClasses: () => request<ClassSummary[]>('/api/classes'),
  createClass: (name: string, avatarId?: number) =>
    request<ClassSummary>('/api/classes', { method: 'POST', body: JSON.stringify({ name, avatarId }) }),
  updateClass: (id: string, name: string, avatarId?: number | null) =>
    request<ClassSummary>(`/api/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name, avatarId }) }),
  deleteClass: (id: string) => request(`/api/classes/${id}`, { method: 'DELETE' }),
  checkClassUsage: (id: string) =>
    request<{ used: boolean; classroomCount: number; classrooms: { id: string; title: string; status: string }[] }>(`/api/classes/${id}/usage`),

  // Groups
  getGroups: (classId: string) => request<ClassGroup[]>(`/api/classes/${classId}/groups`),
  createGroup: (classId: string, name: string) =>
    request<ClassGroup>(`/api/classes/${classId}/groups`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (classId: string, groupId: string, data: { name?: string; studentIds?: string[] }) =>
    request<ClassGroup>(`/api/classes/${classId}/groups/${groupId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (classId: string, groupId: string) =>
    request(`/api/classes/${classId}/groups/${groupId}`, { method: 'DELETE' }),
  getStudents: (classId: string) => request<StudentSummary[]>(`/api/classes/${classId}/students`),
  addStudent: (classId: string, data: { name: string; gender?: string }) =>
    request<StudentSummary>(`/api/classes/${classId}/students`, { method: 'POST', body: JSON.stringify(data) }),
  batchCreateStudentsFromNames: (classId: string, names: (string | { name: string; gender?: string })[]) =>
    request<StudentBatchCreateResponse>(`/api/classes/${classId}/students/batch-names`, { method: 'POST', body: JSON.stringify({ names }) }),
  deleteStudent: (classId: string, studentId: string) =>
    request(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' }),
  updateStudent: (classId: string, studentId: string, data: { name?: string; studentNo?: string; gender?: string | null; tag?: string | null; avatarId?: number | null }) =>
    request<StudentSummary>(`/api/classes/${classId}/students/${studentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Classroom
  // `webappIds`：**课堂级**的探究网页（只属于标准 / 分组模式）。服务端 `resolveWebappIds`
  // 是 `ClassroomWebapp` 唯一的写入口，见 routes/classroom.ts。
  //
  // 🔴 **探究网页是单选，这个数组最多放一个**（P2.3）。字段名保留复数是为了不破坏
  // 已经部署出去的旧前端（它们发的就是数组，服务端按「取第一个」兼容，见
  // `resolveSingleWebappId`），但新代码一律只发 0 或 1 个元素。
  //
  // ⚠️ **`createAdvancedClassroom` 没有这个字段，这不是漏了**：高级模式下网页的权威来源
  // 是**每组一份**（`AdvancedClassroomGroupInput.webappId`），服务端也**不写**课堂级那一行
  // （见 create-advanced 里 `classroom.create` 的注释）。从前这里两边都有，于是创建页在
  // 高级模式下仍然发课堂级 `webappIds` ⇒ 服务端校验通过后**把它丢掉**，教师看到
  // 「创建成功」而网页不见了。去掉这个字段是让那种状态**在类型上不可表达**。
  createClassroom: (data: { title?: string; classIds: string[]; agentIds: string[]; mode?: string; webappIds?: string[] }) =>
    request<ClassroomSummary>('/api/classroom/create', { method: 'POST', body: JSON.stringify(data) }),
  createAdvancedClassroom: (data: { title?: string; classId: string; groups: AdvancedClassroomGroupInput[] }) =>
    request<ClassroomSummary>('/api/classroom/create-advanced', { method: 'POST', body: JSON.stringify(data) }),
  getActiveClassrooms: () => request<ActiveClassroom[]>('/api/classroom/active'),
  getClassroom: (id: string) => request<ClassroomDetail>(`/api/classroom/${id}`),
  syncClassroomGroups: (id: string) =>
    request<{ success: true; addedGroups: number; updatedGroups: number; sourceGroupCount: number }>(`/api/classroom/${id}/sync-groups`, { method: 'POST' }),
  getClassroomByCode: (code: string) => request<StudentClassroom>(`/api/classroom/code/${code}`),
  createStudentSession: (code: string, studentId: string) =>
    request<StudentSessionResponse>(`/api/classroom/code/${code}/student-session`, {
      method: 'POST', body: JSON.stringify({ studentId }),
    }),
  getClassroomStudents: (id: string) => request<ClassroomStudentSummary[]>(`/api/classroom/${id}/students`),
  getStudentMessages: (classroomId: string, studentId: string) =>
    request<ClassroomMessage[]>(`/api/classroom/${classroomId}/student/${studentId}/messages`),
  getTeacherNotifications: (classroomId: string, studentId?: string) =>
    request<TeacherNotification[]>(`/api/classroom/${classroomId}/notifications${studentId ? `?studentId=${studentId}` : ''}`),
  getAllMessages: async (classroomId: string) => {
    const result: ClassroomMessage[] = [];
    const limit = 500;
    for (let page = 1; page <= 100; page++) {
      const batch = await request<ClassroomMessage[]>(`/api/classroom/${classroomId}/all-messages?page=${page}&limit=${limit}`);
      result.push(...batch);
      if (batch.length < limit) break;
    }
    return result;
  },
  getClassroomMessageStats: (classroomId: string) =>
    request<{ total: number; userMessages: number; assistantMessages: number; participantCount: number }>(`/api/classroom/${classroomId}/message-stats`),
  clearStudentMessages: (classroomId: string, studentId: string) =>
    request(`/api/classroom/${classroomId}/student/${studentId}/messages`, { method: 'DELETE' }),
  endClassroom: (id: string) => request(`/api/classroom/${id}/end`, { method: 'POST' }),
  pauseClassroom: (id: string) => request(`/api/classroom/${id}/pause`, { method: 'POST' }),
  resumeClassroom: (id: string) => request(`/api/classroom/${id}/resume`, { method: 'POST' }),
  toggleAllowStop: (id: string) => request<{ allowStudentStop: boolean }>(`/api/classroom/${id}/toggle-allow-stop`, { method: 'POST' }),
  toggleAllowExport: (id: string) => request<{ allowStudentExport: boolean }>(`/api/classroom/${id}/toggle-allow-export`, { method: 'POST' }),
  toggleAllowFollowUps: (id: string) => request<{ allowFollowUps: boolean }>(`/api/classroom/${id}/toggle-allow-follow-ups`, { method: 'POST' }),
  // 探究助手画面采集（P2.2）：要不要采、多清楚、多久一次。
  //
  // 三个字段**都可选**，语义是「没给 = 这次不改它」—— 所以只发被改动的那一个，
  // 不要图省事把当前值整个塞进去（那会把另一个字段钉死在本地可能已经过期的值上）。
  // ⚠️ 更不要传 `null` 表示「不改」：那一侧曾把 `Number(null) === 0` 当成数值 0
  // 再夹成下界 160 写进库（已修，但别去踩）。用「不发这个 key」表达不改。
  //
  // 返回的是**归一化后的完整设置**（宽度夹在 160~640、周期夹在 5000~60000），
  // 应当用它回写本地 state，而不是回写请求里那个可能被夹掉的值。
  setWebappCapture: (id: string, body: { enabled?: boolean; width?: number; frameIntervalMs?: number }) =>
    request<{ enabled: boolean; width: number; frameIntervalMs: number }>(`/api/classroom/${id}/webapp-capture`, { method: 'POST', body: JSON.stringify(body) }),
  getHistory: () => request<ClassroomHistoryItem[]>('/api/classroom/history/all'),
  getAllClassrooms: () => request<DashboardClassroom[]>('/api/classroom/all'),
  // 🔴 **只有课堂名称可以改**（服务端只读 `title`，其余字段不采用）。这条签名只收
  // `title`，是为了让「不能改别的」在调用处就是编译期事实，而不是服务端悄悄忽略。
  // 顺带：保存时服务端会把该课堂多余的探究网页关联裁到只剩第一个（单选约束），
  // 删了哪些记录在服务端日志里。
  updateClassroomSettings: (id: string, data: { title?: string }) =>
    request(`/api/classroom/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  // 三态用 PUT 而非 toggle：没有「取反」语义，PUT 幂等、带目标态、可重试。
  // 成功时服务端已向 classroom:<id> 与 teacher:<id> 双发 module-state-changed。
  setClassroomModuleState: (id: string, moduleKey: ClassroomModuleKey, state: ClassroomModuleState) =>
    request<{ moduleKey: ClassroomModuleKey; state: ClassroomModuleState }>(`/api/classroom/${id}/modules/${moduleKey}`, { method: 'PUT', body: JSON.stringify({ state }) }),
  getOnlineStudentIds: (id: string) =>
    request<{ studentIds: string[] }>(`/api/classroom/${id}/online`),

  // 恢复已结束课堂
  restoreClassroom: (id: string) =>
    request(`/api/classroom/${id}/restore`, { method: 'POST' }),

  // Avatars
  getAvatars: (category?: string) =>
    request<AvatarSummary[]>(`/api/avatars${category ? `?category=${category}` : ''}`),
  getAllAvatars: (category?: string) =>
    request<AvatarSummary[]>(`/api/avatars/all${category ? `?category=${category}` : ''}`),
  createAvatar: (data: { name?: string; svgContent: string; category?: string; gender?: string; sortOrder?: number }) =>
    request<AvatarSummary>('/api/avatars', { method: 'POST', body: JSON.stringify(data) }),
  updateAvatar: (id: number, data: { name?: string; svgContent?: string; gender?: string; sortOrder?: number }) =>
    request<AvatarSummary>(`/api/avatars/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAvatar: (id: number) =>
    request<{ success: boolean; studentCount: number; classCount: number }>(`/api/avatars/${id}`, { method: 'DELETE' }),
  assignStudentsAvatar: (studentIds: string[], avatarId: number) =>
    request<AvatarBatchResult>('/api/avatars/assign-students', { method: 'POST', body: JSON.stringify({ studentIds, avatarId }) }),
  clearStudentsAvatar: (studentIds: string[]) =>
    request<AvatarBatchResult>('/api/avatars/clear-students', { method: 'POST', body: JSON.stringify({ studentIds }) }),
  autoAssignAvatar: (params: { studentIds?: string[]; classId?: string }) =>
    request<{ success: boolean; assigned: number }>('/api/avatars/auto-assign', { method: 'POST', body: JSON.stringify(params) }),
  setClassAvatar: (classId: string, avatarId: number | null) =>
    request(`/api/avatars/class/${classId}`, { method: 'PUT', body: JSON.stringify({ avatarId }) }),
  rewardStudentAvatar: (classroomId: string, studentId: string) =>
    request<{ success: boolean; tokens: number }>(`/api/classroom/${classroomId}/student/${studentId}/reward-avatar`, { method: 'POST' }),
  rewardStudentDirect: (studentId: string) =>
    request<{ success: boolean; tokens: number }>(`/api/avatars/reward-student/${studentId}`, { method: 'POST' }),
  studentSelfChangeAvatar: (studentId: string, data: { avatarId?: number; svgContent?: string; gender?: string }) =>
    request<{ success: boolean; avatarId: number; svgContent: string }>(`/api/avatars/student-self/${studentId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  getAvatarsAll: (category?: string) =>
    request<AvatarSummary[]>(`/api/avatars/all-including-student${category ? `?category=${category}` : ''}`),
  generateAvatarPool: (category: 'student' | 'class', count = 10, route?: number) =>
    request<{ avatars: AvatarRandomCandidate[] }>('/api/avatars/random-pool', {
      method: 'POST', body: JSON.stringify({ category, count, route }),
    }),
  batchDeleteAvatars: (ids: number[]) =>
    request<{ success: boolean; deleted: number }>('/api/avatars/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  clearAllAvatars: (category?: string) =>
    request<{ success: boolean; cleared: number }>('/api/avatars/clear-all', { method: 'POST', body: JSON.stringify({ category }) }),
  getAvatarUsage: (id: number) =>
    request<{ students: { name: string; class: { name: string } }[]; classes: { name: string }[] }>(`/api/avatars/${id}/usage`),
  getStudentTokens: (studentId: string) =>
    request<{ tokens: number }>(`/api/avatars/student-tokens/${studentId}`),
  uploadAvatarImage: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return formRequest<AvatarUploadResponse>('/api/upload/avatar', 'POST', formData);
  },

  // Export
  exportConversations: (classroomId: string) =>
    request<ConversationExportReport>(`/api/export/${classroomId}/conversations`),
  exportConversationsFiltered: (classroomId: string, studentIds?: string[]) => {
    const params = studentIds?.length ? `?studentIds=${studentIds.join(',')}` : '';
    return request<ConversationExportReport>(`/api/export/${classroomId}/conversations${params}`);
  },
  exportStats: (classroomId: string) =>
    request<StatsExportReport>(`/api/export/${classroomId}/stats`),
  exportStatsFiltered: (classroomId: string, studentIds?: string[]) => {
    const params = studentIds?.length ? `?studentIds=${studentIds.join(',')}` : '';
    return request<StatsExportReport>(`/api/export/${classroomId}/stats${params}`);
  },

  // 服务端生成 DOCX（对话记录）
  exportConversationsDocx: (classroomId: string, options?: { studentIds?: string[]; socketId?: string }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/conversations/docx`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 DOCX（学情报表）
  exportStatsDocx: (classroomId: string, options?: { studentIds?: string[]; socketId?: string }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/stats/docx`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 CSV（对话记录）
  exportConversationsCsv: (classroomId: string, options?: { studentIds?: string[] }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/conversations/csv`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 CSV（学情报表）
  exportStatsCsv: (classroomId: string, options?: { studentIds?: string[] }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/stats/csv`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },
  createBackup: () => request<{ success: boolean; path: string }>('/api/export/backup', { method: 'POST' }),
  getBackups: () => request<BackupFile[]>('/api/export/backups'),
  deleteBackup: (name: string) => request(`/api/export/backup/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  restoreBackup: (name: string) => request(`/api/export/restore/${encodeURIComponent(name)}`, { method: 'POST' }),
  resetAllData: () => request('/api/export/reset', { method: 'POST' }),
  uploadBackup: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${getApiBaseUrl()}/api/export/backup/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then(r => r.json() as Promise<{ success: boolean; name: string }>);
  },
  getBackupDownloadUrl: (name: string) =>
    `${getApiBaseUrl()}/api/export/backup/${encodeURIComponent(name)}/download`,

  // Shield Words
  getShieldWords: () => request<ShieldWord[]>('/api/shield/words'),
  getShieldCategories: () =>
    request<ShieldWordCategory[]>('/api/shield/words/categories'),
  clearBuiltinShieldWords: () =>
    request<{ success: boolean; deleted: number }>('/api/shield/words/clear-builtin', { method: 'POST' }),
  restoreDefaultShieldWords: () =>
    request<{ success: boolean; restored: number; total: number }>('/api/shield/words/restore-defaults', { method: 'POST' }),
  addShieldWord: (word: string) =>
    request('/api/shield/words', { method: 'POST', body: JSON.stringify({ word }) }),
  deleteShieldWord: (id: string) =>
    request(`/api/shield/words/${id}`, { method: 'DELETE' }),
  batchDeleteShieldWords: (ids: string[]) =>
    request('/api/shield/words/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  toggleShieldWord: (id: string) =>
    request<ShieldWord>(`/api/shield/words/${id}/toggle`, { method: 'PUT' }),
  batchToggleShieldWords: (ids: string[], enabled: boolean) =>
    request('/api/shield/words/batch-toggle', { method: 'PUT', body: JSON.stringify({ ids, enabled }) }),
  getShieldConfig: () => request<ShieldConfig>('/api/shield/config'),
  updateShieldConfig: (data: { autoBlackCount?: number; rateLimit?: number }) =>
    request('/api/shield/config', { method: 'PUT', body: JSON.stringify(data) }),
  blacklistStudent: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/blacklist`, { method: 'POST' }),
  unblacklistStudent: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/unblacklist`, { method: 'POST' }),
  resetStudentWarnings: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/reset-warnings`, { method: 'POST' }),
  getClassroomWarnings: (classroomId: string) =>
    request<ClassroomWarning[]>(`/api/shield/classroom/${classroomId}/warnings`),
  deleteWarning: (id: string) =>
    request(`/api/shield/warnings/${id}`, { method: 'DELETE' }),
  clearClassroomWarnings: (classroomId: string) =>
    request(`/api/shield/classroom/${classroomId}/warnings`, { method: 'DELETE' }),
  getWarningsSummary: () =>
    request<ClassroomWarningSummary[]>('/api/shield/warnings-summary'),

  // 服务端信息（局域网 IP / 学生入口 / 探究网页托管源）。
  // ⚠️ `webappOrigin` 是**服务端实算**的完整地址（`http://${selectedIp}:${webappPort}`），
  // 与课堂详情下发的 `webappPort`（端口，由客户端自己拼）是两条不同的口径：
  // 管理页不在课堂上下文里，拿不到那个端口，所以用它。
  getServerInfo: () =>
    request<{ webappOrigin?: string; studentUrl?: string; selectedIp?: string; port?: number }>('/api/server-info'),

  // 探究网页（P2 / 规格 §5.3）。上传走 multipart（`formRequest`），其余是 JSON。
  //
  // ⚠️ 上传的响应是 `webapp` + `externalDeps: { count, files }`，**没有 urls 字段**。
  // 服务端刻意只给数量与文件名（T2 的 `url` 只保证「识别出这是一条外部依赖」，
  // CSS 场景可能被 `;` 截断）—— 类型里就没有那个字段，后面的人也没法顺手列出来。
  getWebapps: () => request<WebappSummary[]>('/api/webapps'),
  createWebapp: (data: FormData) => formRequest<WebappUploadResult>('/api/webapps', 'POST', data),
  updateWebapp: (id: string, data: { name?: string; entryPath?: string }) =>
    request<WebappSummary>(`/api/webapps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWebapp: (id: string) => request(`/api/webapps/${id}`, { method: 'DELETE' }),
  // 网页只有 `ClassroomWebapp` 一条关联路径，所以 `classrooms.length === classroomCount`。
  checkWebappUsage: (id: string) =>
    request<{ used: boolean; classroomCount: number; classrooms: RelatedClassroom[] }>(`/api/webapps/${id}/usage`),
  getWebappEntries: (id: string) =>
    request<{ entries: string[] }>(`/api/webapps/${id}/entries`),

  // Storage stats
  getStorageStats: () =>
    request<StorageStats>('/api/system/storage-stats'),

  // Changelogs
  getChangelogs: () =>
    request<{ version: string; date: string | null; content: string }[]>('/api/changelogs'),
};
