import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import { ensureRoot, ensureServerCertificate, rootProfile } from '../services/lan-certificates.js';
import { LanHttps } from '../services/lan-https.js';
import { installRequestSecurity, type OriginPolicy } from '../middleware/request-security.js';
import { createTeacherSession, requireTeacher } from '../middleware/auth.js';
import { lanHttpsAdminRoutes, lanHttpsSetupRoutes } from '../routes/lan-https.js';

const listen = (server: http.Server, port = 0) => new Promise<number>(resolve => server.listen(port, '0.0.0.0', () => resolve((server.address() as { port: number }).port)));
const freePort = async () => { const server = http.createServer(); const port = await listen(server); await new Promise<void>(resolve => server.close(() => resolve())); return port; };
function request(url: string, ca?: string, options: http.RequestOptions = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).request(url, { agent: false, ca, ...options }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    }); req.on('error', reject); req.end();
  });
}

test('root identity persists, IP changes renew only leaf, corrupt/missing root is never replaced', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-pki-test-'));
  try {
    const root = await ensureRoot(dir);
    assert.equal((await ensureRoot(dir)).cert, root.cert);
    const leaf = await ensureServerCertificate(dir, root, ['192.168.1.10']);
    const cert = new X509Certificate(leaf.cert);
    assert.equal(cert.verify(new X509Certificate(root.cert).publicKey), true);
    assert.equal(cert.checkIP('192.168.1.10'), '192.168.1.10');
    assert.equal(new X509Certificate(root.cert).ca, true);
    assert.equal((await ensureServerCertificate(dir, root, ['192.168.1.10'])).cert, leaf.cert);
    const changed = await ensureServerCertificate(dir, root, ['192.168.2.20']);
    assert.notEqual(changed.cert, leaf.cert);
    assert.equal(new X509Certificate(changed.cert).checkIP('192.168.2.20'), '192.168.2.20');
    assert.equal(new X509Certificate(changed.cert).verify(new X509Certificate(root.cert).publicKey), true);
    assert.equal((await ensureRoot(dir)).cert, root.cert);
    const profile = rootProfile(root);
    assert.ok(profile.includes(new X509Certificate(root.cert).raw.toString('base64')));
    assert.ok(!profile.includes('PRIVATE KEY'));
    assert.equal(profile, rootProfile(root));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'root.json')).mode & 0o777, 0o600);
    fs.unlinkSync(path.join(dir, 'root.json'));
    await assert.rejects(ensureRoot(dir), /根证书缺失/);
    assert.equal(fs.existsSync(path.join(dir, 'root.json')), false);
    fs.writeFileSync(path.join(dir, 'root.json'), 'broken');
    await assert.rejects(ensureRoot(dir));
    assert.equal(fs.readFileSync(path.join(dir, 'root.json'), 'utf8'), 'broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HTTPS shares HTTP app and Socket.IO, verifies trusted CA, serves isolated webapps and protected admin', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-https-test-'));
  const app = express(); app.use(express.json());
  const main = http.createServer(app);
  const web = http.createServer((_req, res) => { res.end('isolated webapp'); });
  const mainPort = await listen(main); const webPort = await listen(web);
  const httpsPort = await freePort(); let webHttpsPort = await freePort(); while (webHttpsPort === httpsPort) webHttpsPort = await freePort();
  const policy: OriginPolicy = { webappPort: webPort, webappHttpsPort: webHttpsPort };
  installRequestSecurity(app, policy);
  app.get('/api/echo', (req, res) => res.json({ encrypted: req.secure, remote: req.socket.remoteAddress }));
  app.post('/api/login-test', (_req, res) => { createTeacherSession(res); res.json({ ok: true }); });
  app.use('/api/lan-https', requireTeacher, lanHttpsAdminRoutes());
  app.use('/network-setup', lanHttpsSetupRoutes());
  const sockets = new Server(main, { allowRequest: (_req, done) => done(null, true) });
  sockets.on('connection', socket => socket.on('relay-test', value => sockets.emit('notice-test', value)));
  const manager = new LanHttps({ directory: dir, main, webapp: web, httpPort: mainPort, webappHttpPort: webPort, httpsPort, webappHttpsPort: webHttpsPort, addresses: () => ['192.168.1.10'] });
  app.set('lanHttps', manager);
  t.after(async () => { manager.stop(); await new Promise<void>(resolve => sockets.close(() => resolve())); await new Promise<void>(resolve => web.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); });
  await manager.initialize(); assert.equal(fs.existsSync(path.join(dir, 'root.json')), false);
  assert.equal((await request(`http://127.0.0.1:${mainPort}/api/lan-https`, undefined)).status, 401);
  await manager.setEnabled(true);
  const root = manager.certificate();
  const secured = `https://127.0.0.1:${httpsPort}`;
  assert.equal((await request(`${secured}/api/echo`, root, { headers: { Origin: secured } })).status, 200);
  assert.equal(JSON.parse((await request(`${secured}/api/echo`, root)).body).encrypted, true);
  assert.equal((await request(`http://127.0.0.1:${mainPort}/api/echo`, undefined, { headers: { Origin: `http://127.0.0.1:${mainPort}` } })).status, 200);
  assert.equal((await request(`${secured}/api/echo`, root, { headers: { Origin: `https://127.0.0.1:${webHttpsPort}` } })).status, 403);
  assert.equal((await request(`${secured}/api/echo`, root, { headers: { Origin: `http://127.0.0.1:${httpsPort}` } })).status, 403);
  await assert.rejects(request(`${secured}/api/echo`));
  assert.equal((await request(`https://127.0.0.1:${webHttpsPort}/`, root)).body, 'isolated webapp');
  const profile = await request(`http://127.0.0.1:${mainPort}/network-setup/root.mobileconfig`);
  assert.equal(profile.status, 200); assert.match(String(profile.headers['content-type']), /apple-aspen/);
  assert.ok(!profile.body.includes('PRIVATE KEY'));
  const setup = await request(`http://127.0.0.1:${mainPort}/network-setup/?code=ABC123`);
  assert.ok(setup.body.includes(`${secured}/classroom/?code=ABC123`));
  assert.match(String(setup.headers['content-security-policy']), /img-src 'self'/);
  assert.ok(setup.body.includes('再开启证书的“完全信任”'));
  assert.ok(setup.body.includes('下载完成还不等于安装完成'));
  assert.ok(setup.body.includes('images/install.jpg'));
  assert.ok(setup.body.includes('images/trust.jpg'));
  assert.ok(setup.body.includes('images/microphone-allow.jpg'));
  const picture = await request(`http://127.0.0.1:${mainPort}/network-setup/images/install.jpg`);
  assert.equal(picture.status, 200);
  assert.match(String(picture.headers['content-type']), /image\/jpeg/);

  const login = await request(`${secured}/api/login-test`, root, { method: 'POST', headers: { Origin: secured } });
  assert.match(login.headers['set-cookie']![0], /Secure/);
  const cookie = login.headers['set-cookie']![0].split(';')[0];
  assert.equal((await request(`${secured}/api/lan-https`, root, { headers: { Cookie: cookie, Origin: secured } })).status, 200);
  const plain = client(`http://127.0.0.1:${mainPort}`, { transports: ['websocket'], reconnection: false });
  const secure = client(secured, { transports: ['websocket'], ca: root, rejectUnauthorized: true, reconnection: false });
  t.after(() => { plain.disconnect(); secure.disconnect(); });
  await Promise.all([plain, secure].map(socket => new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); })));
  const received = [plain, secure].map(socket => new Promise<string>(resolve => socket.once('notice-test', resolve)));
  secure.emit('relay-test', 'shared classroom'); assert.deepEqual(await Promise.all(received), ['shared classroom', 'shared classroom']);
  plain.disconnect(); secure.disconnect();
  await manager.refresh(); assert.equal(manager.certificate(), root);
  await manager.setEnabled(false); assert.equal(manager.status().running, false);
  assert.equal((await request(`http://127.0.0.1:${mainPort}/api/echo`)).status, 200);
  await manager.setEnabled(true); assert.equal(manager.certificate(), root);
});
