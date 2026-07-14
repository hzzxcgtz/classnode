import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
import fs from 'fs';
import crypto from 'crypto';
import { reloadEncryptionKey } from '../services/crypto.js';
import { safeExtractZip } from '../services/upload-security.js';
import {
  generateConversationsDocx,
  generateStatsDocx,
  generateConversationsCsv,
  generateStatsCsv,
} from '../services/export-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

function readableTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function getBackupDir(): string {
  const dir = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'backups')
    : path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath(): string {
  if (process.env.DATABASE_URL) {
    const m = process.env.DATABASE_URL.match(/^file:(.+)/);
    if (m) {
      const p = m[1];
      // DATABASE_URL 是相对于 prisma/ 目录的，fs 操作需要绝对路径
      if (!path.isAbsolute(p) && !p.startsWith('.')) return p;
      return path.resolve(__dirname, '../../prisma', p);
    }
  }
  return path.join(__dirname, '../../prisma/dev.db');
}

async function validateClassNodeDatabase(filePath: string): Promise<void> {
  const { PrismaClient: ValidationClient } = await import('@prisma/client');
  const client = new ValidationClient({ datasources: { db: { url: `file:${filePath}` } } });
  try {
    const tables = await client.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Classroom', 'Class', 'Agent')",
    );
    if (tables.length < 3) throw new Error('数据库结构不匹配');
    const integrity = await client.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
    if (integrity[0]?.integrity_check !== 'ok') throw new Error('数据库完整性检查失败');
  } finally {
    await client.$disconnect();
  }
}

async function createDatabaseSafetySnapshot(prisma: PrismaClient, backupDir: string): Promise<string> {
  const snapshotPath = path.join(backupDir, `classnode-backup-${readableTimestamp()}-${crypto.randomUUID().slice(0, 8)}-pre-restore.classdb`);
  const escaped = snapshotPath.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  fs.writeFileSync(snapshotPath + '.meta', JSON.stringify({ source: 'safety-restore' }));
  return snapshotPath;
}

// Multer: 备份文件上传
const backupStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getBackupDir());
  },
  filename: (_req, _file, cb) => {
    cb(null, `upload-${crypto.randomUUID()}.db`);
  },
});
const backupUpload = multer({
  storage: backupStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.classbak', '.classdb', '.db', '.zip'].some(ext => file.originalname.endsWith(ext));
    if (!ok) {
      cb(new Error('仅支持 .classbak / .classdb 格式的备份文件'));
      return;
    }
    cb(null, true);
  },
});

