/**
 * 课堂数据导出服务
 * 服务端生成 DOCX / CSV，支持进度回调（Socket）和分批处理
 * 依赖 docx 包（ESM，v9+）
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, Header, Footer,
  PageNumber, PageBreak, ImageRun,
} from 'docx';
import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 类型定义 ───────────────────────────────────────────────

export interface ExportProgress {
  taskId: string;
  progress: number;   // 0-100
  stage: string;      // 当前阶段描述
}

export type ProgressCallback = (p: ExportProgress) => void;

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  title: string;
  stats: { totalStudents: number; totalMsgs: number; totalRounds: number };
}

// ─── 常量 ───────────────────────────────────────────────────


// ─── 类型别名 ────────────────────────────────────────────────

type DocBlock = Paragraph | Table;
const FONT = 'Microsoft YaHei';
const CODE_FONT = 'Consolas';

const C = {
  primary: '1E40AF',
  primaryLight: 'DBEAFE',
  accent: '7C3AED',
  accentLight: 'EDE9FE',
  text: '1F2937',
  textSecondary: '6B7280',
  textLight: '9CA3AF',
  border: 'E5E7EB',
  bgLight: 'F9FAFB',
  white: 'FFFFFF',
  green: '059669',
  greenLight: 'D1FAE5',
  codeBg: 'F3F4F6',
  gold: 'D97706',
  goldLight: 'FFFBEB',
  goldBorder: 'F59E0B',
  red: 'DC2626',
  redLight: 'FEF2F2',
  hr: 'D1D5DB',
};

const INDENT = { left: 400, right: 200 };
const INDENT_SM = { left: 400 };


function resolveFilePath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  const fileName = path.basename(fileUrl);
  // 优先从 CLASSNODE_DATA_DIR 加载（生产模式）
  const dataDir = process.env.CLASSNODE_DATA_DIR;
  if (dataDir) {
    const p = path.join(dataDir, 'uploads', 'chat', fileName);
    if (fs.existsSync(p)) return p;
    const p2 = path.join(dataDir, 'uploads', fileName);
    if (fs.existsSync(p2)) return p2;
  }
  // 开发模式：文件存储在 server/uploads/ 下
  const localDir = path.join(__dirname, '../../uploads');
  const p3 = path.join(localDir, 'chat', fileName);
  if (fs.existsSync(p3)) return p3;
  const p4 = path.join(localDir, fileName);
  if (fs.existsSync(p4)) return p4;
  return null;
}

// ─── 工具函数 ────────────────────────────────────────────────

function fmtDate(d: string | Date) {
  try { return new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d); }
}
function fmtDateShort(d: string | Date) {
  try { return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d); }
}
function fmtTime(t: string | Date) {
  try { return new Date(t).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(t); }
}

// ─── Markdown 解析（与前端版本一致，优化内存） ─────────────

interface InlineSeg { text: string; bold?: boolean; italic?: boolean; code?: boolean; }

type MdBlock =
  | { type: 'paragraph'; segs: InlineSeg[] }
  | { type: 'heading'; level: number; segs: InlineSeg[] }
  | { type: 'list-item'; ordered: boolean; index: number; segs: InlineSeg[]; indent: number }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'blockquote'; segs: InlineSeg[] }
  | { type: 'hr' }
  | { type: 'empty' };

function parseInline(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) segs.push({ text: m[2], bold: true, italic: true });
    else if (m[3] !== undefined) segs.push({ text: m[3], bold: true });
    else if (m[5] !== undefined) segs.push({ text: m[5], italic: true });
    else if (m[4] !== undefined) segs.push({ text: m[4], code: true });
    else if (m[6] !== undefined) segs.push({ text: m[6] + '（' + m[7] + '）' });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs.length > 0 ? segs : [{ text }];
}

function segsToRuns(segs: InlineSeg[], opts?: { size?: number; color?: string; font?: string }): TextRun[] {
  return segs.map(s => {
    if (s.code) return new TextRun({ text: s.text, size: opts?.size ?? 20, color: 'DC2626', font: { name: CODE_FONT } });
    return new TextRun({ text: s.text, size: opts?.size ?? 20, color: opts?.color ?? C.text, font: { name: opts?.font || FONT }, bold: s.bold, italics: s.italic });
  });
}

function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = text.split('\n');
  let inFence = false, fenceLang = '', fenceLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (inFence) { blocks.push({ type: 'code', lang: fenceLang, lines: fenceLines }); fenceLines = []; inFence = false; fenceLang = ''; }
      else { inFence = true; fenceLang = line.slice(3).trim(); }
      continue;
    }
    if (inFence) { fenceLines.push(line); continue; }
    const t = line.trim();
    if (t === '') { blocks.push({ type: 'empty' }); continue; }
    const h = t.match(/^(#{1,6})\s+(.+)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, segs: parseInline(h[2]) }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ type: 'hr' }); continue; }
    if (t.startsWith('> ')) { blocks.push({ type: 'blockquote', segs: parseInline(t.slice(2)) }); continue; }
    const ul = t.match(/^[-*+]\s+(.+)$/);
    if (ul) { blocks.push({ type: 'list-item', ordered: false, index: 0, indent: 1, segs: parseInline(ul[1]) }); continue; }
    const ol = t.match(/^(\d+)\.\s+(.+)$/);
    if (ol) { blocks.push({ type: 'list-item', ordered: true, index: parseInt(ol[1], 10), indent: 1, segs: parseInline(ol[2]) }); continue; }
    blocks.push({ type: 'paragraph', segs: parseInline(t) });
  }
  if (inFence) blocks.push({ type: 'code', lang: fenceLang, lines: fenceLines });
  return blocks;
}

function mdToParagraphs(text: string, opts?: { size?: number; color?: string; shading?: string }): DocBlock[] {
  if (!text) return [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '' })] })];
  const sz = opts?.size ?? 20;
  const color = opts?.color ?? C.text;
  const bg = opts?.shading;
  const blocks = parseMarkdown(text);
  const result: Paragraph[] = [];

  function mkPara(cfg: { spacing?: any; indent?: any; border?: any; shading?: any; children: any[]; alignment?: any }) {
    const shade = cfg.shading || (bg ? { fill: bg, type: ShadingType.CLEAR } : undefined);
    return new Paragraph({ alignment: cfg.alignment, spacing: cfg.spacing, indent: cfg.indent, border: cfg.border, shading: shade, children: cfg.children });
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        result.push(mkPara({ spacing: { before: 30, after: 30 }, indent: { ...INDENT_SM, right: 200 }, children: segsToRuns(block.segs, { size: sz, color }) }));
        break;
      case 'heading':
        result.push(mkPara({ spacing: { before: 100, after: 50 }, indent: INDENT_SM, children: segsToRuns(block.segs, { size: block.level === 1 ? 30 : block.level === 2 ? 26 : 22, color: C.primary }) }));
        break;
      case 'list-item': {
        const marker = block.ordered ? String(block.index) + '.' : '•';
        result.push(mkPara({ spacing: { before: 15, after: 15 }, indent: { left: 400 + block.indent * 300, hanging: 300 }, children: [new TextRun({ text: marker + '  ', size: sz, color: C.text, font: { name: FONT } }), ...segsToRuns(block.segs, { size: sz, color })] }));
        break;
      }
      case 'code':
        for (const line of block.lines) {
          result.push(new Paragraph({ spacing: { before: 0, after: 0 }, indent: { left: 600, right: 200 }, shading: { fill: C.codeBg, type: ShadingType.CLEAR }, children: [new TextRun({ text: line || ' ', size: 16, color: '374151', font: { name: CODE_FONT } })] }));
        }
        break;
      case 'blockquote':
        result.push(mkPara({ spacing: { before: 30, after: 30 }, indent: { left: 600, right: 200 }, border: { left: { style: BorderStyle.SINGLE, size: 6, color: C.border } }, children: segsToRuns(block.segs, { size: sz, color: C.textSecondary }) }));
        break;
      case 'hr':
        result.push(new Paragraph({ spacing: { before: 80, after: 80 }, indent: INDENT_SM, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.hr } }, children: [] }));
        break;
      case 'empty':
        result.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }));
        break;
    }
  }
  return result;
}

/**
 * 从图片 Buffer 中读取实际宽高（像素），用于等比例缩放
 * 支持 PNG / JPEG / GIF / BMP / WebP
 */
