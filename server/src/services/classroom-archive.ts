import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { writeWorksheetDocuments } from './worksheet-documents.js';
import { loadClassroomArchive } from './classroom-archive-data.js';
import { ArchiveAssets, archiveLink, archiveName } from './classroom-archive-assets.js';
import { ArchiveView, buildArchiveBody, archiveHtml, archiveText, escapeArchiveHtml as esc } from './classroom-archive-view.js';
const require = createRequire(import.meta.url);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface ClassroomArchiveResult {
  directory: string;
  file: string;
  filename: string;
  warnings: number;
  cleanup: () => void;
}

/** Exports a detached, readable copy. Does not alter the live database or call an external agent. */
export async function createClassroomArchive(prisma: PrismaClient, classroomId: string, kind: 'records' | 'word' = 'records'): Promise<ClassroomArchiveResult> {
  const data = await loadClassroomArchive(prisma, classroomId);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-classroom-archive-'));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const content = path.join(directory, '资料包');
    fs.mkdirSync(content);
    const root = process.env.CLASSNODE_DATA_DIR || serverRoot;
    const assets = new ArchiveAssets(content, path.join(root, 'uploads'), path.join(root, 'webapps'));
    if (kind === 'word') {
      await writeWorksheetDocuments(data, content);
    } else {
      if (data.annotations.length) fs.writeFileSync(path.join(content, '课堂批注.json'), JSON.stringify({format:'classnode-classroom-annotations',version:1,classroomId,annotations:data.annotations},null,2));
      assets.scan({ annotationImages:data.annotations.map(row=>row.target), worksheets: data.worksheets, responses: data.responses, analyses: data.analyses, participants: data.participants });
      const webappLinks = new Map<string, string | null>();
      const now = new Date();
      let body = buildArchiveBody(data, new ArchiveView(assets), webappLinks, now);
      const warningHtml = assets.warnings.length
        ? `<ul class="notice">${assets.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`
        : '<p>已引用的本地附件已检查，无缺失项。</p>';
      const inventoryHtml = assets.inventory.length ? `<table><thead><tr><th>文件</th><th>大小（字节）</th></tr></thead><tbody>${assets.inventory.map(f => `<tr><td><a href="${esc(archiveLink(f.name))}" download>${esc(f.name)}</a></td><td>${f.size}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">无已保存附件</p>';
      // Replace only our final markers; identical text in a student's response remains untouched.
      const replaceLast = (input: string, marker: string, value: string) => { const i = input.lastIndexOf(marker); return input.slice(0, i) + value + input.slice(i + marker.length); };
      body = replaceLast(body, '__ARCHIVE_INVENTORY__', inventoryHtml);
      body = replaceLast(body, '__ARCHIVE_WARNINGS__', warningHtml);
      fs.writeFileSync(path.join(content, '打开课堂记录.html'), archiveHtml(data.classroom.title || '未命名课堂', body));
      fs.writeFileSync(path.join(content, '课堂完整记录.txt'), '\uFEFF' + archiveText(body));
      const instructions = `ClassNode 课堂资料包\n\n课堂：${data.classroom.title || '未命名课堂'}\n导出时间：${now.toLocaleString('zh-CN', { hour12: false })}\n\n1. 请先解压整个 ZIP，再双击「打开课堂记录.html」。无需启动 ClassNode，也无需联网。\n2. 网页左侧切换学习模块，中间选择任务或学生／小组；顶部可搜索记录。点击图片可放大，支持「展开当前记录」和「打印当前记录」；在「附件与说明」可打印整堂课。\n3. 「课堂完整记录.txt」可用记事本、Word、WPS 阅读，也可交给其他工具分析。\n4. 「附件」保存引用的原始图片与文件。移动、分享时请保留目录结构。\n5. 探究空间不纳入课堂资料导出；如需迁移教学网页，请使用系统备份。\n6. 普通任务保存当前作答；AI 评价任务还包含已保存的作品与评价历史。未采集、已清除或文件缺失的内容无法还原。\n7. 旧课堂没有完整的材料及个人姓名历史快照，按系统当前保存内容导出；已有评价中的任务快照保留。导出后的资料包不会随系统修改而变化。\n8. 如有课堂批注，原始笔迹和文字画面参数保存在「课堂批注.json」；系统备份会连同课堂数据库完整保存和恢复批注。\n9. 资料包供阅读和分析，不能用于恢复 ClassNode；迁移请使用「备份与恢复」。不包含管理密码、API 密钥或账号凭据。\n\n文件检查：${assets.warnings.length ? `${assets.warnings.length} 项需注意，详见「文件检查说明.txt」和网页末尾。` : '未发现引用的本地附件缺失。'}\n`;
      fs.writeFileSync(path.join(content, '使用说明.txt'), '\uFEFF' + instructions);
      fs.writeFileSync(path.join(content, '文件检查说明.txt'), '\uFEFF' + (assets.warnings.join('\n') || '已引用的本地附件已检查，无缺失项。'));
      fs.writeFileSync(path.join(content, '附件清单.txt'), '\uFEFF文件路径\t字节数\tSHA-256\n' + assets.inventory.map(f => `${f.name}\t${f.size}\t${f.sha256}`).join('\n'));
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `${archiveName(data.classroom.title || '未命名课堂')}-${kind === 'word' ? '学习单Word文档' : '课堂资料包'}-${stamp}.zip`;
    const file = path.join(directory, 'export.zip');
    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const stream = fs.createWriteStream(file, { mode: 0o600 });
    const complete = new Promise<void>((resolve, reject) => {
      stream.once('close', resolve);
      stream.once('error', reject);
      archive.once('error', (error: Error) => { stream.destroy(); reject(error); });
      archive.once('warning', (error: Error) => { stream.destroy(); reject(error); });
    });
    archive.pipe(stream);
    archive.directory(content, false);
    await Promise.all([archive.finalize(), complete]);
    return { directory, file, filename, warnings: assets.warnings.length, cleanup };
  } catch (error) { cleanup(); throw error; }
}
