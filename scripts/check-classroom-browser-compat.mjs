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

  return { failures, scriptCount: scriptPaths.length, toleratedHits, boundaryHits };
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
  'src/app/globals.css': {
    // 不支持只丢焦点环，布局与功能不受影响
    ':focus-visible': 5,
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
];
const EXTS = ['.ts', '.tsx', '.css', '.mjs'];

function walk(target, out = []) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) { out.push(target); return out; }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
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
        failures.push(`${rel}:${hit + 1}: Safari 15 不支持 ${token}`);
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

  // 反向检查：**每一条扫描根都必须存在**。
  // `walk()` 对不存在的路径静默返回空集 —— 一个拼错的根就等于「这条根从未被扫过」，
  // 而闸门仍然是**绿的**。这正是「只改数组不做反证，你无法区分『扫到了』与
  // 『路径写错了但没命中』」那个洞，在这里被堵成一条**永久**的不变量：
  // 将来谁把根改错、或把被扫的文件挪走/改名，构建会红，而不是静默地少扫一个根。
  for (const rel of SCAN_ROOTS) {
    if (!fs.existsSync(path.join(root, rel))) {
      failures.push(
        `扫描根不存在: ${rel}\n` +
        `  walk() 对不存在的路径静默返回空集 ⇒ 这条根从未被扫过，而闸门是绿的。`,
      );
    }
  }

  return { failures, fileCount: files.length };
}

// ===========================================================================
// 汇总：两道检查各跑各的，一次把两边的失败都报出来
// ===========================================================================
const bundle = checkBundleLookbehinds();
const source = checkSourceTokens();

const sections = [
  ['产物级 lookbehind（扫 out/）', bundle.failures],
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

console.log(
  `[browser-compat] 产物 ${bundle.scriptCount} 个脚本（lookbehind）` +
  ` + 源码 ${source.fileCount} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
