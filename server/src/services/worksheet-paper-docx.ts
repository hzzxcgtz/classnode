import {
  AlignmentType, BorderStyle, Document, Footer, PageNumber, Packer, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { PAPER_BLANK_TEXT } from './worksheet-questions.js';
// ★ 2026-09-30：公式画成**真 Word 公式**（OMML）。转换与「文字/公式混排成一个 children 数组」
// 都在 `worksheet-paper-math.ts`；本文件只负责把结果放进段落里。
import { inlineChildren } from './worksheet-paper-math.js';
import {
  inlineText, type PaperBlock, type PaperInline, type PaperQuestion, type PaperPromptPart, type WorksheetPaper,
} from './worksheet-paper.js';

/**
 * 「教师用卷」的**渲染层**（★ 2026-09-30，教师）。
 *
 * 🔴 本文件**只做一件事**：把 `worksheet-paper.ts` 的判据画成段落。
 *    「这道题在纸上写着什么」**一个字都不在这里决定** —— 那是判据层的事（那里有 15 条用例），
 *    因为**本文件在本机验不了**（没有 Word）。这与 `export-service.ts` / `worksheet-report.ts`
 *    的分工是同一套（那边写着同一句话）。
 * ⚠️ 想改纸上任何一句文案 —— 去 `worksheet-paper.ts`，别在这里拼字符串。
 *
 * ── 排版（教师：「精美，但不能花哨」）────────────────────────────────────────
 *   · 字体跟全仓那两份导出**同一套**（`Microsoft YaHei`，Word 里认；中文不缺字）；
 *   · 题号加粗 + 主色，题干正常字重 —— 靠**字重**分层，不靠颜色块；
 *   · 答案**缩进一行、字号小一档、灰一档**，前面「答案：」加粗（教师扫一眼能找到）；
 *   · 只用了两条线：任务标题下面一条细横线、页脚一条 —— 不加底色、不加边框、不加图标。
 *   ⚠️ 不引 `export-service.ts` 的私有助手（`pText` / `C` 都没导出）：那几个是为**另一份**
 *      文档调的，共用会让「改对话记录的配色」顺手改掉这张卷子 —— 抄常量比耦合便宜。
 *      颜色值与那边保持一致（同一套视觉语言），但这里各写一份、各自演进。
 */

/**
 * 字体：**宋体**（★ 2026-09-30 教师：「字体使用宋体」）。
 *
 * 🔴 必须同时给 `eastAsia`：docx 的 `font.name` 只写 ascii/hAnsi/cs，**中文走的是
 *    `eastAsia` 那一格** —— 只写 name 的话，中文会落到主题字体（等线/微软雅黑），
 *    而英文数字是宋体，一份文档里两种字，屏幕上很难看出是配置漏了。
 * ⚠️ 名字用中文「宋体」而不是 `SimSun`：Word 认这个名字并按本机语言替换（Mac 上是
 *    Songti SC，Windows 上是 SimSun）—— 写死 `SimSun` 在没装它的 Mac 上会掉到默认字体。
 */
const FONT_EAST_ASIA = '宋体';
/** 拉丁字母与数字（宋体里的西文不好看，中文卷子的正文从来是 Times 配宋体）。 */
const FONT_LATIN = 'Times New Roman';

/**
 * 颜色（★ 2026-09-30 教师：「颜色使用纯黑，答案用暗红色」）。
 * 🔴 正文一律**纯黑** —— 原先那套（题号主色蓝、正文灰、meta 更浅）在屏幕上是好的，
 *    但**打印出来**浅灰会发虚、蓝色会显得花，教师要的是「就像一张卷子」。
 * ⚠️ 保留的**唯一**颜色是答案的暗红：它是这张纸上教师最需要一眼找到的东西。
 */
const C = {
  ink: '000000',
  answer: '934E4E',
  line: 'BFBFBF',
  tableHead: 'F2F2F2',
};

/** 题干与作答区的左缩进（twips，1/1440 英寸）。表格也要用它 —— 见 `promptTable`。 */
const PROMPT_INDENT = 240;

/** 尺寸都是**半磅**（docx 的单位）：22 = 11pt。 */
const SZ = { title: 36, subtitle: 20, task: 26, heading: 22, body: 21, answer: 19, meta: 16, table: 19 };

/**
 * 造一个正文 run 的工厂（题干 / 作答区 / 表格各一档，只有字号与颜色不同）。
 *
 * ★ 2026-09-30：`inlineChildren` 要一个 `(text) => TextRun`，而「字号 / 颜色 / 字体」
 * 是**渲染层**的事 —— 由这里给，转换层不该知道排版。
 */
function runMaker(size: number, opts: { bold?: boolean; color?: string } = {}) {
  return (text: string) => new TextRun({
    text,
    bold: opts.bold ?? false,
    size,
    color: opts.color ?? C.ink,
    font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA },
  });
}

