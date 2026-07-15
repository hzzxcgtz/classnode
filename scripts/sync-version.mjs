/**
 * Keep package and UI versions in sync with the root package.json.
 *
 * This script is intentionally idempotent: normal builds must not change
 * release dates or touch files whose contents are already correct.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function writeIfChanged(file, content) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) return false;
  if (fs.readFileSync(target, 'utf8') === content) return false;
  fs.writeFileSync(target, content);
  console.log(`[sync-version] ${file}`);
  return true;
}

function updateJson(file, update) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) return false;
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  update(value);
  return writeIfChanged(file, `${JSON.stringify(value, null, 2)}\n`);
}

const { version } = JSON.parse(read('package.json'));
let changed = 0;

changed += updateJson('server/package.json', value => { value.version = version; });
changed += updateJson('src-tauri/tauri.conf.json', value => { value.version = version; });
changed += updateJson('updater/latest.json', value => { value.version = version; });

if (fs.existsSync(path.join(root, 'src-tauri/Cargo.toml'))) {
  changed += writeIfChanged(
    'src-tauri/Cargo.toml',
    read('src-tauri/Cargo.toml').replace(/^version = ".*?"/m, `version = "${version}"`),
  );
}

for (const file of ['README.md', 'README.en.md']) {
  if (!fs.existsSync(path.join(root, file))) continue;
  changed += writeIfChanged(file, read(file).replace(/classnode-v[\d.]+/g, `classnode-v${version}`));
}

for (const file of ['myportal/index.html', 'myportal/classnode.html']) {
  if (!fs.existsSync(path.join(root, file))) continue;
  changed += writeIfChanged(file, read(file).replace(/v\d+\.\d+\.\d+/g, `v${version}`));
}

console.log(`[sync-version] v${version}: ${changed ? `${changed} 个文件已更新` : '已是最新'}`);
