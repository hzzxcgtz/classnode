/**
 * 「一键整理」的算法 —— **保守对齐**（★ 2026-10-06 教师报的问题后重写）。
 *
 * 🔴 教师的原话：「『一键整理』会打乱我原有的结果，我的本意是简单的根据原有结构对对齐，
 *    连接线整理一下即可」。
 *
 * 被换掉的那一版（原来长在 `flowchart-drawing.tsx` 里的 `layoutFlowchart`）做的是
 * **推倒重来式的分层排版**：按出入度重新算层级、每行重新水平居中、间距写死 64/58，
 * 还把所有边的句柄一起重算。学生/教师摆好的结构于是被整体打散 —— 那不是「整理」。
 *
 * 🔴 这一版的契约是**「别动我摆好的东西」**，逐条：
 *    · **不重新分层** —— 一个框原本在另一个下方，整理后仍在下方。这里没有任何拓扑排序，
 *      连线只被读取来「理顺」，从不被用来决定谁上谁下；
 *    · **只吸「本来就快齐了」的** —— 中心线相距 `ALIGN_TOLERANCE` 以内的框才归为一组，
 *      组内取**平均**（整体位移最小）；差得多的**一根手指都不碰**；
 *    · **不动路由点** —— 学生手调过的 `data.routeX/routeY` 原样带走；
 *    · **不碰视图** —— 缩放/平移是调用方的事（旧版在这里 `fitView`，也是「被打乱」的一部分）。
 *
 * ⚠️ **连接点（`junction`）不参与对齐**：它不是「摆」上去的，是「连」出来的 ——
 *    位置就意味着「它在那条线上」。把它吸到别处只会让线从点上脱开。
 *    （已知限制：如果一条线的两端都被对齐搬走了，那颗点会留在原处。等真有教师报再说。）
 */

/**
 * ★ 2026-10-06（教师批图：「**这个点的移动要定个范围**」）：**连接点只能沿它所在的那条线走**。
 *
 * 🔴 连接点（`junction`）不是「摆」上去的，是「连到线上」时**插进那条线里**的 ——
 *    它的位置本身就意味着「它在这条线上」。学生把它往左右一拖，两侧的线段为了接上它就会
 *    **折返绕弯**，看起来像箭头画错了（教师真机上拍到的正是这个）。
 *
 * ✅ 约束：**锁住一个轴** —— 竖线上的点只许上下走（锁 x）、横线上的只许左右走（锁 y）。
 *    为什么是「沿轴」而不是「沿整条路径」：规范状态下连接点两侧的两段线本来就是**共线**的
 *    （它插在一条直线上），沿轴就够了；沿路径投影要复刻一遍折线算法，收益不成比例。
 *
 * ⚠️ 锁的**值**取两侧邻居的**中心**（= 那条线的位置），**不是**连接点自己的当前位置 ——
 *    否则它一旦已经被拖偏，就会被永远锁在偏的地方（用例里有一条专门钉这个）。
 *
 * ⚠️ 邻居不足两个时**不给锁**：线的一端、或孤立点，没有「线」可言，硬锁反而把它锁死。
 */
export function junctionAxisLocks(
  nodes: readonly TidyNodeLike[],
  edges: readonly TidyEdgeLike[],
): Map<string, { axis: 'x' | 'y'; value: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const locks = new Map<string, { axis: 'x' | 'y'; value: number }>();
  const centerX = (node: TidyNodeLike) => node.position.x + widthOf(node) / 2;
  const centerY = (node: TidyNodeLike) => node.position.y + heightOf(node) / 2;

  for (const node of nodes) {
    if (kindOf(node) !== 'junction') continue;
    const neighbours = edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => byId.get(edge.source === node.id ? edge.target : edge.source))
      .filter((other): other is TidyNodeLike => other !== undefined && other.id !== node.id);
    if (neighbours.length < 2) continue;
    const [a, b] = neighbours;
    // 哪个方向的跨度大，这条线就是哪个走向 ⇒ 锁住**另一个**轴。
    const vertical = Math.abs(centerY(b) - centerY(a)) >= Math.abs(centerX(b) - centerX(a));
    locks.set(node.id, vertical
      ? { axis: 'x', value: (centerX(a) + centerX(b)) / 2 }
      : { axis: 'y', value: (centerY(a) + centerY(b)) / 2 });
  }
  return locks;
}

/** 参与对齐与否只看这几个字段 —— 不 import `@xyflow/react`，这个模块保持纯净。 */
export interface TidyNodeLike {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number } | null;
  data?: { kind?: string } | null;
}

export interface TidyEdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * 「算同一条线」的容差（流坐标）。
 * 半个处理框高（54 / 2 = 27）再收一点 —— 再大就会把学生**故意错开**的两行也吸到一起，
 * 那又变成「打乱」了。宁可少吸，不可错吸：没吸的行，教师再点一次也还是那样；
 * 吸错的行，教师只能一个个拖回去。
 */
