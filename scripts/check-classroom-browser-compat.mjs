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
//「文件不存在」失败分支，均自原脚本沿用；后续只做了两处受控改动：
//   1. 扫描集合从「index.html 引用的脚本」扩为下面 (1)+(2)+(3) 之并集；
//   2. 命中时先查容忍表 TOLERATED_PRODUCT_FINDINGS（见该表注释）。
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
  //     代价（须明说）：这两条路径下的产物**不会**被本闸门检查。若将来有学生端可达的代码
  //     被打包进这两个路由的自有 chunk，本闸门会漏 —— 那种情况应被视为打包事故，
  //     并且必须重新审视这条排除。
  //     现状说明：实测今天教师端 `app/teacher/**` 全树 **零命中**，所以这条排除
  //     **当前不掩盖任何东西**；它是一条为将来保留的边界，而不是在压一个已知违规。
  const EXCLUDED_CHUNK_PREFIXES = [
    '/_next/static/chunks/app/teacher/',
    '/_next/static/chunks/app/help/',
  ];
  const allChunkPaths = listJsFiles(chunksDir)
    .map(toOutRelative)
    .filter((rel) => !EXCLUDED_CHUNK_PREFIXES.some((prefix) => rel.startsWith(prefix)));

  // 三者之并集，去重。(2) 与 (3) 今天有重叠，不去重会让同一个 chunk 被检测两遍、
  // 失败信息与容忍警告也会重复。
  const scriptPaths = [...new Set([...htmlScriptPaths, ...routeScriptPaths, ...allChunkPaths])];

  const unsupportedLookbehinds = ['/(?<=', '/(?<!', 'RegExp("(?<=', 'RegExp("(?<!', "RegExp('(?<=", "RegExp('(?<!"];
  const failures = [];
  const toleratedHits = [];

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
    const matched = TOLERATED_PRODUCT_FINDINGS.find((t) => stripComments(content).includes(t.signature));
    if (matched) {
      toleratedHits.push({ source, signature: matched.signature, reason: matched.reason });
      continue;
    }

    failures.push(`${source}: 包含 Safari 15 不支持的正则后行断言 ${pattern}`);
  }

  return { failures, scriptCount: scriptPaths.length, toleratedHits };
}

// ===========================================================================
// Part B：源码级 —— Safari 15 不支持的语言/选择器标记
// ===========================================================================
// 为什么扫源码而不是产物：产物里会命中 Next runtime 垫片与 vendor chunk
//（实测 Object.hasOwn 3 处、.at( 1 处、structuredClone 1 处），开发者修不了
//  ⇒ 闸门永久红 ⇒ 没人再看它。源码级每个命中都可归因、可修。

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
 * 签名失配（例如依赖升级后代码变了）时本表不再生效 ⇒ 构建重新变红 ⇒ 有人来看。
 * 这是有意的自愈设计：豁免必须有失效路径。
 */
const TOLERATED_PRODUCT_FINDINGS = [
  {
    signature: 'RegExp("(?<=\\\\{\\\\{)',
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
  // 注释声称了闸门没有的东西。全仓 `color-mix` 只出现在
  // src/app/teacher/about/about.module.css（教师端，不在扫描根内），加入后零命中。
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
const SCAN_ROOTS = ['src/app/classroom', 'src/lib', 'src/app/globals.css', 'src/app/layout.tsx'];
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

// 容忍 ≠ 静默：命中了就**每次构建**都喊一遍，让人看得见它还在。
for (const hit of bundle.toleratedHits) {
  console.warn(
    `⚠️  [browser-compat] 容忍表命中（构建继续，不失败）: ${hit.source}\n` +
    `⚠️    签名 ${hit.signature}\n` +
    `⚠️    ${hit.reason}\n` +
    `⚠️    容忍 ≠ 静默：签名失配时本表失效，构建会重新变红。`,
  );
}
if (bundle.toleratedHits.length === 0) {
  console.warn(
    `⚠️  [browser-compat] 容忍表有 ${TOLERATED_PRODUCT_FINDINGS.length} 条，但本次构建一条都没命中。\n` +
    `⚠️    要么依赖已不再产出该代码（可以把条目删掉），要么签名已变（那本该让构建变红）。`,
  );
}

console.log(
  `[browser-compat] 产物 ${bundle.scriptCount} 个脚本（lookbehind）` +
  ` + 源码 ${source.fileCount} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
