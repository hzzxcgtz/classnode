import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const targets = {
  aarch64: { triple: 'aarch64-apple-darwin', suffix: 'apple-silicon' },
  'aarch64-apple-darwin': { triple: 'aarch64-apple-darwin', suffix: 'apple-silicon' },
  x86_64: { triple: 'x86_64-apple-darwin', suffix: 'intel' },
  'x86_64-apple-darwin': { triple: 'x86_64-apple-darwin', suffix: 'intel' },
};

if (!targets[target]) {
  console.error('用法: node scripts/rename-bundle.mjs <aarch64-apple-darwin|x86_64-apple-darwin>');
  process.exit(2);
}

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { triple, suffix } = targets[target];
const bundleDir = path.join(root, 'src-tauri', 'target', triple, 'release', 'bundle');

function firstFile(directory, predicate) {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory)
    .map(name => path.join(directory, name))
    .find(file => predicate(path.basename(file))) || null;
}

function replace(source, destination) {
  if (!source) return false;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(source, destination);
  console.log(`[rename-bundle] ${path.basename(destination)}`);
  return true;
}

const dmgDir = path.join(bundleDir, 'dmg');
const macosDir = path.join(bundleDir, 'macos');
const prefix = `ClassNode_${version}_macos_${suffix}`;

const dmg = firstFile(dmgDir, name => name.endsWith('.dmg') && !name.includes('_macos_'));
if (!replace(dmg, path.join(dmgDir, `${prefix}.dmg`))) {
  throw new Error(`未找到待重命名的 DMG: ${dmgDir}`);
}

replace(
  firstFile(macosDir, name => name === 'ClassNode.app'),
  path.join(macosDir, `${prefix}.app`),
);
replace(
  firstFile(macosDir, name => name === 'ClassNode.app.tar.gz'),
  path.join(macosDir, `${prefix}.tar.gz`),
);
replace(
  firstFile(macosDir, name => name === 'ClassNode.app.tar.gz.sig'),
  path.join(macosDir, `${prefix}.tar.gz.sig`),
);
