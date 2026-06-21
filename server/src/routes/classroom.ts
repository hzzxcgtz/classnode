import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const router: Router = Router();

function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/** 生成不重复的 4 位互动码，只检查活跃/暂停中的课堂（已结束的码可回收） */
async function generateUniqueClassroomCode(prisma: PrismaClient): Promise<string> {
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

/** 生成不重复的 4 位小组互动码 */
async function generateUniqueGroupCode(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const existing = await prisma.classroomGroup.findFirst({ where: { code } });
    if (!existing) return code;
  }
  // 保底：遍历所有小组码
  const used = await prisma.classroomGroup.findMany({ select: { code: true } });
  const usedSet = new Set(used.filter((g: { code: string | null }) => g.code).map((g: { code: string | null }) => g.code));
  for (let n = 1000; n <= 9999; n++) {
    const code = n.toString();
    if (!usedSet.has(code)) return code;
  }
  throw new Error('无可用的小组互动码');
}

// 创建课堂（标准模式）
router.post('/create', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, classIds, agentIds, mode = 'standard' } = req.body;

    if (!classIds?.length || !agentIds?.length) {
      return res.status(400).json({ error: '请选择班级和智能体' });
    }

    const code = await generateUniqueClassroomCode(prisma);

    const classroom = await prisma.classroom.create({
      data: {
        code,
        title: title || null,
        mode,
        classes: {
          create: classIds.map((classId: string) => ({ classId })),
        },
        classroomAgents: {
          create: agentIds.map((agentId: string) => ({ agentId })),
        },
      },
      include: {
        classes: { include: { class: { include: { students: true } } } },
        classroomAgents: { include: { agent: true } },
      },
    });

    if (mode === 'group') {
      // 分组模式：以小组身份登录，每个组创建一个虚拟小组学生
      const classGroups = await prisma.classGroup.findMany({
        where: { classId: classIds[0] },
      });
      for (const classGroup of classGroups) {
        // 创建虚拟小组学生
        const virtualStudent = await prisma.student.create({
          data: {
            classId: classIds[0],
            name: classGroup.name,
            tag: '__group__',
          },
        });
        // 创建课堂分组记录
        const classroomGroup = await prisma.classroomGroup.create({
          data: {
            classroomId: classroom.id,
            name: classGroup.name,
            agentId: agentIds[0],
            code: await generateUniqueGroupCode(prisma),
          },
        });
        // 创建课堂学生记录（小组级别）
        await prisma.classroomStudent.create({
          data: {
            classroomId: classroom.id,
            studentId: virtualStudent.id,
            groupId: classroomGroup.id,
          },
        });
        // 创建互动记录
        await prisma.interaction.create({
          data: {
            classroomId: classroom.id,
            studentId: virtualStudent.id,
          },
        }).catch(() => {});
      }
    } else {
      // 标准/高级模式：将班级个体学生加入课堂（批量写入）
      const allStudents = classroom.classes.flatMap((cc: any) => cc.class.students);
      if (allStudents.length > 0) {
        await prisma.classroomStudent.createMany({
          data: allStudents.map((s: any) => ({
            classroomId: classroom.id,
            studentId: s.id,
          })),
        });
        await prisma.interaction.createMany({
          data: allStudents.map((s: any) => ({
            classroomId: classroom.id,
            studentId: s.id,
          })),
        });
      }
    }

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

    const classroom = await prisma.classroom.create({
      data: {
        code: await generateUniqueClassroomCode(prisma),
        title: title || null,
        mode: 'advanced',
        classes: { create: { classId } },
      },
    });

    // Create groups and their codes
    for (const group of groups) {
      const groupCode = await generateUniqueGroupCode(prisma);
      const classroomGroup = await prisma.classroomGroup.create({
        data: {
          classroomId: classroom.id,
          name: group.name,
          agentId: group.agentId,
          code: groupCode,
        },
      });

      // 创建虚拟小组学生（用于登录），与 group 模式一致
      const virtualStudent = await prisma.student.create({
        data: {
          classId,
          name: group.name,
          tag: '__group__',
        },
      });
      await prisma.classroomStudent.create({
        data: {
          classroomId: classroom.id,
          studentId: virtualStudent.id,
          groupId: classroomGroup.id,
        },
      });
      await prisma.interaction.create({
        data: { classroomId: classroom.id, studentId: virtualStudent.id },
      }).catch(() => {});
    }

    // Create classroomAgent records from unique group agentIds
    const uniqueAgentIds = [...new Set(groups.map((g: any) => g.agentId).filter(Boolean))];
    for (const agentId of uniqueAgentIds as string[]) {
      await prisma.classroomAgent.create({
        data: { classroomId: classroom.id, agentId },
      }).catch(() => {});
    }

    const result = await prisma.classroom.findUnique({
      where: { id: classroom.id },
      include: {
        groups: true,
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: { include: { students: true } } } },
      },
    });

    res.json(result);
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
        groups: { include: { agent: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classrooms);
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
        groups: { include: { agent: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classrooms);
  } catch (error) {
    res.status(500).json({ error: '获取活跃课堂失败' });
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
        groups: { include: { agent: true } },
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

    // 解析分组/高级模式中 ClassGroup 的真实学生成员
    let groupMembersMap: Record<string, { groupName: string; members: { id: string; name: string; studentNo: string | null }[] }> = {};
    if (classroom.mode === 'advanced' || classroom.mode === 'group') {
      const classIds = classroom.classes.map((cc: any) => cc.class.id);
      const classGroups = await prisma.classGroup.findMany({
        where: { classId: { in: classIds } },
      });
      for (const cg of classGroups) {
        const ids: string[] = JSON.parse(cg.studentIds || '[]');
        if (ids.length > 0) {
          const students = await prisma.student.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, studentNo: true, gender: true },
          });
          groupMembersMap[cg.name] = {
            groupName: cg.name,
            members: students.map(s => ({ id: s.id, name: s.name, studentNo: s.studentNo })),
          };
        }
      }
    }

    res.json({ ...classroom, groupMembersMap });
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
        studentId: req.params.studentId,
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
    const classroomStudents = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.id },
      include: { student: true },
    });
    const studentIds = classroomStudents.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true } }>) => cs.id);
    const messages = await prisma.message.findMany({
      where: { studentId: { in: studentIds } },
      orderBy: { createdAt: 'asc' },
      include: {
        classroomStudent: { include: { student: true } },
      },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
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
      agents: classroom.classroomAgents.map((ca: { agent: { id: any; name: any; logo: any; platform: any; enabled: any; greeting: any } }) => ({
        id: ca.agent.id,
        name: ca.agent.name,
        logo: ca.agent.logo,
        platform: ca.agent.platform,
        enabled: ca.agent.enabled,
        greeting: ca.agent.greeting,
      })),
      groups: (classroom.mode === 'advanced' || classroom.mode === 'group') ? classroom.groups : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: '查询课堂失败' });
  }
});

