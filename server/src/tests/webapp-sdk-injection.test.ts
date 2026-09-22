import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { SDK_PATH, SDK_SOURCE, SHOT_PATH, injectSdk } from '../services/webapp-sdk.js';
import { startWebappHost } from '../services/webapp-host.js';
import { WEBAPP_DIAG_CODES } from '../socket/index.js';

/** `server/dist/tests` —— 用来定位仓库里的其它文件（见「三处一致」那条用例）。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

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

// 幂等判据曾经是 `html.includes(opts.sdkPath)` —— **整篇子串包含**。于是正文或
// 注释里只要出现过那几个字（例如一句说明文案里带了路径），注入就被**整体跳过**：
// 该页一帧都不上报，而且没有任何报错。方向安全但静默。
test('红线外：正文/注释里提到 sdk.js 这几个字，不得让注入整体跳过（原先的静默 fail-open）', () => {
  const html =
    `<html><head><!-- 本页已接入 ${SDK_PATH} --></head>` +
    `<body><p>探究助手由 ${SDK_PATH} 提供支持</p></body></html>`;
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.ok(
    out.includes(`<script src="${SDK_PATH}"></script>`),
    '正文提到路径 ≠ 已经注入过 —— 否则该页静默地一帧都不上报',
  );
  // 判别式：这一页确实**没有**该标签，所以「应当注入」不是靠猜
  assert.equal(html.includes('<script'), false);
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

// ══════════════════════════════════════════════════════════════════════════
// 注入点必须落在**活的位置**（审查者实测出来的第二类静默失效）
//
// `html.search(/<\/head\s*>/i)` 取的是**第一个**匹配。而教师网页的正文、注释、
// `<title>` 文本、或 JS 字符串里出现字面量 `</head>` 是常见的（HTML 教学页里的代码
// 示例尤其如此）⇒ 注入的 `<script>` 落在那段文本里 ⇒ 它不是一个元素、SDK 根本不执行、
// `ClassNode.report` 不存在、**一帧都不上报，而且没有任何报错**。
//
// 这与 T4 修掉的「裸路径 includes 被正文绊倒」是同族但**方向相反**的失效
// （那是跳过注入，这是注入到死处），而且更隐蔽：页面看起来完全正常。
// ══════════════════════════════════════════════════════════════════════════

const SDK_TAG = `<script src="${SDK_PATH}"></script>`;

/**
 * 每个 fixture 都满足一个条件：**第一个** `</head>` 的字面量出现在一个「会吞掉标签」
 * 的位置里，而**最后一个** `</head>` 才是真的那个。下面每条用例都会顺手断言
 * `indexOf !== lastIndexOf` —— 否则这个 fixture 区分不了新旧实现，是一条假绿。
 */
const HOSTILE_PAGES: { name: string; html: string }[] = [
  {
    name: '</head> 出现在 JS 注释里',
    html: '<html><head><script>\n// 注意：闭合标签要写成 </head> 才对\nvar a = 1;\n</script><title>t</title></head><body><p>ok</p></body></html>',
  },
  {
    name: '</head> 出现在 HTML 注释里',
    html: '<html><head><!-- 复制粘贴示例： </head> --><title>t</title></head><body><p>ok</p></body></html>',
  },
  {
    name: '</head> 出现在 JS 字符串里',
    html: '<html><head><script>var tpl = "</head>";</script></head><body><p>ok</p></body></html>',
  },
  {
    name: '</head> 出现在 <title> 文本里（RCDATA）',
    html: '<html><head><title>如何写 </head> 这个标签</title></head><body><p>ok</p></body></html>',
  },
  {
    name: '</head> 出现在 <style> 里（RAWTEXT）',
    html: '<html><head><style>/* 示例： </head> */ body{margin:0}</style></head><body><p>ok</p></body></html>',
  },
];

test('注入点跳过「死处」：JS 注释 / HTML 注释 / JS 字符串 / title / style 里的 </head>', () => {
  for (const page of HOSTILE_PAGES) {
    const out = injectSdk(page.html, { sdkPath: SDK_PATH });
    // 期望值是**独立于实现**算出来的：这个 fixture 的最后一个 </head> 才是真的那个
    const expectedAt = page.html.lastIndexOf('</head>');
    assert.equal(
      out,
      page.html.slice(0, expectedAt) + SDK_TAG + page.html.slice(expectedAt),
      `${page.name}：SDK 必须插在真正的 head 收尾处`,
    );
    // 判据自检：这个 fixture 必须**能区分**新旧实现
    assert.notEqual(
      page.html.indexOf('</head>'), expectedAt,
      `${page.name}：这个 fixture 的第一个 </head> 就是对的 —— 它区分不了新旧实现，是一条假绿`,
    );
  }
});

test('阳性对照：注入后的标签不在任何 <script> / HTML 注释内部（计数式独立判据）', () => {
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
  const pages = [
    ...HOSTILE_PAGES,
    { name: '普通页面（无任何死处）', html: '<html><head><meta charset="utf-8"></head><body><p>x</p></body></html>' },
    // head 里**正常地**含一段闭合的 script —— 这条是「配平逻辑别把正常页面误判成死处」
    { name: 'head 里有一段正常闭合的 script', html: '<html><head><script>var a=1;</script></head><body><p>x</p></body></html>' },
  ];
  for (const page of pages) {
    const out = injectSdk(page.html, { sdkPath: SDK_PATH });
    const at = out.indexOf(SDK_TAG);
    assert.notEqual(at, -1, page.name);
    const prefix = out.slice(0, at);
    assert.equal(count(prefix, '<script'), count(prefix, '</script'), `${page.name}：注入点落在未闭合的 script 里`);
    assert.equal(count(prefix, '<!--'), count(prefix, '-->'), `${page.name}：注入点落在未闭合的注释里`);
  }
});

test('阴性对照：正常页面（只有一处 </head>）的注入点与输出一字不变', () => {
  const html = '<html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out, html.replace('</head>', SDK_TAG + '</head>'));
  assert.equal(out.indexOf(SDK_TAG), html.indexOf('</head>'));
});

test('head 里正常闭合的 script 不算死处：SDK 仍然插在 head 收尾处', () => {
  const html = '<html><head><script>var a = 1;</script><title>t</title></head><body><p>x</p></body></html>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out, html.replace('</head>', SDK_TAG + '</head>'));
});

