// 兼容 Tauri 的旧 beforeBuildCommand；复制逻辑统一到 package-frontend.mjs。
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [path.join(__dirname, 'package-frontend.mjs'), 'desktop'], { stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
