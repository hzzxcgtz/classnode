import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const router: Router = Router();

// === 班级管理 ===

// 获取所有班级
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classes = await prisma.class.findMany({
      include: { _count: { select: { groups: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // 手动统计实际学生数（排除 __group__ 虚拟学生）
    // 预查所有上传图片类型的头像（非纯 SVG 的头像）
    const allAvatars = await prisma.avatar.findMany({
      select: { id: true, svgContent: true },
    });
    const uploadedAvatarIds = new Set(
      allAvatars.filter(a => a.svgContent.includes('/uploads/')).map(a => a.id)
    );

    const result = await Promise.all(classes.map(async (c) => {
      const students = await prisma.student.findMany({
        where: { classId: c.id, OR: [{ tag: null }, { tag: { not: '__group__' } }] },
        select: { gender: true, avatarId: true, avatarChangeTokens: true },
      });
      const studentCount = students.length;
      const maleCount = students.filter(s => s.gender === 'boy').length;
      const femaleCount = students.filter(s => s.gender === 'girl').length;
      const avatarAssignedCount = students.filter(s => s.avatarId !== null).length;
      const rewardedCount = students.filter(s => s.avatarChangeTokens > 0).length;
      const totalTokens = students.reduce((sum, s) => sum + s.avatarChangeTokens, 0);
      const uploadedAvatarCount = students.filter(s => s.avatarId !== null && uploadedAvatarIds.has(s.avatarId)).length;
      return { ...c, _count: { ...c._count, students: studentCount }, maleCount, femaleCount, avatarAssignedCount, rewardedCount, totalTokens, uploadedAvatarCount };
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取班级列表失败' });
  }
});

// 创建班级
router.post('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, avatarId } = req.body;
    if (!name) return res.status(400).json({ error: '班级名称不能为空' });
    const data: Prisma.ClassUncheckedCreateInput = { name };
    if (avatarId) data.avatarId = avatarId;
    const cls = await prisma.class.create({ data });
    res.json(cls);
  } catch (error) {
    res.status(500).json({ error: '创建班级失败' });
  }
});

// 更新班级
router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, avatarId } = req.body;
    const data: Prisma.ClassUncheckedUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (avatarId !== undefined) data.avatarId = avatarId;
    const cls = await prisma.class.update({
      where: { id: req.params.id },
      data,
    });
    res.json(cls);
  } catch (error) {
    res.status(500).json({ error: '更新班级失败' });
  }
});

// 检查班级是否被课堂使用
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomClasses = await prisma.classroomClass.findMany({
      where: { classId: req.params.id },
      include: { classroom: { select: { id: true, title: true, status: true } } },
    });
    res.json({
      used: classroomClasses.length > 0,
      classroomCount: classroomClasses.length,
      classrooms: classroomClasses.map((cc: Prisma.ClassroomClassGetPayload<{ include: { classroom: { select: { id: true, title: true, status: true } } } }>) => ({
        id: cc.classroom.id,
        title: cc.classroom.title || '未命名课堂',
        status: cc.classroom.status,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 删除班级
router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    // 检查是否有课堂关联此班级
    const classroomCount = await prisma.classroomClass.count({
      where: { classId: req.params.id },
    });
    if (classroomCount > 0) {
      return res.status(400).json({
        error: `该班级已关联 ${classroomCount} 个课堂，无法删除。请先删除关联的课堂后再试。`,
      });
    }

    await prisma.class.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除班级失败' });
  }
});

// === 学生管理 ===

// 获取班级学生列表
router.get('/:classId/students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const students = await prisma.student.findMany({
      where: { classId: req.params.classId },
      orderBy: { studentNo: 'asc' },
    });
    res.json(students.filter(s => s.tag !== '__group__'));
  } catch (error) {
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 添加学生
router.post('/:classId/students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, gender } = req.body;
    if (!name) return res.status(400).json({ error: '学生姓名不能为空' });

    // 自动生成学号：取当前班级最大学号 + 1
    const all = await prisma.student.findMany({
      where: { classId: req.params.classId },
      select: { studentNo: true },
    });
    let maxNo = 0;
    for (const s of all) {
      const n = parseInt(s.studentNo || '0', 10);
      if (n > maxNo) maxNo = n;
    }

    const data: Prisma.StudentUncheckedCreateInput = {
      classId: req.params.classId,
      name,
      studentNo: String(maxNo + 1),
    };
    if (gender && ['boy', 'girl'].includes(gender)) data.gender = gender;

    const student = await prisma.student.create({ data });
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: '添加学生失败' });
  }
});

