/**
 * Assemble the self-contained Express runtime embedded by Tauri.
 *
 * Usage: node scripts/package-server.mjs [--target <rust-triple>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceDir = path.join(root, 'src-tauri', 'resources', 'server');

function fail(message) {
  console.error(`[package-server] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { target: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--help' || argv[index] === '-h') {
      result.help = true;
    } else if (argv[index] === '--target' && argv[index + 1]) {
      result.target = argv[index + 1];
      index += 1;
    } else {
      fail(`未知或不完整的参数: ${argv[index]}`);
    }
  }
  return result;
}

function targetRuntime(target) {
  const runtimes = {
    'aarch64-apple-darwin': { platform: 'darwin', arch: 'arm64', prisma: 'darwin-arm64' },
    'x86_64-apple-darwin': { platform: 'darwin', arch: 'x64', prisma: 'darwin' },
    'x86_64-pc-windows-msvc': { platform: 'win32', arch: 'x64', prisma: 'windows' },
    'aarch64-pc-windows-msvc': { platform: 'win32', arch: 'arm64', prisma: 'windows' },
  };
  if (target && !runtimes[target]) fail(`不支持的目标平台: ${target}`);
  if (target) return runtimes[target];

  const prisma = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin')
    : process.platform === 'win32' ? 'windows' : 'native';
  return { platform: process.platform, arch: process.arch, prisma };
}

function requirePath(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`缺少构建输入: ${relativePath}`);
  return absolutePath;
}

function copy(relativeSource, relativeDestination) {
  const source = requirePath(relativeSource);
  const destination = path.join(resourceDir, relativeDestination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  console.log(`  ✓ ${relativeDestination}`);
}

function run(command, args, env = {}) {
  // Windows 的 .cmd 文件不能被 spawnSync 直接执行，会导致 EINVAL。
  // 通过 Shell 解析 npm / npx，可同时覆盖 x64 与 ARM64 构建任务。
  const result = spawnSync(command, args, {
    cwd: resourceDir,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${command} 启动失败: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} 退出码: ${result.status}`);
}

const { target, help } = parseArgs(process.argv.slice(2));
if (help) {
  console.log('用法: node scripts/package-server.mjs [--target <rust-triple>]');
  process.exit(0);
}
const runtime = targetRuntime(target);
console.log(`[package-server] 目标: ${target || `${runtime.platform}-${runtime.arch}`}`);

// Never reuse dependencies or generated files from a previous architecture.
fs.rmSync(resourceDir, { recursive: true, force: true });
fs.mkdirSync(resourceDir, { recursive: true });

console.log('[package-server] 复制运行时文件');
copy('server/dist', 'dist');
copy('server/prisma/schema.prisma', 'prisma/schema.prisma');
copy('server/changelogs', 'changelogs');
copy('server/package.json', 'package.json');
copy('out', 'frontend');
fs.writeFileSync(path.join(resourceDir, '.env'), 'DATABASE_URL="file:./dev.db"\n');

const databasePath = path.join(resourceDir, 'prisma', 'dev.db');
fs.rmSync(databasePath, { force: true });
// Prisma 6.19's schema engine can return a detail-free error while creating a
// brand-new SQLite file on current macOS. Pre-creating an empty file keeps the
// operation deterministic and is valid SQLite initialization behavior.
fs.writeFileSync(databasePath, '');
const installEnv = {
  DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}`,
  PRISMA_CLI_BINARY_TARGETS: [
    process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin') :
      process.platform === 'win32' ? 'windows' : 'native',
    runtime.prisma,
  ].filter((value, index, values) => values.indexOf(value) === index).join(','),
};

console.log('[package-server] 安装目标平台生产依赖');
run('npm', [
  'install',
  '--omit=dev',
  `--os=${runtime.platform}`,
  `--cpu=${runtime.arch}`,
  '--strict-allow-scripts',
  '--no-audit',
  '--no-fund',
], installEnv);

console.log('[package-server] 生成 Prisma Client');
run('npx', ['prisma', 'generate'], installEnv);

console.log('[package-server] 初始化内置数据库');
run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], installEnv);

for (const required of [
  'dist/index.js',
  'frontend/index.html',
  'prisma/schema.prisma',
  'prisma/dev.db',
  'node_modules/@prisma/client/package.json',
  'node_modules/prisma/build/index.js',
]) {
  if (!fs.existsSync(path.join(resourceDir, required))) fail(`打包结果不完整: ${required}`);
}

console.log('[package-server] 完成');