const bodyRun = runMaker(SZ.body);
const tableRun = runMaker(SZ.table);
// ⚠️ 表头那一行原本是加粗的（`bold: rowIndex === 0`）——换写法时**别把它丢了**，
//    否则表头与数据行长得一样，而「屏幕上只是没那么清楚」，不会有任何东西报错。
const tableHeadRun = runMaker(SZ.table, { bold: true });
const answerRun = runMaker(SZ.answer, { color: C.answer });

function para(text: string, opts: {
  size?: number; color?: string; bold?: boolean; indent?: number;
  before?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType];
} = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 60 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({
      text,
      bold: opts.bold ?? false,
      size: opts.size ?? SZ.body,
      color: opts.color ?? C.ink,
      font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA },
    })],
  });
}

/**
 * 表格：画成 **Word 里的真表格**（★ 2026-09-30 教师：「下方的表格要用 Word 里的真表格」）。
 *
 * 排版：细灰线 + **首行加粗并带一层极浅的底**（表头）—— 全仓的视觉语言里表格就长这样
 *（`export-service.ts` 的报告表格同一套边框常量值），不花哨。
 * 🔴 **空格子画 `PAPER_BLANK_TEXT`**（8 个半角下划线，与题干里那些空同一个记号）：
 *    留白的话打印出来是一个空方框，教师分不清「这一格要填」与「这一格本来就没内容」。
 * ⚠️ 表格**不定宽**（`autofit`）：列宽按内容算，否则一行两三个字的表会被拉成满页宽。
 */
function promptTable(rows: PaperPromptPart & { kind: 'table' }): Table {
  return new Table({
    /**
     * 🔴 **左缩进与题干同一个值**（240）—— 教师从导出结果里一眼看出来的毛病：
     *    表格顶在最左边、而题干是缩进的，看上去像**两张纸拼在一起**。
     * ⚠️ 别改成 0：那是「表格属于整个页面」的写法，而它属于**这一道题**。
     */
    indent: { size: PROMPT_INDENT, type: WidthType.DXA },
    // 列宽按内容算（不定宽）：一行两三个字的表被拉成满页宽会很难看。
    layout: TableLayoutType.AUTOFIT,
    rows: rows.rows.map((cells, rowIndex) => new TableRow({
      children: cells.map((cell) => new TableCell({
        margins: { top: 60, bottom: 60, left: 90, right: 90 },
        shading: rowIndex === 0 ? { fill: C.tableHead, type: ShadingType.CLEAR } : undefined,
        children: [new Paragraph({
          // 表头那一行居中（它就是列名），数据行照旧左对齐。
          alignment: rowIndex === 0 ? AlignmentType.CENTER : undefined,
          spacing: { before: 0, after: 0 },
          // 🔴 空格子印下划线（不是一个空方框）；有字的格子照印它的字。
          // ★ 2026-09-30：格子里也能写公式 ⇒ 走 `inlineChildren`。
          // ⚠️「空」的判据看**剥掉定界符之后**的文字（`inlineText`），
          //    否则一个只写了 `$x$` 的格子会被当成非空、印不出那条下划线。
          children: (cell.blank && inlineText(cell.text).trim() === '')
            ? [tableRun(PAPER_BLANK_TEXT)]
            : inlineChildren(cell.text, rowIndex === 0 ? tableHeadRun : tableRun),
        })],
      })),
    })),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: C.line },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line },
      left: { style: BorderStyle.SINGLE, size: 4, color: C.line },
      right: { style: BorderStyle.SINGLE, size: 4, color: C.line },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: C.line },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: C.line },
    },
  });
}

