/** 升级检测共享模块 */
import { getApiBaseUrl } from '@/lib/api-base';

export interface UpgradeCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  pub_date?: string;
}

/**
 * 读取服务启动时已完成的后台检测结果。
 */
export async function checkForUpdates(): Promise<UpgradeCheckResult> {
  const base = getApiBaseUrl();
  const resp = await fetch(`${base}/api/upgrade/check`, { credentials: 'include' });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<UpgradeCheckResult>;
}
