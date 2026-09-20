import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  escapesWebappsRoot,
  resolveWebappFile,
  resolveWebappPort,
  startWebappHost,
  webappsRoot,
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

test('resolveWebappFile 一律拒绝含 .. 的路径，不论归一化后是否仍在根内', () => {
  // 这是本函数自己的契约，别把它读成「中间件比 express.static 更严」——
  // 端到端上这些请求会 next() 落到 static，static 是**归一化**处理的
  // （实测：/webapps/probe/../CLAMP.html 在 CLAMP.html 存在时返回 200）。
  // 见下面集成测试里那条 fall-through 断言。
  assert.equal(resolveWebappFile(ROOT, '/probe/../other/index.html'), null);
});

// ── webappsRoot：必须与 uploads 平级（规格 §5.2）────────────────────────
// 嵌进 uploads 的话，主服务把整个 uploadsDir 挂在 /uploads 上，教师上传的 HTML
// 就会在**应用自己的源**（有教师 session 与全部 /api）上可达 —— 正是 sandbox 要隔开的东西。
// 这条是判别式的：它断言的是位置关系，不是「函数能跑」。

test('webappsRoot 与 uploads 平级，绝不在 uploads 之内', () => {
  const root = webappsRoot();
  assert.equal(path.basename(root), 'webapps');
  assert.notEqual(
    path.basename(path.dirname(root)), 'uploads',
    `webappsRoot 的父目录不能是 uploads：${root}`,
  );
  assert.equal(
    root.includes(`${path.sep}uploads${path.sep}`), false,
    `webappsRoot 路径里不能出现 /uploads/ 这一段：${root}`,
  );
});