// 获取课堂的学生列表（学生端选择身份用）
router.get('/:id/students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { mode: true },
    });
    const students = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.id },
      include: { student: true, group: true },
    });
    // 标准模式下过滤掉虚拟小组学生（tag 为 __group__）
    const filtered = classroom?.mode === 'standard'
      ? students.filter(cs => cs.student.tag !== '__group__')
      : students;
    res.json(filtered.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true; group: true } }>) => ({
      id: cs.student.id,
      name: cs.student.name,
      studentNo: cs.student.studentNo,
      gender: cs.student.gender,
      avatarId: cs.student.avatarId,
      groupId: cs.groupId,
      groupName: classroom?.mode === 'standard' ? undefined : cs.group?.name,
      status: cs.status,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 教师奖励学生头像更换权限（studentId 为 Student.id）
router.post('/:id/student/:studentId/reward-avatar', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const studentId = req.params.studentId;
    // 直接通过 Student.id 更新
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ error: '学生未找到' });
    const updated = await prisma.student.update({
      where: { id: studentId },
      data: { avatarChangeTokens: { increment: 1 } },
    });
    // 实时通知学生端
    if (io) {
      io.to(`student:${studentId}`).emit('avatar-rewarded', { tokens: updated.avatarChangeTokens });
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
      // 回收所有小组互动码
      await tx.classroomGroup.updateMany({
        where: { classroomId: req.params.id, code: { not: null } },
        data: { code: null },
      });
      // 回收课堂互动码
      return tx.classroom.update({
        where: { id: req.params.id },
        data: {
          status: 'ended',
          endedAt: new Date(),
          code: null,
        },
      });
    });

    // 通知所有连接的学生和教师
    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('classroom-ended');
    io.to(`teacher:${classroom.id}`).emit('classroom-ended');

    res.json(classroom);
  } catch (error) {
    res.status(500).json({ error: '结束课堂失败' });
  }
});

