/**
 * 数学作图的**图形构造**（纯几何）与工具表。
 *
 * 🔴 断言里刻意用**整数/半整数**坐标：这几条判据（对角和相等、中点性质、记号的中点与法向）
 *    都能一眼心算出来 —— 写一堆小数只会让人核对不了，也就没人核对了。
 * ⊘ 2026-10-06 第二版：教师划掉了「直线 / 正方形 / 中点 / 垂直平分线 / 角平分线」，
 *    对应的几何实现（`squareOf` / `midpointOf` / `perpendicularBisectorOf` / `bisectorEndOf`）
 *    也一并删了 —— 用例跟着删，不留「测着一个没有入口的函数」。
 * ⊘ 2026-10-07：又划掉了「平行线 / 垂线 / 角」（`lineThrough` 跟着删）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MARK_ARROW_LEN,
  MARK_ARC_RADIUS,
  MARK_ARC_SEGMENTS,
  MARK_SQUARE_SIDE,
  MARK_TICK_LEN,
  MATH_BOX,
  MATH_TOOL_GROUPS,
  MATH_TOOL_ICONS,
  MATH_TOOLS,
  arcLabelAt,
  arcPathOf,
  backgroundPlacement,
  equalMarkOf,
  parallelMarkOf,
  parallelogramOf,
  rectangleOf,
  rightAngleOf,
  toolHintOf,
  toolsInGroup,
  trapezoidOf,
} from './worksheet-math-shapes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const shapesSource = stripComments(fs.readFileSync(path.join(HERE, 'worksheet-math-shapes.ts'), 'utf8'));

test('阳性对照：工具表里的点击次数与中文名都在（否则下面几条对空表永远绿）', () => {
  // ★ 2026-10-07：14 个 → 11 个（砍掉平行线 / 垂线 / 角；四个记号在 Task 3 进来）。
  assert.ok(MATH_TOOLS.length >= 11, `工具只有 ${MATH_TOOLS.length} 个`);
  for (const tool of MATH_TOOLS) {
    assert.ok(tool.label.length > 0, `${tool.value} 没有中文名`);
    assert.ok(tool.clicks >= 0, `${tool.value} 的点击次数不对`);
  }
  for (const value of ['select', 'point', 'segment', 'arrow', 'circle', 'triangle', 'rectangle',
    'parallelogram', 'trapezoid', 'free', 'label']) {
    assert.ok(MATH_TOOLS.some((tool) => tool.value === value), `少了工具：${value}`);
  }
  // ⊘ 2026-10-06 划掉的五个 + ★ 2026-10-07 划掉的三个（平行线 / 垂线 / 角）。
  for (const gone of ['line', 'square', 'midpoint', 'perp-bisector', 'bisector',
    'parallel', 'perpendicular', 'angle']) {
    assert.ok(!MATH_TOOLS.some((tool) => tool.value === gone), `划掉的工具还在：${gone}`);
  }
});

test('★ 2026-10-07：砍掉的三个工具，几何实现也不许留着（死代码会被下一个人当成「还有人用」）', () => {
  assert.ok(!shapesSource.includes('lineThrough'), 'lineThrough 还在 —— 已经没有入口了');
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


test('工具提示：说清要点几下（多击图形靠这句话才用得起来）', () => {
  assert.match(toolHintOf('triangle'), /3/);
  assert.match(toolHintOf('trapezoid'), /四个顶点/);
  assert.match(toolHintOf('free'), /拖动/);
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
  // ④ 「选择」排在**第一个**（它是每一个工具的出口：画错了要能选、能删）。
  //    ★ 2026-10-07 教师在这份设计里看到的排法就是 [选择][点][线段][射线][圆]…
  assert.equal(MATH_TOOLS[0].value, 'select');
});

/**
 * ★ 2026-10-07（教师）：「这是几何题的行话」—— 四个记号。
 *
 * 🔴 断言里刻意用**整数/半整数**坐标（与文件头那条纪律同一条）：等号的中点与法向、
 *    直角方块的三点、角弧的半径，都要能一眼心算出来 —— 写一堆小数只会让人核对不了。
 * 🔴 四个函数**都要在退化输入上回 null**（两点重合 ⇒ 方向是 [0,0] ⇒ 算出来是 NaN，
 *    而 NaN 会把整张图画没且不报错）。这是本模块里"宁可不画"那条老规矩的延续。
 */
