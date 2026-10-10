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
  'x86_64-pc-windows-msvc': { triple: 'x86_64-pc-windows-msvc', suffix: 'x64', platform: 'windows' },
  'aarch64-pc-windows-msvc': { triple: 'aarch64-pc-windows-msvc', suffix: 'arm64', platform: 'windows' },
};

if (!targets[target]) {
  console.error('用法: node scripts/rename-bundle.mjs <Rust target>（macOS / Windows）');
  process.exit(2);
}

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { triple, suffix, platform = 'macos' } = targets[target];
const bundleDir = path.join(root, 'src-tauri', 'target', triple, 'release', 'bundle');

function firstFile(directory, predicate) {
  if (!fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory)
    .map(name => path.join(directory, name))
    .filter(file => predicate(path.basename(file)));
  if (files.length > 1) throw new Error(`存在多个候选安装包，请清理 ${directory} 后重新构建`);
  return files[0] || null;
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

if (platform === 'windows') {
  const directory = path.join(bundleDir, 'msi');
  const destination = path.join(directory, `ClassNode_${version}_windows_${suffix}.msi`);
  const source = firstFile(directory, name => name.startsWith(`ClassNode_${version}_`) && name.endsWith('.msi') && !name.includes('_windows_'));
  if (!replace(source, destination) && !fs.existsSync(destination)) throw new Error(`未找到当前版本 MSI: ${directory}`);
  process.exit(0);
}

const destination = path.join(dmgDir, `${prefix}.dmg`);
const dmg = firstFile(dmgDir, name => name.startsWith(`ClassNode_${version}_`) && name.endsWith('.dmg') && !name.includes('_macos_'));
if (!replace(dmg, destination) && !fs.existsSync(destination)) {
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
