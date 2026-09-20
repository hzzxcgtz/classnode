import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- 1. 剥注释 ----------------------------------------------------------
// 必须剥，否则 home.module.css / shell.module.css 的「硬约束」注释本身
// 就逐字写着这些标记，脚本会被自己的注释绊倒（实测）。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（CSS + JS）
    .replace(/^[ \t]*\/\/.*$/gm, '')    // 行注释（JS/TS）
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行尾注释（避免吃掉 https://）
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
// 源码级：每个命中都可归因、可修。产物级会命中 Next runtime 与 vendor chunk。
const SCAN_ROOTS = ['src/app/classroom', 'src/lib', 'src/app/globals.css'];
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

if (failures.length > 0) {
  throw new Error(`学生端浏览器兼容性检查失败:\n${failures.join('\n')}`);
}

console.log(
  `[browser-compat] 源码 ${files.length} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
