'use client';

import { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

type MathTool = 'point' | 'segment' | 'line' | 'arrow' | 'circle';
type PairKind = Exclude<MathTool, 'point' | 'circle'>;
type MathEntry =
  | { kind: 'point'; p: [number, number] }
  | { kind: PairKind; a: [number, number]; b: [number, number] }
  | { kind: 'circle'; center: [number, number]; edge: [number, number] };
type RuntimeEntry = { kind: MathEntry['kind']; points: JXG.Point[]; objects: JXG.GeometryElement[] };

function readEntries(raw: unknown): MathEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const entries = (raw as Record<string, unknown>).elements;
  if (!Array.isArray(entries)) return [];
  const pair = (value: unknown): value is [number, number] => Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === 'number' && Number.isFinite(part));
  return entries.filter((entry): entry is MathEntry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    if (row.kind === 'point') return pair(row.p);
    if (row.kind === 'circle') return pair(row.center) && pair(row.edge);
    return (row.kind === 'segment' || row.kind === 'line' || row.kind === 'arrow')
      && pair(row.a) && pair(row.b);
  });
}

export default function MathDrawing({ data, backgroundUrl, disabled, onChange }: DrawingSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<JXG.Board | null>(null);
  const runtime = useRef<RuntimeEntry[]>([]);
  const pending = useRef<{ tool: MathTool; point: JXG.Point } | null>(null);
  const [tool, setTool] = useState<MathTool>('point');
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    if (!host.current) return;
    const board = JXG.JSXGraph.initBoard(host.current, {
      boundingbox: [-10, 8, 10, -8],
      axis: true,
      grid: true,
      keepaspectratio: true,
      showCopyright: false,
      showNavigation: false,
      pan: { enabled: !disabled },
      zoom: { wheel: !disabled },
    });
    boardRef.current = board;
    const pointAttrs = { size: 3, strokeColor: '#527198', fillColor: '#ffffff', fixed: disabled, name: '' };
    const lineAttrs = { strokeColor: '#365b82', strokeWidth: 2, fixed: disabled };

    const addEntry = (entry: MathEntry) => {
      if (entry.kind === 'point') {
        const p = board.create('point', entry.p, pointAttrs) as JXG.Point;
        runtime.current.push({ kind: entry.kind, points: [p], objects: [p] });
        return;
      }
      const first = entry.kind === 'circle' ? entry.center : entry.a;
      const second = entry.kind === 'circle' ? entry.edge : entry.b;
      const a = board.create('point', first, pointAttrs) as JXG.Point;
      const b = board.create('point', second, pointAttrs) as JXG.Point;
      const shapeType = entry.kind === 'circle' ? 'circle' : entry.kind;
      const shape = board.create(shapeType, [a, b], lineAttrs) as JXG.GeometryElement;
      runtime.current.push({ kind: entry.kind, points: [a, b], objects: [a, b, shape] });
    };
    readEntries(data).forEach(addEntry);

    const snapshot = (): MathEntry[] => runtime.current.map((item) => {
      const a: [number, number] = [item.points[0].X(), item.points[0].Y()];
      if (item.kind === 'point') return { kind: 'point', p: a };
      const b: [number, number] = [item.points[1].X(), item.points[1].Y()];
      if (item.kind === 'circle') return { kind: 'circle', center: a, edge: b };
      return { kind: item.kind, a, b };
    });
    const publish = () => onChange({ elements: snapshot() });
    const handleDown = (event: PointerEvent) => {
      if (disabled) return;
      // 拖动既有控制点时 JSXGraph 同样会发出 down；此时只让内核处理拖动，不能再新建图形。
      if (board.getAllObjectsUnderMouse(event).length > 0) return;
      const coords = board.getUsrCoordsOfMouse(event);
      const at: [number, number] = [coords[0], coords[1]];
      const currentTool = toolRef.current;
      if (currentTool === 'point') {
        addEntry({ kind: 'point', p: at });
        publish();
        return;
      }
      if (!pending.current || pending.current.tool !== currentTool) {
        if (pending.current) board.removeObject(pending.current.point);
        pending.current = { tool: currentTool, point: board.create('point', at, pointAttrs) as JXG.Point };
        return;
      }
      const first: [number, number] = [pending.current.point.X(), pending.current.point.Y()];
      board.removeObject(pending.current.point);
      pending.current = null;
      addEntry(currentTool === 'circle'
        ? { kind: 'circle', center: first, edge: at }
        : { kind: currentTool, a: first, b: at });
      publish();
    };
    board.on('down', handleDown);
    board.on('up', publish);
    return () => {
      JXG.JSXGraph.freeBoard(board);
      boardRef.current = null;
      runtime.current = [];
      pending.current = null;
    };
  // 第三方画板只挂载一次，工具通过 ref 读取，避免切工具时销毁学生已画内容。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseTool = (next: MathTool) => {
    const board = boardRef.current;
    if (board && pending.current) board.removeObject(pending.current.point);
    pending.current = null;
    setTool(next);
  };
  const clear = () => {
    const board = boardRef.current;
    if (!board) return;
    runtime.current.forEach((entry) => entry.objects.forEach((object) => board.removeObject(object)));
    runtime.current = [];
    onChange({ elements: [] });
  };

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="数学作图工具">
        {([
          ['point', '点'], ['segment', '线段'], ['line', '直线'], ['arrow', '射线'], ['circle', '圆'],
        ] as const).map(([value, label]) => (
          <button className={styles.drawingToolbarButton} key={value} type="button" aria-pressed={tool === value} disabled={disabled} onClick={() => chooseTool(value)}>{label}</button>
        ))}
        <span className={styles.drawingToolbarHint}>{tool === 'point' ? '点击画板添加点' : '依次点击两个位置完成图形'}</span>
        <span className={styles.drawingToolbarSpacer} />
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={clear}>清空</button>
      </div>
      <div
        ref={host}
        className={`${styles.thirdPartyCanvas} ${styles.mathCanvas}`}
        style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
      />
    </div>
  );
}
