/**
 * ★ 2026-10-05（教师）：「三个容器框横向排列」。
 *
 * 归类题（学生端 `questions/categorize-body.tsx`）的框排在 `.zoneGrid` 里。原来那一版是
 * `display: flex` + `.zone { flex: 1 1 44% }` ⇒ **无论多宽都只排两列**，第三个框孤零零占满
 * 一整行（教师给的截图就是这个形状：透明、半透明并排，「不透明」另起一行、通栏）。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「屏幕上真的并排了吗」在本机**验不了**。
 *    这一条网能回答的只有：**那几条布局声明在不在**（与 `worksheet-tap-targets.test.ts`
 *    同一路数）—— 它不保证观感（列宽、换行点、长条目的折行）那些只能真机走查。
 *
 * ⚠️ 这个 CSS 文件里有**同名的覆盖块**（`.zoneGrid { gap: 22px; }` 出现过两次：早一版与
 *    晚一版的覆盖段）。所以判据是「**所有**同名块里……」而不是「第一块里……」——
 *    拿第一块当依据会读到那条只改 gap 的覆盖块，断言就永远绿/永远红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * ⚠️ **先剥掉 `/* … *\/` 注释**再找规则块：这一版新加的注释里就写着旧写法
 *    （`flex: 1 1 44%`、`{ … }` 那种字面量），不剥的话①按第一个 `}` 截块会被注释里的
 *    花括号截断，②「反面」断言会被自己的注释命中。
 */
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = fs.readFileSync(path.join(HERE, 'questions', 'categorize-body.tsx'), 'utf8');

/** 某条选择器的**全部**声明块（同名覆盖块都要拿到手）。 */
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

test('阳性对照：这条网真的在读那两个文件，且拿得到 `.zoneGrid` 的块', () => {
  assert.ok(BODY.includes('styles.zoneGrid'), '归类题的作答体没有用 zoneGrid');
  assert.ok(ruleBodies('.zoneGrid').length > 0, 'CSS 里一条 .zoneGrid 都没找到');
});

test('🔴 框是**网格**排的：这一行放得下几个就放几个（不再是「永远两列」的 flex）', () => {
  const bodies = ruleBodies('.zoneGrid');
  assert.ok(
    bodies.some((body) => /display:\s*grid/.test(body)),
    '没有任何一条 .zoneGrid 用网格排 —— 那就还是「无论多宽都只排两列」（第三个会通栏）',
  );
  assert.ok(
    bodies.some((body) => /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/.test(body)),
    '列数不是「按可用宽度自动排」—— 写死列数会在窄屏把框压成一条',
  );
  // 🔴 反面：`display: flex` + `flex: 1 1 44%` 是**旧口径**（两列）。
  for (const body of bodies) {
    assert.ok(!/display:\s*flex/.test(body), '`.zoneGrid` 又用 flex 排了 —— 那就是「永远两列」');
  }
  assert.ok(!/flex:\s*1 1 44%/.test(CSS), '`.zone { flex: 1 1 44% }` 又回来了 —— 那就是「永远两列」');
});

test('🔴 网格子项 `min-width: 0`（不然一个长条目会把那一列撑破）', () => {
  const bodies = ruleBodies('.zone');
  assert.ok(bodies.length > 0, '找不到 .zone 的规则块');
  // grid 子项的默认 `min-width: auto` = 「由内容决定列宽」⇒ 长条目撑破列、把邻居挤窄。
  assert.ok(
    bodies.some((body) => /min-width:\s*0/.test(body)),
    '`.zone` 少了 `min-width: 0`：长条目会撑破那一列',
  );
});
