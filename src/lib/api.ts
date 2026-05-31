function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const port = window.location.port;
    if (port === '3000') return `http://localhost:3001`;
    return '';
  }
  return '';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
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
  testAgent: (id: string) => request<{ success: boolean; error?: string }>(`/api/agents/${id}/test`, { method: 'POST' }),

  // Classes
  getClasses: () => request<any[]>('/api/classes'),
  createClass: (name: string) =>
    request('/api/classes', { method: 'POST', body: JSON.stringify({ name }) }),
  updateClass: (id: string, name: string) =>
    request(`/api/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
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
  addStudent: (classId: string, data: { name: string }) =>
    request(`/api/classes/${classId}/students`, { method: 'POST', body: JSON.stringify(data) }),
  batchImportStudents: (classId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${getApiBaseUrl()}/api/classes/${classId}/students/batch`, { method: 'POST', body: form }).then(r => r.json());
  },
  batchCreateStudentsFromNames: (classId: string, names: string[]) =>
    request(`/api/classes/${classId}/students/batch-names`, { method: 'POST', body: JSON.stringify({ names }) }),
  deleteStudent: (classId: string, studentId: string) =>
    request(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' }),
  updateStudent: (classId: string, studentId: string, data: { name?: string; studentNo?: string; tag?: string }) =>
    request(`/api/classes/${classId}/students/${studentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  downloadTemplate: () => `${getApiBaseUrl()}/api/classes/template`,

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
  getAllMessages: (classroomId: string) =>
    request<any[]>(`/api/classroom/${classroomId}/all-messages`),
  clearStudentMessages: (classroomId: string, studentId: string) =>
    request(`/api/classroom/${classroomId}/student/${studentId}/messages`, { method: 'DELETE' }),
  endClassroom: (id: string) => request(`/api/classroom/${id}/end`, { method: 'POST' }),
  pauseClassroom: (id: string) => request(`/api/classroom/${id}/pause`, { method: 'POST' }),
  resumeClassroom: (id: string) => request(`/api/classroom/${id}/resume`, { method: 'POST' }),
  getHistory: () => request<any[]>('/api/classroom/history/all'),
  getAllClassrooms: () => request<any[]>('/api/classroom/all'),

  // Export
  exportConversations: (classroomId: string) =>
    request<any>(`/api/export/${classroomId}/conversations`),
  exportStats: (classroomId: string) =>
    request<any>(`/api/export/${classroomId}/stats`),
  createBackup: () => request<{ success: boolean; path: string }>('/api/export/backup', { method: 'POST' }),
  getBackups: () => request<any[]>('/api/export/backups'),
  deleteBackup: (name: string) => request(`/api/export/backup/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  restoreBackup: (name: string) => request(`/api/export/restore/${encodeURIComponent(name)}`, { method: 'POST' }),
  resetAllData: () => request('/api/export/reset', { method: 'POST' }),
};
