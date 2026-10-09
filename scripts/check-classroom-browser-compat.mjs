import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ===========================================================================
// Part A：产物级 —— 正则后行断言（lookbehind）
// ===========================================================================
// 为什么必须扫**产物**而不是源码：后行断言可能从**依赖**进到学生包里，
// 源码扫描根本看不见它。这道检查自 M0 起工作至今、零误报，是
// 「/classroom/ 不得有 lookbehind」这条 P0 红线的唯一自动化闸门。
//
// 本函数内的判据、六个标记、scriptPaths 的抠法、out/ 路径拼接、
//「文件不存在」失败分支，均自原脚本沿用；后续的受控改动如下
//（刻意不写「几处」——写数字必然过期）：
//   1. 扫描集合从「index.html 引用的脚本」扩为下面 (1)+(2)+(3) 之并集；
//   2. 命中时先查容忍表 TOLERATED_PRODUCT_FINDINGS，且按**命中级**粒度判定（见该表注释）；
//   3. 被排除的 teacher/help 路径改走「边界提示」——只提示、不失败（见 boundaryHits）。
function checkBundleLookbehinds() {
  const classroomHtmlPath = path.join(root, 'out', 'classroom', 'index.html');

  if (!fs.existsSync(classroomHtmlPath)) {
    throw new Error(`缺少学生端构建产物: ${classroomHtmlPath}`);
  }

  const html = fs.readFileSync(classroomHtmlPath, 'utf8');

  // (1) index.html 直接引用的脚本 —— 管共享 chunk 与 vendor chunk。
  const htmlScriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((source) => source.startsWith('/'));

  const outDir = path.join(root, 'out');
  const chunksDir = path.join(outDir, '_next', 'static', 'chunks');

  function listJsFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...listJsFiles(child));
      else if (entry.name.endsWith('.js')) found.push(child);
    }
    return found;
  }

  const toOutRelative = (abs) => `/${path.relative(outDir, abs).split(path.sep).join('/')}`;

  // (2) classroom 路由**自己**的 chunk 目录。
  //     保留它是因为它比 (3) 更明确地表达「这几条是学生端路由的」；今天它是 (3) 的子集。
  const routeScriptPaths = listJsFiles(path.join(chunksDir, 'app', 'classroom')).map(toOutRelative);

  // (3) 整个 chunks/ 下的 .js，**排除**教师端与 help 路由。
  //
  //     为什么必须扫到全量而不再只扫 app/classroom/：classroom **早就有**懒加载 ——
  //     `src/app/classroom/chat/message-item.tsx:46` 的 `await import('@/lib/export-doc')`。
  //     webpack 把 export-doc（docx 库）提成了**顶层**共享 chunk
  //     `/_next/static/chunks/d6c63c35.<hash>.js`，它既不在 index.html 里、也不在
  //     app/classroom/ 下。只扫 (1)+(2) 会让这条 chunk 长期落在两道闸之外（实测漏掉 1 处真阳性）。
  //
  //     ⚠️ 排除 app/teacher/** 与 app/help/**：
  //     **理由是语义的，不是「避免假失败」** —— 本闸门守的是「**学生端**不得有 lookbehind」，
  //     教师页跑在桌面浏览器上，本就不在约束范围内。help 页同理（教师侧入口）。
  //     现状说明：实测今天教师端 `app/teacher/**` 全树 **零命中**，所以这条排除
  //     **当前不掩盖任何东西**；它是一条为将来保留的边界，而不是在压一个已知违规。
  //
  //     ── 排除 ≠ 不看：被排除的路径会走「边界提示」（见下方 boundaryHits）──
  //     这两条路径下的产物**仍然会被读一遍**，命中 lookbehind 时**打印提示但绝不失败**。
  //     代价（须明说）：它们是**不在约束范围内**的，所以那里的命中无法判断是不是违规；
  //     提示只是「我可能没在看那儿」的信号。若将来有学生端可达的代码被打包进这两个
  //     路由的自有 chunk（打包事故），这条提示是唯一的信号 —— 今天它**一次都不会响**
  //     （实测教师端零命中），所以零噪音。
  //
  //     ── 「容忍表」与「边界提示」不是同一条规则的松紧，判断对象不同 ──
  //       · 容忍表：**接受了**一个已知违规（docx）。命中要喊，但**不失败**。
  //       · 边界提示：**没法判断**它是不是违规（根本不在约束范围内）。**只提示**。
  //     前者是「我知道它在那儿」，后者是「我可能没在看那儿」。
  const EXCLUDED_CHUNK_PREFIXES = [
    '/_next/static/chunks/app/teacher/',
    '/_next/static/chunks/app/help/',
  ];
  const allChunkPaths = listJsFiles(chunksDir).map(toOutRelative);
  const inScopeChunkPaths = allChunkPaths
    .filter((rel) => !EXCLUDED_CHUNK_PREFIXES.some((prefix) => rel.startsWith(prefix)));
  const outOfScopeChunkPaths = allChunkPaths
    .filter((rel) => EXCLUDED_CHUNK_PREFIXES.some((prefix) => rel.startsWith(prefix)));

  // 三者之并集，去重。(2) 与 (3) 今天有重叠，不去重会让同一个 chunk 被检测两遍、
  // 失败信息与容忍警告也会重复。
  const scriptPaths = [...new Set([...htmlScriptPaths, ...routeScriptPaths, ...inScopeChunkPaths])];

  const unsupportedLookbehinds = ['/(?<=', '/(?<!', 'RegExp("(?<=', 'RegExp("(?<!', "RegExp('(?<=", "RegExp('(?<!"];
  const failures = [];
  const toleratedHits = [];

  // 数一份产物里**全部**后行断言标记的命中数（剥注释后）。
  // 容忍条目的 toleratedMarkerHits 就是拿这个口径比的 —— 见该表注释：
  // 签名命中只说明「docx 在里面」，不说明「里面只有 docx」。
  function countLookbehindMarkers(source) {
    const breakdown = unsupportedLookbehinds
      .map((marker) => ({ marker, count: source.split(marker).length - 1 }))
      .filter((entry) => entry.count > 0);
    return {
      total: breakdown.reduce((sum, entry) => sum + entry.count, 0),
      breakdown: breakdown.map((entry) => `${entry.marker}×${entry.count}`).join(', '),
    };
  }

  for (const source of scriptPaths) {
    const filePath = path.join(root, 'out', source);
    if (!fs.existsSync(filePath)) {
      failures.push(`${source}: 文件不存在`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const pattern = unsupportedLookbehinds.find((candidate) => content.includes(candidate));
    if (!pattern) continue;

    // 容忍表按**内容签名**匹配，且**必须先剥注释**（产物里也有注释）。
    // 只对产物级生效 —— 源码级不查 lookbehind，也无容忍概念。
    const stripped = stripComments(content);
    const matched = TOLERATED_PRODUCT_FINDINGS.find((t) => stripped.includes(t.signature));
    if (matched) {
      const { total, breakdown } = countLookbehindMarkers(stripped);
      if (total > matched.toleratedMarkerHits) {
        failures.push(
          `${source}: 后行断言命中 ${total} 处（${breakdown}），超出该文件容忍的 ` +
          `${matched.toleratedMarkerHits} 处。\n` +
          `  已知并接受的那条是 ${matched.signature}（docx 的 {{ }} 扫描器）；` +
          `**多出来的那些是新的**，不在容忍范围内。\n` +
          `  webpack 的 splitChunks 分组每次构建都可能变 —— 常见原因是第二个库被并进了本文件。`,
        );
        continue;
      }
      toleratedHits.push({ source, signature: matched.signature, reason: matched.reason });
      continue;
    }

    failures.push(`${source}: 包含 Safari 15 不支持的正则后行断言 ${pattern}`);
  }

  // 边界提示：教师端 / help 路由**不在约束范围内**，所以命中了也**绝不失败**，
  // 只是提示「这里有你没在看的东西」。文件缺失同样不算失败（不在范围内）。
  // 刻意**不**查容忍表 —— 容忍表的语义是「接受了一个已知违规」，而这里根本没在判断违规。
  const boundaryHits = [];
  for (const source of outOfScopeChunkPaths) {
    const filePath = path.join(root, 'out', source);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const pattern = unsupportedLookbehinds.find((candidate) => content.includes(candidate));
    if (pattern) boundaryHits.push({ source, pattern });
  }

  return { failures, scriptCount: scriptPaths.length, toleratedHits, boundaryHits, scriptPaths };
}

// ===========================================================================
// Part A2：产物级 —— 「Safari 15 之后才有」的那一族 API（★ 2026-10-06）
// ===========================================================================
// 为什么 Part B（源码级）不够：这一族最可能的来源是**依赖** —— 教师让 ChatGPT 给绘图题
// 接进来的 `@xyflow/react` 就是这样：它的 chunk 里有一处**裸调** `structuredClone`
// （React Flow 的 `Handle` 点击连线那条路：`y = structuredClone(f)`），源码里一个字都没有
// ⇒ 源码那一轮根本看不见它。这与 Part A 当初把 lookbehind 挪到产物级是同一条理由。
//
// 🔴 那为什么以前不做产物级？因为**会永久红**：Next 自己的 polyfills chunk 里就有
//    `Object.hasOwn` / `Array.prototype.at` 的**定义**，markdown 栈里还有裸用；
//    「永久红」等于「没人再看它」。所以这里的判据不是「产物里有没有这个标记」，
//    而是**「有没有人兜住它」**：
//      · 这一族里**已经兜住**的（产物里能找到那份兜底的签名）⇒ 标记可以出现，只提示；
//      · **没兜住**的 ⇒ 标记一出现就失败，并说清三条出路（加兜底 / 改成特性检测 /
//        明确加一条 shim 签名并写理由）。
//    判据是「签名在不在」，所以它是**可复现、可验证**的：哪天有人把兜底删了，
//    那些裸用会立刻变红 —— 那正是我们要的信号（与容忍表同一条「容忍 ≠ 静默」原则）。
//
// ⚠️ `Array.prototype.at` 在这里写成 `.at(`：与 Part B 同一条标记同一个理由 ——
//    `format(` 不含 `.at(`，而 `foo.at(` 是真命中。
const BUNDLE_API_FAMILY = [
  {
    token: 'structuredClone',
    shim: /globalThis\.structuredClone\s*=/,
    shimWhy: '学生端入口的兜底（src/components/browser-compat-shims.tsx）',
  },
  {
    token: 'Object.hasOwn',
    shim: /Object\.hasOwn\s*\|\|\s*\(?\s*Object\.hasOwn\s*=/,
    shimWhy: 'Next 的 polyfills chunk（Object.hasOwn 定义）',
  },
  {
    token: '.at(',
    shim: /prototype\.at\s*=\s*function/,
    shimWhy: 'Next 的 polyfills chunk（Array.prototype.at 定义）',
  },
  // 下面这几条**没有人兜** ⇒ 一出现就失败（今天实测零命中）。
  { token: 'findLast', shim: null, shimWhy: null },
  { token: ':has(', shim: null, shimWhy: null },
  { token: 'color-mix(', shim: null, shimWhy: null },
  { token: '@container', shim: null, shimWhy: null },
  { token: 'content-visibility', shim: null, shimWhy: null },
];

/**
 * 扫产物里那一族 API。
 *
 * 🔴 `scriptPaths` 与 Part A **同一份清单**（由它交出来），不在这里再写一遍「扫哪些文件」：
 *    两份清单必然分叉，而分叉的后果是「某条闸门悄悄少扫了一半产物」且**看不出来**。
 */
function checkBundleApiTokens(scriptPaths) {
  const failures = [];
  const contents = new Map();
  for (const source of scriptPaths) {
    const filePath = path.join(root, 'out', source);
    if (!fs.existsSync(filePath)) continue;
    contents.set(source, fs.readFileSync(filePath, 'utf8'));
  }

  // 先找兜底：某个标记的兜底签名出现在**任意一个**在范围内的产物里，就算兜住了。
  const shims = new Map();
  for (const [source, content] of contents) {
    for (const entry of BUNDLE_API_FAMILY) {
      if (!entry.shim || shims.has(entry.token)) continue;
      if (entry.shim.test(content)) shims.set(entry.token, { source, why: entry.shimWhy });
    }
  }

  const allowedHits = [];
  for (const [source, content] of contents) {
    for (const entry of BUNDLE_API_FAMILY) {
      const count = content.split(entry.token).length - 1;
      if (count === 0) continue;
      if (entry.shim && shims.has(entry.token)) {
        allowedHits.push({ source, token: entry.token, count, shim: shims.get(entry.token) });
        continue;
      }
      failures.push(
        `${source}: 产物里有 ${count} 处 ${entry.token}（Safari 15 不支持，而产物里没有兜底）\n` +
        `    它多半是从**依赖**里进来的（源码那一轮看不见）。三条出路，挑一条：\n` +
        `    · 兜住它：在 src/components/browser-compat-shims.tsx 里加一份带签名的兜底；\n` +
        `    · 别用它：让那个库改成特性检测 + 回落；\n` +
        `    · 都不是：在 BUNDLE_API_FAMILY 里给这条标记写一条 shim + 理由（别只把它删掉）。`,
      );
    }
  }

  // 「兜底过期」也要有信号：某个标记的兜底签名今天没命中，说明那份兜底**不在这批产物里**
  //（被摇掉了、或在别的路由下）。这不是违规，但会让上面那条「允许」暂时没有依据。
  const shimlessTokens = BUNDLE_API_FAMILY.filter((entry) => entry.shim && !shims.has(entry.token));
  return { failures, allowedHits, shims, shimlessTokens, fileCount: contents.size };
}

// ===========================================================================
// Part B：源码级 —— Safari 15 不支持的语言/选择器标记
// ===========================================================================
// 为什么扫源码而不是产物：产物里会命中 Next runtime 垫片与 vendor chunk，
// 开发者修不了 ⇒ 闸门永久红 ⇒ 没人再看它。源码级每个命中都可归因、可修。
//
// ⚠️ 这里刻意**不写**命中的具体数字。它随依赖版本、分包结果、扫描口径每次都变，
//    写进来必然过期（上一版写的「3 / 1 / 1」在首屏 10 脚本口径与全 chunks/ 口径下
//    都复现不出来）。要看实际命中，跑这条可复现的命令（口径：顶层 chunks/ 的 .js）：
//        grep -c "Object.hasOwn" out/_next/static/chunks/*.js
//    本项目通则：任何「实测」后面必须跟着可复现的口径。

// ---- 1. 剥注释 ----------------------------------------------------------
// 必须剥，否则 home.module.css / shell.module.css 的「硬约束」注释本身
// 就逐字写着这些标记，脚本会被自己的注释绊倒（实测）。Part A 的容忍表
// 匹配也用这个函数。
//
// 只剥**块注释**与**行首** `//`，刻意不剥行尾 `//`：行尾注释的判定要区分
// 字符串字面量里的 `//`（如 `"a//b"`、`'https://…'`）与真注释，正则做不到
// 无歧义。放弃它，最坏情况从**漏报**（静默放走后面的真违规）变成**误报**
//（吵闹、可见、可修）——静默的洞比吵闹的失败糟。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（CSS + JS）
    .replace(/^[ \t]*\/\/.*$/gm, '');   // 行首行注释（JS/TS）
}

// ---- 2. 产物级容忍表 ----------------------------------------------------
/**
 * 已知且在容忍范围内的产物级命中。
 *
 * 判据按**内容签名**而不是文件名 —— 产物文件名带内容哈希，每次构建都变，
 * 按文件名豁免会静默腐烂。
 *
 * ⚠️ 判定粒度是**命中级**，不是文件级：签名命中**不等于**整份文件被跳过，
 * 还要数该文件里**全部**后行断言标记的命中总数，超过 toleratedMarkerHits 即失败。
 * 文件级粒度有一个真实的静默漏洞：webpack 的 splitChunks 分组**每次构建都可能变**，
 * 若有第二个库被并进同一个 chunk，它的 lookbehind 会连同 docx 那条一起被签名放行 ——
 * 而「未命中警告」也不会响（签名仍然匹配）⇒ 那条新违规**完全静默**。
 *
 * 签名失配（例如依赖升级后代码变了）时本表不再生效 ⇒ 构建重新变红 ⇒ 有人来看。
 * 这是有意的自愈设计：豁免必须有失效路径。
 *
 * 失效路径有**两条**，覆盖两件不同的事，缺一不可：
 *   1. 签名**失配** → 构建变红（本表条目不再吞掉那个命中）；
 *   2. 签名**整个消失**（依赖不再产出该代码）→ 本表与命中**两边都空**，
 *      若不单独提示就完全静默 ⇒ 由下方「容忍表未命中」警告兜住。
 */
const TOLERATED_PRODUCT_FINDINGS = [
  {
    signature: 'RegExp("(?<=\\\\{\\\\{)',
    /**
     * 该文件里**允许存在**的后行断言标记命中总数。
     * ⚠️ 这个数字是这条豁免的**边界**，不是装饰：webpack 的 splitChunks 分组每次
     * 构建都可能变，若有第二个库被并进本文件，它的 lookbehind 会连同 docx 的一起
     * 被签名放行 —— 那时这个计数会超，构建变红，有人来看。
     * 只按签名匹配（不数总数）时，那条新违规是完全静默的。
     *
     * 口径：剥注释后，六个 unsupportedLookbehinds 标记在本文件里的出现次数之和。
     * 当前实测为 1（只有 docx 那一条 `RegExp("(?<=\{\{)`）。
     */
    toleratedMarkerHits: 1,
    reason:
      'docx 库的 {{ }} 占位符扫描器（webpack chunk 840，由学生端 message-item.tsx:46 ' +
      '的 await import("@/lib/export-doc") 拉取）。经审查确认它不在 export-doc.ts 实际 ' +
      '使用的 new Document + Packer.toBlob 路径上，故当前运行期影响为零。',
  },
];

// ---- 3. 标记表 ----------------------------------------------------------
// hard: 零容忍，任何命中即失败。
// allowed: 已知且**有意**的用法，按 (文件, 标记) 冻结当前**出现次数** ——
//          出现次数增长即失败，这样豁免文件里也不能再偷偷加新的同类用法。
//          （口径曾是「命中行数」，但一行里可以塞任意多个选择器：实测
//           chat.module.css 有一行含 5 个 `:focus-visible`，行数口径下
//           往那一行追加新按钮不会让计数上涨 ⇒ 闸门形同虚设。）
//          d 与 e 两条的依据见计划 Ruling 5 的实测表。
const HARD_TOKENS = [
  'Object.hasOwn',
  'structuredClone',
  'findLast',
  ':has(',
  '@container',
  'content-visibility',
  // `.at(` 单独一条，因为它最容易被误伤（`format(` 不含 `.at(`，但 `foo.at(` 是真命中）
  '.at(',
  // 两处 CSS 注释的「不用」清单里都写了 `color-mix()`，但此前闸门里没有它 ——
  // 注释声称了闸门没有的东西。
  //
  // 「加入后零命中」成立的真正原因是**剥注释**，不是「学生端没在用」：
  // `color-mix` 实际上**也在扫描根内**——
  //   src/app/classroom/home/home.module.css:4
  //   src/app/classroom/shell/shell.module.css:4
  // 只不过那两处都在**块注释**里，被 stripComments 剥掉了。
  // ⇒ 这条标记与那两行注释是**耦合**的：剥注释一旦失效，红的是注释而不是代码。
  //   （全仓唯一的**非注释**用法在教师端 src/app/teacher/about/about.module.css:196，
  //     不在扫描根内。）
  'color-mix(',
];

const ALLOWED = {
  'src/app/classroom/chat/chat.module.css': {
    // 100vh → 100dvh 的渐进增强链；chat-panel.tsx:213-214 明写
    // 「Safari 15 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto」
    'dvh': 3,
    // 6 次：一行（选择器组）里 5 个 + 另一处 1 个。见上面「出现次数」口径的说明。
    ':focus-visible': 6,
  },
  // 学习单面板（P1/D2）：与 chat.module.css **逐字同一条**渐进增强链
  // （`height: 100vh` → `100dvh` → `var(--module-viewport-height, 100dvh)` 三行，
  // 外加 `min-height` / `max-height` 各一处 100dvh —— 打字机键盘弹出时可用高度由
  // 那个 CSS 变量给，三行是给「变量还没被设过」的第一帧用的，Safari 15 落到 `100vh`）。
  // 冻结在这里而不是留白：本文件是新加的学生端文件，不写进这张表的话它的 dvh 用法
  // **一次都不会被数到**（下面那段按 `ALLOWED[rel]` 迭代，没进表的文件不检查）。
  'src/app/classroom/worksheet/worksheet.module.css': {
    'dvh': 3,
  },
  'src/app/globals.css': {
    // 不支持只丢焦点环，布局与功能不受影响
    ':focus-visible': 5,
  },
  // 供应商化的 DOM 截图库（@zumer/snapdom 3.0.0，见 server/vendor/README.md）。
  //
  // ⚠️ **这两处是「特性检测 / 属性名字符串」，不是语法**，所以在 Safari 15 上是空操作：
  //   · `':has('` ×1 —— 原文是 `a.includes(":has(")&&(r.usesHas=!0)`：检查**页面自己的
  //     CSS** 里有没有用 `:has()`，只是记一个标记。它是**字符串字面量**，标记扫描器
  //     分不出字面量与真用法 —— 这就是本条豁免存在的原因，而不是「懒得看」。
  //   · `'content-visibility'` ×6 —— 分布是 **1+2+1+2**：一个属性名数组里的字符串 ×1；
  //     `(i["content-visibility"]||getPropertyValue("content-visibility"))==="hidden"` 读+
  //     强制写 ×3；`(o.contentVisibility||getPropertyValue("content-visibility")||"")==="auto"`
  //     读 + 覆盖 ×2。不支持的浏览器返回 `""` ⇒ 全部短路，什么都不做。
  //
  // ⚠️ **额度是「出现次数」不是「命中行数」，而且是靠 `grep -o … | wc -l` 量的。**
  // 这个文件被压缩成极少数几行，`grep -c` 会数成 3（行数）—— 实测就是这样差点把额度
  // 填错。定宽上下文的 `grep -o '.\{0,50\}…'` 同样不可靠：**重叠的匹配报不出来**，
  // 也会少报。复核对数时只用 `grep -o -F <token> <file> | wc -l`。
  //
  // 为什么这跟 lookbehind 是两回事：CSS 类特性不被支持时**规则被忽略**，不报错、
  // 不中断脚本；而 lookbehind 是**解析期 SyntaxError**，会让整个文件一个字都不执行。
  // 所以 CSS 类标记能豁免，lookbehind 不能 —— 后者由 `webapp-vendor.test.ts` 单独守。
  //
  // 计数是**冻结**的：升级 snapdom 后这两条一旦增长（说明新版本真的开始用它们），
  // 构建会失败 —— 那时要**重新审**，而不是顺手把数字改大。
  'server/vendor/snapdom.js': {
    ':has(': 1,
    'content-visibility': 6,
  },
};

// ---- 4. 扫描目标 --------------------------------------------------------
// src/app/layout.tsx：/classroom/ 继承根 layout，在可达范围内，必须纳入。
// 刻意**不**整个加 src/app —— 教师端页面有不同的兼容约束，纳进来只会引入
// 无关误报。新增学生端可达目录时，记得同步这里。
//
// ⚠️ **server/src/services/webapp-sdk.ts 为什么在一个前端扫描根里**：
// 它住在 server/ 下，但它的**内容**（SDK_SOURCE 那个模板字符串里的 JS）是
// **注入到学生 iframe 里、在学生的老 iPad 上执行**的代码 —— 与 /classroom/ 是
// 同一个约束面。它此前**不在任何闸门的覆盖范围内**：本数组全是 src/ 下的路径，
// 于是「一个跑在受约束设备上、却不受任何检查的新文件」。闸门看着有六条标记、
// 很严，但它守的是另一扇门。
//
// 本闸门按**标记（token）**扫、不要求能被解析，所以扫一个含模板字符串的 .ts
// 文件是可行的（模板串里的 JS 与 TS 代码一视同仁地被逐行 includes 检查）。
// 已知的粗糙处：模板串里的**注释**会被 stripComments 剥掉 ⇒ 注释里写这些标记
// 不会触发（这是安全的那个方向）；代价是理论上也可以把真代码藏在注释形状里，
// 但那需要刻意伪造注释语法，不是「不小心」能发生的。
const SCAN_ROOTS = [
  'src/app/classroom',
  'src/lib',
  'src/app/globals.css',
  'src/app/layout.tsx',
  'server/src/services/webapp-sdk.ts',
  // ⚠️ 同上一条的理由，而且更硬：这是**第三方产物**，由托管服务直接发给学生的老 iPad
  // 执行（`webapp-host.ts` 的 `SHOT_PATH` 路由），一个字节都不经过我们的构建流程。
  // 「不是我们写的」**不是**跳过兼容闸门的理由 —— 它跑在受约束设备上，就必须受检。
  'server/vendor/snapdom.js',
];
// ⚠️ `.js` 是给上面那条供应商文件加的。加之前已确认 `src/app/classroom` 与 `src/lib`
// 下**没有任何 .js 文件**（`find` 实测为空），所以这个扩展名不会让别的扫描根多扫出东西。
const EXTS = ['.ts', '.tsx', '.css', '.mjs', '.js'];

function walk(target, out = []) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) { out.push(target); return out; }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    // Scanner identifiers match the slash-separated exemption keys on every OS.
    // Native paths are only needed when accessing the filesystem.
    const child = path.posix.join(target, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (EXTS.some((ext) => entry.name.endsWith(ext))) out.push(child);
  }
  return out;
}

