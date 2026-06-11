#!/usr/bin/env node

/**
 * ClassNode — AI 互动课堂系统
 * 一键启动脚本（Linux 平台）
 *
 * Windows / macOS 用户建议使用安装包（Release 页面下载）。
 */

const { spawn } = require('child_process');
const { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname);
const SERVER = resolve(ROOT, 'server');
const PORT = 3001;

const C = process.platform === 'win32' ? {} : {
  r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m',
  gr: '\x1b[90m', B: '\x1b[1m', R: '\x1b[0m',
};
function log(icon, msg) { console.log(`  ${C.B || ''}${icon}${C.R || ''}  ${msg}`); }
function line() { console.log(''); }
function hr() { console.log(`  ${C.gr || ''}${'─'.repeat(48)}${C.R || ''}`); }

function run(cmd, cwd) {
  return new Promise((resolve_, reject) => {
    const env = { ...process.env, NPM_CONFIG_LOGLEVEL: 'error' };
    const proc = spawn(cmd, [], { cwd, stdio: 'inherit', shell: true, env });
    proc.on('close', code => code === 0 ? resolve_() : reject(new Error(`退出码 ${code}`)));
    proc.on('error', reject);
  });
}

async function step(cmd, cwd, label) {
  log('⏳', label);
  try {
    await run(cmd, cwd);
    log('✅', label);
  } catch (e) {
    log('❌', label);
    throw new Error(label + ' 失败');
  }
}

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
    console.error('  ❌ Node.js 版本过低（' + ver + '），需要 >= 18');
    process.exit(1);
  }
  log('', 'Node.js  ' + ver);
  line();

  // 2. 安装依赖
  log('📦', '安装项目依赖');
  line();
  if (!existsSync(resolve(ROOT, 'node_modules')))
    await step('npm install --no-fund --no-audit', ROOT, '前端依赖');
  else
    log('', '前端依赖  已存在');
  if (!existsSync(resolve(SERVER, 'node_modules')))
    await step('npm install --no-fund --no-audit', SERVER, '服务端依赖');
  else
    log('', '服务端依赖 已存在');
  line();

  // 3. 数据库初始化
  log('🗄️ ', '初始化数据库');
  line();
  if (!existsSync(resolve(SERVER, 'node_modules', 'prisma', 'build', 'index.js'))) {
    log('❌', 'Prisma 未安装');
    process.exit(1);
  }
  await step('npx prisma generate', SERVER, '生成 Prisma 客户端');

  await step('npx prisma db push --accept-data-loss', SERVER, '同步数据库 schema 至最新');
  line();

  // 4. 编译后端
  log('🔧', '编译服务端');
  line();
  await step('npx tsc', SERVER, 'TypeScript 编译');
  line();

  // 5. 构建前端
  log('🏗️ ', '构建前端');
  line();
  await step('npx next build', ROOT, 'Next.js 构建');
  const outDir = resolve(ROOT, 'out');
  const frontendDir = resolve(SERVER, 'frontend');
  if (existsSync(outDir)) {
    if (!existsSync(frontendDir)) mkdirSync(frontendDir, { recursive: true });
    cpSync(outDir, frontendDir, { recursive: true });
    log('', '前端文件  已复制');
  }
  line();

  // 6. 启动
  log('🚀', '启动服务');
  line();
  hr();
  console.log(`  ${C.B || ''}${C.g || ''}  ✓  ClassNode 已就绪${C.R || ''}`);
  hr();
  console.log('');
  console.log('  教师端  http://localhost:' + PORT + '/teacher');
  console.log('  学生端  http://localhost:' + PORT + '/classroom');
  console.log('');
  console.log('  ' + (C.gr || '') + '按 Ctrl+C 停止服务' + (C.R || ''));
  line();

  const server = spawn('node', [resolve(SERVER, 'dist', 'index.js')],
    { cwd: SERVER, stdio: 'inherit' });

  // 轮询等待服务就绪后打开浏览器
  const url = 'http://localhost:' + PORT + '/teacher';
  const poll = setInterval(() => {
    const http = require('http');
    http.get(url, res => {
      if (res.statusCode === 200) {
        clearInterval(poll);
        try { spawn('xdg-open', [url]); } catch {}
      }
    }).on('error', () => {});
  }, 800);

  server.on('exit', () => process.exit(0));
  process.on('SIGINT', () => { server.kill(); process.exit(0); });
  process.on('SIGTERM', () => { server.kill(); process.exit(0); });
}

main().catch(err => {
  console.error('\n  ❌  ' + (err.message || '未知错误'));
  process.exit(1);
});
