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
  // ── 探究助手实时监控（P2 / 规格 §5.5）────────────────────────────────
  // 事件名与载荷由 T5 定死，T6（学生端面板）与 T7（教师看板）都照这里写，不得自行发明。
  //
  // 教师看板：只发给 `teacher:<id>:webapp` 房间里的人（= 正开着探究助手视图的教师）。
  // 没有教师订阅时服务端**一个字节都不转发**（Ruling 9 的按需推流）。
  'webapp-student-event': (data: { studentId: string; webappId: string; events: WebappEvent[] }) => void;
  // 缩略图：每个学生每个网页**只保留最新一帧**，旧的直接被覆盖（不是追加）。
  'webapp-student-frame': (data: { studentId: string; webappId: string; dataUrl: string; at: number }) => void;
  // 学生端：本课堂现在有没有教师在看探究助手视图。
  //   · 学生在 join-classroom 成功后**立刻**收到一次（决定要不要开始推流）；
  //   · 教师订阅时广播 watching:true；
  //   · 教师全部离开时**延迟 15 秒**才广播 watching:false（防刷新抖动，Ruling 9）。
  // ⚠️ 载荷**只有** watching 这一个字段。截图降频的档位不在这里：耗时是**学生设备**
  //    测出来的（老 iPad 与新电脑的档位本就该不同），由 SDK 自己测、自己降档。
  'webapp-monitor-demand': (data: { watching: boolean }) => void;
}

export interface ClientToServerEvents {
  [event: string]: (...args: never[]) => void;
  'join-classroom': (data: { classroomCode: string; studentId: string; token?: string }) => void;
  'join-teacher-board': (classroomId: string) => void;
  'listen-classroom-status': (classroomId: string) => void;
  'send-message': (data: { classroomCode: string; studentId: string; content: string; fileUrls?: string[]; fileNames?: string[] }) => void;
  'stop-generation': () => void;
  'teacher-send-notification': (data: { classroomId: string; studentId?: string; groupId?: string; message: string }) => void;
  // ── 探究助手实时监控（P2 / 规格 §5.5）────────────────────────────────
  // 学生端 → 服务端。两条都带 classroomId：服务端要拿它与 socket 会话比对（归属校验），
  // 光靠 socket 想定身份会让「同一条连接换课堂」这类错误无声通过。
  'webapp-event': (data: { classroomId: string; webappId: string; events: WebappEvent[] }) => void;
  'webapp-frame': (data: { classroomId: string; webappId: string; dataUrl: string }) => void;
  // 教师端 → 服务端：视图挂载 / 卸载。服务端据此维护 `teacher:<id>:webapp` 房间，
  // 并按需广播 webapp-monitor-demand。⚠️ 卸载时必须发 unwatch，否则学生端永不停止推流。
  'watch-webapp-monitor': (data: { classroomId: string }) => void;
  'unwatch-webapp-monitor': (data: { classroomId: string }) => void;
}

/**
 * 探究助手 SDK 采集到的一条结构事件。
 *
 * ⚠️ **这里没有、也不该有任何「内容」字段**（规格 §5.4 的隐私红线）：
 * selector 是结构定位串，length 是输入框里字符的**个数**，to 是短枚举字面量。
 * 要采集学生输入的具体内容，只能由教师网页显式调用 `ClassNode.report()`。
 * 服务端对这条形状做**白名单式重建**（server/src/socket/index.ts 的
 * sanitizeWebappEvent）：契约之外的字段进不了内存，也到不了教师看板。
 */
export interface WebappEvent {
  kind: 'click' | 'input' | 'scroll' | 'navigate' | 'visibility' | 'report';
  selector: string;
  inputType: string;
  length: number;
  depth: number;
  to: string;
  at: number;
}
