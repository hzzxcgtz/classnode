import { Server, Socket } from 'socket.io';
import { PrismaClient, Prisma } from '@prisma/client';
import { proxyAIRequestStream } from '../services/ai-proxy.js';
import type { AgentConfig } from '../services/ai-proxy.js';
import { anonymizer } from '../services/anonymizer.js';
import { buildShieldFilter } from '../services/shield-filter.js';
import { decrypt } from '../services/crypto.js';
import { hasTeacherSessionCookie } from '../middleware/auth.js';
import { verifyStudentToken } from '../middleware/student-auth.js';

/** 智能体异常告警冷却（同一 agentId 2 分钟内最多推送一次） */
const agentAlertCooldown = new Map<string, number>();
const AGENT_ALERT_COOLDOWN_MS = 2 * 60 * 1000;

/** 平台对话上下文 ID 存储（key: classroomId:studentId:agentId）
 *  智谱清言用 conversationId，文心用 threadId，都是 API 返回的上下文标识 */
const platformConversations = new Map<string, { conversationId: string; lastUsedAt: number }>();
const PLATFORM_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

/** 活跃 AI 流式请求的 AbortController（key: socketId）
 *  学生端请求停止生成时，通过此 map 中断对应的 AI 请求 */
const activeStreams = new Map<string, AbortController>();

/** 教师通知缓存：key=classroomId，value=最近 N 条通知（用于 socket 重连时回放）
 *  studentId=null 表示全班广播，回放时只有目标学生或全班消息才推给当前学生 */
const teacherNotificationCache = new Map<string, { id: string; message: string; timestamp: number; studentId: string | null }[]>();
const MAX_CACHED_NOTIFICATIONS = 5;
const NOTIFICATION_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
/** 学生提问频率限制：每分钟最多 10 条（被屏蔽词拦截的不计入） */
const RATE_LIMIT_WINDOW_MS = 60_000;
const studentMsgTimestamps = new Map<string, number[]>();
/** 缓存频率限制配置，每 10 秒刷新一次 */
let cachedRateLimit = 6;
let rateLimitCacheTime = 0;
const RATE_LIMIT_CACHE_TTL = 10_000;

/** 清理仅用于实时会话的内存缓存，避免桌面端长期运行时无界累积。 */
function pruneSocketCaches(now: number = Date.now()): void {
  for (const [studentId, timestamps] of studentMsgTimestamps) {
    const recent = timestamps.filter(timestamp => timestamp > now - RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) studentMsgTimestamps.delete(studentId);
    else studentMsgTimestamps.set(studentId, recent);
  }
  for (const [classroomId, notifications] of teacherNotificationCache) {
    const recent = notifications.filter(notification => notification.timestamp > now - NOTIFICATION_CACHE_TTL);
    if (recent.length === 0) teacherNotificationCache.delete(classroomId);
    else teacherNotificationCache.set(classroomId, recent);
  }
  for (const [agentId, lastAlert] of agentAlertCooldown) {
    if (lastAlert <= now - AGENT_ALERT_COOLDOWN_MS) agentAlertCooldown.delete(agentId);
  }
  for (const [key, conversation] of platformConversations) {
    if (conversation.lastUsedAt <= now - PLATFORM_CONVERSATION_TTL_MS) platformConversations.delete(key);
  }
}

async function getRateLimit(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  pruneSocketCaches(now);
  if (now - rateLimitCacheTime >= RATE_LIMIT_CACHE_TTL) {
    try {
      const config = await prisma.shieldConfig.findFirst();
      cachedRateLimit = config?.rateLimit ?? 6;
      rateLimitCacheTime = now;
    } catch {}
  }
  return cachedRateLimit;
}

async function checkRateLimit(studentId: string, prisma: PrismaClient): Promise<boolean> {
  const limit = await getRateLimit(prisma);
  if (limit <= 0) return true; // 0 = 不限制
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = studentMsgTimestamps.get(studentId) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  if (timestamps.length >= limit) {
    return false;
  }
  timestamps.push(now);
  studentMsgTimestamps.set(studentId, timestamps);
  return true;
}

/** 屏蔽词过滤器缓存（预构建 AC 自动机，避免每次发消息都重建） */
let cachedFilter: ((content: string) => { filtered: string; matched: string[] }) | null = null;
let shieldWordsCacheTime = 0;
const SHIELD_WORDS_CACHE_TTL = 3_000;

