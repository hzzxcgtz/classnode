import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

process.env.ENCRYPTION_KEY = 't'.repeat(32);
const { upgradeDatabase } = await import('../services/database-upgrade.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');

async function fixture(legacy = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-safe-upgrade-'));
  const file = path.join(root, 'legacy.db');
  const url = `file:${file}`;
  prepareTemporarySqliteFile(url);
  let schema = fs.readFileSync(path.join(serverRoot, 'prisma/schema.prisma'), 'utf8');
  if (legacy) {
    schema = schema.replace(/model Student \{[\s\S]*?\n\}/, block => block.replace(/classId\s+String\?/, 'classId String').replace(/class\s+Class\?/, 'class Class'));
    schema = schema.replace(/model ClassroomStudent \{[\s\S]*?\n\}/, block => block.replace(/^\s*type\s+String[^\n]+\n/m, '\n').replace(/studentId\s+String\?/, 'studentId String').replace(/student\s+Student\?/, 'student Student'));
    schema = schema.replace('model ClassroomGroup {', 'model ClassroomGroup {\n  agentId String?');
    schema = schema.replace(/^\s*materials ClassroomGroupMaterial\[\][^\n]*\n/m, '\n');
    schema = schema.replace(/model ClassroomGroupMaterial \{[\s\S]*?\n\}/, '');
  }
  const schemaPath = path.join(root, 'schema.prisma');
  fs.writeFileSync(schemaPath, schema);
  execFileSync(process.execPath, [path.join(serverRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', schemaPath], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const klass = await prisma.class.create({ data: { id: 'class', name: 'old-class' } });
  await prisma.student.create({ data: { id: 'alice', name: 'Alice', classId: klass.id } });
  await prisma.student.create({ data: { id: 'virtual', name: 'G', classId: klass.id, tag: '__group__' } });
  await prisma.classGroup.create({ data: { id: 'source-group', classId: klass.id, name: 'G', studentIds: '["alice"]' } });
  await prisma.agent.create({ data: { id: 'agent', name: 'agent', platform: 'openai', apiKey: 'test' } });
  await prisma.classroom.create({ data: { id: 'classroom', title: 'old', mode: 'advanced' } });
  await prisma.webapp.create({ data: { id: 'webapp', name: 'old-webapp', entryPath: 'index.html' } });
  await prisma.classroomWebapp.create({ data: { classroomId: 'classroom', webappId: 'webapp' } });
  await prisma.classroomClass.create({ data: { classroomId: 'classroom', classId: klass.id } });
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomGroup" ("id","classroomId","name"${legacy ? ',"agentId"' : ''}) VALUES ('group','classroom','G'${legacy ? ",'agent'" : ''})`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ClassroomStudent" ("id","classroomId","studentId","groupId") VALUES ('participant','classroom','virtual','group'), ('individual','classroom','alice',NULL)`);
  await prisma.message.create({ data: { id: 'message', classroomId: 'classroom', studentId: 'participant', content: 'history', role: 'user' } });
  await prisma.interaction.create({ data: { id: 'interaction', classroomId: 'classroom', studentId: 'virtual' } });
  await prisma.teacherNotification.create({ data: { id: 'notice', classroomId: 'classroom', studentId: 'virtual', content: 'private' } });
  await prisma.worksheet.create({ data: { id: 'worksheet', title: 'old-sheet', content: { schemaVersion: 1, nodes: [{ id: 'q', type: 'short-answer', prompt: 'old?', data: {}, children: [] }] }, settings: {} } });
  await prisma.worksheetResponse.create({ data: { id: 'response', classroomId: 'classroom', worksheetId: 'worksheet', participantId: 'participant' } });
  await prisma.worksheetAnswer.create({ data: { id: 'answer', responseId: 'response', questionId: 'q', value: { text: 'preserved' } } });
  return { root, file, url, prisma, close: async () => { await prisma.$disconnect(); fs.rmSync(root, { recursive: true, force: true }); } };
}
async function assertHistory(prisma: PrismaClient) {
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).content, 'history');
  assert.deepEqual((await prisma.worksheetAnswer.findUniqueOrThrow({ where: { id: 'answer' } })).value, { text: 'preserved' });
  assert.equal((await prisma.worksheetResponse.findUniqueOrThrow({ where: { id: 'response' } })).participantId, 'participant');
  assert.equal((await prisma.interaction.findUniqueOrThrow({ where: { id: 'interaction' } })).studentId, 'participant');
  assert.equal((await prisma.teacherNotification.findUniqueOrThrow({ where: { id: 'notice' } })).studentId, 'participant');
  assert.equal((await prisma.classroomStudent.findUniqueOrThrow({ where: { id: 'participant' } })).type, 'group');
  assert.equal((await prisma.classroomGroupMaterial.findFirstOrThrow({ where: { groupId: 'group', kind: 'agent' } })).targetId, 'agent');
  assert.equal((await prisma.classroomGroupMaterial.findFirstOrThrow({ where: { groupId: 'group', kind: 'webapp' } })).targetId, 'webapp');
  assert.equal((await prisma.classroomGroupMember.findFirstOrThrow({ where: { groupId: 'group' } })).studentId, 'alice');
  assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
}

test('legacy upgrade preserves group targets, participant IDs, messages/answers and supports student removal; second run is stable', async () => {
  const f = await fixture();
  try {
    const result = await upgradeDatabase(f.prisma, { databaseUrl: f.url });
    assert.ok(result.backupPath);
    const backup = new PrismaClient({ datasources: { db: { url: `file:${result.backupPath}` } } });
    try { assert.deepEqual(await backup.$queryRawUnsafe('SELECT agentId FROM ClassroomGroup'), [{ agentId: 'agent' }]); } finally { await backup.$disconnect(); }
    await assertHistory(f.prisma);
    const columns = await f.prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>("PRAGMA table_info('Student')");
    assert.equal(Number(columns.find(column => column.name === 'classId')!.notnull), 0);
    await f.prisma.student.update({ where: { id: 'alice' }, data: { classId: null } });
    assert.equal(await f.prisma.classroomStudent.count({ where: { id: 'individual' } }), 1);
    const answerBefore = await f.prisma.worksheetAnswer.findMany();
    const markerBefore = await f.prisma.setting.findMany();
    assert.deepEqual(await upgradeDatabase(f.prisma, { databaseUrl: f.url }), { backupPath: null });
    assert.deepEqual(await f.prisma.worksheetAnswer.findMany(), answerBefore);
    assert.deepEqual(await f.prisma.setting.findMany(), markerBefore);
    await assertHistory(f.prisma);
  } finally { await f.close(); }
});

test('failure after data migration leaves original fields/data/markers unchanged, and retry succeeds', async () => {
  const f = await fixture();
  try {
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url, afterLegacy: async () => { throw new Error('injected failure'); } }), /injected failure/);
    assert.equal(await f.prisma.setting.count(), 0);
    assert.deepEqual(await f.prisma.$queryRawUnsafe('SELECT agentId FROM ClassroomGroup'), [{ agentId: 'agent' }]);
    assert.equal((await f.prisma.interaction.findUniqueOrThrow({ where: { id: 'interaction' } })).studentId, 'virtual');
    assert.equal(await f.prisma.worksheetAnswer.count(), 1);
    assert.equal(fs.existsSync(f.file + '.upgrade.lock'), false);
    await upgradeDatabase(f.prisma, { databaseUrl: f.url });
    await assertHistory(f.prisma);
  } finally { await f.close(); }
});

test('unknown populated obsolete columns cause strict schema refusal instead of forced loss', async () => {
  const f = await fixture();
  try {
    await f.prisma.$executeRawUnsafe('ALTER TABLE "Class" ADD COLUMN "unknownHistory" TEXT');
    await f.prisma.$executeRawUnsafe("UPDATE Class SET unknownHistory='do not drop'");
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url }), /数据库升级失败/);
    assert.deepEqual(await f.prisma.$queryRawUnsafe('SELECT unknownHistory FROM Class'), [{ unknownHistory: 'do not drop' }]);
    assert.equal(await f.prisma.setting.count(), 0);
    assert.equal(await f.prisma.worksheetAnswer.count(), 1);
  } finally { await f.close(); }
});

test('foreign-key failure in candidate cannot replace the original', async () => {
  const f = await fixture();
  try {
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url, afterLegacy: async candidate => {
      await candidate.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
      await candidate.$executeRawUnsafe("UPDATE Message SET studentId='missing'");
    } }), /外键|schema|数据库升级失败/);
    assert.equal((await f.prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).studentId, 'participant');
    assert.equal(await f.prisma.setting.count(), 0);
  } finally { await f.close(); }
});

test('concurrent writes in original abort promotion and remain intact', async () => {
  const f = await fixture();
  try {
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url, afterLegacy: async () => {
      await f.prisma.class.update({ where: { id: 'class' }, data: { name: 'changed while upgrading' } });
      await f.prisma.$disconnect();
    } }), /其他进程修改/);
    assert.equal((await f.prisma.class.findUniqueOrThrow({ where: { id: 'class' } })).name, 'changed while upgrading');
    assert.equal(await f.prisma.setting.count(), 0);
  } finally { await f.close(); }
});

test('desktop CLI and source startup share the safe entry point; old schema hash cannot skip data migration', async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.root, '.schema-version'), 'old hash');
    await f.prisma.$disconnect();
    execFileSync(process.execPath, [path.join(serverRoot, 'dist/upgrade-database.js')], { env: { ...process.env, DATABASE_URL: f.url, CLASSNODE_DATA_DIR: f.root }, stdio: 'pipe' });
    await assertHistory(f.prisma);
    const rust = fs.readFileSync(path.resolve(serverRoot, '../src-tauri/src/lib.rs'), 'utf8');
    assert.match(rust, /run_database_upgrade\(&node/);
    assert.doesNotMatch(rust, /accept-data-loss|run_prisma_db_push/);
    const index = fs.readFileSync(path.join(serverRoot, 'src/index.ts'), 'utf8');
    assert.ok(index.indexOf('await upgradeDatabase(prisma)') < index.indexOf('const cleanUploads'));
  } finally { await f.close(); }
});

test('committed WAL records are included in the independent upgrade backup', async () => {
  const f = await fixture();
  try {
    await f.prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await f.prisma.message.create({ data: { id: 'wal-message', classroomId: 'classroom', studentId: 'participant', content: 'committed in WAL', role: 'user' } });
    assert.ok(fs.existsSync(f.file + '-wal'));
    const result = await upgradeDatabase(f.prisma, { databaseUrl: f.url });
    const backup = new PrismaClient({ datasources: { db: { url: `file:${result.backupPath}` } } });
    try { assert.equal((await backup.message.findUniqueOrThrow({ where: { id: 'wal-message' } })).content, 'committed in WAL'); }
    finally { await backup.$disconnect(); }
    assert.equal(await f.prisma.message.count(), 2);
  } finally { await f.close(); }
});

test('hard process interruption leaves source untouched and stale-owner lock is recoverable', async () => {
  const f = await fixture();
  try {
    await f.prisma.$disconnect();
    const code = `import {PrismaClient} from ${JSON.stringify(path.join(serverRoot, 'node_modules/@prisma/client/default.js'))};
      import {upgradeDatabase} from ${JSON.stringify(path.join(serverRoot, 'dist/services/database-upgrade.js'))};
      const url=${JSON.stringify(f.url)}; const prisma=new PrismaClient({datasources:{db:{url}}});
      await upgradeDatabase(prisma,{databaseUrl:url,afterLegacy:async()=>process.exit(42)});`;
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, CLASSNODE_DATA_DIR: f.root }, stdio: 'pipe' }), (error: unknown) => (error as { status: number }).status === 42);
    assert.ok(fs.existsSync(f.file + '.upgrade.lock'));
    assert.equal(await f.prisma.setting.count(), 0);
    assert.equal(await f.prisma.worksheetAnswer.count(), 1);
    assert.deepEqual(await f.prisma.$queryRawUnsafe('SELECT agentId FROM ClassroomGroup'), [{ agentId: 'agent' }]);
    await upgradeDatabase(f.prisma, { databaseUrl: f.url });
    await assertHistory(f.prisma);
  } finally { await f.close(); }
});

test('active upgrade lock is retained and a mismatched destination is rejected', async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(f.file + '.upgrade.lock', JSON.stringify({ pid: process.pid }));
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url }), /另一个进程/);
    assert.ok(fs.existsSync(f.file + '.upgrade.lock'));
    const different = path.join(f.root, 'different.db');
    fs.copyFileSync(f.file, different);
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: `file:${different}` }), /不一致/);
    assert.equal(await f.prisma.setting.count(), 0);
  } finally { await f.close(); }
});

test('actual source server startup upgrades the legacy database before listening', async () => {
  const f = await fixture();
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  await f.prisma.$disconnect();
  const preload = path.join(f.root, 'local-only.mjs');
  fs.writeFileSync(preload, `const original=globalThis.fetch;
    globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return original(input,options);
    return Promise.reject(new Error('External network disabled in startup regression'));};`);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, path.join(serverRoot, 'dist/index.js')], { cwd: serverRoot, env: { ...process.env, http_proxy: '', https_proxy: '', DATABASE_URL: f.url, CLASSNODE_DATA_DIR: f.root, PORT: String(port), CLASSNODE_WEBAPP_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    let ready = false;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })).status === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    await assertHistory(f.prisma);
    assert.ok(await f.prisma.setting.findUnique({ where: { key: 'safe-database-upgrade-v1' } }));
  } finally {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    await f.close();
  }
});

test('unaltered v1.5.1 release schema upgrades through the same pipeline without losing group history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-real-v151-'));
  const file = path.join(root, 'old.db');
  const url = `file:${file}`;
  prepareTemporarySqliteFile(url);
  execFileSync(process.execPath, [path.join(serverRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(serverRoot, 'src/tests/fixtures/v1.5.1-schema.prisma')], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (const sql of [
      `INSERT INTO "Agent" (id,name,platform,apiKey,updatedAt) VALUES ('agent','old-agent','openai','dummy',CURRENT_TIMESTAMP)`,
      `INSERT INTO "Class" (id,name,updatedAt) VALUES ('class','old-class',CURRENT_TIMESTAMP)`,
      `INSERT INTO "Student" (id,classId,name,tag,updatedAt) VALUES ('alice','class','Alice',NULL,CURRENT_TIMESTAMP),('virtual','class','G','__group__',CURRENT_TIMESTAMP)`,
      `INSERT INTO "ClassGroup" (id,classId,name,studentIds) VALUES ('source-group','class','G','["alice"]')`,
      `INSERT INTO "Classroom" (id,title,mode) VALUES ('classroom','legacy','advanced')`,
      `INSERT INTO "ClassroomClass" (classroomId,classId) VALUES ('classroom','class')`,
      `INSERT INTO "ClassroomGroup" (id,classroomId,name,agentId) VALUES ('group','classroom','G','agent')`,
      `INSERT INTO "ClassroomStudent" (id,classroomId,studentId,groupId) VALUES ('participant','classroom','virtual','group'),('individual','classroom','alice',NULL)`,
      `INSERT INTO "Message" (id,classroomId,studentId,content,role) VALUES ('message','classroom','participant','old history','user')`,
      `INSERT INTO "TeacherNotification" (id,classroomId,studentId,content) VALUES ('notice','classroom','virtual','old notice')`,
      `INSERT INTO "Interaction" (id,classroomId,studentId) VALUES ('interaction','classroom','virtual')`,
    ]) await prisma.$executeRawUnsafe(sql);
    await upgradeDatabase(prisma, { databaseUrl: url });
    assert.equal((await prisma.classroomGroupMaterial.findFirstOrThrow({ where: { groupId: 'group', kind: 'agent' } })).targetId, 'agent');
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).content, 'old history');
    assert.equal((await prisma.teacherNotification.findUniqueOrThrow({ where: { id: 'notice' } })).studentId, 'participant');
    assert.equal((await prisma.classroomStudent.findUniqueOrThrow({ where: { id: 'participant' } })).type, 'group');
    await prisma.student.update({ where: { id: 'alice' }, data: { classId: null } });
    assert.equal(await prisma.classroomStudent.count(), 2);
    assert.equal(await prisma.worksheet.count(), 0);
    assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
    assert.equal((await upgradeDatabase(prisma, { databaseUrl: url })).backupPath, null);
  } finally { await prisma.$disconnect(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('valid candidate with missing history is rejected even when foreign-key check passes', async () => {
  const f = await fixture();
  try {
    await assert.rejects(upgradeDatabase(f.prisma, { databaseUrl: f.url, afterLegacy: async candidate => {
      await candidate.message.delete({ where: { id: 'message' } });
    } }), /丢失 Message 原有记录/);
    assert.equal((await f.prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).content, 'history');
    assert.equal(await f.prisma.setting.count(), 0);
  } finally { await f.close(); }
});
