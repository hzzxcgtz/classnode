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

/** localStorage 中的检测结果快照 */
interface UpdateCache {
  hasUpdate: boolean;
  latestVersion: string;
  dismissed: boolean;
  timestamp: number;
}

const CACHE_KEY = 'classnode_update_cache';

function getCache(): UpdateCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCache(data: Omit<UpdateCache, 'timestamp'>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

/** 将 API 检测结果写入缓存（保留 dismiss 状态） */
export function cacheCheckResult(result: UpgradeCheckResult) {
  const prev = getCache();
  const dismissed = prev !== null && prev.dismissed && prev.latestVersion === result.latestVersion;
  setCache({ hasUpdate: result.hasUpdate, latestVersion: result.latestVersion, dismissed });
}

/** 从缓存读取上次检测结果（页面刷新后立刻恢复） */
export function getCachedCheckResult(): { hasUpdate: boolean; latestVersion: string } | null {
  const cached = getCache();
  if (!cached) return null;
  return { hasUpdate: cached.hasUpdate, latestVersion: cached.latestVersion };
}

/** 新版本是否被用户忽略过 */
export function isUpdateDismissed(latestVersion: string): boolean {
  const cached = getCache();
  return cached !== null && cached.latestVersion === latestVersion && cached.dismissed;
}

/** 标记新版本为用户已忽略 */
export function dismissUpdate(latestVersion: string) {
  const prev = getCache();
  setCache({ hasUpdate: prev?.hasUpdate ?? false, latestVersion, dismissed: true });
}

/** 清除缓存（当用户在关于页手动检测并确认有新版本时调用） */
export function clearDismiss() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
