'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
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
  reconnectEdge,
  getSmoothStepPath,
  type NodeProps,
} from '@xyflow/react';
// ★ 2026-10-06（教师）：「加上去的字变成了小黑块」——根因是这里原来引的是 **base.css**
//   （只有布局、**没有颜色**）：边的标签那个背景矩形拿不到 `fill` ⇒ 渲染成黑块；
//   右下角三个控制键同样没有按钮底。换成带主题的 `style.css`（库自己那一份）即可。
//   ⚠️ 标签的颜色我们另外在 `worksheet.module.css` 里钉住（见 `.react-flow__edge-text*`），
//      免得将来换主题时它又变成不可读的颜色。
import '@xyflow/react/dist/style.css';

import {
  canRedo,
  canUndo,
  emptyHistory,
  flowchartSignature,
  pushHistory,
  redoHistory,
  undoHistory,
  type FlowHistory,
  type FlowSnapshot,
} from '@/lib/worksheet-flowchart-history.ts';
import { tidyFlowchart } from '@/lib/worksheet-flowchart-layout.ts';
import { flowchartSvg } from '@/lib/worksheet-flowchart-svg.ts';
import { svgToPngBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
import { normalizePastedText } from '@/lib/worksheet-text-normalize.ts';
import {
  mergeFlowchart,
  restoreFlowchart,
  readFlowchartPayload,
  subtractFlowchart,
} from '@/lib/worksheet-drawing-starter.ts';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

/**
 * 节点种类。
 * ★ 2026-10-06（教师，A 方案）：「新建的连接线可以连在另一根连接线的中点上」——
 *   `junction`（交点 —— **界面上叫「连接点」**，信息科技课教材里线交叉/汇合处那个小圆就叫这个）
 *   就是那颗**小圆点**：它不是从工具栏放下来的，而是「连到线上」时
 *   由 `onConnect` 现场插进那条线里、并把原线拆成两段的那个节点。
 */
type FlowKind = 'terminator' | 'process' | 'decision' | 'io' | 'junction';
type FlowData = { label: string; kind: FlowKind; locked?: boolean };
type FlowEdgeData = { routeX?: number; routeY?: number };

/**
 * 工具按钮上的**形状图标**（★ 2026-10-06 教师：「分别加上一个形象的图形表示」）。
 * 画的正是这个按钮会放下的那个节点形状 —— 学生看一眼就知道按下去会得到什么，
 * 不必先读「平行四边形」这四个字。
 * ⚠️ 与 `worksheet-flowchart-svg.ts`（快照）里那几种形状**同源**：胶囊 / 矩形 / 菱形 / 平行四边形。
 * ⚠️ `junction` 那一项是**凑键用的**：连接点是「连」出来的、工具栏上没有它的按钮
 *    （`FlowKind` 里加了它，这张表就少一个键 —— 少一个键 TS 会当场报错）。
 */
const FLOW_ICONS: Record<FlowKind | 'restore' | 'tidy' | 'trash', string> = {
  terminator: 'M7 5.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Z',
  process: 'M4 6.5h16v11H4Z',
  decision: 'M12 3.6 20.4 12 12 20.4 3.6 12Z',
  io: 'M8 6.5h12l-4 11H4Z',
  junction: 'M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z',
  restore: 'M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5',
  tidy: 'M4 6h5M15 6h5M9 3v6M4 18h5M15 18h5M15 15v6M7 12h10',
  trash: 'M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l1 11h8l1-11M10.5 10.5v5M13.5 10.5v5',
};
export type FlowIconKey = keyof typeof FLOW_ICONS;
type FlowNode = Node<FlowData>;

/**
 * ★ 2026-10-06：边的**类型**就这一个名字，别在别处再写字面量。
 *   · `FLOW_EDGE_TYPE` —— **我们注册的那份只管标签的自定义边**（`FlowLabelEdge`，见上）：
 *     线由 `BaseEdge` 画、标签摆在线的旁边（教师给的标准图）。
 *   · ⊘ `LEGACY_EDGE_TYPE = 'flow'` 已经删掉：现在**所有**不是这个类型的边都会被换成它
 *     （见 `visibleEdges`）—— 旧的 `'flow'`、上一版写进作答里的 `'smoothstep'`、
 *     以及任何手改出来的怪类型，全都一视同仁。
 *     ⚠️ 必须**全部**换：老作答里存着 `'smoothstep'`（上一版的 `FLOW_EDGE_TYPE`），
 *     只换 `'flow'` 的话那些线的标签仍然压线，同一个画板上两种摆法并存。
 */
const FLOW_EDGE_TYPE = 'flowLabel';

/**
 * ★ 2026-10-06（教师拍板 + 参考图）：**判断框出边的默认标注**是「是 / 否」，不是 `Y / N`。
 *
 * 🔴 信息科技课教材与教师给的那张标准流程图用的都是汉字 ⇒ 默认值跟着教材走。
 *    · 第一条出边 ⇒ `是`；第二条 ⇒ `否`；**再多不猜**（返回 `undefined`，不给第三条硬凑一个字）。
 *    · 工具条里仍然提供 `Y / N / 是 / 否 / 清空` 五个**快按钮**（见下面那组 `['Y','N','是','否'].map`）
 *      —— 学生想用字母随时点，那一组一个字都不动。
 * ⊘ ⚠️ **不许迁移已存数据**：老作答 / 老底稿里那条 `label: 'Y'` 照原样渲染（`toFlowPayload` 与
 *    `readFlowchartPayload` 都不碰 `label`）—— 这是默认值改了，不是数据改了。
 * ⚠️ 单独抽成常量 + 纯函数（而不是在 `onConnect` 里现写三元）：这样「0 ⇒ 是 / 1 ⇒ 否 / 更多不给」
 *    这条**计数语义**能用**真调用**验（`surface-lifecycle.test.ts` 会把它抠出来喂 0/1/2/3）。
 */
const DECISION_BRANCH_LABELS = ['是', '否'] as const;
const decisionBranchLabel: (used: number) => string | undefined = (used) => {
  return DECISION_BRANCH_LABELS[used];
};

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
  const [editing, setEditing] = useState(false);
  /**
   * 编辑期间的**本地草稿**（★ 2026-10-06 教师报「双击后无法输入中文」的修法）。
   *
   * 🔴 原先是直接受控到 store（`value={data.label}` + 每次按键 `updateNodeData`）——
   *    那样每敲一个键都会让画板的 `visibleNodes` 重算、**全图重渲染**。中文输入法要靠
   *    连续几次按键维持一个「组合态」，这个往返正好把它打断：候选框和拼音字母一起没掉。
   *    英文是逐字提交的，所以从现象上看「只有中文不行」。
   * ✅ 现在打字只改这个本地 state（React 自己的更新，与 DOM 始终一致），Enter/blur 才提交。
   *    连线标签那个就地输入框一直是这么做的（`defaultValue`），是本文件里「中文能打」的对照物。
   */
  const [draft, setDraft] = useState(data.label);
  /** ⚠️ 宽度跟着**正在编辑的那一份**走：编辑时看 draft，平时看 store 里的 label。 */
  const textWidth = Math.min(30, Math.max(10, Array.from(editing ? draft : data.label).length + 2));
  /**
   * 提交草稿（blur / Enter / Escape 都汇到这里）。
   * ⚠️ 只在**真改了**的时候才写 store：双击进来什么都没动就点走，不该产生一次「内容变更」
   *    （那会让画板往外报一次、快照跟着重算一次）。
   */
  const commitLabel = () => {
    setEditing(false);
    if (draft !== data.label) instance.updateNodeData(id, { label: draft });
  };
  /** ★ 连接点是**一个小圆点**、没有文字 ⇒ 它不能有那个可编辑文字输入框（否则图上多一个空框）。 */
  const isJunction = data.kind === 'junction';
  return (
    <div className={`${styles.flowNode} ${styles[`flowNode_${data.kind}`]}`} data-selected={selected ? '1' : '0'}>
      {/* ★ 2026-10-06（教师）：「判断框怎么这个形状？」——菱形改成**画出来的**（原来是旋转 45° 的方块）。
          ⚠️ `overflow: visible` 不需要：这块 SVG 撑满盒子，四个顶点正好是四个连接点。 */}
      {data.kind === 'decision' && (
        <svg className={styles.flowNodeShape} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {/* ⚠️ `strokeWidth` 必须与 CSS 的 `.flowNode { border: 1.5px }` **同值**：
              菱形是**画出来的** SVG，其它形状的描边是 CSS border —— 两处各写一个数就会分叉。
              教师 2026-10-06 报的正是这个（「菱形的框太粗了，要跟其它图形一样」，当时这里是 3、
              CSS 是 1.5）。`flowchart-node-stroke.test.ts` 把两边现读现比，改任一边都会红。 */}
          <polygon points="50,1.5 98.5,50 50,98.5 1.5,50" fill="#fff" stroke="#7895b3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {/* ⚠️ 交点也要**四个句柄照旧**：它的上/下就是那两段线接上去的地方。 */}
      {/* 四个点都使用 source + Loose 模式：这样任意两侧都能互连，包括“左点 → 上点”。 */}
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      {/* ★ 2026-10-06（教师）：「选中一个图形准备移动时，后面的图形都一起移动」——
          根因是这一格原来挂着 `className="nodrag"`：React Flow 的节点拖动过滤器里那句
          `hasSelector(target, '.nodrag', domNode)` 命中 ⇒ **这一格上按下拖动不拖节点**，
          事件穿透到画布 ⇒ 变成整块画布平移（只有从边框那几像素起拖才拖得动框）。
          🔴 实测（无头 Chrome 154 + 本仓 React Flow 12.11.6）：去掉它之后，从框中间（文字上）
          按下拖动 = 拖动这个框；而**单击**仍然会聚焦输入框（浏览器在 mousedown 的默认行为里聚焦），
          代价只是「在输入框里按住拖来选中文字」会变成拖框 —— 对一个短标签可以接受，也更符合直觉。
          ⚠️ 全文件只有这一处挂过 `nodrag`，别的元素没有。 */}
      {!isJunction && (editing && !data.locked ? (
        <input
          className="nodrag"
          aria-label="节点文字"
          autoFocus
          value={draft}
          style={{ width: `${textWidth}em` }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            /* ⚠️ 输入法组合中：Enter 是「上屏候选词」、Escape 是「取消组合」，两个键都归输入法用，
               不能当成「确认/放弃」—— 不看这一条，按回车的那一瞬间编辑框就关了。
               这与上面「组合被重渲染打断」是**两件**独立的事，得各修各的。
               `keyCode === 229` 是老浏览器（含 Safari 15）的兜底：组合期间它固定是 229。 */
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
          }}
        />
      ) : (
        <span
          className={styles.flowNodeLabel}
          title={data.locked ? undefined : '双击修改文字'}
          onDoubleClick={(event) => { event.stopPropagation(); setDraft(data.label); setEditing(true); }}
        >{data.label}</span>
      ))}
    </div>
  );
}

/*
  ★ 2026-10-06（教师上传的标准流程图）：**线标签只许那一份自定义边** —— 它除了「把线画出来 +
    把标签摆到线的旁边」什么都不管。
  🔴 教师的问题：库内置边把标签画在**路径中点正上方并压住线**（白底框盖住那一小段），
    而标准流程图里标注是写在**线的旁边**的（判断框分出的两条线：竖线的字在**右侧**、
    横线的字在**上方**），文字紧贴但完全不压线。
  🔴 为什么「往哪一侧偏」必须由**方向**决定、纯 CSS 做不到：同一个标签元素，竖线要往 +x 偏、
    横线要往 -y 偏，而 CSS 拿不到这条路径的方向（`targetPosition` 只有组件里才有）。
  ⊘⊘ **绝不要**把以前删掉的那套带回来（见下面那段注释）：不要 `Handle`、不要 `data-nodeid`、
    不要用它来接任何连线 —— 这一份自定义边**只画标签**，连线全靠 `EDGE_SNAP_RADIUS` 那套几何吸附。
  ⚠️ 标签必须**还在边的 `<g>` 里**（不是 `EdgeLabelRenderer` 那个 portal）：库把
    `onEdgeDoubleClick` 挂在边外面那层 `<g class="react-flow__edge">` 上，portal 出去之后
    事件不再冒泡到它 ⇒「双击标签改文字」会变成「点空白、取消选中」（实测过）。
    在 `<g>` 里画的话标签与线走**同一条**事件路，双击哪一处都进就地输入框。
  ⚠️ 箭头：`markerEnd` 是库算好的 `url('#…')`，必须原样转交给 `BaseEdge`，否则箭头会没。
*/

/** 标签离线多远（**流坐标**；屏幕上还要乘 zoom —— 默认视图 zoom≈1.25 ⇒ 约 10 屏幕 px）。 */
const EDGE_LABEL_GAP = 8;

/**
 * **只管标签**的自定义边：`BaseEdge` 画线（带箭头）+ 一个自己摆位的 `<text>`。
 *
 * 摆位规则（教师给的标准图）：
 *   · 线**进目标那一侧**是上/下（末段竖直）⇒ 标签在线的**右侧**：`textAnchor="start"` +
 *     `x = labelX + GAP` ⇒ 不管标签多长，它的**左边缘**都贴在线右侧 `GAP` 处，永不压线；
 *   · 是左/右（末段水平）⇒ 标签在线的**上方**：`textAnchor="middle"` + `y = labelY - GAP` ⇒
 *     基线抬到线的上方 `GAP` 处（字形最低点还在基线之上）⇒ 也永不压线。
 * ⚠️ 「按长度居中再偏移」那套**不行**：`是/否` 两个字与 12 字自定义标注的宽度差十倍，
 *    居中会让长标签横跨回线上。`textAnchor` 两个方向各取一个，才与长度无关。
 * ⚠️ 文字颜色/字号在 `worksheet.module.css` 的 `.flowEdgeLabel` 里钉住（深色，无白底框）。
 */
function FlowLabelEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, style, data,
}: EdgeProps) {
  const route = data as FlowEdgeData | undefined;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    ...(Number.isFinite(route?.routeX) && Number.isFinite(route?.routeY)
      ? { centerX: route!.routeX, centerY: route!.routeY }
      : {}),
  });
  // ⚠️ `<text>` 里只放得了字符串：`Edge.label` 的类型是 `string | ReactNode`（我们只写字符串）。
  const text = typeof label === 'string' ? label : '';
  const vertical = targetPosition === Position.Top || targetPosition === Position.Bottom;
  return (
    <>
      {/* ⚠️ `markerEnd` 必须转交给 `BaseEdge` —— 自定义边忘了它 = 箭头没了（教师问过的那件事）。
          ⚠️ `BaseEdge` **不**接 `label`：库那套标签是「居中压线」的，正是本轮要换掉的东西。 */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {text ? (vertical ? (
        <text className={styles.flowEdgeLabel} x={labelX + EDGE_LABEL_GAP} y={labelY} dy="0.35em" textAnchor="start">{text}</text>
      ) : (
        <text className={styles.flowEdgeLabel} x={labelX} y={labelY - EDGE_LABEL_GAP} textAnchor="middle">{text}</text>
      )) : null}
    </>
  );
}

