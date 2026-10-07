/**
 * 绘图题的**底稿**（★ 2026-10-06，教师：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」）。
 *
 * 教师的三条决定（逐字）：
 *   · 「先拿流程图当试点」；
 *   · **A 底稿不算学生的作答** ⇒ 学生交上去的 `data` 里**只留他自己画的**；
 *   · B **底稿永远可改可删**（2026-10-06 教师最终拍板，逐字：
 *     「我觉得教师把初始图锁定也不对，这样学生端很多操作都无法进行了，我觉得还是不要锁定，
 *      因为学生端已经有恢复初始图功能了。」）
 *     ⇒ 这里**没有**「锁定初始图」这一档：
 *       · 底稿的框可以拖、可以删、文字可以改；底稿的连线可以删、也可以改标注；
 *       · 回退**只靠「恢复初始图」**（学生端那颗按钮无条件出现，见 `flowchart-drawing.tsx`）；
 *       · 题目数据里那个历史字段（`drawingStarterLocked`）**一律忽略** —— 不迁移、不写回、不报错。
 *
 * 🔴 为什么放在**单独一个纯模块**里：这里是「底稿 ⇄ 学生作答」的**唯一**换算处
 *    （合并给画板看、剔除后存回去）。两处各写一遍必然分叉 —— 而分叉的表现是
 *    「教师预览里少了一半图」或「学生的作答里混进了教师的节点」，两种都不报错。
 */

import type { DrawingMode } from './worksheet-drawing.ts';
import { flowchartSvg } from './worksheet-flowchart-svg.ts';

/** 流程图那一份数据的形状（`{nodes, edges}`，与 React Flow / 预览器共用）。 */
export interface FlowchartPayload {
  nodes: Array<Record<string, unknown> & { id: string }>;
  edges: Array<Record<string, unknown> & { id: string }>;
  deletedNodeIds?: string[];
  deletedEdgeIds?: string[];
}

export interface DrawingStarter {
  tool: DrawingMode;
  data: unknown;
}

/**
 * 读题目上那份底稿。认不出就回 `null`（**不抛**：题目数据可以被手改过）。
 *
 * 🔴 2026-10-06（教师最终拍板）：**不再回 `locked`** —— 「锁定初始图」那一档整个撤掉了，
 *    底稿永远可改可删。题目数据里那个历史字段（`drawingStarterLocked`）在这里**一个字都不读**：
 *    已保存的题可能带着它（`true` / `false` / 乱值），一律忽略 —— 不迁移、不写回、不报错。
 */
export function readDrawingStarter(node: { type?: string; data?: Record<string, unknown> }): DrawingStarter | null {
  if (node.type !== 'drawing') return null;
  const raw = node.data?.drawingStarter;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const tool = row.tool;
  if (tool !== 'flowchart' && tool !== 'mind-map' && tool !== 'math' && tool !== 'free') return null;
  if (!row.data || typeof row.data !== 'object') return null;
  return { tool, data: row.data };
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
    ...(Array.isArray(row.deletedNodeIds) ? { deletedNodeIds: row.deletedNodeIds.filter((id): id is string => typeof id === 'string') } : {}),
    ...(Array.isArray(row.deletedEdgeIds) ? { deletedEdgeIds: row.deletedEdgeIds.filter((id): id is string => typeof id === 'string') } : {}),
  };
}

/**
 * 剥掉**老数据里那一版「锁定」**留下的标记。
 *
 * 🔴 为什么必须有这一步（教师 2026-10-06：「我发现初始图中有的东西我改不了」）：
 *    更早那一版把锁定**写进了保存的数据**（`draggable: false` / `deletable: false` /
 *    `data.locked: true`）。锁定这一档整个撤掉之后，**存量数据里的标记还在** ——
 *    读回来时 `data.locked === true` 仍然让节点文字只读，`draggable: false` 仍然拖不动。
 *    **只改代码不改数据，表现就是「有的东西改不了」**。
 * ⇒ 在「初始图进入画板」这**唯一**的入口处剥干净：不管标记是从初始图来的还是从老草稿来的。
 *   ⚠️ 底稿与**学生自己那份**都剥（学生那份的历史草稿里也可能混进过这些标记）。
 * ⚠️ 只剥「锁」这三个标记，其余字段（`position`/`measured`/`data.label`…）原样保留。
 * ⚠️ 现在**没有**「再按开关打上」那一步（`withLock` 随那一档一起删了）—— 剥完就是最终形态。
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
 * 画板要显示的那份 = **底稿 + 学生自己画的**（按 id 去重，底稿优先）。
 *
 * ★ 2026-10-06（教师最终拍板）：**没有第三个参数了** —— 「锁定初始图」那一档撤掉之后，
 *   底稿与学生自己那份走**同一条**处理（`withoutLegacyLocks`）：剥掉老数据里的锁标记、
 *   一个标记都不打 ⇒ 底稿的框/线永远可拖可删、文字可改。
 *   ⚠️ 以前那第三个 `locked` 参数是「两档开关」的落点；**别**把它加回来 —— 加回来就等于
 *      「有的东西学生改不了」，而回退只有「恢复初始图」一条路（见下）。
 */
