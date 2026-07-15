import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { createStudentToken } from '../middleware/student-auth.js';
import { hasTeacherSession } from '../middleware/auth.js';
import { ALLOWED_SOURCE_STATUSES } from '../services/classroom-state.js';
import { compareStudentNumbers } from '../services/student-sort.js';
import { abortClassroomStreams } from '../socket/index.js';

const router: Router = Router();

const PUBLIC_CODE_WINDOW_MS = 60_000;
const PUBLIC_CODE_MAX_REQUESTS = 120;
const publicCodeRequests = new Map<string, number[]>();

/**
 * 互动码保留四位以兼顾课堂输入效率；对公开查询加温和限流，降低局域网内批量枚举的风险。
 * 每位学生正常进入和断线恢复只会产生极少量请求，不会增加其操作步骤。
 */
function limitPublicCodeRequests(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  const now = Date.now();
  const client = req.socket.remoteAddress || 'unknown';
  const recent = (publicCodeRequests.get(client) || []).filter(timestamp => timestamp > now - PUBLIC_CODE_WINDOW_MS);
  if (recent.length >= PUBLIC_CODE_MAX_REQUESTS) {
    res.status(429).json({ error: '查询过于频繁，请稍后再试' });
    return;
  }
  recent.push(now);
  publicCodeRequests.set(client, recent);
  if (publicCodeRequests.size > 2_000) {
    for (const [key, timestamps] of publicCodeRequests) {
      if (timestamps.every(timestamp => timestamp <= now - PUBLIC_CODE_WINDOW_MS)) publicCodeRequests.delete(key);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.use('/code', limitPublicCodeRequests);

function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 学生选择身份后静默领取课堂临时令牌，不增加前端操作步骤。
router.post('/code/:code/student-session', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const participantId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
    const classroom = await prisma.classroom.findUnique({ where: { code: req.params.code } });
    if (!classroom || classroom.status === 'ended') return res.status(404).json({ error: '课堂不存在或已结束' });
    const member = await prisma.classroomStudent.findFirst({
      where: { classroomId: classroom.id, id: participantId },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: '该参与者不属于当前课堂' });
    res.json({ token: createStudentToken(classroom.id, member.id), expiresIn: 7200 });
  } catch {
    res.status(500).json({ error: '创建学生会话失败' });
  }
});

/** 生成不重复的 4 位互动码，只检查活跃/暂停中的课堂（已结束的码可回收） */
async function generateUniqueClassroomCode(prisma: PrismaClient | Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const existing = await prisma.classroom.findFirst({
      where: { code, status: { in: ['active', 'paused'] } },
    });
    if (!existing) return code;
  }
  // 保底：遍历所有活跃课堂的码，找出未用的
  const used = await prisma.classroom.findMany({
    where: { status: { in: ['active', 'paused'] } },
    select: { code: true },
  });
  const usedSet = new Set(used.filter((c: { code: string | null }) => c.code).map((c: { code: string | null }) => c.code));
  for (let n = 1000; n <= 9999; n++) {
    const code = n.toString();
    if (!usedSet.has(code)) return code;
  }
  throw new Error('无可用的互动码');
}

