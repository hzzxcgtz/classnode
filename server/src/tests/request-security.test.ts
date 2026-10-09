import assert from 'node:assert/strict';
import test from 'node:test';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { createTeacherSession, requireTeacher } from '../middleware/auth.js';
import { installRequestSecurity, isTrustedRequestOrigin, isLanRequestAllowed, requestCorsOptions } from '../middleware/request-security.js';
import { startWebappHost } from '../services/webapp-host.js';
import settingsRoutes from '../routes/settings.js';
import { protectSvgAsset } from '../services/svg-sanitizer.js';

const policy = { webappPort: 4002, frontendPort: 4000 };
function source(headers: IncomingMessage['headers'], remoteAddress = '127.0.0.1') {
  return { headers: { host: '127.0.0.1:4001', ...headers }, socket: { remoteAddress } } as IncomingMessage;
}
for (const origin of ['http://127.0.0.1:4001', 'http://127.0.0.1:4000', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']) {
  test(`trusted frontend/native origin ${origin}`, () => assert.equal(isTrustedRequestOrigin(source({ origin }), policy), true));
}
for (const origin of ['http://127.0.0.1:4002', 'http://evil.test:4000', 'http://127.0.0.1:5000', 'null', 'http://127.0.0.1:4001/']) {
  test(`reject foreign/hosted origin ${origin}`, () => assert.equal(isTrustedRequestOrigin(source({ origin }), policy), false));
}
test('production excludes dev frontend; native access is loopback-only; HTTPS is matched', () => {
  assert.equal(isTrustedRequestOrigin(source({ origin: 'http://127.0.0.1:4000' }), { webappPort: 4002 }), false);
  assert.equal(isTrustedRequestOrigin(source({ origin: 'tauri://localhost' }, '192.168.1.20'), policy), false);
  assert.equal(isTrustedRequestOrigin(source({ origin: 'https://127.0.0.1:4001' }), { ...policy, https: true }), true);
});
test('Referer and Fetch Metadata prevent origin-less browser bypass, CLI remains usable', () => {
  assert.equal(isTrustedRequestOrigin(source({ referer: 'http://127.0.0.1:4002/page.html' }), policy), false);
  assert.equal(isTrustedRequestOrigin(source({ referer: 'http://127.0.0.1:4001/teacher/' }), policy), true);
  for (const site of ['same-site', 'cross-site']) assert.equal(isTrustedRequestOrigin(source({ 'sec-fetch-site': site }), policy), false);
  assert.equal(isTrustedRequestOrigin(source({}), policy), true);
  assert.equal(isTrustedRequestOrigin(source({ origin: 'null', referer: 'http://127.0.0.1:4001/' }), policy), false);
});

test('real HTTP and Socket.IO reject hosted credential reads/writes and both transports', async () => {
  const app = express();
  const activePolicy = { webappPort: 1, frontendPort: 4000 };
  installRequestSecurity(app, activePolicy);
  app.post('/api/login', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); });
  let writes = 0;
  app.get('/api/private', requireTeacher, (_req, res) => res.json({ secret: true }));
  app.post('/api/private', requireTeacher, (_req, res) => { writes++; res.json({ ok: true }); });
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: (req, cb) => cb(null, requestCorsOptions(req as IncomingMessage, activePolicy)),
    allowRequest: (req, cb) => cb(null, isTrustedRequestOrigin(req, activePolicy)),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: base } });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  try {
    for (const origin of [base, 'http://127.0.0.1:4000']) {
      const response = await fetch(`${base}/api/private`, { headers: { Origin: origin, Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const response = await fetch(`${base}/api/private`, { method, headers: { Origin: 'http://127.0.0.1:1', Cookie: cookie, 'Content-Type': 'text/plain' }, body: method === 'POST' ? 'simple request' : undefined });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal(writes, 0);
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:1' } })).status, 403);
    for (const transport of ['polling', 'websocket']) {
      for (const trusted of [true, false]) {
        const socket = connect(base, { transports: [transport], extraHeaders: { Origin: trusted ? base : 'http://127.0.0.1:1', Cookie: cookie }, reconnection: false, timeout: 2000 });
        try {
          const outcome = await new Promise<string>(resolve => { socket.once('connect', () => resolve('connect')); socket.once('connect_error', () => resolve('error')); });
          assert.equal(outcome, trusted ? 'connect' : 'error', `${transport} trusted=${trusted}`);
        } finally { socket.disconnect(); }
      }
    }
  } finally { await new Promise<void>(resolve => io.close(() => resolve())); }
});

test('LAN switch applies immediately to API, static uploads, hosted files and socket reconnects', async (t) => {
  // The startup banner is outside this test's assertions. Node's older test
  // IPC parser can mistake non-ASCII stdout for a serialized result header.
  t.mock.method(console, 'log', () => {});
  const address = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
  assert.ok(address, 'a LAN interface is required to verify real non-loopback requests');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-lan-gate-'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'attachment');
  fs.writeFileSync(path.join(root, 'old.svg'), '<svg onload="alert(1)"></svg>');
  fs.writeFileSync(path.join(root, 'index.html'), '<html>hosted</html>');
  const app = express();
  app.set('lanAccessEnabled', true);
  app.set('prisma', { setting: { upsert: async ({ create }: { create: unknown }) => create } });
  const dynamicPolicy = { webappPort: 1 };
  installRequestSecurity(app, dynamicPolicy);
  app.use(express.json());
  app.use('/uploads', express.static(root, { setHeaders: protectSvgAsset }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/login', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); });
  app.use('/api/settings', settingsRoutes);
  const server = http.createServer(app);
  const io = new Server(server, { allowRequest: (req, cb) => cb(null, isTrustedRequestOrigin(req, dynamicPolicy) && isLanRequestAllowed(req.socket.remoteAddress, app.get('lanAccessEnabled'))) });
  app.set('io', io);
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const lan = `http://${address}:${port}`;
  const hosted = await startWebappHost({ port: 0, serverPort: port, lanAccessEnabled: () => app.get('lanAccessEnabled'), webappsRoot: root });
  assert.ok(hosted);
  const hostPort = (hosted.address() as AddressInfo).port;
  const cookie = (await fetch(`${base}/api/login`, { method: 'POST' })).headers.get('set-cookie')!.split(';')[0];
  const socket = connect(lan, { transports: ['websocket'], extraHeaders: { Origin: lan }, reconnection: false, timeout: 2000 });
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    assert.match((await fetch(`${base}/uploads/old.svg`)).headers.get('content-security-policy')!, /sandbox; default-src 'none'/);
    for (const enabled of [true, false, true]) {
      const disconnected = !enabled ? new Promise<string>(resolve => socket.once('disconnect', resolve)) : null;
      assert.equal((await fetch(`${base}/api/settings/lan-access`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: String(enabled) }) })).status, 200);
      if (disconnected) assert.equal(await disconnected, 'io server disconnect');
      for (const url of [`${lan}/api/health`, `${lan}/uploads/file.txt`, `http://${address}:${hostPort}/webapps/index.html`]) assert.equal((await fetch(url)).status, enabled ? 200 : 403, url);
      assert.equal((await fetch(`${base}/uploads/file.txt`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${hostPort}/webapps/index.html`)).status, 200);
      const probe = connect(lan, { transports: ['websocket'], extraHeaders: { Origin: lan }, reconnection: false, timeout: 2000 });
      try {
        const result = await new Promise<string>(resolve => { probe.once('connect', () => resolve('connect')); probe.once('connect_error', () => resolve('error')); });
        assert.equal(result, enabled ? 'connect' : 'error');
      } finally { probe.disconnect(); }
    }
  } finally {
    socket.disconnect();
    await new Promise<void>(resolve => io.close(() => resolve()));
    await new Promise<void>(resolve => hosted.close(() => resolve()));
    fs.rmSync(root, { force: true, recursive: true });
  }
});
