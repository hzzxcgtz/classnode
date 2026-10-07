/**
 * 画板**交出作答**与**抓快照**这两件事的接线（★ 2026-10-07 教师）。
 *
 * 教师：「初始图里的绘图元素**一开始都没有显示出来**。当我移动其中的一个，它才会显示。
 * 比如说，有 4 个图形的话，我要去移动，这 4 个图形才会在监控面板里都显示出来」。
 *
 * 🔴 根因是那条「首帧只立基线、什么都别做」的守卫（`if (!initialized.current) return;`）：
 *    一进题目还没动笔时 `onChange` 与 `scheduleRaster` **都不跑** ⇒ 一张快照都抓不出来，
 *    而**底稿正是画在快照上的** ⇒ 教师那一格空白（学生屏幕上明明有底稿）。
 *
 * ✅ 首帧照旧**不报作答**（交上去的那份是「学生自己画的」，刚进来时它就是空的；
 *    一进来就报会把这题算成「作答中」），但**快照要照抓** —— 它不进作答，只喂教师/AI。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));

/** 「交出作答 + 抓图」那一条 effect（靠它的依赖数组收尾）。 */
const submit = (() => {
  const at = live.indexOf('const payload = toFlowPayload(nodes, edges)');
  assert.notEqual(at, -1, '交作答那一段没找到 —— 先修这条判据');
  const start = live.lastIndexOf('useEffect(', at);
  const end = live.indexOf('}, [nodes, edges, onChange, scheduleRaster, starterPayload]);', at);
  assert.notEqual(start, -1, 'effect 的开头没找到 —— 先修这条判据');
  assert.notEqual(end, -1, 'effect 的结尾没找到 —— 先修这条判据');
  return live.slice(start, end);
})();

test('★ 首帧也要**抓快照**（底稿画在快照上，不抓就永远看不到）', () => {
  assert.ok(submit.length > 200, `那一支没抠出来（${submit.length}）—— 先修这条判据，别让它在空串上全绿`);
  assert.match(submit, /scheduleRaster\(\);/, '这一支里没有抓图那一句');
  /*
   * 🔴 关键：`scheduleRaster()` **不许**被首帧守卫挡在外面。
   *    上一版是 `if (!initialized.current) { initialized.current = true; return; }` ——
   *    整支提前回家 ⇒ 首帧既不报也不抓 ⇒ 教师的监控面板从「打开题目」到「学生动第一下」
   *    之间**一直是空的**。
   */
  assert.ok(!/if \(!initialized\.current\)[^\n]*return;/.test(submit), '首帧又整支 return 了 —— 快照抓不出来，教师面板会一直空着');
  assert.match(submit, /const firstFrame = !initialized\.current;/, '没有被留下来那个「这是首帧」的记号');
  assert.match(submit, /if \(!firstFrame\)[\s\S]{0,120}?onChange\(/, '首帧应当**只跳过交作答**（`onChange`），其余照做');
});

test('空画板抓不出图 —— 没底稿时不会因此把「只打开了题」算成作答中', () => {
  // 判据落在**快照那一侧**：`flowchartSvg` 对空图回 null ⇒ 上游 `capture` 也就没有 blob 可传。
  const raster = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  assert.match(raster, /const shot = lastFlow\.current \? flowchartSvg\(lastFlow\.current\) : null;/, '快照那一段的写法变了 —— 先确认空图仍然回 null（`worksheet-flowchart-svg.test.ts` 里那条用例）');
});