/*
  ⊘ 2026-10-06：这里原有「**自定义边** `FlowEdgeLine` + 线上中点那颗 `Handle`（`id="edge-mid"`
    + 补的 `data-nodeid = 边 id`）」那一整套 —— **已整段删除**，别再照着旧版本加回来。
  🔴 删它的硬理由（读 `@xyflow/system@0.0.82` + 无头 Chrome 实测）：那颗句柄住在
    `EdgeLabelRenderer` 里 ⇒ 库的 `useNodeId()` 返回 null ⇒ `XYHandle.onPointerDown` 里
    `getHandle()` 拿 `nodeLookup.get(null)` 得 undefined，**在挂任何监听之前就 return**
    ⇒ 它只能「接」、**不能「起」**（从线中点拖向框那条路结构性不通）。
    而「接」这一侧我们已经有更好的那一份：见下面的 `EDGE_SNAP_RADIUS`（几何兜底，按距离认线）。
    ⇒ 两条机制并存只会让「精确命中」与「附近松手」走两套判据，留下一颗会吞掉中点单击的句柄。
  ⚠️ 删掉它之后，线上那颗句柄带来的两个**副作用**也一并消失：压住 Y/N 标签、吞掉正落在中点的
    单击/双击 —— 所以 `edgeMidAnchor` 不再需要 `HANDLE_GAP` 那套偏移（见那里的注释）。
*/

/**
 * ★ 2026-10-06（教师认可的第 2 步整理）：浮层的几何**就这一条规则**，数值全部在这里命名。
 *
 * 规则一句话：**画布上的浮层一律是 44px 的命中区，从锚点沿「法线 / 目标句柄轴」往外偏移，
 * 永不压住句柄，偏移距离吃段长上限（`clampOffset` ≤ 40%）。**
 *
 *   · `FLOAT_SIZE`      —— 命中区 44px（老 iPad 的手指下限）。
 *   · `NODE_FLOAT_GAP`  —— 删除**图形**的按钮：中心在节点上边缘**上方**多少（流坐标）。
 *   · `EDGE_FLOAT_BACK` —— 删除**连线**的按钮：沿**目标句柄轴**（smoothstep 末段方向）往 source 退多少（流坐标）。
 *
 * ⊘ 2026-10-06：这里原来还有第四个常量 `HANDLE_GAP`（**中点浮层**沿「中点 → 目标端」挪多少）——
 *   它唯一的目的是避让那颗**中点句柄**（既别压住线上的 Y/N 标签，也别吞掉正落在中点的
 *   单击/双击）。句柄随自定义边一起删掉之后这两件事都不存在了 ⇒ 就地输入框回到**裸标签点**
 *   （见 `edgeMidAnchor`）。⚠️ 别再把它加回来：那会让输入框与它要改的那个字分家。
 * 🔴 `EDGE_FLOAT_BACK` 仍然**独自**存在：起点是**终点**（箭头落点）、方向是**目标句柄轴的外法线**
 *   ⇒ 目的是让删除按钮别盖住箭头、最后那段线和目标侧的连接点。它从来不是「那个 18 换个名字」，
 *   以后也不许拿别的数去替代它。
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
/**
 * ★ 2026-10-06（教师：「小学课堂上拖到线附近松手要能连上」）：**连到线上的吸附半径**（屏幕 px）。
 *
 * 🔴 这是「连到线上」**唯一**的一条路（2026-10-06 起）：松手时按**指针到各边中点的屏幕距离**找最近
 *    的一条边，≤ `EDGE_SNAP_RADIUS` 就走**唯一一份**拆线实现（`splitEdgeAt`）把原边拆成两段、
 *    中间插一个交点小圆点、并接上学生拉的那根线。
 *    ⊘ 原来还有第二条路（自定义边上那颗中点 `Handle`，由库自己的 `isValidHandle` 判定落点）——
 *      已整段删除（理由见文件上方那段）。两条并存时「精确命中」与「附近松手」会走两套判据，
 *      而且那颗句柄既压住线上的 Y/N 标签、又会吞掉正落在中点的单击/双击。
 *    ⚠️ 为什么当初不得不自己接管：那颗句柄住在自定义边里、**不是节点** ⇒ 它不在库的 `nodeLookup`
 *      里，于是库给节点句柄的那套 `connectionRadius`（默认 20）的**几何吸附对它完全无效**
 *      （`getClosestHandle` 只遍历 `nodeLookup`）；库对它的落点判定只剩 `isValidHandle()` 里那条
 *      `document.elementFromPoint(x, y)` —— **落点必须真的压在那颗句柄的盒子上**。
 *      实测（无头 Chrome 154 + CDP 真合成鼠标事件）：偏句柄圆心 **0px** ⇒ 连上；偏 **5px** 就已经
 *      什么都不发生（落点被边上那条 SVG path 抢走）—— 教师说的「偏 15px 松手什么都不发生」
 *      正落在这个区间里。
 *    ⚠️ 也试过「把句柄自己撑大」（36 / 40px 的透明命中层）：连接是好了，但那个盒子会把线上的
 *      Y/N 标签白底框的**下半截**吃掉（实测 `elementFromPoint(标签中心)` 返回句柄而不是边），
 *      「双击线上的字改文字」当场坏掉 —— 那是更常用的交互，不能拿它换。
 *
 * 📏 22 的来由：
 *   · 与库自己的 `connectionRadius` 默认值（20）同一档 —— 学生不该在两个「连接点」上感受到两套精度；
 *   · 实测（本仓那套 CDP 探针，落点相对**那条线的中点**量）：偏 **15px 连上**、偏 **20px 连上**、
 *     偏 **25px 不连** ——「偏 15px 松手什么都不发生」这个原始故障被治好；
 *   · 为什么不是正好 20：中点有两份算法（我们按库 `getSmoothStepPath` 算的标签点、DOM 里那个
 *     白底框的中心），实测两者差 ~0.4px；取 20 时「偏 20px」正好卡在边界上（实测 20.02px 就落空）。
 *     22 把这条边界推出去 2px，同时 25px 仍然不连（该连的连上、不该连的不连）。
 *   · 单位是**屏幕 px**，不是流坐标：手指的精度发生在屏幕上，画布缩到 0.35 倍时 20 流坐标只有
 *     7 屏幕 px（等于没吸附），放大到 2.2 倍又会吸走老远的边。
 * ⚠️ 与**框的句柄**的竞争：落点**正压**在框的句柄上（`elementFromPoint` 在节点层拿到它）时让位；
 *    落点在句柄**附近**（≤ `NODE_HANDLE_PRIORITY_RADIUS`）时同样让位 —— 见下面那个常量。
 * ⚠️ 这一路只管「从**节点的句柄**拖出来」那一类（`onConnectStart` 记下的起点）。
 * ⚠️ 拖动**过程中**的「会吸到哪条边」高亮用的是**同一份** `nearestEdgeAt` —— 两份必然分叉，
 *    而分叉的表现是「高亮的是 A、真吸上去的是 B」，屏幕上不报错。
 */
