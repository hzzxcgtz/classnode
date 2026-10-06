/**
 * 数学作图的**图形构造**（纯几何）与工具表。
 *
 * 🔴 断言里刻意用**整数/半整数**坐标：这几条判据（对角和相等、平行/垂直方向、中点性质）
 *    都能一眼心算出来 —— 写一堆小数只会让人核对不了，也就没人核对了。
 * ⊘ 2026-10-06 第二版：教师划掉了「直线 / 正方形 / 中点 / 垂直平分线 / 角平分线」，
 *    对应的几何实现（`squareOf` / `midpointOf` / `perpendicularBisectorOf` / `bisectorEndOf`）
 *    也一并删了 —— 用例跟着删，不留「测着一个没有入口的函数」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MATH_TOOL_GROUPS,
  MATH_TOOL_ICONS,
  MATH_TOOLS,
  lineThrough,
  parallelogramOf,
  rectangleOf,
  toolHintOf,
  toolsInGroup,
  trapezoidOf,
} from './worksheet-math-shapes.ts';

test('阳性对照：工具表里的点击次数与中文名都在（否则下面几条对空表永远绿）', () => {
  // 14 个：点/线段/射线/圆 · 三角形/长方形/平行四边形/梯形 · 角/平行线/垂线 · 自由线条/文字/选择。
  assert.ok(MATH_TOOLS.length >= 14, `工具只有 ${MATH_TOOLS.length} 个`);
  for (const tool of MATH_TOOLS) {
    assert.ok(tool.label.length > 0, `${tool.value} 没有中文名`);
    assert.ok(tool.clicks >= 0, `${tool.value} 的点击次数不对`);
  }
  // 教师 2026-10-06 点名要的：自由线条 + 多边形族 + 角/平行线/垂线/中点/垂直平分线/角平分线。
  for (const value of ['point', 'segment', 'arrow', 'circle', 'free', 'triangle', 'rectangle',
    'parallelogram', 'trapezoid', 'angle', 'parallel', 'perpendicular', 'label', 'select']) {
    assert.ok(MATH_TOOLS.some((tool) => tool.value === value), `少了工具：${value}`);
  }
  // ⊘ 教师 2026-10-06 划掉的五个**不该**再出现在工具条上。
  for (const gone of ['line', 'square', 'midpoint', 'perp-bisector', 'bisector']) {
    assert.ok(!MATH_TOOLS.some((tool) => tool.value === gone), `划掉的工具还在：${gone}`);
  }
});

test('长方形：两个对角点 ⇒ 轴对齐的四个顶点', () => {
  assert.deepEqual(rectangleOf([0, 0], [4, 2]), [[0, 0], [4, 0], [4, 2], [0, 2]]);
  // 反着点（从右下往左上）也应该是同一个长方形。
  assert.deepEqual(rectangleOf([4, 2], [0, 0]), [[4, 2], [0, 2], [0, 0], [4, 0]]);
});


test('平行四边形：三个顶点 ⇒ 第四个由「对角和相等」定出', () => {
  assert.deepEqual(parallelogramOf([0, 0], [4, 0], [5, 3]), [[0, 0], [4, 0], [5, 3], [1, 3]]);
});

test('梯形：四个顶点原样保留（我们**不**替学生摆正）', () => {
  assert.deepEqual(trapezoidOf([[0, 0], [6, 0], [4, 2], [2, 2]]), [[0, 0], [6, 0], [4, 2], [2, 2]]);
});


test('平行线 / 垂线：过给定点、方向对（与参照线平行或垂直）', () => {
  const ref: [[number, number], [number, number]] = [[0, 0], [4, 0]];
  const parallel = lineThrough([1, 3], ref, 'parallel');
  assert.ok(parallel, '平行线没画出来');
  assert.equal(parallel[0][1], 3);
  assert.equal(parallel[1][1], 3, '平行线应当是水平的');
  const perpendicular = lineThrough([1, 3], ref, 'perpendicular');
  assert.ok(perpendicular, '垂线没画出来');
  assert.equal(perpendicular[0][0], 1);
  assert.equal(perpendicular[1][0], 1, '垂线应当是竖直的');
  // 参照线退化成一点 ⇒ 宁可不画（说不清方向），不许抛。
  assert.equal(lineThrough([0, 0], [[2, 2], [2, 2]], 'parallel'), null);
});


test('工具提示：说清要点几下（多击图形靠这句话才用得起来）', () => {
  assert.match(toolHintOf('triangle'), /3/);
  assert.match(toolHintOf('trapezoid'), /四个顶点/);
  assert.match(toolHintOf('free'), /拖动/);
  assert.match(toolHintOf('parallel'), /先画一条线段或直线/);
  assert.match(toolHintOf('label'), /写好文字/);
  assert.equal(toolHintOf('point'), '点击画板添加点');
  assert.match(toolHintOf('select'), /删除选中/);
});

test('★ 2026-10-06（教师）：每个工具都要有**图标**，且分组要「科学」（归类是数据，不是写死的 JSX）', () => {
  // ① 图标一个都不能少（缺图标的按钮在屏幕上只是「少了一小块」，没人会报 bug）。
  for (const tool of MATH_TOOLS) {
    const icon = MATH_TOOL_ICONS[tool.value];
    assert.ok(typeof icon === 'string' && icon.length > 8, `${tool.value} 没有图标`);
  }
  // ② 每个工具的 `group` 必须是声明过的组（写错一个字符串，那一组会静默少一个按钮）。
  const groups = new Set(MATH_TOOL_GROUPS.map((group) => group.value));
  for (const tool of MATH_TOOLS) {
    assert.ok(groups.has(tool.group), `${tool.value} 的分组不存在：${tool.group}`);
  }
  // ③ 分组**不空**、且并起来正好等于工具表（不多不少 —— 分组渲染漏一个工具就是「工具不见了」）。
  const grouped = MATH_TOOL_GROUPS.flatMap((group) => toolsInGroup(group.value).map((tool) => tool.value));
  assert.deepEqual(grouped.slice().sort(), MATH_TOOLS.map((tool) => tool.value).slice().sort());
  for (const group of MATH_TOOL_GROUPS) {
    assert.ok(toolsInGroup(group.value).length > 0, `分组 ${group.label} 是空的（会渲染出一条空的分割线）`);
  }
  // ④ 「选择」排在最后一组（它是操作，不是画图）。
  assert.equal(MATH_TOOLS[MATH_TOOLS.length - 1].value, 'select');
});
