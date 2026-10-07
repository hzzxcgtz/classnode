/**
 * 流程图**边**的几何 —— 两件事，都是教师 2026-10-07 提的：
 *
 *   ① **「折线太短就画成直线」**。教师：「在移动某个图形时，**连接线接近直线时需要吸附成直线**，
 *      否则可能会出现一个**非常小的拐角**，很难看」——「相当于是一个**微调**」。
 *      🔴 那个「很小的拐角」是 `smoothstep` 的固有表现：两端 **x 差一点点**时中间那段横线只有
 *         几个像素，看起来像打了个结。短到一定程度干脆画一条直线，视觉上就干净了。
 *   ② **绕行点（那颗控制柄拖出来的点）**：它**只能待在库画出来的那条线上**，而且**只能走到头**。
 *      教师原话：「连线的控制点必须**永远压在线上面**，不能漂移到线外」；
 *      「这是这条横线往下移动的**最低位置**，再往下移会超过最右侧竖线的最低高度，
 *       会导致两条线交叉点的**弧线折返**」。
 *
 * ⚠️ 这个模块**不 import `@xyflow/react`**：库那一份 import 了 React，纯 Node 下加载不了
 *    （本仓没有 jsdom，判据是纯函数级的）。真实的路径函数由调用方**注入**（见 `SmoothStepFn`）。
 *    但库**怎么用**传进去的绕行点，这里必须**照着复刻**（`flowRouteTrack` 那一段），
 *    否则「范围卡到哪儿」就成了猜的 —— 复刻的依据逐条写在那个函数上。
 *
 * ─────────────────────────────── 库那套东西，摘在这里备查 ───────────────────────────────
 * `@xyflow/system` 0.0.82 的 `getPoints`（`getSmoothStepPath` 就是它 + `getBend`）：
 *   · 两端各往外让 `offset`（默认 **20**）得到 `sourceGapped` / `targetGapped`；
 *   · `dirAccessor` 只看**起点句柄在哪条轴**上（上下句柄 ⇒ 'y'，左右 ⇒ 'x'）；
 *   · 两端句柄**对着**（`sourceDir[axis] * targetDir[axis] === -1`，如 bottom→top）时：
 *       `sourceDir[axis] === currDir` ⇒ 中段**横着**（`horizontalSplit`，位置 = `centerY`）
 *       否则                        ⇒ 中段**竖着**（`verticalSplit`，位置 = `centerX`）；
 *   · 两端句柄**相邻**（如 bottom→left）时走另一支 —— 那一支**压根不读 center**。
 *  ⇒ 「中段横着 ⇒ 上下拖」「中段竖着 ⇒ 左右拖」；而且**另一个轴的 center 只影响标签的坐标**，
 *    不进路径。这就是这里要复刻的全部。
 */

/**
 * 「短到看不见」的阈值（流坐标）。
 *
 * 12px 大致是「一眼看得出是个拐弯」的下限：比它更短的横线（或竖线）在屏幕上就是个疙瘩。
 * ⚠️ 别拿它当 `ALIGN_TOLERANCE`（24，那个管的是「一键整理时的对齐」）—— 两件事的取舍不同：
 *    整理时宁可少吸，这里则是「短到看不清就不画」。
 */
export const FLOW_STRAIGHT_SNAP = 12;

/**
 * 库的默认拐角留白（`getSmoothStepPath` 里 `offset = 20`）。
 * 🔴 它**不是**我们另定的余量 —— 绕行点的**最低/最高位置**就是这个数算出来的
 *    （教师那张图里的「最低位置」）。改它等于改库的画法，画板这边没有 `pathOptions`，所以它是常量。
 */
export const FLOW_EDGE_OFFSET = 20;

/*
 * ⊘ 2026-10-07：这里曾经有 `FLOW_SNAP_SLOPE`（≈8.5°）—— 它让「快竖直的斜线」被画成正的。
 *   教师试过之后**否掉了**：「还是不要自动校正那个矩形框了，**斜线就斜线吧**」。
 *   教训值得留着：那个矫正会让**箭头落不到 target 上**（线画在 source 的垂线上），
 *   为了补那个又得去挪框 —— 一环套一环，越弄越复杂。**斜一点没关系**，那才是这套东西的本相。
 */

