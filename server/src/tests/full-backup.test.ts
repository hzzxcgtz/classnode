import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { createTeacherSession, hasTeacherSessionCookie } from '../middleware/auth.js';
import { createStudentToken, verifyStudentToken } from '../middleware/student-auth.js';
import { maintenanceGate, withDataMaintenance, trackDataTask, maintenanceBusy } from '../services/data-maintenance.js';
import { createFullBackup, restoreFullBackup, resetAllData, dataPaths } from '../services/full-backup.js';
import { encrypt, decrypt, reloadEncryptionKey } from '../services/crypto.js';
import exportRoutes from '../routes/export.js';
import { startWebappHost } from '../services/webapp-host.js';
import { setupSocketHandlers, resetSocketData } from '../socket/index.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const keyA = 'a'.repeat(32);
const keyB = 'b'.repeat(32);
async function fixture(schema = path.join(root, 'prisma/schema.prisma')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-full-backup-'));
  const database = path.join(dir, 'data.db');
  fs.writeFileSync(database, '');
  process.env.DATABASE_URL = `file:${database}`;
  process.env.CLASSNODE_DATA_DIR = dir;
  delete process.env.ENCRYPTION_KEY;
  fs.writeFileSync(path.join(dir, '.encryption.key'), keyA);
  reloadEncryptionKey();
  execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', schema], { env: process.env, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const write = (name: string, content: string) => { const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  return { dir, database, prisma, write, async close() { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
async function seed(prisma: PrismaClient) {
  await prisma.setting.createMany({ data: [{ key: 'admin_password', value: 'password-hash' }, { key: 'lan-access', value: 'false' }, { key: 'bind-ip', value: '10.0.0.1' }] });
  const avatar = await prisma.avatar.create({ data: { svgContent: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>' } });
  const cls = await prisma.class.create({ data: { name: '一班', avatarId: avatar.id } });
  const student = await prisma.student.create({ data: { name: 'Alice', classId: cls.id, avatarId: avatar.id } });
  const classroom = await prisma.classroom.create({ data: { title: '历史课堂', code: '5555' } });
  await prisma.classroomClass.create({ data: { classroomId: classroom.id, classId: cls.id } });
  const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, studentId: student.id, status: 'online' } });
  const credential = await prisma.platformToken.create({ data: { platform: 'coze', label: '教师账号', token: encrypt('shared-token') } });
  const agent = await prisma.agent.create({ data: { name: 'AI', platform: 'coze', apiKey: encrypt('private-token'), credentialId: credential.id } });
  await prisma.classroomAgent.create({ data: { classroomId: classroom.id, agentId: agent.id } });
  await prisma.message.create({ data: { classroomId: classroom.id, studentId: participant.id, role: 'user', content: '历史消息', agentId: agent.id } });
  const worksheet = await prisma.worksheet.create({ data: { title: '练习', content: [], settings: {} } });
  await prisma.classroomWorksheet.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id } });
  const response = await prisma.worksheetResponse.create({ data: { classroomId: classroom.id, participantId: participant.id, worksheetId: worksheet.id } });
  await prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q1', value: { text: '历史答案' } } });
  await prisma.worksheetQuestionAnalysis.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, questionId: 'q1', aggregate: {}, totalCount: 1 } });
  const webapp = await prisma.webapp.create({ data: { name: '教学网页', entryPath: 'index.html' } });
  await prisma.classroomWebapp.create({ data: { classroomId: classroom.id, webappId: webapp.id } });
  await prisma.shieldConfig.create({ data: { rateLimit: 99 } });
  await prisma.shieldWord.createMany({ data: [{ word: '内置', builtin: true }, { word: '自定义', builtin: false }] });
  await prisma.shieldWarning.create({ data: { classroomId: classroom.id, studentId: participant.id, word: '自定义' } });
  await prisma.teacherNotification.create({ data: { classroomId: classroom.id, content: '通知' } });
  return { webapp, participant, agent };
}
function zipEdit(file: string, edit: (zip: ReturnType<typeof require>) => void) {
  const Zip = require('adm-zip');
  const original = new Zip(file);
  const zip = new Zip();
  for (const entry of original.getEntries()) zip.addFile(entry.entryName, entry.getData());
  edit(zip);
  zip.writeZip(file);
}