// 创建课堂（标准模式）
router.post('/create', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, classIds, agentIds, mode = 'standard' } = req.body;

    if (!classIds?.length || !agentIds?.length) {
      return res.status(400).json({ error: '请选择班级和智能体' });
    }
    if (!['standard', 'group'].includes(mode)) return res.status(400).json({ error: '课堂模式无效' });
    const uniqueClassIds: string[] = Array.from(new Set<string>((classIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)));
    const uniqueAgentIds: string[] = Array.from(new Set<string>((agentIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)));
    if (uniqueClassIds.length === 0 || uniqueAgentIds.length === 0) return res.status(400).json({ error: '班级或智能体无效' });
    if (mode === 'group' && uniqueClassIds.length !== 1) return res.status(400).json({ error: '分组模式一次只能选择一个班级' });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const code = await generateUniqueClassroomCode(tx);
      const created = await tx.classroom.create({
      data: {
        code,
        title: title || null,
        mode,
        classes: {
          create: uniqueClassIds.map(classId => ({ classId })),
        },
        classroomAgents: {
          create: uniqueAgentIds.map(agentId => ({ agentId })),
        },
      },
      include: {
        classes: { include: { class: { include: { students: true } } } },
        classroomAgents: { include: { agent: true } },
      },
      });

      if (mode === 'group') {
      // 分组模式：小组本身就是课堂参与者，不再创建虚拟 Student。
      const classGroups = await tx.classGroup.findMany({
        where: { classId: uniqueClassIds[0] },
      });
      for (const classGroup of classGroups) {
        const classroomGroup = await tx.classroomGroup.create({
          data: {
            classroomId: created.id,
            name: classGroup.name,
            agentId: uniqueAgentIds[0],
            sourceClassGroupId: classGroup.id,
          },
        });
        let memberIds: string[] = [];
        try { memberIds = JSON.parse(classGroup.studentIds || '[]'); } catch {}
        const members = memberIds.length > 0 ? await tx.student.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, name: true, studentNo: true },
        }) : [];
        if (members.length > 0) {
          await tx.classroomGroupMember.createMany({ data: members.map(member => ({
            classroomId: created.id, groupId: classroomGroup.id,
            studentId: member.id, name: member.name, studentNo: member.studentNo,
          })) });
        }
        const participant = await tx.classroomStudent.create({
          data: {
            classroomId: created.id,
            type: 'group',
            groupId: classroomGroup.id,
          },
        });
        await tx.interaction.create({
          data: {
            classroomId: created.id,
            studentId: participant.id,
          },
        });
      }
    } else {
      // 标准模式：真实学生是课堂参与者。
      const allStudents = created.classes.flatMap((cc) => cc.class.students);
      for (const student of allStudents) {
        const participant = await tx.classroomStudent.create({ data: {
          classroomId: created.id, type: 'student', studentId: student.id,
        } });
        await tx.interaction.create({ data: { classroomId: created.id, studentId: participant.id } });
      }
      }
      return created;
    });

    res.json(classroom);
  } catch (error) {
    console.error('Create classroom error:', error);
    res.status(500).json({ error: '创建课堂失败' });
  }
});

// 创建课堂（高级模式 — 分组）
router.post('/create-advanced', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, classId, groups } = req.body;

    if (!classId || !groups?.length) {
      return res.status(400).json({ error: '请选择班级和分组' });
    }
    if (!Array.isArray(groups) || groups.length > 100) return res.status(400).json({ error: '分组数量无效' });
    const normalizedGroups = groups.map((group: unknown) => {
      const input = typeof group === 'object' && group !== null ? group as Record<string, unknown> : {};
      return {
        name: typeof input.name === 'string' ? input.name.trim() : '',
        agentId: typeof input.agentId === 'string' ? input.agentId : '',
      };
    });
    if (normalizedGroups.some(group => !group.name || !group.agentId)) return res.status(400).json({ error: '分组名称和智能体不能为空' });
    if (new Set(normalizedGroups.map(group => group.name)).size !== normalizedGroups.length) return res.status(400).json({ error: '分组名称不能重复' });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.classroom.create({
        data: {
        code: await generateUniqueClassroomCode(tx),
        title: title || null,
        mode: 'advanced',
          classes: { create: { classId } },
        },
      });

    const sourceGroups = await tx.classGroup.findMany({ where: { classId } });
    // Create group participants and freeze the roster at classroom creation.
    for (const group of normalizedGroups) {
      const sourceGroup = sourceGroups.find(item => item.name === group.name);
      const classroomGroup = await tx.classroomGroup.create({
        data: {
          classroomId: created.id,
          name: group.name,
          agentId: group.agentId,
          sourceClassGroupId: sourceGroup?.id,
        },
      });
      let memberIds: string[] = [];
      try { memberIds = JSON.parse(sourceGroup?.studentIds || '[]'); } catch {}
      const members = memberIds.length > 0 ? await tx.student.findMany({
        where: { id: { in: memberIds } }, select: { id: true, name: true, studentNo: true },
      }) : [];
      if (members.length > 0) await tx.classroomGroupMember.createMany({ data: members.map(member => ({
        classroomId: created.id, groupId: classroomGroup.id,
        studentId: member.id, name: member.name, studentNo: member.studentNo,
      })) });
      const participant = await tx.classroomStudent.create({ data: {
        classroomId: created.id, type: 'group', groupId: classroomGroup.id,
      } });
      await tx.interaction.create({ data: { classroomId: created.id, studentId: participant.id } });
    }

    // Create classroomAgent records from unique group agentIds
    const uniqueAgentIds = [...new Set(normalizedGroups.map(group => group.agentId))];
    for (const agentId of uniqueAgentIds as string[]) {
      await tx.classroomAgent.create({ data: { classroomId: created.id, agentId } });
    }

      return tx.classroom.findUnique({
      where: { id: created.id },
      include: {
        groups: true,
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: { include: { students: true } } } },
      },
      });
    });

    res.json(classroom);
  } catch (error) {
    console.error('Create advanced classroom error:', error);
    res.status(500).json({ error: '创建高级课堂失败' });
  }
});

