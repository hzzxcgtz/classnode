'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  MarkerType,
  getSmoothStepPath,
  type NodeProps,
} from '@xyflow/react';
// ★ 2026-10-06（教师）：「加上去的字变成了小黑块」——根因是这里原来引的是 **base.css**
//   （只有布局、**没有颜色**）：边的标签那个背景矩形拿不到 `fill` ⇒ 渲染成黑块；
//   右下角三个控制键同样没有按钮底。换成带主题的 `style.css`（库自己那一份）即可。
//   ⚠️ 标签的颜色我们另外在 `worksheet.module.css` 里钉住（见 `.react-flow__edge-text*`），
//      免得将来换主题时它又变成不可读的颜色。
import '@xyflow/react/dist/style.css';

import { flowchartSvg } from '@/lib/worksheet-flowchart-svg.ts';
import { svgToPngBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
import { normalizePastedText } from '@/lib/worksheet-text-normalize.ts';
import {
  mergeFlowchart,
  restoreFlowchart,
  readFlowchartPayload,
  subtractFlowchart,
  type DrawingStarter,
} from '@/lib/worksheet-drawing-starter.ts';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

/**
 * 节点种类。
 * ★ 2026-10-06（教师，A 方案）：「新建的连接线可以连在另一根连接线的中点上」——
 *   `junction`（交点）就是那颗**小圆点**：它不是从工具栏放下来的，而是「连到线上」时
 *   由 `onConnect` 现场插进那条线里、并把原线拆成两段的那个节点。
 */
type FlowKind = 'terminator' | 'process' | 'decision' | 'io' | 'junction';
type FlowData = { label: string; kind: FlowKind; locked?: boolean };

/**
 * 工具按钮上的**形状图标**（★ 2026-10-06 教师：「分别加上一个形象的图形表示」）。
 * 画的正是这个按钮会放下的那个节点形状 —— 学生看一眼就知道按下去会得到什么，
 * 不必先读「平行四边形」这四个字。
 * ⚠️ 与 `worksheet-flowchart-svg.ts`（快照）里那几种形状**同源**：胶囊 / 矩形 / 菱形 / 平行四边形。
 * ⚠️ `junction` 那一项是**凑键用的**：交点是「连」出来的、工具栏上没有它的按钮
 *    （`FlowKind` 里加了它，这张表就少一个键 —— 少一个键 TS 会当场报错）。
 */
const FLOW_ICONS: Record<FlowKind | 'restore' | 'trash', string> = {
  terminator: 'M7 5.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Z',
  process: 'M4 6.5h16v11H4Z',
  decision: 'M12 3.6 20.4 12 12 20.4 3.6 12Z',
  io: 'M8 6.5h12l-4 11H4Z',
  junction: 'M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z',
  restore: 'M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5',
  trash: 'M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l1 11h8l1-11M10.5 10.5v5M13.5 10.5v5',
};
export type FlowIconKey = keyof typeof FLOW_ICONS;
type FlowNode = Node<FlowData>;
// ⚠️ 不必自己声明「带 label 的边」类型：React Flow 自带的 `Edge` 就有 `label?: string | ReactNode`
//    （注释留在这里，免得下一个人又去造一个没用的别名 —— 那会变成一条 unused 警告）。

function FlowNodeEditor({ id, data, selected }: NodeProps<FlowNode>) {
  const instance = useReactFlow<FlowNode, Edge>();
  const textWidth = Math.min(30, Math.max(10, Array.from(data.label).length + 2));
  /** ★ 交点是**一个小圆点**、没有文字 ⇒ 它不能有那个可编辑文字输入框（否则图上多一个空框）。 */
  const isJunction = data.kind === 'junction';
  return (
    <div className={`${styles.flowNode} ${styles[`flowNode_${data.kind}`]}`} data-selected={selected ? '1' : '0'}>
      {/* ★ 2026-10-06（教师）：「判断框怎么这个形状？」——菱形改成**画出来的**（原来是旋转 45° 的方块）。
          ⚠️ `overflow: visible` 不需要：这块 SVG 撑满盒子，四个顶点正好是四个连接点。 */}
      {data.kind === 'decision' && (
        <svg className={styles.flowNodeShape} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="50,1.5 98.5,50 50,98.5 1.5,50" fill="#fff" stroke="#7895b3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {/* ⚠️ 交点也要**四个句柄照旧**：它的上/下就是那两段线接上去的地方。 */}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      {/* ★ 2026-10-06（教师）：「选中一个图形准备移动时，后面的图形都一起移动」——
          根因是这一格原来挂着 `className="nodrag"`：React Flow 的节点拖动过滤器里那句
          `hasSelector(target, '.nodrag', domNode)` 命中 ⇒ **这一格上按下拖动不拖节点**，
          事件穿透到画布 ⇒ 变成整块画布平移（只有从边框那几像素起拖才拖得动框）。
          🔴 实测（无头 Chrome 154 + 本仓 React Flow 12.11.6）：去掉它之后，从框中间（文字上）
          按下拖动 = 拖动这个框；而**单击**仍然会聚焦输入框（浏览器在 mousedown 的默认行为里聚焦），
          代价只是「在输入框里按住拖来选中文字」会变成拖框 —— 对一个短标签可以接受，也更符合直觉。
          ⚠️ 全文件只有这一处挂过 `nodrag`，别的元素没有。 */}
      {!isJunction && (
        <input
          aria-label="节点文字"
          value={data.label}
          disabled={data.locked}
          style={{ width: `${textWidth}em` }}
          onChange={(event) => instance.updateNodeData(id, { label: event.target.value })}
        />
      )}
    </div>
  );
}

/**
 * ★ 2026-10-06（教师，A 方案）：「新建的连接线可以连在另一根连接线的中点上」。
 *
 * 做法是 React Flow 官方的「insert node on edge」：**自定义边**在它的**标签点**上挂一颗 `Handle`，
 * 学生从任意节点的连接点拖到这颗句柄上松手 ⇒ `onConnect` 收到的 `connection.target` 就是
 * **这条边的 id** ⇒ 我们把原边拆成两段、中间插一个 `kind: 'junction'` 的小圆点节点。
 *
 * 🔴 三个**实测**得来的要点（无头 Chrome 154 真拖过 + 本仓的 React Flow 12.11.6 源码），别想当然：
 *   ① 句柄必须住在 `EdgeLabelRenderer` 里。边是 SVG（`<g class="react-flow__edge">`），
 *      直接往里面塞 `<div>` 根本渲染不出来（HTML 元素不进 SVG 的渲染树）。
 *   ② 必须自己把 `data-nodeid` 补成**这条边的 id**。库的 `Handle` 用 `useNodeId()` 取 node id，
 *      而边不是节点 ⇒ 取到 null ⇒ 渲染出来的句柄**没有 `data-nodeid`**；
 *      而 `isValidHandle()` 读到空值就当场判定「这次连接无效」。实测：往这种句柄上拖，
 *      `onConnect` **一次都不响**（只有 `onConnectEnd`），控制台另报 `error#010`。
 *      ✅ 能补上是因为库把 `...rest` 摊在自己那句 `"data-nodeid": nodeId` **之后**（`Handle` 的 render）。
 *      ⚠️ 补的值就是边 id —— 这正是 `onConnect` 认「连到线上」的**唯一凭据**。
 *   ③ 标签得自己画：自定义边不再享受内置边那份 `label` 渲染，而我们的配色 CSS
 *      （`worksheet.module.css` 里的 `.react-flow__edge-textbg` / `.react-flow__edge-text`）
 *      正是按**库自己那两个类名**写的 ⇒ 换类名等于把配色关掉。所以那两个类名必须逐字保留。
 */
const edgeHandleNodeId = (edgeId: string): Partial<ComponentProps<typeof Handle>> => (
  // ⚠️ 这一颗 `data-nodeid` 在库的 props 类型里**不存在**（它只在运行时被摊开），
  //    所以这里只能断言一次 —— 注释写清楚它是为什么，不要当成随手一写的 any。
  { 'data-nodeid': edgeId } as unknown as Partial<ComponentProps<typeof Handle>>
);

/** 标签白底的宽度：库量的是文字真实宽度（`EdgeText` 里 `getBBox`），我们按字数估（快照里也是这么估的）。 */
const edgeLabelWidth = (label: string) => Math.max(22, Array.from(label).length * 8 + 14);

/**
 * 拆线时，交点这一侧该接哪个句柄 —— 让两段**接回原来的方向**（竖直流程图走上/下，横向流程图走左/右）。
 *
 * 🔴 实测（无头 Chrome 154 + 本仓 React Flow 12.11.6）：句柄留空时库取的是**交点的第一个句柄**
 *    —— target 取 `top`、source 取 `right`（我们在 `FlowNodeEditor` 里就是按 上/右/下/左 这个 DOM 顺序
 *    摆的四个 `Handle`）。于是竖直流程图上第二段会从圆点**右侧**拐出去，实测路径是
 *    `M145 189.5 L160,189.5 Q… L135 297`：先向右 30px、再往下、再向左 30px 回到目标框，
 *    看起来像线在交点处打了个弯（第一条缝在快照里也一样难看）。
 *    ⇒ 按原边那两个句柄的方位取，两段才会与原来那条线**重合**。
 * ⚠️ 交点的**上/左是 target、右/下是 source**（`FlowNodeEditor` 里那四个 Handle 的类型是钉死的）
 *    ⇒ 下面两张表各自只落在**自己那一类**句柄里，不靠 `ConnectionMode.Loose` 兜着。
 * ⚠️ 剩下那两种方位（从左边/下边出发的线）没有对应的同类句柄，退回竖直那一套（上/下）。
 */
const junctionInHandle = (sourcePosition: Position) => (sourcePosition === Position.Right ? 'left' : 'top');
const junctionOutHandle = (targetPosition: Position) => (targetPosition === Position.Left ? 'right' : 'bottom');

/** 句柄 id → 库的站位（我们的节点固定用 top/right/bottom/left 这四个 id）。纯函数，放模块级。 */
const positionOfHandle = (id: unknown, fallback: Position): Position => (
  id === 'top' ? Position.Top : id === 'left' ? Position.Left
    : id === 'right' ? Position.Right : id === 'bottom' ? Position.Bottom : fallback
);

function FlowEdgeLine({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  selected, markerEnd, style, label,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  /** 线上的字（判断框分出来的 Y / N 或学生自己写的）—— 只认字符串，节点式标签我们不用。 */
  /**
   * ★ 2026-10-06（教师认可）：**中点句柄**沿「标签点 → 目标端」方向挪 14px。
   * 🔴 上一版把 14px 错加在 `edgeAnchor()` 上（那只服务**双击后的就地输入框**）⇒ 症状没治：
   *    句柄仍与线上的 Y/N 标签同点（悬停/选中变实就盖住那个字），并且**正落在中点的单击/双击被它吞掉**。
   * ⚠️ 交点节点用的是 `anchors.midX/midY`（**精确中点**），与此处无关 —— 拆出来的两段必须与原来的线重合。
   */
  const shiftLen = Math.hypot(targetX - labelX, targetY - labelY) || 1;
  const handleX = labelX + ((targetX - labelX) / shiftLen) * 14;
  const handleY = labelY + ((targetY - labelY) / shiftLen) * 14;
  const text = typeof label === 'string' ? label : '';
  const textWidth = text ? edgeLabelWidth(text) : 0;
  return (
    <>
      {/* `selected` 一起递给路径：选中那条线要看得出来（边的 `<g>` 上库还会自己挂 `.selected`）。 */}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} className={selected ? 'selected' : undefined} />
      {text && (
        <g>
          <rect
            className="react-flow__edge-textbg"
            x={labelX - textWidth / 2}
            y={labelY - 11}
            width={textWidth}
            height={22}
            rx={6}
          />
          <text
            className="react-flow__edge-text"
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {text}
          </text>
        </g>
      )}
      {/* ⚠️ 这颗句柄与上面的标签**同一个点**（都是 `labelX/labelY`）；它住在 `EdgeLabelRenderer`
          那一层，DOM 上排在所有边之后 ⇒ 画在标签之上、也先拿到指针事件（标签压不住它）。 */}
      <EdgeLabelRenderer>
        <Handle
          type="target"
          position={Position.Top}
          id="edge-mid"
          className={`${styles.flowEdgeHandle}${selected ? ` ${styles.flowEdgeHandleOn}` : ''}`}
          style={{ left: handleX, top: handleY }}
          {...edgeHandleNodeId(id)}
        />
      </EdgeLabelRenderer>
    </>
  );
}

function readFlowData(raw: unknown): { nodes: FlowNode[]; edges: Edge[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { nodes: [], edges: [] };
  const row = raw as Record<string, unknown>;
  return {
    nodes: Array.isArray(row.nodes) ? row.nodes as FlowNode[] : [],
    edges: Array.isArray(row.edges) ? row.edges as Edge[] : [],
  };
}

/**
 * 交出去的那份流程数据（作答的真源）。
 *
 * ⚠️ `measured` 是**给快照用的**：React Flow 量出来的真实宽高只有它自己知道，
 *    不带上就会在快照里按字数估宽（形状对、观感差）。
 *    它是快照的输入，不影响编辑（读回来时 React Flow 会重新量一遍）。
 */
function toFlowPayload(nodes: FlowNode[], edges: Edge[]) {
  return {
    nodes: nodes.map(({ id, type, position, measured, data: nodeData }) => ({
      id,
      type,
      position,
      ...(measured ? { measured } : {}),
      data: { label: nodeData.label, kind: nodeData.kind },
    })),
    // ⚠️ `label` 必须一起带走：漏了它 = 「线上写的字一刷新就没了」，而屏幕上不报错。
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, type, label }) => ({ id, source, target, sourceHandle, targetHandle, type, ...(label ? { label } : {}) })),
  };
}

