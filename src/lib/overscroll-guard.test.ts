/**
 * 浮层里的**滚轮守卫** —— 判据的逐条断言（★ 2026-09-29，教师）。
 *
 * 教师原话（两条，第二条是这次的关键）：
 *   ① 「系统中有多处使用了右侧抽屉式浮窗，在使用鼠标滚轮时，能不能在浮窗中滚动条到底后，
 *      不要对外面的窗口也滚动？」
 *   ② 「还是不行，**如果抽屉里本身没有垂直滚动条，它就会滚动抽屉外的页面**」。
 *
 * ② 把 CSS 那条路否掉了：`overscroll-behavior: contain` 只在容器**真的有可滚余量**时生效，
 * 而那正是抽屉/弹窗**大多数时候**的样子（截图那个抽屉里只有两条消息）。
 * ⇒ 判据搬到这里，由守卫用 JS 执行。
 *
 * 跑法：`node --test src/lib/overscroll-guard.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOAT_ROOT_SELECTOR,
  chainConsumesWheel,
  consumesWheel,
  type ScrollMetrics,
} from './overscroll-guard.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 一层滚动容器。默认「有 100 的余量、停在中间」—— 各用例只改它关心的那几个数。 */
function layer(over: Partial<ScrollMetrics> = {}): ScrollMetrics {
  return { overflowY: 'auto', scrollTop: 0, scrollHeight: 500, clientHeight: 300, ...over };
}

test('🔴 有余量且在中间 ⇒ 吃得下（这是最普通的一次滚动，守卫必须放手）', () => {
  assert.equal(consumesWheel(layer({ scrollTop: 100 }), 120), true);
  assert.equal(consumesWheel(layer({ scrollTop: 100 }), -120), true);
});

test('🔴 **没有可滚余量** ⇒ 吃不掉 —— 教师报的那个形态，CSS 治不了、这里必须拦住', () => {
  // 抽屉里只有两条消息时的真实数字：`scrollHeight === clientHeight`。
  // ⚠️ 浏览器不认为这是 overscroll ⇒ `overscroll-behavior: contain` 不生效
  // ⇒ 这一条要是答 `true`，教师报的毛病原样回来。
  assert.equal(consumesWheel(layer({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), 120), false);
  assert.equal(consumesWheel(layer({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), -120), false);
  // 内容比容器还矮（`scrollHeight < clientHeight`，边框/行高凑出来的）也一样。
  assert.equal(consumesWheel(layer({ scrollHeight: 280, clientHeight: 300 }), 120), false);
});

test('🔴 余量为 0 时**不许看 `scrollTop`**（内容刚从长变短的那一帧里它可能还是旧值）', () => {
  // 🔴 这一条是给 `max <= 0` 那个**提前返回**写的 —— 少了它，其余用例**全都照样绿**
  //（余量真为 0 时 `scrollTop` 被浏览器夹成 0，于是「边界」那两条判据与它同解 ⇒ 变异检验抓不到）。
  // 而它挡的是一个真实形态：**内容变短的那一刻**（消息被清空 / 抽屉换了内容 / 窗口拉大），
  // 浏览器要到下一帧才把 `scrollTop` 夹回 0；那一帧里 `deltaY < 0` 会拿旧 `scrollTop`
  // 答「吃得下」⇒ 页面被带着滚一下，而屏幕上看不出为什么。
  assert.equal(consumesWheel(layer({ scrollTop: 50, scrollHeight: 300, clientHeight: 300 }), -120), false);
  assert.equal(consumesWheel(layer({ scrollTop: 50, scrollHeight: 280, clientHeight: 300 }), 120), false);
});

test('🔴 滚到**边界** ⇒ 吃不掉（「滚到底了不要再往外传」那一条）', () => {
  const bottom = layer({ scrollTop: 200, scrollHeight: 500, clientHeight: 300 }); // max = 200
  assert.equal(consumesWheel(bottom, 120), false, '已经在底部，再往下没得滚');
  assert.equal(consumesWheel(bottom, -120), true, '往上还有');
  const top = layer({ scrollTop: 0, scrollHeight: 500, clientHeight: 300 });
  assert.equal(consumesWheel(top, -120), false, '已经在顶部');
  assert.equal(consumesWheel(top, 120), true);
});

test('🔴 **不是滚动容器**的层一律吃不掉（`hidden` / `visible` / `clip`）', () => {
  // `overflow: hidden` 的盒子裁内容但不给滚 —— 抽屉/浮窗的**根**就是这一类，
  // 所以滚轮落在标题栏、内边距上时，链上没有任何一层吃得下 ⇒ 守卫拦住。
  for (const overflowY of ['visible', 'hidden', 'clip', 'unset', '']) {
    assert.equal(consumesWheel(layer({ overflowY, scrollTop: 100 }), 120), false, `overflowY=${overflowY}`);
  }
  for (const overflowY of ['auto', 'scroll', 'overlay']) {
    assert.equal(consumesWheel(layer({ overflowY, scrollTop: 100 }), 120), true, `overflowY=${overflowY}`);
  }
});

test('🔴 链上任何一层吃得下就放手（不是一个都不行才拦）', () => {
  const chain = [layer({ scrollHeight: 300, clientHeight: 300 }), layer({ scrollTop: 100 })];
  assert.equal(chainConsumesWheel(chain, 120), true);
  assert.equal(chainConsumesWheel([chain[0]], 120), false);
  assert.equal(chainConsumesWheel([], 120), false, '空链 ⇒ 没人吃得下 ⇒ 拦');
});

test('🔴 **只有横向滚动**（`deltaY === 0`）一律放手 —— 拦了会让宽表格横向滚不动', () => {
  assert.equal(chainConsumesWheel([layer({ scrollHeight: 300, clientHeight: 300 })], 0), true);
  assert.equal(chainConsumesWheel([], 0), true);
});

test('🔴 清单里的**每一个类**都还在 globals.css 里（改名会让守卫静默失效）', () => {
  // 🔴 守卫靠类名找浮层根，而「类名被改名」的表现是**老毛病悄悄回来**（屏幕上什么都不报）。
  // ⇒ 这条用例去 CSS 里核一遍：清单里的每个类都必须还能找到一条 `.类名 {` 规则。
  // （`[data-overscroll-guard]` 那一支不查 —— 它标在内联样式的根上，不在 CSS 里。）
  const css = fs.readFileSync(path.resolve(HERE, '../app/globals.css'), 'utf8');
  const classes = FLOAT_ROOT_SELECTOR.split(',').map(s => s.trim()).filter(s => s.startsWith('.'));
  assert.ok(classes.length >= 5, `清单里的类太少了：${classes.length}`);
  classes.forEach((selector) => {
    const esc = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ⚠️ 那个前导的 `\\.` 不能省：少了它，`modal-overlay` 也能在别处（比如变量名、
    //    注释）命中，用例就成了**假绿** —— 我自己第一版就是这么写错的。
    // ⚠️ 允许它出现在选择器列表里（`a, .b {`）或单独一行（`.b {`）。
    const asSelector = new RegExp(`(^|[,{])\\s*\\.${esc}\\s*(,|\\{)`, 'm');
    assert.ok(asSelector.test(css), `globals.css 里找不到 ${selector} —— 是不是被改名了？`);
  });
});
