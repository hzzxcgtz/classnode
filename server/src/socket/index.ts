import { Server, Socket } from 'socket.io';
import { PrismaClient, Prisma } from '@prisma/client';
import { proxyAIRequest, proxyAIRequestStream } from '../services/ai-proxy.js';
import { anonymizer } from '../services/anonymizer.js';

interface JoinRoomData {
  classroomCode: string;
  studentId: string;
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

export function setupSocketHandlers(io: Server, prisma: PrismaClient) {
  // 追踪每个学生的活跃连接，key: `${classroomId}:${studentId}`
  const activeConnections = new Map<string, string>();

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
            groups: true,
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
          return;
        }

        // 检查该学生是否已在其他设备登录
        const connKey = `${classroom.id}:${data.studentId}`;
        if (activeConnections.has(connKey)) {
          // 拒绝新连接，提示该姓名已被登录
          socket.emit('identity-conflict', { error: `"${data.studentId}" 这个姓名已经有同学登录了，不能重复登录` });
          return;
        }

        // 记录新连接
        activeConnections.set(connKey, socket.id);

        // 更新学生状态
        await prisma.classroomStudent.updateMany({
          where: {
            classroomId: classroom.id,
            studentId: data.studentId,
          },
          data: { status: 'online' },
        });

        socket.join(`classroom:${classroom.id}`);
        socket.data.classroomId = classroom.id;
        socket.data.studentId = data.studentId;

        socket.emit('joined', {
          classroomId: classroom.id,
          agents: classroom.classroomAgents.map((ca: Prisma.ClassroomAgentGetPayload<{ include: { agent: true } }>) => ({
            id: ca.agent.id,
            name: ca.agent.name,
            logo: ca.agent.logo,
            platform: ca.agent.platform,
          })),
          groups: classroom.groups,
        });

        // 通知教师端
        io.to(`teacher:${classroom.id}`).emit('student-online', {
          studentId: data.studentId,
          socketId: socket.id,
        });

        // 广播在线状态给身份选择页
        io.to(`status:${classroom.id}`).emit('online-students', { classroomId: classroom.id, studentIds: getOnlineStudentIds(classroom.id, activeConnections) });

        console.log(`[Socket] Student ${data.studentId} joined classroom ${classroom.id}`);
      } catch (error) {
        console.error('[Socket] join-classroom error:', error);
        socket.emit('ai-error', { error: '加入课堂失败' });
      }
    });

    // 教师加入课堂看板
    socket.on('join-teacher-board', async (classroomId: string) => {
      socket.join(`teacher:${classroomId}`);
      socket.data.classroomId = classroomId;
      socket.data.isTeacher = true;
      console.log(`[Socket] Teacher joined board: ${classroomId}`);
    });

    // 学生发送消息（流式）
    socket.on('send-message', async (data: SendMessageData) => {
      try {
        const classroom = await prisma.classroom.findUnique({
          where: { code: data.classroomCode },
          include: {
            classroomAgents: {
              include: { agent: true },
            },
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
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
          include: { student: true },
        });

        if (!classroomStudent) {
          socket.emit('ai-error', { error: '未找到学生记录' });
          return;
        }

        const studentName = classroomStudent.student.name;

        // Find the agent for this student
        const agent = classroom.classroomAgents[0]?.agent;
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
              studentId: (await prisma.classroomStudent.findFirst({
                where: { classroomId: classroom.id, studentId: data.studentId },
              }))!.id,
              content: data.content,
              role: 'user',
              displayName: data.studentId,
              fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
              fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
            },
          });
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId, studentName: data.studentId,
            content: data.content, role: 'user',
            messageId: userMessage.id, timestamp: userMessage.createdAt,
            fileUrls: data.fileUrls, fileNames: data.fileNames,
          });
          io.to(socket.id).emit('agent-disabled', {
            agentName: agent.name,
          });
          return;
        }

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

        // Update rounds count
        const roundCount = await prisma.message.count({
          where: {
            studentId: classroomStudent.id,
            role: 'user',
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

        // AI Proxy call (流式)
        const history = await prisma.message.findMany({
          where: { studentId: classroomStudent.id },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });

        const formattedHistory = history.map((h: Prisma.MessageGetPayload<{}>) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        }));

        const agentConfig = {
          platform: agent.platform,
          apiUrl: agent.apiUrl || undefined,
          apiKey: agent.apiKey,
          botId: agent.botId || undefined,
          extra: agent.extra || undefined,
        };

        let fullContent = '';
        let displayedContent = '';
        const result = await proxyAIRequestStream(
          agentConfig,
          data.content,
          studentName,
          (chunk) => {
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
          data.fileUrls || (data.fileUrl ? [data.fileUrl] : [])
        );

        console.log('[Socket] AI result:', JSON.stringify({ success: result.success, contentLen: result.content?.length, error: result.error, hasContent: !!result.content }).slice(0, 300));

        if (result.success && result.content) {
          // Save AI response（同时保存用户上传的 fileUrls，确保刷新后图片仍有展示）
          const aiMessage = await prisma.message.create({
            data: {
              classroomId: classroom.id,
              studentId: classroomStudent.id,
              content: result.content,
              role: 'assistant',
              roundIndex: roundCount,
              agentId: agent.id,
              tokenUsage: result.tokenUsage,
              fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
              fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
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
              totalTokens: result.tokenUsage,
            },
            update: {
              totalRounds: roundCount,
              totalTokens: {
                increment: result.tokenUsage || 0,
              },
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
          });

          // Broadcast to teacher board
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId,
            studentName,
            content: result.content,
            role: 'assistant',
            roundIndex: roundCount,
            messageId: aiMessage.id,
            tokenUsage: result.tokenUsage,
            timestamp: aiMessage.createdAt,
          });

          // Notify teacher AI stopped thinking
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
        } else {
          io.to(socket.id).emit('ai-error', {
            error: result.error || 'AI 响应失败',
          });
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
        }
      } catch (error) {
        console.error('[Socket] send-message error:', error);
        io.to(socket.id).emit('ai-error', { error: '消息发送失败' });
      }
    });

    // 断开连接
    socket.on('disconnect', async () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      const { classroomId, studentId, isTeacher } = socket.data;
      const connKey = classroomId && studentId ? `${classroomId}:${studentId}` : null;

      // 清理活跃连接记录
      if (connKey && activeConnections.get(connKey) === socket.id) {
        activeConnections.delete(connKey);
      }

      if (classroomId && studentId && !isTeacher) {
        // 更新学生离线状态
        await prisma.classroomStudent.updateMany({
          where: { classroomId, studentId },
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