const EDGE_SNAP_RADIUS = 22;

/**
 * ★ 2026-10-06（教师截图）：**框的句柄优先半径**（屏幕 px）—— 比 `EDGE_SNAP_RADIUS` 大。
 *
 * 🔴 教师截图里那个病：一条**从右侧绕回来**的线，本来该直接以一个向左的箭头进「处理过程」框的
 *    **右侧**；实际却吸附到框下方那条**竖线**上、把竖线拆成两段并留下一个交点圆点
 *    （画面上多出一个大圆点，箭头也变成从上往下进框底）。
 *    根因：兜底原来只看「落点正下方压着 `.react-flow__handle`」—— 学生拖到框**附近**（离右侧句柄
 *    十几二十 px）时落点并没有压住那颗 10px 的句柄，于是兜底照旧按距离去吸线下那条竖线。
 *
 * ✅ 判据改成**句柄优先**：落点附近（≤ 这个半径）存在**某个节点句柄** ⇒ 整段兜底不做，
 *    让库自己去连那个框（学生想要的就是「拖到框附近就连框」）。
 *    ⚠️ 排除**这一拖的起点句柄本身**（与库 `getClosestHandle` 里那句跳过 `fromHandle` 一致）：
 *      否则「从某句柄拖出去一点点」会被自己那颗句柄挡住，连「附近有一条线」也吸不上了。
 *    ⚠️ 半径必须与库那边**对齐到同一个屏幕半径** —— 那一边才是库判定「落点算不算落在句柄上」
 *      的半径（`getClosestHandle` 里 `distance > connectionRadius` 就跳过）。
 *      🔴🔴 **单位不一样**（读 `@xyflow/system@0.0.82` + 实测确认）：
 *        · 库的 `connectionRadius` 比的是**流坐标**（`getClosestHandle(pointToRendererPoint(…),
 *          connectionRadius, …)` 两端都是流坐标）⇒ **默认 20 流单位**；
 *        · 我们这一条比的是**屏幕 px**（与 `EDGE_SNAP_RADIUS` 同一套：手指的精度发生在屏幕上）。
 *      ⇒ 传进去的必须是 `NODE_HANDLE_PRIORITY_RADIUS / zoom`（见 `<ReactFlow>` 那一行）。
 *        直接传 `NODE_HANDLE_PRIORITY_RADIUS` 会留下两段环（**实测**：zoom=1.42 时
 *        库那边的屏幕半径是 40×1.42 ≈ 57px ⇒ 「离句柄 50px 松手」也会连框，
 *        而我方让位半径只有 40px ⇒ 那一圈里库连框 + 兜底还可能同时吸线）。
 *      📏 库的默认 `connectionRadius` 是 20 流单位（`@xyflow/react` store 初值）。
 *    📏 40 的来由：那颗句柄的命中盒只有 10px（CSS `.flowNode :global(.react-flow__handle)`），
 *      而学生的手指/鼠标精度在 ±20px 上下；40 大致等于「贴着框试」的范围，同时仍远小于常见
 *      节点间距（150×54 的框、默认间距上百 px）⇒ 不会把「拖到线附近」那一格全吃掉。
 *      ⚠️ 实测数字（无头 Chrome + CDP，跑本仓真组件，探针只放 /tmp）：
 *      离右侧句柄 **10 / 20 / 30 / 40 屏幕 px** 松手 ⇒ 连**框**（进右侧句柄、不插交点）；
 *      **45 / 50px** ⇒ 什么都不做（两边的半径在同一个屏幕上界上收住 ⇒ 没有死环）；
 *      拖到线中点附近（离任何句柄都很远）⇒ 仍走 22px 的吸附、连**线上**（恰好 1 个交点）。
 */
const NODE_HANDLE_PRIORITY_RADIUS = 40;

/**
 * 节点上四个句柄的 id（与 `FlowNodeEditor` 里那四个 `Handle` 一致：上 / 右 / 下 / 左）。
 * ⚠️「落点附近有没有句柄」那条判据要按**四个句柄**逐个算距离 —— 它们的屏幕坐标不在节点中心，
 *    只算节点中心会把「离框很近、但离句柄还远」也误判成命中。
 */
const FLOW_HANDLE_IDS = ['top', 'right', 'bottom', 'left'] as const;

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

/**
 * 一个节点上某个句柄的**流坐标** —— 起止点按「句柄在节点那一侧边上**居中**」算（库就是这么摆的）。
 * ⚠️ 抽成模块级是因为两处要用：锚点表（`edgeFlowAnchors`）与 `onConnectEnd` 的几何兜底。
 *    两份各写一遍必然分叉，而分叉的表现是「吸附算出来的距离整体偏半个节点」这种**不报错**的错。
 * ⚠️ 宽高优先用库量出来的 `measured`（真实尺寸），没量到才退回 150×54 —— 与画布默认值同一档。
 */
const handleFlowPoint = (node: FlowNode, handleId: unknown, fallback: Position): FlowPoint => {
  const box = {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? 150,
    height: node.measured?.height ?? 54,
  };
  const position = positionOfHandle(handleId, fallback);
  return position === Position.Top ? { x: box.x + box.width / 2, y: box.y }
    : position === Position.Bottom ? { x: box.x + box.width / 2, y: box.y + box.height }
      : position === Position.Left ? { x: box.x, y: box.y + box.height / 2 }
        : { x: box.x + box.width, y: box.y + box.height / 2 };
};

/** 流程图几何里用的一个点（纯函数之间传参用，省得把 `{ x: number; y: number }` 写两遍）。 */
type FlowPoint = { x: number; y: number };

/**
 * 一次鼠标/触摸事件落在**哪儿**（页面坐标）；**拿不到就回 `null`**，调用方据此整段走人。
 *
 * 🔴 为什么必须单独一个纯函数，而不是直接读 `event.clientX`（这是**主设备上的功能缺口**）：
 *    学生用的是 iPad ⇒ 拖拽走的是 **`TouchEvent`**，而 `TouchEvent` **没有** `clientX/clientY`
 *    —— 那两个坐标挂在 `touches` / `changedTouches` 里**每一根 Touch** 上。
 *    上一版的闸是 `if (!('clientX' in event)) return;` ⇒ **触屏整段被挡在门外** ⇒ iPad 上
 *    「拖到线附近松手」仍然只认精确命中那颗 10px 的点。
 *    实测（无头 Chrome 154 + `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`，
 *    触屏拖拽从 n3 上句柄到线中点附近）：改前偏 **0px（正落在线上中点）** 就什么都不发生；
 *    改后偏 15px / 20px 都连上（见 `surface-lifecycle.test.ts` 里那条用例的数字）。**0px 那一格最刺眼**
 *    —— 触屏下学生就算**正正落在线上**也连不上，只因为那颗句柄当时被挪开了 18px。
 *
 * 🔴 两个语义细节（都是实测出来的，别按「看起来等价」改）：
 *    · **`touchend` 那一刻 `touches` 已经空了**，抬起来的那一根在 `changedTouches` 里
 *      ⇒ 必须**优先 `changedTouches[0]`**。先读 `touches[0]` 会正好在「松手」这一格拿到 undefined
 *      —— 而松手那一格才是决定「连不连」的那一格。
 *      ⚠️ 库自己那份 `getEventPosition` 就是 `event.touches?.[0].clientX`（`@xyflow/system` 0.0.82）：
 *      它在 `touchend` 上会抛 `Cannot read properties of undefined`，只因为库在 `onPointerUp` 里
 *      **不重算坐标**（用的是上一次 `touchmove` 缓存的结果）才没炸。我们的兜底必须自己拿坐标
 *      ⇒ 这条洞躲不过去，只能按上面那句写对。
 *    · `touchmove` 时 `changedTouches` 与 `touches` 是同一根手指 ⇒ 两者等价，`touches[0]` 当兜底。
 * ⚠️ 纯函数、放**模块级**：`surface-lifecycle.test.ts` 会把它抠出来喂四种假事件**真跑一遍**
 *    （`touchend` 那种「`changedTouches` 有、`touches` 空」是必测的一条）。
 */
