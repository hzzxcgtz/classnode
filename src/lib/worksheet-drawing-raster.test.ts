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

/* ⚠️ 它住在 `worksheet-drawing.ts`（零依赖那个模块）—— 这里要能纯 Node 加载。 */
import { rasterDelayMs } from './worksheet-drawing.ts';

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
