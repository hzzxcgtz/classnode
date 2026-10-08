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
  loadHistory,
  pushHistory,
  redoHistory,
  saveHistory,
  undoHistory,
  type FlowHistory,
  type FlowSnapshot,
} from '@/lib/worksheet-flowchart-history.ts';
import {
  clampLabelOffset,
  clampToTrack,
  flowAnchorPoint,
  flowEdgeGeometry,
  flowLabelOffset,
  flowLabelWidth,
  flowRouteTrack,
  type FlowLabelOffset,
  type FlowRouteTrack,
  type SmoothStepFn,
} from '@/lib/worksheet-flowchart-edge.ts';
import { tidyFlowchart } from '@/lib/worksheet-flowchart-layout.ts';
import { flowNodeCornerPoint } from '@/lib/worksheet-flowchart-node.ts';
import { flowchartSvg } from '@/lib/worksheet-flowchart-svg.ts';
import { svgToPngBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
import { normalizePastedText } from '@/lib/worksheet-text-normalize.ts';
import {
  mergeFlowchart,
  restoreFlowchart,
  readFlowchartPayload,
  subtractFlowchart,
} from '@/lib/worksheet-drawing-starter.ts';
import { flowPayloadSignature, shouldPublishFlow } from '@/lib/worksheet-flowchart-publish.ts';

import type { DrawingSurfaceProps } from './types';
import DrawingToolbarIcon from './drawing-toolbar-icon';
import FlowToolbarIcon from './flow-toolbar-icon';
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
/**
 * 边上的**绕行点**（★ 2026-10-07 恢复了）。
 *
 * ⊘ 2026-10-06 曾随「全回原版」删过一次（当时边交回库内置的 `smoothstep`，而它不认
 *   `centerX/centerY`）。教师随后要的「折线上的控制柄」正是靠它 —— 这次由**我们自己的边**
 *   （`FlowEdge`）把它喂给库的路径函数，其余一切照旧交库。
 * ⚠️ 老作答里可能存着这两个字段：读得到就用（学生之前调过的走向不该被抹掉）。
 */
type FlowEdgeData = {
  routeX?: number;
  routeY?: number;
  /*
   * ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」+「贴着线拖」。
   * ⚠️ 这两个字段**没写过就是「没拖过」** ⇒ 走默认那一侧（见 `flowLabelOffset`）。
   *    老作答里没有它们 ⇒ 标签自动落到「线旁边」那一套新摆法上 ——
   *    一个画板上**不许两套摆法并存**（同 `FLOW_EDGE_TYPE` 当年那条理由）。
   */
  labelDX?: number;
  labelDY?: number;
};

type FlowNode = Node<FlowData>;

/**
 * ★ 2026-10-06（**教师：「全回原版」**）：边的类型就是**库内置的** `smoothstep`。
 *
 * 🔴 本仓曾经注册过一份自定义边（`FlowLabelEdge`）：它做两件事 —— 把标签从库自带的
 *    「路径中点 + 白底框」挪到线旁边，以及把 `data.routeX/routeY` 喂给
 *    `getSmoothStepPath` 的 `centerX/centerY` 当**绕行点**（就是那颗能拖的圆点）。
 *    教师看过原版的行为之后拍板：**先回到库的基线**，那份自定义边
 *    连同它带的一整套「拖动线中圆点调走向」都撤了。
 *
 * ⚠️ 代价（教师已知情）：**线不能调走向了** —— 库内置的 `smoothstep` 只认 `pathOptions` 的
 *    `borderRadius` / `offset` / `stepPosition`，**根本不传** `centerX`/`centerY`
 *    （实测 `@xyflow/react@12.11.6` 的 `createSmoothStepEdge`）；标签也回到库自带的样子。
 *
 * ⚠️ **名字保留、值改成库内置的那个**：`visibleEdges` 靠它把**所有**边归一化到同一个类型
 *    （老作答里存着 `'flow'`、`'flowLabel'` 这些我们自造的名字）—— 这一步仍然需要。
 */
const FLOW_EDGE_TYPE = 'flowEdge';

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
  /**
   * ★ 2026-10-07（教师）：「双击一个图形框修改里面的文字的时候，**这个框本身不要变大**，
   *   只需选中里边所有的文字」。
   *
   * 🔴 原来输入框的宽度是**按字数算**的（`字数 + 2` 个 em，还跟着正在打的草稿走）——
   *    框的宽度是**内容撑出来**的，于是从双击那一刻起（更别说边打边长）框就跟着输入框变。
   * ✅ 进编辑态时**量一下当时那行字有多宽**，输入框就用那个宽度 ⇒ 框一点不动。
   * ⚠️ 必须用 `offsetWidth`（**布局像素**），不能用 `getBoundingClientRect()` ——
   *    后者会被画布的缩放乘一遍（缩放 2 倍时量出来的宽度也是 2 倍）。
   * ⚠️ 全局 `box-sizing: border-box`（`globals.css`）⇒ 输入框的 `width` 含它自己的内边距，
   *    不会比量出来的那行字更宽 ⇒ 框不会因为那几个像素又撑大。
   */
  const labelRef = useRef<HTMLSpanElement | null>(null);
  /** 进编辑那一刻量到的宽度；`null` = 没量到（退回样式表里的默认宽度）。 */
  const [editWidth, setEditWidth] = useState<number | null>(null);
  /**
   * 提交草稿（blur / Enter / Escape 都汇到这里）。
   * ⚠️ 只在**真改了**的时候才写 store：双击进来什么都没动就点走，不该产生一次「内容变更」
   *    （那会让画板往外报一次、快照跟着重算一次）。
   */
  const commitLabel = () => {
    setEditing(false);
    if (draft !== data.label) instance.updateNodeData(id, { label: draft });
  };
  /**
   * 双击进入编辑：**先把当前那行字的宽度量下来**，再换成输入框。
   * ⚠️ 量必须在**这一刻**做 —— 下一帧这个 span 就被输入框替换掉了，没得量。
   */
  const startEditing = (event: React.MouseEvent) => {
    event.stopPropagation();
    const label = labelRef.current;
    /*
     * ⚠️ **空标签**（学生把字删光过）量出来只有内边距那几个像素 ⇒ 输入框会细成一条缝，
     *    自己打的字都看不见。那种情况退回样式表里的默认宽度（框有 `min-width`，不会因此变大）。
     */
    setEditWidth(label && data.label.length > 0 ? Math.round(label.offsetWidth) : null);
    setDraft(data.label);
    setEditing(true);
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
          /* ★ 宽度 = 进编辑那一刻量下来的那行字的宽度 ⇒ 框**一点不动**（见 `editWidth` 的注释）。
             `null` 时才不写内联宽度，让样式表里那个默认值接手。 */
          style={editWidth === null ? undefined : { width: editWidth }}
          onChange={(event) => setDraft(event.target.value)}
          /* ★ 2026-10-06（教师）：「双击一个图形框，默认**全选**里面的文字，方便修改」。
             input 只在编辑态存在（渲染条件是 `editing && …`）⇒ 这个 focus **就是**「刚进入编辑」
             那一次，一句 `select()` 就够，不必额外记「是不是刚进来」。
             ⚠️ 别改到别处去（比如往 input 外面挂监听、每次都全选）—— 那会让**在框里点一下
             就全选掉**，学生想放光标到中间改一个字都做不到。 */
          onFocus={(event) => event.currentTarget.select()}
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
          ref={labelRef}
          className={styles.flowNodeLabel}
          title={data.locked ? undefined : '双击修改文字'}
          onDoubleClick={startEditing}
        >{data.label}</span>
      ))}
    </div>
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
 *   · 命中区 44px（老 iPad 的手指下限）—— **这个数住在 CSS 里**（`.flowEdgeFloat` 的
 *     `width/height`；`worksheet-tap-targets.test.ts` 量的正是样式表那一份）
 *     ⇒ 这里**不再**另存一份 TS 常量：两份必然分叉，而它在代码里也没有第二个消费者。
 *   · `EDGE_FLOAT_BACK` —— 删除**连线**的按钮：从**起点**沿**起点句柄轴**往外走多少（流坐标）。
 *
 * ⊘ 2026-10-06：这里原来还有第四个常量 `HANDLE_GAP`（**中点浮层**沿「中点 → 目标端」挪多少）——
 *   它唯一的目的是避让那颗**中点句柄**（既别压住线上的 Y/N 标签，也别吞掉正落在中点的
 *   单击/双击）。句柄随自定义边一起删掉之后这两件事都不存在了 ⇒ 就地输入框回到**裸标签点**
 *   （见 `edgeMidAnchor`）。⚠️ 别再把它加回来：那会让输入框与它要改的那个字分家。
 * 🔴 `EDGE_FLOAT_BACK` 仍然**独自**存在：它从来不是「某个数换个名字」，以后也不许拿别的数替代。
 * ⊘ 2026-10-07（**教师改主意**）：这里原有的另外两个常量都删了 ——
 *   · `NODE_FLOAT_GAP`（删除图形那颗按钮「在框上方多少」）：按钮挪到了**左上角顶点**上
 *     （「位置可以放在图形区域的左上角，但切记要压在图形的线条上」）⇒ 不再需要偏移；
 *   · `FLOAT_SIZE`：见上，它只是 CSS 那一份的副本，代码里没人用。
 */