/**
 * 从原文中提取屏蔽词附近的上下文（取匹配词所在的一句话范围）
 * 用于拦截记录展示，只显示屏蔽词前后 1-2 句，而非整个提问
 */
function extractContextAroundMatch(content: string, matchedWords: string[], maxChars: number = 200): string {
  if (!content || matchedWords.length === 0) return content.slice(0, maxChars);

  // 中文句子结束标点
  const sentenceEnd = /[。！？!?\n]/;

  // 对每个屏蔽词找到其在原文中的位置，以句子为单位提取窗口
  const windows: { start: number; end: number }[] = [];
  const lowerContent = content.toLowerCase();

  for (const word of matchedWords) {
    if (!word) continue;
    const idx = lowerContent.indexOf(word.toLowerCase());
    if (idx === -1) continue;

    // 向后找到句子起点（上一个句子结束符后的第一个非空字符）
    let start = idx;
    // 回退最多 50 个字符找句子边界
    for (let i = idx - 1; i >= Math.max(0, idx - 50); i--) {
      if (sentenceEnd.test(content[i])) {
        start = i + 1;
        break;
      }
    }
    if (start === idx) start = Math.max(0, idx - 20); // 没找到句子边界，回退 20 字

    // 向前找到句子终点
    let end = idx + word.length;
    for (let i = idx + word.length; i < Math.min(content.length, idx + word.length + 50); i++) {
      if (sentenceEnd.test(content[i])) {
        end = i + 1;
        break;
      }
    }
    if (end === idx + word.length) end = Math.min(content.length, idx + word.length + 30);

    windows.push({ start, end });
  }

  // 合并重叠或相邻的窗口
  const sorted = windows.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const w of sorted) {
    if (merged.length === 0 || w.start > merged[merged.length - 1].end) {
      merged.push({ start: w.start, end: w.end });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, w.end);
    }
  }

  // 拼接窗口文本
  let result = merged.map(w => content.slice(w.start, w.end)).join('…');

  // 限制总长度
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + '…';
  }

  return result || content.slice(0, maxChars);
}

async function checkWithFilter(prisma: PrismaClient, content: string): Promise<{ filtered: string; matched: string[] } | null> {
  const now = Date.now();
  if (!cachedFilter || now - shieldWordsCacheTime >= SHIELD_WORDS_CACHE_TTL) {
    const words = await prisma.shieldWord.findMany({ where: { enabled: true }, select: { word: true } });
    const wordList = words.map(w => w.word);
    cachedFilter = wordList.length > 0 ? buildShieldFilter(wordList) : null;
    shieldWordsCacheTime = now;
  }
  if (!cachedFilter) return null;
  return cachedFilter(content);
}


interface JoinRoomData {
  classroomCode: string;
  studentId: string;
  token?: string;
}

interface SendMessageData {
  classroomCode: string;
  studentId: string;
  content: string;
  fileUrl?: string;
  fileName?: string;
  fileUrls?: string[];
  fileNames?: string[];
}

const MAX_STUDENT_MESSAGE_LENGTH = 10_000;
const MAX_CHAT_ATTACHMENTS = 5;
const CHAT_UPLOAD_URL = /^\/uploads\/chat\/chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|txt)$/i;

/**
 * Socket 事件不具备 HTTP 路由的参数校验，必须在进入 AI 代理前收紧边界。
 * 附件只接受本应用上传接口生成的聊天文件 URL，避免客户端伪造本地路径。
 */
export function validateStudentMessagePayload(value: unknown): SendMessageData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.classroomCode !== 'string' || !data.classroomCode.trim() ||
    typeof data.studentId !== 'string' || !data.studentId.trim() ||
    typeof data.content !== 'string' || !data.content.trim() ||
    data.content.length > MAX_STUDENT_MESSAGE_LENGTH
  ) return null;

  const rawUrls = Array.isArray(data.fileUrls)
    ? data.fileUrls
    : typeof data.fileUrl === 'string' ? [data.fileUrl] : [];
  if (rawUrls.length > MAX_CHAT_ATTACHMENTS || rawUrls.some(url => typeof url !== 'string' || !CHAT_UPLOAD_URL.test(url))) return null;

  const rawNames = Array.isArray(data.fileNames)
    ? data.fileNames
    : typeof data.fileName === 'string' ? [data.fileName] : [];
  if (rawNames.length > rawUrls.length || rawNames.some(name => typeof name !== 'string' || name.length > 255)) return null;

  return {
    classroomCode: data.classroomCode.trim(),
    studentId: data.studentId,
    content: data.content,
    fileUrls: rawUrls as string[],
    fileNames: rawNames as string[],
  };
}

