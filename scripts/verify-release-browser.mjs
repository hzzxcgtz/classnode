/** Production frontend + actual server smoke test, isolated DB/data/browser profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-release-browser-'));
const bundled = process.env.CLASSNODE_VERIFY_RUNTIME;
const runtime = bundled ? path.resolve(bundled) : path.join(work, 'runtime');
const data = path.join(work, 'data');
const artifacts = process.env.CLASSNODE_VERIFY_OUTPUT || path.join(work, 'evidence');
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(data, { recursive: true });
if (!bundled) {
  fs.mkdirSync(path.join(runtime, 'prisma'), { recursive: true });
  for (const name of ['dist', 'vendor', 'changelogs']) fs.cpSync(path.join(project, 'server', name), path.join(runtime, name), { recursive: true });
  fs.cpSync(path.join(project, 'out'), path.join(runtime, 'frontend'), { recursive: true });
  fs.copyFileSync(path.join(project, 'server/prisma/schema.prisma'), path.join(runtime, 'prisma/schema.prisma'));
  fs.copyFileSync(path.join(project, 'server/package.json'), path.join(runtime, 'package.json'));
  fs.symlinkSync(path.join(project, 'server/node_modules'), path.join(runtime, 'node_modules'), 'dir');
}
const db = path.join(data, 'test.db');
const node = bundled ? path.join(runtime, 'node') : process.execPath;
const env = { ...process.env, DATABASE_URL: `file:${db}`, CLASSNODE_DATA_DIR: data, NODE_ENV: 'production' };
delete env.ENCRYPTION_KEY;
if (bundled) fs.copyFileSync(path.join(runtime, 'prisma/dev.db'), db);
else {
  fs.writeFileSync(db, '');
  execFileSync(path.join(project, 'server/node_modules/.bin/prisma'), ['db', 'push', '--skip-generate', '--schema', path.join(runtime, 'prisma/schema.prisma')], { env, stdio: 'pipe' });
}
const reservePort = async () => { const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
const port = await reservePort();
const webappPort = await reservePort();
const base = `http://127.0.0.1:${port}`;
// Keep startup update checks offline. This run never uses real AI credentials.
const offline = path.join(work, 'offline.mjs');
fs.writeFileSync(offline, `const original = globalThis.fetch; globalThis.fetch = (input, options) => { const url = new URL(typeof input === 'string' ? input : input.url || input); if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return Promise.reject(new Error('isolated acceptance: external network disabled')); return original(input, options); };`);
let backend, chrome, socket;
let log = '';
const errors = [];
const pending = new Map();
let serial = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await pause(50); } throw new Error('Acceptance timed out'); }
const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function navigate(url) { await command('Page.navigate', { url }); await waitFor(() => evaluate('document.readyState === "complete"')); }
async function api(url, method = 'GET', body) { const result = await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(url)}, {method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}credentials:'include'});return {status:r.status,body:await r.json()}})()`); assert.equal(result.status, 200, `${method} ${url}: ${JSON.stringify(result)}`); return result.body; }
async function clickText(text) { const found = await evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`); assert.ok(found, `Missing control: ${text}`); }
async function screenshot(name) { const result = await command('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64')); }
async function stop(child) { if (!child || child.exitCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill(); }); }
try {
  backend = spawn(node, ['--import', offline, 'dist/index.js'], { cwd: runtime, env: { ...env, PORT: String(port), CLASSNODE_WEBAPP_PORT: String(webappPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout.on('data', value => { log += value; }); backend.stderr.on('data', value => { log += value; });
  await waitFor(async () => { if (backend.exitCode !== null) throw new Error(log); try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 30000);
  chrome = spawn(process.env.CLASSNODE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', value => { log += value; });
  const endpoint = await waitFor(async () => { const file = path.join(work, 'profile/DevToolsActivePort'); if (!fs.existsSync(file)) return null; const debugPort = fs.readFileSync(file, 'utf8').split('\n')[0]; const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); return pages.find(page => page.type === 'page')?.webSocketDebuggerUrl; });
  socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); };
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigate(base + '/teacher/');
  await api('/api/settings/admin-password', 'POST', { password: 'candidate-test-only' });
  await api('/api/settings/verify-password', 'POST', { password: 'candidate-test-only' });
  const klass = await api('/api/classes', 'POST', { name: '验收班级' });
  await api(`/api/classes/${klass.id}/students`, 'POST', { name: '验收学生[A]' });
  const worksheet = await api('/api/worksheets', 'POST', { title: '验收学习单', content: { schemaVersion: 1, nodes: [{ id: 'q1', type: 'short-answer', prompt: '说说你的观察', inputMode: 'keyboard', data: {}, children: [] }] }, settings: { allowResubmit: true, autoGrade: false } });
  const classroom = await api('/api/classroom/create', 'POST', { title: '候选版本验收', mode: 'standard', classIds: [klass.id], agentIds: [], worksheetIds: [worksheet.id] });
  for (const page of ['dashboard', 'classes', 'agents', 'classroom', 'history']) {
    await navigate(`${base}/teacher/${page}/`);
    await waitFor(() => evaluate(`document.body.innerText.trim().length > 30`));
    await pause(150);
    assert.equal(await evaluate(`document.body.innerText.includes('Application error')`), false);
    await screenshot(`teacher-${page}`);
  }
  await navigate(`${base}/classroom/?code=${classroom.code}`);
  await waitFor(() => evaluate(`document.body.innerText.includes('验收学生[A]')`));
  await clickText('验收学生[A]'); await clickText('确认并进入');
  await waitFor(() => evaluate(`document.body.innerText.includes('验收学习单')`));
  await clickText('学习单');
  await waitFor(() => evaluate(`Boolean(document.querySelector('textarea'))`));
  const writeDraft = text => evaluate(`(()=>{const e=document.querySelector('textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`);
  await writeDraft('候选版本浏览器作答');
  await pause(2200);
  const session = await evaluate(`JSON.parse(localStorage.getItem('chat_session_${classroom.code}'))`);
  const readAnswers = () => evaluate(`fetch('/api/worksheets/${worksheet.id}/answers',{headers:{Authorization:'Bearer '+${JSON.stringify(session.token)}}}).then(r=>r.json())`);
  await waitFor(async () => (await readAnswers()).rows?.length === 1);
  await screenshot('student-answer');
  await api(`/api/worksheets/classroom/${classroom.id}/answers`, 'DELETE', { worksheetId: worksheet.id, participantId: session.studentId, questionId: 'q1' });
  await waitFor(() => evaluate(`document.querySelector('textarea')?.value === ''`));
  await pause(1800);
  assert.equal((await readAnswers()).rows.length, 0, 'Clear must remain empty after debounce');
  await writeDraft('清除后的新作答');
  await waitFor(async () => (await readAnswers()).rows?.[0]?.value?.text === '清除后的新作答');
  await screenshot('student-reanswer');
  // Storage denial must leave the current in-memory worksheet usable with an explicit warning.
  await evaluate(`Storage.prototype.setItem=function(){throw new DOMException('blocked','QuotaExceededError')};`);
  await writeDraft('存储受限仍可保存');
  await waitFor(() => evaluate(`document.body.innerText.includes('浏览器无法保存离线草稿')`));
  await waitFor(async () => (await readAnswers()).rows?.[0]?.value?.text === '存储受限仍可保存');
  await screenshot('student-storage-denied');
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  const html = await fetch(base + '/classroom/'); assert.match(html.headers.get('cache-control') || '', /no-store/);
  const result = { result: 'PASS', teacherPages: 5, studentJoin: true, answerSave: true, realtimeClearAndReanswer: true, deniedStorageStillSaves: true, runtimeExceptions: errors.length, htmlNoStore: true, viewport: '1024x768 Chrome (not Safari hardware)', realAi: false, runtime: bundled ? 'candidate app bundled Node + production dependencies + builtin DB + frontend' : 'production server + current static export; workspace dependencies via symlink', artifacts };
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (socket?.readyState === 1) { try { console.error(await evaluate('document.body.innerText')); await screenshot('failure'); } catch {} }
  throw error;
} finally {
  socket?.close(); await stop(chrome); await stop(backend);
  fs.writeFileSync(path.join(artifacts, 'runtime.log'), log);
  if (!artifacts.startsWith(work + path.sep)) fs.rmSync(work, { recursive: true, force: true });
}