// 导出全班对话汇总 (JSON format, supports ?studentIds=id1,id2 filter)
router.get('/:classroomId/conversations', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const studentIds = (req.query.studentIds as string)?.split(',').filter(Boolean);

    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.classroomId },
      include: {
        classes: { include: { class: true } },
        classroomAgents: { include: { agent: true } },
      },
    });

    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const rawStudents = await prisma.classroomStudent.findMany({
      where: {
        classroomId: req.params.classroomId,
        ...(studentIds?.length ? { studentId: { in: studentIds } } : {}),
      },
      include: {
        student: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { joinTime: 'asc' },
    });
    // 标准模式过滤掉虚拟小组学生
    const students = classroom.mode === 'standard'
      ? rawStudents.filter(cs => cs.student.tag !== '__group__')
      : rawStudents;

    // 加载教师通知
    const teacherNotifs = await prisma.teacherNotification.findMany({
      where: { classroomId: req.params.classroomId },
      orderBy: { createdAt: 'asc' },
    });

    // 构建学生→通知的映射（广播通知归入每个学生）
    const studentNotifMap: Record<string, { content: string; time: Date; target: string | null }[]> = {};
    for (const n of teacherNotifs) {
      const entry = { content: n.content, time: n.createdAt, target: n.studentId };
      if (n.studentId) {
        if (!studentNotifMap[n.studentId]) studentNotifMap[n.studentId] = [];
        studentNotifMap[n.studentId].push(entry);
      }
    }

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
      teacherNotifications: teacherNotifs.map((n: Prisma.TeacherNotificationGetPayload<object>) => ({
        content: n.content,
        time: n.createdAt,
        targetStudentId: n.studentId,
      })),
      students: students.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true; messages: true } }>) => {
        // 合并该学生的教师通知（全班广播 + 定向给该学生的）
        const notifMsgs = teacherNotifs
          .filter(n => n.studentId === null || n.studentId === cs.student.id)
          .map(n => ({
            role: 'teacher-notification',
            content: n.content,
            time: n.createdAt,
            roundIndex: null,
            agentId: null,
            agentName: null,
            fileUrls: undefined,
            fileNames: undefined,
          }));
        return {
          name: cs.student.name,
          studentNo: cs.student.studentNo,
          gender: cs.student.gender,
          totalRounds: cs.totalRounds,
          messages: [
            ...notifMsgs,
            ...cs.messages.map((m: Prisma.MessageGetPayload<object>) => ({
              role: m.role,
              content: m.content,
              time: m.createdAt,
              roundIndex: m.roundIndex,
              agentId: m.agentId,
              agentName: m.agentId ? (agentMap[m.agentId] || null) : null,
              fileUrls: m.fileUrls ? (() => { try { return JSON.parse(m.fileUrls); } catch { return undefined; } })() : undefined,
              fileNames: m.fileNames ? (() => { try { return JSON.parse(m.fileNames); } catch { return undefined; } })() : undefined,
            })),
          ],
        };
      }),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=conversations-${classroom.code}.json`);
    res.json(report);
  } catch (error) {
    console.error('[Export] conversations error:', error);
    res.status(500).json({ error: '导出失败' });
  }
});

// ─── 服务端生成 DOCX（对话记录） ────────────────────────────
router.post('/:classroomId/conversations/docx', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const { studentIds, socketId } = req.body;

    const result = await generateConversationsDocx(
      req.params.classroomId,
      prisma,
      socketId && io ? (p) => {
        io.to(socketId).emit('export-progress', p);
      } : undefined,
      { studentIds },
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.buffer);
  } catch (error: unknown) {
    console.error('[Export] conversations DOCX error:', error);
    res.status(500).json({ error: '导出失败: ' + errorMessage(error) });
  }
});

// 服务端生成 CSV（对话记录）
router.post('/:classroomId/conversations/csv', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentIds } = req.body;

    const result = await generateConversationsCsv(
      req.params.classroomId,
      prisma,
      { studentIds },
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.csv);
  } catch (error: unknown) {
    console.error('[Export] conversations CSV error:', error);
    res.status(500).json({ error: '导出失败: ' + errorMessage(error) });
  }
});

// 导出学情报表 — 从消息记录实时计算（支持 ?studentIds=id1,id2 筛选）
router.get('/:classroomId/stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const studentIds = (req.query.studentIds as string)?.split(',').filter(Boolean);

  const rawClassroomStudents = await prisma.classroomStudent.findMany({
      where: {
        classroomId: req.params.classroomId,
        ...(studentIds?.length ? { studentId: { in: studentIds } } : {}),
      },
      include: {
        student: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    // 获取课堂模式用于过滤虚拟小组学生
    const crMode = await prisma.classroom.findUnique({
      where: { id: req.params.classroomId },
      select: { mode: true },
    });
    const classroomStudents = crMode?.mode === 'standard'
      ? rawClassroomStudents.filter(cs => cs.student.tag !== '__group__')
      : rawClassroomStudents;

    const rows = classroomStudents
      .map((cs) => {
        const msgs = cs.messages || [];
        const userMsgs = msgs.filter(m => m.role === 'user');
        const totalRounds = userMsgs.length;
        const firstMsgLen = userMsgs.length > 0 ? (userMsgs[0].content?.length || 0) : 0;
        // 计算平均响应时间：找到每条用户消息后第一条 assistant 消息的时间差
        let totalResponseTime = 0;
        let responseCount = 0;
        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].role === 'assistant' && i > 0 && msgs[i - 1].role === 'user') {
            const diff = (new Date(msgs[i].createdAt).getTime() - new Date(msgs[i - 1].createdAt).getTime()) / 1000;
            if (diff > 0) {
              totalResponseTime += diff;
              responseCount++;
            }
          }
        }
        const avgTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0;

        return {
          studentNo: cs.student.studentNo || '',
          name: cs.student.name,
          gender: cs.student.gender,
          totalRounds,
          firstMsgLen,
          avgTime,
        };
      })
      .sort((a, b) => a.studentNo.localeCompare(b.studentNo, undefined, { numeric: true }));

    const report = {
      title: '学情报表',
      exportedAt: new Date().toISOString(),
      headers: ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'],
      rows: rows.map(r => [
        r.studentNo || '-',
        r.name,
        r.totalRounds,
        r.firstMsgLen,
        r.avgTime,
      ]),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=stats-${req.params.classroomId}-${readableTimestamp()}.json`);
    res.json(report);
  } catch (error) {
    console.error('[Export] stats error:', error);
    res.status(500).json({ error: '导出报表失败' });
  }
});

