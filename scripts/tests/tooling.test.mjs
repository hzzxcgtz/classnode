import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { root } from '../lib/project.mjs';

function fixture(t, cleanup = true) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-scripts-')));
  if (cleanup) t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'scripts'), path.join(directory, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"version":"2.0.0"}\n');
  return directory;
}
function nodeScript(directory, name, args = []) {
  return spawnSync(process.execPath, [path.join(directory, 'scripts', name), ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
}

test('版本准备的帮助和无效版本不修改文件', t => {
  const directory = fixture(t);
  const before = fs.readFileSync(path.join(directory, 'package.json'), 'utf8');
  assert.equal(nodeScript(directory, 'prepare-release.mjs', ['--help']).status, 0);
  for (const args of [['1.9.9'], ['02.0.1'], ['patch', 'extra']]) {
    assert.equal(nodeScript(directory, 'prepare-release.mjs', args).status, 2);
    assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), before);
  }
});

test('版本递增同步门户文件，随后重复同步保持幂等', t => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'myportal'));
  fs.writeFileSync(path.join(directory, 'myportal/index.html'), '<link href="css/style.css?v=2.0.0-milestone"><p>v2.0.0</p>');
  fs.writeFileSync(path.join(directory, 'myportal/classnode.html'), '<link href="css/style.css?v=2.0.0-milestone"><p>v2.0.0</p>');
  fs.writeFileSync(path.join(directory, 'myportal/deploy.html'), 'ClassNode_2.0.0_macos_intel.dmg\nclassnode-2.0.0.zip\ncd classnode-2.0.0\n');
  assert.equal(nodeScript(directory, 'prepare-release.mjs', ['patch']).status, 0);
  assert.ok(fs.existsSync(path.join(directory, 'server/changelogs/v2.0.1.md')));
  for (const name of ['index.html', 'classnode.html', 'deploy.html']) {
    const file = path.join(directory, 'myportal', name);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('2.0.1'));
    assert.ok(!content.includes('2.0.0'));
    const mtime = fs.statSync(file).mtimeMs;
    assert.equal(nodeScript(directory, 'sync-version.mjs').status, 0);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
  }
});

test('测试运行器拒绝空测试集', t => {
  const directory = fixture(t);
  const result = nodeScript(directory, 'run-tests.mjs', ['client']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /未找到测试文件/);
});

test('前端复制替换旧文件，缺少输入时保留旧产物', t => {
  const directory = fixture(t);
  const destination = path.join(directory, 'server/frontend');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'stale.html'), 'old');
  assert.notEqual(nodeScript(directory, 'package-frontend.mjs', ['web']).status, 0);
  assert.ok(fs.existsSync(path.join(destination, 'stale.html')));
  fs.mkdirSync(path.join(directory, 'out'));
  fs.writeFileSync(path.join(directory, 'out/index.html'), 'new');
  assert.equal(nodeScript(directory, 'package-frontend.mjs', ['web']).status, 0);
  assert.equal(fs.readFileSync(path.join(destination, 'index.html'), 'utf8'), 'new');
  assert.equal(fs.existsSync(path.join(destination, 'stale.html')), false);
});

test('打包缺少输入时保留已有桌面资源', t => {
  const directory = fixture(t);
  fs.mkdirSync(path.join(directory, 'src/lib'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src/lib/analysis-prompt-templates.ts'), 'export const ANALYSIS_PROMPT_TEMPLATES = [];');
  const resources = path.join(directory, 'src-tauri/resources/server');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'sentinel'), 'keep');
  const result = nodeScript(directory, 'package-server.mjs', ['--target', 'aarch64-apple-darwin']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /缺少构建输入/);
  assert.equal(fs.readFileSync(path.join(resources, 'sentinel'), 'utf8'), 'keep');
});

test('安装包重命名只处理当前版本，允许重复执行，拒绝歧义', t => {
  const directory = fixture(t);
  for (const [target, folder, extension, suffix] of [
    ['aarch64-apple-darwin', 'dmg', 'dmg', 'macos_apple-silicon'],
    ['x86_64-pc-windows-msvc', 'msi', 'msi', 'windows_x64'],
  ]) {
    const bundle = path.join(directory, 'src-tauri/target', target, 'release/bundle', folder);
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, `ClassNode_1.9.9_x64.${extension}`), 'old');
    fs.writeFileSync(path.join(bundle, `ClassNode_2.0.0_x64.${extension}`), 'new');
    assert.equal(nodeScript(directory, 'rename-bundle.mjs', [target]).status, 0);
    assert.equal(nodeScript(directory, 'rename-bundle.mjs', [target]).status, 0);
    assert.equal(fs.readFileSync(path.join(bundle, `ClassNode_2.0.0_${suffix}.${extension}`), 'utf8'), 'new');
    fs.writeFileSync(path.join(bundle, `ClassNode_2.0.0_a.${extension}`), 'a');
    fs.writeFileSync(path.join(bundle, `ClassNode_2.0.0_b.${extension}`), 'b');
    assert.notEqual(nodeScript(directory, 'rename-bundle.mjs', [target]).status, 0);
  }
});

