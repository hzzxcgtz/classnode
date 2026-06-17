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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

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
      teacherNotifications: teacherNotifs.map((n: Prisma.TeacherNotificationGetPayload<{}>) => ({
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
            ...cs.messages.map((m: Prisma.MessageGetPayload<{}>) => ({
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

// 导出学情报表 — 从消息记录实时计算
router.get('/:classroomId/stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    const classroomStudents = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.classroomId },
      include: {
        student: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

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
    res.setHeader('Content-Disposition', `attachment; filename=stats-${req.params.classroomId}.json`);
    res.json(report);
  } catch (error) {
    console.error('[Export] stats error:', error);
    res.status(500).json({ error: '导出报表失败' });
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
  } catch (error: any) {
    console.error('[Backup] 创建失败:', error?.message || error);
    res.status(500).json({ error: '备份失败: ' + (error?.message || '未知错误') });
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
  try {
    const dbPath = getDbPath();
    const backupDir = getBackupDir();
    const name = path.basename(req.params.name);
    const filePath = path.join(backupDir, name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    const isLegacy = name.endsWith('.classdb') || name.endsWith('.db');

    if (isLegacy) {
      // 旧版 .classdb：直接复制数据库
      const header = fs.readFileSync(filePath, { encoding: 'binary' }).slice(0, 16);
      if (header !== 'SQLite format 3\0') {
        return res.status(400).json({ error: '备份文件格式无效' });
      }
      fs.copyFileSync(filePath, dbPath);
    } else {
      // 新版 .classbak：解压后恢复数据库和附件
      const tmpDir = path.join(backupDir, `extract-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const AdmZip = _require('adm-zip');
      const zip = new AdmZip(filePath);
      zip.extractAllTo(tmpDir, true);

      // 恢复数据库
      const dataFile = path.join(tmpDir, 'data.db');
      if (!fs.existsSync(dataFile)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return res.status(400).json({ error: '备份文件不包含数据库' });
      }
      fs.copyFileSync(dataFile, dbPath);

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

      // 校验数据库结构
      try {
        const { PrismaClient } = await import('@prisma/client');
        const backupPrisma = new PrismaClient({
          datasources: { db: { url: `file:${dbPath}` } },
        });
        const tables = await backupPrisma.$queryRawUnsafe<{ name: string }[]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Classroom', 'Class', 'Agent')",
        );
        await backupPrisma.$disconnect();
        if (tables.length < 3) {
          return res.status(400).json({ error: '备份文件结构不匹配，请确认来自本系统' });
        }
      } catch {
        return res.status(400).json({ error: '备份文件无法识别' });
      }
    }

    // 清除可能存在的旧 WAL/SHM 文件，避免干扰
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    // 3. 尝试同步数据库结构（不同版本间新增表/字段自动补齐，静默处理）
    try {
      const { execSync } = await import('child_process');
      const prismaCli = path.join(__dirname, '../../../node_modules/.bin/prisma');
      if (fs.existsSync(prismaCli)) {
        execSync(`${prismaCli} db push --accept-data-loss --skip-generate`, {
          cwd: path.join(__dirname, '../..'),
          stdio: 'ignore',
          timeout: 30000,
        });
      }
    } catch {
      // prisma CLI 不可用时静默跳过，不影响恢复结果
    }

    res.json({ success: true, restoredFrom: name });
  } catch (error) {
    console.error('[Restore] error:', error);
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
  } catch (error: any) {
    console.error('[UploadsChat] 打包失败:', error?.message || error);
    res.status(500).json({ error: '打包下载失败: ' + (error?.message || '未知错误') });
  }
});

// 导入附件包（解压 zip 到 uploads/chat 目录）
const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, getBackupDir()),
    filename: (_req, _file, cb) => cb(null, `chat-upload-${Date.now()}.zip`),
  }),
});

router.post('/backup/uploads-chat/import', chatUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未选择文件' });

    const uploadsChatDir = process.env.CLASSNODE_DATA_DIR
      ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads', 'chat')
      : path.join(__dirname, '../../uploads', 'chat');

    const AdmZip = _require('adm-zip');
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(uploadsChatDir, true);

    fs.unlinkSync(req.file.path);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[UploadsChat] 导入失败:', error?.message || error);
    res.status(500).json({ error: '附件导入失败: ' + (error?.message || '未知错误') });
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
    const isZip = req.file.originalname.endsWith('.classbak') || req.file.originalname.endsWith('.zip');
    if (!isZip) {
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
