import fs from 'node:fs';
import path from 'node:path';
import type { ClassroomArchiveData } from './classroom-archive-data.js';
import { archiveName } from './classroom-archive-assets.js';
import { buildWorksheetPaper } from './worksheet-paper.js';
import { buildWorksheetPaperDocx } from './worksheet-paper-docx.js';
import { DEFAULT_POINTS } from './worksheet-questions.js';
import { buildWorksheetRecordDocx } from './worksheet-record-docx.js';

/** Each distinct worksheet is included once, including materials referenced by saved historical work. */
export async function writeWorksheetDocuments(data: ClassroomArchiveData, directory: string): Promise<void> {
  for (const [index, sheet] of data.worksheets.entries()) {
    const paper = buildWorksheetPaper({ title: sheet.title, description: sheet.description, content: sheet.content, fallbackPoints: DEFAULT_POINTS });
    fs.writeFileSync(path.join(directory, `${String(index + 1).padStart(2, '0')} ${archiveName(sheet.title)} 教师参考.docx`), await buildWorksheetPaperDocx(paper));
  }
  fs.writeFileSync(path.join(directory, '学生作答记录.docx'), await buildWorksheetRecordDocx(data));
}
