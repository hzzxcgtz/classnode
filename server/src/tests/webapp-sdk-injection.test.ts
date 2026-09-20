import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SDK_PATH, SDK_SOURCE, injectSdk } from '../services/webapp-sdk.js';
import { startWebappHost } from '../services/webapp-host.js';

// ── Step 1：注入 ────────────────────────────────────────────────────────

test('在 </head> 前注入', () => {
  const out = injectSdk('<html><head><title>t</title></head><body></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes(`<script src="${SDK_PATH}"></script>`));
  assert.ok(out.indexOf('sdk.js') < out.indexOf('</head>'));
});

test('大小写不敏感的 </HEAD> 也认', () => {
  const out = injectSdk('<html><HEAD></HEAD><body></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes('sdk.js'));
});

test('没有 head 时插到 <html> 之后', () => {
  const out = injectSdk('<html><body><h1>hi</h1></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes('sdk.js'));
  assert.ok(out.indexOf('sdk.js') < out.indexOf('<h1>'));
});

test('注入是幂等的 —— 已经有 SDK 就不重复插', () => {
  const once = injectSdk('<html><head></head><body></body></html>', { sdkPath: SDK_PATH });
  const twice = injectSdk(once, { sdkPath: SDK_PATH });
  assert.equal(twice, once);
  assert.equal(twice.split('sdk.js').length - 1, 1);
});

test('不是 HTML 时原样返回（不要损坏非 HTML 响应）', () => {
  const junk = '{"not":"html"}';
  assert.equal(injectSdk(junk, { sdkPath: SDK_PATH }), junk);
});

test('空字符串原样返回，不抛错', () => {
  assert.equal(injectSdk('', { sdkPath: SDK_PATH }), '');
});

// ── 注入的边界形状（brief 的六条之外，这里把兜底逐条钉住）──────────────

test('注入只插入标签，其余字节一个都不动（在 </head> 分支上）', () => {
  const html = '<html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
  const tag = `<script src="${SDK_PATH}"></script>`;
  assert.equal(injectSdk(html, { sdkPath: SDK_PATH }), html.replace('</head>', tag + '</head>'));
});

test('</HEAD >（大写 + 多余空白）也认，且插在它之前', () => {
  const html = '<html><HEAD ><title>t</title></HEAD ><body>b</body></html>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out.indexOf('sdk.js') < out.indexOf('</HEAD >'), true);
  // 标签插在闭合标签之前 ⇒ 原 HTML 其余部分一字不动
  assert.equal(out.replace(`<script src="${SDK_PATH}"></script>`, ''), html);
});

test('没有 <html> 但像 HTML 时整体前置', () => {
  const fragment = '<div><p>片段</p></div>';
  const out = injectSdk(fragment, { sdkPath: SDK_PATH });
  assert.equal(out, `<script src="${SDK_PATH}"></script>` + fragment);
});

test('带属性的 <html lang="zh"> 之后注入（不能插在标签中间）', () => {
  const html = '<html lang="zh"><body><h1>hi</h1></body></html>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out, '<html lang="zh">' + `<script src="${SDK_PATH}"></script>` + '<body><h1>hi</h1></body></html>');
});

test('教师自己写了 SDK 的 script 标签时不重复插（哪怕带查询串）', () => {
  const html = `<html><head><script src="${SDK_PATH}?v=2"></script></head><body></body></html>`;
  assert.equal(injectSdk(html, { sdkPath: SDK_PATH }), html);
});

test('没有 </head> 也没有 <html> 时，仍只前置、不改动正文', () => {
  const html = '<p>hello</p>';
  assert.equal(injectSdk(html, { sdkPath: SDK_PATH }), `<script src="${SDK_PATH}"></script>` + html);
});

// 这条**故意**断言的是「已知粗糙」而不是「正确」：正文里含标签样文本的 JSON
// 也会被那个启发式判成 HTML。之所以能接受，靠的是**调用点**的约束而不是本函数的
// 智能 —— webapp-host.ts 只对 `.html` 结尾的路径调用 injectSdk（见那里的
// `if (!target.toLowerCase().endsWith('.html')) return next();`），非 HTML 响应
// 走不到这里。把这行为钉住，是为了将来有人「顺手放宽」启发式时能看见代价。
test('已知粗糙：正文含标签样文本的 JSON 会被判成 HTML 并注入（防线在调用点）', () => {
  const json = '{"a":"<b>"}';
  const out = injectSdk(json, { sdkPath: SDK_PATH });
  assert.notEqual(out, json, '本函数分辨不了它 —— 这是记录在案的行为');
  assert.equal(out, `<script src="${SDK_PATH}"></script>` + json);
});

// ── SDK 源码：三条书写约束 ──────────────────────────────────────────────
// SDK 整体是 webapp-sdk.ts 里一个模板字符串的内容。这三条一旦被破坏，
// 后果都是**静默**的：反引号会截断模板串、插值序列会被求值、反斜杠会被吃掉一层。
// 所以它们必须是机械断言，而不是文件头的一句「请注意」。

test('SDK 源码不含反引号（它整体是模板字符串的内容）', () => {
  assert.equal(SDK_SOURCE.includes('`'), false);
});

test('SDK 源码不含插值序列（否则会变成宿主的插值）', () => {
  assert.equal(SDK_SOURCE.includes('${'), false);
});

test('SDK 源码一个反斜杠都没有（模板串会吃掉一层转义，正则简写会静默变形）', () => {
  assert.equal(SDK_SOURCE.includes('\\'), false);
  // 反面参照：这条断言不是「空文件也能过」—— 源码本身必须是有内容的。
  assert.ok(SDK_SOURCE.length > 5000, `SDK 源码太短，像是被清空了：${SDK_SOURCE.length}`);
});

test('SDK 源码能被 JS 解析器吃下去（语法错在 pnpm test 里炸，而不是在学生浏览器里炸）', () => {
  // 模板字符串里的 JS **不受 TS 检查**（TS 只把它当字符串），所以这一步是
  // 「换掉独立 .js 文件」这个选择的补偿：把语法验证挪到测试里，而且是真的验证。
  assert.doesNotThrow(() => new Function(SDK_SOURCE));
});

// ── SDK 源码：隐私红线的结构断言 ────────────────────────────────────────
// ⚠️ 这些是**结构**断言，不是行为断言。行为断言在真实浏览器里（见 T4 报告）。

/** 与 compat 闸门同款的剥注释，避免断言把 SDK 自己的注释当成代码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('红线：SDK 的代码里读到输入内容的手段一个都没有', () => {
  const code = stripComments(SDK_SOURCE);
  for (const token of ['textContent', 'innerText', 'innerHTML', 'outerHTML', 'getAttribute']) {
    assert.equal(
      code.includes(token), false,
      `SDK 代码里出现了 ${token} —— 输入/页面内容不在采集范围内（规格 §5.4）`,
    );
  }
});

test('红线：全 SDK 只有一处碰 .value，且那一处只返回长度', () => {
  const code = stripComments(SDK_SOURCE);
  const valueLines = code.split('\n').filter((line) => line.includes('.value'));
  assert.equal(
    valueLines.length, 1,
    `碰 .value 的代码行必须恰好一处，实际 ${valueLines.length} 处：\n${valueLines.join('\n')}`,
  );
  const only = valueLines[0].trim();
  assert.equal(only, 'return typeof el.value === \'string\' ? el.value.length : 0;');
  // 判别式：它所在的函数**只返回数字**。内容没有被绑定到任何可传出去的变量上。
  assert.equal(
    /function inputLength\(el\) \{\n    try \{\n      return typeof el\.value === 'string' \? el\.value\.length : 0;/
      .test(stripComments(SDK_SOURCE)),
    true,
    '那唯一的 .value 必须落在 inputLength() 里',
  );
});

test('红线：所有上报载荷都由唯一的 buildEvent 构造，且它没有内容形参', () => {
  const code = stripComments(SDK_SOURCE);
  // 唯一的构造点
  assert.equal(code.split('function buildEvent(').length - 1, 1);
  // 载荷形状是一张封闭的白名单：六项全是结构描述或页面自己画的像素
  const shape = code.slice(code.indexOf('function buildEvent('), code.indexOf('function post('));
  for (const field of ['kind:', 'selector:', 'inputType:', 'length:', 'depth:', 'to:', 'image:', 'at:']) {
    assert.ok(shape.includes(field), `buildEvent 的返回形状里缺少 ${field}`);
  }
  for (const forbidden of ['value', 'text:', 'content:', 'html:']) {
    assert.equal(shape.includes(forbidden), false, `buildEvent 里出现了不允许的字段名 ${forbidden}`);
  }
});

test('红线：事件的载荷一律经过 buildEvent —— post() 的调用点逐条对得上', () => {
  const code = stripComments(SDK_SOURCE);
  // ① 通道是**封闭**的：只允许这四种 type。多一种就意味着多一条能出门的路径。
  const types = [...code.matchAll(/post\('([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(types)].sort(), ['event', 'frame', 'ready', 'report'],
    `post() 的 type 集合变了 —— 多出来的通道没有人审查过：${types.join(', ')}`,
  );
  // ② 事件与截图两条通道的载荷**必须**由 buildEvent 生产，且各只有一个调用点。
  const eventLines = code.split('\n').filter((line) => line.includes("post('event'"));
  const frameLines = code.split('\n').filter((line) => line.includes("post('frame'"));
  assert.equal(eventLines.length, 1);
  assert.equal(frameLines.length, 1);
  assert.ok(eventLines[0].includes('buildEvent('), 'event 载荷必须来自 buildEvent');
  assert.ok(frameLines[0].includes('buildEvent('), 'frame 载荷必须来自 buildEvent');
});

test('红线：report() 只有定义、没有内部调用者 —— SDK 绝不替教师采集', () => {
  const code = stripComments(SDK_SOURCE);
  // 定义 1 次；`report: report` 那次不含左括号。任何一处**内部调用**都会让计数 > 1。
  assert.equal(
    code.split('report(').length - 1, 1,
    'report() 被 SDK 自己调用了 —— 默认采集必须永远不带上输入内容（规格 §5.4）',
  );
});

// ── SDK 源码：三条硬防护 ────────────────────────────────────────────────

test('防护 1：单条消息上限存在，且超限是**丢弃**而不是抛错', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes('var MAX_PAYLOAD_BYTES = 32 * 1024;'));
  assert.ok(/if \(encoded\.length > MAX_PAYLOAD_BYTES\) return;/.test(code));
  assert.ok(code.includes('encoded = JSON.stringify(msg);'));
  // 序列化失败（环形结构）也必须丢弃而不是往外冒
  assert.ok(/catch \(err\) \{\s*\n\s*return; \/\/ 环形结构/.test(code));
});

test('防护 2：只接受来自 parent 的消息（e.source 校验是第一道闸）', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes('if (e.source !== parent) return;'));
  // 判别式：来源校验必须在**任何**对 e.data 的读取**之前**，否则一个未知来源的
  // 消息就能先被解构再被丢掉（今天无害，改动一次就未必）。
  const listener = code.slice(code.indexOf("addEventListener('message'"));
  assert.ok(
    listener.indexOf('e.source !== parent') < listener.indexOf('e.data'),
    '来源校验必须发生在读 e.data 之前',
  );
  assert.ok(listener.includes("if (d.source !== PARENT_TAG) return;"));
});

test('防护 3：所有 postMessage 都带 source 标记，目标源是星号', () => {
  const code = stripComments(SDK_SOURCE);
  assert.equal(code.split("parent.postMessage(").length - 1, 1, 'postMessage 只能有一个出口');
  assert.ok(code.includes("parent.postMessage(msg, '*');"));
  assert.ok(code.includes("var msg = { source: SDK_TAG, type: type, payload: payload };"));
});

test('截图只走 canvas 直读（Ruling 6：P2 不引截图库）', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes("document.getElementsByTagName('canvas')"));
  assert.ok(code.includes("off.toDataURL('image/jpeg', JPEG_QUALITY)"));
  // 没有 canvas 就不发 frame —— 纯 DOM 网页的缩略图为空是**已知且已接受**的代价
  assert.ok(code.includes('if (!best || bestArea <= 0) return;'));
  // 不引任何外部库：源码里不允许出现 import / require / 动态加载
  for (const loader of ['import ', 'require(', 'createElement(\'script\')']) {
    assert.equal(code.includes(loader), false, `SDK 不应加载外部代码：${loader}`);
  }
});

test('幂等安装：脚本被加载两次时第二次直接退出', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes('if (window.__classnodeSdkInstalled) return;'));
  assert.ok(code.includes('window.__classnodeSdkInstalled = true;'));
});

// ── 端到端：源码真的送到了浏览器会请求的那个 URL 上 ─────────────────────

test('托管服务：/__classnode/sdk.js 返回的就是 SDK_SOURCE（不是占位串）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-sdk-'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<html><head><title>t</title></head><body><input id="a"></body></html>',
  );

  const server = await startWebappHost({
    port: 0,
    serverPort: 1,
    lanAccessEnabled: true,
    webappsRoot: root,
  });
  assert.ok(server);
  const { port } = server.address() as AddressInfo;

  const get = (requestPath: string) => new Promise<{ status: number; body: string; type: string | undefined }>(
    (resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body,
          type: res.headers['content-type'],
        }));
      });
      req.on('error', reject);
      req.end();
    },
  );

  try {
    const sdk = await get('/__classnode/sdk.js');
    assert.equal(sdk.status, 200);
    assert.equal(sdk.body, SDK_SOURCE, '送出去的必须就是这份源码');
    assert.ok(sdk.type?.includes('javascript'));
    // 反面参照：占位串那条路已经不存在了
    assert.equal(sdk.body.includes('实现见 Task 4'), false);

    // 网页那一侧：注入的 <script> 指向的就是它
    const page = await get('/webapps/index.html');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(`<script src="${SDK_PATH}"></script>`));
    assert.ok(page.body.indexOf(`<script src="${SDK_PATH}"></script>`) < page.body.indexOf('</head>'));
    assert.ok(page.body.includes('<input id="a">'), '注入不得改动正文');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
