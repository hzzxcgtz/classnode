export const SDK_PATH = '/__classnode/sdk.js';

/**
 * 按需加载的 DOM 截图库在托管源上的路径（供应商产物，见 `server/vendor/README.md`）。
 *
 * ⚠️ **只有这一个定义点。** `webapp-host.ts` 的路由用它，SDK 源码里那段懒加载也用它
 * —— SDK 源码是模板字符串，`${SHOT_PATH}` 在模块加载时就插值进去了，所以不存在
 * 「两处要同时改」这种会漂移的重复。
 *
 * 为什么是独立文件而不是像 `SDK_SOURCE` 那样内联成字符串：它有 247KB（gzip 83KB），
 * 内联进模板字符串既难看又会让每次读 SDK 都背上这份体积。代价是必须读文件，
 * 于是 dev 与打包产物要走同一条路径 —— 见 `readShotSource()` 的注释。
 */
export const SHOT_PATH = '/__classnode/shot.js';

/**
 * 在返回给学生的 HTML 里注入 SDK。
 *
 * ⚠️ **本文件是 T1 与 T4 的接缝**，也是整个 P2 里唯一跑在**学生浏览器**里的代码 ——
 * 它和 `/classroom/` 一样受老 iPad（Safari 15）约束，因此同时被
 * `scripts/check-classroom-browser-compat.mjs` 的 SCAN_ROOTS 覆盖（见该文件的说明）。
 *
 * ⚠️ **不要再往 webapp-host.ts 里加东西。** 本文件里曾经写着「T4 不得改
 * webapp-host.ts」—— 那是 T1 在**它自己那一轮的窗口内**立的防冲突约束，
 * 窗口已经关闭。事实上 SDK 源码送达浏览器要经过 webapp-host.ts 的
 * `readSdkSource()`，两边必然要接一次。当时的接法是「T1 留一个返回占位串的私有函数，
 * T4 把它的函数体换成 SDK 源码」—— 也就是 T4 只动那一处、一行。
 */
/**
 * 这个位置能不能安全地插一个 `<script>` 标签？
 *
 * 「不安全」= 它落在**未闭合的 `<script>` / `<style>` / `<title>` / `<textarea>` /
 * `<xmp>` 内部**，或者落在**未闭合的 HTML 注释 `<!-- -->` 内部**。落进去的标签不是
 * 元素、只是文本 ⇒ SDK 不会执行、`ClassNode.report` 不存在、**一帧都不上报，
 * 而且没有任何报错**（页面看起来完全正常）。这与 T4 修掉的「裸路径 includes 被正文
 * 绊倒」是**同族但方向相反**的失效（那是跳过注入，这是注入到死处），而且更隐蔽。
 *
 * 做法：只看 `index` 之前的部分，用一个有序的状态机走过去 —— 遇到 `<!--` 就跳到
 * `-->`，遇到这些开标记就跳到对应的闭标记；任何一个找不到闭标记就说明 index
 * 落在它里面。
 *
 * ⚠️ **已知边界（启发式只覆盖到这里，不是「因此安全」）**：
 *   · **不建模** `<noscript>`、`<iframe>`、`<svg>` / `<math>` 这些外来内容里的
 *     文本规则（HTML 在这几处的解析规则各不相同）；
 *   · **不建模属性值**：`<div data-x="<script>">` 里那个 `<script` 会被当成真开标记，
 *     于是后面的候选点被误判成「在 script 内部」而跳过 —— 方向上只是让我们退到更早的
 *     插入点（甚至退到 `<html>` 之后），不会插进死处；
 *   · 自闭合的 `<script src=x />` 按 HTML5 语义当作**未闭合**（浏览器就是这么做的），
 *     所以后面那个 `</head>` 会被判为不安全 —— 同样只影响插到哪，不影响能不能插。
 *   这几种情况下最坏结果是「插到更早的位置」，而不是「插进死处」。
 */
function isSafeInsertionPoint(html: string, index: number): boolean {
  const prefix = html.slice(0, index).toLowerCase();
  // 会吞掉后续文本、到自己的闭标记为止的开标记（HTML 把这些内容当 RCDATA / RAWTEXT 处理，
  // 里面的标签样文本不是标签）。`<script` 与 `</script` 单独处理，因为它俩不成对出现时
  // 前面的判断会失准。
  const rawTextTags = ['style', 'title', 'textarea', 'xmp'];
  let cursor = 0;
  while (cursor < prefix.length) {
    const commentAt = prefix.indexOf('<!--', cursor);
    const scriptAt = prefix.indexOf('<script', cursor);
    let rawAt = -1;
    let rawTag = '';
    for (const rawTagName of rawTextTags) {
      const at = prefix.indexOf(`<${rawTagName}`, cursor);
      if (at !== -1 && (rawAt === -1 || at < rawAt)) {
        rawAt = at;
        rawTag = rawTagName;
      }
    }
    // 剩下三段里最早的那个决定进入哪个状态；都没有就说明 index 之前再无吞噬区
    const candidates: { at: number; kind: string }[] = [];
    if (commentAt !== -1) candidates.push({ at: commentAt, kind: 'comment' });
    if (scriptAt !== -1) candidates.push({ at: scriptAt, kind: 'script' });
    if (rawAt !== -1) candidates.push({ at: rawAt, kind: rawTag });
    if (candidates.length === 0) return true;
    const next = candidates.reduce((left, right) => (right.at < left.at ? right : left));

    let closeAt: number;
    if (next.kind === 'comment') closeAt = prefix.indexOf('-->', next.at + 4);
    else if (next.kind === 'script') closeAt = prefix.indexOf('</script', next.at + 7);
    else closeAt = prefix.indexOf(`</${next.kind}`, next.at + next.kind.length + 1);
    // 闭标记在 index 之后（或根本不存在）⇒ index 落在这个吞噬区里面
    if (closeAt === -1) return false;
    cursor = closeAt + 1;
  }
  return true;
}

/** 从 `from` 开始找第一个安全的 `</head …>` 位置；找不到返回 -1。 */
function findSafeHeadClose(html: string): number {
  const pattern = /<\/head\s*>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    if (isSafeInsertionPoint(html, match.index)) return match.index;
    match = pattern.exec(html);
  }
  return -1;
}

/** 从 `from` 开始找第一个安全的 `<html …>` 开标记的结束位置；找不到返回 -1。 */
function findSafeHtmlOpenEnd(html: string): number {
  const pattern = /<html[^>]*>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    if (isSafeInsertionPoint(html, match.index)) return html.indexOf('>', match.index) + 1;
    match = pattern.exec(html);
  }
  return -1;
}

export function injectSdk(html: string, opts: { sdkPath: string }): string {
  if (!html) return html;
  // 幂等：已经注入过就原样返回。教师自己也可能手写了一个 <script src="…/sdk.js">，
  // 重复注入会让 SDK 跑两遍、每一帧都翻倍。
  // ⚠️ 判据必须匹配**我们实际插入的那个标签形状**，不能是裸路径。
  // 裸路径的 `includes` 是**整篇子串包含**：教师网页的正文或注释里只要出现过
  // 「/__classnode/sdk.js」这几个字（哪怕只是一句「本页已接入探究助手，由
  // /__classnode/sdk.js 提供支持」的说明文案），注入就会被**整体跳过** ——
  // 该页一帧都不上报，而且没有任何报错。方向安全（不采集 ≠ 泄漏）但**静默**。
  // 匹配 `<script src="<sdkPath>` 仍然容得下教师自己写的 `?v=2` 查询串
  // （路由的 query 不参与匹配，照样送出 SDK），却不会再被正文里的路径字样绊倒。
  if (html.includes(`<script src="${opts.sdkPath}`)) return html;

  const tag = `<script src="${opts.sdkPath}"></script>`;

  // 大小写不敏感地找 </head>，但**只认落在安全位置的那个**：教师网页的正文、注释、
  // `<title>` 文本、或 JS 字符串里出现字面量 `</head>` 是常见的（HTML 教学页里的代码
  // 示例尤其如此），取第一个匹配会把 SDK 插进那段文本里 ⇒ 整页静默零采集。
  // 第一个不安全就试下一个候选，全部不安全才退到下面两种兜底 ——
  // 三种兜底都不改 HTML 的其余部分，最坏情况只是脚本早一点执行。
  const headClose = findSafeHeadClose(html);
  if (headClose !== -1) return html.slice(0, headClose) + tag + html.slice(headClose);

  const htmlOpenEnd = findSafeHtmlOpenEnd(html);
  if (htmlOpenEnd !== -1) {
    return html.slice(0, htmlOpenEnd) + tag + html.slice(htmlOpenEnd);
  }

  // 连 <html> 都没有（片段式 HTML）—— 只在看起来像 HTML 时才注入，
  // 避免把一个 JSON 响应改坏。
  //
  // ⚠️ 这个启发式**很粗糙**：`{"a":"<b>"}` 这种正文里含标签样文本的 JSON 也会被
  // 判成 HTML 并注入。这不是理论顾虑，是一条**被测试钉住**的行为（见
  // webapp-sdk-injection.test.ts 里那条「已知粗糙」的断言）。
  // 真正的防线在**调用点**：webapp-host.ts 只在 `target` 以 `.html` 结尾时才调用本函数
  // （`if (!target.toLowerCase().endsWith('.html')) return next();`），
  // 所以非 HTML 响应根本走不到这一行。
  // 整体前置天然是安全位置（前面什么都没有），所以这条分支不需要检查。
  if (!/<[a-z!]/i.test(html)) return html;
  return tag + html;
}

