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
  data?: { routeX?: number; routeY?: number; labelDX?: number; labelDY?: number } | null;
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
      /* ★ 2026-10-07（教师）：标签的偏移也是实质内容 —— 拖了标签必须**能撤销**，
         而指纹是「这一步算不算变化」的唯一判据（漏了它 = 拖标签不记步）。 */
      e.data?.labelDX ?? null, e.data?.labelDY ?? null,
    ]),
  ]);
}

/* ── 跨挂载存活的历史（★ 2026-10-06 教师在真机上发现全屏问题之后加的）────────────────

  🔴 **为什么需要它**：全屏必须走 `createPortal(content, document.body)` —— 去掉 portal 之后
  `position: fixed` 会被某个祖先劫持、全屏铺不满（详见 `drawing-tool-body.tsx` 那段注释，
  以及教师在真机上拍的那张图）。而**同一棵子树换个渲染位置 ⇒ React 卸载再挂载** ⇒ 画板实例重建
  ⇒ 上面这些历史住在 `useRef` 里，**当场归零**。

  ⇒ 历史必须存在**组件之外**，按一个**跨挂载稳定的 key** 索引（画板那边用题目 id）。
  ⚠️ 只在**传了 key** 时启用：没传就还是组件内的一份（`emptyHistory()`），行为与从前一样，
  别的三个画板、以及教师端的底稿编辑都不受影响。

  ⚠️ `HISTORY_KEYS_LIMIT` 是**必需**的：这是模块级的表，活到页面卸载为止。一份学习单里翻几十道题
  就会一直涨 ⇒ 超了丢**最久没用过**的那个 key（`Map` 保持插入序，重新读一次就把它挪到队尾）。
*/
const persistent = new Map<string, FlowHistory<FlowSnapshot<unknown, unknown>>>();

/** 表里最多留几个 key 的历史。12 足够覆盖「学生在一份学习单里来回翻题」的规模。 */
export const HISTORY_KEYS_LIMIT = 12;

/** 取某个 key 的历史；没存过就是**空历史**（不是 undefined —— 调用方直接当初始值用）。 */
export function loadHistory<S>(key: string): FlowHistory<S> {
  const hit = persistent.get(key);
  if (!hit) return emptyHistory<S>();
  // 重新插入 ⇒ 标记为「最近用过」（否则淘汰时会把正在做的那道题丢掉）。
  persistent.delete(key);
  persistent.set(key, hit);
  return hit as FlowHistory<S>;
}

/** 存某个 key 的历史，并把超过上限的最久未用者丢掉。 */
export function saveHistory<S>(key: string, history: FlowHistory<S>): void {
  persistent.delete(key);
  persistent.set(key, history as FlowHistory<FlowSnapshot<unknown, unknown>>);
  while (persistent.size > HISTORY_KEYS_LIMIT) {
    const oldest = persistent.keys().next().value;
    if (oldest === undefined) break;
    persistent.delete(oldest);
  }
}

/** 只给用例用：清空这张表（生产代码不调用 —— 它会一把抹掉所有题的历史）。 */
export function clearAllHistories(): void {
  persistent.clear();
}