test('只认 </head> 不认 </head >：带空白的收尾也照旧认（与既有行为一致）', () => {
  const html = '<html><HEAD ><title>t</title></HEAD ><body>b</body></html>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out.indexOf(SDK_TAG) < out.indexOf('</HEAD >'), true);
  assert.equal(out.replace(SDK_TAG, ''), html);
});

test('所有 </head> 都在死处时退到 <html> 之后：位置更早，但仍然是活的', () => {
  // head 从未闭合（教师漏写了），唯一的 </head> 字面量在一个 JS 字符串里
  const html = '<html><head><script>var s = "</head>";</script>';
  const out = injectSdk(html, { sdkPath: SDK_PATH });
  assert.equal(out, '<html>' + SDK_TAG + '<head><script>var s = "</head>";</script>');
  const prefix = out.slice(0, out.indexOf(SDK_TAG));
  assert.equal(prefix.includes('<script'), false, '插入点之前不能再有未闭合的 script');
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
//
// ⚠️ **这一节在新世界里整个变了形状**（用户裁定：学生的点击 / 输入 / 滚动 / 跳转 /
// 前后台切换一律不采集）。旧世界的红线是「读内容的手段被关在 inputLength() 一个函数里，
// 且只让长度离开它」；新世界的那条通道**根本不存在**，所以保证更强也更简单：
// **SDK 里没有任何读输入内容的代码。** 下面每一条都是那条保证的一个切面。

/** 与 compat 闸门同款的剥注释，避免断言把 SDK 自己的注释当成代码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * 「读内容」的禁词表 —— 新世界里 SDK **一把都不许有**。
 *
 * 旧世界这张表是**禁词 + 一个例外**（inputLength() 里必须出现其中至少一个，
 * 否则那条断言会空过）。新世界没有例外：**一个都不出现**才是对的，
 * 因为既没有事件载荷可以装内容，也没有任何理由去读它。
 *
 * 断言打在**剥掉注释的源码**上：这是一个关于**代码**的保证，注释不是代码
 * （与旧版本同款，也用 stripComments）。
 */
const CONTENT_READ_TOKENS = ['.value', '.textContent', '.innerText', '.outerText', '.innerHTML', '.outerHTML', 'getAttribute('];

test('红线：SDK 不存在任何读输入内容的手段（不再有 inputLength() 那样的例外）', () => {
  const code = stripComments(SDK_SOURCE);
  for (const token of CONTENT_READ_TOKENS) {
    assert.equal(
      code.includes(token), false,
      `SDK 里出现了 ${token} —— 操作行为不采集，连「在进程内读一下」都不该有`,
    );
  }
  // 判别式：上面那张禁词表不是「空文件也能过」——
  //   ① 源码本身必须是有内容的；② 帧链路必须真的在（否则剥空的源码同样一个词都没有）。
  assert.ok(SDK_SOURCE.length > 4000, `SDK 源码太短，像是被清空了：${SDK_SOURCE.length}`);
  assert.ok(code.includes("post('frame'"), '帧链路必须在 —— 否则禁词表只是在守一个空壳');
});

test('红线：读内容的那些函数与监听器已经整个删掉（回归门）', () => {
  const code = stripComments(SDK_SOURCE);
  // 旧世界正是靠这几个零件接触内容的；任何一个回来，都意味着那条七字段通道正在被重建。
  for (const gone of ['function inputLength(', 'function inputTypeOf(', 'function describe(', 'function emit(', 'function hashLength(']) {
    assert.equal(code.includes(gone), false, `${gone} 应当随旧事件链路一起删除`);
  }
  // ⚠️ P2.2 的 T5 把 `scroll` 从这张表里**移出去了**（它现在是一项被批准的文字档），
  // 但**没有**放宽这条断言：click / input / hashchange 仍然一个都不许有，
  // 而 scroll 那一条在下面被单独钉住（必须存在，且只能报十分位）。
  assert.equal(
    /addEventListener\('(click|input|hashchange)'/.test(code), false,
    '点击 / 输入 / 页面内跳转的监听器一个都不许留下 —— 它们都要带"内容"才能用',
  );
  // 判别式：上一条不是「空文件也能过」—— 被批准的那一个监听器必须真的在。
  assert.ok(code.includes("addEventListener('scroll'"), '文字档的滚动监听器必须在');
  assert.ok(code.includes("addEventListener('visibilitychange'"), '可见性监听器必须在');
});

test('🔴 文字档：只有 visibility 与 scroll 两条上报点，且载荷没有自由文本字段', () => {
  const code = stripComments(SDK_SOURCE);

  // ① 唯一的出口是 reportEvent()，而它**只**经由 buildEvent 造载荷（形参表 = 白名单）。
  assert.equal(code.split('function reportEvent(').length - 1, 1, 'reportEvent 只能有一处定义');
  assert.ok(
    code.includes("post('event', buildEvent(kind, { to: to, depth: depth }));"),
    'event 载荷必须由 buildEvent 生产，且**只有 to / depth 两个来源**',
  );
  // ② 两个上报点的来源被逐一枚举：kind 恒为字面量，to 只来自 visibilityState()，
  //    depth 只来自十分位换算。任何一条被换成别的表达式，下面会红。
  //    （匹配带分号的**调用**，函数定义那一行没有分号，不会被扫进来。）
  const sites = [...code.matchAll(/\breportEvent\(([^)]*)\);/g)].map((m) => m[1]);
  assert.deepEqual(
    sites,
    ["'visibility', next, 0", "'scroll', '', decile * 10"],
    `reportEvent 的调用点变了 —— 每个参数都必须来自枚举过的来源：${sites.join(' | ')}`,
  );

  // ③ 滚动**只在跨过新的十分位时**才报 —— 逐条 scroll 事件上报会打满老 iPad 与 socket。
  const scrollAt = code.indexOf('function reportScrollDepth()');
  assert.notEqual(scrollAt, -1, '取不到 reportScrollDepth 的函数体，下面的断言会空过');
  const scrollBody = code.slice(scrollAt, code.indexOf("addEventListener('scroll'"));
  assert.ok(scrollBody.includes('if (decile === lastDecile) return;'), '跨档判据必须在滚动上报的路径上');
  assert.ok(scrollBody.includes('decile * 10'), '报出去的是十分位（0/10/…/100），不是 0~1 的比例');
  assert.ok(scrollBody.includes('if (decile > 10) decile = 10;'), '十分位必须夹在 0…10');

  // ④ **加载时确实补报了一次 presence**（否则"安静阅读不滚不切"的学生在图墙上是空的）。
  assert.ok(
    code.includes('reportVisibility(true);'),
    '必须有一次强制补报 —— 加载时那一次 presence 是这条链路的存在理由',
  );
  assert.ok(
    /reportVisibility\(true\);\s*\}\)\(\);/.test(code),
    '补报必须发生在模块初始化路径上（IIFE 收尾之前），不能只挂在事件回调里',
  );
});