function getImageDimensions(buf: Buffer, ext: string): { w: number; h: number } | null {
  try {
    switch (ext) {
      case 'png': {
        if (buf.length < 24) return null;
        // PNG IHDR chunk: offset 16 = width (4B BE), 20 = height (4B BE), preceded by IHDR tag at 12
        if (buf.readUInt32BE(12) !== 0x49484452) return null;
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      }
      case 'jpg':
      case 'jpeg': {
        // 扫描 JPEG 段找到 SOF0/SOF1/SOF2 标记获取尺寸
        let off = 2;
        while (off < buf.length - 1) {
          if (buf[off] !== 0xFF) break;
          const marker = buf[off + 1];
          if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) };
          }
          const segLen = buf.readUInt16BE(off + 2);
          if (segLen < 2) break;
          off += 2 + segLen;
        }
        return null;
      }
      case 'gif': {
        if (buf.length < 10) return null;
        return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
      }
      case 'bmp': {
        if (buf.length < 26) return null;
        return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
      }
      case 'webp': {
        // WebP 文件头 (RIFF): offset 24 = width&height in VP8/VP8L format
        if (buf.length < 30) return null;
        const riff = buf.slice(0, 4).toString();
        if (riff !== 'RIFF') return null;
        const format = buf.slice(8, 12).toString();
        if (format === 'WEBP') {
          const vp8 = buf.slice(12, 16).toString();
          if (vp8 === 'VP8 ' || vp8 === 'VP8X') {
            // VP8 lossy: offset 26, packed 14-bit values
            const w = buf.readUInt16LE(26) & 0x3FFF;
            const h = buf.readUInt16LE(28) & 0x3FFF;
            if (w && h) return { w, h };
          }
          if (vp8 === 'VP8L') {
            // VP8L lossless: offset 21, packed 14-bit values (little-endian bitfields)
            const bits = buf.readUInt32LE(21);
            const w = (bits & 0x3FFF) + 1;
            const h = ((bits >>> 14) & 0x3FFF) + 1;
            if (w && h) return { w, h };
          }
        }
        return null;
      }
      default:
        return null;
    }
  } catch { return null; }
}

