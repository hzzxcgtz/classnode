import { Router } from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/hzzxcgtz/classnode/main/updater/latest.json';

/**
 * GET /check
 *
 * 从 GitCode 拉取远程 version manifest，与本地的 package.json 版本比较。
 * 返回格式：
 * {
 *   hasUpdate: boolean,
 *   currentVersion: string,
 *   latestVersion: string,
 *   notes?: string,
 *   pub_date?: string
 * }
 */
router.get('/check', async (_req, res) => {
  try {
    // 读取本地版本
    const localVersion = readLocalVersion();
    if (!localVersion) {
      res.status(500).json({ error: '无法读取本地版本号' });
      return;
    }

    // 拉取远程 manifest（绕过系统代理环境变量）
    const savedHttpProxy = process.env.http_proxy;
    const savedHttpsProxy = process.env.https_proxy;
    const savedNoProxy = process.env.no_proxy;
    process.env.http_proxy = '';
    process.env.https_proxy = '';
    process.env.no_proxy = '*';
    let resp;
    try {
      resp = await fetch(UPSTREAM_URL, { signal: AbortSignal.timeout(8000) });
    } finally {
      // 恢复代理环境变量
      process.env.http_proxy = savedHttpProxy ?? '';
      process.env.https_proxy = savedHttpsProxy ?? '';
      process.env.no_proxy = savedNoProxy ?? '';
    }
    if (!resp.ok) {
      res.status(502).json({ error: `远程版本服务响应异常 (${resp.status})` });
      return;
    }

    const remote = await resp.json() as {
      version: string;
      notes?: string;
      pub_date?: string;
    };

    const hasUpdate = compareVersions(remote.version, localVersion) > 0;

    res.json({
      hasUpdate,
      currentVersion: localVersion,
      latestVersion: remote.version,
      notes: remote.notes,
      pub_date: remote.pub_date,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upgrade/check] 检查更新失败:', msg);
    res.status(502).json({ error: '无法连接到版本服务器，请检查网络后重试' });
  }
});

/** 从根 package.json 读取版本号 */
function readLocalVersion(): string | null {
  try {
    // 构建后 server/dist/routes/upgrade.js → server/package.json
    const candidates = [
      path.resolve(__dirname, '../../package.json'),
      path.resolve(__dirname, '../package.json'),
    ];
    for (const fp of candidates) {
      if (fs.existsSync(fp)) {
        const { version } = JSON.parse(fs.readFileSync(fp, 'utf-8')) as { version: string };
        if (version) return version;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 三目比较：a > b → 1, a < b → -1, a === b → 0 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * POST /download
 *
 * 从远程仓库下载更新包到本地 Downloads 目录。
 * 用于浏览器/Tauri 混合模式（Tauri IPC 在 localhost 不可用时）。
 */
router.post('/download', async (req, res) => {
  try {
    const { version } = req.body as { version?: string };
    if (!version) {
      res.status(400).json({ error: '缺少 version 参数' });
      return;
    }

    // 构造下载 URL（与 update-updater-manifest.mjs 保持一致的命名规则）
    const arch = process.arch === 'arm64' ? 'apple-silicon' : 'intel';
    const url = `https://github.com/hzzxcgtz/classnode/releases/download/v${version}/ClassNode_${version}_macos_${arch}.tar.gz`;

    // 下载到系统 Downloads 目录
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const downloadsDir = path.join(homeDir, 'Downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    const destPath = path.join(downloadsDir, `ClassNode_${version}_macos_${arch}.tar.gz`);

    // 如果已存在则跳过
    if (fs.existsSync(destPath)) {
      res.json({ success: true, filePath: destPath, skipped: true });
      return;
    }

    // 流式下载
    const downloadResp = await fetch(url);
    if (!downloadResp.ok) {
      res.status(502).json({ error: `下载失败 (HTTP ${downloadResp.status})` });
      return;
    }

    const totalSize = parseInt(downloadResp.headers.get('content-length') || '0', 10);
    const reader = downloadResp.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: '无法读取响应流' });
      return;
    }

    const writeStream = fs.createWriteStream(destPath);
    let downloaded = 0;

    // 使用单独的端点查询进度，这里先下载完成再返回
    // 小文件直接下载
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        downloaded += value.length;
      }
    }

    // 写入文件
    for (const chunk of chunks) {
      writeStream.write(chunk);
    }
    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`[upgrade/download] 下载完成: ${destPath} (${downloaded} bytes)`);
    res.json({
      success: true,
      filePath: destPath,
      totalBytes: totalSize,
      downloadedBytes: downloaded,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upgrade/download] 下载失败:', msg);
    res.status(502).json({ error: `下载失败: ${msg}` });
  }
});

export default router;
