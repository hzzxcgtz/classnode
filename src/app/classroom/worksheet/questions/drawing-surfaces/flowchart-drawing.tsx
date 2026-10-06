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

/**
 * ★ 2026-10-06（教师认可的第 1 步整理）：**画布上只有一份「选中」**，而且是单选。
 *
 * 原来三套浮层各有一份状态（选中连线 / 正在改文字的连线 / 选中的图形），于是「点框清线、
 * 点线清框、点空白都清」这条语义要在三处手工维护。现在只有这一个槽位：
 *   · 点框 ⇒ `{ kind: 'node', id }`（自然就清掉了线）；
 *   · 点线 ⇒ `{ kind: 'edge', id }`（自然就清掉了框）；
 *   · 点空白 ⇒ `null`。
 * `kind` 只决定**浮层怎么算锚点、按钮叫什么名字**；删除路径不分叉
 * （⚠️ 交点 `kind: 'junction'` 就是一颗普通的框，与普通框走同一条 `deleteElements`）。
 */
type FlowSelection = { kind: 'node' | 'edge'; id: string };
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
 * ★ 2026-10-06（教师认可的第 2 步整理）：浮层的几何**就这一条规则**，数值全部在这里命名。
 *
 * 规则一句话：**画布上的浮层一律是 44px 的命中区，从锚点沿「法线 / 目标句柄轴」往外偏移，
 * 永不压住句柄，偏移距离吃段长上限（`clampOffset` ≤ 40%）。**
 *
 *   · `FLOAT_SIZE`      —— 命中区 44px（老 iPad 的手指下限）。
 *   · `NODE_FLOAT_GAP`  —— 删除**图形**的按钮：中心在节点上边缘**上方**多少（流坐标）。
 *   · `EDGE_FLOAT_BACK` —— 删除**连线**的按钮：沿**目标句柄轴**（smoothstep 末段方向）往 source 退多少（流坐标）。
 *   · `HANDLE_GAP`      —— **中点浮层**（就地输入框 / 中点句柄）：沿「中点 → 目标端」挪多少（流坐标）。
 *
 * 🔴 `EDGE_FLOAT_BACK` 与 `HANDLE_GAP` **不是同一个数换了个名字**，谁也不许"统一"成对方：
 *    · 26 的起点是**终点**（箭头落点）、方向是**目标句柄轴的外法线** ⇒ 目的是让按钮别盖住箭头、
 *      最后那段线和目标侧的连接点；
 *    · 14 的起点是**中点**（库回的标签点）、方向是「中点 → 目标端」的直线 ⇒ 目的是让开线上的
 *      Y/N 标签，并把正落在中点的单击/双击还给那条线。
 *    起点不同、方向不同、目的不同 —— 把 26 换成 14（或反过来）就是把几何改坏。
 * ⚠️ `NODE_FLOAT_GAP` 由 `FLOAT_SIZE` 推出来（半个按钮 + 一指宽的缝）：按钮以自己中心定位
 *    （`.flowEdgeFloat` 的 `transform: translate(-50%, -50%)`）⇒ 整颗按钮落在框**外面**
 *    又贴着框，一眼看得出「它属于这个框」。数值仍是 28（几何没动）。
 * ⚠️ `FLOAT_SIZE` 这个数在 `worksheet.module.css` 的 `.flowEdgeFloat` 里**还有一份**（CSS 读不到
 *    TS 常量，而 `worksheet-tap-targets.test.ts` 量的正是样式表那一份）⇒ 两份必须一致，
 *    `surface-lifecycle.test.ts` 会把它们对起来。
 */
const FLOAT_SIZE = 44;
const NODE_FLOAT_GAP = FLOAT_SIZE / 2 + 6;
const EDGE_FLOAT_BACK = 26;
const HANDLE_GAP = 14;

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

/** 流程图几何里用的一个点（纯函数之间传参用，省得把 `{ x: number; y: number }` 写两遍）。 */
type FlowPoint = { x: number; y: number };