/**
 * SDK 的浏览器源码。作为字符串随本模块一起编译，由 webapp-host.ts 的
 * `readSdkSource()` 原样返回给 `GET /__classnode/sdk.js`。
 *
 * ── 为什么是模板字符串，而不是 server/public-sdk/classnode-sdk.js ──────────
 *  · `tsc` **不会**把 `.js` 资源文件拷进 `dist/`。独立文件就必须在构建脚本里加一条
 *    拷贝，并且 `readSdkSource()` 要按 `__dirname` 往上找 —— 而 `server/src/services/`
 *    （tsx 直跑）与 `server/dist/services/`（编译产物）**往上几级并不相同**。
 *    这正是 webapp-host.ts 的 `webappsRoot()` 注释里已经踩过一遍的那类路径脆弱性，
 *    而且它的失败方式是**静默的**：`dist/` 里少一个 .js，本地 dev 一切正常，
 *    只有打包后的桌面端在学生打开 iframe 时拿到 404。
 *  · 模板字符串把「源码」与「注入它的代码」绑在同一个编译单元里，dev / dist /
 *    桌面端打包三种形态下都是同一个值，**没有第二条路径可以走错**。
 *  · 代价（须明说）：SDK 里的 JS 没有独立语法高亮与 lint，且要受下面三条书写约束。
 *    作为补偿，`webapp-sdk-injection.test.ts` 会机械校验这三条约束，并用
 *    `new Function(SDK_SOURCE)` 真的把源码喂给 JS 解析器 —— 语法错会在 `pnpm test`
 *    里炸，而不是在学生打开网页时才炸。
 *
 * ── 本字符串的三条书写约束（由测试机械校验，不是「请记得」）─────────────
 *   1. **不含反引号** —— 它整体是一个模板字符串的内容；
 *   2. **不含美元符紧接左花括号的序列** —— 那会变成宿主模板串的插值；
 *   3. **一个反斜杠都不出现** —— 模板字符串会吃掉一层转义（正则里的简写字符类
 *      会静默退化成裸字母，`s` 与反斜杠加 s 读起来一模一样，但语义完全不同）。
 *      约束 3 让「需要转义的地方」变成**零**，于是「少写一个转义导致静默变形」
 *      这个失效模式根本不存在。代价是这里不能用正则简写，一律用等价写法替代。
 */