/** 清理流式内容中的推理标签 */
function cleanStreamContent(text: string): string {
  let result = text;
  // 流式过程中可能出现的 <think> 不完整标签
  result = result.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
  return result;
}

/** 获取教室中已登录的学生 ID 列表 */
function getOnlineStudentIds(classroomId: string, connMap: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const key of connMap.keys()) {
    const [cid, sid] = key.split(':');
    if (cid === classroomId) ids.push(sid);
  }
  return ids;
}

/**
 * 只允许当前登记的连接将学生标记为离线。
 * 新连接顶下旧连接时，旧 socket 的 disconnect 事件会随后到达；若不做此判断，会把新连接误标为离线。
 */
export function clearCurrentStudentConnection(connMap: Map<string, string>, connKey: string, socketId: string): boolean {
  if (connMap.get(connKey) !== socketId) return false;
  connMap.delete(connKey);
  return true;
}

/** 暂停或结束课堂时中止该课堂所有仍在进行的 AI 生成。 */
export function abortClassroomStreams(
  classroomId: string,
  connMap: Map<string, string>,
  streams: Map<string, AbortController>,
): number {
  let count = 0;
  for (const [key, socketId] of connMap) {
    if (!key.startsWith(`${classroomId}:`)) continue;
    const controller = streams.get(socketId);
    if (!controller) continue;
    controller.abort();
    streams.delete(socketId);
    count++;
  }
  return count;
}