// ─── 服务端生成 DOCX（学情报表） ────────────────────────────
router.post('/:classroomId/stats/docx', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const { studentIds, socketId } = req.body;

    const result = await generateStatsDocx(
      req.params.classroomId,
      prisma,
      socketId && io ? (p) => {
        io.to(socketId).emit('export-progress', p);
      } : undefined,
      { studentIds },
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.buffer);
  } catch (error: unknown) {
    console.error('[Export] stats DOCX error:', error);
    res.status(500).json({ error: '导出失败: ' + errorMessage(error) });
  }
});

// 服务端生成 CSV（学情报表）
router.post('/:classroomId/stats/csv', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentIds } = req.body;

    const data = await prisma.classroomStudent.findMany({
      where: {
        classroomId: req.params.classroomId,
        ...(studentIds?.length ? { studentId: { in: studentIds } } : {}),
      },
      include: {
        student: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    const rows = data
      .map((cs) => {
        const msgs = cs.messages || [];
        const userMsgs = msgs.filter(m => m.role === 'user');
        const totalRounds = userMsgs.length;
        const firstMsgLen = userMsgs.length > 0 ? (userMsgs[0].content?.length || 0) : 0;
        let totalRT = 0, rtCount = 0;
        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].role === 'assistant' && i > 0 && msgs[i - 1].role === 'user') {
            const diff = (new Date(msgs[i].createdAt).getTime() - new Date(msgs[i - 1].createdAt).getTime()) / 1000;
            if (diff > 0) { totalRT += diff; rtCount++; }
          }
        }
        return { studentNo: cs.student.studentNo || '', name: cs.student.name, totalRounds, firstMsgLen, avgTime: rtCount > 0 ? Math.round(totalRT / rtCount) : 0 };
      })
      .sort((a, b) => a.studentNo.localeCompare(b.studentNo, undefined, { numeric: true }));

    const statsData = {
      exportedAt: new Date().toISOString(),
      headers: ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'],
      rows: rows.map(r => [r.studentNo || '-', r.name, r.totalRounds, r.firstMsgLen, r.avgTime]),
    };

    const csv = generateStatsCsv(statsData);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=stats-${req.params.classroomId.slice(0, 8)}-${readableTimestamp()}.csv`);
    res.send(csv);
  } catch (error: unknown) {
    console.error('[Export] stats CSV error:', error);
    res.status(500).json({ error: '导出失败: ' + errorMessage(error) });
  }
});

// 数据库备份（含附件）
router.post('/backup', async (req, res) => {
  try {
    const dbPath = getDbPath();
    const chatDir = getUploadsChatDir();
    const backupDir = getBackupDir();

    const timestamp = readableTimestamp();
    const backupPath = path.join(backupDir, `classnode-backup-${timestamp}.classbak`);

    const { ZipArchive } = _require('archiver');
    const archive = new ZipArchive();
    const writeStream = fs.createWriteStream(backupPath);
    archive.pipe(writeStream);

    // 添加数据库
    archive.file(dbPath, { name: 'data.db' });

    // 添加附件目录（支持 chat、avatars 和 logos，不备份 temp）
    if (fs.existsSync(chatDir) && fs.readdirSync(chatDir).length > 0) {
      archive.directory(chatDir, 'chat');
    }
    const avatarsDir = path.join(getUploadsDir(), 'avatars');
    if (fs.existsSync(avatarsDir) && fs.readdirSync(avatarsDir).length > 0) {
      archive.directory(avatarsDir, 'avatars');
    }
    const logosDir = path.join(getUploadsDir(), 'logos');
    if (fs.existsSync(logosDir) && fs.readdirSync(logosDir).length > 0) {
      archive.directory(logosDir, 'logos');
    }

    // 添加加密密钥文件（确保恢复后 API Key 可解密）
    const keyDir = process.env.CLASSNODE_DATA_DIR
      ? path.resolve(process.env.CLASSNODE_DATA_DIR)
      : path.resolve(__dirname, '../..');
    const keyFile = path.join(keyDir, '.encryption.key');
    if (fs.existsSync(keyFile)) {
      archive.file(keyFile, { name: '.encryption.key' });
    }

    await archive.finalize();
    await new Promise<void>((resolve, reject) => {
      writeStream.on('close', resolve);
      writeStream.on('error', reject);
    });

    // 计算文件哈希并写入 meta 信息
    const hash = crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex');
    fs.writeFileSync(backupPath + '.meta', JSON.stringify({ source: 'local', hash }));

    res.json({
      success: true,
      path: backupPath,
      size: fs.statSync(backupPath).size,
    });
  } catch (error: unknown) {
    console.error('[Backup] 创建失败:', errorMessage(error));
    res.status(500).json({ error: '备份失败: ' + errorMessage(error) });
  }
});

// 获取备份列表
router.get('/backups', async (req, res) => {
  try {
    const backupDir = getBackupDir();

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('classnode-backup-') && (f.endsWith('.classbak') || f.endsWith('.classdb') || f.endsWith('.db')))
      .map(f => {
        const metaPath = path.join(backupDir, f + '.meta');
        let source: string = 'local';
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            source = meta.source || 'local';
          } catch {}
        }
        // 从文件名解析时间，比 birthtime 更可靠
        const match = f.match(/^classnode-backup-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.(classbak|classdb|db)$/);
        const createdAt = match
          ? new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`).toISOString()
          : fs.statSync(path.join(backupDir, f)).birthtime.toISOString();
        return {
          name: f,
          path: path.join(backupDir, f),
          size: fs.statSync(path.join(backupDir, f)).size,
          createdAt,
          source,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: '获取备份列表失败' });
  }
});

