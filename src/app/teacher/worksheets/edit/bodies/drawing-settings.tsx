'use client';

import { useRef, useState } from 'react';

// ⚠️ 学生端那块画板是**默认导出**（我们直接复用它，而不是再写一份）。
import FlowchartDrawing from '@/app/classroom/worksheet/questions/drawing-surfaces/flowchart-drawing';
import MathDrawing from '@/app/classroom/worksheet/questions/drawing-surfaces/math-drawing';
import MindmapDrawing from '@/app/classroom/worksheet/questions/drawing-surfaces/mindmap-drawing';
import { api } from '@/lib/api';
import {
  DRAWING_TOOL_OPTIONS,
  readDrawingBackground,
  readDrawingTool,
  type DrawingMode,
} from '@/lib/worksheet-drawing';
import { blankStarterFor, readDrawingStarter } from '@/lib/worksheet-drawing-starter';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import type { WorksheetQuestionNode } from '@/lib/types';
import { EditorIcon } from '../editor-icons';

/**
 * ★ 2026-10-07：思维导图的**空底稿**（只有中心主题）。
 *
 * 🔴 形状照 `MindElixir.new()` 的那一份（`{ nodeData: { id, topic, children } }`）——
 *   少一个 `nodeData` 的话学生端 `readMindMapPayload` 读不出来，**等于没底稿**
 *   （而面板上那个开关却是开着的：教师以为设好了，学生那边什么都没有）。
 * ⚠️ `id` 用固定值：它只需**在这张画布内**唯一 —— 库给学生新增的节点生成的是
 *   16 位随机串（`dist/MindElixir.js` 的 `X()`），不会撞上这个名字。
 */
/** 画板的中文名（「这张底稿属于哪一档」那句话要用它，别把 `mind-map` 这种内部值摆给教师看）。 */
function toolLabelOf(tool: string): string {
  return DRAWING_TOOL_OPTIONS.filter((option) => option.value === tool)[0]?.label ?? tool;
}

