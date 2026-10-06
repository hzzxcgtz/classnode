/**
 * 绘图题的**底稿**（★ 2026-10-06，教师：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」）。
 *
 * 教师的三条决定（逐字）：
 *   · 「先拿流程图当试点」；
 *   · **A 底稿不算学生的作答** ⇒ 学生交上去的 `data` 里**只留他自己画的**；
 *   · B ~~学生不能改/删底稿~~ —— 2026-10-06 的第二次澄清曾把它反转成「学生可以随便改，靠
 *     『恢复初始图』回退」；**同日晚些时候又变回条件性**（教师：「信息科技课的作业常态是
 *     老师给一半，要求学生只补连线/填自己那部分，不许动老师的框」）：
 *       · **锁定初始图**（题目上没设过就是这一档）⇒ 底稿的框/边带锁，学生只能加；
 *       · 教师**取消锁定**（`drawingStarterLocked === false`）⇒ 一个锁标记都不许有，
 *         回到「学生可以改底稿 + 恢复初始图」那一档。
 *     ⇒ 下面 `mergeFlowchart` / `restoreFlowchart` 的 `locked` 参数就是这一档开关的落点。
 *
 * 🔴 为什么放在**单独一个纯模块**里：这里是「底稿 ⇄ 学生作答」的**唯一**换算处
 *    （合并给画板看、剔除后存回去）。两处各写一遍必然分叉 —— 而分叉的表现是
 *    「教师预览里少了一半图」或「学生的作答里混进了教师的节点」，两种都不报错。
 */

import type { DrawingMode } from './worksheet-drawing.ts';

/** 流程图那一份数据的形状（`{nodes, edges}`，与 React Flow / 预览器共用）。 */
export interface FlowchartPayload {
  nodes: Array<Record<string, unknown> & { id: string }>;
  edges: Array<Record<string, unknown> & { id: string }>;
}

export interface DrawingStarter {
  tool: DrawingMode;
  data: unknown;
  /**
   * ★ 2026-10-06（教师）：「**锁定初始图**」—— 学生只能添加，不能修改或删除老师给的框与连线。
   *
   * 🔴 数据上的语义是「**缺席 = 锁定**」：题目里那个字段（`drawingStarterLocked`）只有
   *    **显式 `false`**（教师主动取消锁定）才算未锁，其余一切（没设过 / `true` / 乱值）都是锁。
   *    ⇒ 信息科技课的常态（老师给一半、学生只补连线）不必教师手点，默认就是对的。
   */
  locked: boolean;
}

/** 读题目上那份底稿。认不出就回 `null`（**不抛**：题目数据可以被手改过）。 */
export function readDrawingStarter(node: { type?: string; data?: Record<string, unknown> }): DrawingStarter | null {
  if (node.type !== 'drawing') return null;
  const raw = node.data?.drawingStarter;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const tool = row.tool;
  if (tool !== 'flowchart' && tool !== 'mind-map' && tool !== 'math' && tool !== 'free') return null;
  if (!row.data || typeof row.data !== 'object') return null;
  // ★ 「缺席 = 锁定」就落在这一句上：只有显式 `false` 才是未锁。
  return { tool, data: row.data, locked: node.data?.drawingStarterLocked !== false };
}

/**
 * ★ 2026-10-06（教师）：「锁定初始图」开关**写回**什么（教师端那个 `role="switch"` 的 onChange）。
 *
 * 🔴 语义是「**缺席 = 锁定**」⇒ 勾上（锁）时把字段**清掉**（`undefined`，与 `drawingStarter: undefined`
 *    那一档同一个写法），**只有取消锁定**时才写 `false`。
 * ⚠️ 为什么单独做成一个**纯函数**、而不是在组件里现写一句：这条语义（字段名 + 有没有写反）必须能
 *    用**真调用**验 —— 在源码里正则猜 `event.target.checked` 的写法，改个变量名就红，守不住东西。
 *    往返用例在 `worksheet-drawing-starter.test.ts`（写回 ⇒ `readDrawingStarter` 读出来 == 开关位置）。
 */