// 获取所有课堂（含全部关联数据，仪表盘用）
router.get('/all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      include: {
        _count: { select: { students: true, interactions: true } },
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: true } },
        groups: { include: { agent: true, members: { select: { id: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classrooms.map(classroom => ({
      ...classroom,
      participantCount: classroom._count.students,
      realStudentCount: classroom.mode === 'group' || classroom.mode === 'advanced'
        ? classroom.groups.reduce((count, group) => count + group.members.length, 0)
        : classroom._count.students,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取所有课堂失败' });
  }
});

// 获取活跃课堂（含暂停的课堂）
router.get('/active', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      where: { status: { in: ['active', 'paused'] } },
      include: {
        _count: { select: { students: true } },
        students: { select: { studentId: true, totalRounds: true } },
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: true } },
        groups: { include: { agent: true, members: { select: { id: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classrooms.map(classroom => ({
      ...classroom,
      participantCount: classroom._count.students,
      realStudentCount: classroom.mode === 'group' || classroom.mode === 'advanced'
        ? classroom.groups.reduce((count, group) => count + group.members.length, 0)
        : classroom._count.students,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取活跃课堂失败' });
  }
});

// 将仍在进行中的分组课堂更新为当前班级分组。课堂结束后继续保留创建时的快照，
// 避免后续改组改写历史记录；已经产生对话的小组也不会因班级端删除而被静默移除。
router.post('/:id/sync-groups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const classroom = await tx.classroom.findUnique({
        where: { id: req.params.id },
        include: {
          classes: { select: { classId: true } },
          groups: { select: { id: true, name: true, agentId: true, sourceClassGroupId: true } },
          classroomAgents: { select: { agentId: true } },
        },
      });
      if (!classroom) throw new Error('CLASSROOM_NOT_FOUND');
      if (!['group', 'advanced'].includes(classroom.mode)) throw new Error('NOT_GROUP_CLASSROOM');
      if (!['active', 'paused'].includes(classroom.status)) throw new Error('CLASSROOM_ENDED');
      if (classroom.classes.length !== 1) throw new Error('INVALID_CLASSROOM_CLASS');

      const classId = classroom.classes[0].classId;
      const sourceGroups = await tx.classGroup.findMany({ where: { classId }, orderBy: { createdAt: 'asc' } });
      const fallbackAgentId = classroom.classroomAgents[0]?.agentId;
      if (!fallbackAgentId) throw new Error('MISSING_AGENT');

      let addedGroups = 0;
      let updatedGroups = 0;
      // 仅用名称补齐历史数据中没有 sourceClassGroupId 的旧课堂；之后会写回稳定关联。
      const claimedLegacyGroupIds = new Set<string>();
      for (const sourceGroup of sourceGroups) {
        let classroomGroup = classroom.groups.find(group => group.sourceClassGroupId === sourceGroup.id);
        if (!classroomGroup) {
          classroomGroup = classroom.groups.find(group =>
            !group.sourceClassGroupId && !claimedLegacyGroupIds.has(group.id) && group.name === sourceGroup.name,
          );
          if (classroomGroup) claimedLegacyGroupIds.add(classroomGroup.id);
        }

        if (!classroomGroup) {
          classroomGroup = await tx.classroomGroup.create({
            data: {
              classroomId: classroom.id,
              name: sourceGroup.name,
              agentId: fallbackAgentId,
              sourceClassGroupId: sourceGroup.id,
            },
          });
          const participant = await tx.classroomStudent.create({
            data: { classroomId: classroom.id, type: 'group', groupId: classroomGroup.id },
          });
          await tx.interaction.create({ data: { classroomId: classroom.id, studentId: participant.id } });
          addedGroups++;
        } else {
          await tx.classroomGroup.update({
            where: { id: classroomGroup.id },
            data: { name: sourceGroup.name, sourceClassGroupId: sourceGroup.id },
          });
          updatedGroups++;
        }

        let memberIds: string[] = [];
        try {
          const parsed: unknown = JSON.parse(sourceGroup.studentIds || '[]');
          memberIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
        } catch { /* Treat malformed legacy data as an empty group. */ }
        const members = memberIds.length === 0 ? [] : await tx.student.findMany({
          where: { id: { in: memberIds }, classId },
          select: { id: true, name: true, studentNo: true },
        });
        await tx.classroomGroupMember.deleteMany({ where: { groupId: classroomGroup.id } });
        if (members.length) {
          await tx.classroomGroupMember.createMany({
            data: members.map(member => ({
              classroomId: classroom.id,
              groupId: classroomGroup!.id,
              studentId: member.id,
              name: member.name,
              studentNo: member.studentNo,
            })),
          });
        }
      }

      return { addedGroups, updatedGroups, sourceGroupCount: sourceGroups.length };
    });

    const io = req.app.get('io');
    io?.to(`teacher:${req.params.id}`).emit('classroom-groups-synced', result);
    res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'CLASSROOM_NOT_FOUND') return res.status(404).json({ error: '课堂不存在' });
    if (message === 'NOT_GROUP_CLASSROOM') return res.status(400).json({ error: '只有分组课堂可以同步分组' });
    if (message === 'CLASSROOM_ENDED') return res.status(409).json({ error: '已结束课堂保留原有分组快照，不能同步' });
    if (message === 'MISSING_AGENT') return res.status(400).json({ error: '课堂未配置可用智能体' });
    if (message === 'INVALID_CLASSROOM_CLASS') return res.status(400).json({ error: '该课堂无法确定所属班级' });
    console.error('[Classroom] sync groups error:', error);
    res.status(500).json({ error: '同步分组失败' });
  }
});

// 获取课堂详情（含学生列表和消息）
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      include: {
        classes: { include: { class: true } },
        classroomAgents: { include: { agent: true } },
        groups: { include: { agent: true, members: { orderBy: { studentNo: 'asc' } } } },
        students: {
          include: {
            student: true,
            group: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          orderBy: { joinTime: 'asc' },
        },
      },
    });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    // 小组成员来自课堂创建时的快照，不再按当前班级组名动态匹配。
    const groupMembersMap: Record<string, { groupName: string; members: { id: string; name: string; studentNo: string | null }[] }> = {};
    for (const group of classroom.groups) {
      const snapshot = {
        groupName: group.name,
        members: group.members.map(member => ({ id: member.studentId || member.id, name: member.name, studentNo: member.studentNo })),
      };
      groupMembersMap[group.id] = snapshot;
    }

    const students = classroom.students.map(cs => ({
      ...cs,
      participantType: cs.type,
      participantId: cs.id,
      // 旧教师看板仍读取 student 字段；小组在此处只提供展示 DTO，并非数据库 Student。
      student: cs.student || {
        id: cs.id, classId: '', name: cs.group?.name || '未命名小组', studentNo: null,
        gender: null, tag: null, avatarId: null, avatarChangeTokens: 0,
      },
    }));
    res.json({ ...classroom, students, groupMembersMap });
  } catch (error) {
    res.status(500).json({ error: '获取课堂详情失败' });
  }
});

