/**
 * 打包服务端和前端资源到 Tauri 资源目录
 * 跨平台兼容（macOS / Windows / Linux）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RESOURCE_DIR = path.join(ROOT, 'src-tauri', 'resources', 'server');

// 清理并重新创建资源目录
if (fs.existsSync(RESOURCE_DIR)) {
  fs.rmSync(RESOURCE_DIR, { recursive: true, force: true });
}
fs.mkdirSync(RESOURCE_DIR, { recursive: true });

// 复制 server 相关文件
function copy(src, dest) {
  const destPath = path.join(RESOURCE_DIR, dest);
  if (!fs.existsSync(src)) {
    console.warn(`[package-server] WARNING: ${src} not found, skipping`);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, destPath, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(src, destPath);
  }
  console.log(`  ✓ ${dest}`);
}

console.log('\n[package-server] Copying files...');

copy('server/dist', 'dist');
copy('server/prisma/schema.prisma', 'prisma/schema.prisma');
copy('server/package.json', 'package.json');

// changelogs 可选
if (fs.existsSync('server/changelogs')) {
  copy('server/changelogs', 'changelogs');
}

// 前端静态文件
copy('out', 'frontend');

console.log('\n[package-server] Installing production dependencies...');
execSync('npm install --production', {
  cwd: RESOURCE_DIR,
  stdio: 'inherit',
});

console.log('\n[package-server] Initializing database...');
execSync('npx prisma db push', {
  cwd: RESOURCE_DIR,
  stdio: 'inherit',
});

console.log('\n[package-server] Done!');