// 粘贴名单批量创建学生（自动生成序号）
router.post('/:classId/students/batch-names', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { names } = req.body;
    if (!names || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: '请提供有效的学生名单' });
    }
    if (names.length > 500) return res.status(400).json({ error: '单次最多导入500名学生' });

    const normalized = names.map((item: string | { name: string; gender?: string }) => {
      const name = typeof item === 'string' ? item.trim() : (item && typeof item.name === 'string' ? item.name.trim() : '');
      const gender = item && typeof item === 'object' && item.gender && ['boy', 'girl'].includes(item.gender) ? item.gender : null;
      return { name, gender };
    });
    if (normalized.some(item => !item.name)) return res.status(400).json({ error: '学生姓名不能为空' });

    const result = await prisma.$transaction(async tx => {
      const all = await tx.student.findMany({ where: { classId: req.params.classId }, select: { studentNo: true } });
      const maxNo = all.reduce((max, s) => Math.max(max, parseInt(s.studentNo || '0', 10) || 0), 0);
      const students = normalized.map((item, i) => ({
        classId: req.params.classId, name: item.name, studentNo: String(maxNo + i + 1), gender: item.gender,
      }));
      const created = await tx.student.createMany({ data: students });
      return { created, students };
    });
    res.json({ count: result.created.count, students: result.students });
  } catch (error) {
    res.status(500).json({ error: '批量创建学生失败' });
  }
});

// 更新学生
router.put('/:classId/students/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, studentNo, gender, tag, avatarId } = req.body;
    const data: Prisma.StudentUncheckedUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (studentNo !== undefined) data.studentNo = studentNo;
    if (gender !== undefined) data.gender = gender || null;
    if (tag !== undefined) data.tag = tag;
    if (avatarId !== undefined) data.avatarId = avatarId;
    const student = await prisma.student.update({
      where: { id: req.params.studentId },
      data,
    });
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: '更新学生失败' });
  }
});

// 删除学生
router.delete('/:classId/students/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    await prisma.student.delete({ where: { id: req.params.studentId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除学生失败' });
  }
});

// === 分组管理 ===

// 获取班级的所有分组
router.get('/:classId/groups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const groups = await prisma.classGroup.findMany({
      where: { classId: req.params.classId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(groups.map((g) => ({ ...g, studentIds: JSON.parse(g.studentIds) })));
  } catch (error) {
    res.status(500).json({ error: '获取分组列表失败' });
  }
});

// 创建分组
router.post('/:classId/groups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '分组名称不能为空' });
    const group = await prisma.classGroup.create({
      data: { classId: req.params.classId, name, studentIds: '[]' },
    });
    res.json({ ...group, studentIds: [] });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(400).json({ error: '分组名称已存在' });
    }
    res.status(500).json({ error: '创建分组失败' });
  }
});

// 更新分组（名称、学生列表）
router.put('/:classId/groups/:groupId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, studentIds } = req.body;
    const data: Prisma.ClassGroupUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (studentIds !== undefined) data.studentIds = JSON.stringify(studentIds);
    const group = await prisma.classGroup.update({
      where: { id: req.params.groupId },
      data,
    });
    res.json({ ...group, studentIds: JSON.parse(group.studentIds) });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(400).json({ error: '分组名称已存在' });
    }
    res.status(500).json({ error: '更新分组失败' });
  }
});

// 删除分组
router.delete('/:classId/groups/:groupId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    await prisma.classGroup.delete({ where: { id: req.params.groupId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除分组失败' });
  }
});

export default router;
