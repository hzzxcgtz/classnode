import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { migrateLegacyDatabase } from './legacy-upgrade.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const MARKER = 'safe-database-upgrade-v1';

function upgradeVersion(): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(serverRoot, 'prisma/schema.prisma')));
  const directory = path.dirname(fileURLToPath(import.meta.url));
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/\.(?:js|ts)$/.test(name) || /\.d\.ts$/.test(name) || !/(?:migration|schema|upgrade)/.test(name)) continue;
    hash.update(name).update(fs.readFileSync(path.join(directory, name)));
  }
  return hash.digest('hex');
}

export function resolveDatabasePath(url = process.env.DATABASE_URL || 'file:./dev.db'): string {
  if (!url.startsWith('file:')) throw new Error('升级仅支持 SQLite file: 数据库');
  const filename = url.slice(5);
  if (!filename || filename.includes('?')) throw new Error('升级数据库路径无效');
  return path.isAbsolute(filename) ? filename : path.resolve(serverRoot, 'prisma', filename);
}

/** Rebuild only the known classId constraint, retaining every column/index/trigger. */
export async function makeStudentClassNullable(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<{ name: string; notnull: number }[]>(`PRAGMA table_info('Student')`);
  if (Number(columns.find(column => column.name === 'classId')?.notnull) !== 1) return;
  const [table] = await prisma.$queryRawUnsafe<{ sql: string }[]>(`SELECT sql FROM sqlite_master WHERE type='table' AND name='Student'`);
  const original = table.sql;
  const changed = original.replace(/("classId"\s+TEXT)\s+NOT\s+NULL/i, '$1');
  if (changed === original) throw new Error('无法识别旧 Student.classId 定义，升级已中止');
  const create = changed.replace(/^CREATE\s+TABLE\s+(?:"Student"|Student)/i, 'CREATE TABLE "upgrade_Student"');
  if (create === changed) throw new Error('无法识别旧 Student 表定义，升级已中止');
  const dependent = await prisma.$queryRawUnsafe<{ sql: string }[]>(`SELECT sql FROM sqlite_master WHERE tbl_name='Student' AND type IN ('index','trigger') AND sql IS NOT NULL`);
  const list = columns.map(column => quote(column.name)).join(',');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(create);
      await tx.$executeRawUnsafe(`INSERT INTO "upgrade_Student" (${list}) SELECT ${list} FROM "Student"`);
      await tx.$executeRawUnsafe('DROP TABLE "Student"');
      await tx.$executeRawUnsafe('ALTER TABLE "upgrade_Student" RENAME TO "Student"');
      for (const item of dependent) await tx.$executeRawUnsafe(item.sql);
    });
  } finally { await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON'); }
}

function fingerprint(filename: string): string {
  const hash = crypto.createHash('sha256');
  for (const suffix of ['', '-wal']) {
    const file = filename + suffix;
    hash.update(suffix);
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

async function preserveIdentities(prisma: PrismaClient): Promise<Map<string, Set<string>>> {
  const tables = new Set((await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name));
  const expected = new Map<string, Set<string>>();
  for (const table of ['Class', 'ClassGroup', 'Student', 'Classroom', 'ClassroomGroup', 'ClassroomStudent', 'ClassroomGroupMember', 'Message', 'TeacherNotification', 'ShieldWarning', 'Interaction', 'Worksheet', 'WorksheetResponse', 'WorksheetAnswer', 'Webapp', 'WebappUsage', 'Agent', 'Avatar']) {
    if (!tables.has(table)) continue;
    // Removing the old virtual group accounts is the explicit exception;
    // their stable ClassroomStudent identities must still remain.
    const where = table === 'Student' ? " WHERE tag IS NULL OR tag <> '__group__'" : '';
    const rows = await prisma.$queryRawUnsafe<{ id: string | bigint }[]>(`SELECT id FROM ${quote(table)}${where}`);
    expected.set(table, new Set(rows.map(row => String(row.id))));
  }
  return expected;
}

async function verifyIdentities(prisma: PrismaClient, expected: Map<string, Set<string>>): Promise<void> {
  for (const [table, ids] of expected) {
    const rows = await prisma.$queryRawUnsafe<{ id: string | bigint }[]>(`SELECT id FROM ${quote(table)}`);
    const actual = new Set(rows.map(row => String(row.id)));
    if ([...ids].some(id => !actual.has(id))) throw new Error(`候选数据库丢失 ${table} 原有记录，升级已中止`);
  }
}

export interface UpgradeOptions {
  databaseUrl?: string;
  /** Fault injection / integration probes; never used by startup. */
  afterLegacy?: (candidate: PrismaClient) => Promise<void>;
}

function acquireLock(filename: string): number {
  try {
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
    return descriptor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const state = JSON.parse(fs.readFileSync(filename, 'utf8')) as { pid?: number };
    if (!Number.isInteger(state.pid) || state.pid! <= 0) throw new Error(`升级锁无效；请停止服务并检查 ${filename}`);
    try { process.kill(state.pid!, 0); }
    catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === 'ESRCH') {
        fs.rmSync(filename);
        return acquireLock(filename);
      }
    }
    throw new Error(`另一个进程正在升级数据库（PID ${state.pid}）`);
  }
}

