import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanExternalDeps } from '../services/webapp-external-deps.js';

const f = (path: string, content: string) => ({ path, content });

test('命中 HTML 里的外链 script 与 link', () => {
  const deps = scanExternalDeps([
    f('index.html', `
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/katex.min.css">
      <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
    `),
  ]);
  assert.equal(deps.length, 2);
  assert.ok(deps.every((d) => d.file === 'index.html'));
});

test('相对路径与同源绝对路径不算外部依赖', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="./app.js"></script><link href="/style.css" rel="stylesheet">'),
    f('app.js', "fetch('/api/data.json')"),
  ]);
  assert.deepEqual(deps, []);
});

test('CSS 的 @import 与 url() 都算', () => {
  const deps = scanExternalDeps([
    f('style.css', `@import url("https://fonts.googleapis.com/css2?family=Inter");
      .a { background: url(https://example.com/bg.png); }`),
  ]);
  assert.equal(deps.length, 2);
});

test('JS 里的字符串 URL 也算（fetch / import）', () => {
  const deps = scanExternalDeps([
    f('app.js', `import('https://cdn.skypack.dev/lodash');
      fetch("https://api.example.com/x");`),
  ]);
  assert.equal(deps.length, 2);
});

test('去重：同一个 URL 在多处出现只报一次', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="https://cdn.a.com/x.js"></script>'),
    f('app.js', 'const u = "https://cdn.a.com/x.js";'),
  ]);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].file, 'index.html'); // 先出现的文件
});

test('不把注释里的 URL 当依赖', () => {
  const deps = scanExternalDeps([
    f('app.js', '// 参考 https://example.com/docs\n/* https://example.com/x */'),
  ]);
  assert.deepEqual(deps, []);
});

test('排除 data: 与 blob: —— 它们是内联内容，不是外部依赖', () => {
  const deps = scanExternalDeps([
    f('style.css', '.a { background: url(data:image/png;base64,AAA); }'),
    f('app.js', 'const b = "blob:http://localhost/xxx";'),
  ]);
  assert.deepEqual(deps, []);
});

test('http 与 https 都算（局域网内的 http 服务同样会在断网时失效）', () => {
  const deps = scanExternalDeps([f('index.html', '<img src="http://10.0.0.5/logo.png">')]);
  assert.equal(deps.length, 1);
});

// ── 以下为 T2 反证阶段在 /tmp 里的探针，沉淀为回归断言 ──────────────────────

test('协议相对地址 //host/x.js 也算外部依赖（漏报它 = 白屏且无提示）', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="//cdn.example.com/x.js"></script>'),
    f('app.js', "const css = '//cdn.example.com/a.css';"),
    f('style.css', '.a { background: url(//cdn.example.com/b.png); }'),
  ]);
  assert.deepEqual(deps.map((d) => d.url).sort(), [
    '//cdn.example.com/a.css',
    '//cdn.example.com/b.png',
    '//cdn.example.com/x.js',
  ]);
  assert.deepEqual(deps.map((d) => d.file).sort(), ['app.js', 'index.html', 'style.css']);
});

test('协议相对：IP 主机命中；无点主机与裸斜杠不误报', () => {
  // IP 有点，命中
  assert.equal(scanExternalDeps([f('a.js', 'const u = "//10.0.0.5/x.js";')]).length, 1);
  // 无点主机（localhost）报不出来 —— 已知且有意的代价（见实现注释）
  assert.deepEqual(scanExternalDeps([f('a.js', 'const u = "//localhost/x.js";')]), []);
  // 裸 // 、/// 、以及标识符后面的 // 都不是 URL
  assert.deepEqual(scanExternalDeps([f('a.js', 'const a = 1; //\nconst b = 1; ///\nconst c = "a//b";')]), []);
});

test('协议相对：行尾注释与中文注释不误报（定界符 + 需含点两道闸）', () => {
  const deps = scanExternalDeps([
    f('app.js', 'const a = 1; // 这是一句中文注释\nconst b = 2; // see the docs\nconst c = 3;'),
  ]);
  assert.deepEqual(deps, []);
});

test('协议相对：scheme URL 不被第二支重复报一次', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="https://cdn.a.com/x.js"></script>'),
  ]);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].url, 'https://cdn.a.com/x.js');
});

test('不能被新规则带出来的 base64 误报', () => {
  const deps = scanExternalDeps([
    // data: 整段剔除后剩下的 base64 里可能含 //，前后两种位置都不能报
    f('style.css', '.a{background:url(data:image/svg+xml;base64,PHN2Zy//…)}'),
    f('style.css', '.b{background:url(data:image/png;base64,//9j/4AAQSkZJRgABAQAAAQABAAD//gA)}'),
    f('style.css', '.c{background:url(data:image/png;base64,AAA)}'),
  ]);
  assert.deepEqual(deps, []);
});