/** 算路径需要的那几个数（与库的 `getSmoothStepPath` 入参**同形**，只是不依赖它）。 */
export interface FlowEdgeGeometryParams {
  sourceX: number;
  sourceY: number;
  sourcePosition: string;
  targetX: number;
  targetY: number;
  targetPosition: string;
  /** 绕行点（控制柄拖出来的）。**只有它所在的那条轴有意义**，另一个会被忽略（见 `flowRoutePoint`）。 */
  centerX?: number;
  centerY?: number;
  offset?: number;
  borderRadius?: number;
}

/** 注入的库函数 —— 真的用 `getSmoothStepPath`，判据里用假的。 */
export type SmoothStepFn = (params: FlowEdgeGeometryParams) => [string, number, number];

/**
 * 句柄那个小方块的**半个边长**。
 *
 * 🔴 这个 6 **不是我们定的**：它是 `.flowNode :global(.react-flow__handle)` 的 `12px` 的一半
 *    （画板把库默认那个小圆点改成了 12×12 的方块）。**换句柄尺寸就得跟着改它** ——
 *    `flowchart-anchor.test.ts` 有一条判据把样式表里的那个尺寸与它对起来。
 */
export const FLOW_HANDLE_HALF = 6;

/** 一个盒子（左上角 + 尺寸）—— 节点在流坐标里的位置与大小。 */
export interface FlowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 节点某一侧上**边真正接到的那一点**（流坐标）—— 与库 `getEdgePosition` / `getHandlePosition`
 * **同一个约定**。
 *
 * 🔴 这是教师 2026-10-07 第二次报障的根因：库给边的端点**不是节点边框上的那个点**，
 *    而是**句柄那个小方块的边**。库的 `getHandlePosition`（`@xyflow/system` 0.0.82）逐字是：
 *      `case Top:    return { x: x + width / 2, y };`              // 方块的**上边**
 *      `case Bottom: return { x: x + width / 2, y: y + height };`
 *      `case Left:   return { x, y: y + height / 2 };`
 *      `case Right:  return { x: x + width, y: y + height / 2 };`
 *    而句柄是**骑在边框上**的（库的 CSS：`top: 0` / `bottom: 0` + `translate(±50%, ±50%)`
 *    ⇒ 方块的中心正好落在边框线上）⇒ **端点比边框再往外半个方块**（`FLOW_HANDLE_HALF`）。
 *
 * 🔴 我们原来按「边框上的点」算，于是与库画出来的那条线**差 6px**。后果**只在两端现形**：
 *    · 绕行点的**能走范围**（`flowRouteTrack`）比线自己的宽松 6px ⇒ 拖到最两端时，
 *      控制柄停在「线已经到头」的地方，看着就是**偏出线外一点** ——
 *      竖直的边上下偏、水平的边左右偏（教师那两句描述正是这两件）；
 *    · 没拖到尽头时两边都不夹取 ⇒ 一模一样，**看不出来**。
 * ⚠️ 「一键整理」「交点节点」「吸附半径」「锚点表」全都建在这个函数上 —— 一起跟着准了。
 */
export function flowAnchorPoint(box: FlowBox, side: string): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (side === 'top') return { x: cx, y: box.y - FLOW_HANDLE_HALF };
  if (side === 'bottom') return { x: cx, y: box.y + box.height + FLOW_HANDLE_HALF };
  if (side === 'left') return { x: box.x - FLOW_HANDLE_HALF, y: cy };
  return { x: box.x + box.width + FLOW_HANDLE_HALF, y: cy };
}