/*
 * ⊘ 2026-10-07（教师改主意）：这里原有 `NODE_FLOAT_GAP`（= 半个按钮 + 一指宽的缝，数值 28）——
 *   它让删除按钮悬在框**上边缘上方**。教师看过效果之后要求挪到**左上角的顶点**上
 *   （「位置可以放在图形区域的左上角，但切记要压在图形的线条上」）⇒ 这个偏移没有对象了。
 *   现在锚点直接取 `node.position`，不需要任何常量。
 */
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
 * 一个节点上某个句柄的**流坐标** —— 就是**库给边的那一点**（见 `flowAnchorPoint`）。
 *
 * 🔴 别再自己写「盒子的哪条边、哪个中点」：库的端点约定是**句柄方块的边**，
 *    比节点边框再往外 6px。差这 6px 的后果是「拖到最两端时控制柄偏出线外一点」
 *    （教师 2026-10-07 第二次报障，根因写在那条函数的注释里）。
 * ⚠️ 抽成模块级是因为两处要用：锚点表（`edgeFlowAnchors`）与 `onConnectEnd` 的几何兜底。
 *    两份各写一遍必然分叉，而分叉的表现是「吸附算出来的距离整体偏半个节点」这种**不报错**的错。
 * ⚠️ 宽高优先用库量出来的 `measured`（真实尺寸），没量到才退回 150×54 —— 与画布默认值同一档。
 */
const handleFlowPoint = (node: FlowNode, handleId: unknown, fallback: Position): FlowPoint => (
  flowAnchorPoint({
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? 150,
    height: node.measured?.height ?? 54,
  }, positionOfHandle(handleId, fallback))
);

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
    ⇒ 函数本身变成死代码，一并删除。`clampOffset` 留着 —— 删除按钮（`edgeStartAnchor`）还在用它。
*/

/**
 * **句柄轴的外法线**（单位向量）—— 从某个句柄出发、**离开它所属那个节点**的方向。
 *
 * 🔴 为什么不用「起点→终点」直线近似：`smoothstep` 的**首段一定沿起点句柄轴出来**、
 *    **末段一定沿目标句柄轴进去** ⇒ 只有沿这两条轴走才是严格的「压在线上」。
 *    直线近似在**拐弯的边**上能与真实的那一段差 ~75° —— 按 dx=200 / dy=146 那种拐角算，
 *    26px 会变成「偏离线 ~21px、只沿线走 ~15px」，按钮就横在线旁边了。
 *    方位对应：句柄在 Top ⇒ 线从**上方**进出 ⇒ 往外走就是 **-y**；Bottom / Left / Right 同理。
 *
 * ⚠️ 名字里**不许**再带「back」—— 它两头都用（起点侧算「往终点方向走」、目标侧算「往 source 退」），
 *    叫 back 会让下一个人以为只能喂 `targetPosition`（改名前就叫这个，2026-10-06 改掉）。
 */
