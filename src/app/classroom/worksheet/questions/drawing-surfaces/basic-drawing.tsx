'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ReactSketchCanvas,
  type CanvasPath,
  type ReactSketchCanvasRef,
} from 'react-sketch-canvas';

import { dataUrlToBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';

import type { DrawingSurfaceProps } from './types';
import DrawingToolbarIcon from './drawing-toolbar-icon';
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

export default function BasicDrawing({ data, backgroundUrl, disabled, onChange, onImage }: DrawingSurfaceProps) {
  const canvas = useRef<ReactSketchCanvasRef | null>(null);
  const initialPaths = useRef(readPaths(data));
  const [eraser, setEraser] = useState(false);
  const [color, setColor] = useState('#1f2937');
  const [width, setWidth] = useState(2);
  const usesInfiniteDotGrid = typeof backgroundUrl === 'string'
    && backgroundUrl.split(/[?#]/, 1)[0].endsWith('/worksheet/drawing-backgrounds/dot-grid.svg');

  useEffect(() => {
    if (initialPaths.current.length > 0) void canvas.current?.loadPaths(initialPaths.current);
  }, []);

  /** 位图快照：`exportImage` 吐的是 base64 data URL（`react-sketch-canvas` 的签名如此）。 */
  const scheduleRaster = useDrawingRaster({
    capture: async () => {
      const dataUrl = await canvas.current?.exportImage('png');
      return dataUrl ? dataUrlToBlob(dataUrl) : null;
    },
    onUrl: onImage,
  });

  const publish = async () => {
    const paths = await canvas.current?.exportPaths();
    if (paths) {
      onChange({ paths });
      // ⚠️ 排在 `onChange` **之后**：抓图是异步的，先抓后写会让「这次改动」还没进作答，
      //    快照就已经按新内容生成了 —— 那两张永远差一拍。
      scheduleRaster();
    }
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
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>绘制</span>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="画笔" data-tooltip="画笔" aria-pressed={!eraser} disabled={disabled} onClick={() => setEraseMode(false)}><DrawingToolbarIcon name="pencil" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="橡皮" data-tooltip="橡皮" aria-pressed={eraser} disabled={disabled} onClick={() => setEraseMode(true)}><DrawingToolbarIcon name="eraser" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>笔触</span>
          <label>颜色<input type="color" value={color} disabled={disabled} aria-label="画笔颜色" onChange={(event) => setColor(event.target.value)} /></label>
          <label>粗细<select value={width} disabled={disabled} aria-label="画笔粗细" onChange={(event) => setWidth(Number(event.target.value))}>
            <option value={1}>细</option><option value={2}>中</option><option value={4}>粗</option>
          </select></label>
        </span>
        <span className={`${styles.drawingToolbarGroup} ${styles.drawingToolbarActions}`}>
          <span className={styles.drawingToolbarGroupLabel}>编辑记录</span>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="撤销" data-tooltip="撤销" disabled={disabled} onClick={undo}><DrawingToolbarIcon name="undo" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="重做" data-tooltip="重做" disabled={disabled} onClick={redo}><DrawingToolbarIcon name="redo" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton} ${styles.drawingToolbarDanger}`} type="button" aria-label="清空" data-tooltip="清空" disabled={disabled} onClick={() => { canvas.current?.resetCanvas(); onChange({ paths: [] }); }}><DrawingToolbarIcon name="clear" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={styles.drawingToolbarHint}>
          <strong className={styles.drawingToolbarHintLabel}>操作提示</strong>
          选择画笔或橡皮后直接在画布上拖动
        </span>
      </div>
      <div className={styles.thirdPartyCanvas} data-infinite-dot-grid={usesInfiniteDotGrid ? 'true' : undefined}>
        <ReactSketchCanvas
          ref={canvas}
          width="100%"
          height="100%"
          strokeColor={color}
          strokeWidth={width}
          eraserWidth={Math.max(8, width * 4)}
          backgroundImage={backgroundUrl && !usesInfiniteDotGrid ? backgroundUrl : undefined}
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