test('full backup snapshots committed WAL and includes effective key, attachments and webapps', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma);
    f.write('uploads/chat/photo.txt', '附件'); f.write('uploads/avatars/avatar.txt', '头像'); f.write('uploads/logos/logo.txt', 'logo'); f.write(`webapps/${webapp.id}/index.html`, '<h1>教学网页</h1>');
    process.env.ENCRYPTION_KEY = keyA;
    fs.rmSync(path.join(f.dir, '.encryption.key'));
    await f.prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await f.prisma.setting.create({ data: { key: 'committed-wal', value: 'present' } });
    assert.ok(fs.statSync(f.database + '-wal').size > 0);
    const backup = await withDataMaintenance(() => createFullBackup(f.prisma));
    const Zip = require('adm-zip'); const zip = new Zip(backup);
    assert.equal(zip.readAsText('.encryption.key'), keyA);
    assert.equal(zip.readAsText('chat/photo.txt'), '附件');
    assert.equal(zip.readAsText(`webapps/${webapp.id}/index.html`), '<h1>教学网页</h1>');
    assert.equal(JSON.parse(zip.readAsText('manifest.json')).version, 2);
    const snapshot = path.join(f.dir, 'snapshot.db'); fs.writeFileSync(snapshot, zip.readFile('data.db'));
    const client = new PrismaClient({ datasources: { db: { url: `file:${snapshot}` } } });
    try { assert.equal((await client.setting.findUnique({ where: { key: 'committed-wal' } }))?.value, 'present'); } finally { await client.$disconnect(); }
  } finally { delete process.env.ENCRYPTION_KEY; await f.close(); }
});

test('restore to fresh environment restores messages, answers, credentials and replaces empty asset scope', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma);
    f.write(`webapps/${webapp.id}/index.html`, '<h1>teaching</h1>'); f.write('uploads/chat/keep.txt', 'keep');
    const backup = await createFullBackup(f.prisma);
    await resetAllData(f.prisma);
    f.write('uploads/chat/stale.txt', 'stale'); f.write('uploads/avatars/stale.txt', 'stale'); f.write('webapps/stale/index.html', 'stale');
    fs.writeFileSync(path.join(f.dir, '.encryption.key'), keyB); reloadEncryptionKey();
    let commits = 0;
    const result = await withDataMaintenance(() => restoreFullBackup(f.prisma, backup, { committed: () => commits++ }));
    assert.equal(commits, 1); assert.deepEqual(result.warnings, []);
    assert.equal((await f.prisma.message.findFirst())?.content, '历史消息');
    assert.deepEqual((await f.prisma.worksheetAnswer.findFirst())?.value, { text: '历史答案' });
    assert.equal(decrypt((await f.prisma.platformToken.findFirst())!.token), 'shared-token');
    assert.equal(decrypt((await f.prisma.agent.findFirst())!.apiKey), 'private-token');
    assert.equal(fs.readFileSync(path.join(f.dir, `webapps/${webapp.id}/index.html`), 'utf8'), '<h1>teaching</h1>');
    assert.equal(fs.existsSync(path.join(f.dir, 'uploads/chat/stale.txt')), false);
    assert.equal(fs.existsSync(path.join(f.dir, 'uploads/avatars/stale.txt')), false);
    assert.equal(fs.existsSync(path.join(f.dir, 'webapps/stale')), false);
    assert.equal((await f.prisma.classroomStudent.findFirst())?.status, 'offline');
  } finally { await f.close(); }
});

