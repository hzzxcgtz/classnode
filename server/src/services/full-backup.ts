import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { getEncryptionKey, decryptWithKey, isEncrypted, reloadEncryptionKey } from './crypto.js';
import { resolveDatabasePath } from './database-upgrade.js';
import { safeExtractZip } from './upload-security.js';

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
export function dataPaths() {
  const root = path.resolve(process.env.CLASSNODE_DATA_DIR || serverRoot);
  return { root, database: resolveDatabasePath(), uploads: path.join(root, 'uploads'), webapps: path.join(root, 'webapps'), key: path.join(root, '.encryption.key'), backups: path.join(root, 'backups') };
}

/** Refuse symlinks rather than accidentally exporting files outside user data. */
function files(root: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(root)) return result;
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('备份资产不能包含符号链接');
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'));
      else throw new Error('备份资产包含不支持的文件类型');
    }
  };
  if (!fs.lstatSync(root).isDirectory()) throw new Error('资产目录无效');
  visit(root);
  return result;
}
function copyDirectory(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const name of files(source)) {
    const dest = path.join(target, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(source, name), dest);
  }
}
function workspace(): string {
  const directory = path.dirname(dataPaths().database);
  return fs.mkdtempSync(path.join(directory, '.maintenance-'));
}

async function assertLiveDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>('PRAGMA database_list');
  const actual = rows.find(row => row.name === 'main')?.file;
  if (!actual || fs.realpathSync(actual) !== fs.realpathSync(dataPaths().database)) throw new Error('维护路径与实际数据库不一致，已取消操作');
}

async function validateDatabase(prisma: PrismaClient, current = false): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Classroom','Class','Agent')");
  if (tables.length !== 3) throw new Error('数据库结构不匹配');
  const integrity = await prisma.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
  const foreignKeys = await prisma.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
  if (!integrity.length || integrity.some(row => row.integrity_check !== 'ok') || foreignKeys.length) throw new Error('数据库完整性或外键校验失败');
  if (current) for (const model of Prisma.dmmf.datamodel.models) {
    const fields = model.fields.filter(field => field.kind !== 'object').map(field => quote(field.dbName || field.name));
    await prisma.$queryRawUnsafe(`SELECT ${fields.join(',')} FROM ${quote(model.dbName || model.name)} LIMIT 0`);
  }
}
async function validateCredentials(prisma: PrismaClient, key: string): Promise<void> {
  if (Buffer.byteLength(key, 'utf8') !== 32) throw new Error('备份加密密钥必须为 32 字节');
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'");
  for (const [table, field] of [['Agent', 'apiKey'], ['PlatformToken', 'token']]) {
    if (!tables.some(row => row.name === table)) continue;
    const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>(`SELECT ${quote(field)} FROM ${quote(table)}`);
    for (const row of rows) {
      if (!row[field]) continue;
      if (isEncrypted(row[field])) {
        try { decryptWithKey(row[field], key); } catch { throw new Error('备份密钥无法解密 API 凭据，已取消恢复'); }
      } else if (row[field].includes(':') && /^[0-9a-f]+:/i.test(row[field])) throw new Error('备份凭据密文格式无效');
    }
  }
}