const handleOutwardAxis: (handlePosition: Position) => FlowPoint = (handlePosition) => {
  if (handlePosition === Position.Top) return { x: 0, y: -1 };
  if (handlePosition === Position.Bottom) return { x: 0, y: 1 };
  if (handlePosition === Position.Left) return { x: -1, y: 0 };
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


/**
 * 库那个算路径的函数，**包一层收窄成三元组** —— `FlowEdge`（画线）与锚点表（`edgeFlowAnchors`，
 * 算控制柄/浮层/交点节点停在哪儿）**共用这一份**。
 *
 * 🔴 两处各包一次必然分叉，而分叉的表现是「浮层停在一条屏幕上并不存在的线上」——**不报错**。
 * ⚠️ 库返回的是 **5 元组**（`[path, labelX, labelY, offsetX, offsetY]`），这里只关心前三个。
 */
const smoothStepPath: SmoothStepFn = (params) => {
  const [path, labelX, labelY] = getSmoothStepPath(params as Parameters<typeof getSmoothStepPath>[0]);
  return [path, labelX, labelY];
};

/**
 * 一份「算这条边要用的数」—— `FlowEdge`（画线）与锚点表（`edgeFlowAnchors`）**必须用同一份**。
 *
 * ⚠️ 画板这边**没有** `pathOptions`（既没设 `defaultEdgeOptions`，也不落盘），所以锚点表传
 *    `undefined` 与边组件收到的是同一套默认值。将来谁要加 `pathOptions`，**两边一起加**。
 */
function edgeGeometryParams(
  ends: {
    sourceX: number; sourceY: number; sourcePosition: string;
    targetX: number; targetY: number; targetPosition: string;
  },
  route: FlowEdgeData | undefined,
  pathOptions: EdgeProps['pathOptions'],
): Parameters<typeof flowEdgeGeometry>[0] {
  return {
    ...ends,
    ...(route?.routeX !== undefined ? { centerX: route.routeX } : {}),
    ...(route?.routeY !== undefined ? { centerY: route.routeY } : {}),
    ...(pathOptions?.offset !== undefined ? { offset: pathOptions.offset } : {}),
    ...(pathOptions?.borderRadius !== undefined ? { borderRadius: pathOptions.borderRadius } : {}),
  };
}

/**
 * 边数据里的标签偏移 —— **两个轴都写过**才算「拖过」。
 * ⚠️ 标签是**二维**拖的（与控制柄那个「只动一个轴」不同，见 `FlowLabelHandle`）：
 *    一次拖动会把两个轴一起写下去 ⇒ 只写了一半的那种（老数据/坏数据）当**没拖过**处理，
 *    退回默认那一侧 —— 比把它摆到一个说不清的位置强。
 */
function labelOffsetOf(route: FlowEdgeData | undefined): FlowLabelOffset | null {
  if (route?.labelDX === undefined || route?.labelDY === undefined) return null;
  return { dx: route.labelDX, dy: route.labelDY };
}

/**
 * ★ 2026-10-07（教师）：这一份自定义边**只做两件事**，其余**全部**交给库的 `BaseEdge`。
 *
 *   ① **绕行点**（`data.routeX/routeY`）—— 折线上那颗控制柄拖出来的；
 *   ② **线上文字的偏移**（`data.labelDX/labelDY`）—— 默认贴在线旁边，还能拖着走。
 *
 * ⊘ 这里原来还有一条「折线太短就画成直线」—— 教师看到实物之后否掉了：
 *   「**这里还是取消自动变换成斜线吧，很怪异。所有的线条要不就是竖线，要不就是横线**」
 *   ⇒ 现在路径**一律**交回库（它的每一段本来就是横的或竖的），**一条斜线都不画**。
 *
 * 🔴 **与 2026-10-06 删掉的那一版有本质区别**：那一版还顺手**把标签挪到了线旁边**（教师后来
 *    否掉了，才有了「全回原版」）。这一版**不碰标签** —— `label`/`labelX`/`labelY`/`labelShowBg`
 *    原样转交给 `BaseEdge`，画出来与库内置那份**逐字一致**（白底框、居中压线，都是库那套）。
 *    箭头 / 配色 / 交互宽度同理，全部照转。
 */
function FlowEdge({
  id, selected, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  markerEnd, markerStart, style, pathOptions, interactionWidth, data,
}: EdgeProps) {
  const route = data as FlowEdgeData | undefined;
  const params = edgeGeometryParams({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }, route, pathOptions);
  const [path, baseLabelX, baseLabelY] = flowEdgeGeometry(params, smoothStepPath);
  /*
   * ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」+「贴着线拖」。
   * 🔴 **不用把标签从库手里拿回来** —— 库画的还是它（白底框、居中、配色全不动），
   *    我们只是把它收到的那两个坐标**挪一下**（`labelX/labelY` 是库的入参）。
   *    所以这一轮没有推翻「全回原版」。
   */
  const labelOffset = flowLabelOffset(params, String(label ?? ''), labelOffsetOf(route));
  const labelX = baseLabelX + labelOffset.dx;
  const labelY = baseLabelY + labelOffset.dy;
  /*
   * ★ 2026-10-07（教师）：「连接线上的文字说明，在我选中以后、移动之前，能不能套一个**简单的
   *   文本框**，表示我选中了、可以移动了？」
   * ✅ 就套在**库那块白底矩形**上（`labelBgStyle` ⇒ `.react-flow__edge-textbg`）：
   *    那块矩形本来就贴着字量出来（`EdgeText` 里按 `getBBox` 算的）⇒ 任何缩放下都严丝合缝；
   *    自己再画一个框，缩放一变就会与字差几个像素。
   * ⚠️ 只在**选中且有字**时出现 —— 这正是「可以拖它了」的那个状态（把手也在这时出现）。
   */
  const labelBg = selected && label
    ? { ...labelBgStyle, stroke: '#527198', strokeWidth: 1, strokeDasharray: '4 3' }
    : labelBgStyle;
  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBg}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      interactionWidth={interactionWidth}
    />
  );
}

/**
 * ★ 2026-10-07（教师）：「这个区域的折线上还是需要出现一个**控制柄**，可以让用户上下拖动这条
 *   横线，或者是左右拖动一条竖线，但是**这个控制柄本身不允许移动位置**」。
 *   ★ 紧接着第二次报障：「连线的控制点必须**永远压在线上面**，不能漂移到线外」。
 *
 * 🔴 最后那半句是整个设计的钥匙 —— 它**不是**自由浮层（不是「拖到哪儿算哪儿」），
 *    而是**长在折线上的一个把手**：拖它只是**移动那一段线**，把手自己**永远在线上面**。
 *
 * 🔴 上一版没做到，正是教师截图里那颗飘在线外的空心圆：锚点取自 `data.routeX/routeY`，
 *    而拖动**只写一个轴**（`axis='y'` 只写 `routeY`）⇒ 那句
 *    `routeX !== undefined && routeY !== undefined` 不成立 ⇒ 退回「库算的**默认中点**」
 *    —— 线已经跟着手指走了，把手还钉在原来那儿。
 * ✅ 现在把手的坐标**一律由锚点表给**（`anchors.midX/midY` = **画出来的那条路径**的中点），
 *    与线同源 ⇒ 线一动它跟着动，不需要任何额外约束。
 *
 * 轴与范围都来自 `track`（`flowRouteTrack`）：
 *   · `axis` 由**边自己的走向**定（不是句柄 id）—— 中段横着就上下拖、竖着就左右拖；
 *   · `min/max` 是**能走到哪儿**：越过去中段就会折返（教师 2026-10-07 那张图的「最低位置」）。
 * ⚠️ `track` 为 `null`（拐弯的边）时**调用方不渲染它** —— 那种边库压根不读绕行点，
 *    给了把手就是「拖了没反应」（教师刚报过的那类错）。
 */
