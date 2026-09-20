export const SDK_PATH = '/__classnode/sdk.js';

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
export function injectSdk(html: string, opts: { sdkPath: string }): string {
  if (!html) return html;
  // 幂等：已经注入过就原样返回。教师自己也可能手写了一个 <script src="…/sdk.js">，
  // 重复注入会让 SDK 跑两遍、事件翻倍。
  // ⚠️ 判据必须匹配**我们实际插入的那个标签形状**，不能是裸路径。
  // 裸路径的 `includes` 是**整篇子串包含**：教师网页的正文或注释里只要出现过
  // 「/__classnode/sdk.js」这几个字（哪怕只是一句「本页已接入探究助手，由
  // /__classnode/sdk.js 提供支持」的说明文案），注入就会被**整体跳过** ——
  // 该页一个事件都不采集，而且没有任何报错。方向安全（不采集 ≠ 泄漏）但**静默**。
  // 匹配 `<script src="<sdkPath>` 仍然容得下教师自己写的 `?v=2` 查询串
  // （路由的 query 不参与匹配，照样送出 SDK），却不会再被正文里的路径字样绊倒。
  if (html.includes(`<script src="${opts.sdkPath}`)) return html;

  const tag = `<script src="${opts.sdkPath}"></script>`;

  // 大小写不敏感地找 </head>。找不到就退到 <html ...> 之后，再找不到就整体前置 ——
  // 三种兜底都不改 HTML 的其余部分，最坏情况只是脚本早一点执行。
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose !== -1) return html.slice(0, headClose) + tag + html.slice(headClose);

  const htmlOpen = html.search(/<html[^>]*>/i);
  if (htmlOpen !== -1) {
    const end = html.indexOf('>', htmlOpen) + 1;
    return html.slice(0, end) + tag + html.slice(end);
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
 * 与父页面握手、采集结构事件、canvas 存在时发缩略图、响应父页面的挂起/恢复。
 *
 * ══ 隐私红线（规格 §5.4 / §10.3，不可放宽）══════════════════════════════════
 * 事件采集**默认不采集输入框内容**，只记录「在某输入框输入、长度 N」。
 *
 * 本文件把这条红线做成**结构约束**，而不是「实施者记得别读 value」：
 *   · 所有上报载荷都由**唯一一个**函数 buildEvent() 构造；
 *   · buildEvent 的形参表里**没有任何内容字段** —— selector / inputType /
 *     length / depth / to / image 六项，全是结构描述或页面自己画出来的像素；
 *   · 全 SDK 只有 inputLength() **一个函数**碰过输入内容（表单控件的 .value、
 *     contenteditable 的 textContent），并且它**只返回一个数字**。
 *
 * 想加一个能装内容的字段，必须先改 buildEvent —— 那是一件必须刻意去做的事，
 * 而不是「顺手把 el.value 传进去」。
 *
 * ══ ⚠️ 把保证说窄 —— 上面那段**不等于**「除 report 之外没有任何内容通道」══
 * 那句话是**假的**，本文件里真出现过一次（见下面 hashchange 那一行的注释）：
 *   · selector 里的 id / class 是自由字符串；
 *   · image 是自由字符串（canvas 像素的 data URL）；
 *   · to 曾经被喂 location.hash —— 一个**自由文本源**，于是「把输入同步到
 *     URL 片段」这种与 ClassNode 无关的常见 UI 写法，会让学生的输入经由默认
 *     采集通道原样出门，全程没有调用过 report()。
 *
 * **真实的保证只有一条，而且要说窄**：每条通道**恰好一个内部调用点**
 * （post() 只有 4 个：ready / event / frame / report），且每个字段的**取值来源
 * 被逐一枚举**（selector ← describe()；inputType ← el.type/tagName；
 * length ← inputLength() 那个只返回数字的返回值；depth ← 滚动十分位；
 * to ← **短枚举字面量**；image ← canvas 自身的像素）。
 * ⇒ 「新增一条内容通道」必须是一次**显式的代码改动**（改 buildEvent 或改某个
 *   调用点的取值来源），而不是「顺手传进去」。这是本文件真正买到的东西。
 *
 * ══ 本文件的三条书写约束（由 server/src/tests/webapp-sdk-injection.test.ts 校验）══
 *   1. 整体是 webapp-sdk.ts 里一个模板字符串的内容，因此**不能出现反引号**；
 *   2. 不能出现美元符紧接左花括号的序列（那会变成宿主的插值）；
 *   3. **一个反斜杠都不出现** —— 模板字符串会吃掉一层转义，正则简写会静默变形。
 *      所以这里的正则一律用等价写法替代（只有一个 className 切分用得上）。
 */
(function () {
  'use strict';

  // 同一个页面里脚本被加载两次时（教师自己写了一份，注入器又插了一份），
  // 第二次直接退出。重复安装会让每一个事件都上报两遍，而父页面分辨不出来。
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

  // 缩略图节奏与尺寸。
  //
  // ⚠️ 降频（规格 §5.5「测量截图耗时，超过 300ms 自动降档 5s → 10s → 20s」）**在这里执行**：
  // 耗时只有本 SDK 量得到（它就在 drawImage + toDataURL 这一行上），而且档位是**每台设备**
  // 自己的事 —— 同一间教室里老 iPad 与新电脑该待在不同的档。所以服务端不发档位，
  // webapp-monitor-demand 的载荷只有 watching 一个字段（T5 定死的契约）。
  //
  // 基准值曾经是 3000（T4 拍的，它自己在报告里写明「降频归 T5」）。T5 对齐到计划的
  // 5s/10s/20s：第一档**就是** FRAME_INTERVAL_MS，三档由此乘 1/2/4 得来，
  // 「基准」与「第一档」不再是两个可能对不上的数（这就是预审 4 要的那个一致）。
  var FRAME_INTERVAL_MS = 5000;
  var FRAME_INTERVAL_TIERS = [FRAME_INTERVAL_MS, FRAME_INTERVAL_MS * 2, FRAME_INTERVAL_MS * 4];
  // 一帧超过 SLOW_FRAME_MS 记一次「慢」，连续 SLOW_RUN 次就升一档；连续 FAST_RUN 次
  // 快于 FAST_FRAME_MS 就降回来 —— 只要升不要降的话，一次 GC 卡顿会把整节课钉在最慢档。
  var SLOW_FRAME_MS = 300;
  var FAST_FRAME_MS = 150;
  var SLOW_RUN = 3;
  var FAST_RUN = 10;
  var THUMBNAIL_WIDTH = 320;
  var JPEG_QUALITY = 0.4;

  var paused = false;
  var maxDecile = -1;
  var frameTimer = null;
  var tierIndex = 0;
  var slowRun = 0;
  var fastRun = 0;

  // ══════════════════════════════════════════════════════════════════════
  // 唯一的载荷构造点。**本文件内所有上报都必须经过这里。**
  // ══════════════════════════════════════════════════════════════════════
  /**
   * ⚠️ 隐私红线（不可放宽）：本函数**不接受任何自由文本参数**。
   *
   * 参数表就是白名单，六项全是「结构描述」或「页面自己画出来的像素」：
   *   selector  —— 元素的结构定位串（tagName / id / class / 兄弟序号），
   *                由 describe() 产出，而 describe() **不读任何文本内容**；
   *   inputType —— 输入框的 type 或标签名；
   *   length    —— 输入框当前值的**长度**，一个数字；
   *   depth     —— 滚动到了第几个十分位；
   *   to        —— 跳转目标的 hash / 可见性状态，都是短枚举串；
   *   image     —— canvas 缩略图的 data URL，是**页面自己画出来的**，不是输入内容。
   *
   * 要采集输入框里的具体内容，只能由教师网页**显式**调用 ClassNode.report() ——
   * 那是教师自己的选择与责任。
   *
   * ⚠️ 但**不要**把本函数读成「所有字段都无害」：selector 的 id/class 是自由
   * 字符串，image 是自由字符串。真正的保证是「每个字段的**取值来源**被逐一
   * 枚举」—— 尤其是 to，它**不得**接上任何自由文本源（location.hash /
   * el.value / document.title 之类）。见文件头「把保证说窄」那一段。
   */
  function buildEvent(kind, fields) {
    var f = fields || {};
    return {
      kind: typeof kind === 'string' ? kind : '',
      selector: typeof f.selector === 'string' ? f.selector : '',
      inputType: typeof f.inputType === 'string' ? f.inputType : '',
      length: typeof f.length === 'number' ? f.length : 0,
      depth: typeof f.depth === 'number' ? f.depth : 0,
      to: typeof f.to === 'string' ? f.to : '',
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
    if (paused && type !== 'ready') return;
    var msg = { source: SDK_TAG, type: type, payload: payload };
    var encoded;
    try {
      encoded = JSON.stringify(msg);
    } catch (err) {
      return; // 环形结构 / 含 BigInt / toJSON 抛错 —— 丢弃，绝不往外冒
    }
    if (encoded.length > MAX_PAYLOAD_CODE_UNITS) return; // 超限即丢，见该常量的说明
    try {
      parent.postMessage(msg, '*');
    } catch (err) {
      // 父窗口已经没了（学生切页、关闭）。吞掉：这里是全局事件回调，
      // 抛出去只会污染教师网页。
    }
  }

  /** 事件通道的统一出口。**载荷一律来自 buildEvent。** */
  function emit(kind, fields) {
    post('event', buildEvent(kind, fields));
  }

  /**
   * 给元素一个稳定的标识。
   *
   * ⚠️ 本函数**不读** textContent / innerText / value —— 读内容只发生在
   * inputLength() 里，且只有长度会离开它。本函数只用 tagName、id、class 与
   * 「同标签兄弟中的序号」。文本内容属于学生输入与页面内容，不在采集范围内。
   */
  function describe(el) {
    var tag = String(el.tagName || '').toLowerCase();
    if (!tag) return '';
    if (el.id) return tag + '#' + el.id;

    var cls = '';
    if (typeof el.className === 'string') {
      // 不用带简写字符类的正则：本文件一个反斜杠都不出现（见文件头约束 3），
      // 而按空格切分对 className 已经够用（HTML 规范里 class 以空白分隔，
      // 实践中教师手写的 className 只用空格；多切出空串会被下面滤掉）。
      var parts = el.className.split(' ');
      var kept = [];
      for (var i = 0; i < parts.length && kept.length < 2; i++) {
        if (parts[i]) kept.push(parts[i]);
      }
      if (kept.length) cls = '.' + kept.join('.');
    }

    var base = tag + cls;
    var parentNode = el.parentNode;
    if (!parentNode || !parentNode.children) return base;

    var same = 0;
    var index = 0;
    for (var j = 0; j < parentNode.children.length; j++) {
      var sibling = parentNode.children[j];
      if (sibling.tagName === el.tagName) {
        same = same + 1;
        if (sibling === el) index = same;
      }
    }
    return base + ':nth-of-type(' + index + ')';
  }

  /**
   * ⚠️ **全 SDK 唯一接触输入内容的函数**，并且它**只返回一个数字**。
   *
   * 红线禁的是**把内容传出去**，不是「在进程内读一下」—— 读 .value 这件事本身
   * 与「只拿走它的长度」并不冲突。这里读两种内容，两条路径同构：
   *   · 表单控件（input / textarea / select…）：.value
   *   · contenteditable（**没有** .value，内容就是文本节点）：.textContent
   * 内容在函数内被读，**只有 .length 离开**。
   *
   * 把「读内容」关进一个返回值是 number 的函数里 ⇒ 「不小心把内容带上」在本文件里
   * **无处可写**：要越过它，必须刻意往 buildEvent 里加一个内容字段 —— 那是一个
   * 显式的动作。（曾经这里只处理 .value，于是 contenteditable 恒报 0；当时的理由
   * 「拿长度就得读 textContent，而那是红线禁止的手段」是**自相矛盾的**：上面那行
   * 本来就在读内容。禁的是传出，不是读。）
   */
  function inputLength(el) {
    try {
      if (typeof el.value === 'string') return el.value.length;
      if (el.isContentEditable === true && typeof el.textContent === 'string') {
        return el.textContent.length;
      }
      return 0;
    } catch (err) {
      return 0; // 自定义元素的取值器抛错
    }
  }

  function inputTypeOf(el) {
    var t = el.type || el.tagName || '';
    return String(t).toLowerCase();
  }

  // ── 采集：document 的 capture 阶段事件委托，教师网页不用改一行代码 ─────

  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    emit('click', {
      selector: describe(el),
      inputType: String(el.tagName).toLowerCase()
    });
  }, true);

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    emit('input', {
      selector: describe(el),
      inputType: inputTypeOf(el),
      length: inputLength(el) // ← 只取长度
    });
  }, true);

  // 滚动深度：只在跨过新的十分位时上报，避免高频。
  addEventListener('scroll', function () {
    if (paused) return;
    var doc = document.documentElement;
    if (!doc) return;
    var total = doc.scrollHeight - doc.clientHeight;
    if (total <= 0) return;
    var decile = Math.floor((doc.scrollTop / total) * 10);
    if (decile <= maxDecile) return;
    maxDecile = decile;
    emit('scroll', { depth: decile * 10 });
  }, { passive: true });

  // 页面内跳转。
  //
  // ⚠️ **只报「跳了」与 hash 的长度，绝不报 hash 的值。** 这条不是洁癖：
  // 把 location.hash 赋成某个输入框的值，是教师写页面时**极常见**的一行 UI 代码
  // （把输入同步到 URL 片段），它与 ClassNode 毫无关系，却会让学生的输入经由
  // **默认采集通道原样出门**，全程没有调用过 report() —— 红线后半句「需采集
  // 具体内容必须由教师网页显式调用 ClassNode.report()」在这条路径上整个失效。
  // 而且 hash 是**字面文本**（可无损复原），比 frame 的像素严重得多。
  //
  // 长度与「输入框长度 N」是**同一类信息**，规格明确允许（它本身就是红线的
  // 惯例形状）；值不是。事件的确切形状由 T5 定，本文件只保证**值不出门**。
  addEventListener('hashchange', function () {
    emit('navigate', { length: location.hash.length });
  });

  // 可见性变化：既上报，也顺带停/启截图 —— 学生切走时没人看缩略图，不必画。
  document.addEventListener('visibilitychange', function () {
    var hidden = document.hidden === true;
    emit('visibility', { to: hidden ? 'hidden' : 'visible' });
    if (hidden) {
      stopFrames();
    } else {
      startFrames();
      captureFrame();
    }
  });

  /**
   * 截图：**只做 canvas 直读**（控制器 Ruling 6 —— P2 不引截图库）。
   *
   * 纯 DOM 网页没有 canvas，于是**不发 frame 消息**、缩略图为空。这是**已知且已接受**
   * 的代价：宁可没有缩略图，也不引一个跑在老 iPad Safari 15 上的截图库。
   */
  function captureFrame() {
    if (paused || document.hidden === true) return;

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
    if (!best || bestArea <= 0) return;

    // 耗时只算「画 + 编码」这一段：那才是老 iPad 上真正贵的地方，也是降频要躲的东西。
    // Date.now() 而不是 performance.now()：本文件一个反斜杠都不能出现（见文件头约束 3），
    // 而 300ms 这个量级不需要亚毫秒精度。
    var startedAt = Date.now();
    var url = thumbnail(best);
    if (!url) return;
    noteFrameCost(Date.now() - startedAt);
    post('frame', buildEvent('frame', { selector: describe(best), image: url }));
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
    if (slowRun >= SLOW_RUN && tierIndex < FRAME_INTERVAL_TIERS.length - 1) next = tierIndex + 1;
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
      var w = sw > THUMBNAIL_WIDTH ? THUMBNAIL_WIDTH : sw;
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

  function startFrames() {
    if (frameTimer !== null) return;
    frameTimer = setInterval(captureFrame, FRAME_INTERVAL_TIERS[tierIndex]);
  }

  function stopFrames() {
    if (frameTimer === null) return;
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
    if (d.type === 'pause') {
      paused = true;
      stopFrames();
      return;
    }
    if (d.type === 'resume') {
      paused = false;
      startFrames();
      captureFrame();
      return;
    }
  });

  /**
   * 教师网页**显式**上报的唯一入口。
   *
   * 这是**唯一一条由教师侧决定内容**的通道，它必须由教师网页主动调用 ——
   * 本文件内部的任何监听器都不会调用它。默认采集因此永远不会带上输入内容（规格 §5.4）。
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      startFrames();
      captureFrame();
    });
  } else {
    startFrames();
    captureFrame();
  }
})();
`;
