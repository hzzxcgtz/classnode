'use client';

import { useRef, useState } from 'react';

// ⚠️ 学生端那块画板是**默认导出**（我们直接复用它，而不是再写一份）。
import FlowchartDrawing from '@/app/classroom/worksheet/questions/drawing-surfaces/flowchart-drawing';
import { api } from '@/lib/api';
import {
  DRAWING_BACKGROUND_PRESETS,
  DRAWING_TOOL_OPTIONS,
  readDrawingBackground,
  readDrawingTool,
  type DrawingMode,
} from '@/lib/worksheet-drawing';
import { readDrawingStarter } from '@/lib/worksheet-drawing-starter';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import type { WorksheetQuestionNode } from '@/lib/types';

export function DrawingSettings({ node, onDataChange, onNotice }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  onNotice: (message: string, type: 'success' | 'error') => void;
}) {
  const tool = readDrawingTool(node);
  const background = readDrawingBackground(node);
  const starter = readDrawingStarter(node);
  /**
   * 底稿画板用的底图，与学生在同一道题上看到的**一致**：
   * 预设档是站内公开资源（原样用），自定义上传要走 `worksheetAssetUrl`（它会补上 API 前缀）。
   */
  const starterBackgroundUrl = background.url
    ? (background.preset === 'custom' ? worksheetAssetUrl(background.url) : background.url)
    : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const selectTool = (value: DrawingMode) => {
    onDataChange({ drawingTool: value, drawingExtensions: undefined });
  };

  const uploadBackground = async (file: File) => {
    setUploading(true);
    try {
      const result = await api.uploadWorksheetImage(file);
      onDataChange({ drawingBackgroundPreset: 'custom', drawingBackgroundImageUrl: result.url });
      onNotice('绘图底图已上传', 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '绘图底图上传失败', 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="worksheet-editor-drawing-settings">
      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-tool-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-tool-${node.id}`}>作图工具</h5>
            <p>每道绘图题使用一种工具。新建题目默认使用基础绘图。</p>
          </div>
        </div>
        <div className="worksheet-editor-drawing-extension-list" role="radiogroup" aria-label="作图工具">
          {DRAWING_TOOL_OPTIONS.map(option => {
            const checked = tool === option.value;
            return (
              <label key={option.value} className="worksheet-editor-drawing-extension" data-checked={checked ? '1' : '0'}>
                <input type="radio" name={`drawing-tool-${node.id}`} checked={checked} onChange={() => selectTool(option.value)} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-background-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-background-${node.id}`}>画布底图</h5>
            <p>底图只作为学生作图参照，不会合并进笔迹；上传图建议使用横向图片。</p>
          </div>
        </div>
        <div className="worksheet-editor-drawing-backgrounds">
          {DRAWING_BACKGROUND_PRESETS.map(option => {
            const checked = background.preset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className="worksheet-editor-drawing-background"
                data-checked={checked ? '1' : '0'}
                aria-pressed={checked}
                onClick={() => onDataChange({ drawingBackgroundPreset: option.value, drawingBackgroundImageUrl: undefined })}
              >
                <span className="worksheet-editor-drawing-background-preview" style={option.url ? { backgroundImage: `url(${option.url})` } : undefined} />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </button>
            );
          })}
          <button
            type="button"
            className="worksheet-editor-drawing-background is-custom"
            data-checked={background.preset === 'custom' ? '1' : '0'}
            aria-pressed={background.preset === 'custom'}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <span
              className="worksheet-editor-drawing-background-preview"
              style={background.preset === 'custom' && background.url
                ? { backgroundImage: `url(${worksheetAssetUrl(background.url)})` }
                : undefined}
            >{background.preset === 'custom' && background.url ? null : '+'}</span>
            <span><strong>{uploading ? '正在上传…' : '自定义底图'}</strong><small>上传数轴、示意图或题目专用底图</small></span>
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadBackground(file);
          }}
        />
      </section>

      {/*
        ★ 2026-10-06（教师）：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」。
        教师用**与学生同一块画板**摆一张不完整的流程图 ⇒ 学生打开时接着画。

        三条决定（逐字见 `@/lib/worksheet-drawing-starter` 的注释）：
          · 试点只有流程图这一档（其它两档的学生端还没接，给出来就是骗人 ⇒ 这里 `tool === 'flowchart'` 才显示）；
          · **A 底稿不算学生的作答** ⇒ 学生交上去的只有他自己画的；
          · **B 学生不能改/删底稿** ⇒ 学生端把它锁住（不能拖、不能删、文字只读）。
        ⚠️ 画板必须有一个**量得出高度**的容器（它靠容器尺寸初始化；`scale(0)` 与 `overflowHidden`
          那两个坑就是这么来的）⇒ 外面那层给死高度。
      */}
      {tool === 'flowchart' && (
        <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-starter-${node.id}`}>
          <div className="worksheet-editor-drawing-heading">
            <div>
              <h5 id={`drawing-starter-${node.id}`}>底稿（可选）</h5>
              <p>在这里画一张不完整的流程图，学生打开后接着画。学生<b>不能修改或删除</b>底稿，底稿也<b>不计入他的作答</b>。</p>
            </div>
            {starter ? (
              <button
                type="button"
                onClick={() => onDataChange({ drawingStarter: undefined })}
                style={{ minHeight: 36, padding: '0 12px', borderRadius: 9, border: '1px solid #dde6f0', background: '#fff', fontWeight: 650, cursor: 'pointer' }}
              >清空底稿</button>
            ) : null}
          </div>
          <div style={{ height: 380, border: '1px solid #e4ecf4', borderRadius: 10, overflow: 'hidden' }}>
            <FlowchartDrawing
              data={starter?.tool === 'flowchart' ? starter.data : undefined}
              backgroundUrl={starterBackgroundUrl}
              disabled={false}
              onChange={(next: unknown) => onDataChange({ drawingStarter: { tool: 'flowchart', data: next } })}
            />
          </div>
        </section>
      )}
    </div>
  );
}
