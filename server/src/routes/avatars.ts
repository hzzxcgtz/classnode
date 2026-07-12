import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeSvg } from '../services/upload-security.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router: Router = Router();

/** 如果 SVG 是图片上传类型的，删除对应的物理文件 */
function deleteAvatarFile(svgContent: string): void {
  const match = svgContent.match(/href="(\/uploads\/avatars\/[^"]+)"/);
  if (match) {
    const filePath = path.join(__dirname, '../..', match[1]);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}

// ── 随机生成头像（程序化生成，去重）──────────────
router.post('/random-pool', async (req, res) => {
  try {
    const { category, count = 10 } = req.body;
    if (!category || (category !== 'class' && category !== 'student')) {
      return res.status(400).json({ error: '请指定头像类型 category (student/class)' });
    }
    // 获取已有头像 SVG 做去重
    const prisma: PrismaClient = req.app.get('prisma');
    const existing = await prisma.avatar.findMany({
      where: { isActive: true, category },
      select: { svgContent: true },
    });
    const existingSet = new Set(existing.map(a => a.svgContent));

    const { route } = req.body;
    const generateFn = category === 'class'
      ? () => generateRandomClassIcon(route)
      : generateRandomStudentAvatar;
    const avatars: { svgContent: string; gender: string }[] = [];
    let attempts = 0;
    const maxAttempts = count * 50;

    if (category === 'student') {
      // 学生头像：各生成 10 个
      const targetCount = count;
      [() => generateRandomStudentAvatarByGender('boy'), () => generateRandomStudentAvatarByGender('girl')].forEach(fn => {
        let added = 0;
        attempts = 0;
        while (added < targetCount && attempts < maxAttempts) {
          attempts++;
          const a = fn();
          if (!existingSet.has(a.svgContent)) {
            avatars.push(a);
            existingSet.add(a.svgContent);
            added++;
          }
        }
        while (added < targetCount) {
          avatars.push(fn());
          added++;
        }
      });
    } else {
      while (avatars.length < count && attempts < maxAttempts) {
        attempts++;
        const a = generateFn();
        if (!existingSet.has(a.svgContent)) {
          avatars.push(a);
          existingSet.add(a.svgContent);
        }
      }
      if (avatars.length < count && attempts >= maxAttempts) {
        while (avatars.length < count) avatars.push(generateFn());
      }
    }
    res.json({ avatars });
  } catch (error) {
    console.error('[random-pool] Error:', error);
    res.status(500).json({ error: '随机生成失败' });
  }
});

// 获取头像列表（仅教师端使用，排除学生上传的）
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { category } = req.query;
    const where: Prisma.AvatarWhereInput = { isActive: true, source: 'teacher' };
    if (category && (category === 'student' || category === 'class')) {
      where.category = category;
    }
    const avatars = await prisma.avatar.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(avatars);
  } catch (error) {
    res.status(500).json({ error: '获取头像列表失败' });
  }
});

// 获取所有头像（含学生上传的，供内部使用）
router.get('/all-including-student', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { category } = req.query;
    const where: Prisma.AvatarWhereInput = { isActive: true };
    if (category && (category === 'student' || category === 'class')) {
      where.category = category;
    }
    const avatars = await prisma.avatar.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(avatars);
  } catch (error) {
    res.status(500).json({ error: '获取头像列表失败' });
  }
});

// 获取所有头像（含已删除，供迁移用）
router.get('/all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { category } = req.query;
    const where: Prisma.AvatarWhereInput = {};
    if (category && (category === 'student' || category === 'class')) {
      where.category = category;
    }
    const avatars = await prisma.avatar.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(avatars);
  } catch (error) {
    res.status(500).json({ error: '获取头像列表失败' });
  }
});

// 新增头像
router.post('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { svgContent, category, gender, sortOrder } = req.body;
    const safeSvg = typeof svgContent === 'string' ? sanitizeSvg(svgContent) : null;
    if (!safeSvg) {
      return res.status(400).json({ error: 'SVG 内容不能为空' });
    }
    const validCategory = category === 'class' ? 'class' : 'student';
    const validGender = ['boy', 'girl', 'neutral'].includes(gender) ? gender : 'neutral';
    const avatar = await prisma.avatar.create({
      data: {
        svgContent: safeSvg,
        category: validCategory,
        gender: validGender,
        sortOrder: sortOrder || 0,
      },
    });
    res.json(avatar);
  } catch (error) {
    res.status(500).json({ error: '新增头像失败' });
  }
});

// 编辑头像
router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '无效的 ID' });
    const { svgContent, gender, sortOrder } = req.body;
    const data: Prisma.AvatarUpdateInput = {};
    if (svgContent !== undefined) {
      const safeSvg = typeof svgContent === 'string' ? sanitizeSvg(svgContent) : null;
      if (!safeSvg) return res.status(400).json({ error: 'SVG 包含不安全或不支持的内容' });
      data.svgContent = safeSvg;
    }
    if (gender !== undefined && ['boy', 'girl', 'neutral'].includes(gender)) data.gender = gender;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    const avatar = await prisma.avatar.update({ where: { id }, data });
    res.json(avatar);
  } catch (error) {
    res.status(500).json({ error: '更新头像失败' });
  }
});