/**
 * 从文件头魔数检测实际图片格式，不依赖扩展名
 * 只返回 DOCX ImageRun 支持的类型（png/jpg/gif/bmp），
 * 不支持的返回 null
 */
function detectImageType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'bmp';
  // WebP (RIFF....WEBP) 等不支持的格式
  return null;
}

/** 计算等比例缩放后的 EMU 尺寸，maxWidthEmu / maxHeightEmu 限制最大值 */
function scaleImageSize(imgWidth: number, imgHeight: number, maxPx = 400, maxHeightPx = 400): { width: number; height: number } {
  if (imgWidth <= 0 || imgHeight <= 0) return { width: maxPx, height: maxHeightPx };
  const scale = Math.min(maxPx / imgWidth, maxHeightPx / imgHeight, 1);
  return {
    width: Math.round(imgWidth * scale),
    height: Math.round(imgHeight * scale),
  };
}

// ─── DOCX 辅助 ───────────────────────────────────────────────

function pText(text: string, opts?: { bold?: boolean; size?: number; color?: string; align?: typeof AlignmentType[keyof typeof AlignmentType]; spacingBefore?: number; spacingAfter?: number }) {
  return new Paragraph({ alignment: opts?.align, spacing: { before: opts?.spacingBefore ?? 0, after: opts?.spacingAfter ?? 0 }, children: [new TextRun({ text, bold: opts?.bold ?? false, size: opts?.size ?? 22, color: opts?.color ?? C.text, font: { name: FONT } })] });
}

function cell(text: string, opts?: { bold?: boolean; shading?: string; width?: number; align?: typeof AlignmentType[keyof typeof AlignmentType]; color?: string; size?: number }) {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: 'center',
    children: [new Paragraph({ alignment: opts?.align ?? AlignmentType.LEFT, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: text ?? '', bold: opts?.bold ?? false, size: opts?.size ?? 20, color: opts?.color ?? C.text, font: { name: FONT } })] })],
  });
}

function emptyPara() {
  return new Paragraph({ spacing: { before: 0, after: 0 }, children: [] });
}

// ─── 统计计算 ────────────────────────────────────────────────

interface StudentRankEntry { name: string; studentNo: string | null; rounds: number; msgCount: number; charCount: number; }

interface ClassStats {
  totalStudents: number; activeStudents: number; totalUserMsgs: number; totalAiMsgs: number;
  totalMsgs: number; totalRounds: number; totalChars: number; avgRoundsPerStudent: number;
  avgCharsPerMsg: number; avgCharsPerStudent: number; duration: number | null;
  studentRankings: StudentRankEntry[];
}

function computeStats(data: any): ClassStats {
  const all = data.students || [];
  const total = all.length;
  let uMsgs = 0, aMsgs = 0, rounds = 0, chars = 0, active = 0;
  const rankings: StudentRankEntry[] = [];
  for (const s of all) {
    const msgs = s.messages || [];
    let su = 0, sa = 0, sc = 0;
    for (const m of msgs) {
      if (m.role === 'user') su++; else sa++;
      sc += (m.content ? m.content.length : 0);
    }
    uMsgs += su; aMsgs += sa;
    const sr = s.totalRounds || Math.ceil((su + sa) / 2);
    rounds += sr; chars += sc;
    if (msgs.length > 0) active++;
    rankings.push({ name: s.name, studentNo: s.studentNo || null, rounds: sr, msgCount: msgs.length, charCount: sc });
  }
  let dur: number | null = null;
  if (data.createdAt && data.endedAt) dur = Math.round((new Date(data.endedAt).getTime() - new Date(data.createdAt).getTime()) / 60000);
  rankings.sort((a, b) => b.msgCount - a.msgCount);
  const totalMsgs = uMsgs + aMsgs;
  return {
    totalStudents: total, activeStudents: active, totalUserMsgs: uMsgs, totalAiMsgs: aMsgs,
    totalMsgs, totalRounds: rounds, totalChars: chars,
    avgRoundsPerStudent: total > 0 ? Math.round((rounds / total) * 10) / 10 : 0,
    avgCharsPerMsg: totalMsgs > 0 ? Math.round(chars / totalMsgs) : 0,
    avgCharsPerStudent: total > 0 ? Math.round(chars / total) : 0,
    duration: dur, studentRankings: rankings,
  };
}

// ─── 页脚（含页码） ──────────────────────────────────────────

function makeFooter(title: string) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.border } },
        children: [
          new TextRun({ text: `${title}  |  `, size: 16, color: C.textLight, font: { name: FONT } }),
          new TextRun({ text: '第 ', size: 16, color: C.textLight, font: { name: FONT } }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.textLight, font: { name: FONT } }),
          new TextRun({ text: ' 页', size: 16, color: C.textLight, font: { name: FONT } }),
        ],
      }),
    ],
  });
}

// ─── 封面页 ──────────────────────────────────────────────────

