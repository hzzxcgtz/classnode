import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanMissingLocalRefs } from '../services/webapp-local-refs.js';

const html = (content: string, path = 'index.html') => [{ path, content }];

test('同一个目录里的引用，不在场 ⇒ 报出来', () => {
  const r = scanMissingLocalRefs(html('<link rel="stylesheet" href="style.css">'), ['index.html']);
  assert.equal(r.count, 1);
  assert.deepEqual(r.refs, ['style.css']);
});

test('★ 在场的文件不报（阳性对照：把在场集合清空，这一条必须转红）', () => {
  const files = html('<link rel="stylesheet" href="style.css"><script src="js/app.js"></script>');
  assert.deepEqual(scanMissingLocalRefs(files, ['index.html', 'style.css', 'js/app.js']).refs, []);
  assert.deepEqual(
    scanMissingLocalRefs(files, ['index.html']).refs.sort(),
    ['js/app.js', 'style.css'],
    '清空在场集合之后必须两条都报 —— 否则上一条断言是在空转',
  );
});

test('外链 / 协议相对 / data: / blob: / mailto: / 纯片段 / 纯查询 都不算缺失', () => {
  const src = [
    '<link href="https://cdn.example.com/a.css">',
    '<script src="//cdn.example.com/b.js"></script>',
    '<img src="data:image/png;base64,AAAA">',
    '<img src="blob:http://localhost/x">',
    '<a href="mailto:t@example.com">写信</a>',
    '<a href="#section">跳转</a>',
    '<img src="?v=2">',
    '<a href="javascript:void(0)">别点</a>',
  ].join('\n');
  assert.deepEqual(scanMissingLocalRefs(html(src), ['index.html']).refs, []);
});

test('子目录里的 HTML 要按它自己的目录解析（不是按包根）', () => {
  const r = scanMissingLocalRefs(
    html('<img src="img/a.png">', 'pages/about.html'),
    ['pages/about.html'],
  );
  assert.deepEqual(r.refs, ['img/a.png'], '返回的是**引用原样**，教师看到的应该是他写的那个字符串');
});

test('省掉上层的引用能解析回包根', () => {
  const r = scanMissingLocalRefs(html('<img src="../shared/logo.png">', 'pages/a.html'), ['pages/a.html', 'shared/logo.png']);
  assert.deepEqual(r.refs, [], '../shared/logo.png 在场，不该报');
});

test('CSS 的 url() 与 @import 也算引用', () => {
  const r = scanMissingLocalRefs(
    html('<style>@import "base.css"; body{background:url(bg.png)}</style>'),
    ['index.html'],
  );
  assert.deepEqual(r.refs.sort(), ['base.css', 'bg.png']);
});

test('srcset 里的候选也算引用（独立复核实测：初稿把它整条漏掉了）', () => {
  // spec §四 明写要认 `srcset`；实测初稿对 `srcset="img/a.png 1x, img/b.png 2x"` 返回 **0 条**。
  // 一个只为「别让教师的图静默丢」而存在的扫描器，漏掉响应式图片这一支说不过去。
  const r = scanMissingLocalRefs(html('<img srcset="img/a.png 1x, img/b.png 2x">'), ['index.html']);
  assert.deepEqual(r.refs.sort(), ['img/a.png', 'img/b.png']);
});

test('★ 相对引用里的 `?` / `#` 要先剥掉再判在不在场（独立复核实测的误报）', () => {
  // 实测初稿：`href="style.css?v=3"` 与 `href="about.html#team"` 会被报成缺失，**而两个文件都在场**。
  // 缓存串与锚点是常见写法，误报会让这条提醒整体失去可信度。
  const files = html('<link href="style.css?v=3"><a href="about.html#team">');
  assert.deepEqual(
    scanMissingLocalRefs(files, ['index.html', 'style.css', 'about.html']).refs, [],
    '两个文件都在场，带 ?/# 不该被报成缺失',
  );
  // 阳性对照：不在场时仍然要报，而且报的是**教师写的原样**。
  assert.deepEqual(
    scanMissingLocalRefs(files, ['index.html']).refs.sort(),
    ['about.html#team', 'style.css?v=3'],
    '剥掉 ?/# 是为了判定，不是为了改显示 —— 给教师看的仍应是他写的那个字符串',
  );
});

test('同一个缺失引用出现多次只报一条', () => {
  const r = scanMissingLocalRefs(html('<img src="a.png"><img src="a.png"><img src="a.png">'), ['index.html']);
  assert.equal(r.count, 1);
});

test('注释里的引用不算（与 scanExternalDeps 同一条纪律）', () => {
  const r = scanMissingLocalRefs(html('<!-- <img src="old.png"> -->\n<p>hi</p>'), ['index.html']);
  assert.deepEqual(r.refs, []);
});
