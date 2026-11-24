import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { UsageReporting, usageEndpoint } from '../services/usage-reporting.js';
import { emptyUsageCounters, usageDay, validateUsageReport, type UsageReport } from '../services/usage-protocol.js';
import { createTeacherSession, requireTeacher } from '../middleware/auth.js';
const NOW = Date.parse('2026-11-19T08:00:00Z');
function fixture(): UsageReport { return { installationId: '33fd2bc7-9a6d-45c3-95eb-481335c12f15', firstSeen: '2026-11-10', day: usageDay(NOW), version: '2.2.6', platform: 'linux', arch: 'x64', deployment: 'server', active: true, revision: 2, counters: { ...emptyUsageCounters(), classroomsCreated: 1 } }; }
async function listen(server: Server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-usage-')); }
test('schema rejects arbitrary personal fields, unknown counters, invalid dates and oversized numbers', () => {
  assert.equal(validateUsageReport(fixture(), NOW), true);
  for (const patch of [{ school: 'secret' }, { version: '<script>' }, { day: '2026-02-30' }, { firstSeen: '2027-01-01' }, { revision: -1 }, { counters: { ...fixture().counters, teacherName: 1 } }, { counters: { ...fixture().counters, classroomsCreated: 1_000_001 } }]) assert.equal(validateUsageReport({ ...fixture(), ...patch }, NOW), false);
  assert.equal(usageDay(Date.parse('2026-11-18T16:00:00Z')), '2026-11-19');
  assert.throws(() => usageEndpoint('http://example.org/v1/report'));
  assert.throws(() => usageEndpoint('https://user:secret@example.org/report'));
  assert.throws(() => usageEndpoint('https://example.org/report?secret=x'));
  assert.equal(usageEndpoint('https://example.org/v1/report'), 'https://example.org/v1/report');
});
test('reporter snapshots persist across restart, counts are cumulative and stopping preserves pending data', async () => {
  const directory = temp(); let now = NOW; const payloads: { reports: UsageReport[] }[] = [];
  const fetcher = (async (_url, init) => { payloads.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); }) as typeof fetch;
  const opts = { directory, version: '2.2.6', endpoint: 'https://example.org/v1/report', now: () => now, fetcher };
  try {
    const usage = new UsageReporting(opts); usage.record(['classroomsCreated', 'withWorksheet']); await usage.send();
    assert.equal(payloads.length, 1); assert.equal(usage.status().pendingDays, 0);
    usage.record(['classroomsCreated']); await usage.send(); assert.equal(payloads.length, 1); usage.stop();
    now += 86400_000;
    const restored = new UsageReporting(opts); restored.record(['worksheetsCreated']); await restored.send();
    assert.equal(payloads.length, 2); assert.equal(payloads[1].reports.length, 2); assert.equal(payloads[1].reports[0].counters.classroomsCreated, 2);
    assert.equal(payloads[0].reports[0].installationId, payloads[1].reports[0].installationId);
    restored.record(['classroomsCreated']); restored.stop(); restored.record(['classroomsCreated']); assert.equal(restored.status().pendingDays, 1);
    now += 86400_000; await restored.send(); assert.equal(payloads.length, 2);
    assert.equal(new UsageReporting(opts).status().enabled, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('unconfigured / environment-disabled installs do not transmit; failures back off and shutdown aborts flight', async () => {
  const directory = temp(); let now = NOW; let attempts = 0;
  try {
    const missing = new UsageReporting({ directory, version: '2.2.6', fetcher: (async () => { throw Error('unexpected'); }) as typeof fetch }); missing.record(); await missing.send(); assert.equal(missing.status().configured, false);
    const disabled = new UsageReporting({ directory, version: '2.2.6', enabled: false, endpoint: 'https://example.org/report' }); disabled.record(); assert.equal(disabled.status().enabled, false); assert.equal(disabled.status().pendingDays, 0);
    fs.rmSync(directory, { recursive: true, force: true });
    const usage = new UsageReporting({ directory, version: '2.2.6', endpoint: 'https://example.org/report', now: () => now, fetcher: (async () => { attempts++; return new Response(null, { status: 503 }); }) as typeof fetch });
    usage.record(['classroomsCreated']); await usage.send(); await usage.send(); assert.equal(attempts, 1); now += 3600_000; await usage.send(); assert.equal(attempts, 2); assert.equal(usage.status().pendingDays, 1);
    let signal: AbortSignal | null = null;
    const flight = new UsageReporting({ directory: path.join(directory, 'flight'), version: '2.2.6', endpoint: 'https://example.org/report', now: () => now, fetcher: ((_url, init) => new Promise((_resolve, reject) => { signal = init?.signal as AbortSignal; signal.addEventListener('abort', () => reject(Error('aborted'))); })) as typeof fetch });
    flight.record(); const send = flight.send(); flight.stop(); await send; assert.equal((signal as unknown as AbortSignal).aborted, true); assert.equal(flight.status().pendingDays, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('real teacher middleware sends only aggregate counts and excludes failed/student requests', async () => {
  const directory = temp(); let reports: UsageReport[] = [];
  const collector = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; reports = JSON.parse(body).reports; res.end(); }); const destination = await listen(collector);
  const usage = new UsageReporting({ directory, version: '2.2.6', endpoint: destination + '/v1/report', now: () => NOW });
  const app = express(); app.use(express.json()); app.post('/login', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); }); app.use(usage.middleware);
  app.post('/api/classroom/create', requireTeacher, (req, res) => res.status(req.body.fail ? 400 : 200).json({ ok: true }));
  const server = createServer(app); const base = await listen(server);
  try {
    assert.equal((await fetch(base + '/api/usage')).status, 404);
    const login = await fetch(base + '/login', { method: 'POST' }); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const post = (body: unknown, authorized = true) => fetch(base + '/api/classroom/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    await post({ title: 'secret-class-title', studentName: 'secret-student', worksheetIds: ['w1'], agentIds: ['private-bot'] }); await post({ fail: true }); await post({}, false);
    await usage.send();
    assert.equal(reports.length, 1); assert.equal(reports[0].counters.classroomsCreated, 1); assert.equal(reports[0].counters.withWorksheet, 1);
    const cache = fs.readFileSync(path.join(directory, 'usage-reporting.json'), 'utf8'); assert.equal(/secret|private-bot|w1|studentName|title/.test(cache), false);
    assert.equal((await fetch(base + '/api/usage', { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status, 404);
  } finally { await close(server); await close(collector); usage.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('activity arriving during an upload remains pending after the earlier snapshot is acknowledged', async () => {
  const directory = temp(); let complete: ((value: Response) => void) | undefined;
  const usage = new UsageReporting({ directory, version: '2.2.6', endpoint: 'https://example.org/report', now: () => NOW, fetcher: (() => new Promise<Response>(resolve => { complete = resolve; })) as typeof fetch });
  try {
    usage.record(['classroomsCreated']); const sending = usage.send(); usage.record(['classroomsCreated']); complete!(new Response(null, { status: 200 })); await sending;
    assert.equal(usage.status().pendingDays, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'usage-reporting.json'), 'utf8'));
    assert.ok(saved.sent[usageDay(NOW)] < saved.reports[0].revision);
  } finally { usage.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('device activity ignores polling, deduplicates browser IDs and persists desktop activity', async () => {
  const directory = temp();
  const browser = 'a7e03d15-cb16-451a-ad05-905a46dc943d';
  const other = '585e9318-c11f-4d20-ad04-1ae769ae8a35';
  const usage = new UsageReporting({ directory, version: '2.2.7', now: () => NOW });
  const app = express();
  app.post('/login', (_req, res) => { createTeacherSession(res); res.end(); });
  app.use(usage.middleware);
  app.get('/api/poll', (_req, res) => { res.end(); });
  app.put('/api/worksheets/sample', (_req, res) => { res.end(); });
  const server = createServer(app);
  const base = await listen(server);
  try {
    const login = await fetch(base + '/login', { method: 'POST' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = (id: string) => ({ Cookie: cookie, 'X-ClassNode-Usage-Browser': id });
    await fetch(base + '/api/poll', { headers: headers(other) });
    await fetch(base + '/api/worksheets/sample', { method: 'PUT', headers: headers(browser) });
    await fetch(base + '/api/worksheets/sample', { method: 'PUT', headers: headers(browser) });
    usage.stop();
    const cache = JSON.parse(fs.readFileSync(path.join(directory, 'usage-reporting.json'), 'utf8'));
    assert.deepEqual(cache.reports[0].deviceActivity, [browser]);

    const desktop = new UsageReporting({ directory: path.join(directory, 'desktop'), version: '2.2.7', now: () => NOW, deployment: 'desktop' });
    desktop.record([], true, browser);
    desktop.record([], true, other);
    desktop.stop();
    const desktopCache = JSON.parse(fs.readFileSync(path.join(directory, 'desktop', 'usage-reporting.json'), 'utf8'));
    assert.equal(desktopCache.reports[0].deviceActivity, true);
    assert.equal(desktopCache.reports[0].revision, 2);
  } finally {
    await close(server);
    usage.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
