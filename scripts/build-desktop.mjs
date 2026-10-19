import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { root, requireRuntime, run } from './lib/project.mjs';
import { macIconBuildOptions } from './lib/macos-icon.mjs';

const targets = {
  'aarch64-apple-darwin': { platform: 'darwin', bundle: 'dmg' },
  'x86_64-apple-darwin': { platform: 'darwin', bundle: 'dmg' },
  'x86_64-pc-windows-msvc': { platform: 'win32', bundle: 'msi' },
  'aarch64-pc-windows-msvc': { platform: 'win32', bundle: 'msi' },
};
let target;
let withoutNode = false;
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`用法: node scripts/build-desktop.mjs [--target <Rust target>] [--without-node]\n目标: ${Object.keys(targets).join(', ')}\n默认使用 rustc 的本机目标。Node.js 下载设置见 scripts/README.md。`);
  process.exit(0);
}
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--target' && args[index + 1]) target = args[++index];
  else if (args[index] === '--without-node') withoutNode = true;
  else throw new Error(`未知或不完整的参数: ${args[index]}`);
}
requireRuntime();
target ||= /^host: (.+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
const config = targets[target];
if (!config) throw new Error(`不支持的桌面目标: ${target}`);
if (config.platform !== process.platform) throw new Error(`目标 ${target} 需要在 ${config.platform} 上构建；Windows 远程构建使用 ./release.sh windows`);
const iconOptions = config.platform === 'darwin'
  ? macIconBuildOptions(JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.macos.conf.json'), 'utf8')).bundle.icon)
  : { args: [], warning: null };
if (iconOptions.warning) console.warn(`[build-desktop] ${iconOptions.warning}`);
run('rustc', ['--version']);
console.log(`[build-desktop] ${target}`);
run('pnpm', ['build']);
run('pnpm', ['build:server']);
run(process.execPath, [path.join(root, 'scripts/package-server.mjs'), '--target', target, ...(withoutNode ? ['--without-node'] : [])]);
run('pnpm', ['tauri', 'build', '--target', target, ...(config.platform === 'win32' ? ['--bundles', config.bundle] : []), ...iconOptions.args]);
run(process.execPath, [path.join(root, 'scripts/rename-bundle.mjs'), target]);
