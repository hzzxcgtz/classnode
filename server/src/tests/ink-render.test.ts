/**
 * `ink-render.ts` 的逐条断言（M6a）—— 笔迹「能不能出图」的唯一回归网。
 *
 * 跑法：
 * ```bash
 * pnpm build:server && node --test server/dist/tests/ink-render.test.js
 * ```
 *
 * ⚠️ **它验不了「图长得像不像那幅画」** —— 本机没有能看图的渲染环境，也没有 Word。
 * 它验的是三件**能被算出来**的事：出来的是不是真 PNG、尺寸在不在上限内、
 * 以及两种边界（空笔画 / 量不出框）各自走哪条路。那三件错了都会**静默**产出坏报告。
 *
 * ⚠️ 路径字符串的忠实度由**另一条**用例守着（`src/lib/worksheet-ink-parity.test.ts`）——
 * 那一条管「服务端画的线与前端是不是同一条」，这一条管「这条线有没有变成图」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INK_PNG_MAX, inkToPng } from '../services/ink-render.js';

const ONE_STROKE = {
  format: 'ink/v1' as const,
  canvas: { w: 300, h: 200 },
  strokes: [{ color: '#111827', width: 0.2, points: [[0.1, 0.1], [0.9, 0.9]] as Array<[number, number]> }],
};

test('★ 一笔画 ⇒ 一张真 PNG，且长宽都不超过上限', async () => {
  const png = await inkToPng(ONE_STROKE);
  assert.ok(png, 'sharp 是 server 的依赖，测试环境里应当可用');
  // PNG 魔数：89 50 4E 47
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], '不是 PNG');
  // 宽高在 IHDR 里（大端，偏移 16 / 20）
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  assert.ok(w > 0 && w <= INK_PNG_MAX, `宽 ${w} 越界`);
  assert.ok(h > 0 && h <= INK_PNG_MAX, `高 ${h} 越界`);
});

test('★ 大画布 ⇒ 被缩到上限内（一节课几十上百张图，尺寸不收住会撑爆文档）', async () => {
  const big = { ...ONE_STROKE, canvas: { w: 1280, h: 720 } };
  const png = await inkToPng(big);
  assert.ok(png);
  assert.ok(png.readUInt32BE(16) <= INK_PNG_MAX, `宽 ${png.readUInt32BE(16)} 越界`);
  assert.ok(png.readUInt32BE(20) <= INK_PNG_MAX, `高 ${png.readUInt32BE(20)} 越界`);
  // ⚠️ 只收上限，**不放大**：把小画布放大只会让笔迹糊掉。
  const small = await inkToPng({ ...ONE_STROKE, canvas: { w: 100, h: 80 } });
  assert.equal(small?.readUInt32BE(16), 100, '小画布不该被放大');
});

test('★ 空笔画 ⇒ `null`（不产出一张纯白图冒充「画了」）', async () => {
  // ⚠️ 规格 §3.5：没有笔画的笔迹与「没作答」在报告里必须能分开 ——
  // 这里回 null、由渲染层去说那句实话，**不要**画一张空白图。
  assert.equal(await inkToPng({ ...ONE_STROKE, strokes: [] }), null);
});

test('★ 画布框量不出来（0×0）⇒ 仍然出图，不许回 null', async () => {
  // 值本身合法（学生确实画了），只是量框那次失败了 ⇒ 用一个默认框，
  // 别把学生的作答吞掉。「少一块」与「这一题没答」在报告里长得一样。
  const png = await inkToPng({ ...ONE_STROKE, canvas: { w: 0, h: 0 } });
  assert.ok(png, '量不出框不等于没作答');
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
});

test('★ 单点笔画也出图（学生点了一下 —— Safari 上不画出来的那一档）', async () => {
  const dot = { ...ONE_STROKE, strokes: [{ color: '#111827', width: 0.2, points: [[0.5, 0.5]] as Array<[number, number]> }] };
  assert.ok(await inkToPng(dot));
});