/** 一小段空隙（表格前后用；比空段落干净 —— 它只有一个 1pt 的 run）。 */
function spacer(): Paragraph {
  return new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun({ text: '', size: 2 })] });
}

/**
 * 题干：可能有换行（多行题干），逐行一个段落 —— 换行在 Word 里不该被吃掉。
 *
 * ★ 2026-09-30：吃 `PaperInline[]`（原来是 `string`）。公式**不跨行**
 *（`splitMath` 的规则 3：`\n` 之前找不到闭合就不收）⇒ 按 `\n` 摊平之后，
 * 一个公式永远落在**同一行**里，不会出现「半个公式在这行、半个在下一行」。
 */
function promptParagraphs(parts: PaperInline[]): Paragraph[] {
  // 先把部件摊平成一行的数组（文本部件里可能有换行；公式部件里不会有）。
  const lines: PaperInline[][] = [[]];
  for (const part of parts) {
    if (part.kind === 'math') { lines[lines.length - 1].push(part); continue; }
    part.text.split('\n').forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ kind: 'text', text: piece });
    });
  }
  return lines.map((line, index) => new Paragraph({
    spacing: { before: index === 0 ? 20 : 0, after: index === lines.length - 1 ? 40 : 0 },
    indent: { left: PROMPT_INDENT },
    // 🔴 文字与公式在**同一个 Paragraph 的 children 里** ⇒ 它们在同一条行内流上
    //    （这才叫行内公式；各占一个段落会变成一行一个字）。
    children: inlineChildren(line, bodyRun),
  }));
}

/** 一道题的题号行：`① 任务一 · 1　单选题 · 2 分`。 */
function questionHead(question: PaperQuestion): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 20 },
    children: [
      // ⚠️ **不再自己编号**（原来印的是 `1. 任务一：看一看 · 1` —— 同一个号印了两遍，
      //    教师第一眼就说「难看」）。题号由 `heading` 一处给（`flattenAnswerable`）。
      new TextRun({
        text: question.heading,
        bold: true, size: SZ.heading, color: C.ink, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA },
      }),
      new TextRun({
        text: `　${question.meta}`,
        size: SZ.meta, color: C.ink, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA },
      }),
    ],
  });
}

function renderQuestion(question: PaperQuestion): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [questionHead(question)];
  // 题面按部件画：**连续的行内内容攒成一段**（一起走换行与段间距），
  // 表格就地插进去（位置就是 `{表格域}` 在题干里的那处）。
  // ★ 2026-09-30：攒起来而不是逐个画，是为了让 `before: 20 / after: 40` 那对段间距
  //    仍然只作用在**整段题面**的头尾 —— 逐个画的话每个部件都会各加一次。
  let inline: PaperInline[] = [];
  const flushInline = () => {
    if (inline.length === 0) return;
    out.push(...promptParagraphs(inline));
    inline = [];
  };
  question.prompt.forEach((part) => {
    if (part.kind === 'table') {
      flushInline();
      // 表格上下各留一行空隙：紧贴着题干或「待选词」都会显得挤（教师那张截图里就是这样）。
      out.push(spacer());
      out.push(promptTable(part));
      out.push(spacer());
      return;
    }
    inline.push(part);
  });
  flushInline();
  // 作答区（选项 / 条目 / 左右栏 / 待选词）：缩进一档，行距紧一点。
  question.body.forEach((line) => {
    out.push(new Paragraph({
      spacing: { after: 20 },
      indent: { left: PROMPT_INDENT + 120 },
      children: inlineChildren(line, bodyRun),
    }));
  });
  if (question.answerNote) {
    out.push(para(question.answerNote, { size: SZ.answer, color: C.ink, indent: PROMPT_INDENT, before: 20, after: 60 }));
  } else {
    // 「答案：」那三个字加粗 —— 教师翻页找答案时靠它。
    out.push(new Paragraph({
      spacing: { before: 20, after: 60 },
      indent: { left: PROMPT_INDENT },
      children: [
        new TextRun({ text: '答案：', bold: true, size: SZ.answer, color: C.answer, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA } }),
        // ★ 2026-09-30：答案里可能有公式 ⇒ 走 `inlineChildren`。
        // ⚠️ 空答案那句兜底文案现在是**一个部件**（原来是 `answer || '（…）'`）。
        ...inlineChildren(
          question.answer.length > 0 ? question.answer : [{ kind: 'text', text: '（没有设置答案）' }],
          answerRun,
        ),
      ],
    }));
  }
  return out;
}

