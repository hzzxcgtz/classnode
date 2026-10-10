import fs from 'node:fs';
import path from 'node:path';
import { root, readVersion } from './lib/project.mjs';

const mode = process.argv[2];
if (['--help', '-h'].includes(mode)) {
  console.log('用法: node scripts/package-frontend.mjs <web|desktop>');
  process.exit(0);
}
if (!['web', 'desktop'].includes(mode) || process.argv.length !== 3) throw new Error('请选择 web 或 desktop');
const source = path.join(root, 'out');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('请先执行 pnpm build');
if (mode === 'desktop') {
  const template = path.join(root, 'src-tauri/resources/dashboard.html');
  const html = fs.readFileSync(template, 'utf8').replace(/__APP_VERSION__/g, readVersion());
  fs.writeFileSync(path.join(source, 'dashboard.html'), html);
  for (const name of ['gitcode_logo.png', 'github_logo.png']) {
    const logo = path.join(root, 'public', name);
    if (fs.existsSync(logo)) fs.copyFileSync(logo, path.join(source, name));
  }
}
const destination = path.join(root, mode === 'web' ? 'server/frontend' : 'src-tauri/resources/server/frontend');
// 先完整复制到临时目录；复制失败时保留上一份可用产物。
fs.mkdirSync(path.dirname(destination), { recursive: true });
const stage = fs.mkdtempSync(`${destination}.stage-`);
try {
  fs.cpSync(source, stage, { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(stage, destination);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
console.log(`[package-frontend] out/ → ${path.relative(root, destination)}`);