/** Caller holds the maintenance lock: DB and files remain stable together. */
export async function createFullBackup(prisma: PrismaClient, source = 'local'): Promise<string> {
  await assertLiveDatabase(prisma);
  const paths = dataPaths();
  fs.mkdirSync(paths.backups, { recursive: true });
  const staging = workspace();
  const output = path.join(paths.backups, `classnode-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.classbak`);
  const partial = output + '.partial';
  try {
    await prisma.$executeRawUnsafe('VACUUM INTO ?', path.join(staging, 'data.db'));
    fs.writeFileSync(path.join(staging, '.encryption.key'), getEncryptionKey(), { mode: 0o600 });
    for (const sub of ['chat', 'avatars', 'logos']) copyDirectory(path.join(paths.uploads, sub), path.join(staging, sub));
    copyDirectory(paths.webapps, path.join(staging, 'webapps'));
    const entries = files(staging);
    const sizes = entries.map(name => fs.statSync(path.join(staging, name)).size);
    if (entries.length + 1 > 50000 || sizes.some(size => size > 500 * 1024 * 1024) || sizes.reduce((sum, size) => sum + size, 0) > 1024 * 1024 * 1024 - 10 * 1024 * 1024) throw new Error('备份超过当前恢复格式支持的大小或文件数量限制');
    const inventory = Object.fromEntries(entries.map(name => [name, hash(path.join(staging, name))]));
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ format: 'classnode-full-backup', version: 2, createdAt: new Date().toISOString(), files: inventory }));
    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive();
    const stream = fs.createWriteStream(partial, { mode: 0o600 });
    const complete = new Promise<void>((resolve, reject) => {
      stream.once('close', resolve);
      stream.once('error', reject);
      archive.once('error', reject);
      archive.once('warning', reject);
    });
    archive.pipe(stream);
    for (const name of files(staging)) archive.file(path.join(staging, name), { name });
    await Promise.all([archive.finalize(), complete]);
    fs.renameSync(partial, output);
    fs.writeFileSync(output + '.meta', JSON.stringify({ source, hash: hash(output) }));
    return output;
  } catch (error) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(output, { force: true });
    throw error;
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

export function extractBackup(file: string, staging: string, forceZip = false): { full: boolean; version: number } {
  if (!forceZip && /\.(?:classdb|db)$/i.test(file)) {
    fs.copyFileSync(file, path.join(staging, 'data.db'));
    return { full: false, version: 0 };
  }
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(file);
  const names = zip.getEntries().map((entry: { entryName: string }) => String(entry.entryName).replace(/\\/g, '/')) as string[];
  if (!names.includes('data.db') || names.some(name => !/^(?:data\.db|\.encryption\.key|manifest\.json|(?:chat|avatars|logos|webapps)(?:\/.*)?)$/.test(name))) throw new Error('备份压缩包结构无效');
  if (new Set(names).size !== names.length) throw new Error('备份压缩包有重复路径');
  safeExtractZip(zip, staging, { maxFiles: 50000, maxTotalBytes: 1024 * 1024 * 1024, maxSingleFileBytes: 500 * 1024 * 1024 });
  const manifest = path.join(staging, 'manifest.json');
  if (!fs.existsSync(manifest)) return { full: true, version: 1 };
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (parsed.format !== 'classnode-full-backup' || parsed.version !== 2 || !parsed.files || typeof parsed.files !== 'object') throw new Error('备份版本或清单无效');
  const actual = files(staging).filter(name => name !== 'manifest.json');
  if (!Object.hasOwn(parsed.files, 'data.db') || !Object.hasOwn(parsed.files, '.encryption.key') || actual.length !== Object.keys(parsed.files).length || actual.some(name => parsed.files[name] !== hash(path.join(staging, name)))) throw new Error('备份文件缺失或校验不一致');
  return { full: true, version: 2 };
}

export interface RestoreHooks {
  /** Integration fault probe, called after each filesystem replacement. */
  afterReplace?: (target: string) => Promise<void>;
  refresh?: () => Promise<void>;
  committed?: () => void;
}

function journalPath(): string { return dataPaths().database + '.maintenance.json'; }

function writeJournal(state: unknown): void {
  const journal = journalPath();
  const temporary = journal + '.next';
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(state)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, journal);
}

