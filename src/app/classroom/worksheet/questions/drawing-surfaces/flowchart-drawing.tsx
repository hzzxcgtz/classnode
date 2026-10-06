'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
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
  type Node,
  MarkerType,
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

type FlowKind = 'terminator' | 'process' | 'decision' | 'io';
type FlowData = { label: string; kind: FlowKind; locked?: boolean };

/**
 * 工具按钮上的**形状图标**（★ 2026-10-06 教师：「分别加上一个形象的图形表示」）。
 * 画的正是这个按钮会放下的那个节点形状 —— 学生看一眼就知道按下去会得到什么，
 * 不必先读「平行四边形」这四个字。
 * ⚠️ 与 `worksheet-flowchart-svg.ts`（快照）里那几种形状**同源**：胶囊 / 矩形 / 菱形 / 平行四边形。
 */
const FLOW_ICONS: Record<FlowKind | 'restore' | 'trash', string> = {
  terminator: 'M7 5.5h10a4.5 4.5 0 0 1 0 9H7a4.5 4.5 0 0 1 0-9Z',
  process: 'M4 6.5h16v11H4Z',
  decision: 'M12 3.6 20.4 12 12 20.4 3.6 12Z',
  io: 'M8 6.5h12l-4 11H4Z',
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
  return (
    <div className={`${styles.flowNode} ${styles[`flowNode_${data.kind}`]}`} data-selected={selected ? '1' : '0'}>
      {/* ★ 2026-10-06（教师）：「判断框怎么这个形状？」——菱形改成**画出来的**（原来是旋转 45° 的方块）。
          ⚠️ `overflow: visible` 不需要：这块 SVG 撑满盒子，四个顶点正好是四个连接点。 */}
      {data.kind === 'decision' && (
        <svg className={styles.flowNodeShape} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="50,1.5 98.5,50 50,98.5 1.5,50" fill="#fff" stroke="#7895b3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <input
        className="nodrag"
        aria-label="节点文字"
        value={data.label}
        disabled={data.locked}
        style={{ width: `${textWidth}em` }}
        onChange={(event) => instance.updateNodeData(id, { label: event.target.value })}
      />
    </div>
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
   */
  const visibleEdges = useMemo(
    () => edges.map((edge) => (edge.markerEnd ? edge : { ...edge, markerEnd: FLOW_ARROW })),
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
   * 选中/双击那条线的中点，换算成**容器内**坐标（浮层按钮与就地输入框都摆在这儿）。
   * ⚠️ 取的是**两个节点中心的中点**，不是折线的真实中点 —— 浮层只需要「落在这条线附近」，
   *    而折线的真实中点要复刻 `smoothstep` 的路径算法（多一份真源，迟早跟库的算法分叉）。
   */
  const edgeAnchor = (edgeId: string | null) => {
    if (!edgeId) return null;
    const edge = edges.find((item) => item.id === edgeId);
    const source = nodes.find((item) => item.id === edge?.source);
    const target = nodes.find((item) => item.id === edge?.target);
    if (!edge || !source || !target) return null;
    const centerOf = (node: FlowNode) => {
      const width = node.measured?.width ?? 150;
      const height = node.measured?.height ?? 54;
      return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
    };
    const a = centerOf(source);
    const b = centerOf(target);
    const flowX = (a.x + b.x) / 2;
    const flowY = (a.y + b.y) / 2;
    return { x: viewport.x + flowX * viewport.zoom, y: viewport.y + flowY * viewport.zoom };
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
   */
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => {
      const source = nodes.find((node) => node.id === connection.source);
      let label: string | undefined;
      if (source?.data.kind === 'decision') {
        const used = current.filter((edge) => edge.source === connection.source && edge.label).length;
        label = used === 0 ? 'Y' : used === 1 ? 'N' : undefined;
      }
      return addEdge({ ...connection, type: 'smoothstep', ...(label ? { label } : {}) }, current);
    });
  }, [nodes, setEdges]);

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

        {/*
          ★ 2026-10-06（教师）：「要求点击可以选中连接线，会跳出一个图标型的删除按钮，可删除连接线；
          双击线条可以输入/修改连接线上的文字。」
          ⚠️ 两个浮层都用 `edgeAnchor()` 换算成**容器内坐标**（视口由 `onMove` 跟）。
          ⚠️ 正在改文字时**不显示**删除按钮：双击必然先触发一次单击，两个浮层叠在一起会互相压住。
        */}
        {editingEdge && !labelingEdge && edgeAnchor(editingEdge) && (
          <button
            className={styles.flowEdgeFloat}
            type="button"
            disabled={disabled}
            aria-label="删除这条连线"
            title="删除这条连线"
            style={{ left: edgeAnchor(editingEdge)!.x, top: edgeAnchor(editingEdge)!.y }}
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
            <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => { setEdgeLabel(editingEdge, ''); setEditingEdge(null); }}>清空</button>
          </>
        )}
      </div>
      <div className={`${styles.thirdPartyCanvas} ${styles.flowStage}`} style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
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
      </div>
    </div>
  );
}

export default function FlowchartDrawing(props: DrawingSurfaceProps) {
  return <ReactFlowProvider><FlowchartEditor {...props} /></ReactFlowProvider>;
}

/** 流程图的边统一用这个箭头（与快照 SVG 里的 `marker-end` 同一形状）。 */
const FLOW_ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#6b86a5' } as const;
