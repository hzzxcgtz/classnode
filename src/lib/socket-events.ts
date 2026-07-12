export interface ServerToClientEvents {
  [event: string]: (...args: never[]) => void;
  joined: (data: { classroomId: string; blacklisted: boolean }) => void;
  'student-auth-error': (data: { error: string }) => void;
  'teacher-auth-error': (data: { error: string }) => void;
  'classroom-ended': () => void;
  'classroom-paused': () => void;
  'classroom-resumed': () => void;
  'allow-stop-changed': (data: { allow: boolean }) => void;
  'allow-export-changed': (data: { allow: boolean }) => void;
  'follow-ups-changed': (data: { allow: boolean }) => void;
  'avatar-rewarded': (data: { tokens: number }) => void;
  'online-students': (data: { classroomId: string; studentIds: string[] }) => void;
  'export-progress': (data: { progress: number; stage: string }) => void;
}

export interface ClientToServerEvents {
  [event: string]: (...args: never[]) => void;
  'join-classroom': (data: { classroomCode: string; studentId: string; token?: string }) => void;
  'join-teacher-board': (classroomId: string) => void;
  'listen-classroom-status': (classroomId: string) => void;
  'send-message': (data: { classroomCode: string; studentId: string; content: string; fileUrls?: string[]; fileNames?: string[] }) => void;
  'stop-generation': () => void;
  'teacher-send-notification': (data: { classroomId: string; studentId?: string; groupId?: string; message: string }) => void;
}
