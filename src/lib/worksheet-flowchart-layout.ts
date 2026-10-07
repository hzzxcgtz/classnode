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

/*
 * ── 拖动时的「同列吸附」（★ 2026-10-07 教师）────────────────────────────────
 *
 * 起因是一串连锁：教师先说「连接线接近直线时要吸附成直线，否则会出现一个非常小的拐角」，
 * 做完之后又发现**直线是斜的** —— 而这是几何上的死结：
 *
 * 🔴 一条边**必须**从 source 的句柄出发、到 target 的句柄结束（不然箭头对不上框）。
 *    两端 x 只差一点点时：画折线 ⇒ 中间那段几像素的横线（疙瘩）；画直线 ⇒ **必然斜那几像素**。
 *    **「完全直」与「两端 x 不同」不可能同时成立** ⇒ 唯一能根治的，是让**两端的 x 真的相等**。
 *
 * ✅ 所以这一条管的是**节点位置**（拖框时吸附对齐），不是线的画法。
 *    线那边「短了就画直」照旧留着（`@/lib/worksheet-flowchart-edge.ts`）—— 它兜住「没吸上」的情况。
 */

/**
 * 「几乎同列」的容差（流坐标）—— **半个节点宽**。
 *
 * ⊘ 2026-10-07 先取过 12px，教师当场否掉：他截图里那条线斜了约 45px，12px 根本够不着
 *   （「我是指这根线不要倾斜……出现这样的倾斜箭头时，上面的图形应该自动向右偏移」）。
 * ✅ 改成半个节点宽（默认 150 的一半）：**只要两个框还叠着一半以上就吸齐**；
 *   超过它才算「学生故意把这俩错开」，那时候不该动手。
 *
 * ⚠️ 吸附**只在拖动时**发生 ⇒ 已经放好的框不会被它偷偷挪走。
 */
export const ALIGN_SNAP_TOLERANCE = 75;

/**
 * 拖动中，算出被拖的节点该吸到什么 x；没什么可吸的返回 `null`（调用方据此什么都不做）。
 *
 * ✅ 只动**被拖的那个** —— 邻居一个都不碰（用户刚放好的框不该被拽走）。
 * ✅ 只看**有连线相连**的：这是为了让**那条线**变直，不是「所有框都对齐」。
 * ✅ 多个邻居时取**最近**的那一个；自环、以及另一头不在画布上的边一律跳过。
 */
export function alignSnapX(
  nodes: readonly TidyNodeLike[],
  edges: readonly TidyEdgeLike[],
  movedId: string,
  tolerance = ALIGN_SNAP_TOLERANCE,
): number | null {
  const moved = nodes.find((node) => node.id === movedId);
  if (!moved) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  let best: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const otherId = edge.source === movedId ? edge.target : edge.target === movedId ? edge.source : null;
    if (otherId === null || otherId === movedId) continue; // 与它无关的边 / 自环
    const other = byId.get(otherId);
    if (!other) continue; // 另一头不在画布上
    const delta = Math.abs(other.position.x - moved.position.x);
    if (delta <= tolerance && delta < bestDelta) {
      best = other.position.x;
      bestDelta = delta;
    }
  }
  return best;
}