// 获取学生的完整对话记录
router.get('/:id/student/:studentId/messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomStudent = await prisma.classroomStudent.findFirst({
      where: {
        classroomId: req.params.id,
        id: req.params.studentId,
      },
    });
    if (!classroomStudent) return res.status(404).json({ error: '未找到该学生' });

    const messages = await prisma.message.findMany({
      where: { studentId: classroomStudent.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    messages.reverse(); // 反转回正序，前端按时间顺序展示
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
  }
});

// 获取课堂全部消息（教师分析用）
router.get('/:id/all-messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(500, Math.max(50, Number.parseInt(String(req.query.limit || '500'), 10) || 500));
    // Message 已有 classroomId + createdAt 联合索引，直接按课堂读取可避免大班级时先查学生、再构造超长 IN 条件。
    const messages = await prisma.message.findMany({
      where: { classroomId: req.params.id },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        classroomStudent: { include: { student: true, group: true } },
      },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
  }
});

router.get('/:id/message-stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const [total, userMessages, assistantMessages, participants] = await Promise.all([
      prisma.message.count({ where: { classroomId: req.params.id } }),
      prisma.message.count({ where: { classroomId: req.params.id, role: 'user' } }),
      prisma.message.count({ where: { classroomId: req.params.id, role: 'assistant' } }),
      prisma.message.findMany({ where: { classroomId: req.params.id }, distinct: ['studentId'], select: { studentId: true } }),
    ]);
    res.json({ total, userMessages, assistantMessages, participantCount: participants.length });
  } catch {
    res.status(500).json({ error: '获取消息统计失败' });
  }
});

