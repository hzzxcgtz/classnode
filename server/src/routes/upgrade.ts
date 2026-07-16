import { Router } from 'express';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: Router = Router();

// 上游 URL：按优先级依次尝试，第一个成功的返回
const UPSTREAM_URLS = [
  'https://gitee.com/hzzxcgtz/classnode/raw/main/updater/latest.json',
  'https://raw.githubusercontent.com/hzzxcgtz/classnode/main/updater/latest.json',
];

export interface UpgradeCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  pub_date?: string;
}

let startupCheck: Promise<UpgradeCheckResult> | null = null;

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
 * 从 Gitee 或 GitHub 拉取远程 version manifest，与本地的 package.json 版本比较。
 * 返回格式：
 * {
 *   hasUpdate: boolean,
 *   currentVersion: string,
 *   latestVersion: string,
 *   notes?: string,
 *   pub_date?: string
 * }
 */
export function checkForUpdateOnStartup(): Promise<UpgradeCheckResult> {
  if (startupCheck) return startupCheck;
  startupCheck = fetchUpgradeCheck();
  return startupCheck;
}

router.get('/check', async (_req, res) => {
  try {
    res.json(await checkForUpdateOnStartup());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upgrade/check] 内部错误:', msg);
    res.status(502).json({ error: '无法连接到版本服务器，请检查网络后重试' });
  }
});

async function fetchUpgradeCheck(): Promise<UpgradeCheckResult> {
  // 读取本地版本
  const localVersion = readLocalVersion();
  if (!localVersion) throw new Error('无法读取本地版本号');

  // 并行发起两个源请求，优先用 Gitee，失败则降级到 GitHub
  const [giteeUrl, githubUrl] = UPSTREAM_URLS;
  const TIMEOUT = 8000;

  const giteePromise = proxyAwareFetch(giteeUrl, { signal: AbortSignal.timeout(TIMEOUT) })
    .then(async (resp) => {
      if (!resp.ok) throw new Error(`Gitee ${resp.status}`);
      return resp.json() as Promise<{ version: string; notes?: string; pub_date?: string }>;
    });

  const githubPromise = proxyAwareFetch(githubUrl, { signal: AbortSignal.timeout(TIMEOUT) })
    .then(async (resp) => {
      if (!resp.ok) throw new Error(`GitHub ${resp.status}`);
      return resp.json() as Promise<{ version: string; notes?: string; pub_date?: string }>;
    });

  // 优先等 Gitee
  let remote: { version: string; notes?: string; pub_date?: string };
  try {
    remote = await giteePromise;
  } catch (giteeErr) {
    console.warn('[upgrade/check] Gitee 失败，降级到 GitHub:', giteeErr instanceof Error ? giteeErr.message : String(giteeErr));
    try {
      remote = await githubPromise;
    } catch (githubErr) {
      console.error('[upgrade/check] 所有上游全部失败:', githubErr instanceof Error ? githubErr.message : String(githubErr));
      throw new Error('无法连接到版本服务器，请检查网络后重试');
    }
  }

  return {
    hasUpdate: compareVersions(remote.version, localVersion) > 0,
    currentVersion: localVersion,
    latestVersion: remote.version,
    notes: remote.notes,
    pub_date: remote.pub_date,
  };
}

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
