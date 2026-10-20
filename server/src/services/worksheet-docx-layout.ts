import { AlignmentType, Footer, ImageRun, PageNumber, Paragraph, TextRun, type IParagraphOptions } from 'docx';
import { resolveLocalPath } from './ai-proxy.js';
import { CHAT_IMAGE_URL } from './worksheet-ink.js';

export const WORD_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' };
export const WORD_PAGE = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 480, footer: 480 } };
export const WORD_STYLES = {
  default: { document: { run: { font: WORD_FONT, size: 22, color: '000000' }, paragraph: { spacing: { line: 320, after: 100 }, widowControl: true } } },
  paragraphStyles: [
    { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: WORD_FONT, size: 36, bold: true, color: '000000' }, paragraph: { keepNext: true, spacing: { before: 0, after: 180 } } },
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { font: WORD_FONT, size: 28, bold: true, color: '000000' }, paragraph: { outlineLevel: 0, keepNext: true, spacing: { before: 240, after: 120 } } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { font: WORD_FONT, size: 23, bold: true, color: '000000' }, paragraph: { outlineLevel: 1, keepNext: true, spacing: { before: 200, after: 80 } } },
  ],
};
export function wordParagraph(text: string, options: IParagraphOptions = {}): Paragraph {
  return new Paragraph({ ...options, children: text.split('\n').flatMap((line, i) => [new TextRun({ text: line, ...(i ? { break: 1 } : {}) })]) });
}
export function wordMeta(text: string, options: IParagraphOptions = {}): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: 120, line: 260 }, ...options, children: [new TextRun({ text, font: WORD_FONT, size: 18, color: '666666' })] });
}
export function wordFooter(): Footer {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '第 ', font: WORD_FONT, size: 18, color: '666666' }), new TextRun({ children: [PageNumber.CURRENT], font: WORD_FONT, size: 18, color: '666666' }), new TextRun({ text: ' 页', font: WORD_FONT, size: 18, color: '666666' })] })] });
}
export async function readWordImage(url: string): Promise<Buffer | null> {
  if (!CHAT_IMAGE_URL.test(url)) return null;
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(resolveLocalPath(url)).rotate().resize({ width: 1600, height: 1800, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { return null; }
}
export function wordImage(png: Buffer, label: string): Paragraph {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const scale = Math.min(580 / width, 520 / height, 1);
  return new Paragraph({ spacing: { before: 100, after: 120 }, children: [new ImageRun({ type: 'png', data: png, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) }, altText: { title: label, description: label, name: label } })] });
}
