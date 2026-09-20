import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  refreshWebappOrigin,
  resolveWebappFile,
  resolveWebappPort,
  startWebappHost,
} from '../services/webapp-host.js';
import { SDK_PATH, injectSdk } from '../services/webapp-sdk.js';

test('resolveWebappPort 默认是服务端口 + 1', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  delete process.env.CLASSNODE_WEBAPP_PORT;
  assert.equal(resolveWebappPort(4001), 4002);
  assert.equal(resolveWebappPort(3001), 3002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 可被环境变量覆盖', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = '5555';
  assert.equal(resolveWebappPort(4001), 5555);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 忽略非法值（回落到默认）', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = 'abc';
  assert.equal(resolveWebappPort(4001), 4002);
  process.env.CLASSNODE_WEBAPP_PORT = '70000';  // 超出端口范围
  assert.equal(resolveWebappPort(4001), 4002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

// ── resolveWebappFile：中间件新负责的边界，逐条对字符串断言 ──────────────────
// 不对 HTTP 层测这些：客户端/中间层会在请求发出前折叠 '..'，「没打出穿越」证明不了什么。

const ROOT = path.resolve('/srv/webapps');

test('resolveWebappFile 接受根目录之下的正常路径', () => {
  assert.equal(resolveWebappFile(ROOT, '/probe/index.html'), path.join(ROOT, 'probe/index.html'));
  assert.equal(resolveWebappFile(ROOT, '/probe/'), path.join(ROOT, 'probe'));
  assert.equal(resolveWebappFile(ROOT, '/'), ROOT);
  assert.equal(resolveWebappFile(ROOT, '/a/b/c/style.css'), path.join(ROOT, 'a/b/c/style.css'));
});

test('resolveWebappFile 拒绝路径穿越（含编码变形）', () => {
  for (const attack of [
    '/../package.json',
    '/probe/../../package.json',
    '/probe/..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/probe/%2e%2e/%2e%2e/package.json',
    '/..',
  ]) {
    assert.equal(resolveWebappFile(ROOT, attack), null, `应当拒绝: ${attack}`);
  }
});

test('resolveWebappFile 拒绝「归一化后仍在根内」的 .. —— 不比 express.static 更松', () => {
  // express.static 对含 '..' 的路径直接拒。若这里放行，非 HTML 路径的行为就变了。
  assert.equal(resolveWebappFile(ROOT, '/probe/../other/index.html'), null);
});

test('resolveWebappFile 拒绝点文件（dotfiles: deny 语义）', () => {
  for (const attack of ['/.env', '/.hidden/x.html', '/probe/.git/config', '/%2eenv']) {
    assert.equal(resolveWebappFile(ROOT, attack), null, `应当拒绝: ${attack}`);
  }
});

test('resolveWebappFile 拒绝非法编码与 NUL', () => {
  assert.equal(resolveWebappFile(ROOT, '/%E0%A4%A'), null); // 截断的百分号编码
  assert.equal(resolveWebappFile(ROOT, '/probe/index.html%00.png'), null);
});

// ── refreshWebappOrigin：bind-ip 变更时的刷新（裁定 3）─────────────────────
// 本机只有一块网卡，端到端改 bind-ip 时源字符串**不会变**，所以「有没有真的重算」
// 在黑盒上不可判别。这里用一个受控的假 app + 假解析函数，让「传进去的是 bindIp 还是
// null」变成可观测的 —— 这正是「不要只用 value」的要害。

function fakeApp(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => { store.set(key, value); },
    store,
  };
}

test('refreshWebappOrigin 用 app 注入的端口与解析函数重算，不自己推算', async () => {
  const app = fakeApp({
    webappPort: 4002,
    // 把「自动选择」与「指定 IP」区分开，从而看出实参是 bindIp 还是 null
    resolveSelectedIp: (bindIp: string | null) => (bindIp ? bindIp : '10.0.0.9'),
    prisma: { setting: { findUnique: async () => ({ value: '192.168.1.5' }) } },
  });

  await refreshWebappOrigin(app as never);
  assert.equal(app.store.get('webappOrigin'), 'http://192.168.1.5:4002');
});

test('refreshWebappOrigin 把空串当成「自动选择」，不得拼出 http://:4002', async () => {
  const app = fakeApp({
    webappPort: 4002,
    resolveSelectedIp: (bindIp: string | null) => (bindIp ? bindIp : '10.0.0.9'),
    prisma: { setting: { findUnique: async () => ({ value: '' }) } },
  });

  await refreshWebappOrigin(app as never);
  assert.equal(app.store.get('webappOrigin'), 'http://10.0.0.9:4002');
});

test('refreshWebappOrigin 在设置读失败时按「未设置」处理且不抛', async () => {
  const app = fakeApp({
    webappPort: 3002,
    resolveSelectedIp: (bindIp: string | null) => (bindIp ? bindIp : '10.0.0.9'),
    prisma: { setting: { findUnique: async () => { throw new Error('db down'); } } },
  });

  await refreshWebappOrigin(app as never);
  assert.equal(app.store.get('webappOrigin'), 'http://10.0.0.9:3002');
});

test('refreshWebappOrigin 在依赖缺失时安全返回（不写坏缓存、不抛）', async () => {
  const app = fakeApp({ prisma: { setting: { findUnique: async () => null } } });
  await refreshWebappOrigin(app as never); // 无 webappPort
  assert.equal(app.store.get('webappOrigin'), undefined);
});

// ── 集成：真起一个托管服务，走真实 HTTP ────────────────────────────────
// port 0 = 让内核分配空闲端口，避免测试之间抢端口。

test('托管服务：HTML 经 injectSdk，非 HTML 不经手，边界一律拒绝', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-test-'));
  const sourceHtml = '<html><head><title>t</title></head><body>hi</body></html>';
  fs.mkdirSync(path.join(root, 'probe'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'probe', 'index.html'), sourceHtml);
  fs.writeFileSync(path.join(root, 'probe', 'probe.css'), 'body{color:red}');
  fs.writeFileSync(path.join(root, '.hidden', 'x.html'), '<html>secret</html>');
  // 放在 root 的**同级**，用来验证穿越确实够不到它
  fs.writeFileSync(path.join(path.dirname(root), 'cn-outside-probe.html'), '<html>outside</html>');

  const server = await startWebappHost({
    port: 0,
    serverPort: 1, // 与 port 不同即可，绕过 Ruling 4 的同端口拒绝
    lanAccessEnabled: true,
    webappsRoot: root,
  });
  assert.ok(server, '托管服务应当启动成功');
  const { port } = server.address() as AddressInfo;

  const get = (requestPath: string) => new Promise<{
    status: number; body: string; headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    // 不用 fetch：它会把 '..' 规范化掉，正好毁掉我们要测的那条。
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });

  try {
    // 1) HTML：由中间件应答 —— 契约是「响应体恰好是 injectSdk 的输出」。
    //    （T1 的 injectSdk 是恒等桩，所以这条断言此刻还不能区分「调用了」与「没调用」，
    //      T4 落地后它才真正咬合；此刻区分代码路径的是下面的 Accept-Ranges。）
    const html = await get('/webapps/probe/');
    assert.equal(html.status, 200);
    assert.equal(html.body, injectSdk(sourceHtml, { sdkPath: SDK_PATH }));
    assert.equal(html.headers['cache-control'], 'no-store');
    // 本服务绝不能被套上 X-Frame-Options，否则 iframe 直接被封死
    assert.equal(html.headers['x-frame-options'], undefined);
    // 判别式：express.static(send) 会加 Accept-Ranges/Last-Modified，中间件的 res.send 不会。
    // 这是此刻唯一能证明「HTML 不是 static 发的」的黑盒信号。
    assert.equal(html.headers['accept-ranges'], undefined, 'HTML 应由中间件应答，而不是 express.static');

    // 2) 非 HTML：仍由 express.static 应答（Accept-Ranges 在 = static 在）
    const css = await get('/webapps/probe/probe.css');
    assert.equal(css.status, 200);
    assert.equal(css.body, 'body{color:red}');
    assert.equal(css.headers['accept-ranges'], 'bytes');
    assert.equal(css.headers['x-frame-options'], undefined);

    // 3) 边界
    assert.equal((await get('/webapps/probe/../cn-outside-probe.html')).status, 404, '穿越必须被拒');
    assert.equal((await get('/webapps/%2e%2e/cn-outside-probe.html')).status, 404, '编码穿越必须被拒');
    assert.equal((await get('/webapps/.hidden/x.html')).status, 404, '点文件必须被拒');
    assert.equal((await get('/webapps/probe/missing.html')).status, 404);
    assert.equal((await get('/api/health')).status, 404, '本服务不挂任何 API');

    // 4) SDK 脚本本身仍可服务，且 no-store
    const sdk = await get('/__classnode/sdk.js');
    assert.equal(sdk.status, 200);
    assert.equal(sdk.headers['cache-control'], 'no-store');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(root), 'cn-outside-probe.html'), { force: true });
  }
});

test('托管服务：webapp 端口与服务端口相同时拒绝启动并返回 null', async () => {
  const server = await startWebappHost({
    port: 4321,
    serverPort: 4321,
    lanAccessEnabled: true,
    webappsRoot: os.tmpdir(),
  });
  assert.equal(server, null);
});