function FlowchartEditor({ data, backgroundUrl, disabled, onChange, onImage, starter }: DrawingSurfaceProps) {
  /**
   * ★ 2026-10-06（教师）：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」。
   *
   * 🔴 三条决定逐字落地（见 `@/lib/worksheet-drawing-starter.ts` 的注释）：
   *    · A **底稿不算学生的作答** ⇒ 交上去的 `data` = 画板上的全部 − 底稿（`subtractFlowchart`）；
   *    · B **学生不能改/删底稿** ⇒ 读进来时给底稿的节点/边打上锁（`mergeFlowchart`）；
   *    · 试点就是流程图这一档。
   * ⚠️ 合并是**读的时候**做、剔除是**写的时候**做：画板自己始终拿着「底稿 + 学生画的」这一份，
   *    于是拖拽/连线/标注都不必知道底稿的存在。
   */
  const starterPayload = starter?.tool === 'flowchart' ? readFlowchartPayload(starter.data) : readFlowchartPayload(null);
  /**
   * 画板上的那份 = **底稿 + 学生自己画的**（合并只在读的时候做一次）。
   * ⚠️ 类型上 `mergeFlowchart` 给的是「带 id 的普通对象」，画板要的是 React Flow 的
   *    `FlowNode`/`Edge` —— 这里窄化一次（结构本来就一致，多出来的 `draggable`/`deletable`
   *    正是 React Flow 自己的字段）。
   */
  const initial = useRef<{ nodes: FlowNode[]; edges: Edge[] }>(
    mergeFlowchart(starterPayload, readFlowchartPayload(readFlowData(data))) as unknown as { nodes: FlowNode[]; edges: Edge[] },
  );
  /**
   * 最近一次交出去的流程数据 —— 快照按它画。
   * ⚠️ 不能等抓图时再读 state：抓图是异步的，那时学生可能已经又改了（快照会**超前**作答）。
   */
  const lastFlow = useRef<ReturnType<typeof toFlowPayload> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.current.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.current.edges);
  const initialized = useRef(false);
  const nodeTypes = useMemo(() => ({ flow: FlowNodeEditor }), []);
  /**
   * ★ 2026-10-06（教师，A 方案）：线的中点那颗句柄住在**自定义边**里
   * ⇒ 必须在这里注册，否则 `<ReactFlow>` 不认识 `type: 'flow'` 的边
   *（老作答里存的 `'smoothstep'` 也会落到这里 —— 见下面 `visibleEdges` 的强制那一步）。
   */
  const edgeTypes = useMemo(() => ({ flow: FlowEdgeLine }), []);
  /** 位图快照：自己吐一份纯 SVG 再栅格化（**不用 `foreignObject`**，老 iPad 上那条路可能出空白图）。 */
  const scheduleRaster = useDrawingRaster({
    capture: async () => {
      const shot = lastFlow.current ? flowchartSvg(lastFlow.current) : null;
      return shot ? svgToPngBlob(shot.svg, shot.width, shot.height) : null;
    },
    onUrl: onImage,
  });

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    const timer = window.setTimeout(() => {
      const payload = toFlowPayload(nodes, edges);
      // 快照按**全部**画（含底稿）⇒ 教师预览 / AI 联系表 / Word 报告里是一张完整的图。
      lastFlow.current = payload;
      // ★ A：交上去的那份**只留学生自己画的**（底稿不算他的作答）。
      onChange(subtractFlowchart(payload, starterPayload) as unknown as ReturnType<typeof toFlowPayload>);
      scheduleRaster();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, onChange, scheduleRaster]);

  /**
   * ★ 2026-10-06（教师）：「连接线默认没箭头的吗？」
   * React Flow 的边**默认不画箭头** ⇒ 这里给每条边补一个 —— 不只补新连的线，
   * **存量作答**（已经存进 `drawing.data.edges` 的那些）也要补：它们同样没有 `markerEnd`，
   * 不补的话「老作答一打开还是没有箭头」，而教师根本分不出这两种情况。
   * ⚠️ 只补**缺**的（`?? ARROW`）：学生（或将来）自己配过 markerEnd 的边不被覆盖。
   * ⚠️ 两次 `map` **是有意分开的**（不是图省事）：第一条 `map` 是上面那条判据的落点，
   *    用例里逐字钉着那一句；第二条才是这次新加的。
   * ★ 2026-10-06（教师，A 方案）：每条边都强制成我们自己的 `flow` 边 ——
   *   老作答里存的 `'smoothstep'` 不强制的话**老图就没有中点句柄**（新画的能连、老的连不上，
   *   而屏幕上一点区别都看不出来）。
   */
  const visibleEdges = useMemo(
    () => edges.map((edge) => (edge.markerEnd ? edge : { ...edge, markerEnd: FLOW_ARROW }))
      .map((edge) => ({ ...edge, type: 'flow' })),
    [edges],
  );

  /**
   * 「恢复初始图」（教师澄清 2：「学生可以修改底稿，但是可以提供一个『恢复底稿』的按钮」）。
   *
   * 🔴 这是**唯一**的回退路径：流程图这一档的工具条只有「加节点」与「线上标注」，
   *    没有撤销、也没有清空 —— 学生把教师给的图改乱了，只能靠这颗按钮回去。
   * ⚠️ 只在**这一题有初始图**时才出现（没有初始图就没什么可恢复的，多一颗按钮只是噪音）。
   */
  const restoreStarter = () => {
    const base = restoreFlowchart(starterPayload);
    setNodes(base.nodes as unknown as FlowNode[]);
    setEdges(base.edges as unknown as Edge[]);
  };

  /**
   * 一条线在**流坐标**（`position` 用的那套）里的两个锚点：
   *   · `midX/midY` —— **中点**：库 `getSmoothStepPath` 回的**标签点**（`labelX/labelY`）。
   *     线上的字就画在这儿 ⇒ 就地输入框、以及连出来的**交点节点**都摆这一点；
   *   · `endX/endY` —— **终点**：目标节点那一侧的句柄点（`to`），也就是**箭头真正落下的地方**。
   *     ★ 2026-10-06（教师截图）：选中后浮出的删除图标挪到这一端。
   *
   * 🔴 第一版用「两个节点中心的中点」，实测**离那条线很远**（教师 2026-10-06：「距离太远，
   *    应该就在那根连接线上」）—— `smoothstep` 是**折线**，两个中心的连线中点经常根本不在路径上。
   * ✅ 现在用库自己的 `getSmoothStepPath` 取它返回的**标签点**（`labelX/labelY`）：
   *    这正是库给边缘标签用的位置 ⇒ 一定落在折线上，也不必我们复刻路径算法。
   * ⚠️ 起止点按「句柄在节点边上居中」算（句柄确实居中于那一侧），所以与库画出来的路径点一致。
   * ⚠️ 包成 `useCallback`（依赖就是它读的那两份 state）：`onConnect` 里也要用它，
   *    不然 `react-hooks/exhaustive-deps` 会多出一条「缺依赖」的警告。
   */
  /**
   * 把锚点沿「起点 → 终点」方向推开一段（★ 2026-10-06 教师认可的两条偏移）。
   *
   * 🔴 为什么必须推开（都是截图暴露的真问题）：
   *   · **删除按钮**原本正以箭头落点为心 ⇒ 44px 的它把箭头、最后 ~22px 的线、
   *     以及目标节点那一侧的连接点全盖住（想从那儿拉新线会点到删除按钮）⇒ 往 source 退 26px；
   *   · **中点句柄**与线上的 Y/N 标签同点 ⇒ 悬停/选中变实会把字盖住，而且正落在中点的
   *     单击/双击会被句柄吞掉 ⇒ 往目标端挪 14px（一并解决「中点被吞」）。
   * ⚠️ 方向用「起点→终点」的直线方向近似路径方向：smoothstep 的末段本来就是**沿句柄轴**进来的，
   *    所以终点处这条近似与真实路径一致；中点处在竖直/水平的常见情形也一致。
   * ⚠️ **交点节点不用这个偏移** —— 它必须落在**精确中点**上，否则拆出来的两段与原来的线对不上。
   */
  const offsetAlong = (point: { x: number; y: number }, toward: { x: number; y: number }, distance: number) => {
    const dx = toward.x - point.x;
    const dy = toward.y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / len) * distance, y: point.y + (dy / len) * distance };
  };

  const edgeFlowAnchors = useCallback((edgeId: string | null) => {
    if (!edgeId) return null;
    const edge = edges.find((item) => item.id === edgeId);
    const source = nodes.find((item) => item.id === edge?.source);
    const target = nodes.find((item) => item.id === edge?.target);
    if (!edge || !source || !target) return null;
    const boxOf = (node: FlowNode) => ({
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? 150,
      height: node.measured?.height ?? 54,
    });
    const handlePoint = (box: ReturnType<typeof boxOf>, position: Position) => (
      position === Position.Top ? { x: box.x + box.width / 2, y: box.y }
        : position === Position.Bottom ? { x: box.x + box.width / 2, y: box.y + box.height }
          : position === Position.Left ? { x: box.x, y: box.y + box.height / 2 }
            : { x: box.x + box.width, y: box.y + box.height / 2 }
    );
    const sourcePosition = positionOfHandle(edge.sourceHandle, Position.Bottom);
    const targetPosition = positionOfHandle(edge.targetHandle, Position.Top);
    const from = handlePoint(boxOf(source), sourcePosition);
    // ⚠️ 这个 `to` 就是**终点锚点**：箭头落在目标节点的这一侧句柄上。
    const to = handlePoint(boxOf(target), targetPosition);
    const [, labelX, labelY] = getSmoothStepPath({
      sourceX: from.x, sourceY: from.y, sourcePosition,
      targetX: to.x, targetY: to.y, targetPosition,
    });
    return { midX: labelX, midY: labelY, endX: to.x, endY: to.y, fromX: from.x, fromY: from.y };
  }, [edges, nodes]);

  /**
   * **中点**锚点 → 容器内坐标。就地文字输入框用它（标签就画在中点，就地编辑才顺手），
   * 连到线上时插的那个交点节点也用它算**流坐标**。
   */
  const edgeAnchor = (edgeId: string | null) => {
    const anchors = edgeFlowAnchors(edgeId);
    if (!anchors) return null;
    const { midX, midY, endX, endY } = anchors;
    // ★ 往目标端挪 14px：既避开线上的 Y/N 标签，也把「正落在中点的单击/双击」还给那条线。
    const shiftedMid = offsetAlong({ x: midX, y: midY }, { x: endX, y: endY }, 14);
    return { x: viewport.x + shiftedMid.x * viewport.zoom, y: viewport.y + shiftedMid.y * viewport.zoom };
  };

  /**
   * ★ 2026-10-06（教师截图）：「删除图标移到这条连线的**终点**」——
   *   原来它和就地输入框一样压在中点，正好把线上的字糊住。
   * ⚠️ 终点 = **箭头落下的那一端**（目标节点那侧），**不是**起点（source 那端）。
   * ⚠️ 两个浮层从此用**两个不同的锚点**（删除按钮 → 终点；就地输入框 → 中点），别合并。
   */
  const edgeEndAnchor = (edgeId: string | null) => {
    const anchors = edgeFlowAnchors(edgeId);
    if (!anchors) return null;
    // ★ 往 source 退 26px：44px 的删除按钮不许盖住箭头、最后那段线，以及目标侧的连接点。
    const shiftedEnd = offsetAlong(
      { x: anchors.endX, y: anchors.endY },
      { x: anchors.fromX, y: anchors.fromY },
      26,
    );
    return { x: viewport.x + shiftedEnd.x * viewport.zoom, y: viewport.y + shiftedEnd.y * viewport.zoom };
  };

  const addNode = (kind: FlowKind, label: string) => {
    const offset = nodes.length * 26;
    setNodes((current) => [...current, {
      id: `node-${Date.now()}-${current.length}`,
      type: 'flow',
      position: { x: 80 + offset, y: 70 + offset },
      data: { label, kind },
    }]);
  };
  /**
   * ★ 2026-10-06（教师）：「判断框出来的两条线默认应该是一条上面是 Y，一条上面是 N」。
   * ⇒ 从**判断框**拉出来的线自动带上 Y / N（按这个判断框已有几条带标注的出边排：0→Y、1→N、再多就不猜）。
   * ⚠️ 其它节点拉出来的线**不自动给字**：给每条线都塞一个 Y 是噪音，而且会让「线上一片字」。
   *
   * ★ 2026-10-06（教师，A 方案）：「新建的连接线可以连在另一根连接线的中点上」。
   * ⇒ 连到**线上的中点句柄**时，`connection.target` 就是那条**边的 id**（凭据怎么来的见
   *   `FlowEdgeLine` 上面那段注释）⇒ 在这里把原边拆成两段、中间插一个交点小圆点。
   */
  const onConnect = useCallback((connection: Connection) => {
    // ── ① 落点是**一条边**（连线中点那颗句柄）⇒ 插交点 + 把原边拆成两段 ──────────────
    const hitEdge = connection.target ? edges.find((edge) => edge.id === connection.target) : undefined;
    if (hitEdge) {
      const anchors = edgeFlowAnchors(hitEdge.id);
      if (!anchors) return;
      const junctionId = `junction-${Date.now()}-${nodes.length}`;
      /* ⚠️ 12 与 CSS 里 `.flowNode_junction` 的 12×12 是同一个数：节点 `position` 说的是
         **左上角**，各减一半才能让那颗圆点正落在标签点上（不这么减，线会岔开 6px）。 */
      const junctionHalf = 6;
      setNodes((current) => [...current, {
        id: junctionId,
        type: 'flow',
        // 🔴 **流坐标**（`position` 用的那套），刻意不碰 `viewport` —— 那是给浮层用的屏幕坐标。
        position: { x: anchors.midX - junctionHalf, y: anchors.midY - junctionHalf },
        data: { label: '', kind: 'junction' },
      }]);
      setEdges((current) => {
        const original = current.find((edge) => edge.id === hitEdge.id);
        if (!original) return current;
        // ⚠️ 交点那两个句柄的方位取自**原边**（它原来从 source 的哪一侧出去、进 target 的哪一侧）
        //    ⇒ 两段接回去以后与原来那条线重合。见 `junctionInHandle` 上面那段实测。
        const inHandle = junctionInHandle(positionOfHandle(original.sourceHandle, Position.Bottom));
        const outHandle = junctionOutHandle(positionOfHandle(original.targetHandle, Position.Top));
        // ①原边的 source → **交点**：label / sourceHandle / markerEnd……全部保留，
        //   只把 `targetHandle` 换成交点上的那一颗（原来那个是**上一个**目标节点的句柄，
        //   直接留着才是真错 —— 那句「断开 targetHandle」的意思正是别把它带过来）。
        const head: Edge = { ...original, target: junctionId, targetHandle: inHandle, type: 'flow' };
        // ②**交点** → 原来那个目标节点（用 addEdge 走一次库自己的加边，id 由它给）。
        const tail: Edge = {
          id: `${junctionId}-tail`,
          source: junctionId,
          sourceHandle: outHandle,
          target: original.target,
          targetHandle: original.targetHandle ?? null,
          type: 'flow',
        };
        // ⚠️ 顺序：先摘掉原边 → 把 `tail` 交给 addEdge → 把 `head`（**沿用原边 id**）放回去。
        //    沿用 id 是有意的：`editingEdge`/`labelingEdge` 那些状态还指着它，拆线不该凭空多出悬空 id。
        return [...addEdge(tail, current.filter((edge) => edge.id !== original.id)), head];
      });
      return;
    }
    // ── ② 落点是**节点** ⇒ 保持原有行为（外加判断框出边默认 Y / N）──────────────────
    setEdges((current) => {
      const source = nodes.find((node) => node.id === connection.source);
      let label: string | undefined;
      if (source?.data.kind === 'decision') {
        const used = current.filter((edge) => edge.source === connection.source && edge.label).length;
        label = used === 0 ? 'Y' : used === 1 ? 'N' : undefined;
      }
      // ⚠️ 这里仍然存 `'smoothstep'`（保持原有行为）；渲染时 `visibleEdges` 会把每条边强制成 `'flow'`。
      return addEdge({ ...connection, type: 'smoothstep', ...(label ? { label } : {}) }, current);
    });
  }, [nodes, edges, edgeFlowAnchors, setEdges, setNodes]);

  /** 学生点了某条线 ⇒ 工具条上出现「这条线标注」那一组（Y / N / 清空 / 自由文字）。 */
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  /** 正在改文字的那条线（双击进入）—— 它出现一个就地输入框。 */
  const [labelingEdge, setLabelingEdge] = useState<string | null>(null);
  /**
   * 视口（`onMove` 给的 `{x, y, zoom}`）。
   * 🔴 用它把**流坐标**换算成容器内坐标：`local = viewport.x + flowX * zoom`。
   *    刻意不用 `useReactFlow().flowToScreenPosition` —— 那个 hook 必须在
   *    `<ReactFlowProvider>` 之内，而我们这块画板是直接渲染 `<ReactFlow>`（没有外层 provider），
   *    为它多包一层 Provider 只为了挪一个浮层按钮，不划算。
   * ⚠️ 初始化成恒等变换；`onMove` 在平移/缩放时都会回调，所以浮层最多在一帧内偏一点。
   */
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  /** 删除这条连线（浮层按钮与工具条那条路共用）。 */
  const removeEdge = (id: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== id));
    setEditingEdge(null);
    setLabelingEdge(null);
  };

  const setEdgeLabel = (id: string, label: string) => {
    setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, label: label || undefined } : edge)));
  };
  /**
   * 那条线**当前**的标注（给输入框用）。
   * ⚠️ 必须是受控的、并且**只认字符串**：React Flow 的 `Edge.label` 类型是 `string | ReactNode`
   *    （它允许节点式标签），直接塞进 `<input value>` 会报类型错 —— 而「为了消错」去断言
   *    等于把这条判据关掉。非字符串（理论上有）就当空。
   */
  const editingLabel = (() => {
    const label = edges.find((edge) => edge.id === editingEdge)?.label;
    return typeof label === 'string' ? label : '';
  })();
  const visibleNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    // ⊘ 2026-10-06 第三版：底稿**不再锁**（学生可以改），所以这里只看「只读展示」这一条。
    data: { ...node.data, locked: disabled || node.data.locked === true },
  })), [disabled, nodes]);

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="流程图工具">
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('terminator', '开始/结束')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.terminator} /></svg>开始/结束</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('process', '处理过程')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.process} /></svg>过程</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('decision', '判断条件')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.decision} /></svg>判断</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('io', '输入/输出')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.io} /></svg>输入/输出</button>
        {starter && (
          <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={restoreStarter}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.restore} /></svg>恢复初始图</button>
        )}
        <span className={styles.drawingToolbarHint}>{editingEdge ? '这条线标注：' : '从圆形连接点拖向另一节点即可连线'}</span>
        {editingEdge && (
          <>
            {['Y', 'N', '是', '否'].map((value) => (
              <button className={styles.drawingToolbarButton} key={value} type="button" disabled={disabled} onClick={() => setEdgeLabel(editingEdge, value)}>{value}</button>
            ))}
            {/* ★ 2026-10-06（教师）：「可不可以用户加自定义的字？」——可以，直接在这一格里打。
                ⚠️ 它是**受控**的：值来自那条边自己（`edges.find`），所以切换线、清空、撤销
                都会跟着回到正确的内容，不会残留上一条线的字。 */}
            <input
              className={styles.drawingToolbarEdgeLabel}
              type="text"
              maxLength={12}
              disabled={disabled}
              aria-label="这条线上的自定义文字"
              placeholder="自定义"
              value={editingLabel}
              onChange={(event) => setEdgeLabel(editingEdge, event.target.value)}
            />
            <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => { setEdgeLabel(editingEdge, ''); setEditingEdge(null); }}>清空</button>
          </>
        )}
      </div>
      <div className={`${styles.thirdPartyCanvas} ${styles.flowStage}`} style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={disabled ? undefined : onNodesChange}
          onEdgesChange={disabled ? undefined : onEdgesChange}
          onConnect={disabled ? undefined : onConnect}
          onEdgeClick={(event, edge) => { event.stopPropagation(); setEditingEdge(edge.id); setLabelingEdge(null); }}
          /*
            ★ 2026-10-06（教师）：「双击线条可以输入/修改连接线上的文字」。
            双击进入**就地输入框**（就在那条线中点），回车提交、Esc 取消。
            ⚠️ 单击仍是「选中这条线」（浮出删除按钮）—— 两件事分开，不互相抢。
          */
          onEdgeDoubleClick={(event, edge) => { event.stopPropagation(); setEditingEdge(edge.id); setLabelingEdge(edge.id); }}
          // 浮层要跟着视口走（平移/缩放都会回调）
          onMove={(_, next) => setViewport(next)}
          onPaneClick={() => setEditingEdge(null)}
          nodesDraggable={!disabled}
          nodesConnectable={!disabled}
          connectionMode={ConnectionMode.Loose}
          elementsSelectable={!disabled}
          fitView
          minZoom={0.35}
          maxZoom={2.2}
          deleteKeyCode={disabled ? null : ['Backspace', 'Delete']}
        >
          {!backgroundUrl && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd7e5" />}
          <Controls showInteractive={false} />
        </ReactFlow>
        {/*
          ★ 2026-10-06（教师）：「要求点击可以选中连接线，会跳出一个图标型的删除按钮，可删除连接线；
          双击线条可以输入/修改连接线上的文字。」
          ★ 2026-10-06（教师截图）：「删除图标移到这条连线的**终点**」⇒ 删除按钮改用
          `edgeEndAnchor()`（目标节点那一侧的句柄点 = 箭头落点）；**就地输入框仍用中点**
          `edgeAnchor()`（标签画在中点，就地编辑才顺手）—— 两个浮层两个锚点，别合并。
          ⚠️ 两个浮层都用视口换算成**容器内坐标**（视口由 `onMove` 跟）。
          ⚠️ 正在改文字时**不显示**删除按钮：双击必然先触发一次单击，两个浮层叠在一起会互相压住。
        */}
        {editingEdge && !labelingEdge && edgeEndAnchor(editingEdge) && (
          <button
            className={styles.flowEdgeFloat}
            type="button"
            disabled={disabled}
            aria-label="删除这条连线"
            title="删除这条连线"
            style={{ left: edgeEndAnchor(editingEdge)!.x, top: edgeEndAnchor(editingEdge)!.y }}
            onClick={() => removeEdge(editingEdge)}
          >
            <svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.trash} /></svg>
          </button>
        )}
        {labelingEdge && edgeAnchor(labelingEdge) && (
          <input
            className={styles.flowEdgeInput}
            style={{ left: edgeAnchor(labelingEdge)!.x, top: edgeAnchor(labelingEdge)!.y }}
            autoFocus
            maxLength={12}
            disabled={disabled}
            aria-label="这条连线上的文字"
            placeholder="线上文字"
            defaultValue={String(edges.find((edge) => edge.id === labelingEdge)?.label ?? '')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { setEdgeLabel(labelingEdge, event.currentTarget.value); setLabelingEdge(null); }
              if (event.key === 'Escape') setLabelingEdge(null);
            }}
            onBlur={(event) => { setEdgeLabel(labelingEdge, event.currentTarget.value); setLabelingEdge(null); }}
            onPaste={(event) => {
              // 与「评分标准」同一个归一化：从 Word 复制带进来的排版在这里同样是噪音。
              const raw = event.clipboardData.getData('text/plain');
              if (!raw) return;
              event.preventDefault();
              event.currentTarget.value = normalizePastedText(raw).slice(0, 12);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function FlowchartDrawing(props: DrawingSurfaceProps) {
  return <ReactFlowProvider><FlowchartEditor {...props} /></ReactFlowProvider>;
}

/** 流程图的边统一用这个箭头（与快照 SVG 里的 `marker-end` 同一形状）。 */
const FLOW_ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#6b86a5' } as const;
