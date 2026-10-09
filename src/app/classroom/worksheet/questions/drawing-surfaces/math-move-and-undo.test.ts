/**
 * ★ 2026-10-08（教师）两条：
 *   ① 「数学作图中的坐标系和数轴在画好后无法移动」——选中后应当能移动整块；
 *   ② 「数学作图中的撤销要可以使用快捷键」。
 *
 * 🔴 ① 的根因值得写下来：整体平移那条路（`onPolygonMoveDown`）原先只放行**闭合折线**
 *   （`kind === 'polyline' && closed`），而坐标系/数轴是另外两种 entry ⇒ 走不进来。
 *   它们唯一的"动"就是拖那两个**透明端点控制柄**，那是**改大小**、不是移动。
 *   放宽守卫就够，是因为那一组的轴线/刻度/文字**全部由闭包读 `a.X()/a.Y()/b.X()/b.Y()`
 *   的动态坐标算出**，而 `item.points` 恰好是 `[a, b]` ⇒ 平移这两点整组跟着走。
 *   ⚠️ 所以下面必须同时钉住「两种 kind 都放行」**和**「拖控制柄仍不放行」——
 *   少了后者，改大小会被平移吞掉，端点再也拖不动（而这一条不报错，只在真机上看得出来）。
 *
 * 🔴 ② 必须钉住**让位给输入框**：题干输入框与线上标注里，Cmd+Z 该走浏览器原生的
 *   「撤销打字」。抢过来会让学生在刚打的字里没法撤销 —— 流程图那条踩过这一次。
 *   还要钉住「撤销不需要先选中对象」（它与 Delete 的前置条件**不同**）。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时画出来什么样、也不证手感。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));

const bodyOf = (startMarker: string, endMarker: string) => {
  const at = SOURCE.indexOf(startMarker);
  assert.notEqual(at, -1, `找不到 ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, at);
  assert.notEqual(end, -1, `找不到 ${endMarker}（在 ${startMarker} 之后）`);
  return SOURCE.slice(at, end);
};

test('★ ① 坐标系与数轴也能整体平移（原先只有闭合折线走得进这条路）', () => {
  const body = bodyOf('const onPolygonMoveDown = (event: PointerEvent) =>', 'const onPolygonMove = (event: PointerEvent)');

  // 放行：闭合折线、坐标系、数轴三种 —— 少一种那个工具就还是"画完动不了"。
  assert.match(body, /const movableOutline = entry\.kind === 'polyline'/,
    '① 平移的放行判据不再从 polyline 起算');
  assert.match(body, /entry\.kind === 'coordinateSystem' \|\| entry\.kind === 'numberLine'/,
    '① 坐标系/数轴没有进整体平移的放行名单 ⇒ 画完仍然无法移动');
  assert.match(body, /if \(!movableOutline/, '① 放行判据算出来了却没有被用上');

  // 反向对照：拖控制柄必须仍然**不**走平移，否则端点再也拖不动（改不了大小）。
  assert.match(body, /item\.points\.some\(\(point\) => point\.id === hit\.target\.id\)\) return/,
    '① 拖端点控制柄也被当成整体平移 ⇒ 坐标系/数轴再也改不了大小');
});

test('★ ① 平移是把同一份位移加给该对象的每一个点（坐标系/数轴只有 a、b 两点，够了）', () => {
  const body = bodyOf('const onPolygonMove = (event: PointerEvent) =>', 'const onPolygonMoveUp = () =>');
  assert.match(body, /pushHistory\(\)/, '① 开始平移前没有压撤销快照 ⇒ 移完撤不回去');
  assert.match(body, /movingItem\.points\.forEach/, '① 没有同步平移该对象的全部点');
  assert.match(body, /origin\[0\] \+ dx, origin\[1\] \+ dy/, '① 各点没有使用同一份位移量');
  // 数轴不会被平移弄歪：两个端点同 y，加同一个 dy 后仍水平。
  assert.match(body, /polygonMove\.moved = true/, '① 「已真正移动」的标记丢了 ⇒ 只点不拖也会上报');
});

test('★ ② Cmd/Ctrl+Z 绑定撤销，判据走共用的纯函数（不再内联正则）', () => {
  const body = bodyOf('const onKeyDown = (event: KeyboardEvent) =>', 'const onDragMove = (event: PointerEvent)');

  // 🔴 2026-10-08：第一版这里断言的是内联的 `target.tagName === 'INPUT'` 等字符串。
  //   变异检验当场证伪 —— 把表达式前面加个 `false &&` 短路掉，字符串**仍然在**，
  //   断言照样绿（假绿）。⇒ 判据抽进 `@/lib/keyboard-target.ts`（有真单元测试），
  //   这里只钉**接线**，语义由 `keyboard-target.test.ts` 喂形状来钉。
  assert.match(SOURCE, /import \{ isTypingTarget, isUndoShortcut \} from '@\/lib\/keyboard-target\.ts'/,
    '② 没有引共用判据 ⇒ 又回到内联正则那份（早晚与另一块画布分叉）');
  assert.match(body, /if \(labelEditorRef\.current !== null \|\| isTypingTarget\(event\.target\)\) return;/,
    '② 输入框让位没有接在共用判据上（或判据被短路掉了）');
  assert.match(body, /if \(isUndoShortcut\(event\)\) \{/,
    '② 撤销组合键没有接在共用判据上，或它的条件里被塞了额外前置条件');
  assert.match(body, /undoRef\.current\?\.\(\)/, '② 匹配到快捷键却没有真的调撤销');
});

test('★ ② 撤销不要求先选中对象；删除才要求（两者前置条件不同）', () => {
  const body = bodyOf('const onKeyDown = (event: KeyboardEvent) =>', 'const onDragMove = (event: PointerEvent)');
  // 变异检验里「把 selectedRef.current !== null 加到撤销分支前面」曾整条逃过网 ⇒ 这里按顺序钉死：
  // 撤销那一段必须**整体**出现在「必须有选中」那一步之前，且自己不带选中判断。
  const undoAt = body.indexOf('if (isUndoShortcut(event)) {');
  const deleteGate = body.indexOf('selectedRef.current === null');
  assert.notEqual(undoAt, -1, '② 找不到撤销分支');
  assert.notEqual(deleteGate, -1, '② 找不到「必须已选中」那道门');
  assert.ok(undoAt < deleteGate, '② 撤销被写在「必须有选中对象」之后 ⇒ 没选中时撤不了');
  assert.doesNotMatch(body.slice(undoAt, body.indexOf('}', body.indexOf('undoRef.current') + 1)),
    /selectedRef\.current/,
    '② 撤销分支里出现了选中判断 ⇒ 没选中对象时按 Cmd+Z 没反应');
});

test('★ ② 删除快捷键与焦点收口这两条既有行为不能被本次改动带跑', () => {
  assert.match(SOURCE, /event\.key !== 'Delete' && event\.key !== 'Backspace'/,
    '② 顺手改坏了 Delete / Backspace 的判据');
  assert.match(SOURCE, /selectedRef\.current === null\) return/, '② 没选中对象时仍会误删');
  assert.match(SOURCE, /hostEl\.addEventListener\('keydown', onKeyDown\)/,
    '② 撤销/删除快捷键没有收在当前数学画布内');
  assert.match(SOURCE, /hostEl\.removeEventListener\('keydown', onKeyDown\)/,
    '② 卸载后仍残留键盘监听');
});