// 删除头像（物理删除 + 删除图片文件）
router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '无效的 ID' });
    const avatar = await prisma.avatar.findUnique({ where: { id }, select: { svgContent: true } });
    await prisma.$transaction(async tx => {
      await tx.student.updateMany({ where: { avatarId: id }, data: { avatarId: null } });
      await tx.class.updateMany({ where: { avatarId: id }, data: { avatarId: null } });
      await tx.avatar.delete({ where: { id } });
    });
    // 删除物理文件
    if (avatar) deleteAvatarFile(avatar.svgContent);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除头像失败' });
  }
});

// 批量设置学生头像
router.post('/assign-students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentIds, avatarId } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: '请提供学生 ID 列表' });
    }
    if (!avatarId) {
      return res.status(400).json({ error: '请选择头像' });
    }
    await prisma.student.updateMany({
      where: { id: { in: studentIds } },
      data: { avatarId },
    });
    res.json({ success: true, count: studentIds.length });
  } catch (error) {
    res.status(500).json({ error: '批量设置头像失败' });
  }
});

// 批量清除学生头像
router.post('/clear-students', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: '请提供学生 ID 列表' });
    }
    await prisma.student.updateMany({
      where: { id: { in: studentIds } },
      data: { avatarId: null },
    });
    res.json({ success: true, count: studentIds.length });
  } catch (error) {
    res.status(500).json({ error: '批量清除头像失败' });
  }
});

// 按性别自动分配头像
router.post('/auto-assign', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentIds, classId } = req.body;

    // 先清理所有指向已删除/非活跃头像的引用
    const activeAvatarIds = (await prisma.avatar.findMany({ where: { isActive: true }, select: { id: true } })).map(a => a.id);
    if (classId) {
      await prisma.student.updateMany({
        where: { classId, avatarId: { not: null }, NOT: { avatarId: { in: activeAvatarIds } }, tag: { not: '__group__' } },
        data: { avatarId: null },
      });
    }

    let students;
    if (classId) {
      students = await prisma.student.findMany({
        where: { classId, avatarId: null, OR: [{ tag: null }, { tag: { not: '__group__' } }] },
      });
    } else if (studentIds) {
      students = await prisma.student.findMany({
        where: { id: { in: studentIds }, avatarId: null },
      });
    } else {
      return res.status(400).json({ error: '请提供 classId 或 studentIds' });
    }

    if (students.length === 0) {
      return res.json({ success: true, assigned: 0 });
    }

    // 获取可用头像
    const allAvatars = await prisma.avatar.findMany({
      where: { isActive: true, category: 'student' },
    });
    const boyAvatars = allAvatars.filter(a => a.gender === 'boy');
    const girlAvatars = allAvatars.filter(a => a.gender === 'girl');

    // 如果某种性别的头像不够，用全部头像补充
    const boyPool = boyAvatars.length > 0 ? boyAvatars : allAvatars;
    const girlPool = girlAvatars.length > 0 ? girlAvatars : allAvatars;

    let assigned = 0;
    for (const student of students) {
      // 优先使用学生已设置的性别，无则按姓名推断
      const gender = student.gender || guessGender(student.name);
      const pool = gender === 'girl' ? girlPool : boyPool;
      if (pool.length === 0) continue;
      const avatar = pool[assigned % pool.length];
      await prisma.student.update({
        where: { id: student.id },
        data: { avatarId: avatar.id },
      });
      assigned++;
    }

    res.json({ success: true, assigned });
  } catch (error) {
    res.status(500).json({ error: '自动分配头像失败' });
  }
});

// 教师奖励学生头像更换权限（无需课堂上下文，班级管理用）
router.post('/reward-student/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const { studentId } = req.params;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ error: '学生未找到' });
    const updated = await prisma.student.update({
      where: { id: studentId },
      data: { avatarChangeTokens: { increment: 1 } },
    });
    if (io) io.to(`student:${studentId}`).emit('avatar-rewarded', { tokens: updated.avatarChangeTokens });
    res.json({ success: true, tokens: updated.avatarChangeTokens });
  } catch (error) {
    res.status(500).json({ error: '奖励失败' });
  }
});

/** 基于姓名末字判断性别 */
function guessGender(name: string): 'boy' | 'girl' {
  const last = name.slice(-1);
  // 倒数第二字（双名用）
  const second = name.length > 2 ? name[name.length - 2] : '';

  const girlChars = '婷娜丽雪颖静怡瑶甜悦雅萌琳茜欣涵彤菲莹琪璇蕾诗媛珊滢芷艺妤雯嫣俐佩萤瑛萱瑶芬芬芳英萍凤燕碧翠馥慧皎洁瑾岚眉曼媚妙明珠琦琴清淑素潼婉薇熙霞香箫秀璇胭雁瑶仪玉芝贞珠竹紫妍';
  const boyChars = '强伟杰浩涛宇鹏军明超勇刚毅辉凯彬锋睿轩晨霖远帆恒龙元博嘉豪哲辰硕浩洋威荣跃飞文良志宏建国平华富裕顺通达乾坤耀辉瀚海山川毅勇冠杰斌桦楠栋梁铭钧钦鑫钧';

  if (girlChars.includes(last)) return 'girl';
  if (boyChars.includes(last)) return 'boy';
  // 末字不明确，尝试倒数第二字
  if (second && girlChars.includes(second)) return 'girl';
  if (second && boyChars.includes(second)) return 'boy';
  return 'boy';
}

