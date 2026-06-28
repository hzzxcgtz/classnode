/** 升级检测共享模块 */

export interface UpgradeCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  pub_date?: string;
}

export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时

/**
 * 通过服务端 API 检查更新（浏览器模式）
 */
export async function checkForUpdates(): Promise<UpgradeCheckResult> {
  const resp = await fetch('/api/upgrade/check');
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<UpgradeCheckResult>;
}

/**
 * 缓存版本比较结果（避免短时间重复弹窗）
 */
const STORAGE_KEY = 'classnode_update_cache';

function getCache(): { version: string; dismissed: boolean; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCache(version: string, dismissed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version, dismissed, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

/** 新版本是否被用户忽略过（例如关闭了提示） */
export function isUpdateDismissed(latestVersion: string): boolean {
  const cached = getCache();
  return cached !== null && cached.version === latestVersion && cached.dismissed;
}

/** 标记新版本为用户已忽略 */
export function dismissUpdate(latestVersion: string) {
  setCache(latestVersion, true);
}

/** 检查是否有新版本（可做缓存版本对比避免重复通知） */
export function hasNewVersionCached(latestVersion: string): boolean {
  const cached = getCache();
  return cached === null || cached.version !== latestVersion;
}
