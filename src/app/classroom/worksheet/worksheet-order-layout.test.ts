/**
 * ★ 2026-10-08（教师）：「（顺序高手）这部分内容居中」。
 *
 * 🔴 根因不是"没写居中"，而是**两条同名规则打架**：
 *   `worksheet.module.css` 早先有一条 `.orderList { width: min(100%, 600px); margin: 12px auto 0 }`
 *   （注释就写着「排序作答区整体居中」），但文件后面**又**有一条
 *   `.orderList { … margin: 12px 0 0 … }` —— 左右 `auto` 被覆盖成 `0`，
 *   而早先那条给的 `width: min(100%, 600px)` 仍然生效
 *   ⇒ 最终是一个 **600px 宽、却贴着题卡左边缘**的列。
 *
 * ⚠️ 所以判据必须按「**所有**同名块里最后声明 margin 的那一条」来读，不能读第一块 ——
 *   第一块恰恰是写对了的那条（读它会永远绿）。这与 `worksheet-categorize-layout.test.ts`
 *   踩过的坑是同一个（那一次是 `.zoneGrid` 的 gap 有覆盖块）。
 *
 * ⚠️ 本仓没有 jsdom、没有浏览器 ⇒「屏幕上真的居中了吗」在本机**验不了**。
 *   这条网只能回答「那几条声明在不在、谁覆盖谁」。真实观感仍需真机走查。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 先剥注释：新加的注释里逐字写着旧写法（`margin: 12px 0 0`），不剥会被自己的注释命中。 */
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** 某条选择器的**全部**声明块（同名覆盖块都要拿到手，按源序）。 */
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

/** 把同名块按源序叠一遍，取某个属性**最终生效**的值（后写的赢）。 */
function effective(bodies: string[], property: string): string | null {
  let value: string | null = null;
  for (const body of bodies) {
    const matched = body.match(new RegExp(`${property}:\\s*([^;]+);`));
    if (matched) value = matched[1].trim();
  }
  return value;
}

test('阳性对照：这条网真的在读那个 CSS，且拿得到 `.orderList` 的块', () => {
  assert.ok(ruleBodies('.orderList').length > 0, 'CSS 里一条 .orderList 都没找到');
  assert.ok(ruleBodies('.orderRow').length > 0, 'CSS 里一条 .orderRow 都没找到');
});

test('★ 整列水平居中：最终生效的左右外边距必须是 auto（不是 0）', () => {
  const bodies = ruleBodies('.orderList');
  assert.ok(bodies.length >= 2,
    '`.orderList` 只剩一条规则了？那条覆盖块要么被合并、要么被删 —— 请重新核对本判据的前提');

  const margin = effective(bodies, 'margin');
  assert.notEqual(margin, null, '`.orderList` 完全没有声明 margin');
  assert.match(margin!, /\bauto\b/,
    '`.orderList` 最终生效的 margin 里没有 auto ⇒ 又贴回左边缘（这就是教师说的"不居中"）');
});

test('★ 居中的是那条 600px 的列（宽度来源仍在早先那条规则里，别以为居中只靠一行）', () => {
  const bodies = ruleBodies('.orderList');
  assert.ok(
    bodies.some((body) => /width:\s*min\(100%,\s*600px\)/.test(body)),
    '没有 `width: min(100%, 600px)` ⇒ 列会通栏，居中就没有意义了',
  );
  const row = effective(ruleBodies('.orderRow'), 'max-width');
  assert.equal(row, '600px', '行的 max-width 不再是 600px（居中对象的宽度变了）');
});