// 学生自助换头像（消耗 token）
router.put('/student-self/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { avatarId, svgContent, gender } = req.body;
    const student = await prisma.student.findUnique({ where: { id: req.params.studentId } });
    if (!student) return res.status(404).json({ error: '学生未找到' });
    if (!avatarId && !svgContent) {
      return res.status(400).json({ error: '请提供 avatarId 或 svgContent' });
    }
    const safeSvg = typeof svgContent === 'string' ? sanitizeSvg(svgContent) : null;
    if (svgContent && !safeSvg) return res.status(400).json({ error: 'SVG 包含不安全或不支持的内容' });

    await prisma.$transaction(async tx => {
      let nextAvatarId = avatarId ? Number(avatarId) : null;
      if (nextAvatarId) {
        const allowed = await tx.avatar.findFirst({ where: { id: nextAvatarId, isActive: true, category: 'student' }, select: { id: true } });
        if (!allowed) throw new Error('INVALID_AVATAR');
      } else if (safeSvg) {
        const created = await tx.avatar.create({
          data: { svgContent: safeSvg, category: 'student', gender: gender || 'neutral', source: 'student' },
        });
        nextAvatarId = created.id;
      }
      const changed = await tx.student.updateMany({
        where: { id: student.id, avatarChangeTokens: { gte: 1 } },
        data: { avatarId: nextAvatarId, avatarChangeTokens: { decrement: 1 } },
      });
      if (changed.count !== 1) throw new Error('NO_AVATAR_TOKEN');
    });

    // 通知教师端实时更新头像
    try {
      const updated = await prisma.student.findUnique({
        where: { id: student.id },
        select: { avatarId: true },
      });
      let avatarSvg: string | undefined;
      if (updated?.avatarId) {
        const avatar = await prisma.avatar.findUnique({
          where: { id: updated.avatarId },
          select: { svgContent: true },
        });
        avatarSvg = avatar?.svgContent;
      }
      const io = req.app.get('io');
      if (io) {
        const activeClassrooms = await prisma.classroomStudent.findMany({
          where: { studentId: student.id },
          include: { classroom: { select: { status: true } } },
        });
        for (const cs of activeClassrooms) {
          if (cs.classroom.status === 'active' || cs.classroom.status === 'paused') {
            io.to(`teacher:${cs.classroomId}`).emit('student-avatar-changed', {
              studentId: student.id,
              avatarId: updated?.avatarId,
              svgContent: avatarSvg,
            });
          }
        }
      }
    } catch {}

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_AVATAR_TOKEN') return res.status(403).json({ error: '没有可用的更换次数' });
    if (error instanceof Error && error.message === 'INVALID_AVATAR') return res.status(400).json({ error: '所选头像不可用' });
    res.status(500).json({ error: '更换头像失败' });
  }
});

// 获取头像使用情况
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '无效的 ID' });
    const students = await prisma.student.findMany({
      where: { avatarId: id },
      select: { name: true, class: { select: { name: true } } },
    });
    const classes = await prisma.class.findMany({
      where: { avatarId: id },
      select: { name: true },
    });
    res.json({ students, classes });
  } catch (error) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 获取学生的奖励次数
router.get('/student-tokens/:studentId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: { avatarChangeTokens: true },
    });
    if (!student) return res.status(404).json({ error: '学生未找到' });
    res.json({ tokens: student.avatarChangeTokens });
  } catch (error) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 清空指定分类的所有教师头像（物理删除，已使用的学生 avatarId 会被置空）
router.post('/clear-all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { category } = req.body;
    const where: Prisma.AvatarWhereInput = { source: 'teacher' };
    if (category && (category === 'student' || category === 'class')) {
      where.category = category;
    }
    const toDelete = await prisma.avatar.findMany({ where, select: { id: true, svgContent: true } });
    const ids = toDelete.map(a => a.id);
    if (ids.length === 0) return res.json({ success: true, cleared: 0 });
    // 先清除引用，再物理删除
    await prisma.student.updateMany({ where: { avatarId: { in: ids } }, data: { avatarId: null } });
    await prisma.class.updateMany({ where: { avatarId: { in: ids } }, data: { avatarId: null } });
    await prisma.avatar.deleteMany({ where: { id: { in: ids } } });
    // 删除物理图片文件
    toDelete.forEach(a => deleteAvatarFile(a.svgContent));
    res.json({ success: true, cleared: ids.length });
  } catch (error) {
    console.error('[clear-all] Error:', error);
    res.status(500).json({ error: '清空失败' });
  }
});