// 根据互动码获取课堂信息（学生端用）
router.get('/code/:code', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { code: req.params.code },
      include: {
        classroomAgents: { include: { agent: true } },
        groups: { include: { agent: true } },
      },
    });
    if (!classroom) return res.status(404).json({ error: '互动码无效' });
    if (classroom.status === 'ended') return res.status(400).json({ error: '课堂已结束' });

    res.json({
      id: classroom.id,
      code: classroom.code,
      title: classroom.title,
      mode: classroom.mode,
      status: classroom.status,
      allowStudentStop: classroom.allowStudentStop,
      allowStudentExport: classroom.allowStudentExport,
      agents: classroom.classroomAgents.map((ca) => ({
        id: ca.agent.id,
        name: ca.agent.name,
        logo: ca.agent.logo,
        platform: ca.agent.platform,
        enabled: ca.agent.enabled,
        greeting: ca.agent.greeting,
      })),
      groups: (classroom.mode === 'advanced' || classroom.mode === 'group')
        ? classroom.groups.map(group => ({
            id: group.id,
            name: group.name,
            agentId: group.agentId,
            agent: {
              id: group.agent.id,
              name: group.agent.name,
              logo: group.agent.logo,
              platform: group.agent.platform,
              enabled: group.agent.enabled,
              greeting: group.agent.greeting,
            },
          }))
        : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: '查询课堂失败' });
  }
});

