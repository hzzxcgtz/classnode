import { Router } from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

const UPSTREAM_URL =
  'https://gitcode.com/weixin_41523975/classnode/raw/main/updater/latest.json';

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

export default router;
