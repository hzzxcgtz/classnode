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