// 更新课堂设置
router.put('/:id/settings', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, groups, agentIds } = req.body;

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
    const classroom = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { status: 'paused' },
    });

    const io = req.app.get('io');
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
    const classroom = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { status: 'active' },
    });

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

    // 2. 生成新的互动码
    const newCode = await generateUniqueClassroomCode(prisma);

    // 3. 恢复
    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 分组/高级模式：重新生成小组互动码
      if (existing.mode === 'group' || existing.mode === 'advanced') {
        const groups = await tx.classroomGroup.findMany({
          where: { classroomId: req.params.id },
        });
        for (const group of groups) {
          const groupCode = await generateUniqueGroupCode(prisma);
          await tx.classroomGroup.update({
            where: { id: group.id },
            data: { code: groupCode },
          });
        }
      }

      return tx.classroom.update({
        where: { id: req.params.id },
        data: {
          status: 'active',
          code: newCode,
          endedAt: null,
        },
      });
    });

    // 通知教师端（学生端不通知，学生需重新用新码加入）
    const io = req.app.get('io');
    if (io) {
      io.to(`teacher:${classroom.id}`).emit('classroom-restored', { classroom });
    }

    res.json(classroom);
  } catch (error) {
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
        studentId: req.params.studentId,
      },
    });
    if (!classroomStudent) return res.status(404).json({ error: '未找到该学生' });

    // 删除所有消息
    await prisma.message.deleteMany({
      where: { studentId: classroomStudent.id },
    });

    // 重置互动统计
    await prisma.interaction.upsert({
      where: {
        classroomId_studentId: {
          classroomId: req.params.id,
          studentId: req.params.studentId,
        },
      },
      update: { totalRounds: 0, firstMsgLen: null },
      create: { classroomId: req.params.id, studentId: req.params.studentId },
    });

    // 重置学生轮数
    await prisma.classroomStudent.update({
      where: { id: classroomStudent.id },
      data: { totalRounds: 0 },
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
      },
      orderBy: { endedAt: 'desc' },
      take: 50,
    });

    // 批量查询每个课堂的参与学生数和消息总字数
    const ids = classrooms.map(c => c.id);
    type MsgStat = { classroomId: string; participantCount: number; totalChars: number };
    let statsMap = new Map<string, MsgStat>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const raw = await prisma.$queryRawUnsafe<MsgStat[]>(
        `SELECT "classroomId", COUNT(DISTINCT "studentId") AS "participantCount", SUM(LENGTH("content")) AS "totalChars" FROM "Message" WHERE "classroomId" IN (${placeholders}) GROUP BY "classroomId"`,
        ...ids,
      );
      statsMap = new Map(raw.map(r => [r.classroomId, r]));
    }

    const result = classrooms.map(c => ({
      ...c,
      participantCount: Number(statsMap.get(c.id)?.participantCount ?? 0),
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
      orderBy: { createdAt: 'asc' },
    });
    res.json(notifications);
  } catch (error) {
    console.error('[Notifications] get error:', error);
    res.status(500).json({ error: '获取教师通知失败' });
  }
});

export default router;
