/**
 * ★ 2026-10-07（教师）：几何题原图当底图。
 *
 * 🔴 这份判据里最要紧的是**命中测试那三处**。jsxgraph 的 `Image.hasPoint` 是
 *   "点在矩形里就算"（我核过 `src/base/image.js:130`），而底图铺满整块画布 ⇒
 *   它会被**每一次点击**命中。后果：`handleDown`/`onDragDown` 的早退守卫
 *   （"点到既有图形就让内核去拖它"）**恒为真** ⇒ **所有绘图工具彻底失效**；
 *   「选择」的 hits[0] 也会是底图 ⇒ 永远选不中自己画的线。
 *   两种表现都是"什么都不发生、什么也不报"。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」。真机上"放大之后还贴不贴得住"另算（交给教师）。
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

test('★ 底图是画板对象（不是 CSS 背景），且压在最下面', () => {
  assert.match(SOURCE, /board\.create\('image',/, '底图没有建进画板 ⇒ 进不了快照');
  assert.match(SOURCE, /layer: -1/, '底图没有压到最下面（它会盖住学生的作答）');
  assert.ok(!/backgroundImage/.test(SOURCE), '底图还挂在 CSS 上 ⇒ 快照里没有它、也不跟缩放');
});

test('★ 底图走**同源 blob**（直接喂 URL 会让 canvas 被污染，快照静默全废）', () => {
  assert.match(SOURCE, /URL\.createObjectURL\(/, '没有把图取成 blob URL');
  assert.match(SOURCE, /URL\.revokeObjectURL\(/, 'blob URL 没有回收（每开一次题都漏一张图）');
});

test('★ 三处命中判断都滤掉底图（三处分别钉，合并成一条会漏）', () => {
  // ① 「选择」那一支
  const selectAt = SOURCE.indexOf("toolRef.current === 'select'");
  assert.notEqual(selectAt, -1, '找不到「选择」那一支');
  assert.match(SOURCE.slice(selectAt, selectAt + 300), /studentHitsUnderMouse\(event\)/,
    '「选择」还在用原始的命中列表 ⇒ hits[0] 是底图，永远选不中自己画的线');
  // ② 单击工具的早退守卫
  assert.match(SOURCE, /if \(studentHitsUnderMouse\(event\)\.length > 0\) return;/,
    '单击工具的守卫没滤底图 ⇒ 底图在场时每一次点击都不新建（所有绘图工具失效）');
  // ③ 拖动工具的早退守卫
  const dragAt = SOURCE.indexOf('const onDragDown = (event: PointerEvent) =>');
  assert.match(SOURCE.slice(dragAt, dragAt + 500), /studentHitsUnderMouse\(event\)/,
    '拖动工具的守卫没滤底图 ⇒ 线段/圆/长方形/铅笔都拖不出来');
  // 反面：原始调用只剩**过滤器内部**那一处。
  assert.equal((SOURCE.match(/getAllObjectsUnderMouse\(/g) ?? []).length, 1,
    '还有地方在直接用原始命中列表（应当只剩过滤器里那一处）');
});

test('★ 摆位走纯函数（画板里不许自己算比例）', () => {
  assert.match(SOURCE, /backgroundPlacement\(/, '画板没有走 backgroundPlacement');
});

/**
 * 🔴 下面三条都是**整分支复核抓出来的判据漏洞** —— 当时前面四条全绿，
 *   而两条 Critical 已经发到分支上了。记下来是为了下次别在同一个地方再漏。
 */

test('★ 底图的父参数是 **[锚点, 尺寸]**（不是两个角 —— 传成两个角图会缩成一半）', () => {
  /*
   * jsxgraph 要的是 `[url, 锚点(左下角), [宽, 高]]`：`src/base/image.js` 的类文档逐字写着
   * 「user coordinates of the **lower left corner**」+「`size` defines the image's
   * **width and height**」，构造里是 `this.W = createFunction(size[0])`。
   * 传两个角进去 ⇒ 宽高变成"右上角那两个数" ⇒ **图缩成一半、挤在左下角**，
   * 而屏幕上只是"图小了、偏了"（复核实测抓到的 Critical；换算的用例钉在
   * `worksheet-math-shapes.test.ts` 的「居中」那一条）。
   */
  assert.match(SOURCE, /const \{ anchor, size \} = backgroundPlacement\(/,
    '没有从 backgroundPlacement 取锚点与尺寸');
  assert.match(SOURCE, /board\.create\('image', \[objectUrl, anchor, size\]/,
    '底图的父参数不是 [url, 锚点, 尺寸] —— 传两个角进去图会缩成一半');
});

test('★ 过滤器**真的把底图滤掉了**（不是只留了一个调用点）', () => {
  /*
   * 反面：把过滤器改成 `.filter(() => true)`，上面那条「三处调用点 + 原始调用只剩一处」
   * 照样全绿 —— 而实际效果是学生**每一次点击**都被守卫挡掉、**所有点类工具失效**。
   * ⇒ 判据必须落在**过滤器体**上，不能只落在调用点上。
   */
  assert.match(SOURCE, /filter\(\(object\) => object !== backgroundObject\)/,
    '过滤器没有按身份滤掉底图');
  // 底图必须**锁住**：不锁的话学生能拖走老师给的图，而那个位移不进快照、也不进撤销栈。
  assert.match(SOURCE, /layer: -1,[\s\S]{0,300}?fixed: true/,
    '底图没有 fixed: true —— 学生会把老师给的图拖走');
});

test('★ `renderAll` 仍在挂载时**同步**执行（不许为了等底图挪到 await 后面）', () => {
  // Spec §六-1 的附加判据。挪到 await 后面的话，"重新打开一道题"会先看到一块空白画板。
  const asyncAt = SOURCE.indexOf('void (async () => {');
  const blockEnd = SOURCE.indexOf('})();', asyncAt);
  const syncAt = SOURCE.indexOf('renderAll(readEntries(data));');
  assert.notEqual(asyncAt, -1, '找不到取图那条 async 分支');
  assert.notEqual(syncAt, -1, '找不到 renderAll(readEntries(data))');
  assert.ok(syncAt > blockEnd, 'renderAll 排在那段取图**里面** —— 它会等底图回来才画学生的作答');
});
