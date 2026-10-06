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
import {
  mergeFlowchart,
  readFlowchartPayload,
  subtractFlowchart,
  type DrawingStarter,
} from '@/lib/worksheet-drawing-starter.ts';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

type FlowKind = 'terminator' | 'process' | 'decision' | 'io';
type FlowData = { label: string; kind: FlowKind; locked?: boolean };
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
    // ★ B：底稿的节点**永远**是锁的（`disabled || 底稿`）—— 学生编辑时不能把它解锁。
    data: { ...node.data, locked: disabled || node.data.locked === true },
  })), [disabled, nodes]);

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="流程图工具">
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('terminator', '开始/结束')}>开始/结束</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('process', '处理过程')}>过程</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('decision', '判断条件')}>判断</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('io', '输入/输出')}>输入/输出</button>
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
      <div className={styles.thirdPartyCanvas} style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={disabled ? undefined : onNodesChange}
          onEdgesChange={disabled ? undefined : onEdgesChange}
          onConnect={disabled ? undefined : onConnect}
          onEdgeClick={(event, edge) => { event.stopPropagation(); setEditingEdge(edge.id); }}
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