export function DrawingSettings({ node, onDataChange, onNotice }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  onNotice: (message: string, type: 'success' | 'error') => void;
}) {
  const tool = readDrawingTool(node);
  const background = readDrawingBackground(node);
  const starter = readDrawingStarter(node);
  /** ★ 2026-10-07：这一档能不能有初始图（判据在 `blankStarterFor`，不在这一屏）。 */
  const starterSupported = blankStarterFor(tool) !== null;
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
          照片模式不使用作图工具和初始图。
        </p>
      </div>
    );
  }

  const selectedTool = DRAWING_TOOL_OPTIONS.find(option => option.value === tool);
  return (
    <div className="worksheet-editor-drawing-settings">
      <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-tool-${node.id}`}>
        <div className="worksheet-editor-drawing-heading">
          <div>
            <h5 id={`drawing-tool-${node.id}`}><EditorIcon kind="tool" />作图工具</h5>
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

      {tool === 'math' ? (
        <section className="worksheet-editor-drawing-section" aria-labelledby={`drawing-background-${node.id}`}>
          <div className="worksheet-editor-drawing-heading">
            <div>
              <h5 id={`drawing-background-${node.id}`}><EditorIcon kind="background" />图片底图</h5>
              <p>可上传题图作为不可修改的底层；学生只能在图片上方作答。</p>
            </div>
          </div>
          <div className="worksheet-editor-drawing-swatches">
            <button
              type="button"
              className="worksheet-editor-drawing-swatch is-custom"
              data-checked={background.preset === 'custom' ? '1' : '0'}
              aria-pressed={background.preset === 'custom'}
              disabled={uploading}
              title="上传本题的图片底图"
              onClick={() => inputRef.current?.click()}
            >
              <span
                className="worksheet-editor-drawing-swatch-preview"
                style={background.preset === 'custom' && background.url
                  ? { backgroundImage: `url(${worksheetAssetUrl(background.url)})` }
                  : { backgroundImage: 'url(/worksheet/drawing-backgrounds/dot-grid.svg)' }}
              />
              <strong>{uploading ? '上传中…' : background.preset === 'custom' ? '更换图片' : '上传图片'}</strong>
            </button>
            {background.preset === 'custom' ? (
              <button
                type="button"
                className="worksheet-editor-drawing-tool"
                onClick={() => onDataChange({ drawingBackgroundPreset: undefined, drawingBackgroundImageUrl: undefined })}
              >移除图片</button>
            ) : null}
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
      ) : null}

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
            <h5 id={`drawing-starter-${node.id}`}><EditorIcon kind="starter" />初始图</h5>
          </div>
          <label className="worksheet-editor-drawing-switch">
            {/* ★ 教师澄清 3：「要使用开关按钮，不要使用复选框」⇒ `role="switch"` + 自己画轨道
                （外观见 globals.css 的 `.worksheet-editor-drawing-switch input[role='switch']`）。 */}
            <input
              type="checkbox"
              role="switch"
              checked={!!starter}
              /*
               * ★ 2026-10-07：这一档不支持初始图、而且题目上也没有旧底稿可关 ⇒ **禁用**。
               * ⚠️ 有旧底稿时**必须仍可点**（哪怕它属于别的画板）—— 那是教师**唯一**能把它清掉的地方，
               *   禁掉就等于留了一份他自己删不掉的脏数据。
               */
              disabled={!starterSupported && !starter}
              title={starterSupported ? undefined : '这一档还不支持初始图'}
              onChange={(event) => {
                if (!event.target.checked) {
                  if (starter && !window.confirm('清掉初始图会丢掉已经画好的内容，确定吗？')) return;
                  onDataChange({ drawingStarter: undefined });
                  return;
                }
                /*
                 * ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）——
                 * 「该给这一档写什么形状的空底稿」是**数据**、住在
                 * `@/lib/worksheet-drawing-starter.ts` 的 `blankStarterFor`（纯函数、有判据）。
                 * 🔴 原来这里是**无条件**写一份**流程图**底稿 ⇒ 思维导图题上挂着流程图的底稿，
                 *   而服务端据此对模型说「图里有初始图」（假话，两边都不报错）。
                 * ⚠️ 这一档不支持（数学作图 / 自由画）时那个开关是**禁用**的，
                 *   所以 `null` 这一支走不到 —— 留着它是防守，不是主路径。
                 */
                const blank = blankStarterFor(tool);
                if (blank) onDataChange({ drawingStarter: blank });
              }}
            />
            <span>{tool === 'math' ? '使用教师绘制的数学底图' : '让学生从这张初始图开始画'}</span>
          </label>
        </div>
        {/* 流程图与思维导图允许学生接着编辑；数学图在学生端作为独立锁定底层渲染。
            不再提供通用“锁定”开关，避免一种设置同时控制三种语义不同的画板。 */}
        {starter ? (
          starter.tool !== tool ? (
            /* ★ 2026-10-07：底稿属于**另一个画板**（教师中途换过作图工具）。
               ⚠️ 它现在是**惰性**的：学生端不显示它，服务端也**不会**说「有初始图」
               （判据是「底稿的画板必须与题目当前的一致」，见 `hasDrawingStarter`）。
               ⇒ 这里照实说清它属于谁，别让教师以为它还在生效。 */
            <p className="worksheet-editor-drawing-note">
              这张底稿是<b>{toolLabelOf(starter.tool)}</b>的；把上面的作图工具改回
              <b>{toolLabelOf(starter.tool)}</b>就能继续编辑它（不会丢）。
              <br />
              想改用当前这一档重新画一张，先把上面的开关关掉（会丢掉这张）。
            </p>
          ) : tool === 'flowchart' ? (
            <>
              <p className="worksheet-editor-drawing-note">
                {/* ★ 2026-10-06：原来这里还有前半句「学生在下面这张图上继续画」——
                    与上面那个开关标签（「让学生在这张底稿上继续画」）同义 ⇒ 只留后半句。 */}
                学生将在这张图上继续绘制，初始图本身不计入作答。
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
          ) : tool === 'mind-map' ? (
            <>
              <p className="worksheet-editor-drawing-note">
                {/* 🔴 与流程图那句**不同**，别照抄：思维导图的底稿是**骨架**，
                    学生要填的正是骨架本身，所以交上来的**整棵树**都算他的作答
                    （见 `mindMapOrStarter`）—— 这里必须说清，不然教师会以为「骨架不算他的」。 */}
                学生将在这张图上继续绘制；导图这一档，交上来的**整张图**都算他的作答
                （只有发给智能体的那一句说明会提示「初始图不算学生的成果」）。
              </p>
              <div style={{ height: 380, border: '1px solid #e4ecf4', borderRadius: 10, overflow: 'hidden' }}>
                <MindmapDrawing
                  data={starter.tool === 'mind-map' ? starter.data : undefined}
                  backgroundUrl={starterBackgroundUrl}
                  disabled={false}
                  onChange={(next: unknown) => onDataChange({ drawingStarter: { tool: 'mind-map', data: next } })}
                />
              </div>
            </>
          ) : tool === 'math' ? (
            <>
              <p className="worksheet-editor-drawing-note">
                在这里绘制题目底图。学生能看到它，但不能选中、移动、旋转或删除其中的对象。
              </p>
              <div style={{ height: 380, border: '1px solid #e4ecf4', borderRadius: 10, overflow: 'hidden' }}>
                <MathDrawing
                  data={starter.tool === 'math' ? starter.data : undefined}
                  backgroundUrl={starterBackgroundUrl}
                  disabled={false}
                  onChange={(next: unknown) => onDataChange({ drawingStarter: { tool: 'math', data: next } })}
                />
              </div>
            </>
          ) : (
            <p className="worksheet-editor-drawing-note">
              基础绘图暂不支持结构化初始图。
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
