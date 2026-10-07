/**
 * ★ 2026-10-07：四个几何记号的**接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-math-shapes.test.ts`：那几条证的是"几何算得对"。
 *   而**画板愿不愿意接**是另一件事 —— 把 renderEntry 的四个分支删掉，
 *   那几条照样全绿，而学生点了工具什么都没画出来。本机看不见界面。
 *
 * 🔴🔴 **这个文件在整分支复核时被指出过一条假绿，改过之后才写成现在这样**：
 *   `SOURCE.includes("entry.kind === 'angleArc'")` 全文件搜 —— 而**同一串在
 *   `snapshot()` 里也出现** ⇒ 把 `renderEntry` 那一整支删掉都照样绿。
 *   ⇒ 凡是钉 `renderEntry` 的，一律切出**那一段**再断言（`RENDER_ENTRY`）。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时画出来什么样。
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

/** 按起止串切一段出来（断言要落在**这一段**里，不许全文件搜）。 */
function section(from: string, to: string): string {
  const at = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to);
  assert.ok(at !== -1 && end !== -1 && at < end, `切不出这一段：${from} → ${to}`);
  return SOURCE.slice(at, end);
}
const RENDER_ENTRY = section('const renderEntry = ', 'const clearAll = ');
const APPLY_SELECTION = section('const applySelection = ', 'const pushHistory = ');

test('★ renderEntry 画得出四种新形状（逐个点名，**只在 renderEntry 那一段里找**）', () => {
  for (const kind of ["entry.kind === 'equalMark'", "entry.kind === 'parallelMark'",
    "entry.kind === 'rightAngle'", "entry.kind === 'angleArc'"]) {
    assert.ok(RENDER_ENTRY.includes(kind), `renderEntry 不画 ${kind}`);
  }
});

test('★ buildEntry 认四个新工具，且**顶点都在第二下**（两个三击记号同一种顺序）', () => {
  for (const tool of ["case 'equalMark'", "case 'parallelMark'", "case 'rightAngle'", "case 'angleArc'"]) {
    assert.ok(SOURCE.includes(tool), `buildEntry 不认 ${tool}`);
  }
  // 三次点击的顺序统一是 [a, vertex, b]：`ats[1]` 才是顶点。
  assert.match(SOURCE, /rightAngleOf\(ats\[1\], ats\[0\], ats\[2\]\)/, '直角的顶点取的不是第二下');
  assert.match(SOURCE, /arcPathOf\(ats\[1\], ats\[0\], ats\[2\]\)/, '角弧的顶点取的不是第二下');
});

test('★ 画板里**不许**自己再推一遍几何（两个渲染端必须同源）', () => {
  for (const fn of ['equalMarkOf(', 'parallelMarkOf(', 'rightAngleOf(', 'arcPathOf(']) {
    assert.ok(SOURCE.includes(fn), `画板没有走纯函数 ${fn}`);
  }
  // 反面：画板里不许出现手写的三角函数（那就是第二份算法）。
  assert.ok(!/Math\.atan2\(/.test(SOURCE), '画板里在算角度 —— 应当在 worksheet-math-shapes.ts 里算');
});

test('★ 读得回来 + 存得回去 + 度数输入框', () => {
  for (const kind of ["row.kind === 'equalMark'", "row.kind === 'parallelMark'",
    "row.kind === 'rightAngle'", "row.kind === 'angleArc'"]) {
    assert.ok(SOURCE.includes(kind), `readEntries 不认 ${kind}`);
  }
  // 角弧有可拖的三个点 ⇒ snapshot 必须按**拖动后的位置**存回去，
  // 少这一支的表现是"拖了一下，松手又弹回去"，而且不报错。
  assert.match(SOURCE, /kind: 'angleArc',[\s\S]{0,200}item\.points\[1\]/, 'snapshot 没有按拖动后的位置存角弧');
  assert.match(SOURCE, /aria-label="要标的角度"/, '角弧没有度数输入框');
});

/**
 * 🔴 2026-10-07 整分支复核抓到的两条 Critical 里，有一条就是这个忘了加：
 *   `board.create('polyline', …)` —— jsxgraph 里**没有** `polyline` 这个元素名。
 *   `board.create` 找不到就 **throw**，而 `handleDown` 挂在 `board.on('down')` 上、
 *   `EventEmitter.trigger` 的 `suspended[evt] = false` **不在 finally 里**
 *   （`src/utils/event.js:71-81`）⇒ 抛一次之后那块画板**不再派发 down**
 *   ⇒ 所有点类工具**静默失效**。而当时 31 条判据全绿。
 *
 * ⇒ 这条判据的做法与本仓「思维导图工具条对拍库产物」同一条纪律：
 *   **把画板里用到的元素名逐个拿去问库**，而不是相信我记住的那个名字。
 */
test('★ 画板用到的每个 jsxgraph 元素名，都必须在库的注册表里（对拍库产物）', () => {
  // 从库的**源码**里收注册表：`registerElement("x", …)`。不用 import（node 下没有 DOM）。
  const root = path.resolve(HERE, '..', '..', '..', '..', '..', '..', 'node_modules', 'jsxgraph', 'src');
  assert.ok(fs.existsSync(root), `找不到 jsxgraph 源码：${root}（依赖布局变了就更新这条路径）`);
  const registered = new Set<string>();
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.endsWith('.js')) {
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/registerElement\(\s*["']([a-z0-9]+)["']/g)) {
          registered.add(m[1]);
        }
      }
    }
  };
  walk(root);
  // 阳性对照：注册表本身读到了东西（读成空集的话下面那条对空集永远绿）。
  assert.ok(registered.size > 50, `只读到 ${registered.size} 个元素名 —— 扫描本身坏了`);
  assert.ok(registered.has('polygon') && registered.has('curve') && registered.has('image'),
    '注册表里连 polygon/curve/image 都没有 —— 扫描本身坏了');
  assert.ok(!registered.has('polyline'), '这条判据的前提变了：库现在真的有 polyline 了（那就把它当成合法元素）');

  const used = new Set<string>();
  for (const m of SOURCE.matchAll(/board\.create\(\s*'([A-Za-z0-9]+)'/g)) used.add(m[1]);
  assert.ok(used.size >= 5, `只扫到 ${used.size} 个 board.create —— 正则没匹配上`);
  for (const name of used) {
    assert.ok(registered.has(name), `画板用了 jsxgraph 里不存在的元素名 '${name}' —— 它会 throw，并把整块画板的 down 事件带死`);
  }
});

