/** Browser regression for release Phase 2. Run after pnpm build:server.
 * Uses temporary files/profile, real auth/security modules and a mocked settings store.
 * No real business database or user browser profile is opened.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { installRequestSecurity, isTrustedRequestOrigin, requestCorsOptions } from '../server/dist/middleware/request-security.js';
import { requireTeacher } from '../server/dist/middleware/auth.js';
import settingsRoutes from '../server/dist/routes/settings.js';
import { hashPassword } from '../server/dist/services/password-security.js';
import { startWebappHost } from '../server/dist/services/webapp-host.js';
import { protectSvgAsset, sanitizeSvg } from '../server/dist/services/svg-sanitizer.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../server/package.json'));
const express = require('express');
const { Server } = require('socket.io');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-phase2-browser-'));
const policy = { webappPort: -1, frontendPort: -1 };
const requests = [];
const records = new Map([['admin_password', hashPassword('browser-test')], ['probe', 'original']]);
const app = express();
app.use((req, _res, next) => { requests.push({ path: req.path, method: req.method, origin: req.headers.origin, referer: req.headers.referer, cookie: Boolean(req.headers.cookie) }); next(); });
installRequestSecurity(app, policy);
app.use(express.json());
app.set('prisma', { setting: {
  findUnique: async ({ where }) => records.has(where.key) ? { key: where.key, value: records.get(where.key) } : null,
  findMany: async () => [...records].filter(([key]) => key !== 'admin_password').map(([key, value]) => ({ key, value })),
  upsert: async ({ where, update }) => { records.set(where.key, update.value); return { key: where.key, value: update.value }; },
} });
app.use('/api/settings', settingsRoutes);
let writes = 0;
app.post('/api/teacher-write', requireTeacher, (_req, res) => { writes++; res.json({ ok: true }); });
app.use('/uploads', express.static(root, { setHeaders: protectSvgAsset }));
app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><body>teacher harness</body></html>'));
const backend = http.createServer(app);
const io = new Server(backend, { cors: (req, cb) => cb(null, requestCorsOptions(req, policy)), allowRequest: (req, cb) => cb(null, isTrustedRequestOrigin(req, policy)) });
const dev = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body>dev frontend harness</body></html>'); });
let host, chrome, socket;
const pending = new Map();
let nextId = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await sleep(50); }
  throw new Error('Timed out waiting for browser');
}
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
  pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(url) { await command('Page.navigate', { url }); await waitFor(() => evaluate('document.readyState === "complete"')); }
try {
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => dev.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  policy.frontendPort = dev.address().port;
  host = await startWebappHost({ port: 0, serverPort: backend.address().port, lanAccessEnabled: true, webappsRoot: root });
  assert.ok(host);
  policy.webappPort = host.address().port;
  const hosted = `http://127.0.0.1:${policy.webappPort}`;
  fs.writeFileSync(path.join(root, 'attack.html'), `<!doctype html><html><body><script>
    (async () => {
      const base = ${JSON.stringify(base)};
      const attempt = async (url, options) => { try { const r = await fetch(base+url, {credentials:'include', ...options}); return {status:r.status,body:await r.text()}; } catch { return {blocked:true}; } };
      const results = {};
      results.read = await attempt('/api/settings', {});
      results.write = await attempt('/api/settings/probe', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'stolen'})});
      results.simple = await attempt('/api/teacher-write', {method:'POST',headers:{'Content-Type':'text/plain'},body:'simple'});
      results.noCors = await attempt('/api/teacher-write', {method:'POST',mode:'no-cors',body:'opaque'});
      results.websocket = await new Promise(resolve => { const ws = new WebSocket(base.replace('http:','ws:')+'/socket.io/?EIO=4&transport=websocket'); ws.onopen=()=>{ws.close();resolve('opened')};ws.onerror=()=>resolve('blocked');setTimeout(()=>resolve('timeout'),2000); });
      const frame = document.createElement('iframe');frame.name='form-target';document.body.append(frame);
      const form = document.createElement('form');form.action=base+'/api/teacher-write';form.method='POST';form.target='form-target';document.body.append(form);form.submit();
      setTimeout(()=>parent.postMessage({phase2:results}, ${JSON.stringify(base)}), 200);
    })();
  </script></body></html>`);
  fs.writeFileSync(path.join(root, 'old.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'/api/teacher-write\',{method:\'POST\'})"><circle r="5"/></svg>');
  chrome = spawn(process.env.CLASSNODE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(root, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeError = '';
  chrome.stderr.on('data', chunk => { chromeError += chunk.toString(); });
  chrome.on('error', error => { chromeError += error.message; });
  const endpoint = await waitFor(async () => {
    const file = path.join(root, 'profile', 'DevToolsActivePort');
    if (!fs.existsSync(file)) { if (chrome.exitCode !== null) throw new Error(chromeError); return null; }
    const port = fs.readFileSync(file, 'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return pages.find(page => page.type === 'page')?.webSocketDebuggerUrl;
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); };
  await command('Page.enable');
  await navigate(base);
  const login = await evaluate(`(async()=>{const r=await fetch('/api/settings/verify-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'browser-test'})});return {status:r.status,data:await r.json()}})()`);
  assert.equal(login.status, 200); assert.equal(login.data.verified, true);
  assert.equal(await evaluate("fetch('/api/settings').then(r=>r.status)"), 200);
  assert.equal(await evaluate("fetch('/api/settings/probe',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'trusted-production'})}).then(r=>r.status)"), 200);
  await evaluate(`window.attackResult=null;window.addEventListener('message',e=>{if(e.origin===${JSON.stringify(hosted)}&&e.data.phase2)window.attackResult=e.data.phase2});const iframe=document.createElement('iframe');iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads');iframe.src=${JSON.stringify(hosted + '/webapps/attack.html')};document.body.append(iframe);`);
  const attack = await waitFor(() => evaluate('window.attackResult'));
  assert.equal(attack.read.blocked, true); assert.equal(attack.write.blocked, true); assert.equal(attack.simple.blocked, true); assert.equal(attack.noCors.status, 0); assert.equal(attack.websocket, 'blocked');
  assert.equal(records.get('probe'), 'trusted-production'); assert.equal(writes, 0);
  const attackRequests = requests.filter(req => req.origin === hosted && req.path.startsWith('/api/'));
  assert.ok(attackRequests.some(req => req.cookie && req.method === 'GET'), 'browser actually sent the teacher cookie from hosted origin');
  assert.ok(attackRequests.some(req => req.cookie && req.method === 'POST'), 'simple/form writes really carried teacher credentials');
  // A legacy file viewed as a document and an unsaved SVG image preview cannot run script.
  const svgRequestsBefore = requests.filter(req => req.path === '/api/teacher-write').length;
  await navigate(base + '/uploads/old.svg'); await sleep(200); assert.equal(writes, 0);
  assert.equal(requests.filter(req => req.path === '/api/teacher-write').length, svgRequestsBefore, 'CSP blocks the SVG script before it sends a request');
  await navigate(base);
  const malicious = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.previewExecuted=true"><rect width="40" height="40" fill="red"/></svg>';
  const preview = await evaluate(`(async()=>{window.previewExecuted=false;const img=new Image(48,48);img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(${JSON.stringify(malicious)});document.body.append(img);await new Promise(resolve=>{img.onload=resolve;img.onerror=resolve});return {executed:window.previewExecuted,width:img.naturalWidth}})()`);
  assert.equal(preview.executed, false); assert.ok(preview.width > 0);
  const safe = sanitizeSvg('<svg viewBox="0 0 40 40"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/></svg>');
  assert.ok(safe);
  assert.equal(await evaluate(`(async()=>{const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(${JSON.stringify(safe)});await new Promise(resolve=>{img.onload=resolve;img.onerror=resolve});return img.naturalWidth>0})()`), true);
  await navigate(`http://127.0.0.1:${policy.frontendPort}`);
  const devResult = await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(base + '/api/settings')},{credentials:'include'});const w=await fetch(${JSON.stringify(base + '/api/settings/probe')},{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'trusted-dev'})});return [r.status,w.status]})()`);
  assert.deepEqual(devResult, [200, 200]); assert.equal(records.get('probe'), 'trusted-dev');
  console.log(JSON.stringify({ result: 'PASS', productionLogin: login.status, productionReadWrite: [200,200], devReadWrite: devResult, hostedAttack: attack, credentialedAttackRequests: attackRequests.filter(req=>req.cookie).length, unauthorizedWrites: writes, oldSvgScriptBlocked: true, preview, legalGradientRendered: true }, null, 2));
} finally {
  socket?.close();
  if (chrome?.pid && chrome.exitCode === null) { const closed = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await closed; }
  await new Promise(resolve => io.close(resolve));
  if (host) await new Promise(resolve => host.close(resolve));
  if (dev.listening) await new Promise(resolve => dev.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