test('corrupt manifests, keys, missing webapps and strict migration failure preserve live environment', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma);
    f.write(`webapps/${webapp.id}/index.html`, 'original'); f.write('uploads/chat/live.txt', 'live');
    const backup = await createFullBackup(f.prisma);
    for (const variant of ['hash', 'key', 'short-key', 'invalid-db', 'missing-page', 'schema']) {
      const bad = path.join(f.dir, `${variant}.classbak`); fs.copyFileSync(backup, bad);
      zipEdit(bad, zip => {
        if (variant === 'hash') zip.updateFile('chat/live.txt', Buffer.from('tampered'));
        else {
          zip.deleteFile('manifest.json');
          if (variant === 'key') zip.updateFile('.encryption.key', Buffer.from(keyB));
          if (variant === 'short-key') zip.updateFile('.encryption.key', Buffer.from('invalid'));
          if (variant === 'invalid-db') zip.updateFile('data.db', Buffer.from('not a database'));
          if (variant === 'missing-page') { const manifest = JSON.parse(new (require('adm-zip'))(backup).readAsText('manifest.json')); zip.deleteFile(`webapps/${webapp.id}/index.html`); delete manifest.files[`webapps/${webapp.id}/index.html`]; zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest))); }
        }
      });
      if (variant === 'schema') {
        const db = path.join(f.dir, 'bad-schema.db'); const Zip = require('adm-zip'); fs.writeFileSync(db, new Zip(bad).readFile('data.db'));
        const client = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
        try { await client.$executeRawUnsafe('ALTER TABLE Class ADD COLUMN unknownHistory TEXT'); await client.$executeRawUnsafe("UPDATE Class SET unknownHistory='must preserve'"); } finally { await client.$disconnect(); }
        zipEdit(bad, zip => zip.updateFile('data.db', fs.readFileSync(db)));
      }
      await assert.rejects(withDataMaintenance(() => restoreFullBackup(f.prisma, bad)));
      assert.equal((await f.prisma.message.findFirst())?.content, '历史消息');
      assert.equal(decrypt((await f.prisma.agent.findFirst())!.apiKey), 'private-token');
      assert.equal(fs.readFileSync(path.join(f.dir, 'uploads/chat/live.txt'), 'utf8'), 'live');
      assert.equal(fs.readFileSync(path.join(f.dir, `webapps/${webapp.id}/index.html`), 'utf8'), 'original');
      assert.equal(fs.existsSync(f.database + '.maintenance.json'), false);
    }
  } finally { await f.close(); }
});

test('each filesystem replacement failure rolls back DB, key, assets and refreshes runtime', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma);
    f.write(`webapps/${webapp.id}/index.html`, 'backup'); f.write('uploads/chat/live.txt', 'backup');
    const backup = await createFullBackup(f.prisma);
    await f.prisma.message.updateMany({ data: { content: 'live' } });
    f.write('uploads/chat/live.txt', 'live'); f.write(`webapps/${webapp.id}/index.html`, 'live');
    const token = await f.prisma.agent.findFirst();
    for (const target of [dataPaths().database, dataPaths().key, dataPaths().uploads, dataPaths().webapps]) {
      let refresh = 0, commit = 0;
      await assert.rejects(withDataMaintenance(() => restoreFullBackup(f.prisma, backup, {
        afterReplace: async changed => { if (changed === target) throw new Error('injected swap failure'); },
        refresh: async () => { refresh++; }, committed: () => { commit++; },
      })), /injected swap failure/);
      assert.equal(commit, 0); assert.equal(refresh, 1);
      assert.equal((await f.prisma.message.findFirst())?.content, 'live');
      assert.equal((await f.prisma.agent.findFirst())?.apiKey, token?.apiKey);
      assert.equal(fs.readFileSync(path.join(f.dir, '.encryption.key'), 'utf8'), keyA);
      assert.equal(fs.readFileSync(path.join(f.dir, 'uploads/chat/live.txt'), 'utf8'), 'live');
      assert.equal(fs.readFileSync(path.join(f.dir, `webapps/${webapp.id}/index.html`), 'utf8'), 'live');
      assert.deepEqual(await f.prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
    }
  } finally { await f.close(); }
});