export function drawingStarterLockPatch(locked: boolean): Record<string, unknown> {
  return { drawingStarterLocked: locked ? undefined : false };
}

/** 从任意值里读出一份流程图数据（缺 `nodes`/`edges` 就当空）。 */
export function readFlowchartPayload(raw: unknown): FlowchartPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { nodes: [], edges: [] };
  const row = raw as Record<string, unknown>;
  const withId = (value: unknown): value is Record<string, unknown> & { id: string } => !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === 'string';
  return {
    nodes: Array.isArray(row.nodes) ? row.nodes.filter(withId) : [],
    edges: Array.isArray(row.edges) ? row.edges.filter(withId) : [],
  };
}

/**
 * 剥掉**老数据里那一版「锁定」**留下的标记。
 *
 * 🔴 为什么必须有这一步（教师 2026-10-06：「我发现初始图中有的东西我改不了」）：
 *    上一版按 B 决定把锁定**写进了保存的数据**（`draggable: false` / `deletable: false` /
 *    `data.locked: true`）。后来 B 反转成「学生可以修改」，我去掉了**加锁的代码**，
 *    但**存量数据里的标记还在** —— 读回来时 `data.locked === true` 仍然让节点文字只读，
 *    `draggable: false` 仍然拖不动。**只改代码不改数据，表现就是「有的东西改不了」**。
 * ⇒ 在「初始图进入画板」这**唯一**的入口处剥干净：不管标记是从初始图来的还是从老草稿来的。
 * ⚠️ 只剥「锁」这三个标记，其余字段（`position`/`measured`/`data.label`…）原样保留。
 * ⚠️ 锁定那一档不是「不剥」—— 而是**先剥干净、再按本轮的开关统一打上**（见 `withLock`），
 *    这样「老数据里的锁」永远不会与「这一轮的开关」打架。
 */
// ⚠️ 泛型是**必须的**：入口的负载类型是 `Record<string, unknown> & { id: string }`，
//    若这里退回成裸 `Record<string, unknown>`，调用点会因为「丢了 id」而报类型错 ——
//    而「为了消错」在调用点强转，等于把这条闸关掉（本仓反复防的就是这个）。
//    末尾的 `as T` 成立的理由：这里只**删**键，不新增、不改类型。
function withoutLegacyLocks<T extends Record<string, unknown>>(item: T): T {
  const rest: Record<string, unknown> = { ...item };
  delete rest.draggable;
  delete rest.deletable;
  const data = rest.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nextData: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    delete nextData.locked;
    rest.data = nextData;
  }
  return rest as T;
}

/**
 * 给**初始图**里的一件东西打上「老师的，动不了」的标记（只在 `locked` 那一档用）。
 *
 * 🔴 三个标记各管一条**不同的**路，缺一条就有一条路漏（都是读过库源码/实测过的）：
 *   · `draggable: false` —— React Flow 的拖动闸。库那句是
 *     `isDraggable = !!(node.draggable || (nodesDraggable && typeof node.draggable === 'undefined'))`
 *     ⇒ 它的**优先级高于**全局 `nodesDraggable`（画板给的是 `!disabled`）。边不读它，多一个无妨。
 *   · `deletable: false`  —— 库的 `getElementsToRemove` 里 `node.deletable === false`/`edge.deletable !== false`
 *     两道 filter ⇒ **键盘 Delete 与选中删除**都不会碰上老师的东西（连「删学生的框时顺手带走老师的线」
 *     也不会：相连的边只在 `deletableEdges` 里找）。
 *   · `data.locked: true` —— 我们自己的节点文字输入框（`FlowNodeEditor` 的 `disabled`）认它。
 * ⚠️ 边没有 `data`（我们的边负载里就没有这个字段），所以边只靠 `deletable`；
 *    学生端「改线的文字」那条路另有判据（按 id，见 `flowchart-drawing.tsx`）。
 */
