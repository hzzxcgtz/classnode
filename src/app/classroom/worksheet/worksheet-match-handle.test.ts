/**
 * ★ 2026-10-08（教师）：「这部分区域**左右也不要顶格**，留出一定的空白区域，左侧框的右端和
 *   右侧框的左端可以增加一个**连接句柄**（例如小圆），增加连线题的操作识别度。」
 *
 * 🔴 这一条网钉的**不是**"有没有画个圆"，而是**三个容易做错的前提**：
 *   ① 句柄是条目的**子元素**且**有**指针事件 —— 否则按在圆点起拖会掉进 6px 的死区，
 *      而这件事在屏幕上完全看不出来（"圆点看着能拖，拖不动"）；
 *   ② 圆心的 `right/left: -6px` 与 `box-sizing: border-box` 是**一对** ——
 *      少了后者就是 content-box，直径变成 16px，圆心偏 2px，线就不从圆心出发了；
 *   ③ 线的端点仍取 `a.right` / `a.left`（左列右缘 / 右列左缘）—— 圆心要落在那条边上。
 *      哪天有人把测量改成从别处取，圆心与线端点就会分家，而**没有任何报错**。
 *
 * ⚠️ 本机没有 jsdom/浏览器 ⇒「真的居中了没有」验不了，只能钉"那几条声明在不在"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = fs.readFileSync(path.join(HERE, 'questions', 'match-body.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 某条选择器的全部声明块（同名覆盖块都拿到，后写的赢）。 */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let cursor = 0;
  for (;;) {
    const at = CSS.indexOf(`\n${selector} {`, cursor);
    if (at < 0) break;
    const open = CSS.indexOf('{', at);
    const close = CSS.indexOf('}', open);
    if (close < 0) break;
    bodies.push(CSS.slice(open + 1, close));
    cursor = close;
  }
  return bodies;
}

function effective(bodies: string[], property: string): string | null {
  let value: string | null = null;
  for (const body of bodies) {
    const matched = body.match(new RegExp(`${property}:\\s*([^;]+);`));
    if (matched) value = matched[1].trim();
  }
  return value;
}

test('① 左右两列不顶格：中间留白加宽、两侧留出内边距', () => {
  const gap = effective(ruleBodies('.matchGrid'), 'gap');
  assert.ok(gap !== null, '.matchGrid 没有声明 gap —— 两列会贴在一起');
  const gapPx = Number((gap.match(/^(\d+)px$/) ?? [])[1]);
  assert.ok(Number.isFinite(gapPx) && gapPx >= 96,
    `两列之间的留白只有 ${gap}（教师要求"留出一定的空白区域"）`);
  const padding = effective(ruleBodies('.matchGrid'), 'padding');
  assert.match(padding ?? '', /0 12px/,
    `两侧没有留出内边距（${padding}）⇒ 条目仍然顶到题卡边缘`);
});

test('② 两列各有句柄，且句柄是**条目的子元素**', () => {
  assert.match(BODY, /styles\.matchColumnLeft/, '左列没有区分用的类 ⇒ 句柄不知道该摆哪一端');
  assert.match(BODY, /styles\.matchColumnRight/, '右列没有区分用的类');
  const handles = BODY.match(/styles\.matchHandle/g) ?? [];
  assert.equal(handles.length, 2, `句柄出现了 ${handles.length} 次（两列各一次才对）`);
  /*
   * 🔴 掉进死区的那个错法：句柄**不写在条目的 div 里** ⇒ 按在圆点上的事件不会冒泡给条目，
   *   而屏幕上完全看不出来（"圆点看着能拖、拖不动"）。
   * ⚠️ 判据要取「条目的开标签」到「它自己的闭合 `</div>`」之间那一段 ——
   *   `bothProps` 在**开标签里**，所以不能拿它当"子元素之前"的分界（第一版就是这么写错的）。
   */
  const openTag = 'bothProps(entry.id)}>';
  let from = 0;
  for (const column of ['左列', '右列']) {
    const at = BODY.indexOf(openTag, from);
    assert.notEqual(at, -1, `${column}找不到条目的开标签`);
    const close = BODY.indexOf('</div>', at);
    assert.notEqual(close, -1, `${column}找不到条目的闭合标签`);
    assert.match(BODY.slice(at, close), /styles\.matchHandle/,
      `${column}的句柄不是条目的子元素 ⇒ 按在圆点上的事件不会冒泡给条目（看着能拖、拖不动）`);
    from = close;
  }
});

