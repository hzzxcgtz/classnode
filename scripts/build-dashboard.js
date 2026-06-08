/**
 * 构建时复制 dashboard.html 到 frontend dist 目录
 * 跨平台兼容（macOS / Windows / Linux）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src-tauri', 'resources', 'dashboard.html');
const DEST = path.join(ROOT, 'out', 'dashboard.html');
const FRONTEND_SRC = path.join(ROOT, 'out');
const FRONTEND_DEST = path.join(ROOT, 'src-tauri', 'resources', 'server', 'frontend');

// 读取版本号
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// 1. 复制 dashboard.html 到 out/，同时注入版本号
let html = fs.readFileSync(SRC, 'utf8');
html = html.replace(/__APP_VERSION__/g, version);
fs.writeFileSync(DEST, html);
console.log(`[build] Copied dashboard.html → out/ (v${version})`);

// 2. 复制 logo 文件到 out/
for (const f of ['gitcode_logo.png', 'github_logo.png']) {
  const src = path.join(ROOT, 'public', f);
  const dst = path.join(ROOT, 'out', f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

// 3. 复制 out/ 到 server/frontend
if (fs.existsSync(FRONTEND_DEST)) {
  fs.rmSync(FRONTEND_DEST, { recursive: true, force: true });
}
fs.cpSync(FRONTEND_SRC, FRONTEND_DEST, { recursive: true });
console.log(`[build] Copied out/ → src-tauri/resources/server/frontend/`);
