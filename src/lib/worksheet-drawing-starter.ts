/**
 * 绘图题的**底稿**（★ 2026-10-06，教师：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」）。
 *
 * 底稿的交互语义按画板区分：
 *   · 流程图、思维导图是可接续编辑的初始结构，学生可以直接修改；
 *   · 数学作图是教师题目底图，学生只能在其上新增作答，不能选中或修改底图对象；
 *   · 题目数据里的历史字段 `drawingStarterLocked` 仍然一律忽略，锁定规则由画板类型决定，
 *     不再由一个容易产生冲突的通用开关决定。
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
 * 不返回 `locked`：题目数据里那个历史字段（`drawingStarterLocked`）在这里一个字都不读；
 * 数学底图是否可编辑由数学画板的独立底图层保证，流程图与思维导图则保持可接续编辑。
 *
 * 历史字段可能仍存在于已保存题目中，因此继续采取下面的兼容策略：
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
  /*
   * 🔴 ★ 2026-10-07（审计抓到的「串档」）：**底稿的画板必须与题目当前的画板一致。**
   *
   * 教师端那个「初始图」开关对**所有**绘图题都渲染，打开时**无条件**写一份**流程图**底稿，
   * 而切换画板工具时**不清它** ⇒ 思维导图题上可以挂着一份流程图的底稿。
   * 学生端的导图画板**根本不接底稿**（`mindmap-drawing.tsx` 的解构里没有 `starter`）——
   * 读出来只会在下游造出「有底稿」的假象（服务端据此给模型加一句
   * 「不要把初始图当作学生的成果」，而那张图里根本没有底稿）。
   * ⚠️ 与服务端 `hasDrawingStarter` **同一条尺子**，两边必须逐条对得上。
   */
  if (node.data?.drawingTool !== tool) return null;
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
/**
 * ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）——
 * **打开那个开关时，该给这一档写一份什么形状的空底稿。**
 *
 * 🔴 它必须是**纯函数**、而不是教师端面板里的一段 `if`：
 *   写错的表现是「题目上挂着一份**别的画板**的底稿」，而那种数据会让服务端
 *   对模型说一句假话（「本题的图里有教师预先给出的初始图」）—— 两边都不报错，
 *   而模型会把学生自己画的那张当成教师给的（见 `hasDrawingStarter` 的那一段）。
 *
 * ⚠️ 自由画仍没有结构化初始图；数学作图使用与学生作答相同的 `{elements}` 数据。
 */
export function blankStarterFor(tool: DrawingMode): DrawingStarter | null {
  if (tool === 'flowchart') return { tool: 'flowchart', data: { nodes: [], edges: [] } };
  /*
   * 🔴 形状照 `MindElixir.new()` 的那一份（`{ nodeData: { id, topic, children } }`）——
   *   少了 `nodeData` 的话 `readMindMapPayload` 读不出来。
   * ⚠️ `id` 用固定值：它只需**在这张画布内**唯一，而库给学生新增的节点生成的是
   *   16 位随机串（`dist/MindElixir.js` 的 `X()`）⇒ 撞不上这个名字。
   */
  if (tool === 'mind-map') {
    return { tool: 'mind-map', data: { nodeData: { id: 'starter-root', topic: '中心主题', children: [] } } };
  }
  if (tool === 'math') return { tool: 'math', data: { elements: [] } };
  return null;
}

/**
 * ★ 2026-10-07（教师裁定）：思维导图那一档**要给库的那份数据**。
 *
 * 🔴 **口径与流程图不同，而且是刻意的**：
 *   · 流程图：交上去的是「底稿 + 学生画的」**按 id 剔掉底稿**（见 `subtractFlowchart`）；
 *   · 思维导图：**只作起点** —— 学生一旦动手，整棵树都是他的作答。
 *
 * 为什么不能照搬：思维导图的底稿通常是一个**骨架**（中心主题 + 几个空分支），
 * 而学生要做的恰恰是**往骨架里填**（改的正是教师那些节点的文字）。
 * 按 id 剔除会把学生填的内容**连同骨架一起删掉**，交上去是空的。
 * ⚠️ 「底稿不算学生的成果」这件事在这一档**只靠提示词里那句话**承担
 *   （`analysis-agent.ts` 的 `DRAWING_STARTER_NOTE`，服务端按 `hasDrawingStarter` 决定发不发）。
 *
 * 🔴 「学生有自己的作答」的判据是**形状**（有 `nodeData`），不是「非空」：
 *   一份被他删到只剩中心主题的导图**仍然**是他的作答，不许拿底稿盖回去
 *   —— 那等于把他删的东西又塞回他手里，而屏幕上像是没保存上。
 */
export function mindMapOrStarter(mine: unknown, starter: unknown): Record<string, unknown> | null {
  return readMindMapPayload(mine) ?? readMindMapPayload(starter);
}

/** 一份思维导图数据（`mind-elixir` 的 `MindElixirData`：至少要有个对象形状的 `nodeData`）。 */
export function readMindMapPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return row.nodeData && typeof row.nodeData === 'object' && !Array.isArray(row.nodeData) ? row : null;
}

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
