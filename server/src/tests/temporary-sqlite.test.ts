import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-test-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('temporary SQLite: create an empty file inside the isolated directory', (t) => {
  const file = path.join(tempDir(t), 'test.db');
  prepareTemporarySqliteFile(`file:${file}`);
  assert.equal(fs.statSync(file).size, 0);
});

test('temporary SQLite: refuse to overwrite an existing database', (t) => {
  const file = path.join(tempDir(t), 'test.db');
  fs.writeFileSync(file, 'preserve-existing-data');
  assert.throws(() => prepareTemporarySqliteFile(`file:${file}`), /EEXIST/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve-existing-data');
});

test('temporary SQLite: reject relative or non-file URLs', () => {
  for (const url of ['file:./dev.db', 'file:dev.db', 'dev.db', 'https://example.com/db']) {
    assert.throws(() => prepareTemporarySqliteFile(url), /绝对 file: 路径/);
  }
});

test('temporary SQLite: refuse the real project database', () => {
  assert.throws(
    () => prepareTemporarySqliteFile(`file:${path.join(PROJECT_ROOT, 'server/prisma/dev.db')}`),
    /项目外的临时目录/,
  );
});

test('temporary SQLite: reject a temporary directory symlink into the project', (t) => {
  const alias = path.join(tempDir(t), 'project');
  fs.symlinkSync(PROJECT_ROOT, alias, 'junction');
  assert.throws(() => prepareTemporarySqliteFile(`file:${path.join(alias, 'audit-test.db')}`), /项目外的临时目录/);
});

test('temporary SQLite: never follow an existing file symlink', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'real.db');
  const alias = path.join(dir, 'alias.db');
  fs.writeFileSync(file, 'preserve-target-data');
  // A directory junction is portable for the previous case; file symlinks may
  // require elevated privileges on Windows, so validate them on Unix only.
  if (process.platform === 'win32') { t.skip('file symlinks require Windows privileges'); return; }
  fs.symlinkSync(file, alias);
  assert.throws(() => prepareTemporarySqliteFile(`file:${alias}`), /EEXIST/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve-target-data');
});
