#!/usr/bin/env node

/**
 * ClassNode — AI 互动课堂系统
 * 通用启动脚本（Windows / macOS / Linux）
 *
 * 终端用户只需安装 Node.js，运行 node start.js 即可自动完成：
 *   依赖安装 → 数据库初始化 → 服务端编译 → 前端构建 → 启动
 */

const { execSync, spawn } = require('child_process');
const { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync } = require('fs');
const { resolve } = require('path');

// ── 常量 ──────────────────────────────────────────
const ROOT = resolve(__dirname);
const SERVER = resolve(ROOT, 'server');
const FRONTEND_PORT = 3000;
const BACKEND_PORT = 3001;

// ── 终端颜色 ──────────────────────────────────────
const C = process.platform === 'win32' ? {} : {
  r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m',
  m: '\x1b[35m', c: '\x1b[36m', gr: '\x1b[90m',
  B: '\x1b[1m', D: '\x1b[2m', R: '\x1b[0m',
};

function log(icon, msg, detail) {
  const t = `  ${C.B || ''}${icon}${C.R || ''}  ${msg}`;
  console.log(detail ? `${t} ${C.gr || ''}${C.D || ''}${detail}${C.R || ''}` : t);
}

function line() { console.log(''); }
function hr() { console.log(`  ${C.gr || ''}${'─'.repeat(48)}${C.R || ''}`); }

// ── 工具函数 ─────────────────────────────────────
function run(cmd, cwd) {
  try {
    // Windows 上 npm/npx 是 .cmd 文件，显式补全后缀
    if (process.platform === 'win32') {
      cmd = cmd.replace(/\bnpm\b/g, 'npm.cmd').replace(/\bnpx\b/g, 'npx.cmd');
    }
    execSync(cmd, { cwd, stdio: 'inherit' });
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
}

async function runWithSpinner(cmd, cwd, label) {
  log('⏳', label);
  try {
    await run(cmd, cwd);
    log('✅', label);
  } catch (e) {
    log('❌', label);
    const msg = (e.stderr && e.stderr.toString().trim().slice(0, 200)) || e.message || '';
    throw new Error(`${label} 失败${msg ? ': ' + msg : ''}`);
  }
}

// ── 主流程 ────────────────────────────────────────
async function main() {
  console.log('');
  hr();
  console.log(`  ${C.B || ''}${C.b || ''}  ClassNode  —  AI 互动课堂系统${C.R || ''}`);
  console.log(`  ${C.gr || ''}  一键启动脚本${C.R || ''}`);
  hr();
  line();

  // 1. 环境检查
  log('🔍', '检查运行环境');
  const ver = process.version;
  const major = parseInt(ver.slice(1).split('.')[0]);
  if (major < 18) {
    log('❌', `Node.js 版本过低（${ver}），需要 >= 18`);
    process.exit(1);
  }
  log('', `Node.js  ${C.gr || ''}${ver}${C.R || ''}`);
  log('', `平台     ${C.gr || ''}${process.platform}${C.R || ''}`);
  line();

  // 2. 安装根目录依赖
  log('📦', '安装依赖');
  line();
  if (!existsSync(resolve(ROOT, 'node_modules'))) {
    await runWithSpinner('npm install', ROOT, '前端依赖');
  } else {
    log('', '前端依赖  已存在，跳过安装');
  }
  if (!existsSync(resolve(SERVER, 'node_modules'))) {
    await runWithSpinner('npm install', SERVER, '服务端依赖');
  } else {
    log('', '服务端依赖 已存在，跳过安装');
  }
  line();

  // 3. 数据库初始化
  log('🗄️ ', '初始化数据库');
  line();
  const hasPrisma = existsSync(resolve(SERVER, 'node_modules', 'prisma', 'build', 'index.js'));
  if (!hasPrisma) {
    log('❌', 'Prisma 未安装，请检查 npm install 是否成功');
    process.exit(1);
  }
  await runWithSpinner('npx prisma generate', SERVER, '生成 Prisma 客户端');

  // 检查 schema 版本，未升级时跳过 db push
  const versionFile = resolve(SERVER, '.schema-version');
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const currentVer = pkg.version || '';
  const savedVer = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '';
  if (savedVer === currentVer) {
    log('', `数据库 schema 已是最新 (v${currentVer})，跳过`);
  } else {
    await runWithSpinner('npx prisma db push --accept-data-loss', SERVER, '初始化数据库表');
    writeFileSync(versionFile, currentVer, 'utf8');
    log('', `schema 版本已标记 (v${currentVer})`);
  }
  line();

  // 4. 编译服务端
  log('🔧', '编译服务端');
  const hasTsc = existsSync(resolve(SERVER, 'node_modules', 'typescript', 'bin', 'tsc'));
  if (!hasTsc) {
    log('❌', 'TypeScript 未安装');
    process.exit(1);
  }
  line();
  await runWithSpinner('npx tsc', SERVER, 'TypeScript 编译');
  line();

  // 5. 构建前端
  log('🏗️ ', '构建前端');
  line();
  await runWithSpinner('npx next build', ROOT, 'Next.js 构建');
  // 复制前端产物到服务端静态目录
  const outDir = resolve(ROOT, 'out');
  const frontendDir = resolve(SERVER, 'frontend');
  if (existsSync(outDir)) {
    if (!existsSync(frontendDir)) mkdirSync(frontendDir, { recursive: true });
    cpSync(outDir, frontendDir, { recursive: true });
    log('', '前端文件  已复制到服务端目录');
  }
  line();

  // 6. 启动服务
  log('🚀', '启动服务');
  line();
  hr();
  console.log(`  ${C.B || ''}${C.g || ''}  ✓  ClassNode 已就绪${C.R || ''}`);
  hr();
  console.log('');
  console.log(`  ${C.B || ''}教师端${C.R || ''}  http://localhost:${BACKEND_PORT}/teacher`);
  console.log(`  ${C.B || ''}学生端${C.R || ''}  http://localhost:${BACKEND_PORT}/classroom`);
  console.log('');
  console.log(`  ${C.gr || ''}局域网内其他设备输入教师电脑 IP 即可访问${C.R || ''}`);
  console.log(`  ${C.gr || ''}按 Ctrl+C 停止服务${C.R || ''}`);
  line();

  // 自动打开教师页（延迟等待服务就绪）
  setTimeout(() => {
    const url = `http://localhost:${BACKEND_PORT}/teacher`;
    try {
      const plat = process.platform;
      if (plat === 'darwin') spawn('open', [url]);
      else if (plat === 'win32') spawn('cmd', ['/c', 'start', url], { shell: true });
      else spawn('xdg-open', [url]);
    } catch (e) { /* 静默处理 */ }
  }, 3000);

  // 同时启动后端和前端
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  const backend = spawn(nodeExe, [resolve(SERVER, 'dist', 'index.js')],
    { cwd: SERVER, stdio: 'inherit' });
  const frontend = spawn(nodeExe, [resolve(ROOT, 'serve-frontend.js')],
    { cwd: ROOT, stdio: 'inherit' });

  function onExit() {
    log('🛑', '正在停止服务...');
    backend.kill(); frontend.kill();
    process.exit(0);
  }
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
  backend.on('exit', onExit);
  frontend.on('exit', onExit);
}

main().catch(err => {
  console.error(`\n  ${C.r || ''}✗  ${err.message || '未知错误'}${C.R || ''}`);
  process.exit(1);
});
