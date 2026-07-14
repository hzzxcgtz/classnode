import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak,
} from 'docx';
import type { ConversationExportReport, ExportConversationStudent, StatsExportReport } from './types';

type ExportDocChild = Paragraph | Table;
type ConversationExportMessage = ExportConversationStudent['messages'][number];

function formatDate(d: string | Date) {
  try {
    return new Date(d).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

function formatTime(t: string | Date) {
  try {
    return new Date(t).toLocaleString('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return String(t);
  }
}

const COLORS = {
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
  hr: 'D1D5DB',
};

const FONT = 'Microsoft YaHei';
const CODE_FONT = 'Consolas';

function p(text: string, opts?: {
  bold?: boolean; size?: number; color?: string; align?: typeof AlignmentType[keyof typeof AlignmentType];
  spacingBefore?: number; spacingAfter?: number;
}) {
  return new Paragraph({
    alignment: opts?.align,
    spacing: { before: opts?.spacingBefore ?? 0, after: opts?.spacingAfter ?? 0 },
    children: [
      new TextRun({
        text,
        bold: opts?.bold ?? false,
        size: opts?.size ?? 22,
        color: opts?.color ?? COLORS.text,
        font: { name: FONT },
      }),
    ],
  });
}

function cell(text: string, opts?: {
  bold?: boolean; shading?: string; width?: number; align?: typeof AlignmentType[keyof typeof AlignmentType];
  color?: string; size?: number;
}) {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: 'center',
    children: [
      new Paragraph({
        alignment: opts?.align ?? AlignmentType.LEFT,
        spacing: { before: 50, after: 50 },
        children: [
          new TextRun({
            text: text ?? '',
            bold: opts?.bold ?? false,
            size: opts?.size ?? 20,
            color: opts?.color ?? COLORS.text,
            font: { name: FONT },
          }),
        ],
      }),
    ],
  });
}

// ══════════════════════════════════════════════
//  Markdown → docx rendering
// ══════════════════════════════════════════════

interface InlineSeg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

type MdBlock =
  | { type: 'paragraph'; segs: InlineSeg[] }
  | { type: 'heading'; level: number; segs: InlineSeg[] }
  | { type: 'list-item'; ordered: boolean; index: number; segs: InlineSeg[]; indent: number }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'blockquote'; segs: InlineSeg[] }
  | { type: 'hr' }
  | { type: 'empty' };

function parseInline(text: string): InlineSeg[] {
  const segments: InlineSeg[] = [];
  const remaining = text;
  const regex = /(\$\$(.+?)\$\$|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)|\$(.+?)\$)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(remaining)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ text: remaining.slice(lastIdx, match.index) });
    }

    if (match[2] !== undefined) {
      segments.push({ text: '公式: ' + match[2], code: true });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], bold: true, italic: true });
    } else if (match[4] !== undefined) {
      segments.push({ text: match[4], bold: true });
    } else if (match[5] !== undefined) {
      segments.push({ text: match[5], code: true });
    } else if (match[6] !== undefined) {
      segments.push({ text: match[6], italic: true });
    } else if (match[7] !== undefined) {
      segments.push({ text: match[7] + '（' + match[8] + '）' });
    } else if (match[9] !== undefined) {
      segments.push({ text: match[9], code: true });
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < remaining.length) {
    segments.push({ text: remaining.slice(lastIdx) });
  }

  return segments.length > 0 ? segments : [{ text }];
}

function segsToRuns(segs: InlineSeg[], opts?: {
  size?: number; color?: string; font?: string;
}): TextRun[] {
  return segs.map(s => {
    if (s.code) {
      return new TextRun({
        text: s.text,
        size: opts?.size ?? 20,
        color: 'DC2626',
        font: { name: CODE_FONT },
        bold: false,
      });
    }
    return new TextRun({
      text: s.text,
      size: opts?.size ?? 20,
      color: opts?.color ?? COLORS.text,
      font: { name: opts?.font || FONT },
      bold: s.bold ?? false,
      italics: s.italic ?? false,
    });
  });
}