// 获取课堂的学生列表（学生端选择身份用）
// 身份选择前必须公开名单；沿用课堂码入口的温和限流，避免被持续轮询。
router.get('/:id/students', limitPublicCodeRequests, async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { mode: true, status: true },
    });
    if (!classroom || classroom.status === 'ended') {
      return res.status(404).json({ error: '课堂不存在或已结束' });
    }
    const students = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.id },
      include: { student: true, group: true },
    });
    const filtered = students;
    if (classroom.mode === 'standard') {
      filtered.sort((left, right) => compareStudentNumbers(
        left.student?.studentNo,
        right.student?.studentNo,
        left.student?.name || '',
        right.student?.name || '',
      ));
    }
    const isTeacher = hasTeacherSession(req);
    res.json(filtered.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true; group: true } }>) => ({
      // id 始终是稳定的课堂参与者 ID；标准模式另外保留真实 studentId。
      id: cs.id,
      participantType: cs.type,
      studentId: cs.studentId,
      name: cs.type === 'group' ? (cs.group?.name || '未命名小组') : (cs.student?.name || '未知学生'),
      // 学生端只需姓名和头像完成极简身份选择；学号、性别仅提供给教师端。
      studentNo: isTeacher ? (cs.student?.studentNo || null) : null,
      gender: isTeacher ? (cs.student?.gender || null) : null,
      avatarId: cs.student?.avatarId || null,
      groupId: cs.groupId,
      groupName: classroom?.mode === 'standard' ? undefined : cs.group?.name,
      status: cs.status,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 教师奖励真实学生头像更换权限（参数为课堂参与者 ID；小组参与者不支持此操作）。
router.post('/:id/student/:studentId/reward-avatar', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const participantId = req.params.studentId;
    const membership = await prisma.classroomStudent.findFirst({
      where: { classroomId: req.params.id, id: participantId },
      include: { classroom: { select: { status: true } } },
    });
    if (!membership) return res.status(404).json({ error: '该学生不属于当前课堂' });
    if (!membership.studentId) return res.status(400).json({ error: '小组参与者不支持更换头像奖励' });
    if (membership.classroom.status === 'ended') return res.status(409).json({ error: '课堂已结束，不能继续奖励' });
    const updated = await prisma.student.update({
      where: { id: membership.studentId },
      data: { avatarChangeTokens: { increment: 1 } },
    });
    // 实时通知学生端
    if (io) {
      io.to(`student:${membership.studentId}`).emit('avatar-rewarded', { tokens: updated.avatarChangeTokens });
    }
    res.json({ success: true, tokens: updated.avatarChangeTokens });
  } catch (error) {
    console.error('[reward-avatar] Error:', error);
    res.status(500).json({ error: '奖励失败' });
  }
});

// 结束课堂
router.post('/:id/end', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.classroom.updateMany({
        where: { id: req.params.id, status: { in: [...ALLOWED_SOURCE_STATUSES.end] } },
        data: { status: 'ended', endedAt: new Date(), code: null },
      });
      if (changed.count !== 1) throw new Error('INVALID_CLASSROOM_STATE');
      return tx.classroom.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    // 通知所有连接的学生和教师
    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections') as Map<string, string> | undefined;
    const activeStreams = req.app.get('activeStreams') as Map<string, AbortController> | undefined;
    if (activeConnections && activeStreams) abortClassroomStreams(classroom.id, activeConnections, activeStreams);
    io.to(`classroom:${classroom.id}`).emit('classroom-ended');
    io.to(`teacher:${classroom.id}`).emit('classroom-ended');

    res.json(classroom);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CLASSROOM_STATE') {
      return res.status(409).json({ error: '只有进行中或已暂停的课堂可以结束' });
    }
    res.status(500).json({ error: '结束课堂失败' });
  }
});

// 更新课堂设置
router.put('/:id/settings', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title } = req.body;

    await prisma.classroom.update({
      where: { id: req.params.id },
      data: { title: title || null },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update classroom settings error:', error);
    res.status(500).json({ error: '更新课堂设置失败' });
  }
});

