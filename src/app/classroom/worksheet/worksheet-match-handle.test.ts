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

test('③ 半圆凸起朝向另一列，且包含实心圆点', () => {
  assert.equal(effective(ruleBodies('.matchHandle'), 'width'), '12px');
  assert.equal(effective(ruleBodies('.matchHandle'), 'height'), '12px');
  assert.equal(effective(ruleBodies('.matchHandle'), 'box-sizing'), 'border-box');
  assert.equal(effective(ruleBodies('.matchColumnLeft .matchHandle::before'), 'border-left'), '0');
  assert.equal(effective(ruleBodies('.matchColumnRight .matchHandle::before'), 'border-right'), '0');
  assert.equal(effective(ruleBodies('.matchHandle::after'), 'border-radius'), '50%');
  assert.ok(effective(ruleBodies('.matchHandle::after'), 'background'));
});

test('③ 已连接和跟手线共用实际句柄圆心，尺寸改变不会使连线偏离', () => {
  assert.match(BODY, /querySelector<HTMLElement>\('\[data-match-handle\]'\)/);
  assert.match(BODY, /rect.left \+ rect.width \/ 2/);
  assert.match(BODY, /rect.top \+ rect.height \/ 2/);
  assert.match(BODY, /const a = connectionPoint\(el\)/);
  assert.match(BODY, /const a = connectionPoint\(leftEl\)/);
  assert.match(BODY, /const b = connectionPoint\(rightEl\)/);
  assert.equal((BODY.match(/data-match-handle aria-hidden/g) ?? []).length, 2);
});

test('④ 拖动源仍是**整条**条目（没被收窄成只给句柄）', () => {
  const both = BODY.match(/drag\.bothProps\(entry\.id\)/g) ?? [];
  assert.equal(both.length, 2, `两列各应挂一次 bothProps，实际 ${both.length} 处`);
  assert.ok(!/drag\.sourceProps\(entry\.id\)/.test(BODY),
    '拖动源被改成只给句柄了 ⇒ 整条条目按下去不再能拖（老 iPad 上更难命中）');
});
