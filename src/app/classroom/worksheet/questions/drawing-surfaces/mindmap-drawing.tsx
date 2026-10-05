'use client';

import { useEffect, useRef } from 'react';
import MindElixir from 'mind-elixir';
import type { MindElixirData, MindElixirInstance } from 'mind-elixir';
import 'mind-elixir/style.css';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

function readMindData(raw: unknown): MindElixirData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return row.nodeData && typeof row.nodeData === 'object' ? raw as MindElixirData : null;
}

export default function MindmapDrawing({ data, backgroundUrl, disabled, onChange }: DrawingSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const mind = useRef<MindElixirInstance | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = new MindElixir({
      el: host.current,
      direction: MindElixir.SIDE,
      editable: !disabled,
      contextMenu: false,
      toolBar: false,
      keypress: !disabled,
      allowUndo: true,
      overflowHidden: true,
      mobileMultiSelect: false,
      newTopicName: '新主题',
      theme: {
        ...MindElixir.THEME,
        name: 'ClassNode',
        palette: ['#527198', '#6b86a5', '#7893b1', '#879db8', '#607d9e', '#7590ad'],
        cssVar: {
          ...MindElixir.THEME.cssVar,
          '--main-color': '#27415f',
          '--main-bgcolor': '#eef3f8',
          '--color': '#24364b',
          '--bgcolor': backgroundUrl ? 'transparent' : '#ffffff',
          '--selected': '#527198',
          '--accent-color': '#527198',
          '--root-color': '#ffffff',
          '--root-bgcolor': '#527198',
          '--root-radius': '12px',
          '--main-radius': '10px',
        },
      },
    });
    instance.init(readMindData(data) ?? MindElixir.new('中心主题'));
    if (disabled) instance.disableEdit();
    const publish = () => onChange(instance.getData());
    instance.bus.addListener('operation', publish);
    mind.current = instance;
    window.setTimeout(() => instance.scaleFit(), 0);
    return () => {
      instance.bus.removeListener('operation', publish);
      instance.destroy();
      mind.current = null;
    };
  // 第三方实例只挂载一次；作答恢复值是初始输入，后续变化由实例自身维护。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="思维导图工具">
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => mind.current?.addChild()}>添加子主题</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => mind.current?.insertSibling('after')}>添加同级主题</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => mind.current?.undo()}>撤销</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => mind.current?.redo()}>重做</button>
        <span className={styles.drawingToolbarSpacer} />
        <button className={styles.drawingToolbarButton} type="button" onClick={() => mind.current?.scaleFit()}>适应画布</button>
        <button className={styles.drawingToolbarButton} type="button" onClick={() => mind.current?.toCenter()}>回到中心</button>
      </div>
      <div
        ref={host}
        className={`${styles.thirdPartyCanvas} ${styles.mindmapCanvas} ${backgroundUrl ? styles.mindmapCanvasWithBackground : ''}`}
        style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
      />
    </div>
  );
}