test('内置 Node 可复用两种平台缓存，无须下载或执行目标二进制', { skip: process.platform === 'win32' }, t => {
  const directory = fixture(t);
  const cache = path.join(directory, '.dev/cache/node');
  const resources = path.join(directory, 'resources');
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(resources);
  const binary = Buffer.alloc(10 * 1024 * 1024);
  binary.write('MZ');
  binary.writeUInt32LE(128, 0x3c);
  binary.write('PE\0\0', 128);
  binary.writeUInt16LE(0x8664, 132);
  fs.writeFileSync(path.join(cache, 'node-v24.18.0-win-x64.exe'), binary);
  const stem = 'node-v24.18.0-darwin-arm64';
  fs.mkdirSync(path.join(directory, stem, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(directory, stem, 'bin/node'), 'synthetic-mac-binary');
  assert.equal(spawnSync('tar', ['-czf', path.join(cache, `${stem}.tar.gz`), '-C', directory, stem]).status, 0);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { bundleNode } from './scripts/lib/node-runtime.mjs';
    globalThis.fetch = () => { throw new Error('unexpected download'); };
    await bundleNode({platform:'win32',arch:'x64'}, './resources');
    await bundleNode({platform:'darwin',arch:'arm64'}, './resources');
  `], { cwd: directory, env: { ...process.env, CLASSNODE_NODE_VERSION: '24.18.0', CLASSNODE_NODE_CACHE_DIR: cache }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(resources, 'node.exe')), binary);
  assert.equal(fs.readFileSync(path.join(resources, 'node'), 'utf8'), 'synthetic-mac-binary');
  assert.ok(fs.statSync(path.join(resources, 'node')).mode & 0o111);
});

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Shell 入口提供直接可用的命令，并正确转发目标与参数', { skip: process.platform === 'win32' }, t => {
  const directory = fixture(t);
  fs.copyFileSync(path.join(root, 'dev.sh'), path.join(directory, 'dev.sh'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pnpm'), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  const invoke = args => spawnSync('bash', [path.join(directory, 'dev.sh'), ...args], {
    cwd: os.tmpdir(), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8',
  });
  const help = invoke([]);
  assert.equal(help.status, 0);
  for (const command of ['install', 'start', 'build', 'check', 'test', 'version prepare patch']) {
    assert.ok(help.stdout.includes(`./dev.sh ${command}`));
  }
  for (const [args, forwarded] of [
    [['build'], ['build:all']],
    [['build', 'web'], ['build']],
    [['test', 'web', '--test-name-pattern=sample'], ['run', 'test:client', '--test-name-pattern=sample']],
    [['test'], ['run', 'test']],
    [['check', 'scripts'], ['check:scripts']],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), forwarded);
  }
  const installed = invoke(['install']);
  assert.equal(installed.status, 0);
  const lines = installed.stdout.trim().split('\n');
  assert.deepEqual(JSON.parse(lines[0]), ['install', '--frozen-lockfile']);
  assert.deepEqual(JSON.parse(lines[1]), ['--filter', 'classnode-server', 'db:generate']);
  for (const args of [['build', 'typo'], ['test', 'typo'], ['check', 'typo'], ['serve']]) {
    assert.notEqual(invoke(args).status, 0);
  }
});

test('开发服务重复启动与前台异常退出清理', { skip: process.platform === 'win32', timeout: 30000 }, async t => {
  const directory = fixture(t, false);
  fs.copyFileSync(path.join(root, 'dev.sh'), path.join(directory, 'dev.sh'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pnpm'), '#!/usr/bin/env bash\nexec node "$PWD/mock-service.cjs" "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(directory, 'mock-service.cjs'), `
    const net = require('node:net');
    if (process.argv.includes('dev') && process.env.MOCK_FAIL_CLIENT) process.exit(7);
    const ports = [process.env.PORT];
    if (process.argv.includes('dev:server')) ports.push(process.env.CLASSNODE_WEBAPP_PORT);
    for (const port of ports) net.createServer().listen(Number(port), '127.0.0.1');
  `);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    CLASSNODE_CLIENT_PORT: String(await freePort()), CLASSNODE_SERVER_PORT: String(await freePort()), CLASSNODE_WEBAPP_PORT: String(await freePort()) };
  const command = (...args) => spawnSync('bash', [path.join(directory, 'dev.sh'), ...args], { cwd: os.tmpdir(), env, encoding: 'utf8', timeout: 15000 });
  t.after(() => { command('stop'); fs.rmSync(directory, { recursive: true, force: true }); });
  const started = command('start');
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const first = fs.readFileSync(path.join(directory, '.dev/pids/server.pid'), 'utf8');
  assert.equal(command('start').status, 0);
  assert.equal(fs.readFileSync(path.join(directory, '.dev/pids/server.pid'), 'utf8'), first);
  assert.equal(command('stop').status, 0);
  const failedStart = spawnSync('bash', [path.join(directory, 'dev.sh'), 'start'], { env: { ...env, MOCK_FAIL_CLIENT: '1' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(failedStart.status, 1, failedStart.stdout + failedStart.stderr);
  assert.equal(fs.existsSync(path.join(directory, '.dev/pids/server.pid')), false);
  const child = spawn('bash', [path.join(directory, 'dev.sh'), 'fg'], { env: { ...env, MOCK_FAIL_CLIENT: '1' }, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  const [code] = await once(child, 'exit');
  assert.equal(code, 7);
  // 等待子进程处理 TERM，再确认两个后端监听端口都已释放。
  await new Promise(resolve => setTimeout(resolve, 300));
  for (const port of [env.CLASSNODE_SERVER_PORT, env.CLASSNODE_WEBAPP_PORT]) {
    const listener = spawnSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    assert.equal(listener.stdout.trim(), '');
  }
  assert.notEqual(spawnSync('bash', [path.join(directory, 'dev.sh'), 'start'], { env: { ...env, CLASSNODE_SERVER_PORT: 'oops' } }).status, 0);
});
