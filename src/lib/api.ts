import { getApiBaseUrl } from './api-base';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `请求失败 (HTTP ${res.status})` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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
  getInitStatus: () =>
    request<{ initialized: boolean; hasAgents: boolean; hasClasses: boolean }>('/api/settings/init-status'),

  // Agents
  getAgents: () => request<any[]>('/api/agents'),
  getAgent: (id: string) => request<any>(`/api/agents/${id}`),
  createAgent: (data: FormData) =>
    fetch(`${getApiBaseUrl()}/api/agents`, { method: 'POST', body: data }).then(r => r.json()),
  updateAgent: (id: string, data: FormData) =>
    fetch(`${getApiBaseUrl()}/api/agents/${id}`, { method: 'PUT', body: data }).then(r => r.json()),
  deleteAgent: (id: string) => request(`/api/agents/${id}`, { method: 'DELETE' }),
  checkAgentUsage: (id: string) =>
    request<{ used: boolean; classroomCount: number; groupCount: number }>(`/api/agents/${id}/usage`),
  getAgentGreeting: (id: string, force?: boolean) =>
    request<{ greeting: string | null }>(`/api/agents/${id}/greeting${force ? '?force=true' : ''}`),
  getAgentInfo: (id: string) =>
    request<{ name: string | null; iconUrl: string | null; greeting: string | null }>(`/api/agents/${id}/info`),
  getAgentInfoDirect: (params: { platform: string; botId: string; apiKey: string; apiUrl?: string }) => {
    const query = new URLSearchParams();
    query.append('platform', params.platform);
    query.append('botId', params.botId);
    query.append('apiKey', params.apiKey);
    if (params.apiUrl) query.append('apiUrl', params.apiUrl);
    return request<{ name: string | null; iconUrl: string | null; greeting: string | null }>(`/api/agents/info?${query}`);
  },
  testAgent: (id: string) => request<{ success: boolean; error?: string }>(`/api/agents/${id}/test`, { method: 'POST' }),

  // Classes
  getClasses: () => request<any[]>('/api/classes'),
  createClass: (name: string, avatarId?: number) =>
    request('/api/classes', { method: 'POST', body: JSON.stringify({ name, avatarId }) }),
  updateClass: (id: string, name: string, avatarId?: number | null) =>
    request(`/api/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name, avatarId }) }),
  deleteClass: (id: string) => request(`/api/classes/${id}`, { method: 'DELETE' }),
  checkClassUsage: (id: string) =>
    request<{ used: boolean; classroomCount: number; classrooms: { id: string; title: string; status: string }[] }>(`/api/classes/${id}/usage`),

  // Groups
  getGroups: (classId: string) => request<any[]>(`/api/classes/${classId}/groups`),
  createGroup: (classId: string, name: string) =>
    request(`/api/classes/${classId}/groups`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (classId: string, groupId: string, data: { name?: string; studentIds?: string[] }) =>
    request(`/api/classes/${classId}/groups/${groupId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (classId: string, groupId: string) =>
    request(`/api/classes/${classId}/groups/${groupId}`, { method: 'DELETE' }),
  getStudents: (classId: string) => request<any[]>(`/api/classes/${classId}/students`),
  addStudent: (classId: string, data: { name: string; gender?: string }) =>
    request(`/api/classes/${classId}/students`, { method: 'POST', body: JSON.stringify(data) }),
  batchCreateStudentsFromNames: (classId: string, names: (string | { name: string; gender?: string })[]) =>
    request(`/api/classes/${classId}/students/batch-names`, { method: 'POST', body: JSON.stringify({ names }) }),
  deleteStudent: (classId: string, studentId: string) =>
    request(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' }),
  updateStudent: (classId: string, studentId: string, data: { name?: string; studentNo?: string; gender?: string | null; tag?: string | null; avatarId?: number | null }) =>
    request(`/api/classes/${classId}/students/${studentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Classroom
  createClassroom: (data: { title?: string; classIds: string[]; agentIds: string[]; mode?: string }) =>
    request('/api/classroom/create', { method: 'POST', body: JSON.stringify(data) }),
  createAdvancedClassroom: (data: { title?: string; classId: string; groups: any[] }) =>
    request('/api/classroom/create-advanced', { method: 'POST', body: JSON.stringify(data) }),
  getActiveClassrooms: () => request<any[]>('/api/classroom/active'),
  getClassroom: (id: string) => request<any>(`/api/classroom/${id}`),
  getClassroomByCode: (code: string) => request<any>(`/api/classroom/code/${code}`),
  getClassroomStudents: (id: string) => request<any[]>(`/api/classroom/${id}/students`),
  getStudentMessages: (classroomId: string, studentId: string) =>
    request<any[]>(`/api/classroom/${classroomId}/student/${studentId}/messages`),
  getTeacherNotifications: (classroomId: string, studentId?: string) =>
    request<any[]>(`/api/classroom/${classroomId}/notifications${studentId ? `?studentId=${studentId}` : ''}`),
  getAllMessages: (classroomId: string) =>
    request<any[]>(`/api/classroom/${classroomId}/all-messages`),
  clearStudentMessages: (classroomId: string, studentId: string) =>
    request(`/api/classroom/${classroomId}/student/${studentId}/messages`, { method: 'DELETE' }),
  endClassroom: (id: string) => request(`/api/classroom/${id}/end`, { method: 'POST' }),
  pauseClassroom: (id: string) => request(`/api/classroom/${id}/pause`, { method: 'POST' }),
  resumeClassroom: (id: string) => request(`/api/classroom/${id}/resume`, { method: 'POST' }),
  getHistory: () => request<any[]>('/api/classroom/history/all'),
  getAllClassrooms: () => request<any[]>('/api/classroom/all'),
  updateClassroomSettings: (id: string, data: { title?: string }) =>
    request(`/api/classroom/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  getOnlineStudentIds: (id: string) =>
    request<{ studentIds: string[] }>(`/api/classroom/${id}/online`),

  // 恢复已结束课堂
  restoreClassroom: (id: string) =>
    request(`/api/classroom/${id}/restore`, { method: 'POST' }),

  // Avatars
  getAvatars: (category?: string) =>
    request<any[]>(`/api/avatars${category ? `?category=${category}` : ''}`),
  getAllAvatars: (category?: string) =>
    request<any[]>(`/api/avatars/all${category ? `?category=${category}` : ''}`),
  createAvatar: (data: { name?: string; svgContent: string; category?: string; gender?: string; sortOrder?: number }) =>
    request('/api/avatars', { method: 'POST', body: JSON.stringify(data) }),
  updateAvatar: (id: number, data: { name?: string; svgContent?: string; gender?: string; sortOrder?: number }) =>
    request(`/api/avatars/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAvatar: (id: number) =>
    request<{ success: boolean; studentCount: number; classCount: number }>(`/api/avatars/${id}`, { method: 'DELETE' }),
  assignStudentsAvatar: (studentIds: string[], avatarId: number) =>
    request('/api/avatars/assign-students', { method: 'POST', body: JSON.stringify({ studentIds, avatarId }) }),
  clearStudentsAvatar: (studentIds: string[]) =>
    request('/api/avatars/clear-students', { method: 'POST', body: JSON.stringify({ studentIds }) }),
  autoAssignAvatar: (params: { studentIds?: string[]; classId?: string }) =>
    request<{ success: boolean; assigned: number }>('/api/avatars/auto-assign', { method: 'POST', body: JSON.stringify(params) }),
  setClassAvatar: (classId: string, avatarId: number | null) =>
    request(`/api/avatars/class/${classId}`, { method: 'PUT', body: JSON.stringify({ avatarId }) }),
  rewardStudentAvatar: (classroomId: string, studentId: string) =>
    request<{ success: boolean; tokens: number }>(`/api/classroom/${classroomId}/student/${studentId}/reward-avatar`, { method: 'POST' }),
  rewardStudentDirect: (studentId: string) =>
    request<{ success: boolean; tokens: number }>(`/api/avatars/reward-student/${studentId}`, { method: 'POST' }),
  studentSelfChangeAvatar: (studentId: string, data: { avatarId?: number; svgContent?: string; gender?: string }) =>
    request(`/api/avatars/student-self/${studentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAvatarsAll: (category?: string) =>
    request<any[]>(`/api/avatars/all-including-student${category ? `?category=${category}` : ''}`),
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
    return fetch(`${getApiBaseUrl()}/api/upload/avatar`, { method: 'POST', body: formData }).then(r => r.json());
  },

  // Export
  exportConversations: (classroomId: string) =>
    request<any>(`/api/export/${classroomId}/conversations`),
  exportConversationsFiltered: (classroomId: string, studentIds?: string[]) => {
    const params = studentIds?.length ? `?studentIds=${studentIds.join(',')}` : '';
    return request<any>(`/api/export/${classroomId}/conversations${params}`);
  },
  exportStats: (classroomId: string) =>
    request<any>(`/api/export/${classroomId}/stats`),
  exportStatsFiltered: (classroomId: string, studentIds?: string[]) => {
    const params = studentIds?.length ? `?studentIds=${studentIds.join(',')}` : '';
    return request<any>(`/api/export/${classroomId}/stats${params}`);
  },

  // 服务端生成 DOCX（对话记录）
  exportConversationsDocx: (classroomId: string, options?: { studentIds?: string[]; socketId?: string }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/conversations/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 DOCX（学情报表）
  exportStatsDocx: (classroomId: string, options?: { studentIds?: string[]; socketId?: string }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/stats/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 CSV（对话记录）
  exportConversationsCsv: (classroomId: string, options?: { studentIds?: string[] }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/conversations/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },

  // 服务端生成 CSV（学情报表）
  exportStatsCsv: (classroomId: string, options?: { studentIds?: string[] }) => {
    return fetch(`${getApiBaseUrl()}/api/export/${classroomId}/stats/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  },
  createBackup: () => request<{ success: boolean; path: string }>('/api/export/backup', { method: 'POST' }),
  getBackups: () => request<any[]>('/api/export/backups'),
  deleteBackup: (name: string) => request(`/api/export/backup/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  restoreBackup: (name: string) => request(`/api/export/restore/${encodeURIComponent(name)}`, { method: 'POST' }),
  resetAllData: () => request('/api/export/reset', { method: 'POST' }),
  uploadBackup: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${getApiBaseUrl()}/api/export/backup/upload`, {
      method: 'POST',
      body: formData,
    }).then(r => r.json());
  },
  getBackupDownloadUrl: (name: string) =>
    `${getApiBaseUrl()}/api/export/backup/${encodeURIComponent(name)}/download`,

  // Shield Words
  getShieldWords: () => request<any[]>('/api/shield/words'),
  getShieldCategories: () =>
    request<{ name: string; count: number; words: { id: string; word: string; enabled: boolean }[] }[]>('/api/shield/words/categories'),
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
    request<any>(`/api/shield/words/${id}/toggle`, { method: 'PUT' }),
  batchToggleShieldWords: (ids: string[], enabled: boolean) =>
    request('/api/shield/words/batch-toggle', { method: 'PUT', body: JSON.stringify({ ids, enabled }) }),
  getShieldConfig: () => request<any>('/api/shield/config'),
  updateShieldConfig: (data: { autoBlackCount?: number; rateLimit?: number }) =>
    request('/api/shield/config', { method: 'PUT', body: JSON.stringify(data) }),
  blacklistStudent: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/blacklist`, { method: 'POST' }),
  unblacklistStudent: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/unblacklist`, { method: 'POST' }),
  resetStudentWarnings: (classroomId: string, studentId: string) =>
    request(`/api/shield/classroom/${classroomId}/student/${studentId}/reset-warnings`, { method: 'POST' }),
  getClassroomWarnings: (classroomId: string) =>
    request<any[]>(`/api/shield/classroom/${classroomId}/warnings`),
  deleteWarning: (id: string) =>
    request(`/api/shield/warnings/${id}`, { method: 'DELETE' }),
  clearClassroomWarnings: (classroomId: string) =>
    request(`/api/shield/classroom/${classroomId}/warnings`, { method: 'DELETE' }),
  getWarningsSummary: () =>
    request<{ id: string; title: string; status: string; code: string; className: string; warningCount: number; createdAt: string }[]>('/api/shield/warnings-summary'),

  // Storage stats
  getStorageStats: () =>
    request<{
      avatars: { teacher: { count: number; totalSize: number; totalSizeText: string }; student: { count: number; totalSize: number; totalSizeText: string } };
      classIcons: { count: number; totalSize: number; totalSizeText: string };
      agentLogos: { count: number; totalSize: number; totalSizeText: string };
      classroomAttachments: {
        totalCount: number;
        totalSize: number;
        totalSizeText: string;
        classrooms: { id: string; title: string | null; status: string; interactionCount: number; totalRounds: number; attachmentCount: number; totalSize: number; totalSizeText: string }[];
      };
      agentUsage: { id: string; name: string; platform: string; classroomCount: number; totalCalls: number; totalChars: number }[];
    }>('/api/system/storage-stats'),

  // Changelogs
  getChangelogs: () =>
    request<{ version: string; date: string | null; content: string }[]>('/api/changelogs'),
};