function renderCover(data: any): DocBlock[] {
  const children: DocBlock[] = [];
  children.push(new Paragraph({ spacing: { before: 1500 }, children: [] }));
  children.push(pText('课堂对话记录', { bold: true, size: 48, color: C.primary, align: AlignmentType.CENTER, spacingAfter: 60 }));
  children.push(pText(data.title || '未命名课堂', { size: 26, color: C.textSecondary, align: AlignmentType.CENTER, spacingAfter: 400 }));

  const rows: TableRow[] = [
    new TableRow({ children: [cell('参与班级', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell((data.classes || []).join('、') || '-', { width: 3500 }), cell('学生人数', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell(String(data.students?.length || 0) + ' 人', { width: 3500 })] }),
    new TableRow({ children: [cell('开始时间', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell(fmtDate(data.createdAt), { width: 3500 }), cell('结束时间', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell(data.endedAt ? fmtDate(data.endedAt) : '-', { width: 3500 })] }),
    new TableRow({ children: [cell('课堂模式', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell(data.mode === 'advanced' ? '高级模式' : '标准模式', { width: 3500 }), cell('AI 智能体', { bold: true, shading: C.primaryLight, width: 2000, color: C.primary }), cell(data.agents?.length > 0 ? data.agents.map((a: any) => a.name).join('、') : '-', { width: 3500 })] }),
  ];
  children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  children.push(new Paragraph({ spacing: { before: 300 }, children: [] }));
  children.push(pText('— 文档由 ClassNode 自动生成 —', { size: 18, color: C.textLight, align: AlignmentType.CENTER }));
  return children;
}

// ─── 课堂概览页 ──────────────────────────────────────────────

function renderOverview(stats: ClassStats): DocBlock[] {
  const children: DocBlock[] = [];
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // 标题
  children.push(pText('课堂概览', { bold: true, size: 30, color: C.primary, spacingBefore: 200, spacingAfter: 80 }));

  // 统计卡片：两行
  function statCard(value: string, label: string, color: string, bg: string) {
    return new TableCell({
      width: { size: 3000, type: WidthType.DXA },
      shading: { fill: bg, type: ShadingType.CLEAR },
      verticalAlign: 'center',
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 20 }, children: [new TextRun({ text: value, bold: true, size: 24, color, font: { name: FONT } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 }, children: [new TextRun({ text: label, size: 16, color: C.textSecondary, font: { name: FONT } })] }),
      ],
    });
  }

  const r1 = [
    statCard(`${stats.activeStudents} / ${stats.totalStudents} 人`, '参与学生', '0891B2', 'ECFEFF'),
    statCard(`${stats.totalMsgs} 条`, '总消息数', '8B5CF6', 'F5F3FF'),
    statCard(`${stats.totalRounds} 轮`, '总交互轮数', 'DB2777', 'FDF2F8'),
  ];
  const avgMsgLenStr = stats.avgCharsPerMsg > 0 ? `${stats.avgCharsPerMsg} 字` : '—';
  const totalCharsStr = stats.totalChars > 0 ? (stats.totalChars >= 10000 ? `${(stats.totalChars / 10000).toFixed(1)}万字` : `${stats.totalChars} 字`) : '—';
  const r2 = [
    statCard(String(stats.avgRoundsPerStudent), '平均每人轮数', '059669', 'D1FAE5'),
    statCard(avgMsgLenStr, '平均消息长度', '2563EB', 'DBEAFE'),
    statCard(totalCharsStr, '总文字量', '7C3AED', 'EDE9FE'),
  ];

  children.push(new Table({ rows: [new TableRow({ children: r1 }), new TableRow({ children: r2 })], width: { size: 100, type: WidthType.PERCENTAGE } }));

  // 学生活跃度排行
  if (stats.studentRankings.length > 0) {
    children.push(pText('学生活跃度排行', { bold: true, size: 22, color: C.primary, spacingBefore: 250, spacingAfter: 60 }));
    const headers = ['排名', '姓名', '学号', '交互轮数', '消息数', '总字数'];
    const widths = [1200, 2000, 1600, 1800, 1600, 2200];
    const hdrRow = new TableRow({
      tableHeader: true,
      children: headers.map((h, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: C.primaryLight, type: ShadingType.CLEAR },
        verticalAlign: 'center',
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 50, after: 50 }, children: [new TextRun({ text: h, bold: true, size: 18, color: C.primary, font: { name: FONT } })] })],
      })),
    });
    const dataRows = stats.studentRankings.map((s, i) => {
      const even = i % 2 === 0;
      const vals = [`#${i + 1}`, s.name, s.studentNo || '-', String(s.rounds), String(s.msgCount), s.charCount > 0 ? String(s.charCount) : '-'];
      return new TableRow({
        children: vals.map((v, ci) => new TableCell({
          width: { size: widths[ci], type: WidthType.DXA },
          shading: even ? { fill: C.white, type: ShadingType.CLEAR } : { fill: C.bgLight, type: ShadingType.CLEAR },
          verticalAlign: 'center',
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 30, after: 30 }, children: [new TextRun({ text: v, size: 18, color: C.text, font: { name: FONT }, bold: i < 3 && ci === 0 })] })],
        })),
      });
    });
    children.push(new Table({ rows: [hdrRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  return children;
}

// ─── 学生对话渲染 ────────────────────────────────────────────

async function renderStudentMessages(student: any, agentMap: Record<string, string>, teacherNotifData: any[]): Promise<DocBlock[]> {
  const children: DocBlock[] = [];

  const label = student.name + (student.studentNo ? `（${student.studentNo}）` : '');
  const totalMsgs = student.messages ? student.messages.length : 0;
  const totalRounds = student.totalRounds || Math.ceil(totalMsgs / 2);

  // 学生标题栏
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({
    spacing: { before: 150, after: 60 },
    shading: { fill: C.primaryLight, type: ShadingType.CLEAR },
    indent: { left: 200 },
    children: [
      new TextRun({ text: label, bold: true, size: 26, color: C.primary, font: { name: FONT } }),
      new TextRun({ text: `  |  共 ${totalRounds} 轮 · ${totalMsgs} 条消息`, size: 18, color: C.textSecondary, font: { name: FONT } }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.primary } },
    children: [],
  }));

  // 合并该学生的教师通知
  const studentMsgs = [...(teacherNotifData
    .filter((n: any) => n.studentId === null || n.studentId === student.studentId)
    .map((n: any) => ({
      role: 'teacher-notification', content: n.content, time: n.createdAt,
      roundIndex: null, agentId: null, agentName: null,
    }))), ...(student.messages || [])].sort((a: any, b: any) => new Date(a.time || a.createdAt).getTime() - new Date(b.time || b.createdAt).getTime());

  if (studentMsgs.length === 0) {
    children.push(pText('（该学生暂无对话记录）', { size: 20, color: C.textLight, align: AlignmentType.CENTER, spacingBefore: 80, spacingAfter: 80 }));
    return children;
  }

  let lastRound: number | null = null;
  for (const msg of studentMsgs) {
    const roundIdx = msg.roundIndex != null ? msg.roundIndex : null;

    if (msg.role === 'user' && roundIdx !== null && roundIdx !== lastRound) {
      // 轮次分隔
      children.push(new Paragraph({
        spacing: { before: lastRound === null ? 120 : 200, after: 40 },
        indent: INDENT_SM,
        children: [
          new TextRun({ text: `第 ${roundIdx} 轮`, bold: true, size: 20, color: C.accent, font: { name: FONT }, underline: { type: 'single', color: C.accentLight } }),
        ],
      }));
      lastRound = roundIdx;
    }

    await renderSingleMessage(children, msg, student, agentMap);
  }

  return children;
}

async function renderSingleMessage(children: DocBlock[], msg: any, student: any, agentMap: Record<string, string>) {
  // 教师通知：特殊金色样式
  if (msg.role === 'teacher-notification') {
    const ts = msg.time ? `  ${fmtTime(msg.time)}` : '';
    children.push(new Paragraph({
      spacing: { before: 100, after: 5 }, indent: INDENT_SM,
      children: [
        new TextRun({ text: '📢 教师通知', bold: true, size: 16, color: C.gold, font: { name: FONT } }),
        new TextRun({ text: ts, size: 15, color: C.textLight, font: { name: FONT } }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 60 }, indent: { left: 400, right: 200 },
      border: { left: { style: BorderStyle.SINGLE, size: 6, color: C.goldBorder } },
      shading: { fill: C.goldLight, type: ShadingType.CLEAR },
      children: [new TextRun({ text: msg.content || '', size: 19, color: C.text, font: { name: FONT } })],
    }));
    return;
  }

  const isUser = msg.role === 'user';
  const roleColor = isUser ? C.primary : C.accent;
  const roleLabel = isUser ? student.name : (msg.agentName || agentMap[msg.agentId] || 'AI 助手');
  const ts = msg.time ? `  ${fmtTime(msg.time)}` : '';

  // 角色名 + 时间
  children.push(new Paragraph({
    spacing: { before: 80, after: 10 }, indent: INDENT_SM,
    children: [
      new TextRun({ text: roleLabel, bold: true, size: 17, color: roleColor, font: { name: FONT } }),
      new TextRun({ text: ts, size: 15, color: C.textLight, font: { name: FONT } }),
    ],
  }));

  // 消息内容
  const bg = isUser ? C.primaryLight : C.accentLight;
  const paras = mdToParagraphs(msg.content || '', { size: 19, shading: bg });
  children.push(...paras);

  // 附件（图片嵌入）
  if (msg.fileUrls?.length > 0) {
    const names = msg.fileNames || msg.fileUrls;
    for (let fi = 0; fi < msg.fileUrls.length; fi++) {
      const fileUrl = msg.fileUrls[fi];
      const fileName = names[fi] || fileUrl;
      // 尝试嵌入图片
      const imagePath = resolveFilePath(fileUrl);
      if (imagePath && fs.existsSync(imagePath)) {
        try {
          const imgBuf = fs.readFileSync(imagePath);
          // 从文件头检测实际格式（不依赖扩展名）
          const imgType = detectImageType(imgBuf);
          // 不支持的格式尝试用 sharp 转换（WebP → PNG）
          if (!imgType) {
            try {
              const converted = await sharp(imgBuf).png().toBuffer();
              const dim = getImageDimensions(converted, 'png');
              const MAX_PX = 400;
              const sized = dim
                ? scaleImageSize(dim.w, dim.h, MAX_PX, MAX_PX)
                : { width: MAX_PX, height: 300 };
              children.push(new Paragraph({
                spacing: { before: 40, after: 20 }, indent: INDENT_SM,
                children: [
                  new ImageRun({
                    data: converted,
                    type: 'png',
                    transformation: sized,
                  }),
                ],
              }));
            } catch {
              // 转换失败时显示文件名
              children.push(new Paragraph({
                spacing: { after: 20 }, indent: INDENT_SM,
                children: [new TextRun({ text: `[图片] ${fileName}`, size: 16, color: C.textSecondary, font: { name: FONT }, italics: true })],
              }));
            }
            continue;
          }
          // 按比例缩放图片（transformation 单位为像素，docx 库自动转 EMU）
          const dim = getImageDimensions(imgBuf, imgType);
          const MAX_PX = 400;
          const sized = dim
            ? scaleImageSize(dim.w, dim.h, MAX_PX, MAX_PX)
            : { width: MAX_PX, height: 300 };
          children.push(new Paragraph({
            spacing: { before: 40, after: 20 }, indent: INDENT_SM,
            children: [
              new ImageRun({
                data: imgBuf,
                type: imgType as 'png' | 'jpg' | 'gif' | 'bmp',
                transformation: sized,
              }),
            ],
          }));
        } catch {
          // 图片加载失败时显示文件名
          children.push(new Paragraph({
            spacing: { after: 20 }, indent: INDENT_SM,
            children: [new TextRun({ text: `[图片] ${fileName}`, size: 16, color: C.textSecondary, font: { name: FONT }, italics: true })],
          }));
        }
      } else {
        // 没有本地文件时显示文件名
        children.push(new Paragraph({
          spacing: { after: 20 }, indent: INDENT_SM,
          children: [new TextRun({ text: `[图片] ${fileName}`, size: 16, color: C.textSecondary, font: { name: FONT }, italics: true })],
        }));
      }
    }
  }
}

// ─── 学情报表 DOCX ─────────────────────────────────────────

function renderStatsDocx(data: any): DocBlock[] {
  const children: DocBlock[] = [];
  children.push(new Paragraph({ spacing: { before: 1500 }, children: [] }));
  children.push(pText('学情统计报表', { bold: true, size: 44, color: C.primary, align: AlignmentType.CENTER, spacingAfter: 40 }));
  children.push(pText(`导出时间：${fmtDate(data.exportedAt || new Date().toISOString())}`, { size: 18, color: C.textSecondary, align: AlignmentType.CENTER, spacingAfter: 400 }));

  if (data.rows?.length > 0) {
    const total = data.rows.length;
    const totalInt = data.rows.reduce((s: number, r: any[]) => s + (Number(r[2]) || 0), 0);
    children.push(pText('数据概览', { bold: true, size: 22, color: C.primary, spacingBefore: 100, spacingAfter: 80 }));
    children.push(new Table({
      rows: [new TableRow({
        children: [
          cell('学生总数', { bold: true, shading: C.greenLight, width: 3000, color: C.green, align: AlignmentType.CENTER }),
          cell(`${total} 人`, { width: 3000, align: AlignmentType.CENTER }),
          cell('总交互轮数', { bold: true, shading: C.greenLight, width: 3000, color: C.green, align: AlignmentType.CENTER }),
          cell(`${totalInt} 轮`, { width: 3000, align: AlignmentType.CENTER }),
        ],
      })],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  children.push(pText('详细数据', { bold: true, size: 22, color: C.primary, spacingBefore: 300, spacingAfter: 80 }));
  const headers = data.headers || ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'];
  const colWidths = calcColWidths(headers, data.rows || [], 11000);
  const hdrRow = new TableRow({
    tableHeader: true,
    children: headers.map((h: string, i: number) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: C.primaryLight, type: ShadingType.CLEAR },
      verticalAlign: 'center',
      children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: h, bold: true, size: 18, color: C.primary, font: { name: FONT } })] })],
    })),
  });
  const dataRows = (data.rows || []).map((row: any[], ri: number) => {
    const even = ri % 2 === 0;
    return new TableRow({
      children: row.map((val: any, ci: number) => {
        const t = val != null ? String(val) : '-';
        return new TableCell({
          width: { size: colWidths[ci], type: WidthType.DXA },
          shading: even ? { fill: C.white, type: ShadingType.CLEAR } : { fill: C.bgLight, type: ShadingType.CLEAR },
          verticalAlign: 'center',
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: t, size: 18, color: C.text, font: { name: FONT }, bold: ci === 0 })] })],
        });
      }),
    });
  });
  children.push(new Table({ rows: [hdrRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));

  // 尾部
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ spacing: { before: 2000 }, children: [] }));
  children.push(pText('— 文档由 ClassNode 自动生成 —', { size: 18, color: C.textLight, align: AlignmentType.CENTER }));
  children.push(pText(`导出时间：${fmtDate(data.exportedAt || new Date().toISOString())}`, { size: 16, color: C.textLight, align: AlignmentType.CENTER }));

  return children;
}