// 暂停课堂
router.post('/:id/pause', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const changed = await prisma.classroom.updateMany({ where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.pause[0] }, data: { status: 'paused' } });
    if (changed.count !== 1) return res.status(409).json({ error: '只有进行中的课堂可以暂停' });
    const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: req.params.id } });

    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections') as Map<string, string> | undefined;
    const activeStreams = req.app.get('activeStreams') as Map<string, AbortController> | undefined;
    if (activeConnections && activeStreams) abortClassroomStreams(classroom.id, activeConnections, activeStreams);
    io.to(`classroom:${classroom.id}`).emit('classroom-paused');
    io.to(`teacher:${classroom.id}`).emit('classroom-paused');

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] pause error:', error);
    res.status(500).json({ error: '暂停课堂失败' });
  }
});

// 恢复课堂
router.post('/:id/resume', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const changed = await prisma.classroom.updateMany({ where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.resume[0] }, data: { status: 'active' } });
    if (changed.count !== 1) return res.status(409).json({ error: '只有已暂停的课堂可以继续' });
    const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: req.params.id } });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('classroom-resumed');
    io.to(`teacher:${classroom.id}`).emit('classroom-resumed');

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] resume error:', error);
    res.status(500).json({ error: '恢复课堂失败' });
  }
});

// 恢复已结束的课堂（重新生成互动码）
router.post('/:id/restore', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    // 1. 校验课堂状态
    const existing = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, mode: true },
    });
    if (!existing) return res.status(404).json({ error: '课堂不存在' });
    if (existing.status !== 'ended') return res.status(400).json({ error: '只能恢复已结束的课堂' });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newCode = await generateUniqueClassroomCode(tx);
      const changed = await tx.classroom.updateMany({
        where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.restore[0] },
        data: { status: 'active', code: newCode, endedAt: null },
      });
      if (changed.count !== 1) throw new Error('INVALID_CLASSROOM_STATE');
      return tx.classroom.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    // 通知教师端（学生端不通知，学生需重新用新码加入）
    const io = req.app.get('io');
    if (io) {
      io.to(`teacher:${classroom.id}`).emit('classroom-restored', { classroom });
    }

    res.json(classroom);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CLASSROOM_STATE') {
      return res.status(409).json({ error: '该课堂已被恢复，请刷新页面' });
    }
    console.error('[Classroom] restore error:', error);
    res.status(500).json({ error: '恢复课堂失败' });
  }
});

