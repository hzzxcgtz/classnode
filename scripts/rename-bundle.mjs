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
