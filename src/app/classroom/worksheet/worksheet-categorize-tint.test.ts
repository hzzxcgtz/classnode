/**
 * ★ 2026-10-08（教师）：「这些文字块可以设计得好看一些，比如**不带边框、带底纹色**的文字，
 *   放到不同容器后会有相应的变化。」（教师选定：**跟着容器染不同的色**。）
 *
 * 🔴 这一条网必须**同时**钉三层，少一层就会假绿：
 *   ① 纯函数层 —— 第 N 个框取哪一档色、循环、以及坏输入不炸（真单元测试，能喂值）；
 *   ② 接线层 —— 条目块的色**必须由调用方传入**（池子一档、每个框一档），
 *      而不是写死一个色，也不是让容器继承下来（那样色有两个来源，不一致时不报错）；
 *   ③ CSS 层 —— 边框真的去掉了、底色真的读的是那个变量、选中态改成不依赖边框的 inset 环。
 *   ⚠️ 只钉 ③ 会漏掉"三处调用点都传了同一个色"这种错；只钉 ① 会漏掉"根本没接上"。
 *
 * ⚠️ CSS 那部分必须按「**所有**同名块里最后声明的那一条」读：`.poolItem` 在
 *   `worksheet.module.css` 里有**四处**定义（基础 + 两处覆盖段），读第一块会永远绿。
 *   同一个坑 `worksheet-categorize-layout.test.ts` 与 `worksheet-order-layout.test.ts` 各踩过一次。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIZE_POOL_TINT,
  CATEGORIZE_ZONE_TINTS,
  zoneTint,
} from '../../../lib/worksheet-categorize-tint.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = fs.readFileSync(path.join(HERE, 'questions', 'categorize-body.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

// ── ① 纯函数层 ──────────────────────────────────────────────────────────────

test('① 每个框按序号取一档色，且**循环**（框比色多时不会取到 undefined）', () => {
  assert.ok(CATEGORIZE_ZONE_TINTS.length >= 2, '配色表少于两档 ⇒ 两个框会长得一样');
  assert.equal(zoneTint(0), CATEGORIZE_ZONE_TINTS[0]);
  assert.equal(zoneTint(1), CATEGORIZE_ZONE_TINTS[1]);
  assert.equal(zoneTint(CATEGORIZE_ZONE_TINTS.length), CATEGORIZE_ZONE_TINTS[0],
    '序号超出配色表长度后没有绕回来 ⇒ 第 N+1 个框没有颜色');
  assert.equal(zoneTint(CATEGORIZE_ZONE_TINTS.length * 3 + 2), CATEGORIZE_ZONE_TINTS[2],
    '绕回来的取模算错了');
});

test('① 配色表本身：都是合法十六进制色、且互不相同', () => {
  for (const tint of CATEGORIZE_ZONE_TINTS) {
    assert.match(tint, /^#[0-9a-f]{6}$/i, `不是合法的六位十六进制色：${tint}`);
  }
  assert.equal(new Set(CATEGORIZE_ZONE_TINTS).size, CATEGORIZE_ZONE_TINTS.length,
    '配色表里有重复色 ⇒ 两个框会染成同一个颜色，"跟着容器变"就看不出来了');
  assert.ok(!CATEGORIZE_ZONE_TINTS.includes(CATEGORIZE_POOL_TINT),
    '池子的中性色混进了框的配色表 ⇒ 某个框会与"待归类"长得一样');
});

test('① 坏输入不炸、也不返回 undefined（一个坏序号不该让整块作答区渲染不出来）', () => {
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(zoneTint(bad), CATEGORIZE_ZONE_TINTS[0], `坏输入 ${bad} 没有回落到第一档`);
  }
});

// ── ② 接线层 ────────────────────────────────────────────────────────────────

test('② 条目块的色**由调用方传入**（必填），不是写死、也不靠容器继承', () => {
  assert.match(BODY, /const chip = \(itemId: string, tint: string\) =>/,
    '② chip 没有接一个 tint 参数 ⇒ 要么写死了颜色，要么靠继承（两个来源不一致时不报错）');
  assert.match(BODY, /'--categorize-tint': tint/,
    '② 算出来的 tint 没有下到 CSS 变量上');
});

test('② 池子给中性色、每个框给自己的那一档 —— 两处调用点都要接上', () => {
  assert.match(BODY, /pool\.map\(\(entry\) => chip\(entry\.id, CATEGORIZE_POOL_TINT\)\)/,
    '② 池子里的条目没有用中性色');
  assert.match(BODY, /zones\.map\(\(zone, zoneIndex\) => \{/,
    '② zones.map 没有取到序号 ⇒ 拿不到按框分配的色');
  assert.match(BODY, /inside\.map\(\(entry\) => chip\(entry\.id, zoneTint\(zoneIndex\)\)\)/,
    '② 框里的条目没有按所在框取色 —— 这正是教师那条"放到不同容器后会有相应的变化"');
  // 反面：三处都给同一个写死的色，就退化成"只去边框、不变色"
  assert.doesNotMatch(BODY, /chip\(entry\.id, '#/, '② 调用点写死了颜色，没有走配色表');
});

// ── ③ CSS 层 ────────────────────────────────────────────────────────────────

test('③ 条目块：真的没有边框了，底色真的读的是那个变量', () => {
  const bodies = ruleBodies('.poolItem');
  assert.ok(bodies.length > 0, '找不到 .poolItem 的规则块');
  const border = effective(bodies, 'border');
  assert.ok(border === '0' || border === 'none',
    `③ .poolItem 最终生效的 border 是「${border}」⇒ 教师说的"不带边框"没做到`);
  const background = effective(bodies, 'background');
  assert.match(background ?? '', /var\(--categorize-tint/,
    `③ .poolItem 最终生效的 background 是「${background}」⇒ 底纹没有跟着容器走`);
});

test('③ 选中态不靠边框（边框已去掉，只改 border-color 会完全看不见）', () => {
  const bodies = ruleBodies('.poolItemSelected');
  assert.ok(bodies.length > 0, '找不到 .poolItemSelected');
  const shadow = effective(bodies, 'box-shadow');
  assert.match(shadow ?? '', /inset/,
    '③ 选中态没有不依赖边框的可见指示（inset 环）⇒ 去掉边框后选中"没有反应"');
});

test('③ 词块高度一样：行不被拉伸（align-content: flex-start）', () => {
  /*
   * ★ 2026-10-08 第二批（教师）：「**每个词块的高度要一样**」。
   *
   * 🔴 根因**不在条目自己**（六枚的 `min-height` / `padding` 完全一样），
   *   而是两层 flex/grid 的默认值叠出来的形状 —— 我在无头 Chrome 里**量过**（不是读代码猜）：
   *     修前：透明 H=145 → items 70,70 ｜ 半透明 H=145 → items 70 ｜ 不透明 H=145 → items 44,44,44
   *     修后：六枚一律 44
   *   · `.zoneGrid` 是 **grid**（默认 `align-items: stretch`）⇒ 三个框被拉成等高；
   *   · `.zone` 是 **`flex-wrap` 多行容器**，`align-content` 默认 `normal`（多行时等同 stretch）
   *     ⇒ **只有一行**的框里那一行被拉满整个框高，条目跟着撑高；两行的框各分一半 ⇒ 保持自然高度。
   *   ⇒ 所以"同一个样式、框里有几行"就决定了条目多高。
   *
   * ⚠️ 不能改成 `align-items: flex-start`：那会让同一行里长短不一的条目也各高各的，
   *   而"同一行内互相等高"是**对的**、要保留。
   */
  for (const selector of ['.zone', '.pool']) {
    const bodies = ruleBodies(selector);
    assert.ok(bodies.length > 0, `找不到 ${selector} 的规则块`);
    /*
     * ⚠️ 断言消息必须**带上实际值**。第一版写的是"行仍会被拉伸 ⇒……"，而它第一次红的
     *   真实原因完全不同：我那条 CSS 写成了**选择器列表**（`.pool,\n.zone {`），
     *   而 `ruleBodies` 按 `\n选择器 {` 匹配 ⇒ **找不到**那条覆盖规则，
     *   于是取到的是基础 `.pool`（没写 `align-content`）⇒ effective 是 null。
     *   消息说"仍会被拉伸"，而事实是"根本没读到那条规则" —— 假红一样会骗人。
     *   ⇒ 那条 CSS 已拆成两条独立规则；这里把实际值打进消息。
     */
    const actual = effective(bodies, 'align-content');
    assert.equal(actual, 'flex-start',
      `${selector} 的 align-content 实际是「${actual}」`
      + '（应为 flex-start；若为 null，先怀疑判据没读到那条覆盖规则，而不是样式没写）');
  }
});