function renderBlock(block: PaperBlock, questionIndex: number): { children: (Paragraph | Table)[]; next: number } {
  if (block.kind === 'question') {
    return { children: renderQuestion(block.question), next: questionIndex + 1 };
  }
  const children: (Paragraph | Table)[] = [para(block.title || '（未命名任务）', {
    bold: true, size: SZ.task, color: C.ink, before: 260, after: 40,
  })];
  if (block.description) {
    children.push(para(block.description, { size: SZ.meta, color: C.ink, after: 40 }));
  }
  // 标题下面一条细横线（唯一一条装饰线）。
  children.push(new Paragraph({
    spacing: { before: 0, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line } },
    children: [],
  }));
  return { children, next: questionIndex };
}

/** 判据层的产物 → 一份 docx。**不成对地改这两层**：纸上写什么在那边决定。 */
export async function buildWorksheetPaperDocx(paper: WorksheetPaper): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  children.push(para(paper.title || '未命名学习单', {
    bold: true, size: SZ.title, color: C.ink, align: AlignmentType.CENTER, after: 40,
  }));
  // ★ 2026-09-30 教师：「最上面不要写教师用卷」⇒ 副标题只剩题数（原先那句是
  // 「8 道题 · 教师用卷（含答案）」）。**只在这张纸上**不写 —— 文件名里仍然有
  // 「教师用卷」，教师从文件名就能分清哪份是哪份。
  children.push(para(`${paper.questionCount} 道题`, {
    size: SZ.subtitle, color: C.ink, align: AlignmentType.CENTER, after: 120,
  }));
  if (paper.description) {
    children.push(para(paper.description, { size: SZ.meta, color: C.ink, after: 200 }));
  }

  let questionIndex = 0;
  paper.blocks.forEach((block) => {
    const rendered = renderBlock(block, questionIndex);
    children.push(...rendered.children);
    questionIndex = rendered.next;
  });

  const doc = new Document({
    title: `${paper.title || '学习单'}-教师用卷`,
    description: '学习单（含答案）',
    creator: '支点课堂 ClassNode',
    styles: { paragraphStyles: [], default: {} },
    sections: [{
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.line } },
            children: [
              new TextRun({ text: `${paper.title || '学习单'}  |  第 `, size: 16, color: C.ink, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA } }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.ink, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA } }),
              new TextRun({ text: ' 页', size: 16, color: C.ink, font: { ascii: FONT_LATIN, hAnsi: FONT_LATIN, eastAsia: FONT_EAST_ASIA } }),
            ],
          })],
        }),
      },
    }],
  });

  return Packer.toBuffer(doc);
}

/**
 * 文件名里那一半：把标题里 Word / 各系统不认的字符换掉。
 * ⚠️ 与 `export-service.ts` 那条同一条规则（`[\\/:*?"<>|]` → `_`）—— 两份各写一份是
 *    因为那一条在那边是内联的；**规则本身**要一致，否则同一个标题在两处导出会得到两个名字。
 */
export function paperFilename(title: string, stamp: string): string {
  const safe = (title || '未命名学习单').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  return `${safe}-教师用卷-${stamp}.docx`;
}