const ALIGN_TOLERANCE = 24;

/** 尺寸兜底：与画板原先那套一致（`measured` 是 React Flow 量出来的真实尺寸，通常都在）。 */
function widthOf(node: TidyNodeLike): number {
  if (node.measured?.width) return node.measured.width;
  return kindOf(node) === 'junction' ? 8 : 150;
}
function heightOf(node: TidyNodeLike): number {
  if (node.measured?.height) return node.measured.height;
  const kind = kindOf(node);
  return kind === 'decision' ? 84 : kind === 'junction' ? 8 : 54;
}
function kindOf(node: TidyNodeLike): string {
  return node.data?.kind ?? 'process';
}

/**
 * 把一串**一维坐标**按 `ALIGN_TOLERANCE` 聚成若干组，返回每组统一后的值。
 *
 * 判据是「与**组首**（这一组最靠前的那个）相差不超过容差」，不是「与上一个相差不超过容差」——
 * 后者会链式地把 100/120/140 串成一组（首尾差 40，早就不算「在一条线上」了）。
 */
function clusterValues(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const out = new Map<number, number>();
  let group: number[] = [];
  const flush = () => {
    if (group.length === 0) return;
    // 取平均：组内每个框的位移都最小，不会有「整排往一个方向挪」的突兀感。
    const target = group.reduce((sum, value) => sum + value, 0) / group.length;
    for (const value of group) out.set(value, target);
    group = [];
  };
  for (const value of sorted) {
    if (group.length > 0 && value - group[0] > ALIGN_TOLERANCE) flush();
    group.push(value);
  }
  flush();
  return out;
}

/**
 * 按两端**当前的相对位置**给一条边选句柄 —— 只理顺「从哪边出、进哪边」，
 * 不改 source/target（那是拓扑，不归整理管）。
 *
 * 主方向取 |dy| 与 |dx| 里大的那个：上下关系为主就走上下，左右关系为主就走左右。
 * 平手（|dy| === |dx|）算竖直 —— 与画板里「流程图默认自上而下」的直觉一致。
 */
function handlesFor(
  sourceCenter: { x: number; y: number },
  targetCenter: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dy = targetCenter.y - sourceCenter.y;
  const dx = targetCenter.x - sourceCenter.x;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' };
  }
  return dx >= 0
    ? { sourceHandle: 'right', targetHandle: 'left' }
    : { sourceHandle: 'left', targetHandle: 'right' };
}

/**
 * 整理一份流程图：**吸附对齐**（横/纵各一次）+ **理顺连线句柄**。
 *
 * ⚠️ 纯函数：不改传进来的数组与对象，返回全新的一份（React Flow 那套是受控数据流，
 *    就地改会让 `useNodesState` 看不到变化）。
 */
export function tidyFlowchart<N extends TidyNodeLike, E extends TidyEdgeLike>(
  nodes: N[],
  edges: E[],
): { nodes: N[]; edges: E[] } {
  if (nodes.length === 0) return { nodes, edges };

  /** 连接点不参与对齐（见文件头 ⚠️）。 */
  const alignable = nodes.filter((node) => kindOf(node) !== 'junction');

  const centerX = new Map<string, number>();
  const centerY = new Map<string, number>();
  for (const node of alignable) {
    centerX.set(node.id, node.position.x + widthOf(node) / 2);
    centerY.set(node.id, node.position.y + heightOf(node) / 2);
  }

  const alignedY = clusterValues([...centerY.values()]);
  const alignedX = clusterValues([...centerX.values()]);

  const nextNodes = nodes.map((node) => {
    const nextY = alignedY.get(centerY.get(node.id) ?? Number.NaN);
    const nextX = alignedX.get(centerX.get(node.id) ?? Number.NaN);
    // 连接点、以及任何没进聚类的，原样带走。
    if (nextY === undefined || nextX === undefined) return node;
    return {
      ...node,
      position: {
        x: nextX - widthOf(node) / 2,
        y: nextY - heightOf(node) / 2,
      },
    };
  });

  // 句柄按**整理后**的位置算 —— 对齐会把「上下关系」和「左右关系」的强弱翻过来，
  // 用旧坐标选出来的句柄可能正好选反。
  const byId = new Map(nextNodes.map((node) => [node.id, node]));
  const centerOf = (node: TidyNodeLike) => ({
    x: node.position.x + widthOf(node) / 2,
    y: node.position.y + heightOf(node) / 2,
  });
  const nextEdges = edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    // 自环、或端点不在画布上的边：不猜，原样留着。
    if (!source || !target || source === target) return edge;
    const handles = handlesFor(centerOf(source), centerOf(target));
    return { ...edge, ...handles };
  });

  return { nodes: nextNodes, edges: nextEdges };
}
