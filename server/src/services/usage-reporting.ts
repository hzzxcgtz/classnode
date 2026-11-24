import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { hasTeacherSession } from '../middleware/auth.js';
import { emptyUsageCounters, MAX_USAGE_BROWSERS_PER_DAY, usageDay, validUsageId, validateUsageReport, type UsageCounter, type UsageReport } from './usage-protocol.js';

type State = { installationId: string; firstSeen: string; lastAttempt: number; lastSuccess: number; failures: number; reports: UsageReport[]; sent: Record<string, number> };
const DAY = 86400_000;
export function usageEndpoint(raw: string): string | null {
  if (!raw) return null;
  const u = new URL(raw);
  if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('使用统计接收地址须为 HTTPS，且不能包含凭据或查询参数');
  return u.href;
}
export class UsageReporting {
  private state: State;
  private readonly endpoint: string | null;
  private busy = false;
  private stopped = false;
  private dirty = false;
  private controller: AbortController | null = null;
  private readonly file: string;
  private timer?: ReturnType<typeof setInterval>;
  private readonly forcedOff: boolean;
  constructor(private options: { directory: string; version: string; endpoint?: string; enabled?: boolean; deployment?: 'desktop' | 'server'; fetcher?: typeof fetch; now?: () => number }) {
    this.file = path.join(options.directory, 'usage-reporting.json');
    this.forcedOff = options.enabled === false;
    try { this.endpoint = usageEndpoint(options.endpoint || ''); } catch { this.endpoint = null; }
    const day = usageDay(this.now());
    this.state = { installationId: randomUUID(), firstSeen: day, lastAttempt: 0, lastSuccess: 0, failures: 0, reports: [], sent: {} };
    try {
      if (fs.statSync(this.file).size <= 512 * 1024) {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as State;
        if (Array.isArray(saved.reports) && saved.reports.length <= 31 && saved.reports.every(r => r && typeof r.day === 'string' && (r.day < usageDay(this.now() - 31 * DAY) || validateUsageReport(r, this.now()))) && /^[0-9a-f-]{36}$/.test(saved.installationId) && /^\d{4}-\d{2}-\d{2}$/.test(saved.firstSeen)) {
          this.state = { ...this.state, installationId: saved.installationId, firstSeen: saved.firstSeen, reports: saved.reports.filter(r => validateUsageReport(r, this.now()) && r.installationId === saved.installationId), sent: {}, lastAttempt: Number.isFinite(saved.lastAttempt) ? Math.min(saved.lastAttempt, this.now()) : 0, lastSuccess: Number.isFinite(saved.lastSuccess) ? saved.lastSuccess : 0, failures: Math.min(6, Math.max(0, Number(saved.failures) || 0)) };
          for (const r of this.state.reports) if (Number.isInteger(saved.sent?.[r.day])) this.state.sent[r.day] = saved.sent[r.day];
        }
      }
    } catch { /* First install or invalid local cache; never interrupt teaching. */ }
    this.prune();
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private enabled() { return !this.forcedOff && !this.stopped; }
  private prune() {
    this.state.reports = this.state.reports.filter(r => r.day >= usageDay(this.now() - 30 * DAY)).slice(-31);
    this.state.sent = Object.fromEntries(this.state.reports.map(r => [r.day, this.state.sent[r.day] || 0]));
  }
  private persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file); this.dirty = false;
    } catch { /* Reporting/cache failures must not break requests. */ }
  }
  record(counters: UsageCounter[] = [], meaningful = false, browserId?: string) {
    if (!this.enabled()) return;
    this.prune();
    const day = usageDay(this.now());
    let r = this.state.reports.find(row => row.day === day);
    if (!r) {
      r = { installationId: this.state.installationId, firstSeen: this.state.firstSeen, day, version: this.options.version, platform: ['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform as UsageReport['platform'] : 'other', arch: ['arm64', 'x64'].includes(process.arch) ? process.arch as UsageReport['arch'] : 'other', deployment: this.options.deployment || 'server', active: true, revision: 1, counters: emptyUsageCounters() };
      this.state.reports.push(r); this.dirty = true;
    }
    for (const key of counters) { if (r.counters[key] < 1_000_000) { r.counters[key]++; r.revision++; this.dirty = true; } }
    if (meaningful && r.deployment === 'desktop' && !r.deviceActivity) {
      r.deviceActivity = true; r.revision++; this.dirty = true;
    }
    if (meaningful && r.deployment === 'server' && browserId) {
      const ids = Array.isArray(r.deviceActivity) ? r.deviceActivity : [];
      if (ids.length < MAX_USAGE_BROWSERS_PER_DAY && !ids.includes(browserId)) {
        r.deviceActivity = [...ids, browserId]; r.revision++; this.dirty = true;
      }
    }
    if (r.version !== this.options.version) { r.version = this.options.version; r.revision++; this.dirty = true; }
  }
  status() {
    return { enabled: this.enabled(), locked: this.forcedOff, configured: !!this.endpoint, destination: this.endpoint ? new URL(this.endpoint).origin : null, lastSuccess: this.state.lastSuccess ? new Date(this.state.lastSuccess).toISOString() : null, pendingDays: this.state.reports.filter(r => r.revision > (this.state.sent[r.day] || 0)).length };
  }
  /** Snapshot revisions are acknowledged, so new activity during a request remains pending. */
  async send() {
    if (!this.enabled() || !this.endpoint || this.busy) return;
    this.prune();
    const delay = this.state.failures ? Math.min(DAY, 3600_000 * 2 ** (this.state.failures - 1)) : DAY;
    if (this.state.lastAttempt && this.now() - this.state.lastAttempt < delay) return;
    const reports = this.state.reports.filter(r => r.revision > (this.state.sent[r.day] || 0)).map(r => ({ ...r, counters: { ...r.counters } }));
    if (!reports.length) return;
    const schema = reports.some(r => r.deviceActivity) ? 2 : 1;
    this.busy = true; this.state.lastAttempt = this.now(); this.persist();
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 5000); timeout.unref();
    try {
      const response = await (this.options.fetcher || fetch)(this.endpoint, { method: 'POST', redirect: 'error', signal: this.controller.signal, headers: { 'Content-Type': 'application/json', ...(schema === 2 ? { 'X-ClassNode-Usage-Schema': '2' } : {}) }, body: JSON.stringify({ schema, reports }) });
      if (!response.ok) throw new Error('report rejected');
      await response.body?.cancel();
      if (this.enabled()) { for (const r of reports) this.state.sent[r.day] = r.revision; this.state.lastSuccess = this.now(); this.state.failures = 0; }
    } catch { this.state.failures = Math.min(6, this.state.failures + 1); }
    finally { clearTimeout(timeout); this.controller = null; this.busy = false; this.persist(); }
  }
  start() { this.persist(); this.timer = setInterval(() => { if (this.dirty) this.persist(); void this.send(); }, 60_000); this.timer.unref(); }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.controller?.abort(); this.persist(); }
  middleware: RequestHandler = (req, res, next) => {
    const teacher = hasTeacherSession(req);
    const pathname = req.path.replace(/\/$/, '');
    // Never inspect titles, names, IDs or free-form content. Only these configuration flags are counted.
    const counters: UsageCounter[] = [];
    if (teacher && req.method === 'POST') {
      if (pathname === '/api/classroom/create' || pathname === '/api/classroom/create-advanced') {
        const advanced = pathname.endsWith('create-advanced');
        counters.push('classroomsCreated', advanced ? 'advancedClassrooms' : req.body?.mode === 'group' ? 'groupClassrooms' : 'standardClassrooms');
        const scopes = advanced && Array.isArray(req.body?.groups) ? req.body.groups : [req.body || {}];
        if (scopes.some((s: { worksheetId?: unknown; worksheetIds?: unknown[] }) => s?.worksheetId || (Array.isArray(s?.worksheetIds) && s.worksheetIds.length))) counters.push('withWorksheet');
        if (scopes.some((s: { webappId?: unknown; webappIds?: unknown[] }) => s?.webappId || (Array.isArray(s?.webappIds) && s.webappIds.length))) counters.push('withExplore');
        if (scopes.some((s: { agentId?: unknown; agentIds?: unknown[] }) => s?.agentId || (Array.isArray(s?.agentIds) && s.agentIds.length))) counters.push('withCompanion');
      }
      if (pathname === '/api/worksheets' || /^\/api\/worksheets\/[^/]+\/duplicate$/.test(pathname)) counters.push('worksheetsCreated');
    }
    if (teacher && pathname.startsWith('/api/')) {
      const meaningful = counters.length > 0
        || (req.method === 'PUT' && /^\/api\/worksheets\/[^/]+$/.test(pathname))
        || (req.method === 'POST' && /^\/api\/worksheets\/[^/]+\/analysis\/[^/]+(?:\/run)?$/.test(pathname));
      const browserId = req.get('X-ClassNode-Usage-Browser')?.toLowerCase();
      res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) this.record(counters, meaningful, validUsageId(browserId) ? browserId : undefined);
      });
    }
    next();
  };
}