export function setupSocketHandlers(io: Server, prisma: PrismaClient, app?: import('express').Application) {
  // 追踪每个学生的活跃连接，key: `${classroomId}:${studentId}`
  const activeConnections = new Map<string, string>();
  // 暴露给 HTTP 路由使用
  if (app) {
    app.set('activeConnections', activeConnections);
    app.set('activeStreams', activeStreams);
  }
  const cacheCleanupTimer = setInterval(() => pruneSocketCaches(), NOTIFICATION_CACHE_TTL);
  cacheCleanupTimer.unref();
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // 身份选择页监听课堂在线状态（无需身份）
    socket.on('listen-classroom-status', (classroomId: string) => {
      socket.join(`status:${classroomId}`);
      socket.emit('online-students', { classroomId, studentIds: getOnlineStudentIds(classroomId, activeConnections) });
    });

    // 学生加入课堂
    socket.on('join-classroom', async (data: JoinRoomData) => {
      try {
        const classroom = await prisma.classroom.findUnique({
          where: { code: data.classroomCode },
          include: {
            classroomAgents: { include: { agent: true } },
            groups: { include: { agent: true } },
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
          return;
        }

        const studentSession = verifyStudentToken(data.token);
        if (!studentSession || studentSession.classroomId !== classroom.id || studentSession.studentId !== data.studentId) {
          socket.emit('student-auth-error', { error: '学生会话已失效，请重新选择身份' });
          return;
        }

        // 令牌签发后教师仍可能调整课堂成员；加入实时课堂前必须再次确认归属。
        const classroomStudent = await prisma.classroomStudent.findFirst({
          where: { classroomId: classroom.id, id: data.studentId },
        });
        if (!classroomStudent) {
          socket.emit('student-auth-error', { error: '你已不在当前课堂，请重新选择身份' });
          return;
        }

        // 同一学生重复连接时，断开旧连接，保留新连接
        const connKey = `${classroom.id}:${classroomStudent.id}`;
        const oldSocketId = activeConnections.get(connKey);
        if (oldSocketId && oldSocketId !== socket.id) {
          try { io.sockets.sockets.get(oldSocketId)?.emit('ai-error', { error: '账号已在其他设备登录' }); } catch {}
          try { io.sockets.sockets.get(oldSocketId)?.disconnect(true); } catch {}
        }

        // 记录新连接
        activeConnections.set(connKey, socket.id);

        // 更新学生状态
        await prisma.classroomStudent.updateMany({
          where: {
            classroomId: classroom.id,
            id: data.studentId,
          },
          data: { status: 'online' },
        });

        socket.join(`classroom:${classroom.id}`);
        if (classroomStudent.studentId) socket.join(`student:${classroomStudent.studentId}`);
        socket.data.classroomId = classroom.id;
        socket.data.studentId = classroomStudent.id;

        socket.emit('joined', {
          classroomId: classroom.id,
          agents: classroom.classroomAgents.map((ca: Prisma.ClassroomAgentGetPayload<{ include: { agent: true } }>) => ({
            id: ca.agent.id,
            name: ca.agent.name,
            logo: ca.agent.logo,
            platform: ca.agent.platform,
          })),
          groups: classroom.groups,
          blacklisted: classroomStudent?.blacklisted || false,
        });

        // 若已被黑屏，立即通知学生端
        if (classroomStudent?.blacklisted) {
          socket.emit('student-blacklisted', { studentId: classroomStudent.id });
        }

        // 重放教师缓存通知（断开连接期间错过的消息）
        try {
          const cached = teacherNotificationCache.get(classroom.id);
          if (cached && cached.length > 0) {
            const validCutoff = Date.now() - NOTIFICATION_CACHE_TTL;
            for (const n of cached) {
              // 只放行全班广播（studentId===null）或发给当前学生的通知
              if (n.timestamp > validCutoff && (n.studentId === null || n.studentId === classroomStudent.id)) {
                socket.emit('teacher-notification', { id: n.id, message: n.message });
              }
            }
          }
        } catch {}

        // 通知教师端
        io.to(`teacher:${classroom.id}`).emit('student-online', {
          studentId: classroomStudent.id,
          socketId: socket.id,
        });

        // 广播在线状态给身份选择页
        io.to(`status:${classroom.id}`).emit('online-students', { classroomId: classroom.id, studentIds: getOnlineStudentIds(classroom.id, activeConnections) });

        console.log(`[Socket] Participant ${classroomStudent.id} joined classroom ${classroom.id}`);
      } catch (error) {
        console.error('[Socket] join-classroom error:', error);
        socket.emit('ai-error', { error: '加入课堂失败' });
      }
    });

    // 教师加入课堂看板
    socket.on('join-teacher-board', async (classroomId: string) => {
      if (!hasTeacherSessionCookie(socket.handshake.headers.cookie)) {
        socket.emit('teacher-auth-error', { error: '教师会话已失效，请重新登录' });
        return;
      }
      socket.join(`teacher:${classroomId}`);
      socket.data.classroomId = classroomId;
      socket.data.isTeacher = true;
      console.log(`[Socket] Teacher joined board: ${classroomId}`);
    });

    // 学生发送消息（流式）
    socket.on('send-message', async (input: SendMessageData) => {
      try {
        const data = validateStudentMessagePayload(input);
        if (!data) {
          socket.emit('ai-error', { error: '消息或附件格式无效' });
          return;
        }
        if (!socket.data.classroomId || !socket.data.studentId || socket.data.studentId !== data.studentId) {
          socket.emit('student-auth-error', { error: '学生身份无效，请重新进入课堂' });
          return;
        }
        const classroom = await prisma.classroom.findUnique({
          where: { code: data.classroomCode },
          include: {
            classroomAgents: {
              include: { agent: true },
            },
            groups: {
              include: { agent: true },
            },
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
          return;
        }
        if (classroom.id !== socket.data.classroomId) {
          socket.emit('student-auth-error', { error: '课堂身份不匹配' });
          return;
        }

        if (classroom.status === 'paused') {
          socket.emit('ai-error', { error: '课堂已暂停，请等待老师继续' });
          return;
        }

        const classroomStudent = await prisma.classroomStudent.findFirst({
          where: {
            classroomId: classroom.id,
            studentId: data.studentId,
          },
          include: { student: true, group: true },
        });

        if (!classroomStudent) {
          socket.emit('ai-error', { error: '未找到学生记录' });
          return;
        }

        const studentName = classroomStudent.student?.name || classroomStudent.group?.name || '未命名小组';
        const displayParticipantId = classroomStudent.id;
        // Shield word check
        // Check if student is blacklisted
        if (classroomStudent.blacklisted) {
          socket.emit('ai-error', { error: '你已被老师黑屏处理，暂时无法发送消息' });
          socket.emit('student-blacklisted', { studentId: data.studentId });
          return;
        }
        // Load shield words and check content (使用预构建 AC 自动机)
        const shieldResult = await checkWithFilter(prisma, data.content);
        if (shieldResult && shieldResult.matched.length > 0) {
          const { filtered, matched } = shieldResult;
          if (matched.length > 0) {
            // 记录原文后再替换为过滤版（Warning 存原文供教师查阅）
            const originalContent = data.content;
            data.content = filtered;
            // Save the filtered user message
            const filteredMessage = await prisma.message.create({
              data: {
                classroomId: classroom.id,
                studentId: classroomStudent.id,
                content: filtered,
                role: 'user',
                displayName: anonymizer.anonymize(studentName),
              },
            });
            // Broadcast filtered message to teacher
            io.to(`teacher:${classroom.id}`).emit('student-message', {
              studentId: displayParticipantId,
              studentName,
              content: filtered,
              role: 'user',
              messageId: filteredMessage.id,
              timestamp: filteredMessage.createdAt,
              shieldFiltered: true,
            });
            // Create warning record with original content + matched words
            await prisma.shieldWarning.create({
              data: {
                classroomId: classroom.id,
                studentId: classroomStudent.id,
                word: matched.join(', '),
                content: extractContextAroundMatch(originalContent, matched, 200),
              },
            });
            // Increment warning count (原子操作，使用返回值确保准确)
            const updatedCS = await prisma.classroomStudent.update({
              where: { id: classroomStudent.id },
              data: { warningCount: { increment: 1 } },
            });
            const newWarningCount = updatedCS.warningCount;
            // Emit warning to teacher
            io.to(`teacher:${classroom.id}`).emit('shield-warning', {
              studentId: displayParticipantId,
              studentName,
              matched,
              filteredContent: filtered,
              warningCount: newWarningCount,
              classroomId: classroom.id,
            });
            // Emit warning to student (without revealing the actual words)
            io.to(socket.id).emit('shield-warned', {
              filteredContent: filtered,
              warningCount: newWarningCount,
              studentName,
            });
            // Check auto-blacklist threshold
            const shieldConfig = await prisma.shieldConfig.findFirst();
            const threshold = shieldConfig?.autoBlackCount || 0;
            if (threshold > 0 && newWarningCount >= threshold) {
              await prisma.classroomStudent.update({
                where: { id: classroomStudent.id },
                data: { blacklisted: true },
              });
              io.to(`teacher:${classroom.id}`).emit('student-blacklisted', { studentId: data.studentId, studentName, autoBlack: true });
              io.to(socket.id).emit('student-blacklisted', { studentId: data.studentId });
              io.to(socket.id).emit('ai-error', { error: `你已被自动黑屏（累计触发 ${threshold} 次）` });
            }
            // Do NOT proceed to AI call
            return;
          }
        }

        // Determine agent: for group/advanced mode, use the group's agent; otherwise use the first classroom agent
        let agent;
        if ((classroom.mode === 'group' || classroom.mode === 'advanced') && classroomStudent.group?.agentId) {
          const classroomGroup = classroom.groups.find(g => g.id === classroomStudent.groupId);
          agent = classroomGroup?.agent || null;
        } else {
          agent = classroom.classroomAgents[0]?.agent;
        }
        if (!agent) {
          socket.emit('ai-error', { error: '未配置AI智能体' });
          return;
        }

        // 智能体被停用时不调用 AI，给出温馨提示
        if (agent.enabled === false) {
          // 保存用户消息（保留对话记录）
          const userMessage = await prisma.message.create({
            data: {
              classroomId: classroom.id,
              studentId: classroomStudent.id,
              content: data.content,
              role: 'user',
              displayName: anonymizer.anonymize(studentName),
              fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
              fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
            },
          });
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId, studentName,
            content: data.content, role: 'user',
            messageId: userMessage.id, timestamp: userMessage.createdAt,
            fileUrls: data.fileUrls, fileNames: data.fileNames,
          });
          io.to(socket.id).emit('agent-disabled', {
            agentName: agent.name,
          });
          return;
        }

        // 提问频率限制（被屏蔽的消息不计入）
        if (!(await checkRateLimit(data.studentId, prisma))) {
          socket.emit('ai-error', { error: `提问太频繁了，请稍后再试（每分钟限 ${cachedRateLimit} 次）` });
          return;
        }

        // AI Proxy call (流式)
        // 先取历史再存消息，确保 additional_messages 不含当前消息，避免重复
        const pastMessages = await prisma.message.findMany({
          where: { studentId: classroomStudent.id },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });

        // 取最近 30 条消息（约 15 轮对话），反转回正序
        const recentHistory = pastMessages.reverse();
        const formattedHistory = recentHistory.map((h: Prisma.MessageGetPayload<object>) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        }));

        // 计算 roundCount：统计 DB 中所有 user 消息数 + 1（当前消息还没存）
        const pastUserCount = await prisma.message.count({
          where: { studentId: classroomStudent.id, role: 'user' },
        });
        const roundCount = pastUserCount + 1;

        // Save user message
        const userMessage = await prisma.message.create({
          data: {
            classroomId: classroom.id,
            studentId: classroomStudent.id,
            content: data.content,
            role: 'user',
            displayName: anonymizer.anonymize(studentName),
            fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
            fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
          },
        });

        // Broadcast to teacher board
        io.to(`teacher:${classroom.id}`).emit('student-message', {
          studentId: data.studentId,
          studentName,
          content: data.content,
          role: 'user',
          roundIndex: roundCount,
          messageId: userMessage.id,
          timestamp: userMessage.createdAt,
          fileUrls: data.fileUrls,
          fileNames: data.fileNames,
        });

        // 通知学生正在思考
        io.to(`teacher:${classroom.id}`).emit('student-thinking', {
          studentId: data.studentId,
          status: true,
        });

        // Send to student that AI is thinking
        io.to(socket.id).emit('ai-thinking');

        // 智谱清言 / 文心使用对话上下文 ID 维护记忆，从内存中恢复
        const platformNeedsConvId = ['coze', 'zhipuai', 'wenxin'].includes(agent.platform);
        const platformConvKey = `${classroom.id}:${data.studentId}:${agent.id}`;
        const storedConversation = platformConversations.get(platformConvKey);
        const platformConvId = storedConversation?.conversationId;
        const agentConfig: AgentConfig = {
          platform: agent.platform,
          apiUrl: agent.apiUrl || undefined,
          apiKey: (() => { try { return decrypt(agent.apiKey); } catch { return agent.apiKey; } })(),
          botId: agent.botId || undefined,
          extra: agent.extra || undefined,
          conversationId: platformNeedsConvId ? platformConvId : undefined,
        };

        const abortController = new AbortController();
        const streamKey = socket.id;
        activeStreams.set(streamKey, abortController);

        let fullContent = '';
        let displayedContent = '';
        let hasDeepThinking = false; // 是否接收到了深度思考内容
        try {
          const result = await proxyAIRequestStream(
            agentConfig,
            data.content,
            studentName,
            (chunk) => {
              // 首次收到回答 chunk，若之前有深度思考，通知教师端思考阶段结束
              if (hasDeepThinking) {
                hasDeepThinking = false;
                io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                  studentId: data.studentId,
                  status: false,
                });
              }
              fullContent += chunk;
              // 实时清理流式内容，隐藏 Markdown 图片链接
              const cleanFull = cleanStreamContent(fullContent);
              if (cleanFull.length > displayedContent.length) {
                const newPart = cleanFull.slice(displayedContent.length);
                displayedContent = cleanFull;
                // 实时推送给学生
                io.to(socket.id).emit('ai-chunk', { content: newPart, roundIndex: roundCount });
                // 实时推送给教师看板
                io.to(`teacher:${classroom.id}`).emit('student-chunk', {
                  studentId: data.studentId,
                  content: newPart,
                  roundIndex: roundCount,
                });
              }
            },
            formattedHistory,
            data.fileUrls || (data.fileUrl ? [data.fileUrl] : []),
            abortController.signal,
            (thinking) => {
              // 深度思考内容到达
              if (!hasDeepThinking) {
                hasDeepThinking = true;
                // 通知教师端学生正在深度思考
                io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                  studentId: data.studentId,
                  status: true,
                });
              }
              // 将思考内容实时推送给学生端（不保存到数据库）
              io.to(socket.id).emit('ai-thinking-content', { content: thinking });
            }
          );

          if (result.aborted) {
            // 用户中断生成：不保存、不推送任何内容，直接丢弃
            if (hasDeepThinking) {
              hasDeepThinking = false;
              io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                studentId: data.studentId,
                status: false,
              });
            }
            io.to(`teacher:${classroom.id}`).emit('student-thinking', {
              studentId: data.studentId,
              status: false,
            });
            return;
          }

          if (result.success && result.content) {
          // 保存平台对话上下文 ID（智谱清言 conversationId / 文心 threadId），后续请求保持上下文
          // 必须在 success 块内保存，防止工具调用失败等场景保存了损坏的 context id
          if (platformNeedsConvId && result.conversationId) {
            platformConversations.set(platformConvKey, { conversationId: result.conversationId, lastUsedAt: Date.now() });
          }
          // Save AI response
          const aiMessage = await prisma.message.create({
            data: {
              classroomId: classroom.id,
              studentId: classroomStudent.id,
              content: result.content,
              role: 'assistant',
              roundIndex: roundCount,
              agentId: agent.id,
              followUps: result.followUps ? JSON.stringify(result.followUps) : undefined,
            },
          });

          // Update interaction stats
          await prisma.interaction.upsert({
            where: {
              classroomId_studentId: {
                classroomId: classroom.id,
                studentId: data.studentId,
              },
            },
            create: {
              classroomId: classroom.id,
              studentId: data.studentId,
              totalRounds: roundCount,
              firstMsgLen: roundCount === 1 ? data.content.length : undefined,
            },
            update: {
              totalRounds: roundCount,
            },
          });

          // Update classroom student round count
          await prisma.classroomStudent.update({
            where: { id: classroomStudent.id },
            data: { totalRounds: { increment: 1 } },
          });

          // Send AI completion to student
          io.to(socket.id).emit('ai-response', {
            content: result.content,
            messageId: aiMessage.id,
            roundIndex: roundCount,
            followUps: result.followUps,
          });

          // Broadcast to teacher board
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId,
            studentName,
            content: result.content,
            role: 'assistant',
            roundIndex: roundCount,
            messageId: aiMessage.id,
            timestamp: aiMessage.createdAt,
            followUps: result.followUps,
          });

          // Notify teacher AI stopped thinking
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
        } else {
          // AI 响应失败，清理深度思考状态（如果有）
          if (hasDeepThinking) {
            hasDeepThinking = false;
            io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
              studentId: data.studentId,
              status: false,
            });
          }
          io.to(socket.id).emit('ai-error', {
            error: result.error || 'AI 响应失败',
          });
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
          // 更新智能体状态并推送告警（带冷却，同一智能体 2 分钟内只通知一次）
          if (agent) {
            try {
              await prisma.agent.update({
                where: { id: agent.id },
                data: {
                  lastCheckAt: new Date(),
                  lastCheckOk: false,
                  lastCheckError: result.error || '连接失败',
                },
              });
            } catch {}
            const now = Date.now();
            const lastAlert = agentAlertCooldown.get(agent.id);
            if (!lastAlert || now - lastAlert > AGENT_ALERT_COOLDOWN_MS) {
              agentAlertCooldown.set(agent.id, now);
              io.emit('agent-connection-lost', {
                agentId: agent.id,
                agentName: agent.name,
              });
              io.emit('agents-checked', { failed: [agent.name] });
            }
          }
          }
        } finally {
          activeStreams.delete(streamKey);
        }
      } catch (error) {
        console.error('[Socket] send-message error:', error);
        io.to(socket.id).emit('ai-error', { error: '消息发送失败' });
      }
    });

    // 学生请求停止 AI 生成
    socket.on('stop-generation', async () => {
      // 查该学生所在课堂是否允许中断
      let classroomId: string | null = null;
      for (const room of socket.rooms) {
        if (room.startsWith('classroom:')) { classroomId = room.slice(10); break; }
      }
      if (classroomId) {
        const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
        if (!classroom || !classroom.allowStudentStop) return;
      }
      const controller = activeStreams.get(socket.id);
      if (controller) {
        controller.abort();
      }
    });

    // 教师发送通知给学生：全班广播 / 定向单个学生 / 定向多个学生（如小组成员）
    // 教师通知：全班广播 / 定向单个学生 / 定向组（分组/高级模式）
    socket.on('teacher-send-notification', async (data: unknown) => {
      if (!socket.data.isTeacher || !hasTeacherSessionCookie(socket.handshake.headers.cookie)) {
        socket.emit('teacher-auth-error', { error: '无权发送教师通知' });
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        socket.emit('teacher-auth-error', { error: '通知格式无效' });
        return;
      }
      const { classroomId, studentId, groupId, message } = data as {
        classroomId?: unknown; studentId?: unknown; groupId?: unknown; message?: unknown;
      };
      if (
        typeof classroomId !== 'string' || classroomId !== socket.data.classroomId ||
        typeof message !== 'string' || !message.trim() || message.length > 1_000 ||
        (studentId !== undefined && typeof studentId !== 'string') ||
        (groupId !== undefined && typeof groupId !== 'string')
      ) {
        socket.emit('teacher-auth-error', { error: '通知格式无效或课堂不匹配' });
        return;
      }
      try {
        if (groupId) {
          // 定向到组：该组只有一个小组参与者，通知与实时连接均使用参与者 ID。
          const members = await prisma.classroomStudent.findMany({
            where: { classroomId, groupId },
            select: { id: true, studentId: true },
          });
          for (const m of members) {
            const notif = await prisma.teacherNotification.create({
              data: { classroomId, studentId: m.id, groupId, content: message },
            });
            if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
            const cache = teacherNotificationCache.get(classroomId)!;
            cache.push({ id: notif.id, message, timestamp: Date.now(), studentId: m.id });
            const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
            teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
            const connKey = `${classroomId}:${m.id}`;
            const targetSocketId = activeConnections.get(connKey);
            if (targetSocketId) {
              io.to(targetSocketId).emit('teacher-notification', { id: notif.id, message });
            }
          }
        } else if (studentId) {
          // 定向到单个学生
          const notif = await prisma.teacherNotification.create({
            data: { classroomId, studentId, content: message },
          });
          if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
          const cache = teacherNotificationCache.get(classroomId)!;
          cache.push({ id: notif.id, message, timestamp: Date.now(), studentId });
          const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
          teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
          const connKey = `${classroomId}:${studentId}`;
          const targetSocketId = activeConnections.get(connKey);
          if (targetSocketId) {
            io.to(targetSocketId).emit('teacher-notification', { id: notif.id, message });
          }
        } else {
          // 全班广播
          const notif = await prisma.teacherNotification.create({
            data: { classroomId, studentId: null, content: message },
          });
          if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
          const cache = teacherNotificationCache.get(classroomId)!;
          cache.push({ id: notif.id, message, timestamp: Date.now(), studentId: null });
          const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
          teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
          io.to(`classroom:${classroomId}`).emit('teacher-notification', { id: notif.id, message });
        }
      } catch (err) {
        console.error('[Socket] save notification error:', err);
      }
    });

    // 断开连接
    socket.on('disconnect', async () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      // 浏览器关闭、网络切换或被新设备顶下线时，立即取消仍在进行的 AI 请求。
      // 否则上游流会持续到自然结束，既浪费额度也可能留下无接收方的任务。
      const activeStream = activeStreams.get(socket.id);
      if (activeStream) {
        activeStream.abort();
        activeStreams.delete(socket.id);
      }
      const { classroomId, studentId, isTeacher } = socket.data;
      const connKey = classroomId && studentId ? `${classroomId}:${studentId}` : null;

      // 清理活跃连接记录
      const disconnectedCurrentStudent = connKey
        ? clearCurrentStudentConnection(activeConnections, connKey, socket.id)
        : false;

      if (classroomId && studentId && !isTeacher && disconnectedCurrentStudent) {
        // 更新学生离线状态
        await prisma.classroomStudent.updateMany({
          where: { classroomId, id: studentId },
          data: { status: 'offline' },
        });

        io.to(`teacher:${classroomId}`).emit('student-offline', {
          studentId,
        });

        // 广播在线状态给身份选择页
        io.to(`status:${classroomId}`).emit('online-students', { classroomId, studentIds: getOnlineStudentIds(classroomId, activeConnections) });
      }
    });
  });
}