function calcColWidths(headers: string[], rows: any[][], totalWidth = 11000): number[] {
  const minW = 1000;
  const maxLens = headers.map((h, i) => {
    let ml = h.length;
    for (const row of rows) {
      const v = row[i] != null ? String(row[i]).length : 1;
      if (v > ml) ml = v;
    }
    return ml;
  });
  const total = maxLens.reduce((s, l) => s + l, 0);
  if (total === 0) return headers.map(() => Math.floor(totalWidth / headers.length));
  const ws = maxLens.map(l => Math.max(minW, Math.floor((l / total) * totalWidth)));
  const sum = ws.reduce((s, w) => s + w, 0);
  if (sum !== totalWidth) ws[ws.length - 1] += (totalWidth - sum);
  return ws;
}

// ─── CSV 生成 ────────────────────────────────────────────────

export function generateStatsCsv(data: any): string {
  const headers = data.headers || ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'];
  const rows = data.rows || [];
  let csv = '﻿';
  csv += headers.join(',') + '\n';
  for (const row of rows) {
    csv += row.map((v: any) => {
      const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
      return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',') + '\n';
  }
  return csv;
}

// ─── 数据获取与组装 ──────────────────────────────────────────

interface FetchOptions {
  studentIds?: string[];
}

async function fetchConversationData(classroomId: string, prisma: PrismaClient, opts?: FetchOptions) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    include: {
      classes: { include: { class: true } },
      classroomAgents: { include: { agent: true } },
    },
  });
  if (!classroom) throw new Error('课堂不存在');

  const rawStudents = await prisma.classroomStudent.findMany({
    where: {
      classroomId,
      ...(opts?.studentIds?.length ? { studentId: { in: opts.studentIds } } : {}),
    },
    include: {
      student: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { joinTime: 'asc' },
  });
  const classroomStudents = classroom.mode === 'standard'
    ? rawStudents.filter(cs => cs.student.tag !== '__group__')
    : rawStudents;

  const teacherNotifs = await prisma.teacherNotification.findMany({
    where: { classroomId },
    orderBy: { createdAt: 'asc' },
  });

  const agentMap: Record<string, string> = {};
  for (const ca of classroom.classroomAgents) {
    agentMap[ca.agent.id] = ca.agent.name;
  }

  return {
    title: classroom.title || '课堂对话汇总',
    code: classroom.code,
    mode: classroom.mode,
    createdAt: classroom.createdAt,
    endedAt: classroom.endedAt,
    classes: classroom.classes.map((cc: any) => cc.class.name),
    agents: classroom.classroomAgents.map((ca: any) => ({ id: ca.agent.id, name: ca.agent.name, platform: ca.agent.platform })),
    teacherNotifications: teacherNotifs.map((n: any) => ({ content: n.content, time: n.createdAt, targetStudentId: n.studentId })),
    students: classroomStudents.map((cs: any) => ({
      name: cs.student.name,
      studentNo: cs.student.studentNo,
      gender: cs.student.gender,
      studentId: cs.student.id,
      totalRounds: cs.totalRounds,
      messages: cs.messages.map((m: any) => ({
        role: m.role, content: m.content, time: m.createdAt, roundIndex: m.roundIndex,
        agentId: m.agentId, agentName: m.agentId ? (agentMap[m.agentId] || null) : null,
        fileUrls: m.fileUrls ? (() => { try { return JSON.parse(m.fileUrls); } catch { return undefined; } })() : undefined,
        fileNames: m.fileNames ? (() => { try { return JSON.parse(m.fileNames); } catch { return undefined; } })() : undefined,
      })),
    })),
  };
}