// 删除备份文件
router.delete('/backup/:name', async (req, res) => {
  try {
    const backupDir = getBackupDir();
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    fs.unlinkSync(filePath);
    // 清理关联的 meta 文件
    const metaPath = filePath + '.meta';
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除备份失败' });
  }
});

// 从备份恢复数据库（兼容 .classbak 和旧版 .classdb）
router.post('/restore/:name', async (req, res) => {
  let safetyBackupPath: string | null = null;
  let dbPathForRollback: string | null = null;
  try {
    const dbPath = getDbPath();
    dbPathForRollback = dbPath;
    const backupDir = getBackupDir();
    const prisma: PrismaClient = req.app.get('prisma');
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    const isLegacy = name.endsWith('.classdb') || name.endsWith('.db');
    let candidateDbPath = filePath;

    if (isLegacy) {
      // 旧版 .classdb：直接复制数据库
      const header = fs.readFileSync(filePath, { encoding: 'binary' }).slice(0, 16);
      if (header !== 'SQLite format 3\0') {
        return res.status(400).json({ error: '备份文件格式无效' });
      }
    } else {
      // 新版 .classbak：解压后恢复数据库和附件
      const tmpDir = path.join(backupDir, `extract-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const AdmZip = _require('adm-zip');
      const zip = new AdmZip(filePath);
      safeExtractZip(zip, tmpDir, {
        maxFiles: 5000,
        maxTotalBytes: 1024 * 1024 * 1024,
        maxSingleFileBytes: 500 * 1024 * 1024,
      });

      // 恢复数据库
      const dataFile = path.join(tmpDir, 'data.db');
      if (!fs.existsSync(dataFile)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return res.status(400).json({ error: '备份文件不包含数据库' });
      }
      const dbHeader = fs.readFileSync(dataFile, { encoding: 'binary' }).slice(0, 16);
      if (dbHeader !== 'SQLite format 3\0') {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return res.status(400).json({ error: '备份中的数据库文件无效' });
      }
      candidateDbPath = dataFile;

      await validateClassNodeDatabase(candidateDbPath);
      safetyBackupPath = await createDatabaseSafetySnapshot(prisma, backupDir);
      await prisma.$disconnect();
      fs.copyFileSync(candidateDbPath, dbPath);

      // 恢复附件（chat + logos）
      for (const sub of ['chat', 'avatars', 'logos']) {
        const srcDir = path.join(tmpDir, sub);
        const dstDir = path.join(getUploadsDir(), sub);
        if (fs.existsSync(srcDir) && fs.readdirSync(srcDir).length > 0) {
          if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
          for (const f of fs.readdirSync(srcDir)) {
            fs.cpSync(path.join(srcDir, f), path.join(dstDir, f), { recursive: true, force: true });
          }
        }
      }

      // 恢复加密密钥文件
      const keyFileRestore = path.join(tmpDir, '.encryption.key');
      if (fs.existsSync(keyFileRestore)) {
        const keyDir = process.env.CLASSNODE_DATA_DIR
          ? path.resolve(process.env.CLASSNODE_DATA_DIR)
          : path.resolve(__dirname, '../..');
        const keyFile = path.join(keyDir, '.encryption.key');
        fs.copyFileSync(keyFileRestore, keyFile);
        reloadEncryptionKey();
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });

    }

    if (isLegacy) {
      await validateClassNodeDatabase(candidateDbPath);
      safetyBackupPath = await createDatabaseSafetySnapshot(prisma, backupDir);
      await prisma.$disconnect();
      fs.copyFileSync(candidateDbPath, dbPath);
    }

    // 清除可能存在的旧 WAL/SHM 文件，避免干扰
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    // 3. 尝试同步数据库结构（不同版本间新增表/字段自动补齐，静默处理）
    try {
      const { execFileSync } = await import('child_process');
      const prismaCli = path.join(__dirname, '../../node_modules/prisma/build/index.js');
      if (fs.existsSync(prismaCli)) {
        execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
          cwd: path.join(__dirname, '../..'),
          stdio: 'ignore',
          timeout: 30000,
          env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
        });
      } else {
        throw new Error('Prisma CLI 不可用');
      }
    } catch (error) {
      throw new Error(`恢复后的数据库无法安全同步: ${error instanceof Error ? error.message : String(error)}`);
    }

    await prisma.$connect();

    res.json({ success: true, restoredFrom: name, safetyBackup: safetyBackupPath ? path.basename(safetyBackupPath) : null });
  } catch (error) {
    console.error('[Restore] error:', error);
    if (safetyBackupPath && dbPathForRollback && fs.existsSync(safetyBackupPath)) {
      try {
        const prisma: PrismaClient = req.app.get('prisma');
        await prisma.$disconnect();
        fs.copyFileSync(safetyBackupPath, dbPathForRollback);
        await prisma.$connect();
        console.warn('[Restore] 恢复失败，已自动回滚到操作前数据库');
      } catch (rollbackError) {
        console.error('[Restore] 自动回滚失败:', rollbackError);
      }
    }
    res.status(500).json({ error: '恢复失败: ' + (error instanceof Error ? error.message : '未知错误') });
  }
});

// 下载备份文件（用于跨设备迁移）
router.get('/backup/:name/download', async (req, res) => {
  try {
    const backupDir = getBackupDir();
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    res.download(filePath, name);
  } catch (error) {
    res.status(500).json({ error: '下载备份失败' });
  }
});

// 打包下载上传文件（chat 目录，用于跨设备迁移）
router.get('/backup/uploads-chat', async (req, res) => {
  try {
    const { ZipArchive } = _require('archiver');
    const uploadsDir = process.env.CLASSNODE_DATA_DIR
      ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'chat')
      : path.join(__dirname, '../../uploads', 'chat');

    if (!fs.existsSync(uploadsDir) || fs.readdirSync(uploadsDir).length === 0) {
      return res.status(404).json({ error: '暂无上传文件' });
    }

    const archive = new ZipArchive();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=classnode-uploads-chat-${readableTimestamp()}.classchat`);
    archive.pipe(res);
    archive.directory(uploadsDir, 'chat');
    await archive.finalize();
  } catch (error: unknown) {
    console.error('[UploadsChat] 打包失败:', errorMessage(error));
    res.status(500).json({ error: '打包下载失败: ' + errorMessage(error) });
  }
});

// 导入附件包（解压 zip 到 uploads/chat 目录）
const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, getBackupDir()),
    filename: (_req, _file, cb) => cb(null, `chat-upload-${Date.now()}.zip`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.zip' || ext === '.classchat');
  },
});

