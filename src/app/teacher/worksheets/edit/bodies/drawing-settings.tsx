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
  /** 作答方式：`photo` = 学生拍照上传 ⇒ 这一页的画板相关设置全都不参与（见下面那段注释）。 */
  const photo = node.inputMode === 'photo';
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
      onNotice('画布底图已上传', 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '画布底图上传失败', 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  /**
   * ★ 2026-10-06（教师）：「学生作答方式选『照片上传』时，下面的作图工具、画布底图、底稿
   *   这些不相关的内容要隐藏起来」。
   *
   * 🔴 作答方式由**题目**上的 `inputMode` 决定（`question-card.tsx` 那三个单选：
   *    键盘输入 / 画板绘制 / 照片上传）。选了照片上传，学生根本不会打开画板 ⇒
   *    工具、底图、底稿三项一个都不参与。留着的坏处不只是占地方：教师会以为
   *    「我选的照片上传，怎么还让我配底图」—— 甚至配一张以为学生看得见。
   * ⚠️ 不留白板：留一句解释 + 指路（回去改作答方式），否则教师会以为面板坏了。
   */
  if (photo) {
    return (
      <div className="worksheet-editor-drawing-settings">
        <p className="worksheet-editor-drawing-note">
          这一题学生用<b>照片上传</b>作答，不会打开画板 ⇒ 作图工具、画布底图、底稿都已隐藏。
          想让学生在画板上画，把上面的作答方式改回<b>画板绘制</b>。
        </p>
      </div>
    );
  }

  const selectedTool = DRAWING_TOOL_OPTIONS.find(option => option.value === tool);
  const selectedBackground = background.preset === 'custom'
    ? { label: '自定义底图', description: '教师为这一题上传的专用底图' }
    : DRAWING_BACKGROUND_PRESETS.find(option => option.value === background.preset);

  return (
    <div className="worksheet-editor-drawing-settings">
      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-tool-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-tool-${node.id}`}>作图工具</h5>
            <p>每道绘图题使用一种工具。新建题目默认使用基础绘图。</p>
          </div>
        </div>
        {/*
          ★ 2026-10-06（教师）：「两个区域的 UI 要重新设计一下，更直观，而且不要占用太大的空间」
          ⇒ 每个选项**只留名字**（原来每张卡都顶着两行说明，一屏就满了），
            选中的那一项**在下面用一行说明**（信息没丢，只是不再重复 N 遍）。
        */}
        <div className="worksheet-editor-drawing-tools" role="radiogroup" aria-label="作图工具">
          {DRAWING_TOOL_OPTIONS.map(option => {
            const checked = tool === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className="worksheet-editor-drawing-tool"
                data-checked={checked ? '1' : '0'}
                onClick={() => selectTool(option.value)}
              >{option.label}</button>
            );
          })}
        </div>
        {selectedTool ? <p className="worksheet-editor-drawing-note">{selectedTool.description}</p> : null}
      </section>

      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-background-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-background-${node.id}`}>画布底图</h5>
            <p>底图只作为学生作图参照，不会合并进笔迹；上传图建议使用横向图片。</p>
          </div>
        </div>
        <div className="worksheet-editor-drawing-swatches">
          {DRAWING_BACKGROUND_PRESETS.map(option => {
            const checked = background.preset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className="worksheet-editor-drawing-swatch"
                data-checked={checked ? '1' : '0'}
                aria-pressed={checked}
                title={option.description}
                onClick={() => onDataChange({ drawingBackgroundPreset: option.value, drawingBackgroundImageUrl: undefined })}
              >
                <span className="worksheet-editor-drawing-swatch-preview" style={option.url ? { backgroundImage: `url(${option.url})` } : undefined} />
                <strong>{option.label}</strong>
              </button>
            );
          })}
          <button
            type="button"
            className="worksheet-editor-drawing-swatch is-custom"
            data-checked={background.preset === 'custom' ? '1' : '0'}
            aria-pressed={background.preset === 'custom'}
            disabled={uploading}
            title="上传数轴、示意图或这一题的专用底图"
            onClick={() => inputRef.current?.click()}
          >
            <span
              className="worksheet-editor-drawing-swatch-preview"
              style={background.preset === 'custom' && background.url
                ? { backgroundImage: `url(${worksheetAssetUrl(background.url)})` }
                : undefined}
            >{background.preset === 'custom' && background.url ? null : '+'}</span>
            <strong>{uploading ? '上传中…' : '自定义'}</strong>
          </button>
        </div>
        {selectedBackground ? <p className="worksheet-editor-drawing-note">{selectedBackground.description}</p> : null}
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
        ★ 2026-10-06（教师）：「底稿要设一个开关，选择要不要设置底稿」。
        ⇒ 一个勾选框决定这一题有没有底稿：
          · 勾上 ⇒ 先落一份**空底稿**（`{nodes:[],edges:[]}`）让开关立刻生效、画板立刻出现，
            画板自己的 `onChange` 会把它填成教师画的那张图；
          · 取消 ⇒ **清掉底稿**（学生在空画板上从零开始）。
        ⚠️ 已经有底稿时取消会先问一句 —— 编辑器没有撤销，一次误点就丢一张图。
        ⚠️ 画板必须有一个**量得出高度**的容器（它靠容器尺寸初始化；`scale(0)` 与
          `overflowHidden` 那两个坑就是这么来的）⇒ 外面那层给死高度。
        ⚠️ 现在只有**流程图**这一档接好了（教师：「先拿流程图当试点」）——与其给一个
          画不了东西的空框，不如把话说清楚。
      */}
      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-starter-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-starter-${node.id}`}>底稿</h5>
          </div>
          <label className="worksheet-editor-drawing-switch">
            <input
              type="checkbox"
              checked={!!starter}
              onChange={(event) => {
                if (!event.target.checked) {
                  if (starter && !window.confirm('取消底稿会清掉已经画好的内容，确定吗？')) return;
                  onDataChange({ drawingStarter: undefined });
                  return;
                }
                onDataChange({ drawingStarter: { tool: 'flowchart', data: { nodes: [], edges: [] } } });
              }}
            />
            <span>让学生在这张底稿上继续画</span>
          </label>
        </div>
        {starter ? (
          tool === 'flowchart' ? (
            <>
              <p className="worksheet-editor-drawing-note">
                {/* ★ 2026-10-06：原来这里还有前半句「学生在下面这张图上继续画」——
                    与上面那个开关标签（「让学生在这张底稿上继续画」）同义 ⇒ 只留后半句。 */}
                <b>底稿不能改也不能删</b>，而且<b>不计入他的作答</b>。
              </p>
              <div style={{ height: 380, border: '1px solid #e4ecf4', borderRadius: 10, overflow: 'hidden' }}>
                <FlowchartDrawing
                  data={starter.tool === 'flowchart' ? starter.data : undefined}
                  backgroundUrl={starterBackgroundUrl}
                  disabled={false}
                  onChange={(next: unknown) => onDataChange({ drawingStarter: { tool: 'flowchart', data: next } })}
                />
              </div>
            </>
          ) : (
            <p className="worksheet-editor-drawing-note">
              底稿目前只支持<b>流程图</b>；把上面的作图工具改成流程图就能在这里画。
            </p>
          )
        ) : (
          <p className="worksheet-editor-drawing-note">不设底稿时，学生在空画板上从零开始画。</p>
        )}
      </section>
    </div>
  );
}
