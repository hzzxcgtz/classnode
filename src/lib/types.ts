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

export interface StudentSessionResponse {
  token: string;
  expiresIn: number;
}
