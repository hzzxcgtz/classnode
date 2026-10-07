/**
 * 「删除按钮压在图形的哪一点上」的判据（★ 2026-10-07 教师给了四张图）。
 *
 * 🔴 这一条**不验坐标数字**，验的是**那个点在不在轮廓上** —— 因为教师的原话是
 *    「切记**要压在图形的线条上**」，而四种形状的轮廓各是一条不同的曲线：
 *      · 菱形：`|dx|/(w/2) + |dy|/(h/2) = 1`（顶点落在四条边的中点上）；
 *      · 平行四边形：上边被 skew 推到右边，所以是「上边那一条直线上的某一点」；
 *      · 胶囊：左半圆（`border-radius: 999px` ⇒ 短边一半）。
 *    数字（比如 45° 那个 0.293、tan10°）会随着形状调整而变，**轮廓不会**。
 *
 * ⚠️ 反面对照在每条用例里都留着：**外接框的左上角**（老实现）必须**判违规** ——
 *    否则这些用例对一个恒返回框角的实现也全绿（那正是要被换掉的那一版）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLOW_IO_SKEW_DEG, flowNodeCornerPoint } from './worksheet-flowchart-node.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.resolve(HERE, '../app/classroom/worksheet/worksheet.module.css'), 'utf8');

/** 一个常见的节点尺寸（`.flowNode` 的 `min-width/min-height`）。 */
const BOX = { x: 100, y: 200, width: 150, height: 54 };
const near = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 0.01, `${why}（${a} ≠ ${b}）`);

test('矩形：左上角本来就在轮廓上，照旧', () => {
  const point = flowNodeCornerPoint(BOX, 'process');
  near(point.x, BOX.x, '矩形的左上角 x');
  near(point.y, BOX.y, '矩形的左上角 y');
});

test('菱形：取**左顶点**（外接框的左上角在图形外面一大截）', () => {
  const point = flowNodeCornerPoint(BOX, 'decision');
  /*
   * 轮廓判据：菱形的边界式 `|dx|/(w/2) + |dy|/(h/2) = 1`。
   * 左顶点：dx = 0、dy = h/2 ⇒ 0 + 1 = 1 ✓ 在轮廓上。
   */
  const value = Math.abs(point.x - (BOX.x + BOX.width / 2)) / (BOX.width / 2)
    + Math.abs(point.y - (BOX.y + BOX.height / 2)) / (BOX.height / 2);
  near(value, 1, '这个点不在菱形轮廓上');
  // 反面对照：外接框的左上角**不在**轮廓上（那正是被换掉的老行为）。
  const corner = Math.abs(BOX.x - (BOX.x + BOX.width / 2)) / (BOX.width / 2)
    + Math.abs(BOX.y - (BOX.y + BOX.height / 2)) / (BOX.height / 2);
  assert.ok(corner > 1.5, `反面对照失效：外接框的左上角竟然在轮廓上（值 ${corner}）`);
});

test('平行四边形：取**左上顶点**（上边被 skew 推到右边）', () => {
  const point = flowNodeCornerPoint(BOX, 'io');
  near(point.y, BOX.y, '平行四边形的左上顶点在上边那条线上');
  // 上边相对框角右移的量 = 半个高 × tan(斜角) —— 与 CSS 里那个角度**同一个数**。
  near(point.x, BOX.x + (BOX.height / 2) * Math.tan((FLOW_IO_SKEW_DEG * Math.PI) / 180), '左上顶点的横坐标');
  assert.ok(point.x > BOX.x, '左上顶点没有往右偏 —— 那是外接框的角，悬在图形外面');
});

test('胶囊：取左半圆上的 45° 点（框角落在圆弧外）', () => {
  const point = flowNodeCornerPoint(BOX, 'terminator');
  const radius = Math.min(BOX.height, BOX.width) / 2;
  const capCenterX = BOX.x + radius;
  const centerY = BOX.y + BOX.height / 2;
  /* 轮廓判据：左半圆 `(x - capCenterX)² + (y - centerY)² = r²`。 */
  near(Math.hypot(point.x - capCenterX, point.y - centerY), radius, '这个点不在左半圆上');
  // 反面对照：外接框的左上角到圆心的距离**大于**半径 ⇒ 在圆外（悬空）。
  assert.ok(
    Math.hypot(BOX.x - capCenterX, BOX.y - centerY) > radius + 1,
    '反面对照失效：外接框的左上角竟然落在圆弧上',
  );
});

test('认不出来的 kind（含交点那颗小圆点）退回框角 —— 与老行为一致', () => {
  assert.deepEqual(flowNodeCornerPoint(BOX, 'junction'), { x: BOX.x, y: BOX.y });
  assert.deepEqual(flowNodeCornerPoint(BOX, '没见过的'), { x: BOX.x, y: BOX.y });
});

/*
  ★ 2026-10-07（教师）：「平行四边形选中以后的四个控制句柄**不能变形**」。
  🔴 根因：`.flowNode_io` 自己挂着 `skew(-10deg)`，而句柄是它的**子元素** ⇒ 一起被斜切成了
     小菱形（`.flowNode_io input` / `.flowNodeLabel` 早就加了反向 `skew(10deg)`，**句柄被漏了**）。
  ✅ 判据两面都验：① 反向斜切**存在**；② 它**保住了库那套定位的 translate**
     （只写 `skew(10deg)` 会把句柄从边上挪走 —— 四侧的 translate 各不相同）。
*/
test('★ 平行四边形的句柄不许被斜切成菱形（四个方位各自反切）', () => {
  const skew = CSS.match(/\.flowNode_io \{ transform: skew\((-?\d+)deg\); \}/);
  assert.ok(skew, '样式表里找不到 `.flowNode_io` 的斜切 —— 先修这条判据');
  const angle = Number(skew[1]);
  assert.equal(Math.abs(angle), FLOW_IO_SKEW_DEG, '`FLOW_IO_SKEW_DEG` 与样式表里那个角度对不上了');
  const counter = skew[1].startsWith('-') ? String(FLOW_IO_SKEW_DEG) : `-${FLOW_IO_SKEW_DEG}`;
  /*
   * 四侧的定位 translate 是库自己那套（top/bottom 在 x 上居中、left/right 在 y 上居中），
   * 反向斜切必须**接在它后面** —— 只写 `skew(...)` 会把句柄整体挪到框中央去。
   */
  const sides: [string, string][] = [
    ['top', 'translate(-50%, -50%)'],
    ['bottom', 'translate(-50%, 50%)'],
    ['left', 'translate(-50%, -50%)'],
    ['right', 'translate(50%, -50%)'],
  ];
  for (const [side, translate] of sides) {
    const rule = CSS.match(new RegExp(`\\.flowNode_io :global\\(\\.react-flow__handle-${side}\\)[^{]*\\{([^}]*)\\}`));
    assert.ok(rule, `样式表里没有给 ${side} 侧的句柄加反向斜切 —— 它会被父层的斜切压成菱形`);
    assert.match(rule[1], new RegExp(`transform:\\s*${translate.replace(/[()%,]/g, '\\$&')}\\s+skew\\(${counter}deg\\)`),
      `${side} 侧的句柄没有「先按库的 translate 定位、再反向斜切」`);
  }
});
