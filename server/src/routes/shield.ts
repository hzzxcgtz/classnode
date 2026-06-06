import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import defaultShieldWords, { shieldCategories } from '../services/default-shield-words.js';

const router: Router = Router();

// 获取所有屏蔽词（内置排前，按词排序）
router.get('/words', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const words = await prisma.shieldWord.findMany({
      orderBy: [{ builtin: 'desc' }, { word: 'asc' }],
    });
    res.json(words);
  } catch (error) {
    res.status(500).json({ error: '获取屏蔽词失败' });
  }
});

// 获取系统屏蔽词分类信息（每类包含带 ID 的词条列表）
router.get('/words/categories', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    // 从数据库查出所有内置词，建立 word -> id 映射
    const dbWords = await prisma.shieldWord.findMany({
      where: { builtin: true },
      select: { id: true, word: true, enabled: true },
    });
    const dbWordMap = new Map(dbWords.map(w => [w.word, w.id]));

    const result = Object.entries(shieldCategories).map(([name, words]) => {
      const filtered = words
        .filter(w => dbWordMap.has(w))
        .map(w => {
          const dbWord = dbWords.find(d => d.word === w);
          return { id: dbWordMap.get(w)!, word: w, enabled: dbWord?.enabled ?? true };
        });
      return { name, count: filtered.length, words: filtered };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取分类信息失败' });
  }
});

// 添加屏蔽词
router.post('/words', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { word } = req.body;
    if (!word?.trim()) {
      return res.status(400).json({ error: '请输入屏蔽词' });
    }
    const existing = await prisma.shieldWord.findUnique({
      where: { word: word.trim() },
    });
    if (existing) {
      return res.status(400).json({ error: '该屏蔽词已存在' });
    }
    const created = await prisma.shieldWord.create({
      data: { word: word.trim() },
    });
    res.json(created);
  } catch (error) {
    res.status(500).json({ error: '添加屏蔽词失败' });
  }
});

// 删除屏蔽词
router.delete('/words/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    await prisma.shieldWord.delete({
      where: { id: req.params.id },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除屏蔽词失败' });
  }
});

// 批量删除屏蔽词
router.post('/words/batch-delete', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { ids } = req.body;
    await prisma.shieldWord.deleteMany({
      where: { id: { in: ids } },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '批量删除失败' });
  }
});

// 清空所有系统默认屏蔽词（保留自定义词）
router.post('/words/clear-builtin', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { count } = await prisma.shieldWord.deleteMany({
      where: { builtin: true },
    });
    res.json({ success: true, deleted: count });
  } catch (error) {
    res.status(500).json({ error: '清空默认屏蔽词失败' });
  }
});

// 切换屏蔽词启用/禁用状态
router.put('/words/:id/toggle', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const word = await prisma.shieldWord.findUnique({ where: { id: req.params.id } });
    if (!word) return res.status(404).json({ error: '屏蔽词不存在' });
    const updated = await prisma.shieldWord.update({
      where: { id: req.params.id },
      data: { enabled: !word.enabled },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: '切换失败' });
  }
});

// 批量切换屏蔽词启用/禁用状态
router.put('/words/batch-toggle', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { ids, enabled } = req.body;
    await prisma.shieldWord.updateMany({
      where: { id: { in: ids } },
      data: { enabled },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '批量切换失败' });
  }
});

// 恢复系统默认屏蔽词（仅补充预设词，不删除自定义词）
router.post('/words/restore-defaults', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    let restored = 0;
    for (const word of defaultShieldWords) {
      const existing = await prisma.shieldWord.findUnique({ where: { word } });
      if (!existing) {
        await prisma.shieldWord.create({ data: { word, builtin: true } });
        restored++;
      }
    }
    res.json({ success: true, restored, total: defaultShieldWords.length });
  } catch (error) {
    res.status(500).json({ error: '恢复默认屏蔽词失败' });
  }
});

// 获取屏蔽配置
router.get('/config', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    let config = await prisma.shieldConfig.findFirst();
    if (!config) {
      config = await prisma.shieldConfig.create({
        data: { autoBlackCount: 0 },
      });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 更新屏蔽配置
router.put('/config', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { autoBlackCount } = req.body;
    let config = await prisma.shieldConfig.findFirst();
    if (config) {
      config = await prisma.shieldConfig.update({
        where: { id: config.id },
        data: { autoBlackCount: Math.max(0, parseInt(autoBlackCount) || 0) },
      });
    } else {
      config = await prisma.shieldConfig.create({
        data: { autoBlackCount: Math.max(0, parseInt(autoBlackCount) || 0) },
      });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: '更新配置失败' });
  }
});

// 黑屏处理学生
router.post('/classroom/:classroomId/student/:studentId/blacklist', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { classroomId, studentId } = req.params;
    await prisma.classroomStudent.updateMany({
      where: { classroomId, studentId },
      data: { blacklisted: true },
    });
    const io = req.app.get('io');
    io.to(`teacher:${classroomId}`).emit('student-blacklisted', { studentId });
    io.to(`classroom:${classroomId}`).emit('student-blacklisted', { studentId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '黑屏处理失败' });
  }
});

// 解除黑屏
router.post('/classroom/:classroomId/student/:studentId/unblacklist', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { classroomId, studentId } = req.params;
    await prisma.classroomStudent.updateMany({
      where: { classroomId, studentId },
      data: { blacklisted: false, warningCount: 0 },
    });
    const io = req.app.get('io');
    io.to(`teacher:${classroomId}`).emit('student-unblacklisted', { studentId, warningCount: 0 });
    io.to(`classroom:${classroomId}`).emit('student-unblacklisted', { studentId, warningCount: 0 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '解除黑屏失败' });
  }
});

// 获取课堂的警告记录
router.get('/classroom/:classroomId/warnings', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const warnings = await prisma.shieldWarning.findMany({
      where: { classroomId: req.params.classroomId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(warnings);
  } catch (error) {
    res.status(500).json({ error: '获取警告记录失败' });
  }
});

// 重置学生警告次数
router.post('/classroom/:classroomId/student/:studentId/reset-warnings', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { classroomId, studentId } = req.params;
    await prisma.classroomStudent.updateMany({
      where: { classroomId, studentId },
      data: { warningCount: 0 },
    });
    const io = req.app.get('io');
    io.to(`teacher:${classroomId}`).emit('shield-warning', { studentId, warningCount: 0 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '重置警告次数失败' });
  }
});

export default router;
