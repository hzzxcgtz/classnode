'use client';

import { useRef, useState } from 'react';

import { api } from '@/lib/api';
import {
  DRAWING_BACKGROUND_PRESETS,
  DRAWING_TOOL_OPTIONS,
  readDrawingBackground,
  readDrawingTool,
  type DrawingMode,
} from '@/lib/worksheet-drawing';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import type { WorksheetQuestionNode } from '@/lib/types';

export function DrawingSettings({ node, onDataChange, onNotice }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  onNotice: (message: string, type: 'success' | 'error') => void;
}) {
  const tool = readDrawingTool(node);
  const background = readDrawingBackground(node);
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
    </div>
  );
}
