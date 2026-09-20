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
// ⚠️ 本函数内的判据、六个标记、scriptPaths 的抠法、out/ 路径拼接、
//    「文件不存在」失败分支，均为原样恢复，**请勿改动**。相对原脚本的
//    唯一机械改动：结尾的 throw / console.log 换成 return，交给下方统一汇总。
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

  // (2) classroom 路由**自己**的 chunk 目录 —— 管懒加载（next/dynamic）chunk。
  //     这类 chunk 不在 index.html 里，只按 (1) 扫会漏掉。
  //     注意：这道覆盖原先靠「classroom 恰好没有懒加载」偶然成立；一旦引入
  //     next/dynamic，新 chunk 落在本目录下却不在 index.html 里 ⇒ 变成盲区。
  const routeChunkDir = path.join(root, 'out', '_next', 'static', 'chunks', 'app', 'classroom');

  function listRouteChunks(dir) {
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...listRouteChunks(child));
      else if (entry.name.endsWith('.js')) found.push(child);
    }
    return found;
  }

  const outDir = path.join(root, 'out');
  const routeScriptPaths = listRouteChunks(routeChunkDir)
    .map((abs) => `/${path.relative(outDir, abs).split(path.sep).join('/')}`);

  // 两者之并集，去重。(1) 与 (2) 今天有重叠（classroom 暂无懒加载），
  // 不去重会让同一个 chunk 被检测两遍、失败信息也重复。
  //
  // ⚠️ 刻意**不**扫整个 out/_next/static/chunks/：教师端 app/teacher/** 的
  //    lookbehind 是合法的（教师用桌面浏览器）。扫进来会变成**假失败**，
  //    而一个会误报的闸门很快就会被绕过 —— 那比漏报更糟。
  const scriptPaths = [...new Set([...htmlScriptPaths, ...routeScriptPaths])];

  const unsupportedLookbehinds = ['/(?<=', '/(?<!', 'RegExp("(?<=', 'RegExp("(?<!', "RegExp('(?<=", "RegExp('(?<!"];
  const failures = [];

  for (const source of scriptPaths) {
    const filePath = path.join(root, 'out', source);
    if (!fs.existsSync(filePath)) {
      failures.push(`${source}: 文件不存在`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const pattern = unsupportedLookbehinds.find((candidate) => content.includes(candidate));
    if (pattern) failures.push(`${source}: 包含 Safari 15 不支持的正则后行断言 ${pattern}`);
  }

  return { failures, scriptCount: scriptPaths.length };
}

// ===========================================================================
// Part B：源码级 —— Safari 15 不支持的语言/选择器标记
// ===========================================================================
// 为什么扫源码而不是产物：产物里会命中 Next runtime 垫片与 vendor chunk
//（实测 Object.hasOwn 3 处、.at( 1 处、structuredClone 1 处），开发者修不了
//  ⇒ 闸门永久红 ⇒ 没人再看它。源码级每个命中都可归因、可修。

// ---- 1. 剥注释 ----------------------------------------------------------
// 必须剥，否则 home.module.css / shell.module.css 的「硬约束」注释本身
// 就逐字写着这些标记，脚本会被自己的注释绊倒（实测）。
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

// ---- 2. 标记表 ----------------------------------------------------------
// hard: 零容忍，任何命中即失败。
// allowed: 已知且**有意**的用法，按 (文件, 标记) 冻结当前命中**行数** ——
//          行数增长即失败，这样豁免文件里也不能再偷偷加新的同类用法。
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
];

const ALLOWED = {
  'src/app/classroom/chat/chat.module.css': {
    // 100vh → 100dvh 的渐进增强链；chat-panel.tsx:213-214 明写
    // 「Safari 15 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto」
    'dvh': 3,
    ':focus-visible': 2,
  },
  'src/app/globals.css': {
    // 不支持只丢焦点环，布局与功能不受影响
    ':focus-visible': 5,
  },
};

// ---- 3. 扫描目标 --------------------------------------------------------
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
      const count = lines.filter((line) => line.includes(token)).length;
      if (count > budget) {
        failures.push(
          `${rel}: ${token} 出现 ${count} 行，超出豁免额度 ${budget} 行。` +
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

console.log(
  `[browser-compat] 产物 ${bundle.scriptCount} 个脚本（lookbehind）` +
  ` + 源码 ${source.fileCount} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
