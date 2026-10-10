import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nodeVersion, root, run } from './project.mjs';

const nodeDownloadBase = process.env.CLASSNODE_NODE_DOWNLOAD_BASE || 'https://nodejs.org/dist';
const nodeMirrorBase = process.env.CLASSNODE_NODE_MIRROR_BASE || 'https://npmmirror.com/mirrors/node';
const nodeCacheDir = path.resolve(root, process.env.CLASSNODE_NODE_CACHE_DIR || '.dev/cache/node');

function validateWindowsNode(filePath, arch) {
  const data = fs.readFileSync(filePath);
  if (data.length < 10 * 1024 * 1024 || data[0] !== 0x4d || data[1] !== 0x5a) {
    throw new Error(`下载的 Node.js 不是有效的 Windows 可执行文件: ${filePath}`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 6 > data.length || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`下载的 Node.js 缺少有效的 PE 文件头: ${filePath}`);
  }
  const expectedMachine = arch === 'arm64' ? 0xaa64 : 0x8664;
  const actualMachine = data.readUInt16LE(peOffset + 4);
  if (actualMachine !== expectedMachine) {
    throw new Error(
      `Node.js 架构错误: 期望 ${arch} (0x${expectedMachine.toString(16)})，实际 0x${actualMachine.toString(16)}`,
    );
  }
}

async function cachedDownload(cacheFile, remotePath, validate) {
  fs.mkdirSync(nodeCacheDir, { recursive: true });
  if (fs.existsSync(cacheFile)) {
    try { validate(cacheFile); return; }
    catch (error) {
      console.warn(`[node-runtime] 缓存无效，将重新下载: ${error.message}`);
      fs.rmSync(cacheFile, { force: true });
    }
  }
  const temp = fs.mkdtempSync(path.join(nodeCacheDir, '.download-'));
  let lastError;
  try {
    for (const base of [...new Set([nodeDownloadBase, nodeMirrorBase])]) {
      const url = `${base.replace(/\/$/, '')}/v${nodeVersion}/${remotePath}`;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const download = path.join(temp, 'node.download');
        try {
          console.log(`[node-runtime] 下载 ${url} (${attempt}/3)`);
          const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          fs.writeFileSync(download, Buffer.from(await response.arrayBuffer()));
          validate(download);
          fs.renameSync(download, cacheFile);
          return;
        } catch (error) {
          lastError = error;
          console.warn(`[node-runtime] 下载失败: ${error.message}`);
        }
      }
    }
    throw new Error(`无法下载 Node.js v${nodeVersion}: ${lastError?.message}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export async function bundleNode(runtime, resourceDir) {
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error(`无效 Node.js 版本: ${nodeVersion}`);
  if (!['arm64', 'x64'].includes(runtime.arch)) throw new Error(`不支持的 Node.js 架构: ${runtime.arch}`);
  if (runtime.platform === 'win32') {
    const cacheFile = path.join(nodeCacheDir, `node-v${nodeVersion}-win-${runtime.arch}.exe`);
    await cachedDownload(cacheFile, `win-${runtime.arch}/node.exe`, file => validateWindowsNode(file, runtime.arch));
    fs.copyFileSync(cacheFile, path.join(resourceDir, 'node.exe'));
  } else if (runtime.platform === 'darwin') {
    const stem = `node-v${nodeVersion}-darwin-${runtime.arch}`;
    const archive = `${stem}.tar.gz`;
    const cacheFile = path.join(nodeCacheDir, archive);
    // 同时验证压缩格式和目标架构目录，防止有效 tar 包缺少正确的 Node 文件。
    await cachedDownload(cacheFile, archive, file => run('tar', ['-tzf', file, `${stem}/bin/node`], { stdio: 'ignore' }));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-node-'));
    try {
      run('tar', ['-xzf', cacheFile, '-C', temp]);
      const destination = path.join(resourceDir, 'node');
      fs.copyFileSync(path.join(temp, stem, 'bin/node'), destination);
      fs.chmodSync(destination, 0o755);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  } else {
    throw new Error(`没有配置 ${runtime.platform} 的内置 Node.js，使用 --without-node 跳过`);
  }
  console.log(`[node-runtime] v${nodeVersion}, ${runtime.platform}-${runtime.arch}`);
}
