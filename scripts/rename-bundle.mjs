import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const target = process.argv[2]; // 'aarch64' or 'x86_64'

const isArm = target === 'aarch64';
const suffix = isArm ? 'apple-silicon' : 'intel';

const bundleDir = isArm
  ? path.join(root, 'src-tauri', 'target', 'release', 'bundle')
  : path.join(root, 'src-tauri', 'target', 'x86_64-apple-darwin', 'release', 'bundle');

const dmgDir = path.join(bundleDir, 'dmg');
const macosDir = path.join(bundleDir, 'macos');

const oldArch = isArm ? 'aarch64' : 'x64';
const oldDmg = path.join(dmgDir, `ClassNode_${version}_${oldArch}.dmg`);
const newDmg = path.join(dmgDir, `ClassNode_${version}_macos_${suffix}.dmg`);

if (fs.existsSync(oldDmg)) {
  if (fs.existsSync(newDmg)) {
    fs.rmSync(newDmg);
  }
  fs.renameSync(oldDmg, newDmg);
  console.log(`Renamed DMG: ClassNode_${version}_macos_${suffix}.dmg`);
} else {
  console.warn(`DMG not found: ${oldDmg}`);
}

const appBundle = path.join(macosDir, 'ClassNode.app');
const newApp = path.join(macosDir, `ClassNode_${version}_macos_${suffix}.app`);

if (fs.existsSync(appBundle)) {
  if (fs.existsSync(newApp)) {
    fs.rmSync(newApp, { recursive: true });
  }
  fs.renameSync(appBundle, newApp);
  console.log(`Renamed App: ClassNode_${version}_macos_${suffix}.app`);
} else {
  console.warn(`App bundle not found: ${appBundle}`);
}

// --- 重命名 updater 归档文件 ---
const tarGzOld = path.join(macosDir, 'ClassNode.app.tar.gz');
const tarGzNew = path.join(macosDir, `ClassNode_${version}_macos_${suffix}.tar.gz`);
const sigOld = path.join(macosDir, 'ClassNode.app.tar.gz.minisig');
const sigNew = path.join(macosDir, `ClassNode_${version}_macos_${suffix}.tar.gz.minisig`);

if (fs.existsSync(tarGzOld)) {
  if (fs.existsSync(tarGzNew)) fs.rmSync(tarGzNew);
  fs.renameSync(tarGzOld, tarGzNew);
  console.log(`Renamed tar.gz: ClassNode_${version}_macos_${suffix}.tar.gz`);
} else {
  console.warn(`tar.gz not found: ${tarGzOld}`);
}

if (fs.existsSync(sigOld)) {
  if (fs.existsSync(sigNew)) fs.rmSync(sigNew);
  fs.renameSync(sigOld, sigNew);
  console.log(`Renamed sig: ClassNode_${version}_macos_${suffix}.tar.gz.minisig`);
} else {
  console.warn(`Sig not found: ${sigOld}`);
}