test('红线：buildEvent 的返回形状是**五项**，而且旧的三项事件字段一律不在', () => {
  const code = stripComments(SDK_SOURCE);
  // 唯一的构造点
  assert.equal(code.split('function buildEvent(').length - 1, 1);
  const shape = code.slice(code.indexOf('function buildEvent('), code.indexOf('function post('));
  // 五项：kind（短枚举）+ to（短枚举）+ depth（十分位整数）+ image（页面自己画出来的像素）+ at（数字）
  for (const field of ['kind:', 'to:', 'depth:', 'image:', 'at:']) {
    assert.ok(shape.includes(field), `buildEvent 的返回形状里缺少 ${field}`);
  }
  // 🔴 **旧的三项必须一项都不在**，逐项断言而不是抽查。这三项正是「点了哪个元素」
  //    「输入框里有多少字符」的载体 —— 它们没有随文字档回来（P2.2 的 T5 刻意如此）。
  //    ⚠️ 这条**比 T2 那版更严**：T2 时连 depth/to 也一起禁（那时它们根本没有存在理由），
  //       现在放行的只有 depth/to 两项，而每一项的取值来源都在上面那条用例里被枚举过。
  for (const gone of ['selector:', 'inputType:', 'length:']) {
    assert.equal(shape.includes(gone), false, `buildEvent 里又出现了旧的事件字段 ${gone} —— 那会带上内容`);
  }
  for (const forbidden of ['value', 'text:', 'content:', 'html:']) {
    assert.equal(shape.includes(forbidden), false, `buildEvent 里出现了不允许的字段名 ${forbidden}`);
  }
});

test('红线：post() 的通道是封闭的**五项**（改数量必须显式改这条）', () => {
  const code = stripComments(SDK_SOURCE);
  const types = [...code.matchAll(/post\('([a-z]+)'/g)].map((m) => m[1]);
  // ① 集合本身：多一种就意味着多一条能出门的路径。
  //
  // ⚠️ **P2.2 的 T5 把 `event` 加了回来，这看起来像"放开"，其实是收窄**：
  //    加回来的是**文字档**（visibility / scroll 两种，载荷四字段、无自由文本），
  //    而原来的七字段版本（click / input / navigate + selector / inputType / length）
  //    **没有回来**，并且被下面 ③ 那几条断言挡着。判据从"三种"变成"四种"这件事
  //    本身就是这次契约变更的对照物：谁再想偷偷加一条通道，这里会红。
  //
  // ⚠️ **2026-09-22 又把 `diag` 加了回来（四→五）**，同样是**不放宽实质保证**的扩展：
  //    新通道的载荷是「一个封闭枚举码 + 三个整数」，**没有任何自由字符串**，
  //    装不下 selector / inputType / length / 任意文本。加它的理由见下面 ④——
  //    而且 ④ 把「装不下内容」从注释里的承诺变成了**机械断言**。
  assert.deepEqual(
    [...new Set(types)].sort(), ['diag', 'event', 'frame', 'ready', 'report'],
    `post() 的 type 集合变了 —— 多出来的通道没有人审查过：${types.join(', ')}`,
  );
  // ② 每一路的调用点数量也**写死**（不是「>= 1」）：
  //    ready —— 握手只有那一次；
  //    report —— 只有 ClassNode.report 的定义处那一个内部调用点；
  //    event —— 只有 reportEvent 里那一个（visibility/scroll 两条上报点共用它）；
  //    frame —— **2** 个：canvas 直读（第一档）与纯 DOM 光栅化（第二档）。
  //    第二档是 Ruling 6 被用户推翻后补上的（规格 §5.4 原本就写了「页面无大 canvas 时
  //    按需加载截图库」，P2 只做了第一档）。数量写死成 2：多出第三条截图路径必须是
  //    一次显式的改动，而不是悄悄长出来。
  //    diag —— 只有 reportDiag 里那一个（9 条失败分支共用它）。
  assert.equal(types.filter((t) => t === 'ready').length, 1);
  assert.equal(types.filter((t) => t === 'report').length, 1);
  assert.equal(types.filter((t) => t === 'event').length, 1, 'event 只有一个出口（reportEvent）；多出来的那条没有人审查过');
  assert.equal(types.filter((t) => t === 'frame').length, 2, 'frame 两档各一个调用点；多出来的那条没有人审查过');
  assert.equal(types.filter((t) => t === 'diag').length, 1, 'diag 只有一个出口（reportDiag）；多出来的那条没有人审查过');
  // ③ 两条链路的载荷都必须由 buildEvent 生产
  for (const type of ['frame', 'event']) {
    const lines = code.split('\n').filter((line) => line.includes(`post('${type}'`));
    for (const line of lines) assert.ok(line.includes('buildEvent('), `${type} 载荷必须来自 buildEvent`);
  }
  // ④ 🔴 **diag 那条通道的实质保证，机械验一遍。**
  //
  // 这是本次扩展里最要紧的一条：说「新通道装不下内容」是散文，而散文会被后来的改动
  // 悄悄推翻。所以这里直接解析 `buildDiag` 的返回形状 —— 字段表必须是
  // `code` + 三个整数，**一个都不能多**。
  const diagFn = code.match(/function buildDiag\([^)]*\)\s*\{[\s\S]*?return \{([^}]*)\};/);
  assert.ok(diagFn, 'buildDiag 必须存在，且返回一个字面量对象（形状要能被这条测试解析）');
  const diagFields = diagFn![1].split(',').map((part) => part.split(':')[0].trim()).sort();
  assert.deepEqual(
    diagFields, ['code', 'h', 'n', 'w'],
    'diag 载荷的字段表变了 —— 这条通道只允许「一个枚举码 + 三个整数」，'
    + '多一个字段就是多一条能出门的路径（自由字符串尤其不行）',
  );
  const diagLines = code.split('\n').filter((line) => line.includes("post('diag'"));
  for (const line of diagLines) assert.ok(line.includes('buildDiag('), 'diag 载荷必须来自 buildDiag');
  // 码表白名单必须真的在过滤（不是「有这张表但没用」）。
  assert.ok(
    /DIAG_CODES\.indexOf\(code\) === -1[\s\S]{0,40}return/.test(code),
    'reportDiag 必须按 DIAG_CODES 白名单过滤，且不在表里的码直接丢弃',
  );
});

