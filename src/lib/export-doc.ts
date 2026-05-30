import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak,
} from 'docx';

function formatDate(d: string) {
  try {
    return new Date(d).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d;
  }
}

// 通用单元格创建
function cell(text: string, opts?: {
  bold?: boolean; shading?: string; width?: number; align?: any;
}) {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: 'center',
    children: [
      new Paragraph({
        alignment: opts?.align ?? AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({
            text: text ?? '',
            bold: opts?.bold ?? false,
            size: 20,
            font: { name: 'Microsoft YaHei' },
          }),
        ],
      }),
    ],
  });
}

// ========== 导出课堂对话 ==========
export async function exportConversationsDoc(data: any): Promise<Blob> {
  const children: any[] = [];

  // 封面标题
  children.push(
    new Paragraph({ spacing: { before: 600, after: 200 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: '课堂对话汇总', bold: true, size: 44, font: { name: 'Microsoft YaHei' } }),
    ]}),
    new Paragraph({ spacing: { after: 600 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: data.title || '未命名课堂', size: 28, color: '666666', font: { name: 'Microsoft YaHei' } }),
    ]}),
  );

  // 基本信息表
  const infoRows: TableRow[] = [
    new TableRow({ children: [
      cell('互动码', { bold: true, shading: 'F0F4FF', width: 2000 }),
      cell(data.code || '-', { width: 4000 }),
      cell('日期', { bold: true, shading: 'F0F4FF', width: 2000 }),
      cell(formatDate(data.createdAt), { width: 4000 }),
    ]}),
    new TableRow({ children: [
      cell('结束时间', { bold: true, shading: 'F0F4FF', width: 2000 }),
      cell(data.endedAt ? formatDate(data.endedAt) : '-', { width: 4000 }),
      cell('班级', { bold: true, shading: 'F0F4FF', width: 2000 }),
      cell((data.classes || []).join(', ') || '-', { width: 4000 }),
    ]}),
    new TableRow({ children: [
      cell('参与学生', { bold: true, shading: 'F0F4FF', width: 2000 }),
      cell(`${data.students?.length || 0} 人`, { width: 4000 }),
      cell('', { width: 2000 }),
      cell('', { width: 4000 }),
    ]}),
  ];

  children.push(
    new Paragraph({ spacing: { before: 400, after: 200 }, children: [
      new TextRun({ text: '基本信息', bold: true, size: 24, font: { name: 'Microsoft YaHei' } }),
    ]}),
    new Table({ rows: infoRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
  );

  // 每个学生的对话
  for (const student of data.students || []) {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    const nameText = `${student.name}${student.studentNo ? `（${student.studentNo}）` : ''}`;

    // 学生头部
    children.push(
      new Paragraph({ spacing: { before: 300, after: 60 }, children: [
        new TextRun({ text: nameText, bold: true, size: 28, color: '2563EB', font: { name: 'Microsoft YaHei' } }),
        new TextRun({ text: `  ·  共 ${student.totalRounds || 0} 轮交互`, size: 20, color: '888888', font: { name: 'Microsoft YaHei' } }),
      ]}),
      new Paragraph({
        spacing: { after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
        children: [],
      }),
    );

    if (!student.messages || student.messages.length === 0) {
      children.push(
        new Paragraph({ spacing: { before: 100, after: 100 }, children: [
          new TextRun({ text: '（暂无对话记录）', size: 20, color: 'AAAAAA', font: { name: 'Microsoft YaHei' }, italics: true }),
        ]}),
      );
    } else {
      for (const msg of student.messages) {
        const isUser = msg.role === 'user';
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 40 },
            indent: { left: isUser ? 600 : 0 },
            children: [
              new TextRun({
                text: isUser ? `${student.name}：` : 'AI 助手：',
                bold: true,
                size: 20,
                color: isUser ? '2563EB' : '7C3AED',
                font: { name: 'Microsoft YaHei' },
              }),
              new TextRun({
                text: msg.time ? `  ${formatDate(msg.time)}` : '',
                size: 16,
                color: 'AAAAAA',
                font: { name: 'Microsoft YaHei' },
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            indent: { left: isUser ? 600 : 0 },
            children: [
              new TextRun({
                text: msg.content || '',
                size: 20,
                font: { name: 'Microsoft YaHei' },
              }),
            ],
          }),
        );
      }
    }
  }

  // 页脚
  children.push(
    new Paragraph({ spacing: { before: 600 }, children: [new PageBreak()] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `— 文档由 ClassNode 自动生成 —`, size: 18, color: '999999', font: { name: 'Microsoft YaHei' } }),
    ]}),
  );

  const doc = new Document({
    title: `对话汇总-${data.code || ''}`,
    description: '课堂对话记录',
    styles: { paragraphStyles: [], default: {} },
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}

// ========== 导出学情报表 ==========
export async function exportStatsDoc(data: any): Promise<Blob> {
  const children: any[] = [];

  // 封面标题
  children.push(
    new Paragraph({ spacing: { before: 600, after: 100 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: '学情报表', bold: true, size: 44, font: { name: 'Microsoft YaHei' } }),
    ]}),
    new Paragraph({ spacing: { after: 400 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `导出时间：${formatDate(data.exportedAt || new Date().toISOString())}`, size: 20, color: '888888', font: { name: 'Microsoft YaHei' } }),
    ]}),
  );

  // 表头定义
  const headers = data.headers || ['姓名', '学号', '互动次数', '首问字数', '平均响应时间(秒)', '总Token消耗'];
  const widths = [2000, 1600, 1600, 1600, 2000, 1800];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h: string, i: number) => {
      return new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
        verticalAlign: 'center',
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60 },
            children: [
              new TextRun({ text: h, bold: true, size: 20, color: '2563EB', font: { name: 'Microsoft YaHei' } }),
            ],
          }),
        ],
      });
    }),
  });

  const dataRows = (data.rows || []).map((row: any[]) => {
    return new TableRow({
      children: row.map((val: any, i: number) => {
        const text = val != null ? String(val) : '-';
        return new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          verticalAlign: 'center',
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 40 },
              children: [
                new TextRun({ text, size: 20, font: { name: 'Microsoft YaHei' } }),
              ],
            }),
          ],
        });
      }),
    });
  });

  children.push(
    new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );

  // 页脚
  children.push(
    new Paragraph({ spacing: { before: 600 }, children: [new PageBreak()] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `— 文档由 ClassNode 自动生成 —`, size: 18, color: '999999', font: { name: 'Microsoft YaHei' } }),
    ]}),
  );

  const doc = new Document({
    title: '学情报表',
    description: '课堂学情统计数据',
    styles: { paragraphStyles: [], default: {} },
    sections: [{ children }],
  });

  return await Packer.toBlob(doc);
}
