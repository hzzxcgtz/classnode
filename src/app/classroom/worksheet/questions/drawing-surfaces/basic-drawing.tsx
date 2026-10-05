'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ReactSketchCanvas,
  type CanvasPath,
  type ReactSketchCanvasRef,
} from 'react-sketch-canvas';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

function readPaths(raw: unknown): CanvasPath[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const paths = (raw as Record<string, unknown>).paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((item): item is CanvasPath => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return Array.isArray(row.paths) && typeof row.strokeWidth === 'number'
      && typeof row.strokeColor === 'string' && typeof row.drawMode === 'boolean';
  });
}

export default function BasicDrawing({ data, backgroundUrl, disabled, onChange }: DrawingSurfaceProps) {
  const canvas = useRef<ReactSketchCanvasRef | null>(null);
  const initialPaths = useRef(readPaths(data));
  const [eraser, setEraser] = useState(false);
  const [color, setColor] = useState('#1f2937');
  const [width, setWidth] = useState(2);

  useEffect(() => {
    if (initialPaths.current.length > 0) void canvas.current?.loadPaths(initialPaths.current);
  }, []);

  const publish = async () => {
    const paths = await canvas.current?.exportPaths();
    if (paths) onChange({ paths });
  };

  const undo = () => {
    canvas.current?.undo();
    window.setTimeout(() => { void publish(); }, 0);
  };

  const redo = () => {
    canvas.current?.redo();
    window.setTimeout(() => { void publish(); }, 0);
  };

  const setEraseMode = (next: boolean) => {
    setEraser(next);
    canvas.current?.eraseMode(next);
  };

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="基础绘图工具">
        <button className={styles.drawingToolbarButton} type="button" aria-pressed={!eraser} disabled={disabled} onClick={() => setEraseMode(false)}>画笔</button>
        <button className={styles.drawingToolbarButton} type="button" aria-pressed={eraser} disabled={disabled} onClick={() => setEraseMode(true)}>橡皮</button>
        <label>颜色<input type="color" value={color} disabled={disabled} onChange={(event) => setColor(event.target.value)} /></label>
        <label>粗细<select value={width} disabled={disabled} onChange={(event) => setWidth(Number(event.target.value))}>
          <option value={1}>细</option><option value={2}>中</option><option value={4}>粗</option>
        </select></label>
        <span className={styles.drawingToolbarSpacer} />
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={undo}>撤销</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={redo}>重做</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => { canvas.current?.resetCanvas(); onChange({ paths: [] }); }}>清空</button>
      </div>
      <div className={styles.thirdPartyCanvas}>
        <ReactSketchCanvas
          ref={canvas}
          width="100%"
          height="100%"
          strokeColor={color}
          strokeWidth={width}
          eraserWidth={Math.max(8, width * 4)}
          backgroundImage={backgroundUrl ?? undefined}
          preserveBackgroundImageAspectRatio="none"
          exportWithBackgroundImage={false}
          readOnly={disabled}
          touchAction="none"
          onStroke={() => { void publish(); }}
          style={{ border: 0, borderRadius: 0 }}
        />
      </div>
    </div>
  );
}