// 批量删除头像（支持教师头像和学生自定义头像）
router.post('/batch-delete', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供 ID 列表' });
    }
    // 删除物理文件
    const toDelete = await prisma.avatar.findMany({
      where: { id: { in: ids } },
      select: { svgContent: true },
    });
    toDelete.forEach(a => deleteAvatarFile(a.svgContent));
    // 清除引用
    await prisma.student.updateMany({ where: { avatarId: { in: ids } }, data: { avatarId: null } });
    await prisma.class.updateMany({ where: { avatarId: { in: ids } }, data: { avatarId: null } });
    // 物理删除
    const result = await prisma.avatar.deleteMany({ where: { id: { in: ids } } });
    res.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error('[batch-delete] Error:', error);
    res.status(500).json({ error: '批量删除失败' });
  }
});

// 设置班级图标
router.put('/class/:classId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { avatarId } = req.body;
    const cls = await prisma.class.update({
      where: { id: req.params.classId },
      data: { avatarId: avatarId || null },
    });
    res.json(cls);
  } catch (error) {
    res.status(500).json({ error: '设置班级图标失败' });
  }
});

// ── 高质量卡通头像生成器 ──────────────────────────

const SKIN = ['#FDECDC', '#FFE4C4', '#F5D0A9', '#E8C39E', '#FFDBAC', '#FFF0D4', '#FCE4EC', '#FFF8E1'];
const HAIR = ['#2C1810', '#3E2723', '#4E342E', '#5D4037', '#1A1A2E', '#333333', '#455A64', '#5C4A3A', '#8D6E63', '#A1887F', '#D4A574', '#C68E5A'];
const EYE_COLORS = ['#4A2800', '#333333', '#1565C0', '#2E7D32', '#6A1B9A', '#00838F'];
const BLUSH = '#FFB5B5';
const WHITE = '#FFFFFF';
const PINK = '#FF80AB';
const ACCENT = ['#E91E63', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#00BCD4'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** 计算 hex 颜色亮度 (0=最暗, 255=最亮) */
function hexLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** 确保头发颜色比肤色至少暗 threshold，否则重新选 */
function pickHair(skinLum: number, threshold = 80): string {
  for (let i = 0; i < 50; i++) {
    const h = pick(HAIR);
    if (skinLum - hexLuminance(h) >= threshold) return h;
  }
  return '#2C1810'; // 保底最暗色
}

function generateRandomStudentAvatar(): { svgContent: string; gender: string } {
  return generateRandomStudentAvatarByGender(Math.random() > 0.5 ? 'boy' : 'girl');
}

function generateRandomStudentAvatarByGender(gender: string): { svgContent: string; gender: string } {
  const skin = pick(SKIN);
  const skinLum = hexLuminance(skin);
  const hair = pickHair(skinLum);
  const eyeColor = pick(EYE_COLORS);
  const accent = pick(ACCENT);
  // 背景色——柔和马卡龙色
  const bgColors = ['#E0F7FA','#FCE4EC','#FFF3E0','#E8F5E9','#F3E5F5','#FFF9C4','#E0F2F1','#FBE9E7'];
  const bg = pick(bgColors);

  let svg = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" fill="${bg}"/>`;

  // ── 1. 身体/服饰层（校服领口/红领巾）──
  if (gender === 'boy') {
    // 白衬衫 + 红领巾
    svg += `<path d="M24 36Q30 34 34 36L34 40L6 40L6 36Q10 34 16 36Q18 37 20 38Q22 37 24 36" fill="#FFFFFF"/>`;
    // 红领巾
    svg += `<path d="M20 36L15 40L17 40Z" fill="#D32F2F"/><path d="M20 36L25 40L23 40Z" fill="#D32F2F"/>`;
    svg += `<polygon points="18,35 22,35 20,37" fill="#B71C1C"/>`;
  } else {
    // 运动校服领口（白底+蓝/红边）
    svg += `<path d="M24 36Q30 34 34 36L34 40L6 40L6 36Q10 34 16 36Q18 37 20 38Q22 37 24 36" fill="#FFFFFF"/>`;
    svg += `<path d="M20 36L16 40M20 36L24 40" stroke="${accent}" stroke-width="1.5" opacity="0.6"/>`;
  }

  // ── 2. 后发层（女生长发/马尾）──
  if (gender === 'girl') {
    const hairBack = Math.floor(Math.random() * 3);
    if (hairBack === 0) {
      // 披肩发后层（只做两侧垂发，不遮脸）
      svg += `<path d="M6 18Q10 4 20 4Q30 4 34 18L34 30Q28 32 26 28Q22 30 20 28Q18 30 14 28Q12 32 6 30Z" fill="${hair}" opacity="0.6"/>`;
    } else if (hairBack === 1) {
      // 高马尾
      svg += `<path d="M20 4Q28 2 32 8Q34 14 30 18Q34 10 26 4Z" fill="${hair}"/>`;
    }
  }

  // ── 3. 脸型层 ──
  svg += `<ellipse cx="20" cy="23" rx="14" ry="15" fill="${skin}"/>`;
  // 耳朵
  svg += `<ellipse cx="7" cy="24" rx="2.5" ry="3.5" fill="${skin}"/>`;
  svg += `<ellipse cx="33" cy="24" rx="2.5" ry="3.5" fill="${skin}"/>`;

  // ── 4. 腮红 ──
  svg += `<ellipse cx="11" cy="27" rx="3" ry="1.5" fill="#FFB6C1" opacity="0.4"/>`;
  svg += `<ellipse cx="29" cy="27" rx="3" ry="1.5" fill="#FFB6C1" opacity="0.4"/>`;

  // ── 5. 五官 ──
  // 眉毛
  if (gender === 'boy') {
    svg += `<path d="M11 19Q13.5 17.5 16 19" stroke="#333" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M24 19Q26.5 17.5 29 19" stroke="#333" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  } else {
    svg += `<path d="M11.5 19Q14 18 16.5 19" stroke="#5D4037" stroke-width="1" fill="none" stroke-linecap="round"/>`;
    svg += `<path d="M23.5 19Q26 18 28.5 19" stroke="#5D4037" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  }

  // 眼睛（自然大小，黑色圆点+高光）
  const eyeR = 2;
  svg += `<circle cx="13.5" cy="23" r="${eyeR}" fill="#2C2C2C"/>`;
  svg += `<circle cx="13" cy="22.3" r="0.8" fill="${WHITE}"/>`;
  svg += `<circle cx="26.5" cy="23" r="${eyeR}" fill="#2C2C2C"/>`;
  svg += `<circle cx="26" cy="22.3" r="0.8" fill="${WHITE}"/>`;

  // 鼻子（小圆点）
  svg += `<circle cx="20" cy="26" r="0.6" fill="#D7A98C" opacity="0.6"/>`;

  // 嘴巴（微笑）
  const mouthType = Math.floor(Math.random() * 3);
  if (mouthType === 0) {
    svg += `<path d="M16 29.5Q20 32 24 29.5" stroke="#E57373" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  } else if (mouthType === 1) {
    svg += `<path d="M17 29.5Q20 33 23 29.5" stroke="#E57373" stroke-width="1" fill="none" stroke-linecap="round"/>`;
    svg += `<ellipse cx="20" cy="30.5" rx="2" ry="1" fill="${WHITE}" opacity="0.8"/>`;
  } else {
    svg += `<path d="M17 29.5Q20 32 23 29.5Z" fill="#E57373" opacity="0.7"/>`;
  }

  // ── 6. 前发/刘海层 ──
  if (gender === 'boy') {
    const hs = Math.floor(Math.random() * 4);
    switch (hs) {
      case 0: // 碎刘海
        svg += `<path d="M6 18Q8 4 20 4Q32 4 34 18Q32 12 28 10Q24 8 20 8Q16 8 12 10Q8 12 6 18" fill="${hair}"/>`;
        svg += `<path d="M10 10Q14 6 20 6Q26 6 30 10" fill="${pick(HAIR)}" opacity="0.3"/>`;
        break;
      case 1: // 锅盖头
        svg += `<path d="M6 18Q6 5 20 4Q34 5 34 18Q32 13 28 12Q24 10 20 10Q16 10 12 12Q8 13 6 18" fill="${hair}"/>`;
        break;
      case 2: // 偏分
        svg += `<path d="M8 20Q8 4 20 4Q24 4 26 10Q30 4 34 8L34 20Q32 14 28 12Q24 10 20 10Q14 10 10 12Q8 14 8 20" fill="${hair}"/>`;
        break;
      case 3: // 寸头
        svg += `<path d="M6 18Q8 3 20 3Q32 3 34 18" fill="${hair}"/>`;
        svg += `<path d="M8 10Q14 5 20 5Q26 5 32 10" fill="${pick(HAIR)}" opacity="0.4"/>`;
        break;
    }
  } else {
    const hs = Math.floor(Math.random() * 5);
    switch (hs) {
      case 0: // 齐刘海
        svg += `<path d="M6 16Q8 2 20 2Q32 2 34 16Q30 10 26 12Q22 9 20 10Q18 9 14 12Q10 10 6 16" fill="${hair}"/>`;
        svg += `<line x1="6" y1="12" x2="34" y2="12" stroke="${pick(HAIR)}" stroke-width="0.8" opacity="0.3"/>`;
        break;
      case 1: // 斜刘海
        svg += `<path d="M6 18Q8 2 20 2Q32 2 34 18L34 19Q32 14 28 12Q24 10 20 10Q16 10 12 12Q8 14 6 18Z" fill="${hair}"/>`;
        svg += `<path d="M6 12Q10 2 20 2Q24 2 28 6Q22 8 16 10Q10 12 6 16Z" fill="${pick(HAIR)}" opacity="0.3"/>`;
        break;
      case 2: // 双马尾
        svg += `<path d="M8 18Q8 4 20 4Q32 4 32 18" fill="${hair}"/>`;
        svg += `<circle cx="8" cy="10" r="4.5" fill="${hair}"/><circle cx="32" cy="10" r="4.5" fill="${hair}"/>`;
        svg += `<circle cx="8" cy="10" r="2" fill="${accent}" opacity="0.5"/><circle cx="32" cy="10" r="2" fill="${accent}" opacity="0.5"/>`;
        break;
      case 3: // 波波头（改良——底部只到脸颊上方）
        svg += `<path d="M6 18Q8 3 20 3Q32 3 34 18L34 21Q32 19 28 18Q24 17 20 18Q16 17 12 18Q8 19 6 21Z" fill="${hair}"/>`;
        break;
      case 4: // 高马尾
        svg += `<path d="M8 18Q8 4 20 4Q32 4 32 18" fill="${hair}"/>`;
        svg += `<path d="M20 2Q26 0 30 6Q28 10 24 8Q22 4 20 2" fill="${hair}"/>`;
        break;
    }
  }

  // ── 7. 配饰 ──
  if (gender === 'boy' && Math.random() > 0.7) {
    // 黑框眼镜
    svg += `<rect x="10" y="20" width="7" height="6" rx="1.5" fill="none" stroke="#455A64" stroke-width="1"/>`;
    svg += `<rect x="23" y="20" width="7" height="6" rx="1.5" fill="none" stroke="#455A64" stroke-width="1"/>`;
    svg += `<line x1="17" y1="23" x2="23" y2="23" stroke="#455A64" stroke-width="1"/>`;
  }
  if (gender === 'girl' && Math.random() > 0.6) {
    const bx = Math.random() > 0.5 ? 10 : 30;
    svg += `<circle cx="${bx}" cy="9" r="2.5" fill="${accent}"/>`;
    svg += `<circle cx="${bx - 1.5}" cy="8.5" r="1" fill="${WHITE}" opacity="0.6"/>`;
  }

  svg += `</svg>`;
  return { svgContent: svg, gender };
}

function generateRandomClassIcon(route?: number): { svgContent: string; gender: string } {
  // 校园主题色板，按方案分组
  const scheme0 = [ // 方案一：书山有路
    { bg: '#1E3A8A', shade: '#0F172A', pill: '#FFFFFF', accent: '#FBBF24' },
    { bg: '#C91B1B', shade: '#8B1010', pill: '#FFFFFF', accent: '#FCD34D' },
    { bg: '#1E40AF', shade: '#0F1B4D', pill: '#FFFFFF', accent: '#93C5FD' },
    { bg: '#065F46', shade: '#022C22', pill: '#FFFFFF', accent: '#6EE7B7' },
  ];
  const scheme1 = [ // 方案二：青春纸飞机
    { bg: '#059669', shade: '#047857', pill: '#FFFFFF', accent: '#FCD34D' },
    { bg: '#0F766E', shade: '#042F2E', pill: '#FFFFFF', accent: '#F9A8D4' },
    { bg: '#9A3412', shade: '#431407', pill: '#FFFFFF', accent: '#FDBA74' },
    { bg: '#0F172A', shade: '#020617', pill: '#FFFFFF', accent: '#38BDF8' },
  ];
  const scheme2 = [ // 方案三：星辰科技
    { bg: '#6B21A8', shade: '#3B0764', pill: '#FFFFFF', accent: '#2DD4BF' },
    { bg: '#0F172A', shade: '#020617', pill: '#FFFFFF', accent: '#38BDF8' },
    { bg: '#831843', shade: '#340815', pill: '#FFFFFF', accent: '#F9A8D4' },
    { bg: '#1E3A8A', shade: '#0F172A', pill: '#FFFFFF', accent: '#2DD4BF' },
  ];

  const schemes = [scheme0, scheme1, scheme2];
  const routeIcons = [
    [0, 3, 4, 8, 6],    // 方案一：书、幼苗、奖杯、尺子、星
    [1, 5, 9],           // 方案二：纸飞机、指南针、纸飞机增强
    [2, 7, 10, 11, 6],   // 方案三：原子、火箭、轨道、望远镜、星
  ];

  const r = (route !== undefined && route >= 0 && route <= 2) ? route : 0; // 默认方案一：书山有路
  const p = pick(schemes[r]);
  const icons = routeIcons[r];
  const iconType = icons[Math.floor(Math.random() * icons.length)];
  const S = p.shade;
  const W = '#FFFFFF';
  const A = p.accent;

  let svg = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
<defs><clipPath id="m"><rect x="1" y="2" width="38" height="36" rx="8"/></clipPath></defs>
<g clip-path="url(#m)">`;

  // 背景底板
  svg += `<rect x="1" y="2" width="38" height="36" fill="${p.bg}"/>`;
  svg += `<polygon points="20,2 39,2 39,38 20,38" fill="${S}" opacity="0.2"/>`;

  // 方案背景装饰
  if (r === 0) {
    svg += `<path d="M1 20L39 20 M20 2L20 38" stroke="${W}" stroke-width="0.5" opacity="0.08"/>`;
    svg += `<circle cx="20" cy="20" r="13" fill="none" stroke="${W}" stroke-width="0.5" opacity="0.06"/>`;
  } else if (r === 1) {
    svg += `<path d="M10 10Q14 6 18 10Q22 6 26 12" fill="none" stroke="${W}" stroke-width="1.2" opacity="0.1" stroke-linecap="round"/>`;
    svg += `<path d="M28 28Q32 24 35 28" fill="none" stroke="${W}" stroke-width="1.2" opacity="0.08" stroke-linecap="round"/>`;
  } else {
    svg += `<circle cx="10" cy="10" r="1" fill="${W}" opacity="0.15"/>`;
    svg += `<circle cx="30" cy="8" r="0.8" fill="${W}" opacity="0.12"/>`;
    svg += `<circle cx="32" cy="28" r="1.2" fill="${W}" opacity="0.1"/>`;
    svg += `<circle cx="8" cy="30" r="0.8" fill="${W}" opacity="0.08"/>`;
  }

  // 图标主体
  switch (iconType) {
    case 0: // 书本 + 晨星（方案一）
      svg += `<circle cx="20" cy="12" r="6" fill="${A}" opacity="0.8"/>`;
      svg += `<circle cx="20" cy="12" r="3.5" fill="${W}"/>`;
      svg += `<path d="M20 6L21 9L24 10L21 11L20 14L19 11L16 10L19 9Z" fill="${A}"/>`;
      svg += `<g transform="translate(0,4)"><path d="M10 22L20 18L30 22L27 28L20 25L13 28Z" fill="${W}" opacity="0.95"/>`;
      svg += `<path d="M10 20L20 16L30 20L27 26L20 23L13 26Z" fill="#CBD5E1" opacity="0.6"/></g>`;
      svg += `<line x1="20" y1="18" x2="20" y2="25" stroke="${p.bg}" stroke-width="1"/>`;
      break;
    case 1: // 纸飞机 + 靶心（方案二）
      svg += `<circle cx="28" cy="14" r="5" fill="${A}" opacity="0.3"/>`;
      svg += `<circle cx="28" cy="14" r="2.5" fill="${A}" opacity="0.6"/>`;
      svg += `<circle cx="28" cy="14" r="1" fill="${W}"/>`;
      svg += `<path d="M12 28Q18 22 26 16" fill="none" stroke="${W}" stroke-width="1" stroke-dasharray="2 2" opacity="0.5"/>`;
      svg += `<path d="M16 22L22 12L30 16L16 22Z" fill="${W}" opacity="0.95"/>`;
      svg += `<path d="M16 22L22 12L20 22Z" fill="#CBD5E1" opacity="0.8"/>`;
      svg += `<path d="M16 22L20 22L18 26Z" fill="#9CA3AF" opacity="0.6"/>`;
      break;
    case 2: // 原子轨道 + 中心星辰（方案三）
      svg += `<ellipse cx="20" cy="18" rx="11" ry="4" fill="none" stroke="${A}" stroke-width="1" transform="rotate(30 20 18)" opacity="0.7"/>`;
      svg += `<ellipse cx="20" cy="18" rx="11" ry="4" fill="none" stroke="${A}" stroke-width="1" transform="rotate(-30 20 18)" opacity="0.7"/>`;
      svg += `<circle cx="20" cy="18" r="5" fill="${A}" opacity="0.25"/>`;
      svg += `<path d="M20 13L22 18L20 23L18 18Z" fill="${W}"/>`;
      svg += `<circle cx="20" cy="18" r="1.5" fill="${A}"/>`;
      svg += `<circle cx="28" cy="11" r="1.8" fill="${A}"/>`;
      svg += `<circle cx="12" cy="25" r="1.8" fill="${A}"/>`;
      break;
    case 3: // 幼苗（方案一）
      svg += `<rect x="18" y="22" width="4" height="8" rx="2" fill="${W}" opacity="0.7"/>`;
      svg += `<ellipse cx="20" cy="13" rx="8" ry="9" fill="${W}" opacity="0.95"/>`;
      svg += `<circle cx="16" cy="12" r="3" fill="${A}" opacity="0.5"/>`;
      svg += `<circle cx="24" cy="15" r="2.5" fill="${A}" opacity="0.4"/>`;
      svg += `<path d="M20 5Q16 8 18 12" fill="none" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>`;
      svg += `<path d="M20 5Q24 8 22 12" fill="none" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>`;
      break;
    case 4: // 奖杯（方案一）
      svg += `<path d="M15 10L25 10V18Q25 25 20 27Q15 25 15 18Z" fill="${W}" opacity="0.95"/>`;
      svg += `<rect x="17" y="10" width="6" height="3" rx="0.5" fill="${A}" opacity="0.6"/>`;
      svg += `<path d="M13 14Q10 14 10 18Q10 22 13 22" fill="none" stroke="${W}" stroke-width="1.5" opacity="0.7"/>`;
      svg += `<path d="M27 14Q30 14 30 18Q30 22 27 22" fill="none" stroke="${W}" stroke-width="1.5" opacity="0.7"/>`;
      svg += `<polygon points="20,6 21,8 24,9 21,10 20,12 19,10 16,9 19,8" fill="${A}"/>`;
      break;
    case 5: // 指南针（方案二）
      svg += `<circle cx="20" cy="18" r="9" fill="none" stroke="${W}" stroke-width="1.5" opacity="0.85"/>`;
      svg += `<polygon points="20,8 23,20 20,28 17,20" fill="${A}" opacity="0.8"/>`;
      svg += `<polygon points="20,28 23,20 20,18 17,20" fill="${W}" opacity="0.5"/>`;
      svg += `<circle cx="20" cy="18" r="1.5" fill="${W}"/>`;
      break;
    case 6: // 星星（方案三）
      svg += `<polygon points="20,6 23,16 34,16 25,22 28,32 20,26 12,32 15,22 6,16 17,16" fill="${W}" opacity="0.95"/>`;
      svg += `<circle cx="20" cy="19" r="3" fill="${A}" opacity="0.8"/>`;
      break;
    case 7: // 火箭（方案三）
      svg += `<path d="M20 6L16 20Q16 22 20 22Q24 22 24 20Z" fill="${W}" opacity="0.95"/>`;
      svg += `<circle cx="20" cy="16" r="2.5" fill="${A}" opacity="0.7"/>`;
      svg += `<polygon points="16,23 20,27 24,23" fill="${A}" opacity="0.8"/>`;
      svg += `<line x1="13" y1="27" x2="16" y2="24" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>`;
      svg += `<line x1="27" y1="27" x2="24" y2="24" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>`;
      break;
    case 8: // 三角尺（方案一）
      svg += `<polygon points="13,26 27,26 20,12" fill="none" stroke="${W}" stroke-width="1.8" opacity="0.95"/>`;
      svg += `<line x1="20" y1="12" x2="20" y2="26" stroke="${W}" stroke-width="0.5" stroke-dasharray="1 1.5" opacity="0.5"/>`;
      svg += `<circle cx="13" cy="26" r="1.5" fill="${A}"/><circle cx="27" cy="26" r="1.5" fill="${A}"/><circle cx="20" cy="12" r="1.5" fill="${A}"/>`;
      break;
    case 9: // 纸飞机轨迹（方案二）
      svg += `<path d="M10 28Q18 20 28 12" fill="none" stroke="${A}" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>`;
      svg += `<circle cx="28" cy="12" r="4" fill="${A}" opacity="0.25"/><circle cx="28" cy="12" r="2" fill="${A}" opacity="0.5"/><circle cx="28" cy="12" r="0.8" fill="${W}"/>`;
      svg += `<path d="M14 22L20 14L28 18L14 22Z" fill="${W}" opacity="0.95"/><path d="M14 22L20 14L18 22Z" fill="#CBD5E1" opacity="0.8"/><path d="M14 22L18 22L16 26Z" fill="#9CA3AF" opacity="0.6"/>`;
      break;
    case 10: // 行星轨道（方案三）
      svg += `<ellipse cx="20" cy="18" rx="13" ry="4" fill="none" stroke="${A}" stroke-width="1" transform="rotate(25 20 18)" opacity="0.5"/>`;
      svg += `<ellipse cx="20" cy="18" rx="13" ry="4" fill="none" stroke="${A}" stroke-width="1" transform="rotate(-25 20 18)" opacity="0.5"/>`;
      svg += `<circle cx="20" cy="18" r="5" fill="${A}" opacity="0.2"/><circle cx="20" cy="18" r="3" fill="${A}" opacity="0.8"/><circle cx="20" cy="18" r="1.5" fill="${W}"/>`;
      svg += `<circle cx="28" cy="18" r="1.8" fill="${A}"/><circle cx="12" cy="15" r="1.2" fill="${W}" opacity="0.7"/>`;
      svg += `<line x1="6" y1="8" x2="10" y2="12" stroke="${W}" stroke-width="1" opacity="0.3" stroke-linecap="round"/>`;
      break;
    case 11: // 望远镜（方案三）
      svg += `<rect x="18" y="10" width="4" height="14" rx="2" fill="${W}" opacity="0.3" transform="rotate(-30 20 18)"/>`;
      svg += `<rect x="18" y="10" width="4" height="14" rx="2" fill="${W}" opacity="0.5" transform="rotate(20 20 18)"/>`;
      svg += `<circle cx="14" cy="14" r="2" fill="none" stroke="${A}" stroke-width="1.5" opacity="0.8"/><circle cx="26" cy="14" r="2" fill="none" stroke="${A}" stroke-width="1.5" opacity="0.8"/>`;
      svg += `<circle cx="14" cy="14" r="0.8" fill="${W}"/><circle cx="26" cy="14" r="0.8" fill="${W}"/>`;
      svg += `<line x1="20" y1="18" x2="20" y2="28" stroke="${W}" stroke-width="1" opacity="0.5"/>`;
      svg += `<path d="M14 28Q20 32 26 28" fill="none" stroke="${W}" stroke-width="1" opacity="0.4"/>`;
      break;
  }
  svg += `</g></svg>`;
  return { svgContent: svg, gender: 'neutral' };
}

export default router;