router.post('/backup/uploads-chat/import', chatUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未选择文件' });

    const uploadsChatDir = process.env.CLASSNODE_DATA_DIR
      ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'chat')
      : path.join(__dirname, '../../uploads', 'chat');

    const AdmZip = _require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const tmpDir = path.join(getBackupDir(), `chat-extract-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    safeExtractZip(zip, tmpDir, {
      maxFiles: 2000,
      maxTotalBytes: 300 * 1024 * 1024,
      maxSingleFileBytes: 25 * 1024 * 1024,
    });
    const sourceDir = fs.existsSync(path.join(tmpDir, 'chat')) ? path.join(tmpDir, 'chat') : tmpDir;
    fs.mkdirSync(uploadsChatDir, { recursive: true });
    for (const file of fs.readdirSync(sourceDir)) {
      const source = path.join(sourceDir, file);
      if (fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(uploadsChatDir, path.basename(file)));
    }

    fs.unlinkSync(req.file.path);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('[UploadsChat] 导入失败:', errorMessage(error));
    res.status(500).json({ error: '附件导入失败: ' + errorMessage(error) });
  }
});

// ─── 合并备份：数据库 + 附件（一键全量备份） ─────────────

function getUploadsDir(): string {
  return process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
    : path.join(__dirname, '../../uploads');
}

function getUploadsChatDir(): string {
  return process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'chat')
    : path.join(__dirname, '../../uploads', 'chat');
}


router.post('/backup/upload', backupUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    const originalName = req.file.originalname.toLowerCase();
    const isZip = originalName.endsWith('.classbak') || originalName.endsWith('.zip');
    if (isZip) {
      const AdmZip = _require('adm-zip');
      const zip = new AdmZip(req.file.path);
      const entries = zip.getEntries();
      const allowedRoot = /^(data\.db|\.encryption\.key|(?:chat|avatars|logos)(?:\/|$))/;
      if (!entries.some((entry: { entryName: string }) => entry.entryName === 'data.db') || entries.some((entry: { entryName: string }) => !allowedRoot.test(String(entry.entryName).replace(/\\/g, '/')))) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '备份压缩包结构无效' });
      }
      const verifyDir = path.join(getBackupDir(), `verify-${crypto.randomUUID()}`);
      fs.mkdirSync(verifyDir, { recursive: true });
      try {
        safeExtractZip(zip, verifyDir, { maxFiles: 5000, maxTotalBytes: 1024 * 1024 * 1024, maxSingleFileBytes: 500 * 1024 * 1024 });
        const dataFile = path.join(verifyDir, 'data.db');
        if (fs.readFileSync(dataFile, { encoding: 'binary' }).slice(0, 16) !== 'SQLite format 3\0') throw new Error('数据库文件无效');
      } catch (error) {
        fs.unlinkSync(req.file.path);
        fs.rmSync(verifyDir, { recursive: true, force: true });
        return res.status(400).json({ error: '备份文件校验失败: ' + (error instanceof Error ? error.message : '格式无效') });
      }
      fs.rmSync(verifyDir, { recursive: true, force: true });
    } else {
      // 旧版 .classdb：校验 SQLite 文件头
      const headerBuf = Buffer.alloc(16);
      const fd = fs.openSync(req.file.path, 'r');
      fs.readSync(fd, headerBuf, 0, 16, 0);
      fs.closeSync(fd);
      if (headerBuf.toString('binary') !== 'SQLite format 3\0') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '文件格式无效' });
      }
    }
    // 重命名为标准格式并写入 meta 信息
    const timestamp = readableTimestamp();
    const ext = isZip ? '.classbak' : '.classdb';
    const newName = `classnode-backup-${timestamp}${ext}`;
    const newPath = path.join(path.dirname(req.file.path), newName);
    fs.renameSync(req.file.path, newPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(newPath)).digest('hex');
    fs.writeFileSync(newPath + '.meta', JSON.stringify({ source: 'imported', hash }));
    res.json({ success: true, name: newName, size: req.file.size });
  } catch (error) {
    res.status(500).json({ error: '导入备份失败' });
  }
});

// 初始化清零（删除所有数据）
router.post('/reset', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    const tables = [
      'Message', 'ClassroomStudent', 'ClassroomGroup',
      'ClassroomAgent', 'ClassroomClass', 'Interaction',
      'Student', 'Avatar', 'ClassGroup', 'Classroom', 'Class', 'Agent',
    ];

    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    // 清空上传文件（头像、聊天附件、智能体 Logo）
    const uploadsBase = process.env.CLASSNODE_DATA_DIR
      ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
      : path.join(__dirname, '../../uploads');
    for (const sub of ['avatars', 'chat', 'logos', 'temp']) {
      const dir = path.join(uploadsBase, sub);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          fs.rmSync(path.join(dir, f), { recursive: true, force: true });
        }
      }
    }

    // 清空屏蔽警告记录（保留系统屏蔽词）
    await prisma.$executeRawUnsafe(`DELETE FROM "ShieldWarning"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ShieldWord" WHERE builtin = 0`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '初始化失败' });
  }
});

export default router;
