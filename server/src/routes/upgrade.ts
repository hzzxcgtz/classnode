import { Router } from 'express';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

// 多级上游 URL：GitHub raw 优先（权威源），jsDelivr CDN 兜底
// jsDelivr 放在后面是因为 CDN 可能缓存过期版本（如测试期的 99.99.99）
const UPSTREAM_URLS = [
  'https://raw.githubusercontent.com/hzzxcgtz/classnode/main/updater/latest.json',
  'https://cdn.jsdelivr.net/gh/hzzxcgtz/classnode@main/updater/latest.json',
];

/**
 * 代理感知的 fetch——当系统设置了 https_proxy 时，Node.js 24 内置 fetch
 * 可能不兼容，退化到原生 http.request 通过代理转发。
 */
async function proxyAwareFetch(url: string, options?: { signal?: AbortSignal }): Promise<Response> {
  const proxy = process.env.https_proxy || process.env.http_proxy || '';
  if (!proxy) {
    // 无代理，直接用 fetch
    return fetch(url, options);
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const proxyUrl = new URL(proxy);

    const req = http.request({
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      method: 'GET',
      path: url, // HTTP 代理：发完整 URL
      headers: { Host: parsedUrl.hostname },
      timeout: options?.signal ? undefined : 8000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(new Response(body, {
          status: res.statusCode || 200,
          statusText: res.statusMessage || 'OK',
          headers: res.headers as Record<string, string>,
        }));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('The operation was aborted due to timeout')); });

    const ac = options?.signal;
    if (ac) {
      const onAbort = () => { req.destroy(); reject(new Error('The operation was aborted due to timeout')); };
      if (ac.aborted) { onAbort(); return; }
      ac.addEventListener('abort', onAbort);
    }

    req.end();
  });
}

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

    // 遍历上游 URL，第一个成功的返回
    let lastErr = '';
    for (const url of UPSTREAM_URLS) {
      try {
        const resp = await proxyAwareFetch(url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) {
          lastErr = `远程版本服务响应异常 (${resp.status})`;
          continue;
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
        return; // 成功返回
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        console.warn(`[upgrade/check] 上游 ${url} 失败:`, lastErr);
        // 继续尝试下一个 URL
      }
    }

    // 所有上游都失败
    console.error('[upgrade/check] 所有上游全部失败:', lastErr);
    res.status(502).json({ error: '无法连接到版本服务器，请检查网络后重试' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upgrade/check] 内部错误:', msg);
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
