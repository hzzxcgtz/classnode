/** Only aggregate numbers and fixed environment enums may leave an installation. */
export const USAGE_COUNTERS = ['classroomsCreated', 'standardClassrooms', 'groupClassrooms', 'advancedClassrooms', 'withWorksheet', 'withExplore', 'withCompanion', 'worksheetsCreated'] as const;
export type UsageCounter = typeof USAGE_COUNTERS[number];
export type UsageReport = {
  installationId: string; firstSeen: string; day: string; version: string;
  platform: 'darwin' | 'win32' | 'linux' | 'other'; arch: 'arm64' | 'x64' | 'other';
  deployment: 'desktop' | 'server'; active: boolean; revision: number;
  counters: Record<UsageCounter, number>;
  deviceActivity?: true | string[];
  activity?: { starts: number[]; operations: number[] };
};
export const emptyUsageCounters = (): UsageReport['counters'] => Object.fromEntries(USAGE_COUNTERS.map(key => [key, 0])) as UsageReport['counters'];
export function usageDay(now = Date.now()): string { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); }
function dayValid(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value; }
export const MAX_USAGE_BROWSERS_PER_DAY = 256;
export const USAGE_MINUTES_PER_DAY = 1440;
export function usageMinute(now: number): number {
  const time = new Date(now + 8 * 3600_000);
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}
export const validUsageId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function validateUsageReport(value: unknown, now = Date.now()): value is UsageReport {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as UsageReport;
    const keys = ['installationId', 'firstSeen', 'day', 'version', 'platform', 'arch', 'deployment', 'active', 'revision', 'counters'];
    if (Object.hasOwn(v, 'deviceActivity')) {
      keys.push('deviceActivity');
      if (!v.active || (v.deployment === 'desktop' ? v.deviceActivity !== true
        : !Array.isArray(v.deviceActivity) || v.deviceActivity.length === 0 ||
          v.deviceActivity.length > MAX_USAGE_BROWSERS_PER_DAY || !v.deviceActivity.every(validUsageId) ||
          new Set(v.deviceActivity).size !== v.deviceActivity.length)) return false;
    }
    if (Object.hasOwn(v, 'activity')) {
      keys.push('activity');
      const a = v.activity;
      const minutes = (values: unknown): values is number[] => Array.isArray(values)
        && values.length <= USAGE_MINUTES_PER_DAY
        && values.every(n => Number.isInteger(n) && n >= 0 && n < USAGE_MINUTES_PER_DAY);
      if (!a || Object.keys(a).length !== 2 || !minutes(a.starts) || !minutes(a.operations)
        || !(a.starts.length || a.operations.length) || (!v.active && a.operations.length)
        || new Set(a.operations).size !== a.operations.length) return false;
    }
    if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key))) return false;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.installationId)) return false;
    if (!dayValid(v.day) || !dayValid(v.firstSeen) || v.firstSeen > v.day || v.day > usageDay(now) || v.day < usageDay(now - 31 * 86400_000)) return false;
    if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]{1,24})?$/.test(v.version) || v.version.length > 40) return false;
    if (!['darwin', 'win32', 'linux', 'other'].includes(v.platform) || !['arm64', 'x64', 'other'].includes(v.arch) || !['desktop', 'server'].includes(v.deployment)) return false;
    if (typeof v.active !== 'boolean' || !Number.isInteger(v.revision) || v.revision < 1 || v.revision > 10_000_000) return false;
    if (!v.counters || Object.keys(v.counters).length !== USAGE_COUNTERS.length || Object.keys(v.counters).some(key => !(USAGE_COUNTERS as readonly string[]).includes(key))) return false;
    return USAGE_COUNTERS.every(key => Number.isInteger(v.counters[key]) && v.counters[key] >= 0 && v.counters[key] <= 1_000_000);
  } catch { return false; }
}
