/**
 * 抓图节拍的判据（★ 2026-10-07 教师：「我在学生端修改流程图……**图没有及时更新**」）。
 *
 * 🔴 只有防抖的那一版：学生**连续画**的时候每次改动都把计时器重置 ⇒ **一张都不抓** ⇒
 *    教师那一格的字在变（保存 1.5 秒）、画不变（抓图 800ms 停手才拍）。
 * ✅ 加一条上限：距上次抓图超过 `maxDelayMs` 就缩短这次要等的时间。
 *
 * ⚠️ 只测那条**纯规则**（`rasterDelayMs`）—— hook 本身要 React/DOM，本机没有 jsdom。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ 它住在 `worksheet-drawing.ts`（零依赖那个模块）—— 这里要能纯 Node 加载。 */
// ⚠️ 两个都从 `worksheet-drawing.ts` 取：`worksheet-drawing-raster.ts` import 了 `./api`
//（webpack 风格、无扩展名），`node --test` 装载不起来 —— 所以纯逻辑都住在这一侧。
import { rasterDelayMs, safeCapture } from './worksheet-drawing.ts';

const DEFAULTS = { delayMs: 800, maxDelayMs: 5000 };

test('刚抓过 ⇒ 就是普通的防抖（改动停下来 800ms 再抓）', () => {
  assert.equal(rasterDelayMs({ now: 1000, lastCaptureAt: 1000, ...DEFAULTS }), 800);
  assert.equal(rasterDelayMs({ now: 3000, lastCaptureAt: 1000, ...DEFAULTS }), 800, '还没到上限，照旧防抖');
});

test('★ 连续画的时候不能永远不抓 —— 到上限就立刻抓', () => {
  // 距上次抓图已经 5 秒（学生一直在改）⇒ 等待时间归零，马上抓一张。
  assert.equal(rasterDelayMs({ now: 6000, lastCaptureAt: 1000, ...DEFAULTS }), 0);
  assert.equal(rasterDelayMs({ now: 9900, lastCaptureAt: 1000, ...DEFAULTS }), 0, '超过上限也还是 0');
});

test('★ 快到上限时，等待时间被**压缩**（不是等到 800ms 再说）', () => {
  // 距上次 4.6 秒 ⇒ 只剩 0.4 秒到上限 ⇒ 就等 0.4 秒。
  assert.equal(rasterDelayMs({ now: 5600, lastCaptureAt: 1000, ...DEFAULTS }), 400);
  // 距上次 4.9 秒 ⇒ 只剩 0.1 秒。
  assert.equal(rasterDelayMs({ now: 5900, lastCaptureAt: 1000, ...DEFAULTS }), 100);
});

test('还没抓过 ⇒ 按防抖来（首帧那次不该抢跑）', () => {
  assert.equal(rasterDelayMs({ now: 1000, lastCaptureAt: null, ...DEFAULTS }), 800);
});

test('上限比防抖还小时也不会算出负数（配置写反了也别崩）', () => {
  const out = rasterDelayMs({ now: 10_000, lastCaptureAt: 1000, delayMs: 800, maxDelayMs: 300 });
  assert.ok(out >= 0, `等待时间不许是负数（拿到 ${out}）`);
});

/*
  ★ 2026-10-07 审计抓到（思维导图）：那条抓图的路**会抛**。
  `svgToPngBlob`（流程图走它）遵守「失败回 `null`、绝不抛」；而思维导图调的是第三方库的
  `exportPng`，库失败时是 `reject`，调用点没有兜。⇒ `useDrawingRaster` 里那句
  `void (async () => { await capture() … })()` 变成 **unhandled rejection**，
  这一次快照静默不更新 —— 与模块自己写下的承诺相反（「抓图炸掉不该把作答那一步带走」）。

  🔴 修在**模块这一层**而不是补那一个调用点：那条承诺是模块的，就该由模块保证 ——
  四个画板一起受益，将来谁再写一个会 reject 的 capture 也不会漏。
*/
test('★ 抓图抛异常 ⇒ 回 null（绝不把异常放出去）', async () => {
  const out = await safeCapture(async () => { throw new Error('exportPng 挂了'); });
  assert.equal(out, null, '抛出去的后果是 unhandled rejection，而这一次快照会静默不更新');
});

test('★ 抓图返回 null（正常的「这次没抓到」）⇒ 照旧 null，不当异常处理', async () => {
  assert.equal(await safeCapture(async () => null), null);
});

test('★ 抓到了就原样透传（别把好值也吃掉）', async () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  assert.equal(await safeCapture(async () => blob), blob, '透传的必须是同一个对象（体积大，别复制）');
});

test('★ 抓图那一处真的接了 safeCapture（函数写得再对，没接上也没用）', () => {
  // ⚠️ 源码级判据 —— 它只证「接线在」，不证运行时行为（那三条在上面）。
  // 它挡的是这个具体动作：有人把 `await safeCapture(captureRef.current)` 改回 `await captureRef.current()`。
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raster = fs.readFileSync(path.join(here, 'worksheet-drawing-raster.ts'), 'utf8');
  assert.match(raster, /await safeCapture\(captureRef\.current\)/,
    '抓图那一处没走 safeCapture ⇒ 第三方画板的 capture 一 reject 就是 unhandled rejection（静默不更新）');
});