test('等号：中点上一道**垂直于边**的短斜线', () => {
  const tick = equalMarkOf([0, 0], [4, 0]);
  assert.ok(tick, '没画出来');
  // 中点 (2,0)，法向是竖直 ⇒ 两个端点的 x 相同、y 上下各半个长度。
  assert.equal(tick[0][0], 2);
  assert.equal(tick[1][0], 2);
  assert.equal(tick[0][1], -MARK_TICK_LEN / 2);
  assert.equal(tick[1][1], MARK_TICK_LEN / 2);
});

test('平行记号：中点上一根**沿着边**的短线（两端各一个箭头）', () => {
  const bar = parallelMarkOf([0, 0], [4, 0]);
  assert.ok(bar, '没画出来');
  assert.equal(bar[0][1], 0);
  assert.equal(bar[1][1], 0, '平行记号应当是沿着边的（y 不变）');
  /*
   * ⚠️ **别用两个端点相减去比总长** —— 它们是 `round3` **舍入过**的，
   *   而 `2.7 - 1.3` 在浮点下是 `1.4000000000000001`，判据会**假红**（实测踩过）。
   *   ⇒ 直接比端点（`2 ± MARK_ARROW_LEN / 2` 这两个数在双精度下是**精确**的）。
   */
  assert.deepEqual(bar, [[2 - MARK_ARROW_LEN / 2, 0], [2 + MARK_ARROW_LEN / 2, 0]]);
});

test('直角：从顶点沿两条边各走一个边长 ⇒ 角内那三个拐点', () => {
  // 直角在原点：一边沿 x 轴、一边沿 y 轴。
  assert.deepEqual(rightAngleOf([0, 0], [4, 0], [0, 3]),
    [[MARK_SQUARE_SIDE, 0], [MARK_SQUARE_SIDE, MARK_SQUARE_SIDE], [0, MARK_SQUARE_SIDE]]);
  // ⚠️ 边长是**沿边方向**量的，与那条边有多长无关 —— 换个长度也是同一个方块。
  assert.deepEqual(rightAngleOf([0, 0], [9, 0], [0, 2]),
    [[MARK_SQUARE_SIDE, 0], [MARK_SQUARE_SIDE, MARK_SQUARE_SIDE], [0, MARK_SQUARE_SIDE]]);
});

test('角弧：一段**半径固定**的弧，两端正好落在两条边上', () => {
  const arc = arcPathOf([0, 0], [4, 0], [0, 4]);
  assert.ok(arc, '没画出来');
  assert.equal(arc.length, MARK_ARC_SEGMENTS + 1, '采样 8 段 ⇒ 9 个点');
  // 每个点都在半径上（这是"弧"的定义，也是最容易算错的地方）。
  for (const [x, y] of arc) {
    assert.ok(Math.abs(Math.hypot(x, y) - MARK_ARC_RADIUS) < 0.01, `不在半径上：${x},${y}`);
  }
  // 两端分别贴着两条边。
  assert.ok(Math.abs(arc[0][1]) < 0.01 && arc[0][0] > 0, '起点不在第一条边上');
  assert.ok(Math.abs(arc[arc.length - 1][0]) < 0.01 && arc[arc.length - 1][1] > 0, '终点不在第二条边上');
  // 90° 的角 ⇒ 走的是**小弧**（不许绕远路 270°）。
  const mid = arc[4];
  assert.ok(mid[0] > 0 && mid[1] > 0, '弧跑到角外面去了（走了 270° 那条）');
  // ⚠️ 两个方向点，得到的必须是**同一段弧**（学生先点哪条边不该改变结果）。
  assert.deepEqual(arcPathOf([0, 0], [0, 4], [4, 0]), arc.slice().reverse().map(([x, y]) => [x, y]));
});

