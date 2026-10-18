import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupFilenameTime, backupTimestamp, isBackupFilename, reserveBackupFile } from '../services/backup-filename.js';

test('本地日期生成简洁中文名称，同秒已完成与正在生成的备份均不覆盖', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-name-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const date = new Date(2026, 9, 18, 9, 2, 57, 923);
  assert.equal(backupTimestamp(date), '2026-10-18_09-02-57');
  const first = reserveBackupFile(directory, '.classbak', date);
  const second = reserveBackupFile(directory, '.classbak', date);
  assert.equal(first.name, '支点课堂备份_2026-10-18_09-02-57.classbak');
  assert.equal(second.name, '支点课堂备份_2026-10-18_09-02-57_02.classbak');
  fs.writeFileSync(first.partial, 'existing backup');
  fs.renameSync(first.partial, first.file);
  assert.match(reserveBackupFile(directory, '.classbak', date).name, /_03\.classbak$/);
  assert.equal(fs.readFileSync(first.file, 'utf8'), 'existing backup');
  assert.match(reserveBackupFile(directory, '.classdb', date).name, /09-02-57\.classdb$/);
});

test('列表同时识别新旧备份，文件名时间不受复制导致的文件创建时间影响', () => {
  for (const name of ['支点课堂备份_2026-10-18_09-02-57.classbak', '支点课堂备份_2026-10-18_09-02-57_02.classbak', 'classnode-backup-2026-10-18_09-02-57.classdb']) {
    assert.equal(isBackupFilename(name), true);
    assert.equal(backupFilenameTime(name), new Date(2026, 9, 18, 9, 2, 57).toISOString());
  }
  const old = 'classnode-backup-2026-10-18T01-02-56-923Z-7f79ceb4-c4a1-4fad-ae51-25be962e8790.classbak';
  assert.equal(isBackupFilename(old), true);
  assert.equal(backupFilenameTime(old), '2026-10-18T01:02:56.923Z');
  assert.equal(isBackupFilename(old + '.partial'), false);
  assert.equal(isBackupFilename(old + '.meta'), false);
  assert.equal(isBackupFilename('upload-123.db'), false);
  assert.equal(backupFilenameTime('bad-name.classbak'), null);
});
