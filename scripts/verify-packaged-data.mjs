/** Exercise migration and cross-directory backup using the exact installer runtime. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.CLASSNODE_VERIFY_RUNTIME;
assert.ok(runtime, 'CLASSNODE_VERIFY_RUNTIME must identify a candidate installer runtime');
const require = createRequire(path.join(runtime, 'package.json'));
const { PrismaClient } = require('@prisma/client');
const moduleAt = file => import(pathToFileURL(path.join(runtime, 'dist/services', file)).href);
const stage = process.argv[2];
if (!stage) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-packaged-data-'));
  const node = path.join(runtime, 'node');
  const common = { ...process.env };
  delete common.ENCRYPTION_KEY;
  const run = (name, extra = {}) => {
    const data = path.join(work, name); fs.mkdirSync(data);
    const db = path.join(data, 'test.db'); fs.copyFileSync(path.join(runtime, 'prisma/dev.db'), db);
    return execFileSync(node, [fileURLToPath(import.meta.url), name], { env: { ...common, ...extra, DATABASE_URL: `file:${db}`, CLASSNODE_DATA_DIR: data }, encoding: 'utf8', timeout: 180000 });
  };
  try {
    const source = run('source');
    const backup = source.split('\n').find(line => line.startsWith('BACKUP:')).slice(7);
    const destination = run('destination', { CLASSNODE_VERIFY_BACKUP: backup });
    const legacy = run('legacy');
    console.log(JSON.stringify({ result: 'PASS', sourceBackup: /BACKUP:/.test(source), newDirectoryRestore: /DESTINATION:PASS/.test(destination), old151Upgrade: /LEGACY:PASS/.test(legacy), runtime, nodeVersion: execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() }, null, 2));
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
} else {
  const prisma = new PrismaClient();
  try {
    const { encrypt, decrypt } = await moduleAt('crypto.js');
    const { upgradeDatabase } = await moduleAt('database-upgrade.js');
    if (stage === 'source') {
      await upgradeDatabase(prisma);
      const classroom = await prisma.classroom.create({ data: { title: '候选迁移验证', code: null } });
      const participant = await prisma.classroomStudent.create({ data: { classroomId: classroom.id, type: 'student' } });
      const worksheet = await prisma.worksheet.create({ data: { title: '候选学习单', content: { schemaVersion: 1, nodes: [] }, settings: {} } });
      const response = await prisma.worksheetResponse.create({ data: { classroomId: classroom.id, worksheetId: worksheet.id, participantId: participant.id } });
      await prisma.worksheetAnswer.create({ data: { responseId: response.id, questionId: 'q1', value: { format: 'text/v1', text: '跨目录保存的答案' } } });
      await prisma.message.create({ data: { classroomId: classroom.id, studentId: participant.id, role: 'user', content: '虚构历史消息' } });
      await prisma.agent.create({ data: { name: '虚构凭据', platform: 'coze', apiKey: encrypt('synthetic-credential-no-network') } });
      const data = process.env.CLASSNODE_DATA_DIR;
      fs.mkdirSync(path.join(data, 'uploads/chat'), { recursive: true }); fs.writeFileSync(path.join(data, 'uploads/chat/probe.txt'), 'synthetic asset');
      fs.mkdirSync(path.join(data, 'webapps/probe'), { recursive: true }); fs.writeFileSync(path.join(data, 'webapps/probe/index.html'), '<!doctype html><title>probe</title>');
      const { createFullBackup } = await moduleAt('full-backup.js');
      console.log('BACKUP:' + await createFullBackup(prisma));
    } else if (stage === 'destination') {
      await upgradeDatabase(prisma);
      const { restoreFullBackup } = await moduleAt('full-backup.js');
      await restoreFullBackup(prisma, process.env.CLASSNODE_VERIFY_BACKUP);
      assert.equal((await prisma.message.findFirstOrThrow()).content, '虚构历史消息');
      assert.deepEqual((await prisma.worksheetAnswer.findFirstOrThrow()).value, { format: 'text/v1', text: '跨目录保存的答案' });
      assert.equal(decrypt((await prisma.agent.findFirstOrThrow()).apiKey), 'synthetic-credential-no-network');
      assert.equal(fs.readFileSync(path.join(process.env.CLASSNODE_DATA_DIR, 'uploads/chat/probe.txt'), 'utf8'), 'synthetic asset');
      assert.ok(fs.existsSync(path.join(process.env.CLASSNODE_DATA_DIR, 'webapps/probe/index.html')));
      assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
      console.log('DESTINATION:PASS');
    } else if (stage === 'legacy') {
      await prisma.$disconnect();
      const db = process.env.DATABASE_URL.slice(5);
      fs.rmSync(db); fs.writeFileSync(db, '');
      execFileSync(process.execPath, [path.join(runtime, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(project, 'server/src/tests/fixtures/v1.5.1-schema.prisma')], { env: process.env, stdio: 'pipe' });
      execFileSync('python3', ['-c', `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('INSERT INTO Class (id,name,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)',('old-class','旧班级'));c.execute('INSERT INTO Student (id,classId,name,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP)',('old-student','old-class','旧学生'));c.commit()`, db], { stdio: 'pipe' });
      execFileSync(process.execPath, [path.join(runtime, 'dist/upgrade-database.js')], { cwd: runtime, env: process.env, stdio: 'pipe', timeout: 150000 });
      const student = await prisma.student.findUniqueOrThrow({ where: { id: 'old-student' } });
      assert.equal(student.name, '旧学生');
      await prisma.student.update({ where: { id: student.id }, data: { classId: null } });
      assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
      console.log('LEGACY:PASS');
    } else throw new Error('Unknown acceptance stage');
  } finally { await prisma.$disconnect(); }
}