test('reset clears every business table and asset while retaining password and built-in words; failure is atomic', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma);
    f.write(`webapps/${webapp.id}/index.html`, 'page'); f.write('uploads/chat/a.txt', 'file');
    await assert.rejects(withDataMaintenance(() => resetAllData(f.prisma, { afterReplace: async target => { if (target === dataPaths().uploads) throw new Error('reset failure'); } })), /reset failure/);
    assert.equal(await f.prisma.worksheetAnswer.count(), 1); assert.equal(await f.prisma.platformToken.count(), 1);
    assert.equal(fs.readFileSync(path.join(f.dir, 'uploads/chat/a.txt'), 'utf8'), 'file');
    const result = await withDataMaintenance(() => resetAllData(f.prisma));
    assert.ok(fs.existsSync(path.join(f.dir, 'backups', result.safetyBackup)));
    const tables = await f.prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'");
    for (const { name } of tables) {
      const rows = await f.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${name}"`);
      assert.equal(Number(rows[0].n), ['Setting', 'ShieldWord'].includes(name) ? 1 : 0, name);
    }
    assert.equal((await f.prisma.setting.findFirst())?.key, 'admin_password');
    assert.equal((await f.prisma.shieldWord.findFirst())?.word, '内置');
    assert.deepEqual(await f.prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
    const flags = await f.prisma.$queryRawUnsafe<Array<{ foreign_keys: bigint }>>('PRAGMA foreign_keys'); assert.equal(Number(flags[0].foreign_keys), 1);
    assert.deepEqual(fs.readdirSync(path.join(f.dir, 'uploads')), []); assert.deepEqual(fs.readdirSync(path.join(f.dir, 'webapps')), []);
  } finally { await f.close(); }
});

test('database-only and v1 ZIP restore are explicit about retaining missing asset scopes', async () => {
  const f = await fixture();
  try {
    await seed(f.prisma); f.write('uploads/chat/local.txt', 'local'); f.write('webapps/local/index.html', 'local');
    const legacy = path.join(f.dir, 'legacy.classdb'); await f.prisma.$executeRawUnsafe('VACUUM INTO ?', legacy);
    const result = await withDataMaintenance(() => restoreFullBackup(f.prisma, legacy)); assert.equal(result.warnings.length, 1);
    assert.equal(fs.readFileSync(path.join(f.dir, 'uploads/chat/local.txt'), 'utf8'), 'local');
    const Zip = require('adm-zip'); const zip = new Zip(); zip.addFile('data.db', fs.readFileSync(legacy)); zip.addFile('.encryption.key', Buffer.from(keyA));
    const oldZip = path.join(f.dir, 'v1.classbak'); zip.writeZip(oldZip);
    const second = await withDataMaintenance(() => restoreFullBackup(f.prisma, oldZip)); assert.equal(second.warnings.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(f.dir, 'uploads/chat')), []);
    assert.equal(fs.readFileSync(path.join(f.dir, 'webapps/local/index.html'), 'utf8'), 'local');
  } finally { await f.close(); }
});

test('exclusive maintenance refuses late async writes and concurrent maintenance, releases after failure', async () => {
  let complete!: () => void;
  const task = trackDataTask(() => new Promise<void>(resolve => { complete = resolve; }));
  await assert.rejects(withDataMaintenance(async () => {}), /仍有请求/);
  complete(); await task;
  await withDataMaintenance(async () => {
    assert.equal(maintenanceBusy(), true);
    assert.equal(await trackDataTask(async () => 'blocked'), undefined);
    await assert.rejects(withDataMaintenance(async () => {}));
  });
  await assert.rejects(withDataMaintenance(async () => { throw new Error('fault'); }));
  assert.equal(maintenanceBusy(), false);
});