/** Recover an interrupted switch before opening the database on startup. */
export function recoverInterruptedMaintenance(): void {
  const journal = journalPath();
  if (!fs.existsSync(journal)) return;
  const state = JSON.parse(fs.readFileSync(journal, 'utf8')) as { staging: string; entries: Array<{ target: string; old: string; existed: boolean }> };
  const paths = dataPaths();
  const allowed = [paths.database, paths.key, paths.uploads, paths.webapps];
  const parent = path.dirname(paths.database);
  if (path.dirname(state.staging) !== parent || !path.basename(state.staging).startsWith('.maintenance-') || !Array.isArray(state.entries)) throw new Error('维护恢复日志无效，请保留数据并检查');
  const targets = new Set<string>();
  for (const [index, item] of state.entries.entries()) {
    if (!allowed.includes(item.target) || targets.has(item.target) || item.old !== path.join(state.staging, `original-${index}`) || typeof item.existed !== 'boolean') throw new Error('维护恢复日志路径无效');
    targets.add(item.target);
  }
  if (fs.existsSync(path.join(state.staging, 'original-0'))) {
    for (const suffix of ['-wal', '-shm']) fs.rmSync(paths.database + suffix, { force: true });
  }
  for (const item of [...state.entries].reverse()) {
    if (fs.existsSync(item.old)) {
      fs.rmSync(item.target, { recursive: true, force: true });
      fs.renameSync(item.old, item.target);
    } else if (!item.existed) fs.rmSync(item.target, { recursive: true, force: true });
  }
  fs.rmSync(journal);
  fs.rmSync(state.staging, { recursive: true, force: true });
}

function cleanupWorkspace(staging: string): void {
  // Keep rollback originals if recovery itself failed; startup retries the journal.
  if (!fs.existsSync(journalPath())) fs.rmSync(staging, { recursive: true, force: true });
}

async function promote(prisma: PrismaClient, staging: string, candidate: string, key: string, hooks: RestoreHooks): Promise<void> {
  const paths = dataPaths();
  const replacements = [
    [paths.database, candidate], [paths.key, path.join(staging, '.encryption.key')],
    [paths.uploads, path.join(staging, 'uploads')], [paths.webapps, path.join(staging, 'webapps')],
  ];
  const replaced: Array<{ target: string; old: string; existed: boolean }> = [];
  await prisma.$disconnect();
  try {
    if (fs.existsSync(paths.database + '-wal') && fs.statSync(paths.database + '-wal').size) throw new Error('数据库仍有活动 WAL，请停止其他服务后重试');
    for (const suffix of ['-wal', '-shm']) fs.rmSync(paths.database + suffix, { force: true });
    for (const [target, incoming] of replacements) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const old = path.join(staging, `original-${replaced.length}`);
      const existed = fs.existsSync(target);
      replaced.push({ target, old, existed });
      writeJournal({ staging, entries: replaced });
      if (existed) fs.renameSync(target, old);
      fs.renameSync(incoming, target);
      await hooks.afterReplace?.(target);
    }
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY !== key) throw new Error('当前 ENCRYPTION_KEY 与备份密钥不一致');
    reloadEncryptionKey();
    await prisma.$connect();
    await validateDatabase(prisma, true);
    await hooks.refresh?.();
  } catch (error) {
    await prisma.$disconnect();
    // If we refused an active original WAL before moving the DB, leave it alone.
    if (fs.existsSync(path.join(staging, 'original-0'))) {
      for (const suffix of ['-wal', '-shm']) fs.rmSync(paths.database + suffix, { force: true });
    }
    for (const { target, old, existed } of replaced.reverse()) {
      if (fs.existsSync(old)) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(old, target);
      } else if (!existed) fs.rmSync(target, { recursive: true, force: true });
    }
    reloadEncryptionKey();
    await prisma.$connect();
    await hooks.refresh?.();
    fs.rmSync(journalPath(), { force: true });
    throw error;
  }
  fs.rmSync(journalPath(), { force: true });
  hooks.committed?.();
}

