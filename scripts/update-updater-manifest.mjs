/**
 * 构建后自动更新 updater/latest.json
 *
 * 在 tauri build 完成后执行：
 * 1. 查找 .tar.gz.minisig 签名文件
 * 2. 读取签名内容
 * 3. 更新 updater/latest.json（版本、签名、URL、发布日期）
 *
 * 用法:
 *   node scripts/update-updater-manifest.mjs aarch64
 *   node scripts/update-updater-manifest.mjs x86_64
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;
const target = process.argv[2] || 'aarch64'; // aarch64 | x86_64

const isArm = target === 'aarch64';
const archName = isArm ? 'apple-silicon' : 'intel';
const platformKey = isArm ? 'darwin-aarch64' : 'darwin-x86_64';

// --- 查找签名文件 ---
const bundleMacosDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos');
const altBundleDir = path.join(
  root,
  'src-tauri',
  'target',
  isArm ? 'release' : 'x86_64-apple-darwin',
  'release',
  'bundle',
  'macos',
);
const sigDir = fs.existsSync(bundleMacosDir) ? bundleMacosDir : altBundleDir;

if (!fs.existsSync(sigDir)) {
  console.error(`[update-manifest] 错误: macOS bundle 目录不存在: ${sigDir}`);
  process.exit(1);
}

const sigFiles = fs.readdirSync(sigDir).filter(f => f.endsWith('.tar.gz.sig'));
if (sigFiles.length === 0) {
  console.error(`[update-manifest] 错误: 未找到 .tar.gz.minisig 签名文件 (查找位置: ${sigDir})`);
  process.exit(1);
}

const sigPath = path.join(sigDir, sigFiles[0]);
const signature = fs.readFileSync(sigPath, 'utf-8').trim();
console.log(`[update-manifest] 签名: ${signature.substring(0, 40)}...`);

// --- 构造下载 URL ---
const url = `https://github.com/hzzxcgtz/classnode/releases/download/v${version}/ClassNode_${version}_macos_${archName}.tar.gz`;

// --- 读取现有 manifest ---
const manifestPath = path.join(root, 'updater', 'latest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// --- 更新字段 ---
manifest.version = version;
manifest.notes = `ClassNode v${version} 正式版`;
manifest.pub_date = new Date().toISOString();
manifest.platforms[platformKey] = {
  signature,
  url,
};

// --- 写回 ---
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[update-manifest] 已更新 updater/latest.json`);
console.log(`[update-manifest]   version: ${version}`);
console.log(`[update-manifest]   platform: ${platformKey}`);
console.log(`[update-manifest]   url: ${url}`);