test('actual export routes restore/reset live without restart and revoke sessions/disconnect clients', async t => {
  t.mock.method(console, 'log', () => {});
  const f = await fixture(); const app = express(); const http = createServer(app); const io = new Server(http);
  app.use(maintenanceGate); app.set('prisma', f.prisma); app.set('io', io); setupSocketHandlers(io, f.prisma, app);
  let cookie = '';
  // Use real session/token functions; auth boundary itself is covered in Phase 2.
  const { revokeAllTeacherSessions } = await import('../middleware/auth.js'); const { revokeAllStudentSessions } = await import('../middleware/student-auth.js');
  app.set('dataMaintenanceHooks', { refresh: async () => { app.set('lanAccessEnabled', (await f.prisma.setting.findUnique({ where: { key: 'lan-access' } }))?.value !== 'false'); }, committed: () => { resetSocketData(io, app); revokeAllTeacherSessions(); revokeAllStudentSessions(); } });
  app.get('/login-fixture', (_req, res) => { createTeacherSession(res); res.json({ success: true }); });
  app.use('/api/export', exportRoutes);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const addr = http.address(); assert.ok(addr && typeof addr !== 'string'); const url = `http://127.0.0.1:${addr.port}`;
  const socket = connect(url, { transports: ['websocket'], reconnection: false });
  try {
    const { participant, webapp } = await seed(f.prisma); f.write(`webapps/${webapp.id}/index.html`, 'page'); const token = createStudentToken('classroom', participant.id);
    const login = await fetch(url + '/login-fixture'); cookie = login.headers.get('set-cookie')!; await login.json(); assert.ok(hasTeacherSessionCookie(cookie));
    await new Promise<void>((resolve, reject) => { if (socket.connected) resolve(); else { socket.once('connect', resolve); socket.once('connect_error', reject); } });
    const disconnected = new Promise<void>(resolve => socket.once('disconnect', () => resolve()));
    const reset = await fetch(url + '/api/export/reset', { method: 'POST' }); assert.equal(reset.status, 200); const resetBody = await reset.json();
    await disconnected; assert.equal(socket.connected, false); assert.equal(await f.prisma.worksheet.count(), 0); assert.equal(verifyStudentToken(token), null); assert.equal(hasTeacherSessionCookie(cookie), false); assert.equal(app.get('lanAccessEnabled'), true);
    const restored = await fetch(url + `/api/export/restore/${resetBody.safetyBackup}`, { method: 'POST' }); assert.equal(restored.status, 200); await restored.json();
    assert.equal(await f.prisma.worksheetAnswer.count(), 1); assert.equal(app.get('lanAccessEnabled'), false);
  } finally { socket.disconnect(); await new Promise<void>(resolve => io.close(() => resolve())); await f.close(); }
});

test('hard process interruption between swaps is rolled back on startup recovery', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma); f.write(`webapps/${webapp.id}/index.html`, 'page'); f.write('uploads/chat/live.txt', 'original');
    const backup = await createFullBackup(f.prisma);
    await f.prisma.$disconnect();
    const program = `import {PrismaClient} from '@prisma/client'; import {restoreFullBackup,dataPaths} from './dist/services/full-backup.js'; const p=new PrismaClient(); await restoreFullBackup(p,process.argv[1],{afterReplace:async target=>{if(target===dataPaths().uploads)process.exit(42);}});`;
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', program, backup], { cwd: root, env: process.env, stdio: 'pipe' }), error => (error as { status?: number }).status === 42);
    assert.ok(fs.existsSync(f.database + '.maintenance.json'));
    execFileSync(process.execPath, [path.join(root, 'dist/upgrade-database.js')], { cwd: root, env: process.env, stdio: 'pipe' });
    assert.equal(fs.existsSync(f.database + '.maintenance.json'), false);
    assert.equal((await f.prisma.message.findFirst())?.content, '历史消息');
    assert.equal(fs.readFileSync(path.join(f.dir, 'uploads/chat/live.txt'), 'utf8'), 'original');
    assert.equal(decrypt((await f.prisma.agent.findFirst())!.apiKey), 'private-token');
  } finally { await f.close(); }
});


