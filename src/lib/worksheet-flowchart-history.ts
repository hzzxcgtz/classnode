/**
 * 流程图画板的**撤销/重做**（★ 2026-10-06 教师：「流程图要提供撤销/重做功能」）。
 *
 * 🔴 **快照栈**：每一步存整份 `{nodes, edges}`。选它而不是「命令栈（正/反向 patch）」的理由：
 *    这仓里最容易出错的地方从来不是内存，而是**「有一处入口忘了接上」** —— 命令栈要给十来种
 *    操作各写一对正反向，漏掉任一种的表现是「撤销时那个动作被静默跳过」；快照栈天然免疫。
 *    代价（每步一份全量）对几十个框的流程图可忽略。上限 `HISTORY_LIMIT`。
 *
 * ⚠️ **纯函数，零 import**（不 import React、不 import `@xyflow/react`）——
 *    这样 `node --test` 能直接加载它写真单元测试（本仓没有 jsdom）。
 *    类型用**结构类型**，调用方传自己的节点即可。
 */

/** 只读这几个字段 —— 与 `worksheet-flowchart-layout.ts` 同一套做法。 */
export interface HistoryNodeLike {
  id: string;
  position: { x: number; y: number };
  /** ⚠️ `selected` / `measured` **刻意不在这里**：指纹必须看不见它们，见 `flowchartSignature`。 */
  data?: { label?: string; kind?: string; locked?: boolean } | null;
}

export interface HistoryEdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
  data?: { routeX?: number; routeY?: number } | null;
}

export interface FlowSnapshot<N = unknown, E = unknown> { nodes: N[]; edges: E[] }

export interface FlowHistory<S> { past: S[]; future: S[] }

/**
 * 栈深上限。50 步够学生「画错 → 退回去」用；超出丢**最老**的那一头。
 * 🔴 丢最新那头的写法（`past.slice(0, LIMIT)` 之类写反）会让撤销键在画了很久之后突然失灵。
 */
export const HISTORY_LIMIT = 50;

export function emptyHistory<S>(): FlowHistory<S> {
  return { past: [], future: [] };
}

export function canUndo<S>(h: FlowHistory<S>): boolean {
  return h.past.length > 0;
}

export function canRedo<S>(h: FlowHistory<S>): boolean {
  return h.future.length > 0;
}

/**
 * 记一步。`prev` 是**变化前**那一份快照 —— 撤销就是回到它。
 * ⚠️ 新操作**清空 future**（标准行为）：撤销后又改了一笔，原来那条「未来」就不该再存在，
 *    否则重做会跳到一条**从未存在过**的分支上。
 */
export function pushHistory<S>(h: FlowHistory<S>, prev: S): FlowHistory<S> {
  const past = [...h.past, prev];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  };
}

/**
 * 撤销一步：弹出 `past` 的最后一份，并把 `current` 推进 `future`（这样还能重做回来）。
 * 栈空时返回 `null` —— 调用方据此什么都不做（按钮也据此变灰）。
 * ⚠️ 不改传进来的 `h`（返回新对象），与仓里其他 lib 一致，也让测试能直接比。
 */
export function undoHistory<S>(h: FlowHistory<S>, current: S): { history: FlowHistory<S>; snapshot: S } | null {
  if (h.past.length === 0) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [current, ...h.future] },
    snapshot: h.past[h.past.length - 1],
  };
}

export function redoHistory<S>(h: FlowHistory<S>, current: S): { history: FlowHistory<S>; snapshot: S } | null {
  if (h.future.length === 0) return null;
  return {
    history: { past: [...h.past, current], future: h.future.slice(1) },
    snapshot: h.future[0],
  };
}

/**
 * 把一份图压成一个**指纹**，用来回答「这一次变化算不算一步」。
 *
 * 🔴 **只取实质字段**：React Flow 的 `onNodesChange` 不只为「拖动」触发，**也为「选中」和
 *    「尺寸测量」触发**。不滤掉这两类的话，学生**点一下框就等于做了一步** —— 而且按第一次
 *    撤销看不出错（撤掉的是那次点击），要按到第二次才发现「怎么退了两步」。
 *
 * ⚠️ 读的是**原始** `nodes`/`edges`，**不是** `visibleNodes`/`visibleEdges` ——
 *    后者被 `useMemo` 加工过（补了 `locked`、`markerEnd`、高亮 `className`），
 *    那些是渲染产物，不是学生的编辑。
 */
export function flowchartSignature(
  nodes: readonly HistoryNodeLike[],
  edges: readonly HistoryEdgeLike[],
): string {
  return JSON.stringify([
    nodes.map((n) => [
      n.id, n.position.x, n.position.y,
      n.data?.label ?? '', n.data?.kind ?? '', n.data?.locked === true,
    ]),
    edges.map((e) => [
      e.id, e.source, e.target,
      e.sourceHandle ?? '', e.targetHandle ?? '',
      typeof e.label === 'string' ? e.label : '',
      e.data?.routeX ?? null, e.data?.routeY ?? null,
    ]),
  ]);
}