function checkSourceTokens() {
  const failures = [];
  const files = SCAN_ROOTS.flatMap((r) => walk(r));

  for (const rel of files) {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8');
    const source = stripComments(raw);
    const lines = source.split('\n');

    for (const token of HARD_TOKENS) {
      const hit = lines.findIndex((line) => line.includes(token));
      if (hit !== -1) {
        // 豁免：本文件的豁免表点名了这个标记，且**出现次数在额度内**。
        //
        // 口径与下面那段配额检查**完全一致**（出现次数 `split(token).length - 1`，
        // 不是命中行数），两边共用同一个额度。这样「硬标记」与「软标记」只有一套语义：
        // **这个文件可以出现这么多次，一次都不许新增**；超了由下面那段报错，
        // 报的文案更准（带具体次数与额度）。
        //
        // ⚠️ 这不是「把硬标记变软了」：额度是**冻结**的常量，写在豁免表里、带理由，
        // 且下面那条「豁免表引用了不存在的文件」的反向检查会挡住腐烂。新增用法
        // 仍然让构建变红 —— 与 Part A 容忍表的「容忍 ≠ 静默」是同一条原则。
        const budget = ALLOWED[rel]?.[token];
        if (budget !== undefined && source.split(token).length - 1 <= budget) continue;
        // ⚠️ 行号是**剥注释后**的口径：stripComments 会把块注释整段删掉，
        // 所以这里的行号与编辑器里的真实行号可能差很多（实测差过 62 行）。
        // **文件名是准的，行号只是线索**，不要拿它直接跳转。
        // 刻意**不**去还原真实行号：那要维护一份行号映射，成本大于收益。
        failures.push(
          `${rel}:${hit + 1}: Safari 15 不支持 ${token}` +
          `（行号是**剥注释后**的口径，与编辑器里的真实行号可能不同；文件名是准的）`,
        );
      }
    }

    for (const [token, budget] of Object.entries(ALLOWED[rel] ?? {})) {
      // 数**出现次数**而非命中行数：一行内的任意追加都必须让计数上涨。
      const count = source.split(token).length - 1;
      if (count > budget) {
        failures.push(
          `${rel}: ${token} 出现 ${count} 次，超出豁免额度 ${budget} 次。` +
          `\n  该文件对该标记的既有用法是有意的降级（见 Ruling 5），但**不得新增**。`,
        );
      }
    }
  }

  // 反向检查：豁免表里点名的文件必须还在，否则豁免表在悄悄腐烂
  for (const rel of Object.keys(ALLOWED)) {
    if (!files.includes(rel)) failures.push(`豁免表引用了不存在的文件: ${rel}`);
  }

  // 反向检查：**每一条扫描根都必须真的产出文件**。
  // `walk()` 对不存在的路径静默返回空集 —— 一个拼错的根就等于「这条根从未被扫过」，
  // 而闸门仍然是**绿的**。这正是「只改数组不做反证，你无法区分『扫到了』与
  // 『路径写错了但没命中』」那个洞，在这里被堵成一条**永久**的不变量。
  //
  // ⚠️ 判据必须是 `walk(rel).length > 0`，**只查 existsSync 不够**（审查者实测）：
  // 把根换成 server/changelogs（**存在**，但里面全是 .md，而 EXTS 不含 .md）
  // ⇒ 闸门绿、源码计数少一个、**没有任何提示**。也就是说只查存在性的话，
  // 「路径拼错」被堵住了，而「路径存在但没有一个文件落在 EXTS 里」这半边仍然静默。
  // 一个判据同时覆盖两种成因，所以这里不写两个分支。
  for (const rel of SCAN_ROOTS) {
    if (walk(rel).length === 0) {
      failures.push(
        `扫描根产出 0 个文件: ${rel}\n` +
        `  这条根**从未被扫过**，而闸门是绿的。两种成因：\n` +
        `    · 路径不存在 / 被改名 / 被挪走；\n` +
        `    · 路径存在，但底下没有一个文件的扩展名落在 EXTS（${EXTS.join(' ')}）里。`,
      );
    }
  }

  return { failures, fileCount: files.length };
}

