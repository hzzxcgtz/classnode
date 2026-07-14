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
  id: string;
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
  studentId: string;
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
}

export interface ClassroomHistoryItem extends ClassroomSummary {
  createdAt: string;
  endedAt: string | null;
  totalChars: number;
  participantCount: number;
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
}

export interface StudentClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  agents: AgentSummary[];
  groups?: Array<ClassroomCardGroup & { agent: AgentSummary }>;
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
    student: Pick<StudentSummary, 'id' | 'name' | 'studentNo' | 'gender' | 'avatarId'>;
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
