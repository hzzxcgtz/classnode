export interface ServerToClientEvents {
  [event: string]: (...args: never[]) => void;
  // 服务端 join-classroom 成功后下发（server/src/socket/index.ts 的 socket.emit('joined', …)）。
  // 学生端目前不监听它（首屏与兜底都走 GET /code/:code 轮询），但声明按真实 payload 写，
  // 免得以后有人照着旧的 { classroomId, blacklisted } 去用而拿到 undefined。
  joined: (data: {
    classroomId: string;
    agents: { id: string; name: string; logo: string | null; platform: string }[];
    groups: { id: string; name: string; agentId: string; agent: { id: string; name: string; logo: string | null; platform: string } }[];
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