function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const rawLines = text.split('\n');
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    if (/^```/.test(line)) {
      if (inFence) {
        blocks.push({ type: 'code', lang: fenceLang, lines: fenceLines });
        fenceLines = [];
        inFence = false;
        fenceLang = '';
      } else {
        inFence = true;
        fenceLang = line.slice(3).trim();
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    // $$...$$ 块级数学公式
    if (/^\$\$/.test(line)) {
      const formulaLines: string[] = [];
      if (line.trim() === '$$') {
        i++;
        while (i < rawLines.length && !/^\$\$/.test(rawLines[i])) {
          formulaLines.push(rawLines[i]);
          i++;
        }
      } else {
        formulaLines.push(line.replace(/^\$\$/, '').replace(/\$\$$/, '').trim());
      }
      if (formulaLines.length > 0) {
        blocks.push({ type: 'code', lang: 'math', lines: formulaLines });
      }
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      blocks.push({ type: 'empty' });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        segs: parseInline(headingMatch[2]),
      });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      blocks.push({
        type: 'blockquote',
        segs: parseInline(trimmed.slice(2)),
      });
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      blocks.push({
        type: 'list-item',
        ordered: false,
        index: 0,
        indent: 1,
        segs: parseInline(ulMatch[1]),
      });
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      blocks.push({
        type: 'list-item',
        ordered: true,
        index: parseInt(olMatch[1], 10),
        indent: 1,
        segs: parseInline(olMatch[2]),
      });
      continue;
    }

    blocks.push({
      type: 'paragraph',
      segs: parseInline(trimmed),
    });
  }

  if (inFence) {
    blocks.push({ type: 'code', lang: fenceLang, lines: fenceLines });
  }

  return blocks;
}

function blockToParagraphs(block: MdBlock, opts?: {
  size?: number; color?: string; shading?: string;
}): Paragraph[] {
  const sz = opts?.size ?? 20;
  const color = opts?.color ?? COLORS.text;
  const bg = opts?.shading;
  const indentLeft = 400;
  const indentRight = 200;

  function mkPara(config: Exclude<ConstructorParameters<typeof Paragraph>[0], string>) {
    const shade = config.shading || (bg ? { fill: bg, type: ShadingType.CLEAR } : undefined);
    return new Paragraph({
      alignment: config.alignment,
      spacing: config.spacing,
      indent: config.indent,
      border: config.border,
      shading: shade,
      children: config.children,
    });
  }

  switch (block.type) {
    case 'paragraph':
      return [mkPara({
        spacing: { before: 40, after: 40 },
        indent: { left: indentLeft, right: indentRight },
        children: segsToRuns(block.segs, { size: sz, color }),
      })];

    case 'heading':
      return [mkPara({
        spacing: { before: 120, after: 60 },
        indent: { left: indentLeft, right: indentRight },
        children: segsToRuns(block.segs, {
          size: block.level === 1 ? 32 : block.level === 2 ? 28 : 24,
          color: COLORS.primary,
        }),
      })];

    case 'list-item': {
      const marker = block.ordered ? String(block.index) + '.' : '•';
      return [mkPara({
        spacing: { before: 20, after: 20 },
        indent: { left: indentLeft + block.indent * 300, hanging: 300 },
        children: [
          new TextRun({ text: marker + '  ', size: sz, color: COLORS.text, font: { name: FONT } }),
          ...segsToRuns(block.segs, { size: sz, color }),
        ],
      })];
    }

    case 'code':
      return block.lines.length > 0
        ? block.lines.map(line => new Paragraph({
            spacing: { before: 0, after: 0 },
            indent: { left: indentLeft + 200, right: indentRight },
            shading: { fill: COLORS.codeBg, type: ShadingType.CLEAR },
            children: [new TextRun({
              text: line || ' ',
              size: 17,
              color: '374151',
              font: { name: CODE_FONT },
            })],
          }))
        : [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '' })] })];

    case 'blockquote':
      return [mkPara({
        spacing: { before: 40, after: 40 },
        indent: { left: indentLeft + 200, right: indentRight },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border } },
        children: segsToRuns(block.segs, { size: sz, color: COLORS.textSecondary }),
      })];

    case 'hr':
      return [new Paragraph({
        spacing: { before: 100, after: 100 },
        indent: { left: indentLeft, right: indentRight },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.hr } },
        children: [],
      })];

    case 'empty':
      return [new Paragraph({
        spacing: { before: 0, after: 0 }, children: [], indent: { left: indentLeft },
      })];
  }
}

function renderMarkdown(text: string, opts?: {
  size?: number; color?: string; shading?: string;
}): Paragraph[] {
  if (!text) {
    return [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '' })] })];
  }
  const blocks = parseMarkdown(text);
  return blocks.flatMap(b => blockToParagraphs(b, opts));
}

// ══════════════════════════════════════════════
//  Class Overview Statistics
// ══════════════════════════════════════════════

interface StudentRankEntry {
  name: string;
  studentNo: string | null;
  rounds: number;
  msgCount: number;
  charCount: number;
}

interface ClassStats {
  totalStudents: number;
  activeStudents: number;
  totalUserMsgs: number;
  totalAiMsgs: number;
  totalMsgs: number;
  totalRounds: number;
  totalChars: number;
  avgRoundsPerStudent: number;
  avgCharsPerMsg: number;
  avgCharsPerStudent: number;
  duration: number | null;
  studentRankings: StudentRankEntry[];
}

function computeClassStats(data: ConversationExportReport): ClassStats {
  const allStudents = data.students || [];
  const totalStudents = allStudents.length;

  let totalUserMsgs = 0;
  let totalAiMsgs = 0;
  let totalRounds = 0;
  let totalChars = 0;
  let activeCount = 0;

  const rankings: StudentRankEntry[] = [];

  for (const student of allStudents) {
    const msgs = student.messages || [];
    let sUserMsgs = 0;
    let sAiMsgs = 0;
    let sChars = 0;

    for (const m of msgs) {
      if (m.role === 'user') sUserMsgs++;
      else sAiMsgs++;
      sChars += (m.content ? m.content.length : 0);
    }

    totalUserMsgs += sUserMsgs;
    totalAiMsgs += sAiMsgs;
    const sRounds = student.totalRounds || Math.ceil((sUserMsgs + sAiMsgs) / 2);
    totalRounds += sRounds;
    totalChars += sChars;

    if (msgs.length > 0) activeCount++;

    rankings.push({
      name: student.name,
      studentNo: student.studentNo || null,
      rounds: sRounds,
      msgCount: msgs.length,
      charCount: sChars,
    });
  }

  let duration: number | null = null;
  if (data.createdAt && data.endedAt) {
    duration = Math.round(
      (new Date(data.endedAt).getTime() - new Date(data.createdAt).getTime()) / 60000
    );
  }

  rankings.sort((a, b) => b.msgCount - a.msgCount);

  const totalMsgs = totalUserMsgs + totalAiMsgs;

  return {
    totalStudents,
    activeStudents: activeCount,
    totalUserMsgs,
    totalAiMsgs,
    totalMsgs,
    totalRounds,
    totalChars,
    avgRoundsPerStudent: totalStudents > 0 ? Math.round((totalRounds / totalStudents) * 10) / 10 : 0,
    avgCharsPerMsg: totalMsgs > 0 ? Math.round(totalChars / totalMsgs) : 0,
    avgCharsPerStudent: totalStudents > 0 ? Math.round(totalChars / totalStudents) : 0,
    duration,
    studentRankings: rankings,
  };
}

function renderClassOverview(children: ExportDocChild[], stats: ClassStats): void {
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(
    new Paragraph({ spacing: { before: 200, after: 100 }, children: [
      new TextRun({ text: '课堂概览', bold: true, size: 32, color: COLORS.primary, font: { name: FONT } }),
    ]}),
  );

  // Helper: build a stat card cell
  function statCell(value: string, label: string, color: string, bg: string): TableCell {
    return new TableCell({
      width: { size: 3000, type: WidthType.DXA },
      shading: { fill: bg, type: ShadingType.CLEAR },
      verticalAlign: 'center',
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({ text: value, bold: true, size: 26, color: color, font: { name: FONT } }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 80 },
          children: [
            new TextRun({ text: label, size: 17, color: COLORS.textSecondary, font: { name: FONT } }),
          ],
        }),
      ],
    });
  }

  function statRow(cells: TableCell[]): TableRow {
    return new TableRow({ children: cells });
  }

  // Row 1
  const r1 = [
    statCell(String(stats.activeStudents) + ' / ' + String(stats.totalStudents) + ' 人', '参与学生', '0891B2', 'ECFEFF'),
    statCell(String(stats.totalMsgs) + ' 条', '总消息数', '8B5CF6', 'F5F3FF'),
    statCell(String(stats.totalRounds) + ' 轮', '总交互轮数', 'DB2777', 'FDF2F8'),

  ];

  // Row 2
  const avgMsgLenLabel = stats.avgCharsPerMsg > 0 ? String(stats.avgCharsPerMsg) + ' 字' : '—';
  const totalCharsStr = stats.totalChars > 0
    ? (stats.totalChars >= 10000
      ? (stats.totalChars / 10000).toFixed(1) + '万字'
      : String(stats.totalChars) + ' 字')
    : '—';
  const durationStr = stats.duration !== null ? String(stats.duration) + ' 分钟' : '—';

  const r2 = [
    statCell(String(stats.avgRoundsPerStudent), '平均每人轮数', '059669', 'D1FAE5'),
    statCell(avgMsgLenLabel, '平均消息长度', '2563EB', 'DBEAFE'),
    statCell(totalCharsStr, '总文字量', '7C3AED', 'EDE9FE'),
    statCell(durationStr, '课堂时长', 'DC2626', 'FEF2F2'),
  ];

  children.push(
    new Table({
      rows: [statRow(r1), statRow(r2)],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );

  // Messages breakdown
  if (stats.totalMsgs > 0) {
    const userPct = Math.round((stats.totalUserMsgs / stats.totalMsgs) * 100);
    const aiPct = 100 - userPct;

    children.push(
      new Paragraph({ spacing: { before: 300, after: 80 }, children: [
        new TextRun({ text: '消息构成', bold: true, size: 24, color: COLORS.primary, font: { name: FONT } }),
      ]}),
    );

    children.push(
      new Table({
        rows: [
          new TableRow({ children: [
            cell('学生消息', { bold: true, shading: COLORS.primaryLight, width: 3000 }),
            cell(String(stats.totalUserMsgs) + ' 条', { width: 3000 }),
            cell('占比', { bold: true, shading: COLORS.primaryLight, width: 3000 }),
            cell(String(userPct) + '%', { width: 3000 }),
          ]}),
          new TableRow({ children: [
            cell('AI 回复', { bold: true, shading: COLORS.accentLight, width: 3000, color: COLORS.accent }),
            cell(String(stats.totalAiMsgs) + ' 条', { width: 3000 }),
            cell('占比', { bold: true, shading: COLORS.accentLight, width: 3000, color: COLORS.accent }),
            cell(String(aiPct) + '%', { width: 3000 }),
          ]}),
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    );
  }

  // Student ranking table
  if (stats.studentRankings.length > 0) {
    children.push(
      new Paragraph({ spacing: { before: 300, after: 80 }, children: [
        new TextRun({ text: '学生活跃度排行', bold: true, size: 24, color: COLORS.primary, font: { name: FONT } }),
      ]}),
    );

    const rankHeaders = ['排名', '姓名', '学号', '交互轮数', '消息数', '总字数'];
    const rankWidths = [1200, 2000, 1600, 1800, 1600, 2200];

    const hdrRow = new TableRow({
      tableHeader: true,
      children: rankHeaders.map((h, i) => new TableCell({
        width: { size: rankWidths[i], type: WidthType.DXA },
        shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR },
        verticalAlign: 'center',
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: h, bold: true, size: 18, color: COLORS.primary, font: { name: FONT } })],
        })],
      })),
    });

    const actualDataRows = stats.studentRankings.map((s, i) => {
      const isEven = i % 2 === 0;
      const rankStr = '#' + String(i + 1);
      const charsStr = s.charCount > 0 ? String(s.charCount) : '-';
      const values = [rankStr, s.name, s.studentNo || '-', String(s.rounds), String(s.msgCount), charsStr];
      return new TableRow({
        children: values.map((val, ci) => new TableCell({
          width: { size: rankWidths[ci], type: WidthType.DXA },
          shading: isEven ? { fill: COLORS.white, type: ShadingType.CLEAR } : { fill: COLORS.bgLight, type: ShadingType.CLEAR },
          verticalAlign: 'center',
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 40 },
            children: [new TextRun({
              text: val,
              size: 18,
              color: COLORS.text,
              font: { name: FONT },
              bold: i < 3 && ci === 0,
            })],
          })],
        })),
      });
    });

    children.push(
      new Table({ rows: [hdrRow, ...actualDataRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
    );
  }
}

// ══════════════════════════════════════════════
//  Conversation export
// ══════════════════════════════════════════════

export async function exportConversationsDoc(data: ConversationExportReport): Promise<Blob> {
  const children: ExportDocChild[] = [];

  // Cover Page
  children.push(
    new Paragraph({ spacing: { before: 2000 }, children: [] }),
    p('课堂对话记录', { bold: true, size: 52, color: COLORS.primary, align: AlignmentType.CENTER, spacingAfter: 100 }),
    p(data.title || '未命名课堂', { size: 28, color: COLORS.textSecondary, align: AlignmentType.CENTER, spacingAfter: 600 }),
  );

  const coverRows: TableRow[] = [
    new TableRow({ children: [
      cell('互动码', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(data.code || '-', { width: 4000 }),
      cell('课堂模式', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(data.mode === 'advanced' ? '高级模式' : '标准模式', { width: 4000 }),
    ]}),
    new TableRow({ children: [
      cell('开始时间', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(formatDate(data.createdAt), { width: 4000 }),
      cell('结束时间', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(data.endedAt ? formatDate(data.endedAt) : '-', { width: 4000 }),
    ]}),
    new TableRow({ children: [
      cell('参与班级', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell((data.classes || []).join('、') || '-', { width: 4000 }),
      cell('参与学生', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(String(data.students?.length || 0) + ' 人', { width: 4000 }),
    ]}),
  ];

  if (data.agents && data.agents.length > 0) {
    const agentNames = data.agents.map((agent) => agent.name).join('、');
    coverRows.push(new TableRow({ children: [
      cell('AI 智能体', { bold: true, shading: COLORS.primaryLight, width: 2000, color: COLORS.primary }),
      cell(agentNames, { width: 4000 }),
      cell('', { width: 2000 }),
      cell('', { width: 4000 }),
    ]}));
  }

  children.push(
    new Table({ rows: coverRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
    new Paragraph({ spacing: { before: 400 }, children: [] }),
    p('— 文档由 ClassNode 自动生成 —', { size: 18, color: COLORS.textLight, align: AlignmentType.CENTER }),
  );

  // Class overview statistics page
  const stats = computeClassStats(data);
  renderClassOverview(children, stats);

  // Student sections
  for (const student of (data.students || [])) {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    const studentLabel = student.name + (student.studentNo ? '（' + student.studentNo + '）' : '');
    const totalMsgs = student.messages ? student.messages.length : 0;
    const totalRounds = student.totalRounds || Math.ceil(totalMsgs / 2);

    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR },
        indent: { left: 200 },
        children: [
          new TextRun({ text: studentLabel, bold: true, size: 28, color: COLORS.primary, font: { name: FONT } }),
          new TextRun({ text: '  |  共 ' + String(totalRounds) + ' 轮  ·  ' + String(totalMsgs) + ' 条消息', size: 20, color: COLORS.textSecondary, font: { name: FONT } }),
        ],
      }),
      new Paragraph({
        spacing: { after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.primary } },
        children: [],
      }),
    );

    if (!student.messages || student.messages.length === 0) {
      children.push(
        new Paragraph({ spacing: { before: 100, after: 100 }, alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: '（该学生暂无对话记录）', size: 20, color: COLORS.textLight, font: { name: FONT }, italics: true }),
        ]}),
      );
      continue;
    }

    let lastRound: number | null = null;
    for (const msg of student.messages) {
      const msgRound = msg.roundIndex != null ? msg.roundIndex : null;

      if (msgRound !== null && msgRound !== lastRound) {
        children.push(
          new Paragraph({
            spacing: { before: lastRound === null ? 200 : 300, after: 80 },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.accent } },
            indent: { left: 200 },
            children: [
              new TextRun({ text: '第 ' + String(msgRound) + ' 轮', bold: true, size: 22, color: COLORS.accent, font: { name: FONT } }),
            ],
          }),
        );
        lastRound = msgRound;
      }

      renderMessage(children, msg, student);
    }
  }

  // Footer
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ spacing: { before: 3000 }, children: [] }));
  children.push(p('— 文档由 ClassNode 自动生成 —', { size: 18, color: COLORS.textLight, align: AlignmentType.CENTER }));
  children.push(p('导出时间：' + formatDate(new Date().toISOString()), { size: 16, color: COLORS.textLight, align: AlignmentType.CENTER }));

  const doc = new Document({
    title: '对话记录-' + (data.code || ''),
    description: '课堂对话记录',
    creator: 'ClassNode',
    styles: { paragraphStyles: [], default: {} },
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}

function renderMessage(children: ExportDocChild[], msg: ConversationExportMessage, student: ExportConversationStudent) {
  // 教师通知：特殊样式（金色标签 + 灰底）
  if (msg.role === 'teacher-notification') {
    const timeStr = msg.time ? '  ' + formatTime(msg.time) : '';
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 10 },
        indent: { left: 400 },
        children: [
          new TextRun({ text: '📢 教师通知', bold: true, size: 17, color: '92400E', font: { name: FONT } }),
          new TextRun({ text: timeStr, size: 16, color: COLORS.textLight, font: { name: FONT } }),
        ],
      }),
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 400 },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'F59E0B' } },
        shading: { fill: 'FFFBEB', type: ShadingType.CLEAR },
        children: [
          new TextRun({ text: msg.content || '', size: 19, color: '1F2937', font: { name: FONT } }),
        ],
      }),
    );
    return;
  }

  const isUser = msg.role === 'user';
  const roleColor = isUser ? COLORS.primary : COLORS.accent;
  const roleLabel = isUser ? student.name : (msg.agentName || 'AI 助手');
  const timeStr = msg.time ? '  ' + formatTime(msg.time) : '';

  children.push(
    new Paragraph({
      spacing: { before: 100, after: 20 },
      indent: { left: 400 },
      children: [
        new TextRun({ text: roleLabel, bold: true, size: 18, color: roleColor, font: { name: FONT } }),
        new TextRun({ text: timeStr, size: 16, color: COLORS.textLight, font: { name: FONT } }),

      ],
    }),
  );

  const bgColor = isUser ? COLORS.primaryLight : COLORS.accentLight;
  const contentParas = renderMarkdown(msg.content || '', { size: 20, shading: bgColor });
  children.push(...contentParas);

  if (msg.fileUrls && msg.fileUrls.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        indent: { left: 400 },
        children: [
          new TextRun({
            text: '[附件] ' + (msg.fileNames || msg.fileUrls).join('、'),
            size: 17,
            color: COLORS.textSecondary,
            font: { name: FONT },
            italics: true,
          }),
        ],
      }),
    );
  }
}

// ══════════════════════════════════════════════
//  Stats export
// ══════════════════════════════════════════════

export async function exportStatsDoc(data: StatsExportReport): Promise<Blob> {
  const children: ExportDocChild[] = [];

  children.push(
    new Paragraph({ spacing: { before: 1500 }, children: [] }),
    p('学情统计报表', { bold: true, size: 48, color: COLORS.primary, align: AlignmentType.CENTER, spacingAfter: 60 }),
    p('导出时间：' + formatDate(data.exportedAt || new Date().toISOString()), { size: 20, color: COLORS.textSecondary, align: AlignmentType.CENTER, spacingAfter: 500 }),
  );

  if (data.rows && data.rows.length > 0) {
    const totalStudents = data.rows.length;
    const totalInteractions = data.rows.reduce((sum, row) => sum + (Number(row[2]) || 0), 0);
    const summaryRows: TableRow[] = [
      new TableRow({ children: [
        cell('学生总数', { bold: true, shading: COLORS.greenLight, width: 3000, color: COLORS.green, align: AlignmentType.CENTER }),
        cell(String(totalStudents) + ' 人', { width: 3000, align: AlignmentType.CENTER }),
        cell('总交互轮数', { bold: true, shading: COLORS.greenLight, width: 3000, color: COLORS.green, align: AlignmentType.CENTER }),
        cell(String(totalInteractions) + ' 轮', { width: 3000, align: AlignmentType.CENTER }),
      ]}),
    ];

    children.push(
      new Paragraph({ spacing: { before: 100, after: 120 }, children: [
        new TextRun({ text: '数据概览', bold: true, size: 24, color: COLORS.primary, font: { name: FONT } }),
      ]}),
      new Table({ rows: summaryRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
    );
  }

  children.push(
    new Paragraph({ spacing: { before: 400, after: 120 }, children: [
      new TextRun({ text: '详细数据', bold: true, size: 24, color: COLORS.primary, font: { name: FONT } }),
    ]}),
  );

  const headers = data.headers || ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'];
  const colWidths = calcColWidths(headers, data.rows || []);

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h: string, i: number) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR },
      verticalAlign: 'center',
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 80 },
        children: [new TextRun({ text: h, bold: true, size: 20, color: COLORS.primary, font: { name: FONT } })],
      })],
    })),
  });

  const dataRows = (data.rows || []).map((row, rowIdx: number) => {
    const isEven = rowIdx % 2 === 0;
    return new TableRow({
      children: row.map((value, colIdx: number) => {
        const text = value != null ? String(value) : '-';
        return new TableCell({
          width: { size: colWidths[colIdx], type: WidthType.DXA },
          shading: isEven ? { fill: COLORS.white, type: ShadingType.CLEAR } : { fill: COLORS.bgLight, type: ShadingType.CLEAR },
          verticalAlign: 'center',
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 50, after: 50 },
            children: [new TextRun({ text, size: 20, color: COLORS.text, font: { name: FONT }, bold: colIdx === 0 })],
          })],
        });
      }),
    });
  });

  children.push(
    new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
  );

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ spacing: { before: 3000 }, children: [] }));
  children.push(p('— 文档由 ClassNode 自动生成 —', { size: 18, color: COLORS.textLight, align: AlignmentType.CENTER }));
  children.push(p('导出时间：' + formatDate(data.exportedAt || new Date().toISOString()), { size: 16, color: COLORS.textLight, align: AlignmentType.CENTER }));

  const doc = new Document({
    title: '学情报表',
    description: '课堂学情统计数据',
    creator: 'ClassNode',
    styles: { paragraphStyles: [], default: {} },
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}

function calcColWidths(headers: string[], rows: Array<Array<string | number>>): number[] {
  const totalWidth = 12000;
  const minWidth = 1200;

  const maxLens = headers.map((h, i) => {
    let maxLen = h.length;
    for (const row of rows) {
      const val = row[i] != null ? String(row[i]).length : 1;
      if (val > maxLen) maxLen = val;
    }
    return maxLen;
  });

  const totalLen = maxLens.reduce((s, l) => s + l, 0);
  if (totalLen === 0) return headers.map(() => Math.floor(totalWidth / headers.length));

  const widths = maxLens.map(l => Math.max(minWidth, Math.floor((l / totalLen) * totalWidth)));
  const currentSum = widths.reduce((s, w) => s + w, 0);
  if (currentSum !== totalWidth) {
    widths[widths.length - 1] += (totalWidth - currentSum);
  }

  return widths;
}

/**
 * 导出单条 AI 消息为 Word 文档
 * @param content AI 回答的 Markdown 内容
 * @param agentName 智能体名称
 * @param timestamp 消息时间戳
 */
export function exportMessageToWord(content: string, agentName: string, timestamp?: string) {
  const blocks = parseMarkdown(content);
  const children: (Paragraph | Table)[] = [];

  // 标题：AI 回答
  children.push(
    new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [
        new TextRun({ text: 'AI 回答', bold: true, size: 28, color: COLORS.primary, font: { name: FONT } }),
      ],
    }),
  );

  // 元信息：智能体 + 时间
  const metaParts = [`智能体：${agentName}`];
  if (timestamp) metaParts.push(`时间：${timestamp}`);
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [
        new TextRun({ text: metaParts.join('    '), size: 18, color: COLORS.textSecondary, font: { name: FONT } }),
      ],
    }),
  );

  // 分割线
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border } },
      children: [],
    }),
  );

  // 渲染 Markdown 内容
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          children: segsToRuns(block.segs, { size: 22 }),
        }));
        break;
      case 'heading':
        children.push(new Paragraph({
          spacing: { before: 200, after: 80 },
          children: segsToRuns(block.segs, { size: block.level === 1 ? 28 : block.level === 2 ? 26 : 24, color: COLORS.primary }),
        }));
        break;
      case 'list-item':
        children.push(new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: block.indent * 400 + 400 },
          children: [
            new TextRun({
              text: block.ordered ? `${block.index}. ` : '• ',
              size: 22,
              color: COLORS.text,
              font: { name: FONT },
            }),
            ...segsToRuns(block.segs, { size: 22 }),
          ],
        }));
        break;
      case 'code': {
        const codeText = block.lines.join('\n');
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 40 },
            indent: { left: 200 },
            shading: { fill: COLORS.codeBg, type: ShadingType.CLEAR },
            children: [
              new TextRun({ text: codeText, size: 18, font: { name: CODE_FONT }, color: COLORS.text }),
            ],
          }),
        );
        break;
      }
      case 'blockquote':
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 400 },
          shading: { fill: COLORS.bgLight, type: ShadingType.CLEAR },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary } },
          children: segsToRuns(block.segs, { size: 20, color: COLORS.textSecondary }),
        }));
        break;
      case 'hr':
        children.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.hr } },
          children: [],
        }));
        break;
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: COLORS.text },
        },
      },
    },
    sections: [{ children }],
  });

  const fileName = `${agentName}-回答-${timestamp || Date.now()}.docx`;

  Packer.toBlob(doc).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  });
}