export function mergeFlowchart(starter: FlowchartPayload, mine: FlowchartPayload): FlowchartPayload {
  const clean = (item: Record<string, unknown> & { id: string }) => withoutLegacyLocks(item);
  const mineNodes = new Map(mine.nodes.map((node) => [node.id, clean(node)]));
  const mineEdges = new Map(mine.edges.map((edge) => [edge.id, clean(edge)]));
  const deletedNodeIds = new Set(mine.deletedNodeIds ?? []);
  const deletedEdgeIds = new Set(mine.deletedEdgeIds ?? []);
  const starterNodeIds = new Set(starter.nodes.map((node) => node.id));
  const starterEdgeIds = new Set(starter.edges.map((edge) => edge.id));
  return {
    nodes: [
      ...starter.nodes.filter((node) => !deletedNodeIds.has(node.id)).map((node) => mineNodes.get(node.id) ?? clean(node)),
      ...mine.nodes.map(clean).filter((node) => !starterNodeIds.has(node.id)),
    ],
    edges: [
      ...starter.edges.filter((edge) => !deletedEdgeIds.has(edge.id) && !deletedNodeIds.has(String(edge.source)) && !deletedNodeIds.has(String(edge.target)))
        .map((edge) => mineEdges.get(edge.id) ?? clean(edge)),
      ...mine.edges.map(clean).filter((edge) => !starterEdgeIds.has(edge.id)),
    ],
  };
}

/**
 * 「恢复初始图」：把画板内容重置回教师给的那份（不看学生改过什么）。
 *
 * ⚠️ 这是**唯一**的回退路径（「锁定初始图」撤掉之后，学生端那颗按钮无条件出现）。
 *    恢复出来的底稿同样是**能改**的：老数据里的锁标记照剥（`withoutLegacyLocks`）——
 *    两个入口（合并 / 恢复）的语义不许分叉。
 */
export function restoreFlowchart(starter: FlowchartPayload): FlowchartPayload {
  return {
    nodes: starter.nodes.map((item) => withoutLegacyLocks(item)),
    edges: starter.edges.map((item) => withoutLegacyLocks(item)),
  };
}

export function subtractFlowchart(all: FlowchartPayload, starter: FlowchartPayload): FlowchartPayload {
  const starterNodes = new Map(starter.nodes.map((node) => [node.id, node]));
  const starterEdges = new Map(starter.edges.map((edge) => [edge.id, edge]));
  const allNodeIds = new Set(all.nodes.map((node) => node.id));
  const allEdgeIds = new Set(all.edges.map((edge) => edge.id));
  const comparable = (item: Record<string, unknown>, kind: 'node' | 'edge') => {
    const keys = kind === 'node'
      ? ['id', 'type', 'position', 'data']
      : ['id', 'source', 'target', 'sourceHandle', 'targetHandle', 'type', 'label', 'data'];
    return JSON.stringify(Object.fromEntries(keys.map((key) => [key, item[key] ?? null])));
  };
  const deletedNodeIds = [...starterNodes.keys()].filter((id) => !allNodeIds.has(id));
  const deletedEdgeIds = [...starterEdges.keys()].filter((id) => !allEdgeIds.has(id));
  return {
    nodes: all.nodes.filter((node) => {
      const base = starterNodes.get(node.id);
      return !base || comparable(node, 'node') !== comparable(base, 'node');
    }),
    edges: all.edges.filter((edge) => {
      const base = starterEdges.get(edge.id);
      return !base || comparable(edge, 'edge') !== comparable(base, 'edge');
    }),
    ...(deletedNodeIds.length > 0 ? { deletedNodeIds } : {}),
    ...(deletedEdgeIds.length > 0 ? { deletedEdgeIds } : {}),
  };
}

/**
 * 教师看板那一格在**快照还没到**时画什么（★ 2026-10-07 教师两条报障）。
 *
 * 教师：「① 教师的**初始图还是没有一次性出来**……期望的是：如果教师有初始图，那么学生在真正
 * 画图之前，初始图已经出现在了监控面板里」；「② 刚开始显示的**菱形图形会显示成矩形**，
 * 刷新几次后就变成正常的菱形了」。
 *
 * 🔴 两条都出在那块**近似渲染**上（`drawing-document-preview.tsx` 的 `FlowPreview`）：
 *     那一格本来该显示**快照**，而快照要等学生端抓图 + 上传（一两秒）；在那之前走近似渲染，它
 *       · 只会画**圆角矩形** ⇒ 菱形看起来就是矩形（「刷新几次就正常」= 快照终于到了）；
 *       · 拿到的只有**学生自己那份数据**，而底稿按设计不在里面（「底稿不算学生的作答」）
 *         ⇒ 学生还没动笔时是一张白纸。
 *
 * ✅ 换成正解：**和快照用同一个渲染器**（`flowchartSvg`），输入是「底稿 + 学生画的」
 *    （`mergeFlowchart`，与画板读数据时同一个函数）⇒ 这块与最终那张图**长得一模一样**，
 *    而且**没有第二套画法**（近似渲染那 40 行连同它的分叉一起删掉）。
 * ⚠️ 返回 data URL（不落盘、不占网络）—— 它只是一张临时的占位图，快照一到就被替掉。
 */
export function flowchartPreviewImage(starter: unknown, mine: unknown): string | null {
  /*
   * ⚠️ `starter` 是**信封**（`{ tool, data }`，`readDrawingStarter` 给的那个），
   *    而 `readFlowchartPayload` 要的是**里层的 payload**（`{ nodes, edges }`）——
   *    直接把信封喂进去会读成「一个节点都没有」的白图（本仓那条用例当场抓到过）。
   * `mine` 那一侧来的已经是 payload（`document.data`）⇒ 只有信封这一边要拆。
   */
  const envelope = starter as { tool?: unknown; data?: unknown } | null | undefined;
  const starterPayload = envelope?.tool === 'flowchart' ? envelope.data : null;
  const shot = flowchartSvg(mergeFlowchart(readFlowchartPayload(starterPayload), readFlowchartPayload(mine)));
  return shot ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shot.svg)}` : null;
}