test('v1.5.1 DB-only restore migrates old group assignments and encrypted credentials before live promotion', async () => {
  const old = await fixture(path.join(root, 'src/tests/fixtures/v1.5.1-schema.prisma'));
  let target: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await old.prisma.$executeRawUnsafe("INSERT INTO Class(id,name,updatedAt) VALUES ('old-class','旧班级',CURRENT_TIMESTAMP)");
    await old.prisma.$executeRawUnsafe("INSERT INTO Student(id,classId,name,tag,updatedAt) VALUES ('group-student','old-class','一组','__group__',CURRENT_TIMESTAMP)");
    await old.prisma.$executeRawUnsafe("INSERT INTO Agent(id,name,platform,apiKey,updatedAt) VALUES ('old-agent','旧智能体','coze',?,CURRENT_TIMESTAMP)", encrypt('old-secret'));
    await old.prisma.$executeRawUnsafe("INSERT INTO Classroom(id,code,title,mode) VALUES ('old-room','6655','旧课堂','advanced')");
    await old.prisma.$executeRawUnsafe("INSERT INTO ClassroomGroup(id,classroomId,name,agentId) VALUES ('old-group','old-room','一组','old-agent')");
    await old.prisma.$executeRawUnsafe("INSERT INTO ClassroomStudent(id,classroomId,studentId,groupId) VALUES ('old-participant','old-room','group-student','old-group')");
    await old.prisma.$executeRawUnsafe("INSERT INTO Message(id,classroomId,studentId,role,content,agentId) VALUES ('old-msg','old-room','old-participant','user','旧消息','old-agent')");
    const backup = path.join(old.dir, 'old.classdb'); await old.prisma.$executeRawUnsafe('VACUUM INTO ?', backup); await old.prisma.$disconnect();
    target = await fixture();
    await withDataMaintenance(() => restoreFullBackup(target!.prisma, backup));
    assert.equal((await target.prisma.message.findUnique({ where: { id: 'old-msg' } }))?.content, '旧消息');
    assert.equal((await target.prisma.classroomStudent.findUnique({ where: { id: 'old-participant' } }))?.type, 'group');
    assert.equal(await target.prisma.student.count(), 0);
    assert.equal((await target.prisma.classroomGroupMaterial.findFirst())?.targetId, 'old-agent');
    assert.equal(decrypt((await target.prisma.platformToken.findFirst())!.token), 'old-secret');
    await target.prisma.student.create({ data: { name: '移出学生', classId: null } });
    assert.equal(await target.prisma.worksheet.count(), 0);
    assert.deepEqual(await target.prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
  } finally { await target?.close(); await old.close(); }
});

