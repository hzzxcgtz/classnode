import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

// 导出全班对话汇总 (JSON format, can be converted to Word by frontend)
router.get('/:classroomId/conversations', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.classroomId },
      include: {
        classes: { include: { class: true } },
        classroomAgents: { include: { agent: true } },
      },
    });

    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const students = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.classroomId },
      include: {
        student: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { joinTime: 'asc' },
    });

    const agentMap: Record<string, string> = {};
    for (const ca of classroom.classroomAgents) {
      agentMap[ca.agent.id] = ca.agent.name;
    }

    const report = {
      title: classroom.title || '课堂对话汇总',
      code: classroom.code,
      mode: classroom.mode,
      createdAt: classroom.createdAt,
      endedAt: classroom.endedAt,
      classes: classroom.classes.map((cc: { class: { name: string } }) => cc.class.name),
      agents: classroom.classroomAgents.map((ca: Prisma.ClassroomAgentGetPayload<{ include: { agent: true } }>) => ({
        id: ca.agent.id,
        name: ca.agent.name,
        platform: ca.agent.platform,
      })),
      students: students.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true; messages: true } }>) => ({
        name: cs.student.name,
        studentNo: cs.student.studentNo,
        totalRounds: cs.totalRounds,
        messages: cs.messages.map((m: Prisma.MessageGetPayload<{}>) => ({
          role: m.role,
          content: m.content,
          time: m.createdAt,
          roundIndex: m.roundIndex,
          tokenUsage: m.tokenUsage,
          agentId: m.agentId,
          agentName: m.agentId ? (agentMap[m.agentId] || null) : null,
          fileUrls: m.fileUrls ? (() => { try { return JSON.parse(m.fileUrls); } catch { return undefined; } })() : undefined,
          fileNames: m.fileNames ? (() => { try { return JSON.parse(m.fileNames); } catch { return undefined; } })() : undefined,
        })),
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=conversations-${classroom.code}.json`);
    res.json(report);
  } catch (error) {
    console.error('[Export] conversations error:', error);
    res.status(500).json({ error: '导出失败' });
  }
});

// 导出学情报表 (Excel-like JSON)
router.get('/:classroomId/stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    const interactions = await prisma.interaction.findMany({
      where: { classroomId: req.params.classroomId },
    });
    const studentIds = interactions.map((i: Prisma.InteractionGetPayload<{}>) => i.studentId);
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
    });
    const studentMap = new Map(students.map((s: Prisma.StudentGetPayload<{}>) => [s.id, s]));

    const report = {
      title: '学情报表',
      exportedAt: new Date().toISOString(),
      headers: ['姓名', '学号', '互动次数', '首问字数', '平均响应时间(秒)', '总Token消耗'],
      rows: interactions.map((i: Prisma.InteractionGetPayload<{}>) => {
        const s = studentMap.get(i.studentId);
        return [
          s?.name || '未知',
          s?.studentNo || '-',
          i.totalRounds,
          i.firstMsgLen || 0,
          i.avgTime || 0,
          i.totalTokens || 0,
        ];
      }),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=stats-${req.params.classroomId}.json`);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: '导出报表失败' });
  }
});

// 数据库备份
router.post('/backup', async (req, res) => {
  try {
    const dbPath = path.join(__dirname, '../../prisma/dev.db');
    const backupDir = path.join(__dirname, '../../backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `classnode-backup-${timestamp}.db`);

    fs.copyFileSync(dbPath, backupPath);

    res.json({
      success: true,
      path: backupPath,
      size: fs.statSync(backupPath).size,
    });
  } catch (error) {
    res.status(500).json({ error: '备份失败' });
  }
});

// 获取备份列表
router.get('/backups', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('classnode-backup-') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        size: fs.statSync(path.join(backupDir, f)).size,
        createdAt: fs.statSync(path.join(backupDir, f)).birthtime,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: '获取备份列表失败' });
  }
});

// 删除备份文件
router.delete('/backup/:name', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除备份失败' });
  }
});

// 从备份恢复数据库
router.post('/restore/:name', async (req, res) => {
  try {
    const dbPath = path.join(__dirname, '../../prisma/dev.db');
    const backupDir = path.join(__dirname, '../../backups');
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    // 复制备份文件覆盖当前数据库
    fs.copyFileSync(filePath, dbPath);

    // 清除可能存在的旧 WAL/SHM 文件，避免干扰
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    res.json({ success: true, restoredFrom: name });
  } catch (error) {
    console.error('[Restore] error:', error);
    res.status(500).json({ error: '恢复失败: ' + (error instanceof Error ? error.message : '未知错误') });
  }
});

// 初始化清零（删除所有数据）
router.post('/reset', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    const tables = [
      'Message', 'ClassroomStudent', 'ClassroomGroup',
      'ClassroomAgent', 'ClassroomClass', 'Interaction',
      'Student', 'ClassGroup', 'Classroom', 'Class', 'Agent',
    ];

    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '清零失败' });
  }
});

export default router;