function withLock<T extends Record<string, unknown>>(item: T): T {
  const data = item.data;
  const lockedData = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), locked: true }
    : data;
  return {
    ...item,
    draggable: false,
    deletable: false,
    ...(lockedData === data ? {} : { data: lockedData }),
  } as T;
}

/** 先剥老锁、再按本轮的开关决定要不要打上（`locked` 只有真假两档，不留第三态）。 */
function withLegacyLocksHandled<T extends Record<string, unknown>>(item: T, locked: boolean): T {
  const clean = withoutLegacyLocks(item);
  return locked ? withLock(clean) : clean;
}

/**
 * 画板要显示的那份 = **底稿 + 学生自己画的**（按 id 去重，底稿优先）。
 *
 * ★ 2026-10-06（教师）：第三个参数就是「锁定初始图」那一档 —— 学生端把 `readDrawingStarter` 读出来的
 *   `locked` 原样递进来，**这里是它唯一的落点**：
 *     · `locked === true` （默认档）⇒ 初始图那一份带上面那三个锁标记，学生只能加；
 *     · `locked === false`（教师主动取消）⇒ 一个标记都不许有，学生可以随便改（回退靠「恢复初始图」）。
 * ⚠️ 学生**自己**那份（`mine`）无论哪一档都不加锁；同时照样剥一遍老标记 ——
 *    存量草稿里若混进过 `data.locked`，未锁那一档的「有的东西改不了」会原样复发。
 * ⚠️ `locked` 是**必填**的：漏传就是「这一档没人决定」，而那正好会把锁静默地漏掉或乱加。
 */
export function mergeFlowchart(starter: FlowchartPayload, mine: FlowchartPayload, locked: boolean): FlowchartPayload {
  const starterNodeIds = new Set(starter.nodes.map((node) => node.id));
  const starterEdgeIds = new Set(starter.edges.map((edge) => edge.id));
  const mineClean = (item: Record<string, unknown> & { id: string }) => withoutLegacyLocks(item);
  return {
    // 2026-10-06 第四版（教师）：「锁定初始图」= 一题一个开关，见上面那段。
    nodes: [
      ...starter.nodes.map((item) => withLegacyLocksHandled(item, locked)),
      ...mine.nodes.map(mineClean).filter((node) => !starterNodeIds.has(node.id)),
    ],
    edges: [
      ...starter.edges.map((item) => withLegacyLocksHandled(item, locked)),
      ...mine.edges.map(mineClean).filter((edge) => !starterEdgeIds.has(edge.id)),
    ],
  };
}

/**
 * 「恢复初始图」：把画板内容重置回教师给的那份（不看学生改过什么）。
 *
 * ⚠️ 同样按 `locked` 决定要不要留锁：未锁时恢复完必须是**能改**的；锁定时（学生端根本不显示这颗
 *    按钮，见 `flowchart-drawing.tsx`）恢复出来的也仍是锁定的初始图 —— 两个入口的语义不许分叉。
 */
export function restoreFlowchart(starter: FlowchartPayload, locked: boolean): FlowchartPayload {
  return {
    nodes: starter.nodes.map((item) => withLegacyLocksHandled(item, locked)),
    edges: starter.edges.map((item) => withLegacyLocksHandled(item, locked)),
  };
}

export function subtractFlowchart(all: FlowchartPayload, starter: FlowchartPayload): FlowchartPayload {
  const starterNodeIds = new Set(starter.nodes.map((node) => node.id));
  const starterEdgeIds = new Set(starter.edges.map((edge) => edge.id));
  return {
    nodes: all.nodes.filter((node) => !starterNodeIds.has(node.id)),
    edges: all.edges.filter((edge) => !starterEdgeIds.has(edge.id)),
  };
}