const pointerClientPoint: (event: MouseEvent | TouchEvent) => FlowPoint | null = (event) => {
  // 鼠标 / 指针事件（PointerEvent 继承 MouseEvent）走这一支。
  if ('clientX' in event && 'clientY' in event) return { x: event.clientX, y: event.clientY };
  // ⚠️ 顺序不能反：`touchend` 时 `touches` 为空，抬起来那一根只在 `changedTouches` 里。
  const touch = event.changedTouches?.[0] ?? event.touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

/**
 * 偏移量的**上限**：不超过这一段长度的 **40%**。
 *
 * 🔴 为什么必须有：`EDGE_FLOAT_BACK` 是给**常见边长**定的（节点 150×54、默认间距上百 px）。
 *    学生把两个框拖到几乎贴住时，这一段可能只剩 ~20px —— 26px 会越过中点、极短边上甚至越过 source 端
 *    ⇒ 浮层（删除按钮）飞出线外，看着像「按钮丢了」。
 *    取 **40%（小于一半）** ⇒ 退完一定还在**靠终点这一侧**，不会越过中点。
 * ⚠️ 纯函数、且放**模块级**：`surface-lifecycle.test.ts` 会把它抠出来喂**短边**验算
 *    （那一层没有 jsdom，不能 import 这个 'use client' 组件）。参数的**类型写在 `const` 那一侧**
 *    ⇒ 抠出来的 `(distance, span) => { … }` 本身就是合法 JS。
 */
const clampOffset: (distance: number, span: number) => number = (distance, span) => {
  const maxRatio = 0.4;
  return Math.min(distance, span * maxRatio);
};

/*
  ⊘ 2026-10-06：这里原有 `offsetAlong`（把锚点沿「point → toward」推开一段，给中点句柄与就地输入框
    用的那套偏移）。它只剩**一个**调用点（`edgeMidAnchor`），而中点那句现在回到裸标签点
    ⇒ 函数本身变成死代码，一并删除。`clampOffset` 留着 —— 删除按钮（`edgeEndAnchor`）还在用它。
*/

/**
 * **目标句柄轴的外法线**（单位向量）＝ 删除按钮「往 source 退」的方向。
 *
 * 🔴 为什么不用「起点→终点」直线近似：`smoothstep` 的**末段一定沿目标句柄轴**进入目标
 *    ⇒ 沿这条轴退才是严格的「沿线」。直线近似在**拐弯的边**上（目标句柄不在 source 的正对面、
 *    或节点横向错开很大）能与真实末段差 ~75° —— 按 dx=200 / dy=146 那种拐角算，26px 会变成
 *    「偏离线 ~21px、只沿线退 ~15px」，按钮就横在线旁边了。
 *    方位对应：目标句柄在 Top ⇒ 线从**上方**进目标 ⇒ 往回退就是 **-y**；Bottom / Left / Right 同理。
 */
const backAxis: (targetPosition: Position) => FlowPoint = (targetPosition) => {
  if (targetPosition === Position.Top) return { x: 0, y: -1 };
  if (targetPosition === Position.Bottom) return { x: 0, y: 1 };
  if (targetPosition === Position.Left) return { x: -1, y: 0 };
  return { x: 1, y: 0 };
};

/*
  ⊘ 2026-10-06：这里原有 `function FlowEdgeLine(...)`（自定义边：自己画 Y/N 标签 + 在中点挂那颗
    `Handle`）。整段删除 ⇒ 边改回**库自己渲染**（内置 `smoothstep` 边，标签与箭头都由库画）。
  ⚠️ 库自己渲染标签用的正是 `.react-flow__edge-textbg` / `.react-flow__edge-text` 这两个类名，
    所以 `worksheet.module.css` 里那两条配色 CSS **必须留着**（删了标签会变成黑块）。
  ⚠️ 老作答/老底稿里存着 `type: 'flow'`（我们那套自定义边的记号）—— 库不认识它，会
    `onError('011')` 并退回 `default`（贝塞尔，线会变弯 + 控制台刷警告）⇒
    见 `visibleEdges` 里那条**规范化**。
*/

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
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, type, label, data: edgeData }) => ({
      id, source, target, sourceHandle, targetHandle, type,
      ...(label ? { label } : {}),
      ...(edgeData ? { data: edgeData } : {}),
    })),
  };
}