export const SDK_SOURCE = `/*
 * ClassNode 探究助手 SDK
 *
 * 由独立源的托管服务（规格 §5.1）注入到学生 iframe 打开的教师网页里，做四件事：
 * 与父页面握手、**定时拍缩略图**（两档：canvas 直读 / 纯 DOM 光栅化）、
 * 上报**文字档**（可见性 + 滚动深度）、响应父页面的挂起/恢复。
 *
 * ══ 采集范围：只有两种事件（P2.2 用户裁定，比原来更窄）═════════════════════════
 * 点击 / 输入 / 页面内跳转**一律不采集，将来也不加**：这三类都要带「内容」才能用
 * （点了哪个元素、输入框里有多少字符、跳到了哪个锚点），而学生是未成年人。
 * 采集的只有下面两项，载荷恒为四个字段（kind / to / depth / at），
 * **没有任何自由文本字段**（to 是短枚举字面量，depth 是一个十分位整数）：
 *   · visibility —— 只有 'visible' / 'hidden' 两个取值；
 *   · scroll     —— 只有 0 / 10 / 20 / … / 100 这十一个十分位。
 * ⚠️ 旧的 selector / inputType / length 三个字段**一项都没回来**。原来的七字段契约
 * 会带上「点了哪个元素」「输入框里有多少字符」—— 用户不要；而**窄契约本身就是
 * 一个更强的隐私位置**，不是「删剩下来的残渣」。
 *
 * 本文件把这条保证做成**结构约束**，而不是「实施者记得别读输入框」：
 *   · 全 SDK **不存在任何读输入内容的代码** —— 不读表单控件的值、不读元素文本、
 *     不读元素 HTML（webapp-sdk-injection.test.ts 用一张禁词表对全文逐个断言）；
 *   · 所有上报载荷都由**唯一一个**函数 buildEvent() 构造，而它的返回形状只有五项
 *     （kind / to / depth / image / at），**没有位置可以装下一块页面文本**；
 *   · post() 的 type 集合是**封闭的四项**：ready / frame / event / report。
 *
 * 想加一个能装内容的字段，必须同时改 buildEvent 与 post 的调用点 —— 那是一件
 * 必须刻意去做的事，而不是「顺手把输入框里的值传进去」。
 *
 * ══ ⚠️ 把保证说窄 —— 上面那段**不等于**「除 report 之外没有任何自由数据」═══
 *   · image 是自由字符串：它是**页面自己画出来的像素**（canvas 直读或光栅化产物
 *     经 JPEG 编码后的 data URL），不是输入内容，但它确实是一条能出门的自由数据。
 *
 * **真实的保证只有一条，而且要说窄**：每条通道**恰好一个内部调用点**
 * （post() 只有 4 个：ready / frame / event / report），且每个字段的**取值来源被逐一枚举**
 * （kind ← 短枚举字面量；to ← 短枚举字面量；depth ← 视口滚动位置的十分位；
 * image ← 页面自己画出来的像素；at ← 时间戳）。
 * ⇒ 「新增一条内容通道」必须是一次**显式的代码改动**，而不是「顺手传进去」。
 * 这是本文件真正买到的东西。
 *
 * ══ 文字档为什么**必须**在页面加载时就报一次 presence ═════════════════════════
 * visibility 事件只在**变化时**触发 ⇒ 一个打开页面后安静阅读、不滚不切的学生
 * **什么都不会发**，教师图墙上那一格永远是空的 —— 而那正是这条链路要解决的问题。
 * 所以加载时补报一次 'visible'（语义自洽：我此刻确实可见），把 presence 送出去。
 * ⚠️ 这一次**在 captureEnabled 为 false 时也必须发**：画面开着时本来就有帧，
 *    不缺这一条；**画面关掉时它就是教师能看到的唯一信息**。
 *
 * ══ ClassNode.report()：唯一一条由**教师网页**决定内容的通道 ══════════════
 * 它仍然保留（这是接口契约的一部分）：教师网页要采集具体内容时，只能自行显式
 * 调用 ClassNode.report()，那是教师自己的选择与责任。
 * ⚠️ **说窄**：本版本没有任何内部调用者，父页面那一侧也没有下游消费者
 * （事件链路已整体删除）—— 也就是说它今天是**死代码**，保留的是**接口**而不是功能。
 * 谁要把它接上，必须显式地接一条新通道。
 *
 * ══ 本文件的三条书写约束（由 server/src/tests/webapp-sdk-injection.test.ts 校验）══
 *   1. 整体是 webapp-sdk.ts 里一个模板字符串的内容，因此**不能出现反引号**；
 *   2. 不能出现美元符紧接左花括号的序列（那会变成宿主的插值）；
 *   3. **一个反斜杠都不出现** —— 模板字符串会吃掉一层转义，正则简写会静默变形。
 *      所以这里的正则一律用等价写法替代（事件链路删掉之后，本文件已经没有正则了）。
 */
(function () {
  'use strict';

  // 同一个页面里脚本被加载两次时（教师自己写了一份，注入器又插了一份），
  // 第二次直接退出。重复安装会让每一帧都上报两遍，而父页面分辨不出来。
  if (window.__classnodeSdkInstalled) return;
  window.__classnodeSdkInstalled = true;

  var SDK_TAG = 'classnode-sdk';
  var PARENT_TAG = 'classnode-parent';

  // 单条消息上限（规格 §5.4）。教师网页可以 report 任意东西，一条 10MB 的 payload
  // 会让老 iPad 在 postMessage 的结构化克隆上卡住。超限**丢弃**，不截断、不重试。
  // ⚠️ 名字说的是「码元」而不是「字节」—— 因为下面比的是 encoded.length，
  // 那是 **UTF-16 码元数**，不是字节数。一条中文 payload 的实际上限因此约是
  // 32K 码元 ≈ 96KB UTF-8，而不是 32KB。**行为不改**（意图是限住工作量，
  // 码元口径完全够用），改的是名字：名字也是一种散文，它不该声称一件代码
  // 没做的事。（brief 里叫它 MAX_PAYLOAD_BYTES。）
  var MAX_PAYLOAD_CODE_UNITS = 32 * 1024;
  /**
   * 单帧图像留给自己的字符预算：总上限扣掉 JSON 外壳（约 80 字符）再留一点余量。
   * 超过它就在本地缩一档重编码，而不是硬撞上去让 post() 丢掉。
   */
  var PAYLOAD_BUDGET = MAX_PAYLOAD_CODE_UNITS - 512;
  /** 超限时每次缩小的比例；最多降几档。两档 0.75 之后像素约为原来的 32%。 */
  var DOWNSCALE_STEP = 0.75;
  var MAX_DOWNSCALE_ATTEMPTS = 2;

  // 缩略图节奏与尺寸。
  //
  // ══ 截图节奏由**两个相乘的因子**决定 ═══════════════════════════════════
  //
  //   1. 关注度（教师想多快）—— 基准间隔，服务端经 webapp-monitor-demand 下发：
  //        off    —— 没有教师在看 ⇒ **根本不截**（Ruling 9：学生端开销为零）
  //        wall   —— 教师在看板图墙上看着（几十个格子同时在推，必须便宜）
  //        detail —— 教师点开了**这个学生**的详情，要尽量实时
  //   2. 设备能力（这台的设备能多快）—— 由本 SDK 实测耗时后乘 COST_TIERS 降频。
  //        规格 §5.5「测量截图耗时，超过 300ms 自动降档」**在这里执行**：耗时只有本 SDK
  //        量得到（就在 drawImage + toDataURL 那一行上），而且是**每台设备**自己的事 ——
  //        同一间教室里老 iPad 与新电脑该待在不同的档。
  //
  // ⚠️ **契约变更（P2.1）**：原来 webapp-monitor-demand 只有一个 watching 布尔，
  // 档位全由设备自己定。现在多了关注度这一维，载荷变成 { watching, detail } ——
  // 「想多快」由教师侧决定，「能多快」仍由设备侧决定，**两者不许互相顶替**：
  // 服务端不下发耗时档位，SDK 也不自己判断有没有人在看。
  /**
   * 服务端下发的**本档基准周期**（毫秒）。
   *
   * ⚠️ **wall / detail 两张表已经删掉了**：那个差别现在由服务端算好（只有它知道课堂设置），
   * 这里只拿一个数来用。曾经这里是 「{ wall: 10000, detail: 2000 }」 —— 那是把
   * 「详情档该比图墙快多少」这个**策略**复制到了客户端，另一份在服务端，必然漂移。
   */
  var baseIntervalMs = 10000;
  var COST_TIERS = [1, 2, 4];
  // 一帧超过 SLOW_FRAME_MS 记一次「慢」，连续 SLOW_RUN 次就升一档；连续 FAST_RUN 次
  // 快于 FAST_FRAME_MS 就降回来 —— 只要升不要降的话，一次 GC 卡顿会把整节课钉在最慢档。
  var SLOW_FRAME_MS = 300;
  var FAST_FRAME_MS = 150;
  var SLOW_RUN = 3;
  var FAST_RUN = 10;
  /**
   * 服务端下发的缩略图目标宽度（它已夹在 160~640）。
   *
   * 默认值与服务端一致：**认不出就用默认，绝不让"认不出"变成"更小"或"不截"**。
   */
  var thumbnailWidth = 320;

  /**
   * 是否采集**画面**。false ⇒ 连 canvas 直读也不发，只留文字档。
   *
   * ⚠️ 这与 captureLevel 为 off 是**两件事**，虽然都导致不发图：
   *   · off —— 没人看 / 模块不在前台，是**临时**状态；
   *   · 这个 —— 教师按课堂设置的"不要画面"，是**长期**决定。
   * 分开是因为文字档（可见性 / 滚动深度）只受前者影响：关掉画面之后，
   * 教师仍然要看"这个学生有没有在用"。
   */
  var captureEnabled = true;
  /**
   * 缩略图的高度上限。**这不是审美，是让产物大小可证有界。**
   *
   * 只夹宽度是不够的：一个又窄又长的网页（长卷 / 思维导图）按宽度等比缩放后，
   * 高度会很大 ⇒ 像素数与 JPEG 一起爆掉 ⇒ 撞上 MAX_PAYLOAD_CODE_UNITS，
   * 而那个上限是**静默丢弃**。320x640 = 20.5 万像素，实测产物约 2 万字符，
   * 离 32768 的上限有一倍余量。
   */
  var THUMBNAIL_MAX_HEIGHT = 640;
  var JPEG_QUALITY = 0.4;

  // 默认 'wall' 而不是 'off'：父页面正常时会立刻纠正它（握手时会补发一次当前档位）。
  // 万一父页面坏了、一条 demand 都没发过来，默认档让这个页面仍然以**低频**出图 ——
  // 比默认 'off'（什么都不出、且没有任何报错）好排查得多。
  var captureLevel = 'wall';
  var frameTimer = null;
  var tierIndex = 0;
  var slowRun = 0;
  var fastRun = 0;

  // ══════════════════════════════════════════════════════════════════════
  // 唯一的载荷构造点。**本文件内所有上报都必须经过这里。**
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ⚠️ 本函数**不接受任何自由文本参数**，而且它的返回形状是**封闭的五项**。
   *
   * 参数表就是白名单：
   *   kind  —— 短枚举字面量（ready / frame / visibility / scroll）；
   *   to    —— 短枚举字面量，只有 '' / 'visible' / 'hidden' 三种取值；
   *   depth —— 滚动十分位（0 / 10 / … / 100），一个整数；
   *   image —— 帧的 data URL，是**页面自己画出来的像素**，不是输入内容；
   *   at    —— 时间戳，一个数字。
   *
   * ⚠️ 旧的 selector / inputType / length 三项**一律没有回来**（P2.2 的 T5 刻意如此）——
   * 那三项正是「点了哪个元素」「输入框里有多少字符」的载体。它们不在，所以这里**没有位置**
   * 可以装下元素定位串、输入类型、输入长度。
   * 要加回一个能装内容的字段，必须先改本函数 —— 那是一件必须刻意去做的事。
   *
   * 教师的网页要采集具体内容，只能显式调用 ClassNode.report()（见文件头那一段）。
   *
   * ⚠️ 但**不要**把本函数读成「每个字段都无害」：image 是自由字符串。
   * 真正的保证是「每个字段的**取值来源**被逐一枚举」，见文件头「把保证说窄」那一段。
   */
  function buildEvent(kind, fields) {
    var f = fields || {};
    return {
      kind: typeof kind === 'string' ? kind : '',
      to: typeof f.to === 'string' ? f.to : '',
      depth: typeof f.depth === 'number' ? f.depth : 0,
      image: typeof f.image === 'string' ? f.image : '',
      at: Date.now()
    };
  }

  /**
   * 唯一出口。三条硬防护都在这里：挂起时静默、序列化失败即丢弃、超限即丢弃。
   *
   * 目标源**只能**是星号 —— 父页面来自另一个源（独立源托管服务），iframe 无法
   * 预先知道它的 origin。安全性由**父页面侧的 e.source 校验**保证（T6 负责）；
   * 本 SDK 这侧对称地做来源校验，见下面的 message 监听。
   */
  function post(type, payload) {
    if (captureLevel === 'off' && type !== 'ready') return;
    var msg = { source: SDK_TAG, type: type, payload: payload };
    var encoded;
    try {
      encoded = JSON.stringify(msg);
    } catch (err) {
      return; // 环形结构 / 含 BigInt / toJSON 抛错 —— 丢弃，绝不往外冒
    }
    if (encoded.length > MAX_PAYLOAD_CODE_UNITS) {
      // 超限即丢，见该常量的说明。
      //
      // ⚠️ **这条日志是刻意保留的（不是临时诊断）。** 这个丢弃原本完全静默，代价极大：
      // 实测踩过一次 —— Retina 屏上缩略图被 dpr 悄悄放大 4 倍，产物超限被丢在这里，
      // 于是 SDK 一切正常、服务端一切正常、学生端 state 全对，而**教师端永远停在
      // 「等待画面…」**，任何一处都不报错。再也别让这件事无声发生。
      console.error('[SDK] 上报超限被丢弃 type=' + type + ' 字符数=' + encoded.length + ' 上限=' + MAX_PAYLOAD_CODE_UNITS);
      // ⚠️ **只对非诊断通道上报诊断**：「diag」 自己也走这条路（这是刻意的，见 reportDiag
      // 的注释），而它自己的载荷只有几十字节、不可能超限。加这道判断是为了防「万一
      // 上限被改小」时变成一个无限递归 —— 那种崩溃在现场极难归因。
      if (type !== 'diag') reportDiag('over-budget', encoded.length, 0, 0);
      return;
    }
    try {
      parent.postMessage(msg, '*');
    } catch (err) {
      // 父窗口已经没了（学生切页、关闭）。吞掉：这里是全局事件回调，
      // 抛出去只会污染教师网页。
    }
  }

  // ── 文字档：可见性 + 滚动深度 ══════════════════════════════════════════
  //
  // 只有这两项，而且**每一类的监听器恰好一个**（见文件头「采集范围」那一段）。
  // 点击 / 输入 / 跳转一个监听器都没有，将来也不加。
  /**
   * 上报一条文字档事件。
   *
   * ⚠️ 这是 post('event', …) 的**唯一**调用点，而载荷字段由 buildEvent 的形参表定死
   * （kind / to / depth）—— 想加字段必须改 buildEvent，那是一次刻意改动。
   */
  function reportEvent(kind, to, depth) {
    post('event', buildEvent(kind, { to: to, depth: depth }));
  }

  // ── 诊断通道（第 5 条）════════════════════════════════════════════════════
  //
  // 🔴 **为什么需要它 —— 这不是「顺手加点日志」。**
  // 老 iPad（iPadOS 15.8.8）上报「教师端只看得到浏览位置、看不到图片」，而这条链路的
  // 失败此前**在服务端完全不可见**：失败只写进 iframe 的 console，而 Safari 在 iOS 上
  // **不把跨源 iframe 单列成可检查的目标**（实测：Mac 的「开发」菜单下那台 iPad 只有
  // 父页面 「classroom」 一个目标，iframe 不在列表里）⇒ 那些 console 日志
  // **结构上取不到**，不管操作多仔细。
  //
  // ⇒ 把诊断送出去是唯一的路。而它必须走 post()，不能另开一条旁路：
  //    另开旁路 = 绕过 webapp-sdk-injection.test.ts 那条「通道集合是封闭的」红线测试，
  //    等于偷偷多一条能出门的路径。**扩展那条红线要显式改它，这是刻意的。**
  //
  // ⚠️ **载荷只有一个封闭枚举码 + 三个整数，没有任何自由字符串。**
  //    它装不下 selector / inputType / length / 任意文本 —— 这条通道**不放松**原来那条
  //    实质保证（「SDK 里装不下任何页面内容」），只是把可上报的东西从「有无」细化到
  //    「哪一类」。
  var DIAG_CODES = [
    'dom-tier-gave-up', // 连续失败到阈值，已按库加载失败那套退避（n = 连续失败轮数）
    'lib-ready',       // 一次性：这个 document 跑的是哪个构建（n = 构建序号）
    'lib-load-failed', // 截图库加载不到 / 没有 window.snapdom
    'viewport-zero',   // 视口宽度读成 0，算不出缩放比例
    'sync-throw',      // toCanvas 同步抛错
    'not-promise',     // toCanvas 没返回 Promise（版本不匹配）
    'capture-error',   // toCanvas 的 Promise reject
    'empty-canvas',    // 库 resolve 了，但产物是空串
    'canvas-empty',    // canvas 直读档拿不到产物
    'timeout',         // 看门狗：一轮光栅化超时
    'over-budget'      // 整条消息超过单条上限被丢
  ];

  /** 夹成非负整数：诊断值不许把 NaN / Infinity / 负数漏出去。 */
  function toDiagInt(value) {
    var num = Number(value);
    if (!isFinite(num) || num < 0) return 0;
    return Math.min(Math.round(num), 100000000);
  }

  /**
   * diag 载荷的**唯一构造点**（与 buildEvent 同一个理由：形状在这里定死）。
   * 「n」 / 「w」 / 「h」 的含义随 code 而定，都是计数或尺寸，没有一个是文本。
   */
  function buildDiag(code, n, w, h) {
    return { code: code, n: toDiagInt(n), w: toDiagInt(w), h: toDiagInt(h) };
  }

  /** 上报一条诊断。**只认白名单里的码** —— 打错的码直接丢，不往网络上送。 */
  function reportDiag(code, n, w, h) {
    if (DIAG_CODES.indexOf(code) === -1) return;
    post('diag', buildDiag(code, n, w, h));
  }

  /**
   * 截图库**已知失败签名**的封闭表。
   *
   * ⚠️ 这张表只用来**归类**，归类结果是**一个下标整数** —— 错误原文**永远不出门**。
   * 为什么不直接把 「err.message」 报出去：那是库抛出来的自由文本，可能带上教师网页的
   * 类名 / 路径 / 片段，而这条通道的全部前提就是「装不下任何页面内容」。
   * 下标整数满足那条保证，同时足以定位是哪一类失败。
   *
   * 表里的字符串**逐条抄自 vendored snapdom 3.0.0 的 「throw」 语句**（该文件里共 24 处
   * throw、去重 23 条），所以命中率是有依据的，不是猜的。
   */
  var KNOWN_CAPTURE_ERRORS = [
    'Transform needs a reference box',
    'Invalid transform composition',
    'svg without dimensions',
    'External or namespaced CSS',
    'Attribute-dependent or nested CSS',
    'canvas crop requires finite',
    'cannot crop a non-SVG capture',
    'cannot crop an SVG without a finite viewBox',
    'canvas crop does not intersect',
    'canvas crop requires an SVG capture payload',
    'the target canvas has no 2d context',
    'iframe document not accessible',
    'iframe capture requires',
    'Failed to read blob URL',
    'Invalid node',
    'Element cannot be null or undefined',
    'html string required',
    'Unknown export type',
    'is internal. Use snapdom',
    // ⚠️ 用双引号：单引号版要写反斜杠，而本文件**一个反斜杠都不许有**。
    "plugin '",
    'global plugin'
  ];

  /** 错误名归类的封闭表 —— 同样只出去一个下标。0 一律表示「认不出」。 */
  var KNOWN_ERROR_NAMES = [
    'TypeError',
    'SecurityError',
    'DOMException',
    'Error',
    'ReferenceError',
    'RangeError',
    'NotSupportedError',
    'InvalidStateError',
    'AbortError',
    // ⚠️ 下面三个是 2026-09-22 补的：实测拿到 h=103（有 name 但不在表里），
    // 而 JS 规范里的标准错误名就这几个 —— **漏掉一个就等于永远认不出它**。
    // SyntaxError 尤其可疑：它是浏览器拒绝解析选择器 / 变换串时抛的典型名字。
    'SyntaxError',
    'URIError',
    'EvalError',
    // ⚠️ **DOMException 的子名是一份规范里封闭的清单**，而 2026-09-22 实测拿到的
    // h 一直是 103（有 name 但我认不出）—— 我最初只列了其中 4 个，等于把整类漏掉了。
    // 下面把规范里的名字补全（与上面重复的略去）。
    'IndexSizeError',
    'HierarchyRequestError',
    'WrongDocumentError',
    'InvalidCharacterError',
    'NoModificationAllowedError',
    'NotFoundError',
    'InUseAttributeError',
    'InvalidModificationError',
    'NamespaceError',
    'InvalidAccessError',
    'TypeMismatchError',
    'NetworkError',
    'URLMismatchError',
    'QuotaExceededError',
    'TimeoutError',
    'InvalidNodeTypeError',
    'DataCloneError',
    'EncodingError',
    'NotReadableError',
    'UnknownError',
    'ConstraintError',
    'DataError',
    'TransactionInactiveError',
    'ReadOnlyError',
    'VersionError',
    'OperationError',
    'NotAllowedError',
    // 最后一条兜底：有些环境给的是空名字段的变体。
    'DOMError'
  ];

  /** 返回值是 「KNOWN_CAPTURE_ERRORS」 里的**下标 + 1**；0 = 认不出。 */
  function classifyCaptureError(err) {
    var text = err && err.message ? String(err.message) : '';
    if (!text) return 0;
    for (var i = 0; i < KNOWN_CAPTURE_ERRORS.length; i++) {
      if (text.indexOf(KNOWN_CAPTURE_ERRORS[i]) !== -1) return i + 1;
    }
    return 0;
  }

  /** 返回值是 「KNOWN_ERROR_NAMES」 里的**下标 + 1**；0 = 认不出。 */
  function classifyErrorName(err) {
    var name = err && err.name ? String(err.name) : '';
    if (!name) return 0;
    for (var j = 0; j < KNOWN_ERROR_NAMES.length; j++) {
      if (name === KNOWN_ERROR_NAMES[j]) return j + 1;
    }
    return 0;
  }

  /** 构建序号。**每次改 SDK 都要 +1** —— 见 reportDiag('lib-ready') 那一处的注释。 */
  var SDK_BUILD = 9;

  /**
   * 供应商文件（「server/vendor/snapdom.js」）的**本地补丁序号**。见 「server/vendor/README.md」。
   *
   * 为什么要单独报：vendor 文件与 SDK 是**两条独立的送达路径**（一个是 「shot.js」 懒加载、
   * 一个是 「sdk.js」 注入），任一条没到都会让 iPad 拍不出图，而**症状一模一样**。
   * 2026-09-22 就因为分不清「修的东西到没到设备」白花了一轮往返 —— 这次一次报全。
   * ⚠️ 每打一次 vendor 补丁就 +1。
   */
  var SNAP_PATCH = 2;

  /**
   * 「拒因到底长什么样」—— 一个封闭枚举整数，进 w 字段。
   *
   * 🔴 为什么需要它：2026-09-22 实测拿到 w=0 h=0，而 0 同时意味着「不在已知表里」
   * 和「压根没有 message」这两件完全不同的事 —— **含糊的枚举码把一次往返浪费掉了**。
   * 所以这里把「拒因的形状」本身变成可上报的事实。
   *
   * 100+ 段专治「拒因不是 Error」：库 reject 一个 undefined / 字符串 / 裸对象时，
   * 所有基于 name/message 的分类都会退化成 0，而那正是最难猜的一类。
   */
  function describeRejection(err) {
    if (err === null || err === undefined) return 100; // 无值
    var shape = typeof err;
    if (shape === 'string') return 101;                // 字符串
    if (shape === 'number') return 102;                // 数字
    if (shape === 'boolean') return 103;               // 布尔
    if (shape === 'function') return 104;              // 函数
    if (shape !== 'object') return 105;                // symbol / bigint 等
    if (!err.message) return 106;                      // 对象，但没有 message
    var matched = classifyCaptureError(err);
    if (matched > 0) return matched;                   // 命中已知的库抛错
    // 🔴 有 message 但不在已知表里 ⇒ **改用消息长度**（1000 + 字符数，上限 999）。
    //
    // 为什么不是一句「107 认不出」就算了：2026-09-22 实测拿到的就是「有 message 但
    // 不在表里」，而那个 0 信息量的码**又白花了一轮真机往返** —— 我连「是 Safari
    // 自己抛的还是库抛的」都分不出来。长度是一个**有界整数**，足以把候选缩到个位数，
    // 又装不下任何文本。
    //
    // ⚠️ 说窄：这是**唯一**一处从自由文本里提取的信息，而且只有长度。它可能带上
    // 教师网页的几比特（若某条消息里嵌了选择器之类），这是**刻意接受的代价** ——
    // 换来的是「一类失败可定位」。它不改变那条实质保证：这里依然装不下内容本身。
    var len = String(err.message).length;
    return 1000 + (len > 999 ? 999 : len);
  }

  /**
   * 「拒因的名字长什么样」—— 进 h 字段。与 describeRejection 同一套理由。
   * 1..N = 已知错误名；100+ = 结构性事实。
   */
  function describeRejectionName(err) {
    if (err === null || err === undefined) return 100;
    if (typeof err !== 'object' && typeof err !== 'function') return 101; // 不是对象，谈不上 name
    if (!err.name) return 102;  // 是对象，但没有 name
    var idx = classifyErrorName(err);
    if (idx > 0) return idx;    // 命中已知名
    // 🔴 认不出时**报名字的长度**（1000 + 字符数，上限 999），而不是一句无信息量的 103。
    // 与消息长度同一个理由：2026-09-22 连着两轮都拿到「认不出」，而那是**零信息**——
    // 名字的长度是**有界整数**，配上消息长度足以把候选缩到个位数（例如
    // DataCloneError 是 14 字符、InvalidCharacterError 是 21 字符）。
    var nameLen = String(err.name).length;
    return 1000 + (nameLen > 999 ? 999 : nameLen);
  }

  /** 当前可见性。**只有两个取值**，没有第三个，也没有自由文本。 */
  function visibilityState() {
    return document.hidden === true ? 'hidden' : 'visible';
  }

  /** 上一次**报出去**的可见性。初值是空串（不是一个合法取值）⇒ 加载时那一次必然出门。 */
  var lastVisibility = '';

  /**
   * 报一次当前可见性。
   *
   * force 为假时**只在它真的变了的时候**才出门（这是变化驱动的通道，默认就该这样）；
   * force 为真时无条件报一次 —— 那两处是**presence 补报**（页面加载时、教师打开看板时），
   * 它们要的正是「再报一遍我现在可见」，去重会把这两条整个吞掉。
   *
   * ⚠️ 报的是**当下的真实状态**，不是写死的 'visible'：页面在后台标签里被恢复
   * （浏览器恢复上次会话时很常见）时 document.hidden 就是真，那时教师该看到的是
   * 「已切走」。写死 'visible' 会让教师图墙显示一句假话，而这一行没有省下任何东西。
   */
  function reportVisibility(force) {
    var next = visibilityState();
    if (!force && next === lastVisibility) return;
    lastVisibility = next;
    reportEvent('visibility', next, 0);
  }

  /**
   * 上一次报出去的**十分位**。初值 -1 而不是 0：页面加载时如果学生已经在第 0 档，
   * 那次滚动不该被当成「没变化」吞掉。
   */
  var lastDecile = -1;

  /**
   * 滚动深度：**只在跨过新的十分位时才报**。
   *
   * ⚠️ 逐条 scroll 事件上报是不行的：学生一划就是每秒几十条，老 iPad 与 socket
   * 会一起被打满，而教师那边想要的信息只是「滚到大概哪儿了」。十分位足够表达它，
   * 又把一个突发压成一条。
   */
  function reportScrollDepth() {
    var doc = document.documentElement;
    var scrollable = (doc.scrollHeight || 0) - (doc.clientHeight || 0);
    var decile = 0;
    if (scrollable > 0) {
      decile = Math.floor(((window.pageYOffset || 0) / scrollable) * 10);
      if (decile < 0) decile = 0;
      if (decile > 10) decile = 10;
    }
    if (decile === lastDecile) return;
    lastDecile = decile;
    reportEvent('scroll', '', decile * 10);
  }

  /**
   * 切走 / 切回：**报一次可见性**，并在切回前台时**立刻补一帧**。
   *
   * ⚠️ **切走时什么都不做**（以前会 stopFrames()）。理由见 captureFrame 上面那一段：
   * 决定「画不画」的是有没有教师在看，不是这个页面可不可见。
   * 学生切走这件事本身仍然有意义 —— 它由上面那行上报送给教师图墙（「已切走」）。
   */
  document.addEventListener('visibilitychange', function () {
    reportVisibility(false);
    if (document.hidden !== true) captureFrame();
  });

  // capture 阶段（第三个实参为真）：学生可能会在一个内部滚动容器里滚动，
  // 事件不冒泡到 document —— 捕获阶段才收得到。**收得到 ≠ 多采集**：
  // 载荷仍然只有那一个十分位数字。
  document.addEventListener('scroll', reportScrollDepth, true);

  /**
   * 截图：**只做 canvas 直读**（控制器 Ruling 6 —— P2 不引截图库）。
   *
   * ══ 两档（规格 §5.4）══════════════════════════════════════════════════════
   *   第一档：页面里有大 canvas ⇒ **直读它的像素**（免费，不做任何 DOM 遍历）。
   *   第二档：没有大 canvas（纯 DOM 网页）⇒ **按需加载**截图库把页面光栅化成图。
   *
   * 第二档的库**不下载就不会加载**：有大 canvas 的网页永远不付这份 83KB（gzip）。
   * 这就是规格说的「页面无大 canvas 时按需加载截图库」。
   *
   * ⚠️ 第二档只在**第一档拿不到图**时才走。一个页面同时有 canvas 和大段 DOM 时，
   * canvas 那份更准也更便宜 —— 不要改成「两个都发」，那会让帧率翻倍而教师只看到一张。
   */
  function captureFrame() {
    // ⚠️ **只看「有没有教师在看」，不看这个页面可不可见。**
    //
    // 这里曾经还有一段「document.hidden 为真就直接 return」，理由是「学生切走时
    // 没人看缩略图」——
    // **那个假设是错的：看缩略图的是教师，不是学生。** 学生窗口被遮挡（后台标签页、
    // 或 macOS 上被别的窗口完全盖住时的遮挡检测）并不改变教师想看什么。
    //
    // 代价实测为零：页面不可见时截图库照样能截出有效画面，产物与前台**同大小**
    // （2683 vs 2683 字符），不是空白图。成本由 captureLevel 把住。
    //
    // 症状对照：加着这道闸时，教师端那一格会**永远停在「等待画面…」**，
    // 而学生明明显示在线 —— socket 还连着，截图却一帧都没发生。
    if (captureLevel === 'off') return;
    // 教师按课堂关掉了画面 ⇒ 连 canvas 直读也不发（它是"全关"，不是"只关贵的那档"）。
    // 文字档（可见性 / 滚动深度）不受这条影响 —— 见 captureEnabled 的注释。
    if (!captureEnabled) return;

    var best = biggestCanvas();
    if (best) {
      // 耗时只算「画 + 编码」这一段：那才是老 iPad 上真正贵的地方，也是降频要躲的东西。
      // Date.now() 而不是 performance.now()：本文件一个反斜杠都不能出现（见文件头约束 3），
      // 而 300ms 这个量级不需要亚毫秒精度。
      var startedAt = Date.now();
      var url = thumbnail(best);
      if (!url) {
        // canvas 直读档的**静默丢弃**：画布尺寸为 0，或被跨源内容污染导致
        // 「toDataURL」 抛 SecurityError —— 两种情况都只返回空串。
        // ⚠️ 从前这里一声不响，于是「教师端一直没有图」在客户端查不出任何痕迹。
        console.warn('[SDK] canvas 直读拿不到产物（尺寸为 0 或被跨源内容污染），跳过这一帧');
        reportDiag('canvas-empty', 0, 0, 0);
        return;
      }
      noteFrameCost(Date.now() - startedAt);
      post('frame', buildEvent('frame', { image: url }));
      return;
    }

    captureDomFrame();
  }

  /** 页面里面积最大的 canvas；没有或面积为零则返回 null。 */
  function biggestCanvas() {
    var canvases = document.getElementsByTagName('canvas');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var area = (canvases[i].width || 0) * (canvases[i].height || 0);
      if (area > bestArea) {
        bestArea = area;
        best = canvases[i];
      }
    }
    return bestArea > 0 ? best : null;
  }

  // ── 第二档：纯 DOM 截图 ────────────────────────────────────────────────
  //
  // 库的加载状态机。**失败只试一次**：每 10 秒重试一次会在老 iPad 上变成一个
  // 永不停止的请求风暴，而这期间学生什么都没得到。
  var shotState = 'idle'; // idle | loading | ready | failed
  /**
   * 上一次光栅化是否还在飞。
   *
   * 这是**常驻的防重入闸**（不是诊断用的临时变量）：它守的是「Promise 既不 resolve
   * 也不 reject」这种挂死状态 —— 那种情况下 then 与 catch 一个都不会跑，没有这道闸
   * 就会一帧一帧往上堆。
   *
   * 🔴 **但只有这道闸是不够的，它会变成永久静默。** 复位只发生在 「.then」 / 「.catch」
   * 里，而挂死的定义就是这两个都不跑 —— 于是 「rasterizing」 一旦为真就再也回不到假，
   * **之后每一帧都在闸口被静默跳过**：不报错、不重试、不恢复，整节课下来教师端一片空白。
   * ⇒ 必须有 「rasterizeWatchdog」 兜底。
   */
  var rasterizing = false;
  /**
   * 光栅化**代数**。每次发起自增；回调进来先对一下，对不上就整条作废。
   *
   * 为什么需要它：看门狗放弃一轮之后，那条「已经没人等」的 Promise 仍可能过一会儿才
   * settle。没有令牌，它会把一张**过期很久**的图当成当前帧发出去，或者触发一次不该
   * 发生的降档重试 —— 两件事都极难查（现象是"偶发的一张旧图"，而日志里什么都没有）。
   */
  var rasterizeRun = 0;
  /** 看门狗的句柄；没有在飞的一轮时为 null。 */
  var rasterizeWatchdog = null;
  /**
   * 连续失败了几轮光栅化。成功一轮就清零。
   *
   * ⚠️ 它守的是**纯浪费**：失败路径此前没有任何节流（「noteFrameCost」 只在成功时调用），
   * 于是一个在 Safari 15 上根本没法光栅化的网页会让老 iPad 每 10 秒白烤 200~250ms，
   * 一节课几百次。见下面 catch 里的处置。
   */
  var domFailureRun = 0;
  /** 连续失败到这个数就退避（复用库加载失败那套 60 秒退避）。2 是「偶发一次不算数」。 */
  var DOM_FAILURES_BEFORE_BACKOFF = 2;
  var shotLoadStartedAt = 0;
  var shotFailedAt = 0;
  var shotScript = null;
  var SHOT_LOAD_TIMEOUT_MS = 10000;
  /**
   * 加载失败之后隔多久再试一次。
   *
   * ⚠️ **这里刻意不是「失败只试一次」。** 永久 latch 会让**一次网络抖动**把整节课的
   * 缩略图废掉，而且三处都看不见：学生端没有任何提示、教师端只看到「这个学生一直没有
   * 画面」、日志里也没有一行。60 秒的退避既能让抖动自愈，又不会变成请求风暴
   * （最坏情况一分钟一次请求）。
   *
   * 这不是理论顾虑：同源的测试夹具就撞上过 —— SHOT_PATH 是根相对路径，在错误的源上
   * 解析成 404，于是 SDK 从此再也不截，全程无声。
   */
  var SHOT_RETRY_MS = 60000;

  /**
   * 一次光栅化的**看门狗下限**（毫秒）。实际时限是 「frameInterval() * 1.5」 与它取大者。
   *
   * 存在理由见 「rasterizing」 的注释：没有它，一次挂死 = 整节课永久静默。
   *
   * ⚠️ **为什么跟着 「frameInterval()」 走、而不是定死一个数**：基准周期是 SDK 按
   * **实测耗时**自适应调出来的档位（COST_TIERS ×1/×2/×4）。一台慢到被调到 40 秒一帧的
   * 设备，正是最需要长时限的那台 —— 给它定死 15 秒会把**本来能跑完**的每一轮都判超时，
   * 等于把「慢」升级成「永远没有图」。取 1.5 倍是留一档余量。
   *
   * 下限 15000 对应基准周期 10 秒（默认档）：既容忍「比一帧更慢」，又保证不会
   * 连着吞掉好几帧。
   */
  var RASTERIZE_TIMEOUT_MIN_MS = 15000;

  /**
   * 统一在这里落地「失败」。
   *
   * 顺带把那个没用的 script 标签从 DOM 里摘掉：退避重试意味着失败会重复发生，
   * 不清掉就是**每分钟多留一个节点**，一节课下来堆几十个 —— 而这正是本项目
   * 反复踩过的那类「只增不减」。
   */
  function markShotFailed() {
    if (shotScript && shotScript.parentNode) shotScript.parentNode.removeChild(shotScript);
    shotScript = null;
    shotState = 'failed';
    shotFailedAt = Date.now();
    // ⚠️ **这条日志是刻意保留的，不是临时诊断。**
    // 这个失败原本完全静默，代价极大：截图库加载不到时，SDK 一切"正常"、服务端一切正常、
    // 学生端 state 全对，而**教师端永远停在「等待画面…」**，任何一处都不报错 ——
    // 实测就是这样把「Retina 上产物超限」那件事藏了很久。
    // 宁可吵，也不要再让「这个学生的画面出不来」无声无息。
    console.warn('[SDK] 截图库加载失败，60 秒后重试');
    reportDiag('lib-load-failed', 0, 0, 0);
  }

  function captureDomFrame() {
    if (shotState === 'failed') {
      // 退避期没到就什么都不做；到了就放回 idle，让下面那条路径重新走一遍。
      if (Date.now() - shotFailedAt < SHOT_RETRY_MS) return;
      shotState = 'idle';
    }
    // 正在加载时**直接返回、不排队**：等它的那几个回调想要的其实是同一张图，
    // 而下一帧照样会来。排队只会让加载期间堆积一串回调。
    if (shotState === 'loading') {
      if (Date.now() - shotLoadStartedAt > SHOT_LOAD_TIMEOUT_MS) {
        // 卡住（既没 onload 也没 onerror）也要能收敛，否则永远停在 loading。
        markShotFailed();
      }
      return;
    }
    if (shotState === 'ready') {
      rasterizeDom();
      return;
    }

    shotState = 'loading';
    shotLoadStartedAt = Date.now();
    shotScript = document.createElement('script');
    shotScript.src = '${SHOT_PATH}';
    shotScript.onload = function () {
      // ⚠️ onload 触发**不等于**全局对象可用：脚本被中间层改写过、或版本不匹配时
      // 都可能「加载成功但没挂 window.snapdom」。判据必须是对象在不在，不是 onload。
      if (window.snapdom) {
        shotState = 'ready';
        rasterizeDom();
        return;
      }
      markShotFailed();
    };
    shotScript.onerror = function () {
      markShotFailed();
    };
    (document.head || document.documentElement).appendChild(shotScript);
  }

  /**
   * 把 body 光栅化成缩略图。
   *
   * ⚠️ **cache 必须显式关掉（'disabled'），这是必选项不是调优项。** 库的默认缓存会让
   * 每次截图滞留约 1.8MB 且**强制 GC 也不回收**（实测：20 次连拍后堆从 15MB 单调涨到
   * 51MB，强制 GC 之后仍是 51MB）。按 10 秒一截算是 10MB/分钟的单向累积 —— 在老 iPad
   * 上就是「打开一会儿页面被系统杀掉」。关掉缓存后堆是锯齿状的、强制 GC 后回到 22MB；
   * 代价是慢 3 倍（55ms vs 16ms），而 56ms/10s = 0.55% 占用。
   * 详见 server/vendor/README.md 的实测表。
   *
   * ⚠️ **按缩略图尺寸直接光栅化**（scale = 目标宽 除以 页宽），不是先全尺寸截再缩小。
   * 全尺寸会把整页像素都走一遍，正是老 iPad 崩掉的那种开销；直接按目标尺寸渲染
   * 让时间与内存同时省一个量级（实测 320 宽的产物 19KB）。
   */
  function rasterizeDom() {
    var el = document.body;
    if (!el) return;
    /**
     * 截的是**视口（学生此刻看得见的那一块）**，不是整页。见 toCanvas 的 clip 参数。
     *
     * 为什么不是整页：教师要看的是「学生在**做什么**」。整页截法下，一个 3600px 高的
     * 网页会被压成 149x640 甚至 64x640 —— **字根本看不清**，而且页面越长越糊。
     * 视口截法的产物尺寸只跟学生窗口有关（约 320x400），与页面多长无关。
     *
     * ⚠️ **scale 是乘在视口尺寸上的**，不是整页 —— 这是实测出来的，不是文档写的：
     * 885x3600 的页 + 885x1100 的视口，clip 传 viewport 且 scale 0.5 时得到 442x550（= 视口×0.5），
     * 而不传 clip 时同一份输入得到 442x1800（= 整页×0.5）。
     *
     * ⚠️ 它**跟随滚动位置**（实测：scroll 0 时左上角是页面顶部的蓝色块，
     * scrollY=1600 时变成中部的灰色），所以学生滚动屏幕，教师看到的就是新的那一屏。
     */
    var vw = document.documentElement.clientWidth || 0;
    var vh = document.documentElement.clientHeight || 0;
    if (vw <= 0) {
      // 视口宽度读不到 ⇒ 没法算缩放比例。正常浏览器里不会发生，但**发生了也必须留痕**：
      // 从前这里直接 return，而它会让整条 DOM 档永远不出图且毫无提示。
      console.warn('[SDK] 视口宽度为 0，无法计算缩放比例，跳过这一帧');
      reportDiag('viewport-zero', 0, 0, 0);
      return;
    }
    var scale = thumbnailWidth / vw;
    // 又高又窄的视口（少见，但竖屏平板会有）按高度再夹一道，见 THUMBNAIL_MAX_HEIGHT。
    if (vh > 0) {
      var byHeight = THUMBNAIL_MAX_HEIGHT / vh;
      if (byHeight < scale) scale = byHeight;
    }
    if (scale > 1) scale = 1;

    // 守的是「上一次光栅化**还没回来**」—— 那正是「Promise 既不 resolve 也不 reject」
    // 这种挂死状态唯一留得下的痕迹：then 与 catch 一个都不跑，外面三处全看不见。
    if (rasterizing) {
      return;
    }
    rasterizing = true;
    rasterizeRun = rasterizeRun + 1;
    var run = rasterizeRun;

    // 🔴 看门狗：**这是「一次挂死不等于整节课沉默」的唯一保障。** 见 rasterizing 的注释。
    // 到点后先作废这一轮的代数（让那条迟到的 Promise 的 then/catch 全部空转），再放开闸门 ——
    // 顺序不能反：先放开的话，下一个周期可能已经开跑，看门狗反手把**新**那一轮标记作废。
    var watchdogMs = frameInterval() * 1.5;
    if (watchdogMs < RASTERIZE_TIMEOUT_MIN_MS) watchdogMs = RASTERIZE_TIMEOUT_MIN_MS;
    rasterizeWatchdog = setTimeout(function () {
      if (run !== rasterizeRun) return;
      rasterizeRun = rasterizeRun + 1;
      rasterizing = false;
      rasterizeWatchdog = null;
      // 这条日志是**刻意保留的诊断**：从前这种挂死是完全静默的，教师端只看到空白。
      console.warn('[SDK] 光栅化超过 ' + Math.round(watchdogMs) + 'ms 没有结果，已放弃这一帧并复位，下一帧会重试');
      reportDiag('timeout', Math.round(watchdogMs), 0, 0);
    }, watchdogMs);

    var startedAt = Date.now();
    attemptCapture(el, scale, 0, startedAt, run);
  }

  /** 收掉看门狗。「rasterizing」 的复位由各自的调用点负责（它们的语义不同）。 */
  function clearRasterizeWatchdog() {
    if (rasterizeWatchdog !== null) {
      clearTimeout(rasterizeWatchdog);
      rasterizeWatchdog = null;
    }
  }

  /**
   * 结束一轮光栅化：复位闸门 + 收掉看门狗。
   *
   * 代数对不上就什么都不做 —— 那说明这一轮**已经被看门狗作废**，此时再复位闸门会把
   * 已经开跑的**下一轮**误放行（两轮并发，正是这道闸要防的事）。
   */
  function finishRasterize(run) {
    if (run !== rasterizeRun) return;
    rasterizing = false;
    clearRasterizeWatchdog();
  }

  /**
   * 按给定比例截一张；**产物超限就缩小一档重来**。
   *
   * 🔴 为什么要重来而不是交给 post() 丢掉：那个丢弃是最后一道防线，而
   * 「教师把分辨率调大 / 网页内容特别花 ⇒ 一帧都收不到」在教学现场是不可接受的 ——
   * 教师只会看到图墙空着，且**没有任何地方会告诉他"是因为图太大"**。
   * 缩一档重编码的代价是一次本地开销，换来的是**永远有一张能看的图**。
   *
   * ⚠️ 最多降 MAX_DOWNSCALE_ATTEMPTS 档：再降下去图已经糊到没意义，
   * 而且那说明这个网页的内容复杂度超出了这套机制的假设，应该让它显式失败（有日志）。
   *
   * ⚠️ **dpr 必须显式钉成 1，这是必选项不是调优项。** 库的 dpr 默认取
   * devicePixelRatio，**乘**在输出像素尺寸上：Retina（dpr=2）上 320 宽会变成 640 宽、
   * 像素数翻 4 倍、JPEG 从约 1.2 万涨到约 5.6 万字符，撞上 32768 的上限。
   * 症状极迷惑：SDK 一切正常、服务端一切正常、学生端 state 全对，而教师端**永远
   * 停在「等待画面…」**。实测踩过 —— **测试环境与真机之间差着一个 Retina 屏**。
   */
  function attemptCapture(el, scale, attempt, startedAt, run) {
    // 🔴 **「toCanvas」 是同步调用，必须包 try/catch。** 从前没包，而它一旦同步抛错
    // （库挂上了但 API 变了、被替换、内部前置条件不满足），异常会带着
    // 「rasterizing = true」 一路冒到 setInterval —— 于是**再也不会尝试任何一帧**，
    // 且现场只有一条未捕获异常，三处都看不见。与看门狗防的是同一类"永久静默"。
    var promise;
    try {
      promise = window.snapdom.toCanvas(el, {
        // 只截学生此刻看得见的那一块（实测：它跟随滚动位置）。详见 rasterizeDom 的注释。
        clip: 'viewport',
        scale: scale,
        dpr: 1,
        cache: 'disabled',
      });
    } catch (err) {
      finishRasterize(run);
      console.warn('[SDK] 光栅化同步抛出异常：' + (err && err.message ? err.message : err));
      // 同样是分类下标（见 capture-error 那条）。
      reportDiag('sync-throw', 0, describeRejection(err), describeRejectionName(err));
      return;
    }

    if (!promise || typeof promise.then !== 'function') {
      // 库没返回 Promise（版本不匹配 / 被替换成别的东西）。**不能假装它在飞** ——
      // 假装的话闸门永远关着，症状与挂死一模一样。显式失败、显式复位。
      finishRasterize(run);
      console.warn('[SDK] 光栅化没有返回 Promise，截图库的版本可能不匹配');
      reportDiag('not-promise', 0, 0, 0);
      return;
    }

    promise.then(function (canvas) {
      // 看门狗已经放弃过这一轮 ⇒ 这张图过期了，丢掉它。见 rasterizeRun 的注释。
      if (run !== rasterizeRun) return;
      var url = '';
      try {
        url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      } catch (err) {
        // 与 thumbnail() 同一个理由：被跨源内容污染时抛 SecurityError，这一帧没有。
        url = '';
      }
      // 先记下尺寸再清零底存 —— 清零之后就读不到了，而「库给回来一个空 canvas」
      // 正是要上报的证据之一。
      var canvasW = canvas.width || 0;
      var canvasH = canvas.height || 0;
      // 主动释放底存。老 iPad 上 canvas 内存是硬约束，而这张图我们已经拿到了。
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch (err) {}
      if (!url) {
        // ⚠️ **这条日志是刻意保留的：这里从前完全静默。** 库 resolve 了一个画布、
        // 但产物是空串（画布被跨源内容污染，或库本身给回一个 0×0 / 空白 canvas）——
        // 帧被丢掉，而**外面一处都不报**。症状与「库根本没跑」一模一样。
        console.warn('[SDK] 光栅化返回了空产物（画布被污染，或库给了空 canvas），尺寸=' + canvasW + 'x' + canvasH);
        reportDiag('empty-canvas', 0, canvasW, canvasH);
        finishRasterize(run);
        return;
      }

      // 超限 ⇒ 缩一档重来。留一点余量给 JSON 外壳（PAYLOAD_BUDGET 已扣掉）。
      if (url.length > PAYLOAD_BUDGET && attempt < MAX_DOWNSCALE_ATTEMPTS) {
        // 降档仍属于**同一轮**：闸门不复位、代数不递增，否则下一帧会挤进来和它并发。
        // 看门狗也不重设 —— 它是整轮的预算，缩一档不该把总时限翻倍。
        attemptCapture(el, scale * DOWNSCALE_STEP, attempt + 1, startedAt, run);
        return;
      }

      finishRasterize(run);
      // 成功了就清零连续失败计数 —— 退避是给「一直失败」用的，不是给偶发。
      domFailureRun = 0;
      noteFrameCost(Date.now() - startedAt);
      post('frame', buildEvent('frame', { image: url }));
    }).catch(function (err) {
      // 光栅化失败（库内部错误、页面太大……）只丢这一帧，不把状态打成 failed ——
      // 下一帧可能就好了，而打成 failed 就再也不会试了。
      //
      // ⚠️ **这条日志是刻意保留的**：与 markShotFailed() 同理，这个 catch 原本完全静默，
      // 而「库一抛错就永远没有帧」正是教师端一片空白却处处不报错的那类成因。
      if (run !== rasterizeRun) return;
      finishRasterize(run);
      console.warn('[SDK] 缩略图光栅化失败：' + (err && err.message ? err.message : err));
      // 「w」 / 「h」 在这里的含义与其它码不同：**分类下标**，不是尺寸（这一轮没有画布）。
      // 0 = 认不出。见 KNOWN_CAPTURE_ERRORS / KNOWN_ERROR_NAMES 的注释。
      reportDiag('capture-error', Date.now() - startedAt, describeRejection(err), describeRejectionName(err));

      // 🔴 **连续失败要退避，不能每 10 秒白烤一遍。**
      //
      // 2026-09-22 实测：老 iPad 上纯 DOM 网页每次都失败（snapdom 生成的 SVG 在 Safari 15
      // 上解码不出来），而失败路径**完全没有节流** —— 「noteFrameCost」 只在**成功**时调用。
      // 于是一节课几百次徒劳的 200~250ms 烘烤，全压在全班最弱的那台设备上。
      //
      // 连续两次失败就按 markShotFailed() 处理：复用库加载失败那套退避（60 秒），
      // 并且**把 script 标签摘掉**（少一个常驻节点）。它仍然会自愈 —— 退避到点会重来一次；
      // 学生刷新页面则完全重置。**不做成永久 latch**：那会让一次偶发失败把整节课废掉。
      domFailureRun = domFailureRun + 1;
      if (domFailureRun >= DOM_FAILURES_BEFORE_BACKOFF) {
        reportDiag('dom-tier-gave-up', domFailureRun, 0, 0);
        markShotFailed();
      }
    });
  }

  /**
   * 按实测耗时调档（规格 §5.5 的降频）。
   *
   * 只在**跨档**时重建定时器：每帧都 clearInterval + setInterval 会把节奏抖得很碎，
   * 而档位本来就该稳定。抖动上做了双向：只升不降的话，一次 GC 卡顿会让整节课
   * 钉在 20 秒一帧。
   */
  function noteFrameCost(costMs) {
    if (costMs > SLOW_FRAME_MS) {
      slowRun = slowRun + 1;
      fastRun = 0;
    } else if (costMs < FAST_FRAME_MS) {
      fastRun = fastRun + 1;
      slowRun = 0;
    } else {
      slowRun = 0;
      fastRun = 0;
    }
    var next = tierIndex;
    if (slowRun >= SLOW_RUN && tierIndex < COST_TIERS.length - 1) next = tierIndex + 1;
    else if (fastRun >= FAST_RUN && tierIndex > 0) next = tierIndex - 1;
    if (next === tierIndex) return;
    tierIndex = next;
    slowRun = 0;
    fastRun = 0;
    if (frameTimer !== null) {
      stopFrames();
      startFrames();
    }
  }

  /** 缩到宽 320 的 JPEG data URL。读不到（被跨源内容污染）时返回空串。 */
  function thumbnail(canvas) {
    try {
      var sw = canvas.width || 0;
      var sh = canvas.height || 0;
      if (sw <= 0 || sh <= 0) return '';
      var w = sw > thumbnailWidth ? thumbnailWidth : sw;
      var h = Math.max(1, Math.round(sh * (w / sw)));
      var off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      var ctx = off.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(canvas, 0, 0, w, h);
      return off.toDataURL('image/jpeg', JPEG_QUALITY);
    } catch (err) {
      // 被跨源内容污染的 canvas：toDataURL 抛 SecurityError。
      // 降级成「这一帧没有」—— 这正是 sandbox + 独立源要挡的东西之一。
      return '';
    }
  }

  /**
   * 当前应该多久截一帧 = 关注度基准 × 设备耗时降档。
   *
   * 两个因子**相乘**而不是互相顶替：「想多快」是教师侧的事，「能多快」是设备侧的事。
   * 一台老 iPad 在 detail 档是 2s×4=8s —— 仍比它在 wall 档（10s×4=40s）快得多，
   * 但不会因为教师点开了详情就把自己逼死。
   */
  function frameInterval() {
    // 服务端给的基准（它已按 wall/detail 与课堂设置算好）× 本设备的耗时降档。
    return baseIntervalMs * COST_TIERS[tierIndex];
  }

  /**
   * 首次 tick 的随机抖动上界（毫秒）。
   *
   * ⚠️ **没有它，全班的截图会撞在一起。** 教师一打开看板，服务端会在**同一个循环里**
   * 把档位逐条下发给全班 —— 45 台设备的 applyLevel() 会在几毫秒内同时执行
   * stopFrames() 加 startFrames()，于是它们的定时器被**同时重置**，之后每 10 秒
   * 一起到达（45 x 12.5KB 的瞬时突发，而不是均匀铺开）。
   *
   * 抖动只加在**首次** tick 上，之后的间隔回到精确值 —— 否则平均周期会被悄悄拉长
   * （每轮 +1.5 秒，10 秒档变成 11.5 秒，而没人会想到是抖动干的）。
   */
  var FRAME_JITTER_MS = 3000;

  /**
   * 启动截图循环。
   *
   * ⚠️ **首帧走 setTimeout 且带随机抖动，这是唯一正确的写法。** 曾经它是
   * 「先立刻截一帧（直接调 captureFrame），再 setInterval 走周期」—— 那个"立刻截"
   * **完全绕过了抖动**，而它恰恰是最需要抖动的那个时刻：
   *   · 学生上课时同一分钟进课堂 ⇒ 初始化那一帧全班撞在一起；
   *   · 教师一打开看板 ⇒ off 切到 wall ⇒ 全班同时立刻截一帧。
   * 实测过：三胞胎夹具里三条首帧落在 **28/28/29 毫秒**，抖动等于没加。
   *
   * 现在的形状是「延迟 0~3 秒截第一帧，然后按精确周期」：
   *   · 设备被错开；
   *   · 教师最多等 3 秒看到第一张画面（与"立刻"的体感差别很小）；
   *   · **周期本身不含抖动**，平均频率不被拉长。
   */
  function startFrames() {
    if (frameTimer !== null) return;
    frameTimer = setTimeout(function () {
      captureFrame();
      frameTimer = setInterval(captureFrame, frameInterval());
    }, Math.floor(Math.random() * FRAME_JITTER_MS));
  }

  function stopFrames() {
    if (frameTimer === null) return;
    // 两个都清：frameTimer 在首帧之前是 **timeout**（抖动那段），之后就变成 interval。
    // 浏览器里两者共用一个 id 空间、清错也有效，但不要把这条依赖带进代码。
    clearTimeout(frameTimer);
    clearInterval(frameTimer);
    frameTimer = null;
  }

  // ── 挂起协议 ────────────────────────────────────────────────────────
  /**
   * 只接受**父窗口**发来的消息。
   *
   * 准入判据只有一条：e.source 必须是 parent。教师网页被搬到别处、或被第三方
   * 嵌进自己的站时，嵌入者的 postMessage 一律丢在地板上 —— 否则任何嵌入者都能
   * 驱动这个 SDK 去暂停/恢复采集。
   */
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.source !== PARENT_TAG) return;
    if (d.type !== 'demand') return;
    applyDemand(d);
  });

  /**
   * 切档。
   *
   * ⚠️ **跨档必须重建定时器**，否则间隔还是旧档的 —— 教师点开详情却仍是 10 秒一帧，
   * 而且完全没有任何报错。startFrames() 自己有「frameTimer 非空就返回」的幂等闸，
   * 所以这里要先 stopFrames()。
   *
   * 从 'off' 切回来时立刻补一帧：否则教师打开看板后要干等一个完整间隔才看到画面。
   */
  /** 现在该不该截图：前台有人看 **且** 教师没有关掉画面。 */
  function isCapturing() {
    return captureLevel !== 'off' && captureEnabled;
  }

  /**
   * 应用一份档位（整条 demand 一次解析完）。
   *
   * ⚠️ **比较必须在赋值之前**：prevInterval 要拿**旧**的 baseIntervalMs 算，
   * 否则"周期变了没有"永远是假，改周期将不生效（而且没有任何报错）。
   */
  function applyDemand(d) {
    var level = d.level;
    // 白名单式校验：载荷是线缆上的值，一个拼错的档位不该让 SDK 进到未定义状态。
    if (level !== 'off' && level !== 'wall' && level !== 'detail') return;

    var prevInterval = frameInterval();
    var wasCapturing = isCapturing();

    // ⚠️ 三个值的兜底方向**全都是"认不出就用默认"**，绝不能让"认不出"变成
    //    "关掉"或"更小" —— 那会让整间教室静默地停止截图，且没有任何报错。
    //    服务端已经归一化过一遍，这里只为「父页面转发时丢了字段」兜底。
    captureEnabled = d.captureEnabled !== false;
    var nextWidth = Number(d.width);
    if (Number.isFinite(nextWidth) && nextWidth > 0) thumbnailWidth = nextWidth;
    var nextInterval = Number(d.frameIntervalMs);
    if (Number.isFinite(nextInterval) && nextInterval > 0) baseIntervalMs = nextInterval;

    var changed = level !== captureLevel || prevInterval !== frameInterval() || wasCapturing !== isCapturing();
    captureLevel = level;

    // ⚠️ **教师打开看板的那一刻补报一次 presence。**
    //
    // 为什么必须有这一条（不是"顺手多加一条"）：学生在课堂开始时就已经打开网页，
    // 而教师过一会儿才打开看板 —— 这是最常见的顺序。加载时那次 presence 早就过去了
    // （而且它当时连 post() 那道 captureLevel === 'off' 的闸都没过，在源头就被丢了）。
    // 少了这一条，「教师关掉画面 + 学生安静阅读不滚不切」这种组合下，图墙上是**永远
    // 一片空白** —— 而那正是文字档这条链路要解决的问题，让它落空就等于没做。
    //
    // 只在 level !== 'off' 时补：没人看时不发，与 Ruling 9 的零开销一致。
    // 频次由 applyDemand 的调用点决定（订阅 / 退订 / 点开详情），一节课个位数。
    if (level !== 'off') reportVisibility(true);

    if (!isCapturing()) {
      stopFrames();
      return;
    }
    if (!changed) return;
    // ⚠️ 重建定时器会**重置首帧抖动**（第一帧又被推后 0~3 秒），所以只在真变了才重建。
    //    这里**不要**再补一句立刻截图：那会让「教师一打开看板、全班同时截一帧」，
    //    正是抖动要消除的那个同步点。
    stopFrames();
    startFrames();
  }

  /**
   * 教师网页**显式**上报的唯一入口。
   *
   * 这是**唯一一条由教师侧决定内容**的通道，它必须由教师网页主动调用 ——
   * 本文件内部的任何代码都不会调用它（见文件头「ClassNode.report()」那一段：
   * 它今天没有下游消费者，保留的是接口）。
   * 教师往里放什么，是教师自己的选择与责任；载荷仍受单条消息上限约束。
   */
  function report(payload) {
    post('report', payload);
  }

  window.ClassNode = { report: report, version: 1 };

  // ── 握手 ────────────────────────────────────────────────────────────
  // 立刻喊一声 ready：父页面据此知道 iframe 里的 SDK 已经就绪。
  // ⚠️ **只有这一次**。父页面必须在插入 iframe **之前**挂好 message 监听，
  // 否则这一条会丢（找不到第二次握手的机会）。
  post('ready', buildEvent('ready'));

  // 一次性告知「这个 document 跑的是哪个构建」。
  //
  // 🔴 **为什么必须有 —— 这是我 2026-09-22 自己撞上的歧义：** 我给诊断加了「错误归类」
  // 之后，新旧两版 SDK 对同一个故障产出的日志**逐字节相同**（旧版硬编码 「w=0 h=0」，
  // 新版对「认不出的拒因」也返回 0）。于是读到 「w=0 h=0」 时，**「修的东西没生效」与
  // 「故障真的长这样」完全分不开** —— 我只能再花用户一轮往返去排除其中一种。
  //
  // 有了这一行，任何一条诊断都能对上「是哪一版发出来的」。
  // ⚠️ **每次改动 SDK 都把这个数 +1**（它不是版本号，是构建序号；不要求语义）。
  // 「w」 报**供应商补丁序号**：sdk.js 与 shot.js 是两条独立的送达路径，任一条没到
  // 都会让 iPad 拍不出图，而症状一模一样 —— 一起报才分得清。
  reportDiag('lib-ready', SDK_BUILD, SNAP_PATCH, 0);

  // ⚠️ 这里**不要**再补一句立刻截图：学生是同一分钟进课堂的，那一帧会全班撞在一起。
  //    首帧由 startFrames() 里那条带抖动的 setTimeout 负责（最多晚 3 秒）。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFrames);
  } else {
    startFrames();
  }

  /**
   * 加载时补报一次 presence（理由见文件头「文字档为什么必须在页面加载时就报一次」）。
   *
   * ⚠️ 这一条**与 captureEnabled 无关** —— 画面关掉时它是教师唯一的信号来源。
   * （post() 里那道 captureLevel === 'off'（= 此刻没有教师在看）的闸仍然管着它，
   * 与 Ruling 9 一致；教师一打开看板，applyDemand 里那次补报会把它补上。）
   */
  reportVisibility(true);
})();
`;