async function fetchStatsData(classroomId: string, prisma: PrismaClient, opts?: FetchOptions) {
  const rawStudents = await prisma.classroomStudent.findMany({
    where: {
      classroomId,
      ...(opts?.studentIds?.length ? { studentId: { in: opts.studentIds } } : {}),
    },
    include: {
      student: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  const cr = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { mode: true },
  });
  const classroomStudents = cr?.mode === 'standard'
    ? rawStudents.filter(cs => cs.student.tag !== '__group__')
    : rawStudents;

  const rows = classroomStudents
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
      return { studentNo: cs.student.studentNo || '', name: cs.student.name, gender: cs.student.gender, totalRounds, firstMsgLen, avgTime: rtCount > 0 ? Math.round(totalRT / rtCount) : 0 };
    })
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo, undefined, { numeric: true }));

  return {
    title: '学情报表',
    exportedAt: new Date().toISOString(),
    headers: ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'],
    rows: rows.map(r => [r.studentNo || '-', r.name, r.totalRounds, r.firstMsgLen, r.avgTime]),
  };
}

// ─── 主生成函数 ──────────────────────────────────────────────

export async function generateConversationsDocx(
  classroomId: string,
  prisma: PrismaClient,
  onProgress?: ProgressCallback,
  opts?: FetchOptions,
): Promise<ExportResult> {
  const progress = onProgress || (() => {});

  progress({ taskId: '', progress: 2, stage: '正在获取课堂信息...' });
  const data = await fetchConversationData(classroomId, prisma, opts);

  progress({ taskId: '', progress: 15, stage: '正在统计课堂数据...' });
  const stats = computeStats(data);

  progress({ taskId: '', progress: 20, stage: '正在生成封面和概览...' });

  const allChildren: DocBlock[] = [];

  // 封面
  allChildren.push(...renderCover(data));

  // 概览
  allChildren.push(...renderOverview(stats));

  // 学生对话
  const totalStudents = data.students.length;
  for (let i = 0; i < totalStudents; i++) {
    const student = data.students[i];
    const pct = 35 + Math.round(55 * ((i + 1) / totalStudents));
    progress({ taskId: '', progress: pct, stage: `正在渲染学生对话（${i + 1}/${totalStudents}）：${student.name}` });
    const msgs = await renderStudentMessages(student, data.agents.reduce((acc: Record<string, string>, a: any) => { acc[a.id] = a.name; return acc; }, {}), data.teacherNotifications || []);
    allChildren.push(...msgs);
  }

  // 尾部
  progress({ taskId: '', progress: 92, stage: '正在生成文档尾部...' });
  allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  allChildren.push(new Paragraph({ spacing: { before: 2000 }, children: [] }));
  allChildren.push(pText('— 文档由 ClassNode 自动生成 —', { size: 18, color: C.textLight, align: AlignmentType.CENTER }));
  allChildren.push(pText(`导出时间：${fmtDate(new Date().toISOString())}`, { size: 16, color: C.textLight, align: AlignmentType.CENTER }));

  progress({ taskId: '', progress: 95, stage: '正在打包文档...' });

  const doc = new Document({
    title: `对话记录-${data.code}`,
    description: '课堂对话记录',
    creator: 'ClassNode',
    styles: { paragraphStyles: [], default: {} },
    sections: [{
      children: allChildren,
      footers: { default: makeFooter(data.title || '课堂对话记录') },
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  progress({ taskId: '', progress: 100, stage: '导出完成' });

  return {
    buffer,
    filename: `对话记录-${data.code || classroomId.slice(0, 8)}.docx`,
    title: data.title || '课堂对话记录',
    stats: {
      totalStudents: stats.totalStudents,
      totalMsgs: stats.totalMsgs,
      totalRounds: stats.totalRounds,
    },
  };
}

export async function generateStatsDocx(
  classroomId: string,
  prisma: PrismaClient,
  onProgress?: ProgressCallback,
  opts?: FetchOptions,
): Promise<ExportResult> {
  const progress = onProgress || (() => {});

  progress({ taskId: '', progress: 5, stage: '正在获取统计数据...' });
  const data = await fetchStatsData(classroomId, prisma, opts);

  progress({ taskId: '', progress: 30, stage: '正在生成报表...' });
  const children = renderStatsDocx(data);

  progress({ taskId: '', progress: 90, stage: '正在打包文档...' });

  const doc = new Document({
    title: '学情报表',
    description: '课堂学情统计数据',
    creator: 'ClassNode',
    styles: { paragraphStyles: [], default: {} },
    sections: [{
      children,
      footers: { default: makeFooter('学情报表') },
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  progress({ taskId: '', progress: 100, stage: '导出完成' });

  return {
    buffer,
    filename: `学情报表-${classroomId.slice(0, 8)}.docx`,
    title: '学情报表',
    stats: {
      totalStudents: data.rows.length,
      totalMsgs: 0,
      totalRounds: data.rows.reduce((s: number, r: any[]) => s + (Number(r[2]) || 0), 0),
    },
  };
}

export async function generateConversationsCsv(
  classroomId: string,
  prisma: PrismaClient,
  opts?: FetchOptions,
): Promise<{ csv: string; filename: string }> {
  const data = await fetchConversationData(classroomId, prisma, opts);

  let csv = '﻿';
  // Header
  csv += '学生姓名,学号,轮次,角色,发送时间,消息内容\n';

  for (const student of data.students) {
    const notifEntries = (data.teacherNotifications || [])
      .filter((n: any) => n.studentId === null || n.studentId === student.studentId)
      .map((n: any) => ({
        round: '',
        role: '教师通知',
        time: n.time,
        content: n.content,
      }));

    const msgEntries = (student.messages || []).map((m: any) => ({
      round: m.roundIndex ?? '',
      role: m.role === 'user' ? student.name : (m.agentName || 'AI'),
      time: m.time || m.createdAt,
      content: m.content || '',
    }));

    const allEntries = [...notifEntries, ...msgEntries].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    for (const entry of allEntries) {
      const esc = (s: string) => {
        const str = String(s ?? '').replace(/[\r\n]+/g, ' ');
        return str.includes(',') || str.includes('"') ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      csv += `${esc(student.name)},${esc(student.studentNo || '')},${esc(String(entry.round))},${esc(entry.role)},${esc(fmtDate(entry.time))},${esc(entry.content)}\n`;
    }
  }

  return {
    csv,
    filename: `对话记录-${data.code || classroomId.slice(0, 8)}.csv`,
  };
}
