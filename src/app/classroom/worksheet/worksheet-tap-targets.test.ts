/**
 * ★ M6b/15 的补网（独立审查 2026-09-25 抓到漏扫）：**本模块里每一个 `<button>` 命中区都必须 ≥ 44px。**
 *
 * 🔴 为什么要有它：`worksheet.module.css` 自己把「44px 是触屏命中区的下限，老 iPad 上手指更粗」
 * 写了 **4 遍**，而那条纪律**靠人记得**。M6b/15 的现状枚举写成「`.submitButton` 与 `.retry` 都是 40px」
 * —— 那是**拿 `grep min-height` 扫出来的**，于是同文件里用 `width/height` 写的 `.orderButton`（40×40）
 * **一次都没被扫到**，修法照抄那句枚举也就一起漏了：**排序题的 ▲/▼ 在老 iPad 上仍是 40×40**。
 * ⇒ 判据不能是「我 grep 了哪些」、只能是「屏幕上每一个按钮实际多大」，
 * 所以这条用例**从 TSX 反查**：先找出渲染成 `<button>` 的元素，再回到 CSS 里量它的尺寸。
 *
 * ⚠️ 只读文本、不渲染 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它量的是**声明的尺寸**，不是屏幕上的实际大小（圆角/内边距/父容器都可能影响）——
 * 「手指按着够不够大」仍需真机。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8');

const MIN_TAP = 44;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** 取某条类规则里声明的 `{ width, height, minHeight, minWidth }`（数值 + 原始单位）。 */
function boxOf(css: string, cls: string): Record<string, number> {
  const stripped = stripComments(css);
  const start = stripped.indexOf(`.${cls} {`);
  if (start === -1) return {};
  const end = stripped.indexOf('}', start);
  const body = stripped.slice(start, end);
  const out: Record<string, number> = {};
  for (const prop of ['width', 'height', 'min-width', 'min-height']) {
    // 只认纯 px 值 —— 别的单位（%、rem、vh）这里一律不当成命中区尺寸，交给真机看。
    const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([\\d.]+)px`));
    if (m) out[prop] = Number(m[1]);
  }
  return out;
}

/** 找出本模块所有渲染成 `<button>` 的元素，以及它们挂的 `styles.X` 类。 */
function buttonsInModule(): { file: string; line: number; classes: string[] }[] {
  const out: { file: string; line: number; classes: string[] }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const m of text.matchAll(/<button\b/g)) {
        // 截到该标签的结尾（`/>` 或 `>`）—— 属性里有 `>` 的情况本仓没有。
        const rest = text.slice(m.index);
        const gt = Math.min(...[rest.indexOf('/>'), rest.indexOf('>')].filter((i) => i !== -1));
        const tag = rest.slice(0, gt === Infinity ? rest.length : gt);
        const classes = [...new Set([...tag.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((c) => c[1]))];
        const line = text.slice(0, m.index).split('\n').length;
        out.push({ file: path.relative(HERE, full), line, classes });
      }
    }
  };
  walk(HERE);
  return out;
}

test('★ 本模块里每个 <button> 的命中区都必须 ≥ 44px（尺寸可能写在多个类上，取并集）', () => {
  const buttons = buttonsInModule();
  assert.ok(buttons.length > 0, '阳性对照：这个目录里必须有 <button>（一个都没找到说明扫描写错了）');

  const tooSmall: string[] = [];
  for (const { file, line, classes } of buttons) {
    assert.ok(classes.length > 0, `${file}:${line} 的 <button> 没挂 styles 类，本用例量不到它`);
    const boxes = classes.map((c) => boxOf(CSS, c));
    // 尺寸可以写在任一兄弟类上（例如 `.submitButton` 给高度、`Resubmit` 只改配色）⇒ 取并集。
    const height = Math.max(...boxes.map((b) => b.height ?? b['min-height'] ?? 0));
    const width = Math.max(...boxes.map((b) => b.width ?? b['min-width'] ?? 0));
    if (height < MIN_TAP) tooSmall.push(`${file}:${line} ${classes.join('+')} 高 ${height}px < ${MIN_TAP}px`);
    // 只对「写死了宽度」的图标按钮量宽 —— 撑满一行的按钮不该因为 width 缺失被判红。
    if (width > 0 && width < MIN_TAP) tooSmall.push(`${file}:${line} ${classes.join('+')} 宽 ${width}px < ${MIN_TAP}px`);
  }

  assert.deepEqual(tooSmall, [], `这些按钮的命中区跌破 44px：\n  ${tooSmall.join('\n  ')}`);
});

test('反证：把一个 40px 的假按钮类喂给同一套判据 ⇒ 必须被发现', () => {
  const fakeCss = '.probeBtn { width: 40px; height: 40px; }';
  const b = boxOf(fakeCss, 'probeBtn');
  assert.equal(b.height, 40, '判据得能从 `height` 读出尺寸');
  assert.ok(b.height < MIN_TAP, '40px 必须被判为跌破下限');
  assert.deepEqual(boxOf(fakeCss, 'nope'), {}, '不存在的类返回空 ⇒ 不会被误判成达标');
});

test('反证：`min-height: 44px` 必须算达标（否则会把已经修好的按钮报成红的）', () => {
  const b = boxOf('.ok { min-height: 44px; padding: 0 18px; }', 'ok');
  assert.equal(Math.max(b.height ?? b['min-height'] ?? 0, b['min-height'] ?? 0), 44, 'min-height 要能顶替 height');
});