test('new backup transfers to a separate fresh directory and different local key', async t => {
  t.mock.method(console, 'log', () => {});
  const original = await fixture(); let target: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const { webapp } = await seed(original.prisma); original.write(`webapps/${webapp.id}/index.html`, 'transferred'); original.write('uploads/avatars/image.txt', 'image');
    const backup = await createFullBackup(original.prisma); await original.prisma.$disconnect();
    target = await fixture(); fs.writeFileSync(path.join(target.dir, '.encryption.key'), keyB); reloadEncryptionKey();
    await withDataMaintenance(() => restoreFullBackup(target!.prisma, backup));
    assert.equal(decrypt((await target.prisma.platformToken.findFirst())!.token), 'shared-token');
    assert.equal(fs.readFileSync(path.join(target.dir, `webapps/${webapp.id}/index.html`), 'utf8'), 'transferred');
    assert.equal(fs.readFileSync(path.join(target.dir, 'uploads/avatars/image.txt'), 'utf8'), 'image');
    assert.equal((await target.prisma.message.findFirst())?.content, '历史消息');
    assert.deepEqual((await target.prisma.worksheetAnswer.findFirst())?.value, { text: '历史答案' });
    const host = await startWebappHost({ port: 0, serverPort: 1, lanAccessEnabled: true, webappsRoot: path.join(target.dir, 'webapps') });
    assert.ok(host);
    try {
      const address = host.address(); assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/webapps/${webapp.id}/index.html`);
      assert.equal(response.status, 200); assert.equal(await response.text(), 'transferred');
    } finally { await new Promise<void>(resolve => host.close(() => resolve())); }
  } finally { await target?.close(); await original.close(); }
});


test('runtime refresh failure rolls back environment and preserves sessions until commit', async () => {
  const f = await fixture();
  try {
    const { webapp } = await seed(f.prisma); f.write(`webapps/${webapp.id}/index.html`, 'page');
    const backup = await createFullBackup(f.prisma); await f.prisma.setting.update({ where: { key: 'lan-access' }, data: { value: 'true' } });
    let refresh = 0, committed = false, runtimeLan = true;
    await assert.rejects(withDataMaintenance(() => restoreFullBackup(f.prisma, backup, {
      refresh: async () => { runtimeLan = (await f.prisma.setting.findUnique({ where: { key: 'lan-access' } }))?.value !== 'false'; if (++refresh === 1) throw new Error('runtime refresh failure'); },
      committed: () => { committed = true; },
    })), /runtime refresh failure/);
    assert.equal(refresh, 2); assert.equal(runtimeLan, true); assert.equal(committed, false);
    assert.equal((await f.prisma.setting.findUnique({ where: { key: 'lan-access' } }))?.value, 'true');
  } finally { await f.close(); }
});

test('HTTP maintenance gate tracks in-flight requests and blocks new writes during exclusive operation', async () => {
  const app = express(); app.use(maintenanceGate); const http = createServer(app);
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let writes = 0;
  app.get('/slow', async (_req, res) => { started(); await pending; res.json({ success: true }); });
  app.post('/write', (_req, res) => { writes++; res.json({ success: true }); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  try {
    const slow = fetch(url + '/slow'); await entered;
    await assert.rejects(withDataMaintenance(async () => {}), /仍有请求/);
    finish(); await (await slow).json();
    await withDataMaintenance(async () => { const response = await fetch(url + '/write', { method: 'POST' }); assert.equal(response.status, 503); await response.json(); });
    assert.equal(writes, 0);
    const response = await fetch(url + '/write', { method: 'POST' }); assert.equal(response.status, 200); await response.json(); assert.equal(writes, 1);
  } finally { finish(); await new Promise<void>(resolve => http.close(() => resolve())); }
});


test('refusing an external live WAL preserves that WAL and its committed writes', async () => {
  const f = await fixture(); let other: PrismaClient | undefined;
  try {
    const { webapp } = await seed(f.prisma); f.write(`webapps/${webapp.id}/index.html`, 'page');
    const backup = await createFullBackup(f.prisma);
    await f.prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    other = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await other.setting.create({ data: { key: 'external-committed', value: 'must survive' } });
    assert.ok(fs.statSync(f.database + '-wal').size > 0);
    await assert.rejects(withDataMaintenance(() => restoreFullBackup(f.prisma, backup)), /活动 WAL/);
    assert.ok(fs.existsSync(f.database + '-wal'));
    assert.equal((await f.prisma.setting.findUnique({ where: { key: 'external-committed' } }))?.value, 'must survive');
    await other.$disconnect();
    assert.equal((await f.prisma.setting.findUnique({ where: { key: 'external-committed' } }))?.value, 'must survive');
  } finally { await other?.$disconnect(); await f.close(); }
});