/**
 * 偏移量的**上限**：不超过这一段长度的 **40%**。
 *
 * 🔴 为什么必须有：`EDGE_FLOAT_BACK` / `HANDLE_GAP` 是给**常见边长**定的（节点 150×54、默认间距上百 px）。
 *    学生把两个框拖到几乎贴住时，这一段可能只剩 ~20px —— 26px 会越过中点、极短边上甚至越过 source 端
 *    ⇒ 浮层（删除按钮 / 中点句柄 / 就地输入框）飞出线外，看着像「按钮丢了」。
 *    取 **40%（小于一半）** ⇒ 退完一定还在**靠终点这一侧**，不会越过中点。
 * ⚠️ 纯函数、且放**模块级**：`surface-lifecycle.test.ts` 会把它抠出来喂**短边**验算
 *    （那一层没有 jsdom，不能 import 这个 'use client' 组件）。参数的**类型写在 `const` 那一侧**
 *    ⇒ 抠出来的 `(distance, span) => { … }` 本身就是合法 JS。
 */
const clampOffset: (distance: number, span: number) => number = (distance, span) => {
  const maxRatio = 0.4;
  return Math.min(distance, span * maxRatio);
};

/**
 * 把锚点沿「point → toward」方向推开 `distance`（★ 2026-10-06 教师认可的两条偏移）。
 *
 * 🔴 为什么必须推开（都是截图暴露的真问题）：
 *   · **删除按钮**原本正以箭头落点为心 ⇒ 44px 的它把箭头、最后 ~22px 的线、
 *     以及目标节点那一侧的连接点全盖住（想从那儿拉新线会点到删除按钮）；
 *   · **中点句柄 / 就地输入框**与线上的 Y/N 标签同点 ⇒ 悬停/选中变实会把字盖住，
 *     而且正落在中点的单击/双击会被句柄吞掉 ⇒ 往目标端挪 `HANDLE_GAP`。
 * ⚠️ 方向用「point → toward」的直线方向：**中点那边**（句柄、就地输入框）用它是合适的 ——
 *    中点处**没有唯一的轴**（末段轴只在中点两侧各自成立）。**终点（删除按钮）不用它**，
 *    改用 `backAxis` 沿目标句柄轴退，那才是严格的「沿线」（理由见 `backAxis`）。
 * ⚠️ 距离过 `clampOffset`：极短边上不会越过中点 / 目标端。
 * ⚠️ **交点节点不用这个偏移** —— 它必须落在**精确中点**上，否则拆出来的两段与原来的线对不上。
 */
const offsetAlong: (point: FlowPoint, toward: FlowPoint, distance: number) => FlowPoint = (point, toward, distance) => {
  const dx = toward.x - point.x;
  const dy = toward.y - point.y;
  const len = Math.hypot(dx, dy) || 1;
  const step = clampOffset(distance, len);
  return { x: point.x + (dx / len) * step, y: point.y + (dy / len) * step };
};

/**
 * **目标句柄轴的外法线**（单位向量）＝ 删除按钮「往 source 退」的方向。
 *
 * 🔴 为什么不用「起点→终点」直线近似：`smoothstep` 的**末段一定沿目标句柄轴**进入目标
 *    ⇒ 沿这条轴退才是严格的「沿线」。直线近似在**拐弯的边**上（目标句柄不在 source 的正对面、
 *    或节点横向错开很大）能与真实末段差 ~75° —— 按 dx=200 / dy=146 那种拐角算，26px 会变成
 *    「偏离线 ~21px、只沿线退 ~15px」，按钮就横在线旁边了。
 *    方位对应：目标句柄在 Top ⇒ 线从**上方**进目标 ⇒ 往回退就是 **-y**；Bottom / Left / Right 同理。
 * ⚠️ 中点那 `HANDLE_GAP` 仍用 `offsetAlong` 的直线近似（中点处没有唯一的轴）。
 */
const backAxis: (targetPosition: Position) => FlowPoint = (targetPosition) => {
  if (targetPosition === Position.Top) return { x: 0, y: -1 };
  if (targetPosition === Position.Bottom) return { x: 0, y: 1 };
  if (targetPosition === Position.Left) return { x: -1, y: 0 };
  return { x: 1, y: 0 };
};

