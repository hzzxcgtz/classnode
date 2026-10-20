import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PrismaClient, type Prisma } from '@prisma/client';
import express from 'express';
import { createServer } from 'node:http';
import { createClassroomArchive } from '../services/classroom-archive.js';
import { ArchiveAssets, archiveSource } from '../services/classroom-archive-assets.js';
import { requireTeacher, createTeacherSession } from '../middleware/auth.js';
import exportRoutes from '../routes/export.js';
import vm from 'node:vm';
import { ArchiveView, archiveText } from '../services/classroom-archive-view.js';
import { ARCHIVE_SCRIPT } from '../services/classroom-archive-interaction.js';
const require = createRequire(import.meta.url);
const Zip = require('adm-zip');
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const question = (id: string, type: string, data: Record<string, Prisma.InputJsonValue> = {}) => ({ id, type, prompt: `任务要求 ${id}`, data, children: [], inputMode: 'keyboard' });

test('offline viewer script is valid standalone JavaScript', () => { assert.doesNotThrow(() => new vm.Script(ARCHIVE_SCRIPT)); });

test('reading fields hide technical metadata while retaining names, student numbers and source text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-archive-fields-'));
  try {
    const view = new ArchiveView(new ArchiveAssets(root, root, root));
    view.participantNames.set('internal-person', '小林');
    const html = view.fields({ id: 'private-record', schemaVersion: 3, requestId: 'private-request', generation: 'private-generation', studentNo: '001', participantId: 'internal-person', perStudent: { 'internal-person': { score: 2, reason: '保留评价依据' } }, text: 'success 与 private-record 是学生写的原文', worksheetOpen: { 'private-sheet': ['private-task'] } });
    const text = archiveText(html);
    for (const phrase of ['001', '小林', '保留评价依据', 'success 与 private-record 是学生写的原文']) assert.ok(text.includes(phrase));
    for (const internal of ['记录编号', '内容版本', 'private-request', 'private-generation', 'internal-person', 'private-sheet', 'private-task']) assert.ok(!text.includes(internal));
    assert.equal(view.fields({ id: 'private-record', requestId: 'private-request' }), '');
    const order = archiveText(view.fields({ data: { items: [{ id: 'internal-item', text: '先观察' }], correctOrder: ['internal-item'] } }));
    assert.ok(order.includes('先观察') && !order.includes('internal-item'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('archive asset resolver refuses traversal, external paths and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-archive-path-'));
  try {
    fs.mkdirSync(path.join(root, 'uploads/chat'), { recursive: true });
    fs.writeFileSync(path.join(root, 'secret'), '不可导出');
    fs.writeFileSync(path.join(root, 'uploads/chat/a.png'), '图片');
    fs.symlinkSync(path.join(root, 'secret'), path.join(root, 'uploads/chat/link'));
    const uploads = path.join(root, 'uploads');
    assert.ok(archiveSource(uploads, 'chat/a.png'));
    for (const name of ['../secret', '/secret', 'chat/../../secret', 'chat/link', 'chat/..\\secret', 'chat/C:secret']) assert.equal(archiveSource(uploads, name), null);
    const assets = new ArchiveAssets(path.join(root, 'output'), uploads, path.join(root, 'webapps'));
    assert.equal(assets.attachment('/uploads/chat/%2e%2e/%2e%2e/secret'), null);
    assert.equal(assets.attachment('https://example.com/private'), null);
    assets.scan({ a: '/uploads/chat/a.png', b: ['/uploads/chat/a.png'] });
    assert.equal(assets.inventory.length, 1, 'same attachment is packaged once');
    assert.equal(fs.readFileSync(path.join(root, 'output', assets.inventory[0].name), 'utf8'), '图片');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('classroom ZIP is a detached readable archive of all modules, reviews and group evidence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-archive-fixture-'));
  const previous = process.env.CLASSNODE_DATA_DIR;
  process.env.CLASSNODE_DATA_DIR = dir;
  const database = path.join(dir, 'test.db');
  fs.writeFileSync(database, '');
  execFileSync(process.execPath, [path.join(serverRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(serverRoot, 'prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: `file:${database}` }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  const write = (name: string, content: string | Buffer) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  let archive: Awaited<ReturnType<typeof createClassroomArchive>> | undefined;
  try {
    const c = await prisma.classroom.create({ data: { title: '301班 / 历史课 <课堂>', mode: 'advanced', status: 'ended', endedAt: new Date() } });
    const other = await prisma.classroom.create({ data: { title: '不可串班', status: 'ended', endedAt: new Date() } });
    const group = await prisma.classroomGroup.create({ data: { classroomId: c.id, name: '观察组' } });
    await prisma.classroomGroupMember.createMany({ data: [{ classroomId: c.id, groupId: group.id, name: '小林', studentNo: '01' }, { classroomId: c.id, groupId: group.id, name: '小周', studentNo: '02' }] });
    const participant = await prisma.classroomStudent.create({ data: { classroomId: c.id, groupId: group.id, type: 'group' } });
    const agent = await prisma.agent.create({ data: { name: '科学学伴', platform: 'coze', apiKey: 'DO_NOT_EXPORT_SECRET', extra: 'PRIVATE_EXTRA', greeting: '欢迎观察' } });
    const webapp = await prisma.webapp.create({ data: { name: '探索网页', entryPath: 'index.html' } });
    const q = question('q1', 'categorize', { items: [{ id: 'i1', text: '蝴蝶' }], zones: [{ id: 'z1', text: '昆虫' }, { id: 'z2', text: '植物' }], placement: { i1: 'z1' }, promptImageUrl: '/uploads/chat/photo.png' });
    const order = question('q2', 'order', { items: [{ id: 'i1', text: '先观察' }, { id: 'i2', text: '再记录' }], correctOrder: ['i1', 'i2'] });
    const ink = { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [{ tool: 'pen', color: '#111111', width: 2, points: [[0.1, 0.1], [0.9, 0.9]] }] };
    const sheet = await prisma.worksheet.create({ data: { title: '观察学习单', description: '完整保留任务要求', content: { schemaVersion: 1, nodes: [{ ...question('theme', 'task'), prompt: '观察与表达', children: [q, order, question('q3', 'drawing'), question('q4', 'short-answer')] }] }, settings: { allowResubmit: true } } });
    await prisma.classroomGroupMaterial.createMany({ data: [{ groupId: group.id, kind: 'agent', targetId: agent.id }, { groupId: group.id, kind: 'webapp', targetId: webapp.id }, { groupId: group.id, kind: 'worksheet', targetId: sheet.id }] });
    const response = await prisma.worksheetResponse.create({ data: { classroomId: c.id, worksheetId: sheet.id, participantId: participant.id, status: 'submitted' } });
    const a = await prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q1', value: { format: 'categorize/v1', assignment: { i1: 'z1' } }, status: 'submitted', score: 1, gradeState: 'correct', isCorrect: true } });
    await prisma.worksheetAnswer.createMany({ data: [{ responseId: response.id, questionId: 'q2', value: { format: 'order/v1', order: ['i2', 'i1'] }, status: 'draft' }, { responseId: response.id, questionId: 'q3', value: ink, status: 'submitted' }, { responseId: response.id, questionId: 'q4', value: { format: 'text/v1', text: '完整原文'.repeat(3000) }, status: 'submitted' }] });
    for (const i of [1, 2]) await prisma.worksheetAnswerReview.create({ data: { answerId: a.id, requestId: `req-${i}`, generation: `gen-${i}`, question: { node: { ...q, prompt: '当次评价任务快照' }, heading: '任务 1', context: [] }, value: { format: 'photo/v1', url: '/uploads/chat/photo.png' }, status: 'succeeded', score: i, maxScore: 2, unit: '分', reason: `第 ${i} 次评分理由`, advice: '继续观察' } });
    await prisma.worksheetQuestionAnalysis.create({ data: { classroomId: c.id, worksheetId: sheet.id, questionId: 'q1', totalCount: 1, aggregate: { entries: [{ participantId: participant.id }] }, narrative: '原有班级分析', perStudent: { reason: '原有评价依据' } } });
    await prisma.message.createMany({ data: [{ classroomId: c.id, studentId: participant.id, agentId: agent.id, role: 'user', content: '<script>window.UNSAFE=1</script>\n完整问题', fileUrls: '["/uploads/chat/photo.png","/uploads/chat/missing.pdf"]', fileNames: '["我的照片.png","未找到的资料.pdf"]' }, { classroomId: c.id, studentId: participant.id, agentId: agent.id, role: 'assistant', content: '原始回答'.repeat(4000), followUps: '["再想一想"]' }] });
    await prisma.teacherNotification.create({ data: { classroomId: c.id, groupId: group.id, content: '仅发给观察组的通知' } });
    await prisma.webappUsage.create({ data: { classroomId: c.id, webappId: webapp.id, studentId: participant.id, durationMs: 1500, frameCount: 3 } });
    await prisma.setting.create({ data: { key: 'admin_password', value: 'DO_NOT_EXPORT_PASSWORD' } });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=', 'base64');
    write('uploads/chat/photo.png', png);
    write(`webapps/${webapp.id}/index.html`, '<h1>原始探究网页</h1><script src="assets/app.js"></script>');
    write(`webapps/${webapp.id}/assets/app.js`, 'document.body.dataset.webapp="original"');
    write('uploads/chat/unrelated.txt', '不属于该课堂的附件');
    archive = await createClassroomArchive(prisma, c.id);
    const zip = new Zip(archive.file);
    const names = zip.getEntries().map((e: { entryName: string }) => e.entryName);
    const html = zip.readAsText('打开课堂记录.html'); const text = zip.readAsText('课堂完整记录.txt');
    assert.ok(names.includes('使用说明.txt'));
    assert.ok(!names.some((n: string) => n.endsWith('.json') || n.includes('unrelated') || n.endsWith('.db')));
    assert.equal(names.filter((n: string) => n.includes('photo.png')).length, 1);
    for (const phrase of ['观察组', '小林', '小周', '科学学伴', '观察学习单', '原有班级分析', '原有评价依据', '当次评价任务快照', '第 1 次评分理由', '第 2 次评分理由', '蝴蝶 → 昆虫', '再记录', '完整原文'.repeat(3000), '原始回答'.repeat(4000)]) assert.ok(text.includes(phrase), `Missing: ${phrase.slice(0, 60)}`);
    for (const internal of ['记录编号', '课堂编号', '评价请求编号', '内容版本', '内容格式', 'req-1', 'gen-1', 'i2 · 再记录', participant.id, sheet.id, c.id]) assert.ok(!text.includes(internal), `Internal metadata leaked: ${internal}`);
    assert.ok(html.includes('小组共同作答'));
    assert.ok(html.includes('<svg class="ink"'));
    assert.ok(!html.includes('<script>window.UNSAFE'));
    assert.ok(html.includes('&lt;script&gt;window.UNSAFE'));
    assert.ok(html.includes('Content-Security-Policy'));
    for (const control of ['global-search', 'data-record-button', 'data-response-filter', 'picture-overlay', 'print-current']) assert.ok(html.includes(control), control);
    assert.ok(!text.includes('.record-panel{') && !text.includes('function navigate('), 'text record must not contain viewer code');
    assert.ok(!text.includes('DO_NOT_EXPORT') && !text.includes('PRIVATE_EXTRA') && !text.includes('不可串班'));
    assert.equal(archive.warnings, 1);
    assert.ok(zip.readAsText('文件检查说明.txt').includes('missing.pdf'));
    assert.ok(!names.some((name: string) => name.startsWith('探究网页/')));
    assert.ok(!text.includes('探索网页') && !html.includes('data-view="explorer"'));
    const wordArchive = await createClassroomArchive(prisma, c.id, 'word');
    try {
      const wordZip = new Zip(wordArchive.file);
      const wordNames = wordZip.getEntries().map((entry: { entryName: string }) => entry.entryName);
      assert.equal(wordNames.length, 2);
      assert.ok(wordNames.every((name: string) => name.endsWith('.docx')));
      const records = new Zip(wordZip.readFile('学生作答记录.docx')).readAsText('word/document.xml');
      assert.ok(records.includes('第 1 次评分理由') && records.includes('第 2 次评分理由'));
      assert.ok(!records.includes('探索网页') && !records.includes('任务要求 q1'));
    } finally { wordArchive.cleanup(); }
    await prisma.worksheet.update({ where: { id: sheet.id }, data: { title: '导出后改名' } });
    write('uploads/chat/photo.png', '导出后替换');
    assert.deepEqual(zip.readFile(names.find((n: string) => n.includes('photo.png'))), png);
    assert.ok(zip.readAsText('打开课堂记录.html').includes('观察学习单'));
    const emptyArchive = await createClassroomArchive(prisma, other.id);
    try { const emptyZip = new Zip(emptyArchive.file); assert.ok(emptyZip.readAsText('打开课堂记录.html').includes('这里还没有记录')); assert.ok(!emptyZip.readAsText('课堂完整记录.txt').includes('原有班级分析')); } finally { emptyArchive.cleanup(); }
    await t.test('route requires teacher, returns downloadable ZIP, rejects live/missing classrooms', async () => {
      const app = express(); app.use(express.json()); app.set('prisma', prisma);
      app.post('/login', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); });
      app.use('/api/export', requireTeacher, exportRoutes);
      const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        assert.equal((await fetch(`${base}/api/export/${c.id}/archive`, { method: 'POST' })).status, 401);
        assert.equal((await fetch(`${base}/api/export/${c.id}/worksheet-documents`, { method: 'POST' })).status, 401);
        const login = await fetch(`${base}/login`, { method: 'POST' });
        const cookie = login.headers.get('set-cookie')!.split(';')[0];
        const result = await fetch(`${base}/api/export/${c.id}/archive`, { method: 'POST', headers: { cookie } });
        assert.equal(result.status, 200); assert.match(result.headers.get('content-disposition')!, /filename\*/);
        assert.match(result.headers.get('content-type')!, /zip/);
        const downloaded = new Zip(Buffer.from(await result.arrayBuffer()));
        assert.ok(downloaded.readAsText('课堂完整记录.txt').includes('观察组'));
        const wordDownload = await fetch(`${base}/api/export/${c.id}/worksheet-documents`, { method: 'POST', headers: { cookie } });
        assert.equal(wordDownload.status, 200);
        assert.ok(new Zip(Buffer.from(await wordDownload.arrayBuffer())).getEntry('学生作答记录.docx'));
        assert.equal((await fetch(`${base}/api/export/missing/archive`, { method: 'POST', headers: { cookie } })).status, 404);
        await prisma.classroom.update({ where: { id: other.id }, data: { status: 'active' } });
        assert.equal((await fetch(`${base}/api/export/${other.id}/archive`, { method: 'POST', headers: { cookie } })).status, 409);
      } finally { await new Promise<void>(r => server.close(() => r())); }
    });
    if (process.env.CLASSNODE_ARCHIVE_QA_DIR) {
      const qaDir = path.resolve(process.env.CLASSNODE_ARCHIVE_QA_DIR); fs.mkdirSync(qaDir, { recursive: true });
      zip.extractAllTo(qaDir, true);
    }
    const temp = archive.directory; archive.cleanup(); archive = undefined; assert.ok(!fs.existsSync(temp));
  } finally {
    archive?.cleanup(); await prisma.$disconnect();
    if (previous === undefined) delete process.env.CLASSNODE_DATA_DIR; else process.env.CLASSNODE_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