test('② 句柄**有**指针事件（写了 pointer-events: none 就会掉进点不动的死区）', () => {
  const bodies = ruleBodies('.matchHandle');
  assert.ok(bodies.length > 0, 'CSS 里没有 .matchHandle');
  for (const body of bodies) {
    assert.ok(!/pointer-events:\s*none/.test(body),
      '句柄被关掉了指针事件 ⇒ 圆点外半圈那 6px 按下去什么都不会发生（看着能拖、拖不动）');
  }
});

test('③ 圆心落在条目连接的那条边上：直径 6px + 偏移 −3px 是一套', () => {
  const bodies = ruleBodies('.matchHandle');
  assert.equal(effective(bodies, 'box-sizing'), 'border-box',
    '少了 border-box ⇒ 一旦将来加回描边，`width` 就不再等于实际直径，圆心会偏');
  // ★ 2026-10-08 第二批（教师）：「这个圈太大了，要小一点」→ 12px ⇒ 8px；
  //   「圈还要再小，变成实心的」→ 8px ⇒ 6px。
  assert.equal(effective(bodies, 'width'), '6px', '直径不是 6px');
  assert.equal(effective(bodies, 'height'), '6px', '高度不是 6px');
  // ⚠️ 圆心 = 直径/2 ⇒ −3px。**这两个数是一对**：改一个不改另一个，圆心就不在条目边缘上，
  //   而线仍然从边缘出发 ⇒ 圆点与线分家，屏幕上像个没对齐的小装饰，且没有任何报错。
  assert.match(effective(ruleBodies('.matchColumnLeft .matchHandle'), 'right') ?? '', /^-3px$/,
    '左列句柄的 right 不是 −3px ⇒ 圆心不在条目的右缘上（线的端点在那儿）');
  assert.match(effective(ruleBodies('.matchColumnRight .matchHandle'), 'left') ?? '', /^-3px$/,
    '右列句柄的 left 不是 −3px ⇒ 圆心不在条目的左缘上');
  assert.equal(effective(ruleBodies('.matchItem'), 'position'), 'relative',
    '.matchItem 不是 relative ⇒ 绝对定位的句柄会相对更外层的祖先摆，位置全错');
});

test('③ 句柄是**实心**的（教师：「变成实心的」）', () => {
  const bodies = ruleBodies('.matchHandle');
  // 实心 = 用强调色填满。⚠️ 原来是"白底 + 2px 描边"的**空心**环。
  assert.match(effective(bodies, 'background') ?? '', /var\(--ws-accent\)/,
    '句柄不是用强调色实心填充 ⇒ 还是空心环');
  const border = effective(bodies, 'border');
  assert.ok(border === '0' || border === 'none',
    `句柄还带着描边（border: ${border}）—— 实心圆不需要描边，且描边会让直径与 width 脱钩`);
});

test('③ 线的端点仍然取条目的连接那条边（改了这里，圆心与线就会分家且不报错）', () => {
  const measureAt = BODY.indexOf('const measure = useCallback(');
  assert.notEqual(measureAt, -1, '找不到 measure');
  const measure = BODY.slice(measureAt, BODY.indexOf('setLines(next)', measureAt));
  assert.match(measure, /a\.right - base\.left/, '左列的线不再从左缘取点');
  assert.match(measure, /b\.left - base\.left/, '右列的线不再从右项左缘取点');
});

test('④ 拖动源仍是**整条**条目（没被收窄成只给句柄）', () => {
  const both = BODY.match(/drag\.bothProps\(entry\.id\)/g) ?? [];
  assert.equal(both.length, 2, `两列各应挂一次 bothProps，实际 ${both.length} 处`);
  assert.ok(!/drag\.sourceProps\(entry\.id\)/.test(BODY),
    '拖动源被改成只给句柄了 ⇒ 整条条目按下去不再能拖（老 iPad 上更难命中）');
});
