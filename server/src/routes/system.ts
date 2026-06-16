import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const uploadsBase = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
  : path.join(__dirname, '../../uploads');

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** 获取文件大小，不存在返回 0 */
function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** 从 svgContent 中提取上传头像的 href 路径 */
function extractHref(svgContent: string): string | null {
  const match = svgContent.match(/href="(\/uploads\/avatars\/[^"]+)"/);
  return match ? match[1] : null;
}

router.get('/storage-stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    // ── 1. 头像上传文件（不含纯 SVG）────────────────
    // 查出所有使用了上传图片的头像记录
    const allAvatars = await prisma.avatar.findMany({
      select: { id: true, svgContent: true, source: true, category: true },
    });

    let teacherCount = 0, teacherSize = 0;
    let studentCount = 0, studentSize = 0;
    let classIconCount = 0, classIconSize = 0;

    for (const av of allAvatars) {
      const href = extractHref(av.svgContent);
      if (!href) continue; // 纯 SVG，不计

      const absPath = path.join(uploadsBase, '..', removeLeadingSlash(href));
      const size = getFileSize(absPath);

      if (av.category === 'class') {
        classIconCount++;
        classIconSize += size;
      } else if (av.source === 'student') {
        studentCount++;
        studentSize += size;
      } else {
        teacherCount++;
        teacherSize += size;
      }
    }

    // ── 2. 智能体 Logo ─────────────────────────────
    const agents = await prisma.agent.findMany({
      select: { id: true, logo: true },
    });

    let logoCount = 0, logoSize = 0;
    for (const agent of agents) {
      if (!agent.logo) continue;
      // logo 可能是本地路径或 URL
      let absPath: string;
      if (agent.logo.startsWith('/uploads/')) {
        absPath = path.join(uploadsBase, '..', removeLeadingSlash(agent.logo));
      } else if (agent.logo.startsWith('http')) {
        continue; // URL 不计
      } else {
        absPath = agent.logo;
      }
      const size = getFileSize(absPath);
      if (size > 0) {
        logoCount++;
        logoSize += size;
      }
    }

    // ── 3. 智能体使用热度 ──────────────────────────
    const allAgents = await prisma.agent.findMany({
      select: { id: true, name: true, platform: true },
      orderBy: { createdAt: 'desc' },
    });

    const classroomAgentLinks = await prisma.classroomAgent.findMany({
      select: { agentId: true, classroomId: true },
    });
    const agentMessages = await prisma.message.findMany({
      where: { agentId: { not: null } },
      select: { agentId: true, content: true },
    });

    // 按 agent 分组统计
    const agentUsageMap: Record<string, { classroomIds: Set<string>; totalCalls: number; totalChars: number }> = {};
    for (const link of classroomAgentLinks) {
      if (!agentUsageMap[link.agentId]) {
        agentUsageMap[link.agentId] = { classroomIds: new Set(), totalCalls: 0, totalChars: 0 };
      }
      agentUsageMap[link.agentId].classroomIds.add(link.classroomId);
    }
    for (const msg of agentMessages) {
      if (!msg.agentId) continue;
      if (!agentUsageMap[msg.agentId]) {
        agentUsageMap[msg.agentId] = { classroomIds: new Set(), totalCalls: 0, totalChars: 0 };
      }
      agentUsageMap[msg.agentId].totalCalls++;
      agentUsageMap[msg.agentId].totalChars += msg.content.length;
    }

    const agentUsage = allAgents.map(a => {
      const stats = agentUsageMap[a.id];
      return {
        id: a.id,
        name: a.name,
        platform: a.platform,
        classroomCount: stats ? stats.classroomIds.size : 0,
        totalCalls: stats ? stats.totalCalls : 0,
        totalChars: stats ? stats.totalChars : 0,
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls);

    // ── 4. 课堂附件 ────────────────────────────────
    const classrooms = await prisma.classroom.findMany({
      select: {
        id: true,
        title: true,
        status: true,
        interactions: {
          select: { id: true, totalRounds: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 批量获取所有消息的 fileUrls
    const allMessages = await prisma.message.findMany({
      select: {
        classroomId: true,
        fileUrls: true,
      },
    });

    // 按 classroom 分组统计当前存在的附件文件
    const chatDir = path.join(uploadsBase, 'chat');
    const classroomAttachments: Record<string, Set<string>> = {};

    for (const msg of allMessages) {
      if (!msg.fileUrls) continue;
      let urls: string[];
      try {
        urls = JSON.parse(msg.fileUrls);
      } catch {
        continue;
      }
      for (const url of urls) {
        if (!classroomAttachments[msg.classroomId]) {
          classroomAttachments[msg.classroomId] = new Set();
        }
        classroomAttachments[msg.classroomId].add(url);
      }
    }

    let totalAttachmentCount = 0;
    let totalAttachmentSize = 0;
    const attachmentCache = new Map<string, number>(); // url -> size

    function getAttachmentSize(url: string): number {
      if (attachmentCache.has(url)) return attachmentCache.get(url)!;
      const fileName = url.replace('/uploads/chat/', '');
      const absPath = path.join(chatDir, fileName);
      const size = getFileSize(absPath);
      attachmentCache.set(url, size);
      return size;
    }

    const classroomList: {
      id: string;
      title: string | null;
      status: string;
      interactionCount: number;
      totalRounds: number;
      attachmentCount: number;
      totalSize: number;
      totalSizeText: string;
    }[] = [];

    for (const cr of classrooms) {
      const urls = classroomAttachments[cr.id];
      if (!urls || urls.size === 0) {
        classroomList.push({
          id: cr.id,
          title: cr.title,
          status: cr.status,
          interactionCount: cr.interactions.length,
          totalRounds: cr.interactions.reduce((sum, i) => sum + (i.totalRounds || 0), 0),
          attachmentCount: 0,
          totalSize: 0,
          totalSizeText: '0 B',
        });
        continue;
      }

      let size = 0;
      for (const url of urls) {
        size += getAttachmentSize(url);
      }
      totalAttachmentCount += urls.size;
      totalAttachmentSize += size;

      classroomList.push({
        id: cr.id,
        title: cr.title,
        status: cr.status,
        interactionCount: cr.interactions.length,
        totalRounds: cr.interactions.reduce((sum, i) => sum + (i.totalRounds || 0), 0),
        attachmentCount: urls.size,
        totalSize: size,
        totalSizeText: formatBytes(size),
      });
    }

    classroomList.sort((a, b) => b.attachmentCount - a.attachmentCount);

    res.json({
      avatars: {
        teacher: { count: teacherCount, totalSize: teacherSize, totalSizeText: formatBytes(teacherSize) },
        student: { count: studentCount, totalSize: studentSize, totalSizeText: formatBytes(studentSize) },
      },
      classIcons: {
        count: classIconCount, totalSize: classIconSize, totalSizeText: formatBytes(classIconSize),
      },
      agentLogos: {
        count: logoCount, totalSize: logoSize, totalSizeText: formatBytes(logoSize),
      },
      classroomAttachments: {
        totalCount: totalAttachmentCount,
        totalSize: totalAttachmentSize,
        totalSizeText: formatBytes(totalAttachmentSize),
        classrooms: classroomList,
      },
      agentUsage,
    });
  } catch (error) {
    console.error('[system/storage-stats] Error:', error);
    res.status(500).json({ error: '获取存储统计失败' });
  }
});

function removeLeadingSlash(p: string): string {
  return p.startsWith('/') ? p.slice(1) : p;
}

export default router;