// ===========================================================================
// 汇总：两道检查各跑各的，一次把两边的失败都报出来
// ===========================================================================
const bundle = checkBundleLookbehinds();
const bundleApi = checkBundleApiTokens(bundle.scriptPaths);
const source = checkSourceTokens();

const sections = [
  ['产物级 lookbehind（扫 out/）', bundle.failures],
  ['产物级 Safari 15 之后的 API（扫 out/）', bundleApi.failures],
  ['源码级 Safari 15 标记（扫 src/）', source.failures],
].filter(([, list]) => list.length > 0);

if (sections.length > 0) {
  const body = sections
    .map(([title, list]) => `\n【${title}】\n${list.join('\n')}`)
    .join('\n');
  throw new Error(`学生端浏览器兼容性检查失败:${body}`);
}

// ── 两类提示语义不同，措辞必须分开，不要合成一句 ──────────────────────────
//  · 容忍表命中   = 「**看见了**一个已知违规」（被接受的），所以喊，但不失败。
//  · 容忍表未命中 = 「这条豁免**可能已经过期**」，与违规无关。
//  · 边界提示     = 「**可能没在看那儿**」（路径不在约束范围内，无法判断是否违规）。
for (const hit of bundle.toleratedHits) {
  console.warn(
    `⚠️  [browser-compat] 容忍表命中（构建继续，不失败）: ${hit.source}\n` +
    `⚠️    签名 ${hit.signature}\n` +
    `⚠️    ${hit.reason}\n` +
    `⚠️    容忍 ≠ 静默：签名失配时本表失效，构建会重新变红。`,
  );
}

