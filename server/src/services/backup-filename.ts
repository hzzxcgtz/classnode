import fs from 'node:fs';
import path from 'node:path';

export function backupTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** Reserve the staging name atomically, including backups still being written. */
export function reserveBackupFile(directory: string, extension: '.classbak' | '.classdb', date = new Date()) {
  const base = `支点课堂备份_${backupTimestamp(date)}`;
  for (let index = 1; ; index++) {
    const name = `${base}${index === 1 ? '' : `_${String(index).padStart(2, '0')}`}${extension}`;
    const file = path.join(directory, name);
    const partial = `${file}.partial`;
    if (fs.existsSync(file) || fs.existsSync(`${file}.meta`)) continue;
    try {
      fs.closeSync(fs.openSync(partial, 'wx', 0o600));
      if (fs.existsSync(file) || fs.existsSync(`${file}.meta`)) { fs.unlinkSync(partial); continue; }
      return { name, file, partial };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export function isBackupFilename(name: string): boolean {
  return /^(?:支点课堂备份_|classnode-backup-).+\.(?:classbak|classdb|db)$/.test(name);
}

/** New and historical local names use local time; ISO/UUID names retain UTC. */
export function backupFilenameTime(name: string): string | null {
  const local = name.match(/^(?:支点课堂备份_|classnode-backup-)(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_\d+|-[-\w]+)?\.(?:classbak|classdb|db)$/);
  const utc = name.match(/^classnode-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-[-\w]+)?\.(?:classbak|classdb|db)$/);
  const date = local ? new Date(`${local[1]}T${local[2]}:${local[3]}:${local[4]}`)
    : utc ? new Date(`${utc[1]}T${utc[2]}:${utc[3]}:${utc[4]}.${utc[5]}Z`) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
