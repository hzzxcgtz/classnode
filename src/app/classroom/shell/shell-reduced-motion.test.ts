/**
 * ★ M6b/11：`shell.module.css` 的 `prefers-reduced-motion` 降级块**必须一条不漏**。
 *
 * 🔴 为什么要有它：那个文件自己逐字写着「本文件里所有会动的东西都必须在这里被关掉，一条不漏」，
 * 而那条纪律**没有任何机制守着** —— 下次谁加一个带 `:active` 的按钮，
 * **不会有任何信号**告诉他要不要加进降级块。这条用例把「一条不漏」变成可判定的。
 *
 * ⚠️ 它**只读 CSS 文本、不渲染任何东西** ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它查的是**选择器集合**，不是样式对不对 —— 后者只能真机看。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'shell.module.css'), 'utf8');

/** 取降级块（`@media (prefers-reduced-motion: reduce) { … }`）的正文。 */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(start, -1, 'shell.module.css 里必须有 prefers-reduced-motion 降级块');
  // 从 `{` 开始做花括号配平（块里还有嵌套的 `{}`）。
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open + 1, i); }
  }
  throw new Error('降级块的花括号不配平');
}

/** 从一段 CSS 里收集所有 `X:active` 的选择器（去掉前后空白、按名排序）。 */
function activeSelectors(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/([.#][A-Za-z0-9_-]+):active/g)) out.add(m[1]);
  return [...out].sort();
}

test('★ 降级块里必须列出文件里每一个 `:active` 选择器（一条不漏）', () => {
  const all = activeSelectors(CSS);
  const covered = activeSelectors(reducedMotionBlock(CSS));
  assert.ok(all.length > 0, '阳性对照：这个文件里本来就有 `:active`（少了它，两边都空也会全绿）');
  assert.deepEqual(covered, all, `有 \`:active\` 没进降级块：${all.filter((s) => !covered.includes(s)).join(' / ')}`);
});

test('反证：往文件里塞一个不带降级的 `.foo:active` ⇒ 上一条的判据必须能发现它', () => {
  // 不真改文件：把一条假规则喂给同一个判据。
  const injected = `${CSS}\n.probeActive:active { transform: none; }\n`;
  const all = activeSelectors(injected);
  const covered = activeSelectors(reducedMotionBlock(injected));
  assert.notDeepEqual(covered, all, '判据必须能发现「新加的 :active 没进降级块」');
  assert.deepEqual(all.filter((s) => !covered.includes(s)), ['.probeActive']);
});