export async function restoreFullBackup(prisma: PrismaClient, file: string, hooks: RestoreHooks = {}): Promise<{ safetyBackup: string; warnings: string[] }> {
  await assertLiveDatabase(prisma);
  const staging = workspace();
  let client: PrismaClient | undefined;
  try {
    const format = extractBackup(file, staging);
    const candidate = path.join(staging, 'data.db');
    if (fs.readFileSync(candidate).subarray(0, 16).toString('binary') !== 'SQLite format 3\0') throw new Error('备份数据库文件无效');
    const keyFile = path.join(staging, '.encryption.key');
    const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : getEncryptionKey();
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY !== key) throw new Error('当前 ENCRYPTION_KEY 与备份密钥不一致，请在相同密钥的环境恢复');
    client = new PrismaClient({ datasources: { db: { url: `file:${candidate}` } } });
    await validateDatabase(client);
    await validateCredentials(client, key);
    await client.$disconnect();
    // A separate process uses the candidate key during credential migrations,
    // without changing this server's encryption environment or cached key.
    await execute(process.execPath, [path.join(serverRoot, 'dist/upgrade-database.js')], { cwd: serverRoot, env: { ...process.env, DATABASE_URL: `file:${candidate}`, CLASSNODE_DATA_DIR: staging, ENCRYPTION_KEY: key }, timeout: 150000, maxBuffer: 4 * 1024 * 1024 });
    await validateDatabase(client, true);
    await validateCredentials(client, key);
    await client.classroomStudent.updateMany({ data: { status: 'offline' } });
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    const paths = dataPaths();
    const uploads = path.join(staging, 'uploads');
    fs.mkdirSync(uploads);
    const warnings: string[] = [];
    // ZIPs replace their attachment scope exactly, including empty directories.
    // DB-only backups retain local assets; v1 ZIPs retain local webapps because
    // those releases never included that directory.
    if (!format.full) { copyDirectory(paths.uploads, uploads); warnings.push('旧数据库备份不含附件和教学网页，保留当前资产；仅适合同环境恢复。'); }
    else for (const sub of ['chat', 'avatars', 'logos']) copyDirectory(path.join(staging, sub), path.join(uploads, sub));
    if (format.version < 2) {
      if (fs.existsSync(path.join(staging, 'webapps'))) fs.rmSync(path.join(staging, 'webapps'), { recursive: true });
      copyDirectory(paths.webapps, path.join(staging, 'webapps'));
      if (format.full) warnings.push('旧压缩备份不含教学网页，保留当前网页资产；跨设备可能需重新导入网页。');
    } else fs.mkdirSync(path.join(staging, 'webapps'), { recursive: true });
    if (format.version === 2) {
      for (const webapp of await client.webapp.findMany()) {
        const entry = path.resolve(staging, 'webapps', webapp.id, webapp.entryPath);
        const root = path.resolve(staging, 'webapps', webapp.id) + path.sep;
        if (!entry.startsWith(root) || !fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error(`备份缺少教学网页入口：${webapp.name}`);
      }
    }
    await client.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await client.$disconnect();
    const safetyBackup = await createFullBackup(prisma, 'safety-restore');
    await promote(prisma, staging, candidate, key, hooks);
    return { safetyBackup: path.basename(safetyBackup), warnings };
  } finally { await client?.$disconnect(); cleanupWorkspace(staging); }
}

export async function resetAllData(prisma: PrismaClient, hooks: RestoreHooks = {}): Promise<{ safetyBackup: string }> {
  await assertLiveDatabase(prisma);
  const staging = workspace();
  let client: PrismaClient | undefined;
  try {
    const candidate = path.join(staging, 'data.db');
    await prisma.$executeRawUnsafe('VACUUM INTO ?', candidate);
    client = new PrismaClient({ datasources: { db: { url: `file:${candidate}` } } });
    const tables = await client.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'");
    await client.$transaction(async tx => {
      await tx.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
      for (const { name } of tables) {
        if (name === 'Setting') await tx.$executeRawUnsafe("DELETE FROM Setting WHERE key <> 'admin_password'");
        else if (name === 'ShieldWord') await tx.$executeRawUnsafe('DELETE FROM ShieldWord WHERE builtin = 0');
        else await tx.$executeRawUnsafe(`DELETE FROM ${quote(name)}`);
      }
    }, { timeout: 30000 });
    await validateDatabase(client, true);
    await client.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await client.$disconnect();
    const key = getEncryptionKey();
    fs.writeFileSync(path.join(staging, '.encryption.key'), key, { mode: 0o600 });
    fs.mkdirSync(path.join(staging, 'uploads'));
    fs.mkdirSync(path.join(staging, 'webapps'));
    const safetyBackup = await createFullBackup(prisma, 'safety-reset');
    await promote(prisma, staging, candidate, key, hooks);
    return { safetyBackup: path.basename(safetyBackup) };
  } finally { await client?.$disconnect(); cleanupWorkspace(staging); }
}
