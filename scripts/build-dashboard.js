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

// 1. 复制 dashboard.html 到 out/
fs.cpSync(SRC, DEST);
console.log(`[build] Copied dashboard.html → out/`);

// 2. 复制 out/ 到 server/frontend
if (fs.existsSync(FRONTEND_DEST)) {
  fs.rmSync(FRONTEND_DEST, { recursive: true, force: true });
}
fs.cpSync(FRONTEND_SRC, FRONTEND_DEST, { recursive: true });
console.log(`[build] Copied out/ → src-tauri/resources/server/frontend/`);