// 容忍表的两条失效路径都要有信号，它们覆盖的是两件不同的事：
//   · 签名**失配**（依赖升级后代码变了）→ 上面的失败分支会让构建变红；
//   · 签名**整个消失**（依赖不再产出该代码）→ failures 与 toleratedHits **两边都空**，
//     若不单独提示就会**完全静默地**烂掉。所以这里非失败地喊一声。
const matchedSignatures = new Set(bundle.toleratedHits.map((hit) => hit.signature));
const unmatchedEntries = TOLERATED_PRODUCT_FINDINGS.filter(
  (entry) => !matchedSignatures.has(entry.signature),
);
if (unmatchedEntries.length > 0) {
  console.warn(
    `⚠️  [browser-compat] 容忍表未命中 ${unmatchedEntries.length} 条` +
    `（不是违规，是「这条豁免可能已经过期」）:\n` +
    unmatchedEntries.map((entry) => `⚠️    - ${entry.signature}`).join('\n') + '\n' +
    `⚠️    本次构建没有任何产物命中上述签名。要么依赖已不再产出该代码（可以把条目删掉），\n` +
    `⚠️    要么签名已变（那本该让构建变红）。`,
  );
}

// 边界提示：只提示，绝不进 failures。见上面的「排除 ≠ 不看」。
// 必须打印**标记**，不能只打印文件名 —— 这条提示是将来打包事故的唯一信号，
// 看不到是哪条正则在作祟就没有诊断力（失败分支是会打印标记的，这里对齐）。
for (const hit of bundle.boundaryHits) {
  console.warn(
    `⚠️  [browser-compat] 边界提示（不在约束范围内，仅提示、不失败）: ${hit.source}\n` +
    `⚠️    命中标记 ${hit.pattern}\n` +
    `⚠️    该路径属于教师端 / help 路由，本闸门不覆盖，因此**无法判断**它是否算违规。\n` +
    `⚠️    若这里出现了学生端可达的代码，说明打包把学生端组件发到了教师端路由下 —— 请人工确认。`,
  );
}

// 已兜住的那一族：**提示**，不失败。要打印「谁兜的」，否则将来没人知道它是怎么被放行的。
for (const [token, shim] of bundleApi.shims) {
  const hits = bundleApi.allowedHits.filter((hit) => hit.token === token);
  if (hits.length === 0) continue;
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  console.log(
    `[browser-compat] 产物里有 ${total} 处 ${token}（分布在 ${hits.length} 个脚本）——` +
    `已由 ${shim.source} 兜住（${shim.why}）。`,
  );
}
if (bundleApi.shimlessTokens.length > 0) {
  console.warn(
    `⚠️  [browser-compat] 这几条标记的兜底今天**不在产物里**（不是违规，是那条「允许」暂时没有依据）:\n` +
    bundleApi.shimlessTokens.map((entry) => `⚠️    - ${entry.token}（期望签名来自 ${entry.shimWhy}）`).join('\n'),
  );
}

console.log(
  `[browser-compat] 产物 ${bundle.scriptCount} 个脚本（lookbehind）+ ${bundleApi.fileCount} 个脚本（API 族）` +
  ` + 源码 ${source.fileCount} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
