import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const upload = multer({
  dest: process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'temp')
    : path.join(__dirname, '../../uploads/temp'),
});
const uploadsTempDir = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'temp')
  : path.join(__dirname, '../../uploads/temp');
fs.mkdirSync(uploadsTempDir, { recursive: true });

// === 班级管理 ===

// 获取所有班级
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classes = await prisma.class.findMany({
      include: { _count: { select: { students: true, groups: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: '获取班级列表失败' });
  }
});

// 创建班级
router.post('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '班级名称不能为空' });
    const cls = await prisma.class.create({ data: { name } });
    res.json(cls);
  } catch (error) {
    res.status(500).json({ error: '创建班级失败' });
  }
});

// 重命名班级
router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '班级名称不能为空' });
    const cls = await prisma.class.update({
      where: { id: req.params.id },
      data: { name },
    });
    res.json(cls);
  } catch (error) {
    res.status(500).json({ error: '重命名失败' });
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
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 添加学生
router.post('/:classId/students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name } = req.body;
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

    const student = await prisma.student.create({
      data: {
        classId: req.params.classId,
        name,
        studentNo: String(maxNo + 1),
      },
    });
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: '添加学生失败' });
  }
});

// 批量导入学生（Excel / JSON）
router.post('/:classId/students/batch', upload.single('file'), async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    let students: { name: string; studentNo?: string; tag?: string }[] = [];

    if (req.file) {
      // Parse JSON or CSV file
      const content = fs.readFileSync(req.file.path, 'utf-8');
      try {
        students = JSON.parse(content);
      } catch {
        // Try CSV format: studentNo,name
        const lines = content.trim().split('\n').filter(Boolean);
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        students = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim());
          const student: any = {};
          headers.forEach((h, i) => {
            if (h === 'name') student.name = vals[i];
            if (h === 'studentno' || h === '学号' || h === 'number') student.studentNo = vals[i];
            if (h === 'tag' || h === '标签' || h === 'group') student.tag = vals[i];
          });
          return student;
        }).filter(s => s.name);
      }
      fs.unlinkSync(req.file.path);
    } else if (req.body.students) {
      students = JSON.parse(req.body.students);
    }

    if (students.length === 0) {
      return res.status(400).json({ error: '没有有效的学生数据' });
    }

    const created = await prisma.student.createMany({
      data: students.map(s => ({
        classId: req.params.classId,
        name: s.name,
        studentNo: s.studentNo || null,
        tag: s.tag || null,
      })),
    });

    res.json({ count: created.count, students });
  } catch (error) {
    res.status(500).json({ error: '批量导入失败' });
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

    // 获取当前班级最大学号，从下一个开始
    const all = await prisma.student.findMany({
      where: { classId: req.params.classId },
      select: { studentNo: true },
    });
    let maxNo = 0;
    for (const s of all) {
      const n = parseInt(s.studentNo || '0', 10);
      if (n > maxNo) maxNo = n;
    }

    const students = names.map((name: string, i: number) => ({
      classId: req.params.classId,
      name: name.trim(),
      studentNo: String(maxNo + i + 1),
    }));

    const created = await prisma.student.createMany({ data: students });
    res.json({ count: created.count, students });
  } catch (error) {
    res.status(500).json({ error: '批量创建学生失败' });
  }
});

// 更新学生
router.put('/:classId/students/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, studentNo, tag } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (studentNo !== undefined) data.studentNo = studentNo;
    if (tag !== undefined) data.tag = tag;
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

// 导出 Excel 模板
router.get('/template', (_req, res) => {
  const csvContent = 'studentNo,name\n1,张三\n2,李四\n3,王五';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=student-template.csv');
  res.send(csvContent);
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
    res.json(groups.map((g: Prisma.ClassGroupGetPayload<{}>) => ({ ...g, studentIds: JSON.parse(g.studentIds) })));
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
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(400).json({ error: '分组名称已存在' });
    res.status(500).json({ error: '创建分组失败' });
  }
});

// 更新分组（名称、学生列表）
router.put('/:classId/groups/:groupId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { name, studentIds } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (studentIds !== undefined) data.studentIds = JSON.stringify(studentIds);
    const group = await prisma.classGroup.update({
      where: { id: req.params.groupId },
      data,
    });
    res.json({ ...group, studentIds: JSON.parse(group.studentIds) });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(400).json({ error: '分组名称已存在' });
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