test('度数写在角平分线上（45° 时 x 与 y 必须相等）', () => {
  const at = arcLabelAt([0, 0], [4, 0], [0, 4]);
  assert.ok(at, '没算出来');
  assert.equal(at[0], at[1], '45° 的角平分线上 x 与 y 必须相等');
  assert.ok(at[0] > 0 && at[1] > 0, '要落在角的内侧');
  // 平角（两条边反向）⇒ 单位向量之和是零向量 ⇒ 宁可不写，不许算出 NaN。
  assert.equal(arcLabelAt([0, 0], [1, 0], [-1, 0]), null);
});

test('★ 四个记号在退化输入上一律回 null（两点重合 ⇒ 不许算出 NaN）', () => {
  assert.equal(equalMarkOf([1, 1], [1.05, 1]), null);
  assert.equal(parallelMarkOf([1, 1], [1, 1]), null);
  assert.equal(rightAngleOf([0, 0], [0, 0], [0, 3]), null, '一条边退化 ⇒ null');
  assert.equal(rightAngleOf([0, 0], [4, 0], [0.05, 0]), null, '两条边几乎同向 ⇒ 仍然要有两个方向');
  assert.equal(arcPathOf([0, 0], [0, 0], [0, 4]), null);
});

test('★ 工具表里四个记号都在，clicks 与需求一致，且各有图标与提示', () => {
  assert.equal(MATH_TOOLS.find((t) => t.value === 'equalMark')?.clicks, 2);
  assert.equal(MATH_TOOLS.find((t) => t.value === 'parallelMark')?.clicks, 2);
  assert.equal(MATH_TOOLS.find((t) => t.value === 'rightAngle')?.clicks, 3);
  assert.equal(MATH_TOOLS.find((t) => t.value === 'angleArc')?.clicks, 3);
  for (const value of ['angleArc', 'rightAngle', 'equalMark', 'parallelMark'] as const) {
    const icon = MATH_TOOL_ICONS[value];
    assert.ok(typeof icon === 'string' && icon.length > 8, `${value} 没有图标`);
    assert.ok(toolHintOf(value).length > 0, `${value} 没有提示语`);
  }
  // 两个三击记号的提示语要说的是**同一件事的顺序**（顶点在第二下）——
  // 两种顺序共存的话，学生点错的表现是"记号长到了错的地方"，不报错。
  assert.match(toolHintOf('angleArc'), /顶点/);
  assert.match(toolHintOf('rightAngle'), /顶点/);
});

test('★ 角弧走的一定是**小弧**：两条边都指向左边时不许绕一大圈（两个方向都要）', () => {
  /*
   * 两条边都指向 ≈180°（一条略偏上、一条略偏下）：夹角只有 ~1.1°，
   * 而 `atan2` 给出的**原始差值**是 ±358.9° ⇒ 没有归一化的话会画出那条 359° 的大弧。
   *
   * 🔴 为什么必须补这一条：上面那条「角弧」用的两个方向**本来就在 `(-π, π]` 里**
   *   （0° 与 90°），归一化那两句**一次都不会被触发** ⇒ 把它们删掉判据照样全绿。
   *   实测踩过这条假绿（变异验证时发现的）。
   * ⚠️ **两个方向都要走一遍**：`delta` 是正是负由两个 `while` 各管一边，
   *   只测一个方向的话，另一个 `while` 删掉也照样绿。
   */
  const pairs: Array<[[number, number], [number, number]]> = [
    [[-4, 0.04], [-4, -0.04]],
    [[-4, -0.04], [-4, 0.04]],
  ];
  for (const [a, b] of pairs) {
    const arc = arcPathOf([0, 0], a, b);
    assert.ok(arc, '没画出来');
    for (const [x, y] of arc) {
      assert.ok(x < 0, `弧绕了大圈（跑到右半边去了）：${x},${y}`);
    }
    const d = Math.hypot(arc[arc.length - 1][0] - arc[0][0], arc[arc.length - 1][1] - arc[0][1]);
    assert.ok(d < 0.05, `弧太长（绕了大圈）：两个端点相距 ${d}`);
  }
});