function FlowEdgeLine({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  selected, markerEnd, style, label,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  /** 线上的字（判断框分出来的 Y / N 或学生自己写的）—— 只认字符串，节点式标签我们不用。 */
  /**
   * ★ 2026-10-06（教师认可）：**中点句柄**沿「标签点 → 目标端」方向挪 `HANDLE_GAP`。
   * 🔴 上一版把这段位移错加在 `edgeMidAnchor()` 上（那只服务**双击后的就地输入框**）⇒ 症状没治：
   *    句柄仍与线上的 Y/N 标签同点（悬停/选中变实就盖住那个字），并且**正落在中点的单击/双击被它吞掉**。
   * ✅ 复用模块级的 `offsetAlong`（与另两处偏移同一套规则：同一个方向约定 + 同一个上限）——
   *    极短边上距离同样被压到段长的 40% 以内，不会一路挪进目标节点里。
   * ⚠️ 交点节点用的是 `anchors.midX/midY`（**精确中点**），与此处无关 —— 拆出来的两段必须与原来的线重合。
   */
  const midHandle = offsetAlong({ x: labelX, y: labelY }, { x: targetX, y: targetY }, HANDLE_GAP);
  /**
   * ⚠️ 实测记录（无头 Chrome 154 + 教师那张真底稿 `q_aac88ed0…`，逐像素扫过 `elementFromPoint`）：
   *    短边上中点句柄与**框的句柄**在屏幕上会糊成一团（例如 0→处理过程 那条：两颗点的圆心只差
   *    **13.1px**，而每颗点本身 17.5px 宽；再短的一条差 8.5px ⇒ 中点那颗**整个被框的句柄盖住**）。
   *    `isValidHandle` 就是靠 `elementFromPoint` 定落点的，所以这里到底谁赢？
   *    ✅ 是**框的句柄赢**：`.react-flow__viewport` 的子元素顺序是
   *       `react-flow__edges → react-flow__edgelabel-renderer → react-flow__nodes`（实测 DOM），
   *       两层都没有 z-index ⇒ 后画的节点层在上面。**落点不会被中点句柄偷走**，
   *       所以这里**刻意不加**「离得太近就不画中点句柄」那种闸（加了只会白白砍掉中点点位）。
   *    ⚠️ 代价说清楚：极短边上中点那颗点可能是**点不中的**（被框的句柄盖住），但它只影响
   *       「连到线上」这一条路，不会反过来抢走框的句柄 —— 后者是更基本的那条路。
   */
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
      {/* ⚠️ 这颗句柄**不再**与上面的标签同点：`midHandle` 把它沿「标签点 → 目标端」挪了 14px
          （理由见上面那段注释）。它住在 `EdgeLabelRenderer` 那一层，DOM 上排在所有边之后
          ⇒ 画在标签之上，也因此必须挪开，否则正落在中点的单击/双击会被它吞掉。 */}
      <EdgeLabelRenderer>
        <Handle
          type="target"
          position={Position.Top}
          id="edge-mid"
          className={`${styles.flowEdgeHandle}${selected ? ` ${styles.flowEdgeHandleOn}` : ''}`}
          style={{ left: midHandle.x, top: midHandle.y }}
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
    /* ★ 删除按钮「往 source 退」的方向 = **目标句柄轴的外法线**（末段方向），不是「起点→终点」直线。
       ⚠️ 由 `targetPosition` 决定 —— 线从哪一侧进目标，就往那一侧退（见 `backAxis`）。 */
    const back = backAxis(targetPosition);
    const [, labelX, labelY] = getSmoothStepPath({
      sourceX: from.x, sourceY: from.y, sourcePosition,
      targetX: to.x, targetY: to.y, targetPosition,
    });
    return {
      midX: labelX, midY: labelY, endX: to.x, endY: to.y, fromX: from.x, fromY: from.y,
      backX: back.x, backY: back.y,
    };
  }, [edges, nodes]);

  /**
   * **中点**锚点 → 容器内坐标。就地文字输入框用它（标签就画在中点，就地编辑才顺手），
   * 连到线上时插的那个交点节点也用它算**流坐标**。
   */
  const edgeMidAnchor = (edgeId: string | null) => {
    const anchors = edgeFlowAnchors(edgeId);
    if (!anchors) return null;
    const { midX, midY, endX, endY } = anchors;
    // ★ 往目标端挪 `HANDLE_GAP`：既避开线上的 Y/N 标签，也把「正落在中点的单击/双击」还给那条线。
    const shiftedMid = offsetAlong({ x: midX, y: midY }, { x: endX, y: endY }, HANDLE_GAP);
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
    const { endX, endY, fromX, fromY, backX, backY } = anchors;
    /* ★ 往 source 退 `EDGE_FLOAT_BACK`：44px 的删除按钮不许盖住箭头、最后那段线，以及目标侧的连接点。
       ✅ 方向取**目标句柄轴**（`backX/backY` = 末段方向）⇒ 拐弯的边上也真的贴线；
          「起点→终点」直线近似在那种边上能偏出线外 ~21px（见 `backAxis` 的注释）。
       ✅ 距离过 `clampOffset`：短边上退不到 `EDGE_FLOAT_BACK` 就停住，不会越过中点 / source 端。 */
    const step = clampOffset(EDGE_FLOAT_BACK, Math.hypot(endX - fromX, endY - fromY));
    const shiftedEnd = { x: endX + backX * step, y: endY + backY * step };
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
    // ── ① 落点是**一条边**（连线中点那颗句柄）⇒ 插交点 + 拆原边 + **接上学生这一拖** ──────
    // ⚠️ 两个方向都要认（实测，无头 Chrome 154 + 教师那张真底稿）：
    //    · 从节点的 **source 句柄**拖到中点 ⇒ `connection.target` 是**边 id**；
    //    · 从节点的 **target 句柄**（菱形左侧那种）拖到中点 ⇒ `connection.source` 才是**边 id**
    //      （`isValidHandle` 在那个方向把两端的 source/target 对调了，见库源码那两句 connection）。
    //    只认 `connection.target` 的那一版会掉进 ②：凭空造一条 `source: <边 id>` 的**悬空边**
    //    —— 实测它在画布上**渲染不出来**（源不是节点），却已经写进学生的作答里。
    const hitEdge = edges.find((edge) => edge.id === connection.target || edge.id === connection.source);
    if (hitEdge) {
      /** 学生是从**边中点**那一侧拉出来的吗（否则就是从节点的句柄拉过来的）。 */
      const draggedFromEdge = connection.source === hitEdge.id;
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
        // ★ 学生**刚拉的那根线本身**也必须接上。
        //   🔴 只拆原线 = 画布上什么新东西都不会出现（教师 2026-10-06 报的「连线加不上」正是它）：
        //      拖拽时看到的预览线在松手那一刻消失，随后原线被拆成两段但**看上去还是原来那根线**
        //      ⇒ 学生的感受是「白拖了一次」，而数据里也确实没有他画的那根线。
        //   ⚠️ 方向按他从哪一侧拉：从节点的 source 柄拉 ⇒ X → 交点；从节点的 target 柄拉 ⇒ 交点 → X。
        const link: Edge = draggedFromEdge
          ? {
            id: `${junctionId}-link`,
            source: junctionId,
            sourceHandle: outHandle,
            target: connection.target,
            targetHandle: connection.targetHandle ?? null,
            type: 'flow',
          }
          : {
            id: `${junctionId}-link`,
            source: connection.source,
            sourceHandle: connection.sourceHandle ?? null,
            target: junctionId,
            targetHandle: inHandle,
            type: 'flow',
          };
        // ⚠️ 与拆出来的那一段**逐字段重合**时不再画第二根（同一根线画两遍 = 数据里两条重叠的线）。
        const twin = draggedFromEdge ? tail : head;
        const duplicated = link.source === twin.source && link.target === twin.target
          && (link.sourceHandle ?? null) === (twin.sourceHandle ?? null)
          && (link.targetHandle ?? null) === (twin.targetHandle ?? null);
        // ⚠️ 顺序：先摘掉原边 → 把 `tail` 交给 addEdge → 把 `head`（**沿用原边 id**）放回去 → 接上学生这一拖。
        //    沿用 id 是有意的：`selected` / `labelingEdge` 那些状态还指着它，拆线不该凭空多出悬空 id。
        return [...addEdge(tail, current.filter((edge) => edge.id !== original.id)), head, ...(duplicated ? [] : [link])];
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

  /**
   * ★ 2026-10-06（教师认可的第 1 步整理）：**一个选中模型** —— 单选，`null` = 什么都没选。
   * 点框 / 点线 / 点空白这三个入口都只写这一个槽位 ⇒「点框清线、点线清框」是**结构性成立**的，
   * 不必再靠三处状态互相当心清干净。
   */
  const [selected, setSelected] = useState<FlowSelection | null>(null);
  /** 正在改文字的那条线（双击进入）—— 它出现一个就地输入框（这不是「选中」，是进入编辑）。 */
  const [labelingEdge, setLabelingEdge] = useState<string | null>(null);
  /** 选中的是**线**时，工具条上出现「这条线标注」那一组（Y / N / 清空 / 自由文字）。 */
  const selectedEdgeId = selected?.kind === 'edge' ? selected.id : null;
  /**
   * 视口（`onMove` 给的 `{x, y, zoom}`）。
   * 🔴 用它把**流坐标**换算成容器内坐标：`local = viewport.x + flowX * zoom`。
   *    刻意不用 `useReactFlow().flowToScreenPosition` 来摆浮层：那个给的是**屏幕**坐标
   *    （含页面滚动），而浮层是定位在 `.flowStage` 里的 ⇒ 还得再减容器 rect；
   *    这里这三处偏移本来就是**流坐标**算出来的，一句乘法更直接，也少一次量容器。
   * ⚠️ 初始化成恒等变换；`onMove` 在平移/缩放时都会回调，所以浮层最多在一帧内偏一点。
   */
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  /**
   * ★ 2026-10-06（教师）：「可以删除这个图形**以及与它相连的线**」。
   *
   * 🔴 用库的 `deleteElements`，不自己 filter 那两步。理由（读过源码，不是"官方推荐"这种话）：
   *    `@xyflow/system` 的 `getElementsToRemove` 里有一句
   *    `getConnectedEdges(matchingNodes, deletableEdges)` —— **相连的边是它自己算的**，
   *    库还顺手处理了「删父节点带子节点」这种我们暂时没有、但将来别处可能长出来的关系；
   *    它删完是走 `triggerNodeChanges/triggerEdgeChanges`，也就是**回到我们传进去的
   *    `onNodesChange`/`onEdgesChange`** ⇒ 受控数据流不被绕开，`useNodesState/useEdgesState`
   *    照常更新（自写 filter 反而多一份「哪些边算相连」的判据要与库对齐）。
   * ⚠️ 取舍：它是 `async`（这里不关心返回的 `deletedNodes/deletedEdges`，`void` 掉）；
   *    它**认 `deletable: false`** —— 本仓所有节点/边都没有这个字段（老数据里那份「锁定」标记
   *    已在 `withoutLegacyLocks` 剥掉）⇒ 底稿的框同样删得掉，与「学生可以修改底稿」一致。
   */
  const { deleteElements } = useReactFlow<FlowNode, Edge>();

  /**
   * ★ 2026-10-06（教师认可的第 1 步整理）：删掉**当前选中的那一件** —— 画布上唯一的删除出口。
   *   · 选中的是**线** ⇒ 从 `edges` 里摘掉这一条；
   *   · 选中的是**框** ⇒ 交给库的 `deleteElements`（「与它相连的线」是库自己算的，理由见上）。
   * ⚠️ 交点**不做特例**：它也是一颗框，走的正是下面同一句 `deleteElements`（删它、连着它的线一起没，
   *    教师没有对交点提任何要求）。
   */
  const removeSelected = () => {
    const target = selected;
    if (!target) return;
    setSelected(null);
    setLabelingEdge(null);
    if (target.kind === 'edge') {
      setEdges((current) => current.filter((edge) => edge.id !== target.id));
      return;
    }
    void deleteElements({ nodes: [{ id: target.id }] });
  };

  /**
   * 被选中的**图形** ⇒ 它上边缘上方那颗删除按钮的**容器内坐标**（`.flowStage` 用的是这一套）。
   * ⚠️ 与线的浮层**同一套视口换算**（`local = viewport + 流坐标 × zoom`），别写成屏幕坐标。
   * ⚠️ 水平中心用 `measured.width`（库量出来的真实宽）：节点被长文字撑宽时按钮不会偏。
   * ⚠️ 找不到那个节点（刚被删/刚「恢复初始图」）就返回 null ⇒ 按钮不画，不留一颗悬空按钮。
   */
  const nodeFloatAnchor = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    const width = node.measured?.width ?? 150;
    const flowX = node.position.x + width / 2;
    const flowY = node.position.y - NODE_FLOAT_GAP;
    return { x: viewport.x + flowX * viewport.zoom, y: viewport.y + flowY * viewport.zoom };
  };

  /**
   * ★ 第 1 步整理：**一处锚点解析** —— 选中的是框就取「框上边缘上方」，是线就取「终点（箭头那一端）」。
   * ⚠️ 交点与普通框走**同一支**（它也是一颗框），解析里不许为它开特例。
   */
  const selectedAnchor = (() => {
    if (!selected) return null;
    return selected.kind === 'edge' ? edgeEndAnchor(selected.id) : nodeFloatAnchor(selected.id);
  })();

  /**
   * ★ 第 1 步整理：**一处渲染** —— 舞台里只有这一个浮层，两种形态：
   *   · `label`  —— 双击连线后的**就地输入框**（中点锚点，这条交互不许丢）；
   *   · `delete` —— 选中框 / 线后的**图标删除按钮**（框 ⇒ 连带删相连的线；线 ⇒ 删这条线）。
   * 🔴 `label` 优先：双击连线必然先触发一次单击 ⇒ 两个形态**结构性互斥**（不再靠两处状态互相当心清），
   *    否则那颗 44px 的按钮会压在这个输入框上。
   */
  const overlay = (() => {
    if (labelingEdge) {
      const anchor = edgeMidAnchor(labelingEdge);
      return anchor ? { mode: 'label' as const, edgeId: labelingEdge, anchor } : null;
    }
    if (!selected) return null;
    const anchor = selectedAnchor;
    if (!anchor) return null;
    return {
      mode: 'delete' as const,
      anchor,
      label: selected.kind === 'node' ? '删除这个图形' : '删除这条连线',
    };
  })();

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
    const label = edges.find((edge) => edge.id === selectedEdgeId)?.label;
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
        <span className={styles.drawingToolbarHint}>{selectedEdgeId ? '这条线标注：' : '从圆形连接点拖向另一节点即可连线'}</span>
        {selectedEdgeId && (
          <>
            {['Y', 'N', '是', '否'].map((value) => (
              <button className={styles.drawingToolbarButton} key={value} type="button" disabled={disabled} onClick={() => setEdgeLabel(selectedEdgeId, value)}>{value}</button>
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
              onChange={(event) => setEdgeLabel(selectedEdgeId, event.target.value)}
            />
            <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => { setEdgeLabel(selectedEdgeId, ''); setSelected(null); }}>清空</button>
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
          // ★ 2026-10-06（教师）：点图形就选中它；点线就选中那条线。
          //   ⚠️ 「选中」只有一个槽位 ⇒「点框清线、点线清框」是**结构性成立**的（不必两边互相清）。
          onNodeClick={(_, node) => { setSelected({ kind: 'node', id: node.id }); setLabelingEdge(null); }}
          onEdgeClick={(event, edge) => { event.stopPropagation(); setSelected({ kind: 'edge', id: edge.id }); setLabelingEdge(null); }}
          /*
            ★ 2026-10-06（教师）：「双击线条可以输入/修改连接线上的文字」。
            双击进入**就地输入框**（就在那条线中点），回车提交、Esc 取消。
            ⚠️ 单击仍是「选中这条线」（浮出删除按钮）—— 两件事分开，不互相抢。
          */
          onEdgeDoubleClick={(event, edge) => { event.stopPropagation(); setSelected({ kind: 'edge', id: edge.id }); setLabelingEdge(edge.id); }}
          // 浮层要跟着视口走（平移/缩放都会回调）
          onMove={(_, next) => setViewport(next)}
          // 点空白 ⇒ 选中清掉（「选中」是单选，点空就是没有选中），就地输入框也一起退掉。
          onPaneClick={() => { setSelected(null); setLabelingEdge(null); }}
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
          ★ 2026-10-06（教师认可的第 1 步整理）：**画布上只有这一处浮层** —— 三套（线的删除按钮、
          就地输入框、图形的删除按钮）合并成同一个 `overlay` 描述式的两个形态，位置都来自同一处
          锚点解析（`selectedAnchor` / `edgeMidAnchor`），都用视口换算成**容器内坐标**（`onMove` 跟）。
            · `label`  —— 双击连线后的就地输入框（**中点**锚点：线上的字就画在中点，就地编辑才顺手）；
            · `delete` —— 选中框 / 线后的图标删除按钮（框 ⇒ 连带删相连的线；线 ⇒ 删这条线）。
          ⚠️ 教师截图那条规矩仍在：**删除按钮用终点锚点**（目标节点那一侧的句柄点 = 箭头落点），
             就地输入框仍用中点 —— 两个锚点别合并。
          ⚠️ 正在改文字时**不画**删除按钮：双击必然先触发一次单击，两个形态叠在一起会互相压住
             （这里由 `overlay` 的两个形态**结构性互斥**保证）。
          ⚠️ 命中区复用 `.flowEdgeFloat`（44px 是硬要求：`worksheet-tap-targets.test.ts` 会把本模块里
             每一个按钮的命中区逐个量一遍；这个类已经写着 width/height = `FLOAT_SIZE`）。
          🔴 它必须住在 `.flowStage` **里面**、而且排在 `</ReactFlow>` **之后**：离了舞台就会按外层
             卡片定位（教师 2026-10-06 实测差出「卡片头 + 工具条」那约 280px）。
        */}
        {overlay && (overlay.mode === 'label' ? (
          <input
            className={styles.flowEdgeInput}
            style={{ left: overlay.anchor.x, top: overlay.anchor.y }}
            autoFocus
            maxLength={12}
            disabled={disabled}
            aria-label="这条连线上的文字"
            placeholder="线上文字"
            defaultValue={String(edges.find((edge) => edge.id === overlay.edgeId)?.label ?? '')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { setEdgeLabel(overlay.edgeId, event.currentTarget.value); setLabelingEdge(null); }
              if (event.key === 'Escape') setLabelingEdge(null);
            }}
            onBlur={(event) => { setEdgeLabel(overlay.edgeId, event.currentTarget.value); setLabelingEdge(null); }}
            onPaste={(event) => {
              // 与「评分标准」同一个归一化：从 Word 复制带进来的排版在这里同样是噪音。
              const raw = event.clipboardData.getData('text/plain');
              if (!raw) return;
              event.preventDefault();
              event.currentTarget.value = normalizePastedText(raw).slice(0, 12);
            }}
          />
        ) : (
          <button
            className={styles.flowEdgeFloat}
            type="button"
            disabled={disabled}
            aria-label={overlay.label}
            title={overlay.label}
            style={{ left: overlay.anchor.x, top: overlay.anchor.y }}
            onClick={removeSelected}
          >
            <svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.trash} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FlowchartDrawing(props: DrawingSurfaceProps) {
  return <ReactFlowProvider><FlowchartEditor {...props} /></ReactFlowProvider>;
}

/** 流程图的边统一用这个箭头（与快照 SVG 里的 `marker-end` 同一形状）。 */
const FLOW_ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#6b86a5' } as const;