test('webappsRoot 在 CLASSNODE_DATA_DIR 下时同样与 uploads 平级', () => {
  const saved = process.env.CLASSNODE_DATA_DIR;
  process.env.CLASSNODE_DATA_DIR = path.resolve('/tmp/cn-data-dir');
  try {
    assert.equal(webappsRoot(), path.join(path.resolve('/tmp/cn-data-dir'), 'webapps'));
    assert.equal(webappsRoot().includes(`${path.sep}uploads${path.sep}`), false);
  } finally {
    if (saved === undefined) delete process.env.CLASSNODE_DATA_DIR;
    else process.env.CLASSNODE_DATA_DIR = saved;
  }
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

// ── 符号链接：托管源绝不能跟随 ────────────────────────────────────────
// 上传路径进不来符号链接（T3 实测：safeExtractZip 用 fs.writeFileSync，ZIP 里
// mode=0o120777 的条目会被摊平成普通文件）。但那是**解压器的一个隐式行为**，不是保证 ——
// 换解压实现 / 换 zip 库 / 新增一条导入路径，这个前提就静默失效。
// 补上之后不变量从「前提是上传进不来」变成「即使有也不会被跟随」。

test('resolveWebappFile 拒绝逃出根的链接（叶子与中间目录都算）；根内文件不受影响', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-sym-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-out-'));
  try {
    fs.writeFileSync(path.join(outsideDir, 'secret.html'), '<html>OUTSIDE-LEAKED</html>');
    fs.mkdirSync(path.join(root, 'probe'));
    // 阳性与阴性对照**同处一个目录**：这样「链接被拒」就不可能是「整个目录读不到」的副作用。
    fs.writeFileSync(path.join(root, 'probe', 'normal.html'), '<html>normal</html>');
    // ① 叶子是链接
    fs.symlinkSync(path.join(outsideDir, 'secret.html'), path.join(root, 'probe', 'link.html'));
    // ② **中间分量**是目录链接 —— 上一轮漏掉的形状。lstat 看不到它（只不跟随最后一个分量），
    //    所以 <root>/probe/dirlink/secret.html 会被 lstat 成普通文件而放行。
    fs.symlinkSync(outsideDir, path.join(root, 'probe', 'dirlink'));

    assert.equal(resolveWebappFile(root, '/probe/link.html'), null, '叶子链接必须被拒绝');
    assert.equal(
      resolveWebappFile(root, '/probe/dirlink/secret.html'), null,
      '中间目录是链接时也必须被拒绝（这是上一轮漏掉的形状）',
    );
    assert.equal(resolveWebappFile(root, '/probe/normal.html'), path.join(root, 'probe', 'normal.html'));

    // realpathSync 抛错（文件不存在）**不当成拒绝**：沿用本函数既有契约（返回路径，下游 404）。
    // 「文件不存在」是正常业务路径上最常见的一种，绝不能变成未捕获异常。
    assert.equal(
      resolveWebappFile(root, '/probe/missing.html'),
      path.join(root, 'probe', 'missing.html'),
      '不存在的文件仍按既有契约返回路径',
    );

    // 中间件用它区分「能安全 next() 的 null」与「必须直接 404 的 null」。
    assert.equal(escapesWebappsRoot(root, '/probe/link.html'), true);
    assert.equal(escapesWebappsRoot(root, '/probe/dirlink/secret.html'), true);
    assert.equal(escapesWebappsRoot(root, '/probe/normal.html'), false);
    assert.equal(escapesWebappsRoot(root, '/probe/../normal.html'), false, '含 .. 的一类不归它管');
    assert.equal(escapesWebappsRoot(root, '/probe/missing.html'), false, '不存在 ⇒ 不当作逃逸');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// path.sep 那条边界：只 startsWith(realRoot) 会把 <root>-evil 判成在 <root> 之下。
test('包含性判定必须带 path.sep（同前缀的兄弟目录不算在根内）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-sep-'));
  const root = path.join(base, 'root');
  const sibling = path.join(base, 'root-evil');
  try {
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'x.html'), '<html>SIBLING-LEAKED</html>');
    fs.writeFileSync(path.join(root, 'x.html'), '<html>inside</html>');
    // 从 root 里穿到同前缀的兄弟目录
    fs.symlinkSync(path.join(sibling, 'x.html'), path.join(root, 'sib.html'));

    assert.equal(
      resolveWebappFile(root, '/sib.html'), null,
      'root-evil 与 root 只是前缀相同，绝不是「在根内」——少了 path.sep 这里会放行',
    );
    assert.equal(escapesWebappsRoot(root, '/sib.html'), true);
    assert.equal(resolveWebappFile(root, '/x.html'), path.join(root, 'x.html'), '根内文件照常');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// macOS 上 /tmp 本身就是指向 /private/tmp 的链接（os.tmpdir() 走的就是它）⇒
// 只 realpath 一边会让 root 与 target 前缀对不上，**整个目录全部误判为逃逸而 404**。
// 这条用真实的 os.tmpdir() 钉住「两边都要 realpath」。
test('两边都 realpath：webappsRoot 自身含链接时不能全军覆没', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-both-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<html>inside</html>');
    assert.equal(
      resolveWebappFile(root, '/index.html'), path.join(root, 'index.html'),
      '根自身含链接时，根内的普通文件必须照常解析',
    );
    assert.equal(escapesWebappsRoot(root, '/index.html'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('托管服务：逃出根的链接返回 404（叶子 / 中间目录 / 非 HTML），根内文件仍 200', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-symhttp-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-outhttp-'));
  fs.writeFileSync(path.join(outsideDir, 'secret.html'), '<html>SECRET-HTML-LEAKED</html>');
  fs.writeFileSync(path.join(outsideDir, 'secret.css'), 'SECRET-CSS-LEAKED');
  fs.mkdirSync(path.join(root, 'probe'));
  fs.mkdirSync(path.join(root, 'normaldir'));
  fs.writeFileSync(path.join(root, 'probe', 'normal.html'), '<html><head></head><body>normal</body></html>');
  fs.writeFileSync(path.join(root, 'probe', 'normal.css'), 'body{color:red}');
  fs.writeFileSync(path.join(root, 'normaldir', 'page.html'), '<html><head></head><body>page</body></html>');
  // ① 叶子是链接
  fs.symlinkSync(path.join(outsideDir, 'secret.html'), path.join(root, 'probe', 'link.html'));
  // ② 非 HTML 的叶子链接：中间件只拦 .html，非 HTML 会 next() 落到 express.static
  fs.symlinkSync(path.join(outsideDir, 'secret.css'), path.join(root, 'probe', 'link.css'));
  // ③ **中间分量**是目录链接 —— 审查者实测出的绕过形状，也是上一轮唯一漏掉的那一种
  fs.symlinkSync(outsideDir, path.join(root, 'dirlink'));

  const server = await startWebappHost({
    port: 0,
    serverPort: 1,
    lanAccessEnabled: true,
    webappsRoot: root,
  });
  assert.ok(server);
  const { port } = server.address() as AddressInfo;
  const get = (requestPath: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });

  try {
    // 阳性对照①②：叶子链接必须 404，正文绝不能出现根外内容
    for (const p of ['/webapps/probe/link.html', '/webapps/probe/link.css']) {
      const r = await get(p);
      assert.equal(r.status, 404, `${p} 必须被拒`);
      assert.equal(r.body.includes('LEAKED'), false, `${p} 绝不能泄漏根外内容`);
    }
    // 阳性对照③：中间目录是链接（这一组就是审查者打出来的绕过）
    for (const p of ['/webapps/dirlink/secret.html', '/webapps/dirlink/secret.css']) {
      const r = await get(p);
      assert.equal(r.status, 404, `${p}（中间分量是目录链接）必须被拒`);
      assert.equal(r.body.includes('LEAKED'), false, `${p} 绝不能泄漏根外内容`);
    }

    // 阴性对照：根内的普通文件与**普通子目录**必须照常服务 ——
    // 否则上面那些 404 可能只是「整个目录服务被弄坏了」，区分不了闸门生效与服务损坏。
    const normalHtml = await get('/webapps/probe/normal.html');
    assert.equal(normalHtml.status, 200);
    assert.equal(normalHtml.body.includes('normal'), true);
    const normalCss = await get('/webapps/probe/normal.css');
    assert.equal(normalCss.status, 200);
    assert.equal(normalCss.body, 'body{color:red}');
    const normalDir = await get('/webapps/normaldir/page.html');
    assert.equal(normalDir.status, 200, '普通子目录必须照常服务');
    assert.equal(normalDir.body.includes('page'), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
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
  fs.writeFileSync(path.join(root, 'probe', 'clip.mp4'), 'not-really-mp4');
  fs.writeFileSync(path.join(root, '.hidden', 'x.html'), '<html>secret</html>');
  // 归一化后仍在**根内**，用来钉住「含 .. 的路径会 fall-through 给 static」这一事实
  fs.writeFileSync(path.join(root, 'CLAMP.html'), '<html><head></head><body>clamp</body></html>');
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
    // no-store 只该落在 HTML 上：媒体按 uuid 目录寻址，重传即换 uuid，缓存是安全的。
    // 对所有文件一律 no-store 会让老 iPad 每次刷新全量重下。
    assert.notEqual(css.headers['cache-control'], 'no-store', '非 HTML 不应带 no-store');
    const mp4 = await get('/webapps/probe/clip.mp4');
    assert.equal(mp4.status, 200);
    assert.notEqual(mp4.headers['cache-control'], 'no-store', '媒体不应带 no-store');

    // 2b) fall-through 的**判别式**证据：同一份 CLAMP.html，两条路径回答者不同。
    //     规整路径 → 中间件（无 Accept-Ranges，且经 injectSdk）
    //     含 '..' 路径 → next() 落到 express.static（有 Accept-Ranges，**绕过 injectSdk**）
    //     这正是「含 '..' 的 .html 不会被注入」的实际后果，钉住它以免将来又被误读。
    const clamped = await get('/webapps/CLAMP.html');
    assert.equal(clamped.status, 200);
    assert.equal(clamped.headers['accept-ranges'], undefined, '规整路径应由中间件应答');
    const fallThrough = await get('/webapps/probe/../CLAMP.html');
    assert.equal(fallThrough.status, 200, '归一化后仍在根内 → static 照常送出（与加中间件之前一致）');
    assert.equal(fallThrough.headers['accept-ranges'], 'bytes', '含 .. 的路径由 static 应答 → 绕过注入');

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