/** Startup-only: no routes or cleanup jobs may be running while replacing the file. */
export async function upgradeDatabase(source: PrismaClient, options: UpgradeOptions = {}): Promise<{ backupPath: string | null }> {
  const databasePath = resolveDatabasePath(options.databaseUrl);
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) throw new Error('数据库缺失或为空；请初始化全新数据库，不能作为旧库升级');
  const connections = await source.$queryRawUnsafe<{ name: string; file: string }[]>('PRAGMA database_list');
  const actual = connections.find(item => item.name === 'main')?.file;
  if (!actual || fs.realpathSync(actual) !== fs.realpathSync(databasePath)) throw new Error('升级路径与 Prisma 实际连接的数据库不一致；未改动数据库');
  const version = upgradeVersion();
  const marker = await source.setting.findUnique({ where: { key: MARKER } }).catch(() => null);
  if (marker?.value === version) {
    const students = await source.$queryRawUnsafe<{ name: string; notnull: number }[]>("PRAGMA table_info('Student')");
    const groups = await source.$queryRawUnsafe<{ name: string }[]>("PRAGMA table_info('ClassroomGroup')");
    if (Number(students.find(column => column.name === 'classId')?.notnull) === 0 && groups.length > 0 && !groups.some(column => column.name === 'agentId')) return { backupPath: null };
  }
  const lockPath = databasePath + '.upgrade.lock';
  const lock = acquireLock(lockPath);
  let workDir: string | undefined;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  const backupPath = path.join(backupDir, `before-safe-upgrade-${Date.now()}-${crypto.randomUUID()}.db`);
  let candidate: PrismaClient | undefined;
  try {
    workDir = fs.mkdtempSync(path.join(path.dirname(databasePath), '.upgrade-'));
    const candidatePath = path.join(workDir, 'candidate.db');
    fs.mkdirSync(backupDir, { recursive: true });
    // SQLite itself takes a consistent snapshot, including committed WAL data.
    await source.$executeRawUnsafe('VACUUM INTO ?', backupPath);
    await source.$disconnect();
    const initial = fingerprint(databasePath);
    fs.copyFileSync(backupPath, candidatePath);
    candidate = new PrismaClient({ datasources: { db: { url: `file:${candidatePath}` } } });
    const identities = await preserveIdentities(candidate);
    await migrateLegacyDatabase(candidate, () => backupPath);
    await makeStudentClassNullable(candidate);
    await options.afterLegacy?.(candidate);
    await candidate.$disconnect();
    // Never accept arbitrary data-loss warnings. Legacy columns are consumed
    // by explicit migrations first; any remaining unsafe change stops startup.
    await execute(process.execPath, [path.join(serverRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(serverRoot, 'prisma/schema.prisma')], {
      cwd: serverRoot, env: { ...process.env, DATABASE_URL: `file:${candidatePath}` }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    });
    const integrity = await candidate.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
    const foreignKeys = await candidate.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
    if (integrity.some(row => row.integrity_check !== 'ok') || foreignKeys.length) throw new Error('候选数据库完整性或外键校验失败');
    await verifyIdentities(candidate, identities);
    await candidate.setting.upsert({ where: { key: MARKER }, create: { key: MARKER, value: version }, update: { value: version } });
    await candidate.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await candidate.$disconnect();
    if (fingerprint(databasePath) !== initial) throw new Error('升级期间原数据库被其他进程修改；已取消替换，请停止其他服务后重试');
    if (fs.existsSync(databasePath + '-wal') && fs.statSync(databasePath + '-wal').size > 0) throw new Error('原数据库仍有活动 WAL；请停止其他服务后重试');
    // All our handles are closed. Rename within the same volume is atomic;
    // failure leaves the source in place and the independent backup available.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(databasePath + suffix, { force: true });
    fs.renameSync(candidatePath, databasePath);
    console.log(`[upgrade] 数据库升级成功；原库备份：${backupPath}`);
    return { backupPath };
  } catch (error) {
    throw new Error(`数据库升级失败，原库未替换。备份：${fs.existsSync(backupPath) ? backupPath : '未创建'}。${error instanceof Error ? error.message : error}`, { cause: error });
  } finally {
    await candidate?.$disconnect();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}