function FlowchartEditor({ data, backgroundUrl, disabled, onChange, onImage, starter }: DrawingSurfaceProps) {
  /**
   * ★ 2026-10-06（教师）：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」。
   *
   * 🔴 三条决定逐字落地（见 `@/lib/worksheet-drawing-starter.ts` 的注释）：
   *    · A **底稿不算学生的作答** ⇒ 交上去的 `data` = 画板上的全部 − 底稿（`subtractFlowchart`）；
   *    · B **底稿永远可改可删**（教师最终拍板：「还是不要锁定，因为学生端已经有恢复初始图功能了」）
   *      ⇒ 读进来时底稿与学生自己那份走**同一条**处理（`mergeFlowchart` 剥掉老数据里的锁标记、
   *      一个标记都不打）：底稿的框可以拖/可以删/文字可改，底稿的连线可以删/可以改标注；
   *      ⊘ 「锁定初始图」那一档连同它的开关一起删掉了 —— **别**把它加回来；
   *      回退**只靠**「恢复初始图」（那颗按钮无条件出现，见 `restoreStarter`）。
   *    · 试点就是流程图这一档。
   * ⚠️ 合并是**读的时候**做、剔除是**写的时候**做：画板自己始终拿着「底稿 + 学生画的」这一份，
   *    于是拖拽/连线/标注都不必知道底稿的存在。
   */
  const starterPayload = useMemo(
    () => (starter?.tool === 'flowchart' ? readFlowchartPayload(starter.data) : readFlowchartPayload(null)),
    [starter],
  );
  /**
   * 画板上的那份 = **底稿 + 学生自己画的**（合并只在读的时候做一次）。
   * ⚠️ 类型上 `mergeFlowchart` 给的是「带 id 的普通对象」，画板要的是 React Flow 的
   *    `FlowNode`/`Edge` —— 这里窄化一次（结构本来就一致）。
   */
  const initial = useRef<{ nodes: FlowNode[]; edges: Edge[] }>(
    mergeFlowchart(starterPayload, readFlowchartPayload(data)) as unknown as { nodes: FlowNode[]; edges: Edge[] },
  );
  /**
   * 最近一次交出去的流程数据 —— 快照按它画。
   * ⚠️ 不能等抓图时再读 state：抓图是异步的，那时学生可能已经又改了（快照会**超前**作答）。
   */
  const lastFlow = useRef<ReturnType<typeof toFlowPayload> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.current.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.current.edges);
  /*
    ★ 2026-10-06（教师：「流程图要提供撤销/重做功能」）—— **快照栈**。
    规格与取舍见 `specs/2026-10-06-流程图撤销重做.md`；纯逻辑在 `@/lib/worksheet-flowchart-history.ts`。

    ⚠️ 历史住在 **ref** 里而不是 state：它不参与渲染，只有两颗按钮的**可用性**要看它
       ⇒ 那个由 `historyVersion` 这个自增计数器负责（见下面那条 effect 与撤销函数）。
    ⚠️ `lastSnapshotRef` 是「上一次压栈时的图」，`lastSigRef` 是它的指纹。
       `lastSigRef` 初值是 `null`，表示**基线还没建立** —— 首帧只记基线、不压栈。
  */
  const historyRef = useRef<FlowHistory<FlowSnapshot<FlowNode, Edge>>>(emptyHistory());
  const lastSnapshotRef = useRef<FlowSnapshot<FlowNode, Edge>>({ nodes: initial.current.nodes, edges: initial.current.edges });
  const lastSigRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const initialized = useRef(false);
  /**
   * ★ 2026-10-06（教师：「拖到线附近松手要能连上」）：**落点吸附**要用的两个记号（见 `onConnectEnd`）。
   *   · `dragOriginRef` —— 这一拖是从**哪个句柄**出发的。库的 `onConnectEnd` 只给
   *     `(event, connectionState)`，而 `connectionState.source` 在拖到空白时可能是 null
   *     ⇒ 起点必须自己记（`onConnectStart` 给的是 `{ nodeId, handleId, handleType }`）。
   *     ⚠️ 拖动中高亮（`nearestEdgeAt`）也读它 —— 起点节点是「排除与它相连的边」的依据。
   *   · `handledRef` —— 这一拖**已经生效过**了吗。**唯一**那条入口（`onConnectEnd` 的几何吸附）
   *     走 `splitEdgeAt` 时在那里置位 ⇒「同一次拖拽只插一个交点」是结构性的：
   *     即便将来再多一条入口，它进来先看这个记号就不会重复拆同一条线。
   */
  const dragOriginRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);
  const handledRef = useRef(false);
  /**
   * ★ 2026-10-06（可发现性补偿）：「拖动连线时，松手会连到哪条线」要**看得见**。
   *   · `snapCandidateId` —— 当前会吸附到的那条边（`null` = 现在松手什么也不会发生）；
   *     在 `visibleEdges` 里给它挂 `.flowEdgeSnap`（React Flow 支持逐边 `className`）。
   *   · `connecting` —— 这一拖**正在进行**吗。`onConnectStart` 置真，
   *     `onConnectEnd` / 指针抬起 / 指针取消时置假（拖动中的指针跟踪 effect 挂在这个标记上）。
   * ⚠️ 两个都在**高亮**这一路里读写，与吸附判据（`dragOriginRef` / `handledRef`）互不依赖 ——
   *    高亮挂了也不会影响「松手到底连不连」。
   */
  const [snapCandidateId, setSnapCandidateId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  /**
   * ⚠️ `flowToScreenPosition` 也要给 `onConnectEnd` 的几何兜底用（把「边的中点在屏幕上的哪儿」
   *    算出来与 `clientX/clientY` 比距离）⇒ 实例必须在这里就取（不能等到下面 `deleteElements` 那处）。
   *    用库自己的换算而不是自己乘 `viewport`：那是**页面**坐标（含容器 rect 与页面滚动），
   *    而 `viewport.x + flowX * zoom` 只对「浮层住在 `.flowStage` 里」成立。
   */
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow<FlowNode, Edge>();
  const nodeTypes = useMemo(() => ({ flow: FlowNodeEditor }), []);
  /**
   * ★ 2026-10-06（教师上传的标准流程图）：注册那份**只管标签**的自定义边。
   * ⊘ 旧版这里注册的是带**中点句柄**的那套 `FlowEdgeLine` —— 那一套永远不许回来（理由见上面）。
   * ✅ 这一份只做两件事：`BaseEdge` 画线（含箭头）+ 把标签摆到线的旁边；它**没有** `Handle`、
   *    没有 `data-nodeid`、也不参与任何连线判定。
   * ⚠️ 必须是**稳定的**引用（`useMemo([])`）：每次渲染新建一个对象会让所有边重新挂载。
   */
  const edgeTypes = useMemo(() => ({ [FLOW_EDGE_TYPE]: FlowLabelEdge }), []);
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
  }, [nodes, edges, onChange, scheduleRaster, starterPayload]);

  /**
   * ★ 2026-10-06：**变化检测** —— 决定「刚才那一下算不算一步」。
   *
   * 🔴 判据是**指纹**（`flowchartSignature`），不是「nodes 变了没有」：React Flow 的
   *    `onNodesChange` 也会为**选中**和**尺寸测量**触发，不滤掉的话学生点一下框就等于做了一步
   *    （详见那个函数的注释）。
   * 🔴 **拖动中一律不压栈**（`draggingRef`）：拖动期间每个 mousemove 都会让 nodes 变一次，
   *    照压的话拖一下框要用五十次撤销才退得回去。拖动中**连 `lastSigRef` 都不更新** ——
   *    这样松手后这一次 effect 比的就是「拖动前 vs 拖动后」，**恰好压一步**。
   */
  useEffect(() => {
    if (draggingRef.current) return; // 先查它，顺便省掉拖动中每一次指纹计算
    const sig = flowchartSignature(nodes, edges);
    if (lastSigRef.current === null) { lastSigRef.current = sig; return; } // 首帧：只立基线
    if (lastSigRef.current === sig) return;                                 // 没有实质变化
    historyRef.current = pushHistory(historyRef.current, lastSnapshotRef.current);
    lastSnapshotRef.current = { nodes, edges };
    lastSigRef.current = sig;
    setHistoryVersion((v) => v + 1); // 让两颗按钮的 disabled 跟着刷新
  }, [nodes, edges]);

  /**
   * ★ 2026-10-06（教师）：「连接线默认没箭头的吗？」
   * React Flow 的边**默认不画箭头** ⇒ 这里给每条边补一个 —— 不只补新连的线，
   * **存量作答**（已经存进 `drawing.data.edges` 的那些）也要补：它们同样没有 `markerEnd`，
   * 不补的话「老作答一打开还是没有箭头」，而教师根本分不出这两种情况。
   * ⚠️ 只补**缺**的（`?? ARROW`）：学生（或将来）自己配过 markerEnd 的边不被覆盖。
   * ⚠️ 第一条 `map` **逐字保持原样**（用例里钉着那一句：只补缺的、老作答也算）。
   *
   * ★ 2026-10-06：边的类型**全部**规范化成本轮那份「只管标签」的自定义边（`FLOW_EDGE_TYPE`）。
   *   为什么是**全部**、而不是只换旧的 `'flow'`：
   *     · 旧版自定义边的记号 `'flow'` —— 库不认识它，`EdgeWrapper` 会 `onError('011')`
   *       并退回 `default`（**贝塞尔**）；
   *     · 上一版把 `'smoothstep'`（库内置）写进了学生作答 ⇒ 只换 `'flow'` 的话，那些线的标签
   *       仍然是由**库**摆的「居中压线」，与这一轮的新摆法在同一个画板上并存；
   *     · 任何手改出来的怪类型同理。
   *   ⚠️ 这是**兼容旧数据 + 统一摆法**，不是「给边指定任意类型」—— 只有这一个目标类型。
   *
   * ★ 2026-10-06（可发现性补偿）：拖动连线**过程中**把「松手会吸上去的那条边」先高亮出来
   *   （`snapCandidateId` ⇒ 逐边 `className`）。⚠️ 只有真的有候选时才挂类 ——
   *   拖到空白、或离最近那条线还在 `EDGE_SNAP_RADIUS` 之外时，一个类都不挂。
   *   ⚠️ 那个类落在边外面那层 `<g class="react-flow__edge …">` 上（库自己加的），
   *   而高亮的宽度规则打在 `.react-flow__edge-path` 上 ⇒ 自定义边也必须用 `BaseEdge`
   *   画那条路径（`BaseEdge` 给的正是 `react-flow__edge-path`）。
   */
  const visibleEdges = useMemo(
    () => edges.map((edge) => (edge.markerEnd ? edge : { ...edge, markerEnd: FLOW_ARROW }))
      .map((edge) => (edge.type === FLOW_EDGE_TYPE ? edge : { ...edge, type: FLOW_EDGE_TYPE }))
      .map((edge) => (edge.id === snapCandidateId ? { ...edge, className: styles.flowEdgeSnap } : edge)),
    [edges, snapCandidateId],
  );

  /**
   * 「恢复初始图」（教师澄清 2：「学生可以修改底稿，但是可以提供一个『恢复底稿』的按钮」）。
   *
   * 🔴 这是**唯一**的回退路径：流程图这一档的工具条只有「加节点」与「线上标注」，
   *    没有撤销、也没有清空 —— 学生把教师给的图改乱了，只能靠这颗按钮回去。
   * ★ 2026-10-06（教师最终拍板）：「锁定初始图」撤掉之后，这颗按钮**无条件出现**
   *    （只要这一题有初始图）—— 它的出现条件里**不许**再有任何锁标记（见下面那段注释）。
   */
  const restoreStarter = () => {
    const base = restoreFlowchart(starterPayload);
    setNodes(base.nodes as unknown as FlowNode[]);
    setEdges(base.edges as unknown as Edge[]);
  };

  /**
   * 「一键整理」（★ 2026-10-06 教师报「会打乱我原有的结果」之后重写）。
   *
   * 🔴 算法整个挪进了 `@/lib/worksheet-flowchart-layout.ts` —— 那边是**纯函数**，能被**真正地**
   *    单元测试（本仓没有 jsdom，算法长在 `.tsx` 里就只能靠读源码文本猜，抓不住行为回归）。
   *    逐条契约见那个文件的开头。
   * ⚠️ 这里**不再** `fitView`：整理只动画布上的东西，不动**你看画布的那个视角** ——
   *    视图一跳，教师就分不清「是图变了还是镜头变了」，那本身也是「被打乱」的一部分。
   */
  const tidyLayout = () => {
    const arranged = tidyFlowchart(nodes, edges);
    setNodes(arranged.nodes);
    setEdges(arranged.edges);
    setSelected(null);
    setLabelingEdge(null);
  };

  /**
   * ★ 2026-10-06：**撤销**（教师：「流程图要提供撤销/重做功能」）。
   *
   * 🔴 最后那三行**不能省**：`setNodes/setEdges` 会让 Task 2 那条变化检测 effect 再跑一次，
   *    而它比的是 `lastSigRef`。不同步的话它会把「撤销」本身当成一次**新操作** ⇒ 压栈 ⇒
   *    再触发 ⇒ **死循环**，现象是「撤销一下、图又自己弹回去」。
   * ⚠️ 选择态要清：撤销后原来选中的那个框可能已经不存在了，留着会让浮层悬在空处。
   */
  const undo = useCallback(() => {
    const step = undoHistory(historyRef.current, { nodes, edges });
    if (!step) return; // 栈底：什么都不做（按钮此时也是灰的）
    historyRef.current = step.history;
    const snap = step.snapshot;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setSelected(null);
    setLabelingEdge(null);
    lastSnapshotRef.current = snap;
    lastSigRef.current = flowchartSignature(snap.nodes, snap.edges);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, setNodes, setEdges]);

  /** ★ 2026-10-06：**重做** —— 与 `undo` 逐字对称，只有 `redoHistory` 与 `future` 的方向不同。 */
  const redo = useCallback(() => {
    const step = redoHistory(historyRef.current, { nodes, edges });
    if (!step) return;
    historyRef.current = step.history;
    const snap = step.snapshot;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setSelected(null);
    setLabelingEdge(null);
    lastSnapshotRef.current = snap;
    lastSigRef.current = flowchartSignature(snap.nodes, snap.edges);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, setNodes, setEdges]);

  /**
   * ★ 2026-10-06：`Cmd/Ctrl+Z` 撤销、加 `Shift` 重做。
   *
   * 🔴 **焦点在输入框里时一律不管** —— 框内文字（节点里那个 input）与线上标注（就地输入框）里，
   *    `Cmd+Z` 该走**浏览器原生的「撤销打字」**。抢过来会让学生在自己刚打的字里没法撤销，
   *    而那是所有人对 `Cmd+Z` 的第一预期。
   * ⚠️ `disabled`（回顾态）时整条不挂 —— 与两颗按钮的禁用态同一个口径。
   * ⚠️ `preventDefault` 只在**真要撤销画布**时才调：在输入框里我们要让浏览器自己处理。
   */
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, undo, redo]);

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
    const sourcePosition = positionOfHandle(edge.sourceHandle, Position.Bottom);
    const targetPosition = positionOfHandle(edge.targetHandle, Position.Top);
    const from = handleFlowPoint(source, edge.sourceHandle, Position.Bottom);
    // ⚠️ 这个 `to` 就是**终点锚点**：箭头落在目标节点的这一侧句柄上。
    const to = handleFlowPoint(target, edge.targetHandle, Position.Top);
    /* ★ 删除按钮「往 source 退」的方向 = **目标句柄轴的外法线**（末段方向），不是「起点→终点」直线。
       ⚠️ 由 `targetPosition` 决定 —— 线从哪一侧进目标，就往那一侧退（见 `backAxis`）。 */
    const back = backAxis(targetPosition);
    const route = edge.data as FlowEdgeData | undefined;
    const [, labelX, labelY] = getSmoothStepPath({
      sourceX: from.x, sourceY: from.y, sourcePosition,
      targetX: to.x, targetY: to.y, targetPosition,
      ...(Number.isFinite(route?.routeX) && Number.isFinite(route?.routeY)
        ? { centerX: route!.routeX, centerY: route!.routeY }
        : {}),
    });
    return {
      midX: labelX, midY: labelY, endX: to.x, endY: to.y, fromX: from.x, fromY: from.y,
      backX: back.x, backY: back.y,
    };
  }, [edges, nodes]);

  /**
   * **中点**锚点 → 容器内坐标。就地文字输入框用它（标签就画在中点，就地编辑才顺手），
   * 连到线上时插的那个交点节点也用它算**流坐标**。
   *
   * ★ 2026-10-06：这里回到**裸的标签点**（不再往目标端挪）。上一版挪那 18px 是为了让开
   *   线上那颗**中点句柄**（既别压住 Y/N 标签，也别吞掉正落在中点的单击/双击）；
   *   句柄随自定义边一起删了 ⇒ 两个理由都不存在，就地输入框就该正落在它要改的那个字上。
   */
  const edgeMidAnchor = (edgeId: string | null) => {
    const anchors = edgeFlowAnchors(edgeId);
    if (!anchors) return null;
    const { midX, midY } = anchors;
    return { x: viewport.x + midX * viewport.zoom, y: viewport.y + midY * viewport.zoom };
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
    // 删除按钮在箭头端附近，但向末段侧边让出一格，避免压住线中间的路径调整圆点。
    const shiftedEnd = {
      x: endX + backX * step + (backY !== 0 ? 34 : 0),
      y: endY + backY * step + (backX !== 0 ? 34 : 0),
    };
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

  const moveSelectedEdgeRoute = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!selectedEdgeId || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const edgeId = selectedEdgeId;
    const move = (pointer: PointerEvent) => {
      const point = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      setEdges((current) => current.map((edge) => edge.id === edgeId
        ? { ...edge, data: { ...(edge.data as FlowEdgeData | undefined), routeX: point.x, routeY: point.y } }
        : edge));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  /**
   * 🔴 **拆线的唯一实现**（「插交点 + 拆原线 + 接上学生这一拖」）——**唯一**那条入口用它：
   *    `onConnectEnd`（几何吸附：松手点离某条线的中点 ≤ `EDGE_SNAP_RADIUS`，见 `EDGE_SNAP_RADIUS`）。
   *    ⊘ 原来还有第二条入口（`onConnect`：库自己判定「落点就是那颗中点句柄」）—— 句柄随自定义边
   *      一起删掉了，那条入口也一并删掉（`onConnect` 现在只处理「落点是节点」）。
   * ⚠️ 只留一份仍是硬要求：两份实现必然分叉。判据 `surface-lifecycle.test.ts` 会把这条钉住
   *    （源码里只有**一处** `const splitEdgeAt = useCallback(`，而且吸附那一路必须走它）。
   * ⚠️ 参数只吃**两端**：
   *    · `endpointId` —— 学生那一拖的**另一端**（节点的 id）：从节点 source 柄拉 ⇒ 它接在交点上；
   *      从节点 target 柄拉（菱形左侧那种）⇒ 交点接在它后面；
   *    · `endpointHandle` / `endpointFromDrag` —— 那一端的句柄 id、以及**是不是从边那侧拉出来的**
   *      （后者决定 `link` 的方向）。⚠️ 当前**唯一**的调用方（几何吸附）永远是「从节点句柄拉」
   *      ⇒ 传进来的是 `false`；两个方向都留着是因为这是**拆线本身**的通用形（哪一端是学生拉的
   *      决定了线的箭头朝哪边），不是为了照顾某一条入口。
   */
  const splitEdgeAt = useCallback((
    hitEdgeId: string,
    endpointId: string,
    endpointHandle: string | null | undefined,
    endpointDraggedFromEdge: boolean,
  ) => {
    const anchors = edgeFlowAnchors(hitEdgeId);
    if (!anchors) return;
    const junctionId = `junction-${Date.now()}-${nodes.length}`;
    /* ⚠️ 4 = CSS 里 `.flowNode_junction` 的 8×8 的一半（`box-sizing: border-box` ⇒ 宽高含描边）。
       节点 `position` 说的是**左上角**，各减一半才能让那颗圆点正落在精确中点上
       （不这么减，线会与圆点岔开 4px）。⚠️ 改了 CSS 那个尺寸，这里必须跟着改 ——
       `surface-lifecycle.test.ts` 会把两处对起来。
       ★ 2026-10-06（教师截图）：「大大的圆点其实是不需要的」⇒ 12×12 实心点缩成 8×8 空心环。 */
    const junctionHalf = 4;
    /* 🔴 `handledRef` 在**这里**置位（唯一入口也走这一句）：「同一次拖拽只能生效一次」是
       **结构性**的 —— 谁进来都先看它，绝不重复拆同一条线。 */
    handledRef.current = true;
    setNodes((current) => [...current, {
      id: junctionId,
      type: 'flow',
      // 🔴 **流坐标**（`position` 用的那套），刻意不碰 `viewport` —— 那是给浮层用的屏幕坐标。
      position: { x: anchors.midX - junctionHalf, y: anchors.midY - junctionHalf },
      data: { label: '', kind: 'junction' },
    }]);
    setEdges((current) => {
      const original = current.find((edge) => edge.id === hitEdgeId);
      if (!original) return current;
      // ⚠️ 交点那两个句柄的方位取自**原边**（它原来从 source 的哪一侧出去、进 target 的哪一侧）
      //    ⇒ 两段接回去以后与原来那条线重合。见 `junctionInHandle` 上面那段实测。
      const inHandle = junctionInHandle(positionOfHandle(original.sourceHandle, Position.Bottom));
      const outHandle = junctionOutHandle(positionOfHandle(original.targetHandle, Position.Top));
      // ①原边的 source → **交点**：label / sourceHandle / markerEnd……全部保留，
      //   只把 `targetHandle` 换成交点上的那一颗（原来那个是**上一个**目标节点的句柄，
      //   直接留着才是真错 —— 那句「断开 targetHandle」的意思正是别把它带过来）。
      const head: Edge = { ...original, target: junctionId, targetHandle: inHandle, type: FLOW_EDGE_TYPE };
      // ②**交点** → 原来那个目标节点（用 addEdge 走一次库自己的加边，id 由它给）。
      const tail: Edge = {
        id: `${junctionId}-tail`,
        source: junctionId,
        sourceHandle: outHandle,
        target: original.target,
        targetHandle: original.targetHandle ?? null,
        type: FLOW_EDGE_TYPE,
      };
      // ★ 学生**刚拉的那根线本身**也必须接上。
      //   🔴 只拆原线 = 画布上什么新东西都不会出现（教师 2026-10-06 报的「连线加不上」正是它）：
      //      拖拽时看到的预览线在松手那一刻消失，随后原线被拆成两段但**看上去还是原来那根线**
      //      ⇒ 学生的感受是「白拖了一次」，而数据里也确实没有他画的那根线。
      //   ⚠️ 方向按他从哪一侧拉：从节点的 source 柄拉 ⇒ X → 交点；从节点的 target 柄拉 ⇒ 交点 → X。
      const link: Edge = endpointDraggedFromEdge
        ? {
          id: `${junctionId}-link`,
          source: junctionId,
          sourceHandle: outHandle,
          target: endpointId,
          targetHandle: endpointHandle ?? null,
          type: FLOW_EDGE_TYPE,
        }
        : {
          id: `${junctionId}-link`,
          source: endpointId,
          sourceHandle: endpointHandle ?? null,
          target: junctionId,
          targetHandle: inHandle,
          type: FLOW_EDGE_TYPE,
        };
      // ⚠️ 与拆出来的那一段**逐字段重合**时不再画第二根（同一根线画两遍 = 数据里两条重叠的线）。
      const twin = endpointDraggedFromEdge ? tail : head;
      const duplicated = link.source === twin.source && link.target === twin.target
        && (link.sourceHandle ?? null) === (twin.sourceHandle ?? null)
        && (link.targetHandle ?? null) === (twin.targetHandle ?? null);
      // ⚠️ 顺序：先摘掉原边 → 把 `tail` 交给 addEdge → 把 `head`（**沿用原边 id**）放回去 → 接上学生这一拖。
      //    沿用 id 是有意的：`selected` / `labelingEdge` 那些状态还指着它，拆线不该凭空多出悬空 id。
      return [...addEdge(tail, current.filter((edge) => edge.id !== original.id)), head, ...(duplicated ? [] : [link])];
    });
  }, [nodes.length, edgeFlowAnchors, setEdges, setNodes]);

  /**
   * ★ 2026-10-06（教师）：「判断框出来的两条线默认应该是一条上面是 Y，一条上面是 N」
   *   ⊘ 2026-10-06（教师拍板 + 参考图）：**默认标注改成「是 / 否」**（见 `DECISION_BRANCH_LABELS`）。
   * ⇒ 从**判断框**拉出来的线自动带上默认标注（按这个判断框已有几条带标注的出边排：
   *   0 ⇒ 第一条、1 ⇒ 第二条、**再多就不猜**）。⚠️ 计数逻辑一个字没动，只换了那两个字。
   * ⚠️ 其它节点拉出来的线**不自动给字**：给每条线都塞一个字是噪音，而且会让「线上一片字」。
   * ⚠️ **不迁移已存数据**：老作答里那条 `label: 'Y'` 照原样渲染。
   *
   * ★ 2026-10-06（教师）：连到**线上**不再走库自己的连接判定（那颗中点句柄已随自定义边删掉）
   * ⇒ 这个回调现在**只**处理「落点是节点」；「落点是线」由 `onConnectEnd` 的几何吸附负责
   *   （`connection.target` 再也不可能是一条边的 id 了）。
   */
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => {
      const source = nodes.find((node) => node.id === connection.source);
      let label: string | undefined;
      if (source?.data.kind === 'decision') {
        const used = current.filter((edge) => edge.source === connection.source && edge.label).length;
        label = decisionBranchLabel(used);
      }
      return addEdge({ ...connection, type: FLOW_EDGE_TYPE, ...(label ? { label } : {}) }, current);
    });
  }, [nodes, setEdges]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    setEdges((current) => reconnectEdge(oldEdge, connection, current).map((edge) => edge.id === oldEdge.id
      ? { ...edge, data: undefined }
      : edge));
  }, [setEdges]);

  /**
   * 离指针最近、且在 `EDGE_SNAP_RADIUS` 之内的那条边（比的是**各边中点**在屏幕上的位置）。
   *
   * 🔴 **唯一一份**距离算法：松手时的吸附（`onConnectEnd`）与拖动过程中的高亮
   *    （下面那个 effect）都用它 —— 两份各写一遍必然分叉，而分叉的表现是
   *    「高亮的是 A、真吸上去的是 B」，屏幕上不报错。
   * ⚠️ 排除与起点节点相连的边：把边连回它自己那一端会插出一个自环。
   * ⚠️ 距离单位是**屏幕 px**：`flowToScreenPosition` 给的是**页面**坐标（含容器 rect 与页面滚动），
   *    正好与 `clientX/clientY` 同一套；自己乘 `viewport` 只对「浮层住在 `.flowStage` 里」成立。
   */
  const nearestEdgeAt = useCallback((clientX: number, clientY: number, originNodeId: string) => {
    let nearest: { id: string; distance: number } | null = null;
    for (const edge of edges) {
      const anchors = edgeFlowAnchors(edge.id);
      if (!anchors) continue;
      if (edge.source === originNodeId || edge.target === originNodeId) continue;
      const mid = flowToScreenPosition({ x: anchors.midX, y: anchors.midY });
      const distance = Math.hypot(clientX - mid.x, clientY - mid.y);
      if (distance > EDGE_SNAP_RADIUS) continue;
      if (!nearest || distance < nearest.distance) nearest = { id: edge.id, distance };
    }
    return nearest;
  }, [edges, edgeFlowAnchors, flowToScreenPosition]);

  /**
   * ★ 2026-10-06（教师截图）：落点附近**有没有节点句柄** —— 有就让位给库（连框），兜底整段不做。
   *
   * 🔴 **唯一一份**「句柄距离」算法：`onConnectEnd` 的兜底靠它决定让不让位。
   * ⚠️ 逐个算**四个句柄**的屏幕坐标（不是节点中心）：句柄在节点四条边的中点上，只算中心会让
   *    「离框很近、但离句柄还远」也误判成命中（那会把本来该吸线的落点白白让给库、什么都不发生）。
   * ⚠️ 排除**这一拖的起点句柄本身**（`node.id + handleId` 同时相等）—— 与库 `getClosestHandle`
   *    里那句跳过 `fromHandle` 的写法一致；不排除的话「从某句柄拖出去一点点」会被自己挡住。
   * ⚠️ 与库那边**同一个屏幕半径**（见 `<ReactFlow connectionRadius={NODE_HANDLE_PRIORITY_RADIUS
   *    / viewport.zoom}>`）：库按这个半径认「落点落在句柄上」，兜底按这个半径让位 —— 两个半径
   *    必须落在同一套单位上（库那份是**流坐标**，所以要除以 zoom），否则中间会留下环。
   *    见那个常量的注释。
   */
  const nearestHandleAt = useCallback((
    clientX: number,
    clientY: number,
    origin: { nodeId: string; handleId: string | null },
  ) => {
    let nearest: { distance: number } | null = null;
    for (const node of nodes) {
      for (const handleId of FLOW_HANDLE_IDS) {
        if (node.id === origin.nodeId && handleId === origin.handleId) continue;
        const handle = flowToScreenPosition(handleFlowPoint(node, handleId, Position.Top));
        const distance = Math.hypot(clientX - handle.x, clientY - handle.y);
        if (distance > NODE_HANDLE_PRIORITY_RADIUS) continue;
        if (!nearest || distance < nearest.distance) nearest = { distance };
      }
    }
    return nearest;
  }, [nodes, flowToScreenPosition]);

  /**
   * ★ 2026-10-06（可发现性补偿）：拖动**过程中**跟踪指针，把「松手会吸上去的那条边」标出来。
   *
   * 🔴 `pointermove` 与 `touchmove` **两个都听**：学生端是 iPad（Safari 15），桌面是鼠标 ——
   *    只挂一种，另一类设备上就「高亮永远不出来」，而屏幕上不报错。
   * 🔴 收尾也有两条路：`onConnectEnd`（正常松手，见那里）与这里的 `pointerup / pointercancel /
   *    touchend / touchcancel`（拖拽被取消、或库没有回调的那种收尾）—— 只留一条，
   *    取消一次就会留下一根**永久高亮**的线。
   * ⚠️ 坐标走**同一个** `pointerClientPoint`（`TouchEvent` 上没有 `clientX/clientY`）；
   *    距离走**同一个** `nearestEdgeAt`。清理函数里把六个监听逐个摘掉。
   */
  useEffect(() => {
    if (!connecting) return;
    const track = (event: PointerEvent | TouchEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const point = pointerClientPoint(event);
      if (!point) return;
      setSnapCandidateId(nearestEdgeAt(point.x, point.y, origin.nodeId)?.id ?? null);
    };
    const stop = () => { setConnecting(false); setSnapCandidateId(null); };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('touchmove', track, { passive: true });
    window.addEventListener('pointerup', stop, { passive: true });
    window.addEventListener('pointercancel', stop, { passive: true });
    window.addEventListener('touchend', stop, { passive: true });
    window.addEventListener('touchcancel', stop, { passive: true });
    return () => {
      window.removeEventListener('pointermove', track);
      window.removeEventListener('touchmove', track);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
  }, [connecting, nearestEdgeAt]);

  /**
   * ★ 2026-10-06（教师：「小学课堂上拖到线附近松手要能连上」）——**落点吸附**。
   *
   * 🔴 这是「连到线上」**唯一**的入口（那颗中点句柄已随自定义边删掉）：松手点离某条线的
   *    **中点** ≤ `EDGE_SNAP_RADIUS` 屏幕 px ⇒ 走**唯一一份** `splitEdgeAt`。
   * ✅ 判据全在**代码里**，不依赖任何 DOM 细节：
   *    · `onConnectStart` 记下「这一拖是从哪个句柄出发的」（`dragOriginRef`）；
   *    · `handledRef` 已置位 ⇒ 这一拖**已经生效过** ⇒ 整段不进（不许重复插交点）；
   *    · 松手点压着**任何**句柄 ⇒ 也不进（库已经处理过了，或者库已经明确拒绝）；
   *    · ★ **落点附近（≤ `NODE_HANDLE_PRIORITY_RADIUS`）有节点句柄 ⇒ 也不进** ——
   *      让库自己去连那个框。这是教师截图那一格（拖到框右侧附近却被吸到框下那条竖线上）的解药：
   *      见 `NODE_HANDLE_PRIORITY_RADIUS` 的注释；
   *    · 指针离最近那条线的**中点** ≤ `EDGE_SNAP_RADIUS` ⇒ 走 `splitEdgeAt`。
   *    ⚠️ 这里**不做**「落点是不是边」的判断 —— 那条判据（`connection.target === 边 id`）
   *      随句柄一起删掉了：库再也不可能回一个「边 id」当落点。
   * ⚠️ 拖到空白：附近一条边都没有 ⇒ 什么都不做（不是「插一个悬空交点」）。
   * ⚠️ 落点比**起点句柄**还近 ⇒ 那是「拖出去一点点又放回来」⇒ 什么都不做（否则会插出自环/重叠线）。
   * ⚠️ 进这个函数先把拖动中的高亮收掉：**不论这次连没连上**（拿不到落点 / 落在句柄上 /
   *    半径外 / 拖到空白）都不能留下一根高亮的线。
   */
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    setConnecting(false);
    setSnapCandidateId(null);
    if (handledRef.current) return;
    const origin = dragOriginRef.current;
    if (!origin) return;
    const point = pointerClientPoint(event);
    // 既不是鼠标/指针、也没有任何 touch ⇒ 拿不到落点，整段走人（绝不在 undefined 上算距离）。
    if (!point) return;
    const clientX = point.x;
    const clientY = point.y;
    // ⚠️ 落点下有句柄 ⇒ 库的判断已经生效（有效连接会走 onConnect、无效连接就是库明确拒绝）
    //    ⇒ 让位。这条同时挡住「从 source 柄拖出去几像素又放回来」那种误插。
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit instanceof Element && hit.closest('.react-flow__handle')) return;
    // ★ 2026-10-06（教师截图）：**框的句柄优先** —— 落点**附近**（不是正压着）有节点句柄时
    //    整段兜底不做，让库自己去连那个框。半径与库的 `connectionRadius` 是同一个数，
    //    所以「库会连上」与「兜底让位」两件事严格同时发生（不会留下谁都不管的环）。
    if (nearestHandleAt(clientX, clientY, origin)) return;
    const originNode = nodes.find((node) => node.id === origin.nodeId);
    if (!originNode) return;
    // 起点句柄的**屏幕**坐标：落点比它还近 ⇒ 这次拖拽等于没动，别当成「连到线上」。
    // ⚠️ 用库自己的 `flowToScreenPosition`（含容器 rect 与页面滚动），不自己乘 `viewport`：
    //    那条换算只对「浮层住在 `.flowStage` 里」成立，而这里是**页面**坐标（`clientX/clientY`）。
    const originScreen = flowToScreenPosition(handleFlowPoint(originNode, origin.handleId, Position.Bottom));
    if (Math.hypot(clientX - originScreen.x, clientY - originScreen.y) <= EDGE_SNAP_RADIUS) return;
    const nearest = nearestEdgeAt(clientX, clientY, origin.nodeId);
    if (!nearest) return;

    /* ⚠️ 方向：句柄**类型**说了算 —— 从 source 柄拉 ⇒ 学生那一端是**源**（X → 交点）；
       从 target 柄拉 ⇒ 反过来（交点 → X）。 */
    splitEdgeAt(nearest.id, origin.nodeId, origin.handleId, origin.handleType === 'target');
  }, [nodes, nearestEdgeAt, nearestHandleAt, splitEdgeAt, flowToScreenPosition]);

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
   * ★ 2026-10-06（教师最终拍板）：「锁定初始图」撤掉 ⇒ 选中的线**一律可以改文字**
   *   （初始图的线也一样 —— 教师：「学生端很多操作都无法进行了，我觉得还是不要锁定」）。
   * ⊘ 这里原来还有一道 `&& !isStarterEdge(selectedEdgeId)` 的闸（判据按 id 认「老师的线」）——
   *   随那一档一起删掉，**别**加回来。
   */
  const labelableEdgeId = selectedEdgeId;
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
   * ⚠️ 取舍：它是 `async`（这里不关心返回的 `deletedNodes/deletedEdges`，`void` 掉）。
   * ⊘ ★ 2026-10-06：「锁定初始图」撤掉之后，底稿的框/线**不再带 `deletable: false`**
   *    （`mergeFlowchart` 现在只剥标记、一个都不打）⇒ 键盘 Delete 与选中删除对学生画的、
   *    教师给的**一视同仁**。
   */
  const { deleteElements } = useReactFlow<FlowNode, Edge>();

  /**
   * ★ 2026-10-06（教师认可的第 1 步整理）：删掉**当前选中的那一件** —— 画布上唯一的删除出口。
   *   · 选中的是**线** ⇒ 从 `edges` 里摘掉这一条；
   *   · 选中的是**框** ⇒ 交给库的 `deleteElements`（「与它相连的线」是库自己算的，理由见上）。
   * ⚠️ 交点**不做特例**：它也是一颗框，走的正是下面同一句 `deleteElements`。
   * ⊘ ★ 2026-10-06：「锁定初始图」撤掉 ⇒ 这里原来那道「老师给的框/线不放行」的闸
   *   （判据按 id）整个删掉 —— 教师给的框/线**同样可以删**（教师原话：「初始图永远可改可删，
   *   回退只靠『恢复初始图』」）。**别**把它加回来。
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
  const routeAnchor = selectedEdgeId && !labelingEdge ? edgeMidAnchor(selectedEdgeId) : null;

  /**
   * ★ 第 1 步整理：**一处渲染** —— 舞台里只有这一个浮层，两种形态：
   *   · `label`  —— 双击连线后的**就地输入框**（中点锚点，这条交互不许丢）；
   *   · `delete` —— 选中框 / 线后的**图标删除按钮**（框 ⇒ 连带删相连的线；线 ⇒ 删这条线）。
   * 🔴 `label` 优先：双击连线必然先触发一次单击 ⇒ 两个形态**结构性互斥**（不再靠两处状态互相当心清），
   *    否则那颗 44px 的按钮会压在这个输入框上。
   * ⊘ ★ 2026-10-06：「锁定初始图」撤掉 ⇒ 这里原来那句「选中的是**老师给的**框/线就不浮删除按钮」
   *   整个删掉 —— 教师给的框/线同样能删（`removeSelected` 也不再拦）。
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

  /**
   * 改一条线的标注 —— **唯一**的写入出口（工具条那组 Y/N/自由文字、就地输入框都走它）。
   * ⊘ ★ 2026-10-06：「锁定初始图」撤掉 ⇒ 这里原来那句「老师给的线不许改文字」的闸（判据按 id）
   *   整个删掉 —— 初始图里的线**同样可以改标注**。**别**把它加回来（加了就是「半套行为」）。
   */
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
    const label = edges.find((edge) => edge.id === labelableEdgeId)?.label;
    return typeof label === 'string' ? label : '';
  })();
  const visibleNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    // ★ 「只读展示」那一档（`disabled`，教师预览 / 回顾作答时用）—— 与底稿无关，与过去那个
    //   「锁定初始图」也无关：底稿的框**不再**因为「它是老师的」而被置只读。
    // ⚠️ `node.data.locked === true` 只剩**历史数据**这一个来源（合并/恢复时已由
    //   `withoutLegacyLocks` 剥掉），这里留着只是为了老草稿万一漏网也不至于打不开。
    data: { ...node.data, locked: disabled || node.data.locked === true },
  })), [disabled, nodes]);

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="流程图工具">
        {/*
          ★ 2026-10-06（教师拍板，截图圈了这四颗按钮 + 「这些文字都没有改」）：按钮上的文字用
            **信息科技课教材的名称**：起止框 / 处理框 / 判断框 / 输入输出框。
          🔴 **千万不要**把「按钮文字」与「新节点里默认写什么」统一起来 —— 这是**两件事**：
            · 按钮文字 = **形状的名字**（教材术语，学生按课本找得到）；
            · `addNode(kind, …)` 的**第二个参数** = 放到画布上以后**框里默认写的内容**
              （「开始/结束」「处理过程」「判断条件」「输入/输出」—— 那是**内容**，不是形状名）。
            ⇒ 把默认标签也改成「起止框」等于在流程图的框里写形状名，学生会把框里的字当成流程内容。
            ⚠️ 本轮**只改按钮的可见文字**：`addNode(...)` 的默认标签一个字都没动
              （`surface-lifecycle.test.ts` 两边都会钉住）。
        */}
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('terminator', '开始/结束')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.terminator} /></svg>起止框</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('process', '处理过程')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.process} /></svg>处理框</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('decision', '判断条件')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.decision} /></svg>判断框</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('io', '输入/输出')}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.io} /></svg>输入输出框</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled || nodes.length === 0} onClick={tidyLayout}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.tidy} /></svg>一键整理</button>
        {/* ★ 2026-10-06（教师最终拍板）：「恢复初始图」**无条件出现**（只要这一题有初始图）——
            它是**唯一**的回退路径（「锁定初始图」那一档撤掉之后，学生把底稿改乱了只能靠它回去）。
            🔴 出现条件里**不许**再出现任何锁标记（`starter && !starterLocked` 那种写法已经删掉）。 */}
        {starter && (
          <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={restoreStarter}><svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={FLOW_ICONS.restore} /></svg>恢复初始图</button>
        )}
        {/*
          ★ 2026-10-06（教师：「流程图要提供撤销/重做功能」）：两颗按钮**不带图标、只有文字** ——
          与思维导图那两颗（`mindmap-drawing.tsx:351-352`）逐字同形，四个画板里两个已经这样了。
          ⚠️ 禁用态读的是 `historyRef.current`（ref 不触发渲染）⇒ 靠 `historyVersion` 那个
          自增计数器把这次渲染带出来。`disabled`（回顾态）时无条件禁用。
        */}
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled || !canUndo(historyRef.current)} onClick={undo}>撤销</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled || !canRedo(historyRef.current)} onClick={redo}>重做</button>
        <span className={styles.drawingToolbarHint}>
          {selectedEdgeId
            ? '拖动线中圆点调整走向；拖动两端可重新连接'
            : '拖动图形；从任意连接点连线；双击文字修改'}
        </span>
        {labelableEdgeId && (
          <>
            {['Y', 'N', '是', '否'].map((value) => (
              <button className={styles.drawingToolbarButton} key={value} type="button" disabled={disabled} onClick={() => setEdgeLabel(labelableEdgeId, value)}>{value}</button>
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
              onChange={(event) => setEdgeLabel(labelableEdgeId, event.target.value)}
            />
            <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => { setEdgeLabel(labelableEdgeId, ''); setSelected(null); }}>清空</button>
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
          onReconnect={disabled ? undefined : onReconnect}
          edgesReconnectable={!disabled}
          reconnectRadius={28}
          /*
            ★ 2026-10-06（教师：「拖到线附近松手要能连上」）——**落点吸附**的三个钩子。
            🔴 它是「连到线上」唯一的路：那颗中点句柄已随自定义边删掉，库的 `connectionRadius`
               自然也不再和这件事有关（见 `EDGE_SNAP_RADIUS` 的注释）。
            ① `onConnectStart`：记下这一拖的**起点句柄**（给吸附算方向、算距离、排除自环用）；
               顺手把 `handledRef` 清掉（上一次拖拽的记号不能漏到这一次），并进入**拖动中**状态
               （高亮那条路靠它开关）。
            ② `onConnectEnd`：松手 —— 离某条线的中点 ≤ `EDGE_SNAP_RADIUS` ⇒ 走 `splitEdgeAt`
               （判据与「什么都不做」的几种情形都写在那段注释里），并**收掉高亮**。
            ③ 拖动过程中的高亮指针跟踪在 `connecting` 那个 effect 里（`pointermove` + `touchmove`）。
          */
          onConnectStart={disabled ? undefined : (_, params) => {
            // 上一次拖拽的记号不许漏到这一次；起点句柄则要记下来（吸附靠它算方向与距离）。
            handledRef.current = false;
            dragOriginRef.current = { nodeId: params.nodeId ?? '', handleId: params.handleId ?? null, handleType: params.handleType ?? 'source' };
            // ★ 拖动中高亮：开（清掉上一次留下的候选，免得第一帧就高亮错的线）。
            setConnecting(true);
            setSnapCandidateId(null);
          }}
          onConnectEnd={disabled ? undefined : onConnectEnd}
          // ★ 2026-10-06：一次拖动 = 一步撤销（详见上面那条变化检测 effect）。
          onNodeDragStart={disabled ? undefined : () => { draggingRef.current = true; }}
          onNodeDragStop={disabled ? undefined : () => { draggingRef.current = false; }}
          // ★ 2026-10-06（教师）：点图形就选中它；点线就选中那条线。
          //   ⚠️ 「选中」只有一个槽位 ⇒「点框清线、点线清框」是**结构性成立**的（不必两边互相清）。
          onNodeClick={(_, node) => { setSelected({ kind: 'node', id: node.id }); setLabelingEdge(null); }}
          onEdgeClick={(event, edge) => { event.stopPropagation(); setSelected({ kind: 'edge', id: edge.id }); setLabelingEdge(null); }}
          /*
            ★ 2026-10-06（教师）：「双击线条可以输入/修改连接线上的文字」。
            双击进入**就地输入框**（就在那条线中点），回车提交、Esc 取消。
            ⚠️ 单击仍是「选中这条线」（浮出删除按钮）—— 两件事分开，不互相抢。
            ⊘ ★ 「锁定初始图」撤掉 ⇒ 这里原来那道「老师给的线不进就地输入框」的闸
              （`if (!isStarterEdge(edge.id))`）整个删掉 —— 初始图的线**同样可以双击改文字**。
          */
          onEdgeDoubleClick={(event, edge) => {
            event.stopPropagation();
            setSelected({ kind: 'edge', id: edge.id });
            setLabelingEdge(edge.id);
          }}
          // 浮层要跟着视口走（平移/缩放都会回调）
          onMove={(_, next) => setViewport(next)}
          // 点空白 ⇒ 选中清掉（「选中」是单选，点空就是没有选中），就地输入框也一起退掉。
          onPaneClick={() => { setSelected(null); setLabelingEdge(null); }}
          nodesDraggable={!disabled}
          nodesConnectable={!disabled}
          nodeDragThreshold={3}
          connectionDragThreshold={3}
          connectionMode={ConnectionMode.Loose}
          /*
            ★ 2026-10-06（教师截图）：库判定「落点算不算落在句柄上」的半径 —— 必须与兜底那边
            让位的**屏幕半径**对齐（`NODE_HANDLE_PRIORITY_RADIUS`），否则中间会留下环：
              · 传得比让位半径**大**（直接把 40 当流单位传）⇒ 「库连了框、兜底也去吸了线」两件事
                同时发生（实测 zoom=1.42 时库那边的屏幕半径是 57px）；
              · 传得比让位半径**小** ⇒ 一圈「库说太远、兜底又让位」的死环（松手什么都不发生）。
            🔴 库的那个数比的是**流坐标**（`getClosestHandle` + `pointToRendererPoint` 两端都是流
            坐标）⇒ 这里必须除以 zoom，换算成「同一个屏幕半径」。zoom 由 `onMove` 跟着视口走。
            库的默认值是 20（流单位）。
          */
          connectionRadius={NODE_HANDLE_PRIORITY_RADIUS / viewport.zoom}
          elementsSelectable={!disabled}
          fitView
          minZoom={0.35}
          maxZoom={2.2}
          deleteKeyCode={disabled ? null : ['Backspace', 'Delete']}
        >
          {!backgroundUrl && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd7e5" />}
          <Controls showInteractive={false} />
        </ReactFlow>
        {routeAnchor && (
          <button
            className={styles.flowEdgeRouteHandle}
            type="button"
            aria-label="拖动调整连线路径"
            title="拖动调整连线路径"
            style={{ left: routeAnchor.x, top: routeAnchor.y }}
            onPointerDown={moveSelectedEdgeRoute}
          >
            <span aria-hidden="true" />
          </button>
        )}
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
              /* ⚠️ 与节点文字同一个坑：组合中按回车是「上屏候选词」，不是「确认」——
                 不排除组合态的话，还没上屏的拼音会被这一下丢掉。`keyCode === 229` 是老浏览器兜底。 */
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
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