// 切换是否允许学生中断 AI 回答
router.post('/:id/toggle-allow-stop', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowStudentStop: !classroom.allowStudentStop },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('allow-stop-changed', { allow: updated.allowStudentStop });
    io.to(`teacher:${classroom.id}`).emit('allow-stop-changed', { allow: updated.allowStudentStop });

    res.json({ allowStudentStop: updated.allowStudentStop });
  } catch (error) {
    console.error('[Classroom] toggle allow-stop error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

// 切换是否允许学生导出（复制/Word）
router.post('/:id/toggle-allow-export', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowStudentExport: !classroom.allowStudentExport },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('allow-export-changed', { allow: updated.allowStudentExport });
    io.to(`teacher:${classroom.id}`).emit('allow-export-changed', { allow: updated.allowStudentExport });

    res.json({ allowStudentExport: updated.allowStudentExport });
  } catch (error) {
    console.error('[Classroom] toggle allow-export error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

// 切换是否允许追问建议
router.post('/:id/toggle-allow-follow-ups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowFollowUps: !classroom.allowFollowUps },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('follow-ups-changed', { allow: updated.allowFollowUps });
    io.to(`teacher:${classroom.id}`).emit('follow-ups-changed', { allow: updated.allowFollowUps });

    res.json({ allowFollowUps: updated.allowFollowUps });
  } catch (error) {
    console.error('[Classroom] toggle allow-follow-ups error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

// 清除学生的对话记录（重置为新会话）
router.delete('/:id/student/:studentId/messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomStudent = await prisma.classroomStudent.findFirst({
      where: {
        classroomId: req.params.id,
        id: req.params.studentId,
      },
    });
    if (!classroomStudent) return res.status(404).json({ error: '未找到该学生' });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.message.deleteMany({ where: { studentId: classroomStudent.id } });
      await tx.interaction.upsert({
      where: {
        classroomId_studentId: {
          classroomId: req.params.id,
          studentId: classroomStudent.id,
        },
      },
      update: { totalRounds: 0, firstMsgLen: null },
      create: { classroomId: req.params.id, studentId: classroomStudent.id },
      });
      await tx.classroomStudent.update({
      where: { id: classroomStudent.id },
      data: { totalRounds: 0 },
      });
    });

    // 通知该学生端清空对话
    const io = req.app.get('io');
    io.to(`classroom:${req.params.id}`).emit('messages-cleared', {
      studentId: req.params.studentId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Clear messages error:', error);
    res.status(500).json({ error: '清除记录失败' });
  }
});

// 获取历史课堂列表
router.get('/history/all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      where: { status: 'ended' },
      include: {
        _count: { select: { students: true, interactions: true } },
        classes: { include: { class: true } },
        groups: { include: { members: { select: { id: true } } } },
      },
      orderBy: { endedAt: 'desc' },
      take: 50,
    });

    // 批量查询每个课堂的参与学生数和消息总字数
    const ids = classrooms.map(c => c.id);
    type MsgStat = { classroomId: string; participantCount: number; totalChars: number; totalRounds: number };
    let statsMap = new Map<string, MsgStat>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const raw = await prisma.$queryRawUnsafe<MsgStat[]>(
        `SELECT "classroomId", COUNT(DISTINCT "studentId") AS "participantCount", SUM(LENGTH("content")) AS "totalChars", SUM(CASE WHEN "role" = 'user' THEN 1 ELSE 0 END) AS "totalRounds" FROM "Message" WHERE "classroomId" IN (${placeholders}) GROUP BY "classroomId"`,
        ...ids,
      );
      statsMap = new Map(raw.map(r => [r.classroomId, r]));
    }

    const result = classrooms.map(c => ({
      ...c,
      participantCount: Number(statsMap.get(c.id)?.participantCount ?? 0),
      realStudentCount: c.mode === 'group' || c.mode === 'advanced'
        ? c.groups.reduce((count, group) => count + group.members.length, 0)
        : c._count.students,
      totalRounds: Number(statsMap.get(c.id)?.totalRounds ?? 0),
      totalChars: Number(statsMap.get(c.id)?.totalChars ?? 0),
    }));

    res.json(result);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

  // 获取课堂当前在线学生 ID 列表（从 socket 活跃连接 Map 中读取）
  router.get("/:id/online", (req, res) => {
    try {
      const activeConnections = req.app.get("activeConnections") as Map<string, string> | undefined;
      if (!activeConnections) return res.json({ studentIds: [] });
      const classroomId = req.params.id;
      const studentIds: string[] = [];
      for (const key of activeConnections.keys()) {
        const [cid, sid] = key.split(":");
        if (cid === classroomId) studentIds.push(sid);
      }
      res.json({ studentIds });
    } catch (error) {
      res.status(500).json({ error: "获取在线状态失败" });
    }
  });

// 获取教师通知（学生端页面加载 / 重连时调用）
router.get('/:id/notifications', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentId } = req.query;
    const notifications = await prisma.teacherNotification.findMany({
      where: {
        classroomId: req.params.id,
        ...(typeof studentId === 'string' ? {
          OR: [
            { studentId: null },
            { studentId },
          ],
        } : {}),
      },
      // 重连只需恢复最近通知；限制读取量避免长期课堂的通知记录拖慢学生端恢复。
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(notifications.reverse());
  } catch (error) {
    console.error('[Notifications] get error:', error);
    res.status(500).json({ error: '获取教师通知失败' });
  }
});

export default router;
