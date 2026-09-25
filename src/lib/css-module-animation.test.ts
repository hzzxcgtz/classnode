/**
 * ★ M6b/13 的连带修复：**CSS 模块里引用的每一个 `animation` 名字，都必须在同一个文件里定义。**
 *
 * 🔴 为什么要有它 —— 这不是一条「风格」纪律，是一个**已经发生过的静默失效**：
 * `css-loader` 的模块模式会把 `animation-name` 当成**局部名字改写**（加 `文件名_名字__hash` 前缀），
 * 但**只有在本文件里能找到同名 `@keyframes` 时**那个改写才指向一个真实存在的定义。
 * 名字写错 / 忘了把 `@keyframes` 一起搬过来时，产物里留下的是一个**悬空引用**：
 *
 *   - 构建**不报错**（`next build` 退出 0）；
 *   - `grep` **看得见**（`.spinner { animation: spin .7s linear infinite; }` 明明写着）；
 *   - 但元素**不会动** —— `@keyframes worksheet_spin__FJ3q5` 在任何产物文件里都不存在。
 *
 * 这正是本仓反复出现的那种失败：**「看起来对」和「真的是对的」之间没有信号**。
 * 实测取证（2026-09-25）：`worksheet.module.css` 的 `.spinner` 就是这样一个悬空引用 ——
 * 它引的是 `globals.css` 的全局 `@keyframes spin`，而**跨文件引用在模块里不成立**：
 * 产物里 `animation: worksheet_spin__FJ3q5 …`，而全仓产物**没有**这个 keyframes。
 * ⇒ 「本文件自带一份 `spin`」是**我在清单里写错的一句话**，本用例就是为了让这句话以后必须为真。
 *
 * ⚠️ 只读 CSS 文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它只查「名字有没有定义」，**不查动画好不好看、时长对不对** —— 后者只能真机看。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..'); // → src/

/**
 * 递归找出所有 CSS 模块（`扩展名为 .module.css` 的文件）。
 * ⚠️ 不写 glob 字面量，避免在块注释里出现会提前闭合注释的字符序列。
 */
function findCssModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findCssModules(full));
    else if (entry.name.endsWith('.module.css')) out.push(full);
  }
  return out.sort();
}

/** 本文件里定义的全部 `@keyframes` 名字。 */
function declaredKeyframes(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return out;
}

/**
 * `animation` 简写里**不可能是名字**的那些词。
 *
 * 简写是 `名字 时长 缓动 延迟 次数 方向 填充 播放状态` 的任意顺序，
 * 所以不能「取第一个词」了事 —— 但反过来，只要把「关键字/数值」排掉，
 * 剩下的第一个词就是名字（本仓所有用法都是名字打头，这个兜底足够稳）。
 */
const NOT_A_NAME = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused', 'linear', 'ease',
  'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'initial',
  'inherit', 'unset', 'revert', 'auto',
]);

/** 从一条声明值里取出被引用的动画名字（支持逗号分隔的多条动画）。 */
function animationNames(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(',')) {
    for (const token of part.trim().split(/\s+/)) {
      if (token === '') continue;
      if (NOT_A_NAME.has(token.toLowerCase())) continue;
      if (/^[\d.]/.test(token)) continue; // 时长 / 次数
      if (token.startsWith('cubic-bezier(') || token.startsWith('steps(') || token.startsWith('var(')) continue;
      if (token.includes('(')) continue;
      out.push(token);
      break; // 每条动画只取一个名字
    }
  }
  return out;
}

/**
 * 收集一段 CSS 里所有 `animation` / `animation-name` 声明引用的名字。
 * ⚠️ 先剥掉注释 —— 文档注释里写着 `animation: none` 和 `@keyframes` 是常事（本仓就是），
 * 不剥的话会把注释当成声明，凭空造出名字。
 */
function referencedNames(css: string): { name: string; line: number }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  const out: { name: string; line: number }[] = [];
  const decl = /(?:^|[;{\s])(animation(?:-name)?)\s*:\s*([^;}]+)/g;
  for (const m of stripped.matchAll(decl)) {
    const line = stripped.slice(0, m.index).split('\n').length;
    for (const name of animationNames(m[2])) out.push({ name, line });
  }
  return out;
}

test('★ CSS 模块引用的每个动画名字，都必须在同一个文件里定义（跨文件引用不成立）', () => {
  const files = findCssModules(SRC);
  assert.ok(files.length > 0, '阳性对照：src 下必须有 CSS 模块（一个都没找到说明扫描根写错了）');

  let sawAnyReference = false;
  const dangling: string[] = [];

  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    const declared = declaredKeyframes(css);
    const rel = path.relative(SRC, file);
    for (const { name, line } of referencedNames(css)) {
      sawAnyReference = true;
      if (!declared.has(name)) dangling.push(`${rel}:${line} 引用了 \`${name}\`，本文件没有这个 @keyframes`);
    }
  }

  assert.ok(sawAnyReference, '阳性对照：至少要有一个模块用到 animation（否则本用例空转全绿）');
  assert.deepEqual(dangling, [], `发现悬空动画引用（产物里元素不会动，但构建不报错）：\n  ${dangling.join('\n  ')}`);
});

test('反证：把本文件里定义的 @keyframes 抽走 ⇒ 上一条的判据必须能发现', () => {
  // 不真改任何文件：拿一份「有引用、没有定义」的假 CSS 喂给同一套判据。
  const fake = '.probe { animation: probeSpin .7s linear infinite; }';
  const declared = declaredKeyframes(fake);
  const referenced = referencedNames(fake).map((r) => r.name);
  assert.deepEqual(referenced, ['probeSpin'], '判据得先从简写里认出名字');
  assert.deepEqual(referenced.filter((n) => !declared.has(n)), ['probeSpin'], '没有定义 ⇒ 必须被判定为悬空');
});

test('反证：`animation: none` 与注释里的动画字样都不算引用（否则误报会淹没真问题）', () => {
  const fake = '/* 这里写着 animation: ghost 与 @keyframes ghost */\n.x { animation: none; }';
  assert.deepEqual(referencedNames(fake), [], '注释与 `none` 都不该被当成引用');
});
