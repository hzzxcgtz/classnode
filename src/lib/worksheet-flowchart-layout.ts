/**
 * 「一键整理」的算法 —— **保守微调**（★ 2026-10-06 报的问题后重写；★ 2026-10-07 又收窄一次）。
 *
 * ★ 2026-10-07（教师，逐字）：「这个按钮的功能**只在微调**连接线和矩形的位置布局。注意只是微调，
 *   比如把连接线当中的一些**很小的折线去掉，变成一根直线**，**不要去改变整个流程图各个图形的布局**，
 *   另外**也不要去改变连接线所连接图形的节点**，这些都要保持原样。」
 *   ⇒ 两件事：
 *     · **只动矩形的位置**（吸附对齐 —— 两个框差一点点时把它们吸齐，连线自然就直了）；
 *     · **连线一个字都不动**（⊘ 原来这里还会按两端相对位置**重挑句柄** ——
 *       那是 2026-10-06「只对齐 + 理顺连线」那一版的产物，教师现在明确否掉了：
 *       「连接线所连接的**节点**」（= 图形上的那几个连接点）要保持原样）。
 *
 * ⚠️ 「把很小的折线去掉」**是靠挪框实现的**，不是靠把线画斜：两个框的中心差在容差内就吸齐，
 *    底部→顶部那条线自然成了**严格的竖线**（与 2026-10-07「一条斜线都不画」那条规矩相容）。
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

  /*
   * ★ 2026-10-07（教师）：「**也不要去改变连接线所连接图形的节点**（那几个连接点），
   *   这些都要保持原样」⇒ 连线**一个字段都不动**，原样返回。
   * ⊘ 这里原来会按两端整理后的相对位置**重挑句柄**（`handlesFor`）—— 已删。
   *   ⚠️ 别把它加回来：教师看的是「他连好的那根线有没有被搬到另一条边上」。
   */
  return { nodes: nextNodes, edges };
}