/** 四个句柄的外法线（与库的 `handleDirections` 同一张表）。 */
const HANDLE_DIRECTIONS: Record<string, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * 绕行点**能走的那条线**：拖哪个轴、以及**能拖到哪儿**。
 *
 * 🔴 两个数都是**从库的算法里推出来的**（见文件头那一段），不是拍脑袋的余量：
 *    · `axis` —— 中段横着就上下拖、竖着就左右拖。**不能只看句柄 id**
 *      （同一个 `bottom→top`，源在上面时中段是横的、源在下面时中段是竖的）；
 *    · `min/max` —— 两个**留白点**之间。越过任一个，库就会在留白点上掉头
 *      （`getBend` 认出共线反向 ⇒ 直接画一根 `L`，线**原路折返**），正是教师图里那个「弧线折返」。
 *
 * ⚠️ `axis === 'x'` 且中段是**竖**的那一支（`verticalSplit`）：库在那里**不会折返**
 *    （留白点与中段同 y ⇒ 拐的是直角）—— 这里照样给范围，取的是「两个留白点的 x 之间」，
 *    意义上从「不能越过」变成了「别拖到两个框外面去」，同样是个合适的边界。
 *
 * ⚠️ 拐弯的边（两端句柄**相邻**）返回 `null`：库那一支**压根不读 center**
 *    ⇒ 给了把手也是「拖了没反应」（就是教师刚报过的那种错），调用方**不该给它画把手**。
 */
export function flowRouteTrack(params: FlowEdgeGeometryParams): FlowRouteTrack | null {
  const sourceDir = HANDLE_DIRECTIONS[params.sourcePosition];
  const targetDir = HANDLE_DIRECTIONS[params.targetPosition];
  if (!sourceDir || !targetDir) return null;
  const offset = params.offset ?? FLOW_EDGE_OFFSET;
  const sourceGapped = { x: params.sourceX + sourceDir.x * offset, y: params.sourceY + sourceDir.y * offset };
  const targetGapped = { x: params.targetX + targetDir.x * offset, y: params.targetY + targetDir.y * offset };
  /* 主方向：与库的 `getDirection` 同一条判据 —— **只看起点句柄在哪条轴**上。 */
  const vertical = params.sourcePosition === 'top' || params.sourcePosition === 'bottom';
  const accessor: 'x' | 'y' = vertical ? 'y' : 'x';
  const currDir = vertical
    ? (sourceGapped.y < targetGapped.y ? 1 : -1)
    : (sourceGapped.x < targetGapped.x ? 1 : -1);
  /* 两端句柄对着，库才会读 center；相邻的那一支整段不读（见文件头）。 */
  if (sourceDir[accessor] * targetDir[accessor] !== -1) return null;
  /* 对着的前提下：起点句柄与主方向**同向** ⇒ 中段横着（上下拖），否则中段竖着（左右拖）。 */
  const sameWay = sourceDir[accessor] === currDir;
  const middleIsVertical = accessor === 'x' ? sameWay : !sameWay;
  const axis: 'x' | 'y' = middleIsVertical ? 'x' : 'y';
  const low = axis === 'x'
    ? Math.min(sourceGapped.x, targetGapped.x)
    : Math.min(sourceGapped.y, targetGapped.y);
  const high = axis === 'x'
    ? Math.max(sourceGapped.x, targetGapped.x)
    : Math.max(sourceGapped.y, targetGapped.y);
  return { axis, min: low, max: high };
}

/** 绕行点能走的范围。 */
export interface FlowRouteTrack {
  /** 拖的是哪个坐标：`'x'` = 左右拖一条竖线，`'y'` = 上下拖一条横线。 */
  axis: 'x' | 'y';
  min: number;
  max: number;
}

/**
 * 把一个值夹进范围 —— 拖动时用它，`flowRoutePoint` 也用它。
 * ⚠️ 只在**越界**时生效（不是「永远取端点」）：否则拖动会变成一跳一跳的。
 */
export function clampToTrack(track: FlowRouteTrack, value: number): number {
  return Math.min(Math.max(value, track.min), track.max);
}

/**
 * **真正生效**的绕行点（流坐标）；没有可用的绕行点时回 `null`。
 *
 * 逐条：
 *   · 只认**自由轴**（`flowRouteTrack`）上的那个值 —— 另一条轴上的值可能是陈旧的
 *     （先连成水平的、拖过线，之后「一键整理」把句柄理成竖直的 ⇒ `routeX` 就留下来了），
 *     而库会把那个陈旧的 `centerX` 当成**标签的 x** 返回 ⇒ 线上的字被甩到线外；
 *   · 认了的那条轴要**夹进范围**（见 `flowRouteTrack`）—— 夹取放在**这里**而不是只在拖动时，
 *     是因为范围会**随着框移动而变**：拖到最下面，再把目标框往上拖，原来合法的那条横线
 *     就越界了 ⇒ 只夹拖动那一下的话，它照样会折返；
 *   · 另一条轴取**两端中点** —— 那正是库自己的默认值（`center.x ?? …`），
 *     也正是**线上文字**该在的位置（中段的正中间）。
 */