test('真实教师页：KaTeX + Google Fonts + 动态 import，逐条对账', () => {
  // 回归基线：协议相对规则加入前后，这一页必须**恰好 7 条**，一条都不能少。
  const deps = scanExternalDeps([
    f('index.html', `<!doctype html>
<html lang="zh-CN">
<head>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap">
<style>
  .hero { background: url(https://images.example.com/hero.jpg) no-repeat; }
</style>
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script type="module">
  // 参考文档 https://katex.org/docs/supported.html （注释里的，不报）
  import('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/+esm');
  fetch('https://api.example.com/v1/experiments');
</script>
<script src="./app.js"></script>
</body>
</html>`),
  ]);
  assert.equal(deps.length, 7);
  assert.deepEqual(deps.map((d) => d.url).sort(), [
    'https://api.example.com/v1/experiments',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/+esm',
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
    // ⚠️ 已知接受的行为：`;` 在排除字符类里，所以这条 URL 被截断（丢了 `;700&display=swap`）。
    // 依赖本身照报，T2 不修；T3 只展示数量与文件名，不展示原始 URL。
    'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400',
    'https://fonts.gstatic.com',
    'https://images.example.com/hero.jpg',
  ]);
  assert.ok(deps.every((d) => d.file === 'index.html'));
  assert.equal(deps.some((d) => d.url.includes('katex.org')), false); // 注释里的不报
  assert.equal(deps.some((d) => d.url.includes('app.js')), false); // 同源相对路径不报
});

test('边界：URL 后紧跟 ) ; " 反引号与行尾换行，不漏报也不吞标点', () => {
  const deps = scanExternalDeps([
    f('edge.js', [
      '<img src="http://10.0.0.5/a.png">',
      '<img src="https://cdn.b.com/b.png">',
      "<img src='https://cdn.c.com/c.png'>",
      '<img src=https://cdn.d.com/d.png>',
      'const e = `https://cdn.e.com/e.png`;',
      'const g = "https://cdn.g.com/g.png"',
      '.h { background: url(https://cdn.h.com/h.png) }',
      '@import url("https://cdn.i.com/i.css");',
      'const j = (https://cdn.j.com/j.png)',
      'const k = "https://cdn.k.com/k.png";',
      'https://cdn.l.com/l.png',
      'https://cdn.m.com/m.png',
      'const n = ["https://cdn.n.com/n.png",];',
      'const o = {"u":"https://cdn.o.com/o.png"}',
      '// https://cdn.comment.com/zzz.png',
    ].join('\n')),
  ]);
  assert.deepEqual(deps.map((d) => d.url), [
    'http://10.0.0.5/a.png',
    'https://cdn.b.com/b.png',
    'https://cdn.c.com/c.png',
    'https://cdn.d.com/d.png',
    'https://cdn.e.com/e.png',
    'https://cdn.g.com/g.png',
    'https://cdn.h.com/h.png',
    'https://cdn.i.com/i.css',
    'https://cdn.j.com/j.png',
    'https://cdn.k.com/k.png',
    'https://cdn.l.com/l.png',
    'https://cdn.m.com/m.png',
    'https://cdn.n.com/n.png',
    'https://cdn.o.com/o.png',
  ]); // 15 行里 14 条命中，`//` 整行注释那条不报；无任何标点被吞进 URL
  // 拼上协议相对后同一个文件仍然不漏
  const withRelative = scanExternalDeps([
    f('edge.js', '<script src="//cdn.z.com/z.js"></script>'),
  ]);
  assert.deepEqual(withRelative.map((d) => d.url), ['//cdn.z.com/z.js']);
});

test('边界：同源相对路径不误报（与上一条互为对照，防止「扫描器对什么都返回空」）', () => {
  const relative = `<script src="./app.js"></script>
<link href="/style.css" rel="stylesheet">
<script src="app.js"></script>
<script src="../lib/x.js"></script>
<img src="images/logo.png">`;
  const relativeJs = `fetch('/api/data.json');
fetch('data.json');
fetch('./data.json');
import('./mod.js');
import('/abs/mod.js');
new Worker('worker.js');`;
  assert.deepEqual(
    scanExternalDeps([f('index.html', relative), f('app.js', relativeJs)]),
    [],
  );
  // 正对照：同一批文件里混进 2 条绝对 URL，就恰好报 2 条
  const deps = scanExternalDeps([
    f('index.html', `${relative}\n<script src="https://cdn.ctrl.com/ctrl.js"></script>`),
    f('app.js', `${relativeJs}\nfetch('https://api.ctrl.com/c');`),
  ]);
  assert.deepEqual(deps.map((d) => d.url).sort(), [
    'https://api.ctrl.com/c',
    'https://cdn.ctrl.com/ctrl.js',
  ]);
});

test('已声明的过报（宁可多报）：拼接模板串与 data: 内嵌 svg xmlns', () => {
  // 模板串：报出来的不是真 URL，但它确实代表一条外部依赖
  assert.deepEqual(
    scanExternalDeps([f('app.js', 'const u = `https://${host}/x.js`;')]).map((d) => d.url),
    ['https://${host}/x.js'],
  );
  // data: URI 里的 xmlns 不是网络请求，但会被报出来；不阻断上传，接受
  assert.deepEqual(
    scanExternalDeps([
      f('style.css', '.a{background:url(data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>)}'),
    ]).map((d) => d.url),
    ['http://www.w3.org/2000/svg'],
  );
});

test('已知漏报（静态正则无解，有意接受）：字符串拼接拆开的 URL', () => {
  const deps = scanExternalDeps([f('app.js', "const u = 'https://' + host + '/x.js';")]);
  assert.deepEqual(deps, []);
});