/**
 * ★ 2026-10-07（教师）：几何题原图当**底图** —— 摆位。
 *
 * 🔴 断言里用的是**装得进**（contain）而不是"铺满"：现在的实现是
 *   `.thirdPartyCanvas { background-size: 100% 100% }`（硬拉），教师传的原图比例一变就变形，
 *   而变形在几何题上**是有含义的错误**（直角看起来不是直角）。
 * 🔴 返回的是 jsxgraph 要的 **[锚点, 尺寸]**，**不是两个角** ——
 *   `createImage` 把 `parents[2]` 当 `[宽, 高]`。传两个角进去图会缩成一半、挤在左下角，
 *   而屏幕上只是"图小了、偏了"（复核实测抓到的 Critical）。所以下面**专门钉"居中"**。
 */
test('★ 底图摆位：等比装进画板框、**居中**、不许拉伸', () => {
  /** 锚点 + 尺寸 ⇒ 图的四个边（顺带就是"居中"这条性质的检查方式）。 */
  const box = (aspect: number) => {
    const { anchor, size } = backgroundPlacement(aspect);
    return { left: anchor[0], bottom: anchor[1], right: anchor[0] + size[0], top: anchor[1] + size[1] };
  };
  // 4:3 的图 ⇒ 左右贴边、上下各留 0.5。
  assert.deepEqual(box(4 / 3), { left: -10, bottom: -7.5, right: 10, top: 7.5 });
  // 正方形 ⇒ 上下贴边、左右各留 2。
  assert.deepEqual(box(1), { left: -8, bottom: -8, right: 8, top: 8 });
  // 很宽的图 ⇒ 同理，比例一个字都不许变。
  assert.deepEqual(box(2), { left: -10, bottom: -5, right: 10, top: 5 });
  /*
   * 🔴 **居中**：图的中点必须落在画板框的中心（0,0）。
   *   这条是专门为"锚点 + 尺寸"那个坑写的 —— 把它当成"两个角"用的话，
   *   图的中心会跑到框的左下象限去，而上面那三条 deepEqual 里只要有任一条写成
   *   "角"的形状就会一起错，所以必须有一条**只讲性质、不讲具体数**的。
   */
  for (const aspect of [0.4, 1, 4 / 3, 2, 5]) {
    const { anchor, size } = backgroundPlacement(aspect);
    assert.ok(Math.abs(anchor[0] + size[0] / 2) < 1e-9, `没有水平居中（aspect=${aspect}）`);
    assert.ok(Math.abs(anchor[1] + size[1] / 2) < 1e-9, `没有垂直居中（aspect=${aspect}）`);
    // 比例一个字都不许变。
    assert.ok(Math.abs(size[0] / size[1] - aspect) < 1e-9, `比例变了（aspect=${aspect}）`);
    // 装得进框。
    assert.ok(size[0] <= 20 + 1e-9 && size[1] <= 16 + 1e-9, `装不进框（aspect=${aspect}）`);
  }
  // 与画板同比例 ⇒ 正好铺满。
  // ⚠️ 框的比例从 `MATH_BOX` **算出来**，不许写死 1.25（写死就与常量脱钩了：
  //    哪天有人动了框，这条判据照样绿，而底图会被拉伸）。
  const boxAspect = (MATH_BOX[2] - MATH_BOX[0]) / (MATH_BOX[1] - MATH_BOX[3]);
  assert.deepEqual(box(boxAspect), { left: -10, bottom: -8, right: 10, top: 8 });
  // 量不出来（老浏览器 / 图的宽高是 0）⇒ 回落到画板框自己的比例，**不许**算出 NaN。
  assert.deepEqual(box(Number.NaN), { left: -10, bottom: -8, right: 10, top: 8 });
  assert.deepEqual(box(0), { left: -10, bottom: -8, right: 10, top: 8 });
});