export function flowRoutePoint(params: FlowEdgeGeometryParams): { x: number; y: number } | null {
  const track = flowRouteTrack(params);
  if (!track) return null;
  const raw = track.axis === 'x' ? params.centerX : params.centerY;
  if (!Number.isFinite(raw)) return null;
  const value = clampToTrack(track, raw as number);
  return {
    x: track.axis === 'x' ? value : (params.sourceX + params.targetX) / 2,
    y: track.axis === 'y' ? value : (params.sourceY + params.targetY) / 2,
  };
}

/** 两端句柄是不是**同一条轴**上对着的（`bottom→top` / `top→bottom` / `right→left` / `left→right`）。 */
function isStraightPair(sourcePosition: string, targetPosition: string): 'v' | 'h' | null {
  const pair = `${sourcePosition}->${targetPosition}`;
  if (pair === 'bottom->top' || pair === 'top->bottom') return 'v';
  if (pair === 'right->left' || pair === 'left->right') return 'h';
  return null;
}

/**
 * 算一条边的路径：**有绕行点就按绕行点走**；**几乎是直线（而且两端同向）就真的画成直线**；
 * 其余一律交给注入的库函数。返回值与 `getSmoothStepPath` 同形：`[path, labelX, labelY]`。
 */
export function flowEdgeGeometry(
  params: FlowEdgeGeometryParams,
  smoothStep: SmoothStepFn,
): [string, number, number] {
  /*
   * ★ 2026-10-07（教师）：「水平方向上我可以调整一条竖线，**但在垂直方向上，我无法拖动去调整
   *   一条横线**」。
   * 🔴 根因：拖动时**只写了一个轴**（竖直的边写 `routeY`、水平的写 `routeX`），另一个是
   *    `undefined` ⇒ 门槛那句 `Number.isFinite(centerX) && Number.isFinite(centerY)` 不成立
   *    ⇒ **线纹丝不动**（拖了没反应，而控制柄照样跟着手指走，看着像「拖得动但线不动」）。
   * ✅ 现在由 `flowRoutePoint` 一处算清：认哪条轴、夹到哪儿、另一个轴补什么，全在那边。
   */
  const point = flowRoutePoint(params);
  if (point) return smoothStep({ ...params, centerX: point.x, centerY: point.y });

  /*
   * 没有可用的绕行点（没拖过 / 轴不对 / 拐弯的边）⇒ **一个都不传**。
   * ⚠️ 不能「原样透传」：轴不对的那个值会被库当成标签坐标（见 `flowRoutePoint`）。
   */
  const bare: FlowEdgeGeometryParams = { ...params, centerX: undefined, centerY: undefined };

  const axis = isStraightPair(params.sourcePosition, params.targetPosition);
  if (axis !== null) {
    const delta = axis === 'v'
      ? Math.abs(params.targetX - params.sourceX)
      : Math.abs(params.targetY - params.sourceY);
    if (delta < FLOW_STRAIGHT_SNAP) {
      /*
       * 折线太短 ⇒ 直接连一条直线。
       * ⚠️ 它**可能是斜的**（两端 x 差那几像素）—— 教师 2026-10-07 明确接受：
       *   「还是不要自动校正那个矩形框了，**斜线就斜线吧**」。
       *   ⊘ 别再加「快竖直就画成正的」那种矫正：他试过之后否掉了
       *     （矫正会让箭头落不到 target 上，为了补那个又得挪框，一环套一环，越弄越复杂）。
       */
      const midX = (params.sourceX + params.targetX) / 2;
      const midY = (params.sourceY + params.targetY) / 2;
      return [`M ${params.sourceX} ${params.sourceY} L ${params.targetX} ${params.targetY}`, midX, midY];
    }
  }
  return smoothStep(bare);
}