test('红线：拒因分类器必须覆盖「拒因不是 Error」的情形，且只返回整数', () => {
  const code = stripComments(SDK_SOURCE);
  // 🔴 由来：2026-09-22 实测拿到 `w=0 h=0`，而 `0` 同时意味着「不在已知表里」与
  // 「压根没有 message」——**含糊的枚举码把一轮真机往返浪费掉了**。
  // 分类器必须能说出拒因的**形状**本身，否则下次还是分不清。
  for (const shape of ['string', 'number', 'boolean', 'function']) {
    assert.ok(
      code.includes(`shape === '${shape}'`),
      `拒因分类器没有覆盖 typeof 为 ${shape} 的情形 —— 库 reject 一个非 Error 值时又会退化成「认不出」`,
    );
  }
  assert.ok(/err === null \|\| err === undefined/.test(code), '必须单独覆盖 null / undefined');
  assert.ok(/if \(!err\.message\)/.test(code), '必须区分「是对象但没有 message」这条');

  // 🔴 **只返回整数**：一旦某条分支返回字符串，这条通道立刻变成内容出口，
  //    而上面那些「字段表恰好四项」的断言**依然全绿**（字段名没变，变的是值的类型）。
  const fn = code.match(/function describeRejection\(err\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'describeRejection 必须存在');
  assert.equal(
    /return ['"]/.test(fn![0]), false,
    'describeRejection 不得返回字符串 —— 那就成了一条内容出口',
  );
  const nameFn = code.match(/function describeRejectionName\(err\) \{[\s\S]*?\n  \}/);
  assert.ok(nameFn, 'describeRejectionName 必须存在');
  assert.equal(/return ['"]/.test(nameFn![0]), false, 'describeRejectionName 同样只能返回整数');
});

test('红线：diag 的**任何**调用点都不得把错误原文送出去', () => {
  // ⚠️ 这条守的是本次扩展里最容易被顺手破坏的东西：`.catch(err)` 里手边就有
  // `err.message`，而它**是自由文本**（库抛出来的，可能带上教师网页的类名/路径/片段）。
  // 一旦有人图省事把 `err.message` 塞进 reportDiag，这条通道就从「封闭枚举」变成
  // 「能装内容的后门」，而**所有结构断言都还是绿的**（字段表没变、码表没变）。
  // ⇒ 只有对着调用点逐行看才拦得住。所以这里机械地看。
  const code = stripComments(SDK_SOURCE);
  const callLines = code.split('\n').filter((line) => line.includes('reportDiag(')
    // 定义处那一行不算调用点
    && !line.includes('function reportDiag('));
  assert.ok(callLines.length >= 9, `reportDiag 的调用点太少（${callLines.length}），提取逻辑多半失效了`);

  for (const line of callLines) {
    for (const leak of ['err.message', 'message:', 'String(err)', 'err.stack', 'text']) {
      assert.equal(
        line.includes(leak), false,
        `diag 调用点里出现了可能带内容的 ${leak} —— 这条通道只允许枚举码与整数；出事的行：${line.trim()}`,
      );
    }
  }

  // 阳性对照：分类函数确实存在，而且**只返回下标**（它内部才允许看 err.message）。
  assert.ok(/function classifyCaptureError\(err\)/.test(code), '分类函数必须存在');
  assert.ok(/return i \+ 1;/.test(code), '分类函数必须返回下标（+1），不是消息本身');
});

test('红线：diag 码表里的每个码**都必须真的有调用点**', () => {
  // ⚠️ 这条补的是「加了码但忘了接线」——那种情况的症状是那条诊断**永远不出现**，
  // 而码表、白名单、契约三处看起来都是对的，没有任何地方会报。
  //
  // ⚠️ **这是结构断言，不是行为断言。** 行为路径（真的让某条失败发生、真的发出 diag）
  // 需要定时器，而 `runSdkOnStub` 刻意把 `readyState` 设成 `'loading'` 来避免
  // 留下永不停止的 setInterval（见那里的注释）——那条路只能靠真机验证。
  // 所以这里能保证的是「码与调用点一一对应」，不能保证「那条分支真的会被走到」。
  const code = stripComments(SDK_SOURCE);
  const declared = [...code.match(/var DIAG_CODES = \[([\s\S]*?)\];/)![1]
    .matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  const called = [...new Set(
    [...code.matchAll(/reportDiag\('([a-z-]+)'/g)].map((m) => m[1]),
  )].sort();

  assert.deepEqual(
    called, declared,
    '码表与调用点对不上 —— 多出来的码永远不会出现（白占一个槽位），'
    + '少掉的码说明有条失败分支没有接线（那条失败将永远不可见）',
  );
});

test('红线：diag 的码表在 SDK / 父页面 / 服务端**三处一致**', () => {
  // ⚠️ 三处不一致的后果是那条诊断**静默消失**（不报错，只是永远看不到）——
  // 而这条通道存在的全部意义就是「让看不见的东西看得见」。这种漂移靠人记是记不住的。
  const extract = (source: string, pattern: RegExp, what: string): string[] => {
    const matched = source.match(pattern);
    // 模式失配就抛 —— 让「码表被改名/改写法」表现成一条失败的测试，
    // 而不是一个悄悄退化成空数组、随后恒真的断言。
    assert.ok(matched, `${what} 里找不到 diag 码表（模式失配，这条测试需要跟着更新）`);
    return [...matched[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  };

  const fromSdk = extract(stripComments(SDK_SOURCE), /var DIAG_CODES = \[([\s\S]*?)\];/, 'SDK');
  // 🔴 **长度护栏**：三处都提取成空数组的话，下面那两条 deepEqual 会**恒真通过** ——
  //    那是这条测试最容易变成假绿的方式。先钉住「确实提取到了码」。
  assert.ok(fromSdk.length >= 5, `从 SDK 提取到的 diag 码太少（${fromSdk.length} 个），提取逻辑多半失效了`);
  // 服务端**直接 import**，不读文件、不猜路径。
  const fromServer = [...WEBAPP_DIAG_CODES].sort();
  // 父页面是 `src/` 下的客户端代码，服务端的测试进不了它的 tsconfig，只能读文件。
  // 路径从 `server/dist/tests` 往上三级到仓库根 —— 写错会 readFileSync 抛错（响亮失败）。
  const bridgePath = path.resolve(HERE, '../../../src/app/classroom/explore/use-explore-bridge.ts');
  const fromBridge = extract(
    fs.readFileSync(bridgePath, 'utf8'),
    /const DIAG_CODES = \[([\s\S]*?)\] as const;/,
    bridgePath,
  );

  assert.deepEqual(fromBridge, fromSdk, '父页面的 DIAG_CODES 与 SDK 不一致 —— 那条诊断会被父页面丢掉');
  assert.deepEqual(fromServer, fromSdk, '服务端的 WEBAPP_DIAG_CODES 与 SDK 不一致 —— 那条诊断会被服务端丢掉');
});

test('红线：SDK 不再读 location.*（navigate 通道已删除）', () => {
  const code = stripComments(SDK_SOURCE);
  // 这是审查者实测出来的第二条内容通道：`location.hash = 输入框的值` 是教师写页面时
  // 极常见的一行 UI 代码，与 ClassNode 无关，却让学生的输入经由**默认采集通道**
  // 原样出门（实测：输入 HX7QM2VK → navigate.to = "#HX7QM2VK"）。
  // 旧世界的对策是「只报长度、绝不报值」；现在整条 navigate 通道删掉了，
  // 判据升级成**一个 location 都不读** —— 读它已经没有理由，不必再区分读的是长度还是值。
  assert.equal(/location\.(hash|href|search|pathname)/.test(code), false, 'SDK 不得读 location 的任何部分');
  assert.equal(code.includes('hashchange'), false, '页面内跳转不再上报');
});

test('红线：没有任何字段被直接喂上一个自由文本源', () => {
  const code = stripComments(SDK_SOURCE);
  // 判定的是**取值来源**，不是「有没有这个字段」：image 本身在白名单里（页面自己画出来
  // 的像素），出问题的是「谁被接了上去」。事件字段全删之后，带自由字符串的赋值点
  // 只剩 image 一处 —— 而它必须只接两档截图的产物（两档各一个调用点）。
  const SUSPECT = /location|\.value|textContent|innerText|innerHTML|document\.title|\.href/;
  // 只看**调用点**（post 定义之后的部分）：`buildEvent` 自己的形参表里也有一个
  // `image:`，那是**字段定义**而不是取值来源，扫描它会把计数虚增一处。
  const callSites = code.slice(code.indexOf('function post('));
  const sites = [...callSites.matchAll(/\b(image):\s*([^,\n]+)/g)]
    .map((m) => ({ field: m[1], value: m[2].trim() }));
  // 恰好两处，而不是 >= 1：少了说明某一档的载荷构造被改掉了，多了说明有人新接了一条。
  assert.equal(sites.length, 2, `应当能定位到两档各一个 image 赋值点，实际 ${sites.length}`);
  for (const site of sites) {
    assert.equal(
      SUSPECT.test(site.value), false,
      `${site.field}: 的取值来源是自由文本 —— 那会绕过整条红线: ${site.value}`,
    );
  }
});

test('🔴 可见性变化不得停止截图（看缩略图的是教师，不是学生）', () => {
  const code = stripComments(SDK_SOURCE);
  const start = code.indexOf("addEventListener('visibilitychange'");
  assert.notEqual(start, -1, '这个监听器仍然要有：切回前台时立刻补一帧');
  const body = code.slice(start, code.indexOf('});', start) + 3);

  // 🔴 回归门。这里曾经是 `if (document.hidden === true) { stopFrames(); }`，
  // 注释写的是「学生切走时没人看缩略图，不必画」—— **那个假设是错的**：
  // 看缩略图的是**教师**。学生窗口被遮挡（后台标签页 / macOS 上的遮挡检测）
  // 不改变教师想看什么。
  //
  // 用户实测的症状：教师看板那一格**永远停在「等待画面…」**，而学生显示在线 ——
  // 因为 socket 还连着，截图却一帧都没发生。加回 stopFrames() 就会重现它。
  assert.equal(body.includes('stopFrames();'), false, '切走不得停截图 —— 那会让教师端永远停在「等待画面…」');
  assert.ok(body.includes('captureFrame();'), '切回前台时应当立刻补一帧');
  // ⚠️ P2.2 的 T5：这个监听器**现在多了一件事** —— 把可见性变化报给教师图墙
  //    （「已打开」/「已切走」）。它报的**只有**可见性这一项，不带任何别的东西：
  //    判据是它调用的那个函数（reportVisibility）的实参表，以及 buildEvent 的白名单。
  assert.ok(
    body.includes('reportVisibility(false);'),
    '这个监听器必须把可见性变化报出去（教师图墙的「已切走」就是这一条）',
  );
  // 它**不得**自己直接 post：载荷必须经由那个唯一的构造点，否则字段就绕过了白名单。
  assert.equal(body.includes('post('), false, '这个监听器不得直接 post —— 载荷只能来自 reportVisibility');
  assert.equal(body.includes('captureLevel'), false, '可见性监听器不该管档位');
});

test('抖动：首帧错开全班，但周期不被拉长', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes('FRAME_JITTER_MS'), '必须有抖动常量');

  const start = code.indexOf('function startFrames()');
  assert.notEqual(start, -1, '取不到 startFrames 的函数体，下面的断言会空过');
  const body = code.slice(start, code.indexOf('function stopFrames()'));

  // 教师一打开看板，服务端会在同一个循环里把档位逐条下发给全班 ⇒ 几十台设备的定时器
  // 被**同时重置** ⇒ 之后每 10 秒一起到达。抖动就是为了把它们错开。
  assert.ok(body.includes('Math.random()'), '首帧必须带随机抖动，否则全班截图会撞在一起');

  // 🔴 而**周期性**那条 setInterval 必须是**精确间隔**、不带任何抖动：
  //    往那儿加抖动会把平均周期悄悄拉长（每轮 +1.5 秒 ⇒ 10 秒档实际变成 11.5 秒），
  //    而没人会想到是抖动干的。
  //
  // ⚠️ 判据要钉**整条语句**，不能只切 `indexOf('setInterval(')` 到函数末尾 ——
  //    那样会把后面 setTimeout 的延迟实参也包进来，于是**永远报红**（我第一版就是这样）。
  assert.ok(
    body.includes('setInterval(captureFrame, frameInterval());'),
    '周期性那条必须是精确间隔 setInterval(captureFrame, frameInterval()) —— 不得带抖动',
  );
});

test('P2.2：采集开关与超限降档', () => {
  const code = stripComments(SDK_SOURCE);

  // 🔴 教师按课堂关掉画面 ⇒ **连 canvas 直读也不发**（用户裁定的是"全关"，不是"只关贵的那档"）。
  const capture = code.slice(code.indexOf('function captureFrame()'), code.indexOf('function biggestCanvas()'));
  assert.notEqual(capture.length, 0, '取不到 captureFrame 的函数体，断言会空过');
  assert.ok(capture.includes('if (!captureEnabled) return;'), '关掉画面时必须连 canvas 也不发');

  // 🔴 超限必须**本地缩一档重来**，而不是硬撞上去让 post() 丢掉 ——
  //    后者会让教师看到空图墙，而且没有任何地方会告诉他"是因为图太大"。
  assert.ok(code.includes('var PAYLOAD_BUDGET ='), '必须有单帧字符预算');
  assert.ok(code.includes('url.length > PAYLOAD_BUDGET'), '超过预算时必须触发降档');
  assert.ok(code.includes('function attemptCapture('), '降档要能重跑（缩放比例必须是可重试的一层）');
  assert.ok(code.includes('MAX_DOWNSCALE_ATTEMPTS'), '降档次数必须有上限，不能无限缩下去');

  // 兜底方向：**认不出 = 开 / 用默认**，绝不变成"关掉"或"更小"。
  // 反例（`Boolean(d.captureEnabled)`）会让父页面转发丢字段时整间教室静默停止截图。
  assert.ok(
    code.includes('captureEnabled = d.captureEnabled !== false;'),
    'captureEnabled 必须"认不出就当开"',
  );
});

test('🔴 captureFrame 不得按 document.hidden 设闸', () => {
  const code = stripComments(SDK_SOURCE);
  const capture = code.slice(code.indexOf('function captureFrame()'), code.indexOf('function biggestCanvas()'));
  assert.notEqual(capture.length, 0, '取不到 captureFrame 的函数体，断言会空过');
  // 唯一能决定「停不停」的是 captureLevel（= 有没有教师在看）。
  // 实测：页面不可见时截图库照样能截出有效画面（产物与前台同大小），
  // 所以可见性既不是必要判据、也不是质量判据。
  assert.equal(
    capture.includes('document.hidden'),
    false,
    'captureFrame 不得读 document.hidden —— 那正是「教师端永远是等待画面」的成因',
  );
  assert.ok(capture.includes("captureLevel === 'off'"), 'captureLevel 那道闸必须还在');
});

/**
 * 在一个**最小 DOM 桩**上真跑一遍 SDK 源码，把 `parent.postMessage` 出来的消息记下来。
 *
 * ⚠️ 为什么要有这个：上面那些断言是**结构**断言（正则 / 字符串包含），它们能证明
 * 「源码里写着这一句」，**证明不了那一句真的跑了**。这个项目反复栽在「通过的那个对照
 * 本身没被验证过」上 —— 所以文字档这几条行为另有一条真的执行路径。
 *
 * ⚠️ `readyState` 刻意设成 `'loading'`：那样 SDK 走的是「注册 DOMContentLoaded」那条
 * 分支，**一个定时器都不会建**。设成 `'complete'` 会立刻 startFrames()，留下一个
 * 永不停止的 setInterval ⇒ **测试进程挂死**。这一行不是随手的。
 */
function runSdkOnStub() {
  const posted: { source: string; type: string; payload: Record<string, unknown> }[] = [];
  const listeners: Record<string, ((...args: never[]) => void)[]> = {};
  const record = (type: string, fn: (...args: never[]) => void) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  };
  const documentStub = {
    hidden: false,
    readyState: 'loading',
    documentElement: {
      scrollHeight: 1000,
      clientHeight: 400,
      clientWidth: 800,
      appendChild: () => {},
    },
    addEventListener: record,
    getElementsByTagName: () => [],
    createElement: () => ({}),
  };
  const windowStub = { pageYOffset: 0 };
  const parentStub = { postMessage: (msg: unknown) => { posted.push(msg as never); } };
  // 参数注入而不是往 globalThis 上挂：用例之间不互相污染，也不需要清理。
  const factory = new Function('window', 'document', 'parent', 'addEventListener', SDK_SOURCE);
  factory(windowStub, documentStub, parentStub, record);
  return { posted, listeners, documentStub, windowStub, fire: (type: string) => { for (const fn of listeners[type] ?? []) fn(); } };
}

test('🔴 行为：加载时报一次 presence，可见性变化时才再报，滚动只跨十分位才报', () => {
  const sdk = runSdkOnStub();

  // ── ① 握手 + 构建标记 + 加载时那一次 presence（顺序就是源码里的顺序）──────
  //
  // ⚠️ 中间那条 `diag` 是**构建标记**（`lib-ready`）。它必须在这里被钉住，因为它存在的
  // 理由就是「让诊断能对上『是哪一版 SDK 发出来的』」—— 2026-09-22 撞过一次：
  // 新旧两版对同一故障产出**逐字节相同**的日志，于是「修的东西没生效」与
  // 「故障真的长这样」分不开，白花了一轮真机往返。
  assert.deepEqual(
    sdk.posted.map((m) => m.type), ['ready', 'diag', 'event'],
    '第一条 ready、第二条是构建标记、第三条是加载时的 presence',
  );
  // 构建号**从源码里读**，不写死：钉死的话每次升版都要来改一遍测试，
  // 而这条要守的其实是「标记携带的必须是源码里那个号」。
  const buildInSource = Number(stripComments(SDK_SOURCE).match(/var SDK_BUILD = (\d+);/)![1]);
  assert.ok(Number.isInteger(buildInSource) && buildInSource > 0, 'SDK_BUILD 必须是一个正整数');
  // `w` 是**供应商补丁序号**（见 server/vendor/README.md 的「本地补丁」）。
  // sdk.js 与 shot.js 是两条独立的送达路径，任一条没到都让 iPad 拍不出图且症状相同 ——
  // 所以这两个数必须一起报，否则又分不清「是修的东西没到」还是「故障真的长这样」。
  const patchInSource = Number(stripComments(SDK_SOURCE).match(/var SNAP_PATCH = (\d+);/)![1]);
  assert.ok(Number.isInteger(patchInSource) && patchInSource > 0, 'SNAP_PATCH 必须是一个正整数');
  assert.deepEqual(
    sdk.posted[1].payload, { code: 'lib-ready', n: buildInSource, w: patchInSource, h: 0 },
    '构建标记的载荷：code + 构建序号 + 供应商补丁序号，h 恒为 0',
  );
  // ready 的载荷也已经是新的五字段形状（buildEvent 是唯一构造点）
  assert.deepEqual(Object.keys(sdk.posted[0].payload).sort(), ['at', 'depth', 'image', 'kind', 'to']);
  const first = sdk.posted[2].payload;
  assert.equal(first.kind, 'visibility');
  assert.equal(first.to, 'visible', '页面加载时它是可见的');
  assert.equal(first.depth, 0);
  assert.equal(typeof first.at, 'number');
  // 🔴 旧的三项字段**一个都不在** —— 判据打在**实际发出去的消息**上，不是源码文本上。
  for (const gone of ['selector', 'inputType', 'length']) {
    assert.equal(gone in first, false, `发出去的事件里又出现了 ${gone}`);
  }

  // ── ② 可见性变化：变了才报 ───────────────────────────────────────────────
  //
  // ⚠️ **只数 `event`，不数 `posted.length`。** 从前这里数的是消息总数，于是每次给
  // SDK 加一条诊断（`diag`）都会把这条**与诊断毫无关系**的测试撞红，而修法只能是
  // 再来改一遍数字 —— 那种耦合会让人开始怀疑「是不是行为真的变了」。
  // 这条测的是文字档的行为，就只该看文字档。
  const eventMsgs = () => sdk.posted.filter((m) => m.type === 'event');

  sdk.documentStub.hidden = false;
  sdk.fire('visibilitychange');
  assert.equal(eventMsgs().length, 1, '还是可见 ⇒ 状态没变，不该再发一条');
  sdk.documentStub.hidden = true;
  sdk.fire('visibilitychange');
  assert.equal(eventMsgs().length, 2);
  assert.equal(eventMsgs()[1].payload.to, 'hidden');
  assert.equal(eventMsgs()[1].payload.depth, 0, 'visibility 事件的深度恒为 0');

  // ── ③ 滚动：只在跨过新的十分位时报，而且报的是十分位 ──────────────────────
  // 可滚动高度 = scrollHeight - clientHeight = 600 ⇒ 每一档 60px。
  const scrollEvents = () => sdk.posted.filter((m) => m.type === 'event' && m.payload.kind === 'scroll');
  sdk.windowStub.pageYOffset = 10; // 第 0 档
  sdk.fire('scroll');
  sdk.windowStub.pageYOffset = 30; // 仍是第 0 档 ⇒ 不发
  sdk.fire('scroll');
  assert.deepEqual(scrollEvents().map((m) => m.payload.depth), [0], '同一个十分位里滚多少次都只报第一条');
  sdk.windowStub.pageYOffset = 70; // 第 1 档
  sdk.fire('scroll');
  sdk.windowStub.pageYOffset = 110; // 仍是第 1 档 ⇒ 不发
  sdk.fire('scroll');
  sdk.windowStub.pageYOffset = 200; // 第 3 档（跳过第 2 档也要报）
  sdk.fire('scroll');
  assert.deepEqual(scrollEvents().map((m) => m.payload.depth), [0, 10, 30]);
  sdk.windowStub.pageYOffset = 99999; // 越界 ⇒ 夹到第 10 档
  sdk.fire('scroll');
  assert.deepEqual(scrollEvents().map((m) => m.payload.depth), [0, 10, 30, 100], '越界必须夹到 100，不能报 1660');
  // scroll 事件的 to 恒为空串（不是 undefined，也不是被省略）
  for (const m of scrollEvents()) assert.equal(m.payload.to, '');
  // 所有发出去的消息都带 source 标记，且 type 只可能是 ready / event（还没有帧）
  for (const m of sdk.posted) assert.equal(m.source, 'classnode-sdk');
});

test('行为：SDK 从**不读**输入内容 —— 桩上没有给出任何读内容的接口', () => {
  // 这条是上面那次的阴性对照的另一半：桩里**根本没有** .value / textContent / innerHTML
  // 这类属性（就是一个空对象），而 SDK 全程没有抛错 ⇒ 它确实没去读。
  // 与禁词表（结构断言）互补：那条说"源码里没有"，这条说"跑起来也不需要"。
  assert.doesNotThrow(() => runSdkOnStub());
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
  // 常量名说的是「码元」不是「字节」：比的是 encoded.length（UTF-16 码元数），
  // 一条中文 payload 的实际上限约 96KB UTF-8。名字不该声称代码没做的事。
  assert.ok(code.includes('var MAX_PAYLOAD_CODE_UNITS = 32 * 1024;'));
  assert.equal(code.includes('MAX_PAYLOAD_BYTES'), false, '不得留下与代码不符的旧名字');
  // 上限判据仍在（从一行式改成了块：要在丢弃之前留一条日志）。
  const fromCap = code.slice(code.indexOf('if (encoded.length > MAX_PAYLOAD_CODE_UNITS) {'));
  assert.notEqual(fromCap.length, 0, '取不到上限判据所在的位置，下面的断言会空过');
  const capBody = fromCap.slice(0, fromCap.indexOf('}'));
  assert.ok(capBody.includes('return;'), '超限必须**丢弃**（return），不得抛错、也不得照发');
  // 🔴 而且**不许静默**。这个丢弃原本完全无声，代价极大：Retina 屏上缩略图被 dpr
  //    悄悄放大 4 倍 ⇒ 产物超限被丢在这里 ⇒ SDK、服务端、学生端全正常，
  //    而教师端**永远停在「等待画面…」**，任何一处都不报错。实测踩过。
  assert.ok(capBody.includes('console.error('), '超限丢弃必须留下痕迹 —— 它曾经完全静默，藏了很久');
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

test('截图两档：canvas 直读优先，纯 DOM 才按需加载截图库', () => {
  const code = stripComments(SDK_SOURCE);

  // ── 第一档：canvas 直读，仍在，且仍用 toDataURL 编码成 JPEG ──────────────
  assert.ok(code.includes("document.getElementsByTagName('canvas')"));
  assert.ok(code.includes("off.toDataURL('image/jpeg', JPEG_QUALITY)"));

  // ── 两档的**顺序**：canvas 分支必须**提前 return** ────────────────────────
  // 这条守的是「一个页面同时有大 canvas 和大段 DOM 时，两档会各发一帧」——
  // 后果是帧率翻倍、教师那儿两张图抢一个格子。改这段控制流时它会红，那是故意的。
  const capture = code.slice(
    code.indexOf('function captureFrame()'),
    code.indexOf('function biggestCanvas()'),
  );
  const returnAt = capture.indexOf('return;');
  const domAt = capture.indexOf('captureDomFrame();');
  assert.notEqual(domAt, -1, '第二档必须存在');
  assert.notEqual(returnAt, -1, 'canvas 分支必须提前 return');
  assert.ok(returnAt < domAt, 'canvas 分支必须在第二档**之前** return，否则两档会各发一帧');

  // ── 外部加载：有且只有一处，且只能是那个供应商库 ──────────────────────────
  const loaders = code.split("createElement('script')").length - 1;
  assert.equal(loaders, 1, 'SDK 只允许加载一个外部脚本（第二档的截图库）');
  // ⚠️ 判据绑在**值**上、不绑变量名。上一版写的是 `script.src = ...`，于是把变量改名成
  // `shotScript` 就红了 —— 那是脆，不是严。现在直接比对 SHOT_PATH 本身，改名不再误伤，
  // 而「路径必须来自那一个常量」这条反而被钉得更死。
  const srcAssignment = code.match(/\.src = '([^']*)';/);
  assert.ok(srcAssignment, '必须有一处给 script 赋 src');
  assert.equal(
    srcAssignment[1],
    SHOT_PATH,
    '加载的必须是托管源的截图库路径（SHOT_PATH 是唯一真源，不要在这里写死字面量）',
  );
  for (const other of ['import ', 'require(']) {
    assert.equal(code.includes(other), false, `SDK 不应加载其它外部代码：${other}`);
  }

  // ── 🔴 两个必选项，不是调优项 ────────────────────────────────────────────
  // `cache: 'disabled'`：库的默认缓存每次截图滞留约 1.8MB 且**强制 GC 也不回收**
  // （实测 20 次连拍堆从 15MB 单调涨到 51MB）。10 秒一截 ≈ 10MB/分钟单向累积，
  // 在老 iPad 上就是「打开一会儿页面被系统杀掉」。详见 server/vendor/README.md。
  assert.ok(code.includes("cache: 'disabled'"), 'cache 必须显式关掉，否则老 iPad 内存单向累积');
  // 按缩略图尺寸**直接光栅化**，不是全尺寸截完再缩 —— 后者会把整页像素走一遍。
  // ⚠️ 基准是**视口宽**（vw），不是整页宽：截的是学生此刻看得见的那一块。
  assert.ok(
    code.includes('var scale = thumbnailWidth / vw;'),
    '必须按视口尺寸直接光栅化（scale = 目标宽 / 视口宽），且目标宽来自服务端下发',
  );
  // 🔴 P2.2：宽度与周期都是**服务端按课堂下发的**，不能再是写死的常量。
  //    写死会让「教师调了分辨率」变成一句空话，而且没有任何报错。
  assert.equal(
    code.includes('var THUMBNAIL_WIDTH ='),
    false,
    '缩略图宽度不得是常量 —— 它由服务端按课堂设置下发（认不出才用默认）',
  );
  assert.equal(
    code.includes('FRAME_INTERVAL_BASE'),
    false,
    '不得再有 wall/detail 两张周期表 —— 那个差别由服务端算好，客户端只拿一个数',
  );
  assert.ok(code.includes('var baseIntervalMs ='), '周期必须来自服务端下发的 baseIntervalMs');
  // 🔴 只截可见区。整页截法下 3600px 高的网页会被压成 149x640，字根本看不清。
  // 实测：clip:'viewport' 是视口大小且**跟随滚动**（scroll 0 与 scrollY=1600 的
  // 左上角像素不同），而同一份输入不传 clip 得到的是整页。
  assert.ok(code.includes("clip: 'viewport'"), '必须只截视口，否则长网页的缩略图会糊到看不清');

  // 🔴 `dpr: 1` 是必选项。库的 dpr 默认取 devicePixelRatio，**乘**在输出像素上：
  //    Retina（dpr=2）会把 320 宽悄悄变成 640 宽 —— 像素翻 4 倍、JPEG 从约 1.9 万字符
  //    涨到约 5.6 万，撞上 MAX_PAYLOAD_CODE_UNITS(32768) 被静默丢弃。
  //    症状：SDK/服务端/学生端全部正常，教师端永远「等待画面…」。
  //    ⚠️ headless 浏览器 dpr=1，**复现不了** —— 这正是它藏了这么久的原因。
  assert.ok(
    code.includes("dpr: 1"),
    'toCanvas 必须显式传 dpr: 1，否则 Retina 屏上产物会超限被静默丢弃',
  );

  // 高度也必须夹：只夹宽度的话，又窄又长的页面会让像素数与产物一起爆掉。
  assert.ok(code.includes('THUMBNAIL_MAX_HEIGHT'), '必须有缩略图高度上限（让产物大小可证有界）');
});

test('健壮性：截图库加载失败必须退避重试，不得永久 latch', () => {
  const code = stripComments(SDK_SOURCE);
  assert.ok(code.includes('SHOT_RETRY_MS'), '必须有重试间隔常量');

  // 🔴 回归门。旧实现的第一行是 `if (shotState === 'failed') return;` —— **无条件早退**
  // 等于永久 latch：一次网络抖动就把整节课的缩略图废掉，而且**三处都看不见**
  // （学生端没提示、教师端只看到「这个学生一直没有画面」、日志里没有一行）。
  //
  // 这是实测撞出来的，不是假想：同源的测试夹具曾因 `SHOT_PATH` 是根相对路径而在错误的源
  // 上解析成 404，SDK 从此再也不截，全程无声。详见 progress.md 的 §19 那条异常。
  assert.equal(
    code.includes("if (shotState === 'failed') return;"),
    false,
    '失败分支不得无条件早退 —— 那等于永久 latch，会把一次网络抖动放大成整节课没有画面',
  );

  // 退避期过了必须能把状态放回 idle，否则「重试」只是个常量、没有任何东西会用到它。
  const failedBranch = code.slice(
    code.indexOf("if (shotState === 'failed')"),
    code.indexOf("if (shotState === 'loading')"),
  );
  assert.ok(
    failedBranch.includes("shotState = 'idle'"),
    '失败后必须能回到 idle，否则退避重试那条路径根本走不到',
  );
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
