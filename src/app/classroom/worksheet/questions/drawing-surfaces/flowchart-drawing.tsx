'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

type FlowKind = 'terminator' | 'process' | 'decision' | 'io';
type FlowData = { label: string; kind: FlowKind; locked?: boolean };
type FlowNode = Node<FlowData>;

function FlowNodeEditor({ id, data, selected }: NodeProps<FlowNode>) {
  const instance = useReactFlow<FlowNode, Edge>();
  const textWidth = Math.min(30, Math.max(10, Array.from(data.label).length + 2));
  return (
    <div className={`${styles.flowNode} ${styles[`flowNode_${data.kind}`]}`} data-selected={selected ? '1' : '0'}>
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

function FlowchartEditor({ data, backgroundUrl, disabled, onChange }: DrawingSurfaceProps) {
  const initial = useRef(readFlowData(data));
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.current.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.current.edges);
  const initialized = useRef(false);
  const nodeTypes = useMemo(() => ({ flow: FlowNodeEditor }), []);

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    const timer = window.setTimeout(() => {
      onChange({
        nodes: nodes.map(({ id, type, position, data: nodeData }) => ({
          id,
          type,
          position,
          data: { label: nodeData.label, kind: nodeData.kind },
        })),
        edges: edges.map(({ id, source, target, sourceHandle, targetHandle, type }) => ({ id, source, target, sourceHandle, targetHandle, type })),
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, onChange]);

  const addNode = (kind: FlowKind, label: string) => {
    const offset = nodes.length * 26;
    setNodes((current) => [...current, {
      id: `node-${Date.now()}-${current.length}`,
      type: 'flow',
      position: { x: 80 + offset, y: 70 + offset },
      data: { label, kind },
    }]);
  };
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
  }, [setEdges]);
  const visibleNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: { ...node.data, locked: disabled },
  })), [disabled, nodes]);

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="流程图工具">
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('terminator', '开始/结束')}>开始/结束</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('process', '处理过程')}>过程</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('decision', '判断条件')}>判断</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => addNode('io', '输入/输出')}>输入/输出</button>
        <span className={styles.drawingToolbarHint}>从圆形连接点拖向另一节点即可连线</span>
      </div>
      <div className={styles.thirdPartyCanvas} style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
        <ReactFlow
          nodes={visibleNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={disabled ? undefined : onNodesChange}
          onEdgesChange={disabled ? undefined : onEdgesChange}
          onConnect={disabled ? undefined : onConnect}
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