/**
 * 🔴 也是复核抓到的：拖动改的是 `item.points`，而 `item.entry` 是**创建时**那份。
 *   用 `item.entry` 重画 ⇒ 拖过的图形弹回原位，此后任何一次 `publish()` 把弹回后的
 *   坐标写回作答 ⇒ **拖动永久丢失**（屏幕上只是"弹了一下"）。
 *   这一版把「拖端点」变成唯一的微调手势，所以这条老代码第一次成为主路径；
 *   Spec §六-5 的真机走查项写的就是「点它一下 → 端点出现且**能拖**」。
 */
test('★ 重画必须按 `snapshot()`（画板上现在的坐标），不许用创建时那份 `item.entry`', () => {
  assert.ok(APPLY_SELECTION.length > 0, '切不出 applySelection');
  assert.match(APPLY_SELECTION, /renderAll\(snapshot\(\)\)/,
    'applySelection 用创建时那份 entry 重画 ⇒ 拖过的端点会弹回');
  assert.ok(!/renderAll\(runtime\.current\.map/.test(SOURCE),
    '还有地方在用 `runtime.current.map((item) => item.entry)` 重画（拖过的图形会弹回）');
  // 「删除选中」那一支同理。
  const del = section('deleteSelectedRef.current = ', 'undoRef.current = ');
  assert.match(del, /snapshot\(\)\.filter\(/, '「删除选中」用创建时那份 entry 重画 ⇒ 拖过的图形会弹回');
});

/**
 * 🔴 复核抓到的：jsxgraph 对"坐标数组建出来的线/曲线"默认 `isDraggable = true`。
 *   三个记号 `points: []`（没有抓手）但**仍然抓得住**，而 `snapshot()` 对这三个 kind
 *   落到最后的 `return entry`（位移不进数据）⇒ **拖了不记住**：
 *   屏幕上挪走了，中间那张快照（**教师与 AI 看到的就是它**）里是挪过的位置，
 *   而下一次重画又弹回来。
 * ⚠️ 锁住**不影响选中**：`getAllObjectsUnderMouse` 只看可见性、`hasPoint` 不看 `fixed`。
 */
test('★ 三个记号不许被拖动（拖了不记住 —— 位移不进数据，快照与重画会对不上）', () => {
  // ⚠️ 按分支切：`split` 之后每一段**就是一个分支的全部**（分隔符被吃掉了）。
  //   别再去 `indexOf('return { entry, points')` 截一刀 —— 分支里**前面**就有一句
  //   `if (!tick) return { entry, points: [], objects: [] };`（退化时的空返回），
  //   那样切出来的 body 跑在 `create(...)` **之前**，断言永远红（我第一版就是这么写错的）。
  const branches = RENDER_ENTRY.split(/if \(entry\.kind === /).slice(1);
  for (const kind of ['equalMark', 'parallelMark', 'rightAngle']) {
    const chunk = branches.find((item) => item.startsWith(`'${kind}'`));
    assert.ok(chunk, `renderEntry 不画 ${kind}`);
    assert.match(chunk, /fixed: true/, `${kind} 没有 fixed: true ⇒ 学生能拖走它，而拖了不记住`);
  }
});
