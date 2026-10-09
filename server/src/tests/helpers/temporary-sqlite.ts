import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Pre-create only isolated test files; never truncate an existing database. */
export function prepareTemporarySqliteFile(databaseUrl: string): void {
  if (!databaseUrl.startsWith('file:') || !path.isAbsolute(databaseUrl.slice(5))) {
    throw new Error('测试数据库必须使用绝对 file: 路径');
  }
  const file = path.resolve(databaseUrl.slice(5));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const realFile = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  if (!inside(temporaryRoot, realFile) || inside(fs.realpathSync(PROJECT_ROOT), realFile)) {
    throw new Error(`测试数据库必须位于项目外的临时目录：${databaseUrl}`);
  }
  // Prisma 6.19 on macOS may fail when creating a missing SQLite file. Opening
  // an empty file first leaves schema creation and all business assertions real.
  // 'wx' also rejects an existing file/symlink rather than following/truncating it.
  fs.writeFileSync(file, '', { flag: 'wx' });
}
