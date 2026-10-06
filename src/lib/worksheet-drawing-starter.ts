/**
 * 绘图题的**底稿**（★ 2026-10-06，教师：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」）。
 *
 * 教师的三条决定（逐字）：
 *   · 「先拿流程图当试点」；
 *   · **A 底稿不算学生的作答** ⇒ 学生交上去的 `data` 里**只留他自己画的**；
 *   · **B 学生不能改/删底稿** ⇒ 底稿的节点锁定（不能拖、不能改字、不能删）。
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
  };
}

/**
 * 画板要显示的那份 = **底稿 + 学生自己画的**（按 id 去重，底稿优先）。
 *
 * ⚠️ 底稿的节点被标成 `locked`（B：不能改/删）；学生自己的节点不带这个标记。
 * ⚠️ 底稿的边 `deletable: false`（同样为了 B；学生那条线他仍可以删/改标注）。
 */
export function mergeFlowchart(starter: FlowchartPayload, mine: FlowchartPayload): FlowchartPayload {
  const starterNodeIds = new Set(starter.nodes.map((node) => node.id));
  const starterEdgeIds = new Set(starter.edges.map((edge) => edge.id));
  return {
    // ⊘ 2026-10-06 第三版（教师澄清 2）：「学生可以修改底稿」—— 原来这里会锁住
    //   底稿的节点与边（不能拖/不能删/文字只读），**已撤销**。学生拿到的是可以随便改的图，
    //   想回到教师给的样子就按工具条上的「恢复初始图」（`restoreFlowchart`）。
    // ⚠️ 于是 B 那条决定的实现从「锁」换成了「可恢复」——**恢复是唯一回退路径**
    //   （流程图那一档没有撤销/清空），所以那个按钮不是可选装饰。
    nodes: [...starter.nodes, ...mine.nodes.filter((node) => !starterNodeIds.has(node.id))],
    edges: [...starter.edges, ...mine.edges.filter((edge) => !starterEdgeIds.has(edge.id))],
  };
}

/** 「恢复初始图」：把画板内容重置回教师给的那份（不看学生改过什么）。 */
export function restoreFlowchart(starter: FlowchartPayload): FlowchartPayload {
  return { nodes: [...starter.nodes], edges: [...starter.edges] };
}

export function subtractFlowchart(all: FlowchartPayload, starter: FlowchartPayload): FlowchartPayload {
  const starterNodeIds = new Set(starter.nodes.map((node) => node.id));
  const starterEdgeIds = new Set(starter.edges.map((edge) => edge.id));
  return {
    nodes: all.nodes.filter((node) => !starterNodeIds.has(node.id)),
    edges: all.edges.filter((edge) => !starterEdgeIds.has(edge.id)),
  };
}