function FlowRouteHandle({
  edgeId, anchor, track, disabled, onDragStateChange,
}: {
  edgeId: string;
  anchor: { x: number; y: number };
  track: FlowRouteTrack;
  disabled: boolean;
  /** 拖动起止告诉画板一声 —— 历史那条 effect 靠它把**整段拖动合成一步**（见那边的注释）。 */
  onDragStateChange: (dragging: boolean) => void;
}) {
  const { setEdges, screenToFlowPosition } = useReactFlow<FlowNode, Edge>();
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onDragStateChange(true);
    const key = track.axis === 'x' ? 'routeX' : 'routeY';
    const move = (pointer: PointerEvent) => {
      const point = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      /* 🔴 夹进 `track` 的范围 —— 教师那张图说的「最低位置」就是 `track.max`（见 `flowRouteTrack`）。 */
      const value = clampToTrack(track, track.axis === 'x' ? point.x : point.y);
      setEdges((current) => current.map((edge) => (edge.id === edgeId
        ? { ...edge, data: { ...(edge.data as FlowEdgeData | undefined), [key]: value } }
        : edge)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      onDragStateChange(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  const vertical = track.axis === 'y';
  return (
    <button
      className={styles.flowRouteHandle}
      type="button"
      aria-label={vertical ? '上下拖动这条横线' : '左右拖动这条竖线'}
      title={vertical ? '上下拖动这条横线' : '左右拖动这条竖线'}
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={onPointerDown}
    >
      <span aria-hidden="true" />
    </button>
  );
}

/**
 * ★ 2026-10-07（教师）：「线上文字……**贴着线拖**」。
 *
 * 与 `FlowRouteHandle` **同一个套路**：一个把手浮在**标签**上（选中这条线时才出现），
 * 拖它改的是 `data.labelDX/labelDY` —— 标签本身仍由库画，我们只挪它收到的坐标。
 *
 * ⚠️ 与控制柄的两点不同：
 *   · 它是**二维**拖（拖到哪儿算哪儿），控制柄那个只动一个轴（那条线只能上下或左右走）；
 *   · 拖到哪儿**有上限**（`clampLabelOffset`：夹在「线附近」）—— 教师选的就是这个。
 * ⚠️ **完全透明**：字本身就是要拖的东西，再叠一个圈只会糊住它（提示靠光标 `grab` 与 title）。
 * ⚠️ 双击 = 改这条线上的字：标签挪到线旁边之后，从线上双击容易点不到那几个字。
 */
function FlowLabelHandle({
  edgeId, anchor, offset, width, disabled, onDragStateChange, onEdit,
}: {
  edgeId: string;
  anchor: { x: number; y: number };
  offset: FlowLabelOffset;
  /** 命中区宽度 —— 至少 44（触屏下限），比标签本身宽一点。见下面 `style` 那行。 */
  width: number;
  disabled: boolean;
  onDragStateChange: (dragging: boolean) => void;
  onEdit: () => void;
}) {
  const { setEdges, screenToFlowPosition } = useReactFlow<FlowNode, Edge>();
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onDragStateChange(true);
    /*
     * ⚠️ 坐标**只在 `pointermove` 里读**（`PointerEvent` 本身覆盖触屏 ⇒ 不必过
     *    `pointerClientPoint` 那个「认 TouchEvent」的纯函数，那是给 `onConnectEnd` 用的）。
     * ⚠️ 起手点**第一帧才立**（`start === null` 那一格直接 return）：这样位移是从**手指按下的
     *    那一点**算起的，字不会在第一帧「跳」到自己中心对上手指 —— 抓字角拖也照样跟手。
     */
    let start: { x: number; y: number } | null = null;
    const move = (pointer: PointerEvent) => {
      const point = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      if (!start) { start = point; return; }
      const next = clampLabelOffset({ dx: offset.dx + (point.x - start.x), dy: offset.dy + (point.y - start.y) });
      setEdges((current) => current.map((edge) => (edge.id === edgeId
        ? { ...edge, data: { ...(edge.data as FlowEdgeData | undefined), labelDX: next.dx, labelDY: next.dy } }
        : edge)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      onDragStateChange(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  return (
    <button
      className={styles.flowLabelHandle}
      type="button"
      aria-label="拖动这段文字（双击改字）"
      title="拖动这段文字（双击改字）"
      /*
       * ★ 命中区**跟着字走**：只有 44px 的话，四个字以上的标签只能从**中间**拖得动，
       *   抓它两边会掉到线上（学生第一下常常就抓在边上）。下限仍是 44（触屏那条硬要求）。
       */
      style={{ left: anchor.x, top: anchor.y, width }}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => { event.stopPropagation(); onEdit(); }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function FlowchartEditor({ data, backgroundUrl, disabled, onChange, onImage, starter, historyKey }: DrawingSurfaceProps) {
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
  /*
   * ★ 2026-10-06（教师真机发现全屏坏掉之后）：有 `historyKey` 时，历史从**模块级的表**里取 ——
   * 因为「全屏切 portal」会让 React 重挂整棵子树，组件内的一切（含 `useRef`）都会重建，
   * 历史当场归零。没传 key 就是组件内的一份，行为与从前完全一样。
   */
  const historyRef = useRef<FlowHistory<FlowSnapshot<FlowNode, Edge>>>(
    historyKey ? loadHistory<FlowSnapshot<FlowNode, Edge>>(historyKey) : emptyHistory(),
  );
  /** 历史一变就存回去（没传 key 时是空操作）。三处调用：压栈、撤销、重做。 */
  const persistHistory = useCallback(() => {
    if (historyKey) saveHistory(historyKey, historyRef.current);
  }, [historyKey]);
  const lastSnapshotRef = useRef<FlowSnapshot<FlowNode, Edge>>({ nodes: initial.current.nodes, edges: initial.current.edges });
  const lastSigRef = useRef<string | null>(null);
  /**
   * ★ M1（审查留下的）：工具条那颗「自定义」标注框**打字期间先别记历史**。
   *
   * 它**是受控的**（值来自 `edges.find`，这样切换线/清空/撤销都能回到正确内容 —— 那个设计是对的，
   * 别改成非受控），但每敲一键都会写 `edges` ⇒ 指纹一变就压一步，于是撤销时字**一个一个字地退**。
   * 聚焦置位、失焦清位 ⇒ 整段打字合成一步（与节点文字那套「本地草稿 + 提交一次」同一个口径）。
   */
  const typingRef = useRef(false);
  /**
   * ★ 2026-10-07：**控制柄正在被拖**（见 `setRouteDragging`）。
   *
   * 🔴 没有它的话，拖一次控制柄会**把整个撤销栈吃光**：拖动期间每个 `pointermove` 都写一次
   *    `edges` ⇒ 指纹每次都变 ⇒ 那条变化检测 effect 每帧压一步（50 步的栈，一次拖动就没了）。
   *    这正是审查报过的 **C2**（当时那颗「路径调整圆点」也是这个毛病），
   *    「全回原版」把它连同守卫一起删了，后来控制柄回来、守卫却没回来 —— 于是同一个坑又开了一次。
   * ⚠️ 与节点拖动那条守卫**判据不同**：那条必须读库自己的 `node.dragging`（库有两条路径结束
   *    拖动时不回调 ⇒ 自己置的标记会永久卡住，见那里的注释）。这一条是**我们自己的**
   *    `pointerdown → pointerup/pointercancel` 配对，两条收尾都会走到；而且组件一卸载这个 ref
   *    就没了。所以这里自己置位是安全的。
   */
  const routeDragRef = useRef(false);
  /**
   * 松手时**主动催一次**变化检测（见 `setRouteDragging`）。
   * ⚠️ 它只负责「让那条 effect 再跑一次」，不参与任何判据 —— 别拿它当「拖过了」的记号。
   */
  const [dragEpoch, setDragEpoch] = useState(0);
  /**
   * 控制柄的拖动起止。
   *
   * 拖动期间置位 ⇒ 变化检测整段跳过（`lastSigRef` 停在这一拖**之前**，于是松手后它比的正好是
   * 「拖动前 vs 拖动后」，**恰好压一步** —— 与节点拖动那一路同一个口径）。
   * 🔴 松手那一下**必须自己催一次**：只把标记清掉**不会再触发任何 state 变化**，
   *    那条 effect 的依赖（`nodes`/`edges`）也没变 ⇒ 不催的话这一拖**一步都不记**（撤销退不回去）。
   *    （节点拖动不需要这一句，是因为库会把 `node.dragging` 置回 false —— 那本身就是一次 state 变化。）
   */
  const setRouteDragging = useCallback((dragging: boolean) => {
    routeDragRef.current = dragging;
    if (!dragging) setDragEpoch((value) => value + 1);
  }, []);
  /** ★ 2026-10-06（审查发现 I2）：这棵画板的根元素 —— 用来判定「这个快捷键该不该由我响应」。 */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 最后一次 pointerdown 落在这台画板里吗（见下面那条捕获相监听）。 */
  const lastTouchedRef = useRef(false);
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
  const { flowToScreenPosition } = useReactFlow<FlowNode, Edge>();
  const nodeTypes = useMemo(() => ({ flow: FlowNodeEditor }), []);
  /*
   * ★ 2026-10-07（教师）：重新注册一份自定义边 —— 它**只**做「绕行点」与
   *   「绕行点」两件事，标签/箭头/配色/交互**全部**转交给库的 `BaseEdge`（见 `FlowEdge`）。
   *
   * 🔴 `FLOW_EDGE_TYPE` 是**我们自己**的类型名（不是 `smoothstep`）：这样 `edgeTypes` 注册的是
   *   **新增**的一种边，而不是**替换**库内置的那份。
   */
  const edgeTypes = useMemo(() => ({ [FLOW_EDGE_TYPE]: FlowEdge }), []);
  /**
   * ★ 2026-10-07（教师：「查一下第 11 题为什么会重复保存」）—— 上一份**发布过的**内容签名。
   *
   * 🔴 没有它就是一个自激环：这个 effect 的依赖里有 `onChange`，而 `onChange` 的身份取决于
   *   `drawingDocument.image`，抓图**每次给一个新 URL** ⇒ 抓图 → 身份变 → effect 重跑 →
   *   无条件再保存一次 + 再抓一张 ⇒ 每约 1 秒一次，**与学生在哪一题无关**
   *   （学生端所有题目同时挂载 ⇒ 每一块流程图都在跑）。
   * ⚠️ 判据在 `@/lib/worksheet-flowchart-publish.ts`（纯函数、有用例）。
   */
  const lastPublishedSignature = useRef<string | null>(null);

  /** 位图快照：自己吐一份纯 SVG 再栅格化（**不用 `foreignObject`**，老 iPad 上那条路可能出空白图）。 */
  const scheduleRaster = useDrawingRaster({
    capture: async () => {
      const shot = lastFlow.current ? flowchartSvg(lastFlow.current) : null;
      return shot ? svgToPngBlob(shot.svg, shot.width, shot.height) : null;
    },
    onUrl: onImage,
  });

  useEffect(() => {
    /*
     * ★ 2026-10-07（教师）：「初始图里的绘图元素**一开始都没有显示出来**。当我移动其中的一个，
     *   它才会显示」—— 根因就是这条「首帧只立基线、什么都别做」的守卫：
     *   一进题目还没动笔时，`onChange` 与 `scheduleRaster` **两个都不跑** ⇒
     *   **一张快照都抓不出来**（而底稿正是画在快照上的）⇒ 教师那一格空白，
     *   而学生屏幕上明明有底稿 —— 又是「两边都不报错」的那种。
     * ✅ 首帧照旧**不报作答**（交上去的是「学生自己画的」那一份，刚进来时它就是空的；
     *   一进来就报会把这题算成「作答中」），但**快照要照抓** —— 它不进作答，只喂教师/AI。
     * ⚠️ 空画板抓不出图（`flowchartSvg` 对空图回 `null`）⇒ 没底稿的题仍然什么都不会发生
     *   （不会把「只是打开了题」算成作答中）。
     */
    const firstFrame = !initialized.current;
    initialized.current = true;
    const timer = window.setTimeout(() => {
      const payload = toFlowPayload(nodes, edges);
      // 快照按**全部**画（含底稿）⇒ 教师预览 / AI 联系表 / Word 报告里是一张完整的图。
      // ⚠️ 这一份**永远**更新（抓图读它），与下面发不发无关。
      lastFlow.current = payload;
      /*
       * 🔴 ★ 2026-10-07：**内容没变就到此为止。**
       *   这一句是断开那个自激环的地方 —— 上面那段注释写了它怎么闭合的。
       *   没有它：每约 1 秒一次保存 + 一次上传，而且**每一块挂着的流程图都在跑**
       *   （学生端所有题目同时挂载），与学生在哪一题上画无关。
       * ⚠️ 首帧（还没有上一份签名）也要过 —— 首帧要抓快照（底稿靠它进教师那一格）。
       */
      const signature = flowPayloadSignature(payload);
      if (!shouldPublishFlow(lastPublishedSignature.current, signature)) return;
      lastPublishedSignature.current = signature;
      // ★ A：交上去的那份**只留学生自己画的**（底稿不算他的作答）。
      // ⚠️ 首帧照旧**不报作答**（一进来就报会把这题算成「作答中」），但快照要抓。
      if (!firstFrame) {
        onChange(subtractFlowchart(payload, starterPayload) as unknown as ReturnType<typeof toFlowPayload>);
      }
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
   * 🔴 **拖动中一律不压栈**：拖动期间每个 mousemove 都会让 nodes 变一次，照压的话拖一下框
   *    要用五十次撤销才退得回去。拖动中**连 `lastSigRef` 都不更新** —— 这样松手后这一次 effect
   *    比的就是「拖动前 vs 拖动后」，**恰好压一步**。
   * ⊘ 2026-10-06：这里原来还挡着一条 `draggingRef`（自己那颗「路径调整圆点」的拖动）——
   *    教师定了「全回原版」之后，那颗圆点连同它的处理器一起删了，这条守卫也就没有对象了。
   */
  useEffect(() => {
    /*
      🔴 判据是**节点自己的** `dragging` 字段，**不是**我们自己用回调置的标记：
      库有**两条路径结束拖动时不调 `onNodeDragStop`**（多点触控的第二根手指、拖动中被删掉的
      那个节点）⇒ 靠回调置的标记会**永久卡在 true**，此后这条 effect 每次 `return`、`lastSigRef`
      也不再更新，**整个会话记不下任何新步骤**（撤销键变灰后再也不亮）。读节点上这个字段则
      **自愈** —— 库在 `updateNodePositions(dragItems, false)` 里会把它置回 false，
      **abort 路径也走那一句**。（★ 审查发现 I1。）
      ⚠️ `typingRef` 是另一条：工具条那颗「自定义」标注框**打字期间**先别记历史（M1）。
      ⚠️ `routeDragRef` 是第三条：**拖控制柄**期间先别记（见 `setRouteDragging`）——
        没有它，拖一下就把 50 步的撤销栈吃光（一次拖动 = 每帧一步）。
        松手那一下由 `dragEpoch` 催一次，所以**依赖里必须带着它**。
    */
    if (typingRef.current || routeDragRef.current || nodes.some((node) => node.dragging)) return;
    const sig = flowchartSignature(nodes, edges);
    if (lastSigRef.current === null) { lastSigRef.current = sig; return; } // 首帧：只立基线
    if (lastSigRef.current === sig) return;                                 // 没有实质变化
    historyRef.current = pushHistory(historyRef.current, lastSnapshotRef.current);
    lastSnapshotRef.current = { nodes, edges };
    lastSigRef.current = sig;
    persistHistory(); // ★ 存回模块级的表（没传 historyKey 时是空操作）
    setHistoryVersion((v) => v + 1); // 让两颗按钮的 disabled 跟着刷新
  }, [nodes, edges, persistHistory, dragEpoch]);

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
   * 「一键整理」（★ 2026-10-06 教师报「会打乱我原有的结果」之后重写；★ 2026-10-07 又收窄一次）。
   *
   * ★ 2026-10-07（教师）：「这个按钮的功能**只在微调**连接线和矩形的位置布局……比如把连接线
   *   当中的一些**很小的折线去掉，变成一根直线**，不要改变整个流程图的布局，
   *   也**不要改变连接线所连接图形的节点**，这些都要保持原样。」
   *   ⇒ 现在**只挪矩形**（把差一点点的框吸齐 ⇒ 连线自然成了严格竖线/横线），
   *     连线**一个字段都不动**（原来会重挑句柄，已撤）。
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
    /*
      ★ M2（审查留下的）：一并清掉节点上 **React Flow 自己的** `selected`。
      `setSelected(null)` 清的是本组件那份单选槽位，而节点上的 `selected` 是库的字段
      （渲染成 `data-selected`）⇒ 快照里那个框当时若是选中的，恢复后它会带着蓝框渲染，
      而删除浮层与提示文字都没了 —— 学生看到「一个亮着的框，但什么按钮都没有」。
      ⚠️ 只在**这次恢复的副本**上清，`lastSnapshotRef` 仍然收原样的 `snap`：
      快照记的是「当时的样子」，那是事实，不该被改写。
    */
    setNodes(snap.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setEdges(snap.edges);
    setSelected(null);
    setLabelingEdge(null);
    lastSnapshotRef.current = snap;
    lastSigRef.current = flowchartSignature(snap.nodes, snap.edges);
    persistHistory(); // ★ 撤销/重做也要存回表：那一步之后重挂（切全屏）同样不能丢
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, persistHistory, setNodes, setEdges]);

  /** ★ 2026-10-06：**重做** —— 与 `undo` 逐字对称，只有 `redoHistory` 与 `future` 的方向不同。 */
  const redo = useCallback(() => {
    const step = redoHistory(historyRef.current, { nodes, edges });
    if (!step) return;
    historyRef.current = step.history;
    const snap = step.snapshot;
    /*
      ★ M2（审查留下的）：一并清掉节点上 **React Flow 自己的** `selected`。
      `setSelected(null)` 清的是本组件那份单选槽位，而节点上的 `selected` 是库的字段
      （渲染成 `data-selected`）⇒ 快照里那个框当时若是选中的，恢复后它会带着蓝框渲染，
      而删除浮层与提示文字都没了 —— 学生看到「一个亮着的框，但什么按钮都没有」。
      ⚠️ 只在**这次恢复的副本**上清，`lastSnapshotRef` 仍然收原样的 `snap`：
      快照记的是「当时的样子」，那是事实，不该被改写。
    */
    setNodes(snap.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setEdges(snap.edges);
    setSelected(null);
    setLabelingEdge(null);
    lastSnapshotRef.current = snap;
    lastSigRef.current = flowchartSignature(snap.nodes, snap.edges);
    persistHistory(); // ★ 撤销/重做也要存回表：那一步之后重挂（切全屏）同样不能丢
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, persistHistory, setNodes, setEdges]);

  /**
   * ★ 2026-10-06（**审查发现 I2**）：记下「最后一次 pointerdown 落在哪台画板里」。
   *
   * 🔴 `worksheet-panel.tsx` 会把同一个可见分组里的题**全部**渲染出来 —— 一份学习单里若有两道
   *    流程图题，两个实例各自挂一个 window 监听 ⇒ 按一次 `Cmd+Z` **两道题各退一步**，
   *    并各自重新上报一份作答（`onChange` + 位图快照）。学生眼前那道看起来「没反应」，
   *    另一道（可能已经画好、也可能不在视口里）被静默改了一步 —— 这类「改到别处」最难被发现。
   * ✅ 用**捕获相**监听：不管事件在子树哪一层被 `stopPropagation` 掉，这里都先收到。
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      // ⚠️ 本文件里 `Node` 这个名字被 React Flow 的类型占了（`type FlowNode = Node<FlowData>`）⇒
      //    DOM 那个 Node 必须显式写成 `globalThis.Node`，否则 `as Node` 会被解析成那个泛型类型
      //    （`tsc` 当场报 TS2345）。用 `instanceof` 而不是断言，顺带也不用管 `null`。
      lastTouchedRef.current = !!(root && event.target instanceof globalThis.Node && root.contains(event.target));
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

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
      if (!lastTouchedRef.current) return; // ★ I2：最后被碰的不是我 ⇒ 这个快捷键不归我管
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
       ⚠️ 由 `targetPosition` 决定 —— 线从哪一侧进目标，就往那一侧退（见 `handleOutwardAxis`）。 */
    const back = handleOutwardAxis(targetPosition);
    /* ★ 2026-10-06（教师改主意）：删除按钮挪到**起点那一侧** ⇒ 还需要一个「从起点往外」的方向。
       同一张表，只是喂 `sourcePosition`（`smoothstep` 的首段一定沿它出来）。 */
    const out = handleOutwardAxis(sourcePosition);
    /*
     * ★ 2026-10-07（教师：「连线的控制点必须**永远压在线上面**，不能漂移到线外」）：
     *   中点**照着画出来的那条路径**算 —— 走 `flowEdgeGeometry`（与 `FlowEdge` **同一个函数、
     *   同一份入参**），于是它一定落在线段正中：线上文字、就地输入框、控制柄、新插的交点节点
     *   全都锚在这一个点上。
     * 🔴 上一版这里是**裸的** `getSmoothStepPath`（绕行点一个都不带）⇒ 算的是**默认那条路**的中点。
     *    学生一拖控制柄，线走了、这个点还留在原地 ⇒ 控制柄飘到线外（教师截图那颗空心圆），
     *    就地输入框同样会歪到别的线上。
     * ⚠️ 只算一次、两处共用：路径函数调用两次必然分叉，而分叉**不报错**。
     */
    const params = edgeGeometryParams(
      { sourceX: from.x, sourceY: from.y, sourcePosition, targetX: to.x, targetY: to.y, targetPosition },
      edge.data as FlowEdgeData | undefined,
      /* ⚠️ 画板没有 `pathOptions`（见 `edgeGeometryParams`）—— 边组件收到的也是默认值。 */
      undefined,
    );
    const [, labelX, labelY] = flowEdgeGeometry(params, smoothStepPath);
    /*
     * ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」+「贴着线拖」。
     * 🔴 `midX/midY` 是**线上的那个点**（取交点节点、算吸附距离用的）—— 标签**不再是**它：
     *    标签摆在线的旁边 ⇒ 单独给一份 `labelX/labelY`（就地输入框、拖标签的把手都用它）。
     */
    const labelOffset = flowLabelOffset(params, String(edge.label ?? ''), labelOffsetOf(edge.data as FlowEdgeData | undefined));
    return {
      midX: labelX, midY: labelY, track: flowRouteTrack(params),
      labelX: labelX + labelOffset.dx, labelY: labelY + labelOffset.dy, labelOffset,
      endX: to.x, endY: to.y, fromX: from.x, fromY: from.y,
      backX: back.x, backY: back.y,
      outX: out.x, outY: out.y,
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
    /*
     * ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」——
     *   标签**不再压在线上了** ⇒ 就地输入框必须跟着**标签**（`labelX/labelY`）走，
     *   否则输入框会停在那条线上、与它要改的那几个字分家。
     * ⚠️ `midX/midY`（**线上**那个点）另有用处：交点节点、吸附距离 —— 那两处要的就是线上的点。
     */
    const { labelX, labelY } = anchors;
    return { x: viewport.x + labelX * viewport.zoom, y: viewport.y + labelY * viewport.zoom };
  };

  /**
   * ★ 2026-10-06（**教师改主意了**）：「可以换成一个小叉叉图标，然后**压在靠近起点的线上**」。
   *
   * ⊘ 这推翻了上一版那条规矩。原话是「删除图标移到这条连线的**终点**」（动机：别和就地输入框
   *   一起压在中点、把线上的字糊住），那一版还刻意**向侧边让开 34px** 去躲线。
   *   现在教师要求挪到**起点那一侧**，而且要**压在线上**（不再让开）⇒ 两条都按新的来。
   *
   * ✅ 方向取**起点句柄轴的外法线**（`handleOutwardAxis(sourcePosition)`）——
   *   `smoothstep` 的**首段一定沿起点句柄轴出来** ⇒ 沿这条轴走才是严格的「压在线上」；
   *   用「起点→终点」直线近似在拐弯的边上会横到线旁边去（见那张表的注释）。
   * ✅ 距离过 `clampOffset`，上限取**半长**：起点往外走最多到中点，不会顶到终点那头。
   * ⚠️ 与 `edgeMidAnchor`（就地输入框，仍在中点）**仍然是两个锚点**，别合并。
   */
  const edgeStartAnchor = (edgeId: string | null) => {
    const anchors = edgeFlowAnchors(edgeId);
    if (!anchors) return null;
    const { endX, endY, fromX, fromY, outX, outY } = anchors;
    const step = clampOffset(EDGE_FLOAT_BACK, Math.hypot(endX - fromX, endY - fromY) / 2);
    const point = { x: fromX + outX * step, y: fromY + outY * step };
    return { x: viewport.x + point.x * viewport.zoom, y: viewport.y + point.y * viewport.zoom };
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
  /**
   * ★ 2026-10-07（**教师改主意**）：「出现在图形上方的删除按钮，位置可以放在图形区域的
   *   **左上角**，但**切记要压在图形的线条上**」。
   *
   * ⊘ 这推翻了上一版：原来是「框**上边缘上方** 28px」（`NODE_FLOAT_GAP`）—— 那颗按钮悬在框外，
   *   正好压住从上方下来的连线。
   * ✅ 「压在线上」= 圆心**正好落在左上角那个顶点**（一半在框内、一半在框外）。
   *   左边那条线与上边那条线在这一点相交 ⇒ 它压在**两条线**上。
   * ⚠️ 交点 / 普通框走**同一支**（交点也是一颗框），这里不许为它开特例。
   */
  const nodeFloatAnchor = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    /*
     * ★ 2026-10-07（教师，四张图）：删除按钮要压在**每种形状自己的左上那一点**上。
     * 🔴 这里原来一律取**外接框的左上角** —— 而那个角只有矩形落在轮廓上：
     *    菱形那个角在图形外面一大截、平行四边形的上边被 skew 推走了、胶囊的角在圆弧外
     *    （教师 2026-10-06 就说过「切记**要压在图形的线条上**」）。
     * ⚠️ 挑点这件事挪进了纯函数（`flowNodeCornerPoint`）—— 那里有一条判据**逐形状验
     *    「这个点在不在轮廓上」**（验轮廓，不验坐标数字）。
     */
    const point = flowNodeCornerPoint({
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? 150,
      height: node.measured?.height ?? 54,
    }, String(node.data?.kind ?? 'process'));
    return { x: viewport.x + point.x * viewport.zoom, y: viewport.y + point.y * viewport.zoom };
  };

  /**
   * ★ 第 1 步整理：**一处锚点解析** —— 选中的是框就取「框上边缘上方」，是线就取「终点（箭头那一端）」。
   * ⚠️ 交点与普通框走**同一支**（它也是一颗框），解析里不许为它开特例。
   */
  const selectedAnchor = (() => {
    if (!selected) return null;
    return selected.kind === 'edge' ? edgeStartAnchor(selected.id) : nodeFloatAnchor(selected.id);
  })();

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
    <div className={styles.thirdPartySurface} ref={rootRef}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="流程图工具">
        {/*
          四种图形的悬停名称使用信息科技课教材术语：起止框 / 处理框 / 判断框 / 输入输出框。
          🔴 **千万不要**把「按钮文字」与「新节点里默认写什么」统一起来 —— 这是**两件事**：
            · 按钮文字 = **形状的名字**（教材术语，学生按课本找得到）；
            · `addNode(kind, …)` 的**第二个参数** = 放到画布上以后**框里默认写的内容**
              （「开始/结束」「处理过程」「判断条件」「输入/输出」—— 那是**内容**，不是形状名）。
            ⇒ 把默认标签也改成「起止框」等于在流程图的框里写形状名，学生会把框里的字当成流程内容。
            ⚠️ 图标按钮的名称与节点默认内容仍是两套数据，不能合并。
        */}
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>添加图形</span>
          {([
            ['terminator', '开始/结束', '起止框'],
            ['process', '处理过程', '处理框'],
            ['decision', '判断条件', '判断框'],
            ['io', '输入/输出', '输入输出框'],
          ] as const).map(([kind, defaultLabel, label]) => (
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} key={kind} type="button" aria-label={label} data-tooltip={label} disabled={disabled} onClick={() => addNode(kind, defaultLabel)}>
              <FlowToolbarIcon name={kind} className={styles.drawingToolbarIcon} />
            </button>
          ))}
        </span>
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>排版</span>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="一键对齐" data-tooltip="一键对齐" disabled={disabled || nodes.length === 0} onClick={tidyLayout}><DrawingToolbarIcon name="tidy" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={styles.drawingToolbarSpacer} />
        {/* ★ 2026-10-06（教师最终拍板）：「恢复初始图」**无条件出现**（只要这一题有初始图）——
            它是**唯一**的回退路径（「锁定初始图」那一档撤掉之后，学生把底稿改乱了只能靠它回去）。
            🔴 出现条件里**不许**再出现任何锁标记（`starter && !starterLocked` 那种写法已经删掉）。 */}
        <span className={`${styles.drawingToolbarGroup} ${styles.drawingToolbarActions}`}>
          <span className={styles.drawingToolbarGroupLabel}>编辑记录</span>
          {starter && (
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="恢复初始图" data-tooltip="恢复初始图" disabled={disabled} onClick={restoreStarter}><DrawingToolbarIcon name="restore" className={styles.drawingToolbarIcon} /></button>
          )}
        {/*
          撤销 / 重做与其它工具一致使用纯图标，名称由悬停提示和 aria-label 提供。
          ⚠️ 禁用态读的是 `historyRef.current`（ref 不触发渲染）⇒ 靠 `historyVersion` 那个
          自增计数器把这次渲染带出来。`disabled`（回顾态）时无条件禁用。
        */}
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="撤销" data-tooltip="撤销" disabled={disabled || !canUndo(historyRef.current)} onClick={undo}><DrawingToolbarIcon name="undo" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="重做" data-tooltip="重做" disabled={disabled || !canRedo(historyRef.current)} onClick={redo}><DrawingToolbarIcon name="redo" className={styles.drawingToolbarIcon} /></button>
        </span>
        {labelableEdgeId && (
          <span className={`${styles.drawingToolbarGroup} ${styles.drawingToolbarContext}`}>
            <span className={styles.drawingToolbarGroupLabel}>连线文字</span>
            {['Y', 'N', '是', '否'].map((value) => (
              <button className={styles.drawingToolbarButton} key={value} type="button" disabled={disabled} onClick={() => setEdgeLabel(labelableEdgeId, value)}>{value}</button>
            ))}
            {/* ★ 2026-10-06（教师）：「可不可以用户加自定义的字？」——可以，直接在这一格里打。
                ⚠️ 它是**受控**的：值来自那条边自己（`edges.find`），所以切换线、清空、撤销
                都会跟着回到正确的内容，不会残留上一条线的字。
                ★ M1（审查留下的）：受控 + 每键写 store ⇒ 指纹一变就压一步，撤销时字**一个一个字地退**。
                ⇒ 打字期间先别记历史（`typingRef`，聚焦置位、失焦清位），整段打字合成一步。
                ⚠️ 别为了「好撤销」把它改成非受控 —— 上面那条理由（回到正确内容）比这个更重要。 */}
            <input
              className={styles.drawingToolbarEdgeLabel}
              type="text"
              maxLength={12}
              disabled={disabled}
              aria-label="这条线上的自定义文字"
              placeholder="自定义"
              onFocus={() => { typingRef.current = true; }}
              onBlur={() => { typingRef.current = false; }}
              value={editingLabel}
              onChange={(event) => setEdgeLabel(labelableEdgeId, event.target.value)}
            />
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarDanger}`} type="button" disabled={disabled} onClick={() => { setEdgeLabel(labelableEdgeId, ''); setSelected(null); }}>清空</button>
          </span>
        )}
        <span className={styles.drawingToolbarHint}>
          <strong className={styles.drawingToolbarHintLabel}>操作提示</strong>
          {selectedEdgeId
            ? '拖动线中圆点调整走向；拖动两端可重新连接'
            : '拖动图形；从任意连接点连线；双击文字修改'}
        </span>
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
          onConnectEnd={disabled ? undefined : onConnectEnd}
          // ⚠️ 这里**故意没有** `onNodeDragStart/Stop`：节点拖动的「正在拖」信号读的是节点自己的
          //    `dragging` 字段（详见上面那条变化检测 effect）—— 用回调置标记会在两条 abort 路径上
          //    漏掉，标记一旦卡死，整个会话都记不下新步骤（★ 审查发现 I1）。
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
        {/*
          ★ 2026-10-07（教师）：选中一条线时，折线上**还要出现一个控制柄**（删掉的是「拖动圆点
          调走向」那套自由浮层，这个是**长在折线上**的把手 —— 见 `FlowRouteHandle` 的注释）。
          ⚠️ 它必须住在 `.flowStage` 里面、排在 `</ReactFlow>` 之后，与下面那个 `overlay` 同一层：
          离了舞台就会按外层卡片定位。
          ⚠️ 正在改文字（`labelingEdge`）时不画：双击必然先触发一次单击，两个形态叠在一起会互相压住。
        */}
        {selectedEdgeId && !labelingEdge && (() => {
          const anchors = edgeFlowAnchors(selectedEdgeId);
          /*
           * 🔴 `track` 为 `null` ⇒ **不画把手**：两端句柄相邻（拐弯的边）时库压根不读绕行点，
           *    给了把手就是「拖了没反应」（教师刚报过的那类错）。宁可没有，也不给一个骗人的。
           */
          if (!anchors?.track) return null;
          return (
            <FlowRouteHandle
              edgeId={selectedEdgeId}
              /* ★ 锚点就是**那条画出来的路径**的中点 —— 把手与线同源，永远压在线上面。 */
              anchor={{ x: viewport.x + anchors.midX * viewport.zoom, y: viewport.y + anchors.midY * viewport.zoom }}
              track={anchors.track}
              disabled={disabled}
              onDragStateChange={setRouteDragging}
            />
          );
        })()}
        {/*
          ★ 2026-10-07（教师）：「线上文字……贴着线拖」。
          ⚠️ 只有**这条线上真有字**时才画：没有字就没有可拖的东西（双击线改字那条入口仍在）。
          ⚠️ 与控制柄同一层、同样住在 `.flowStage` 里面（离了舞台就会按外层卡片定位）。
        */}
        {selectedEdgeId && !labelingEdge && (() => {
          const anchors = edgeFlowAnchors(selectedEdgeId);
          const edge = edges.find((item) => item.id === selectedEdgeId);
          if (!anchors || !edge?.label) return null;
          return (
            <FlowLabelHandle
              edgeId={selectedEdgeId}
              /* ★ 锚点就是**标签画在哪**（与库收到的坐标同源）—— 把手与字同源，不会分家。 */
              anchor={{ x: viewport.x + anchors.labelX * viewport.zoom, y: viewport.y + anchors.labelY * viewport.zoom }}
              offset={anchors.labelOffset}
              /*
               * ⚠️ 命中区是**屏幕像素**（浮层不跟着画布缩放），而字宽是**流坐标** ⇒ 要乘缩放。
               *    不乘的话：放大到 2 倍时命中区只有字的一半宽（抓边上又掉到线上了）。
               */
              width={Math.max(44, (flowLabelWidth(String(edge.label)) + 10) * viewport.zoom)}
              disabled={disabled}
              onDragStateChange={setRouteDragging}
              onEdit={() => setLabelingEdge(selectedEdgeId)}
            />
          );
        })()}
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
            {/* ★ 2026-10-06（教师）：「改成一个小叉叉」—— 原来是垃圾桶。小圆的样式由
                `.flowEdgeFloat > svg` 那条规则给（命中区仍是 44px，见那里的注释）。 */}
            <DrawingToolbarIcon name="close" />
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
