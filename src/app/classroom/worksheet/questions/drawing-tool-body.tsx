'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { readDrawingBackground, readDrawingTool } from '@/lib/worksheet-drawing';
import { readDrawingStarter } from '@/lib/worksheet-drawing-starter.ts';
import type { DrawingDocument } from '@/lib/worksheet-drawing-document';
import { defaultInkBox } from '@/lib/worksheet-ink';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import type { WorksheetQuestionNode } from '@/lib/types';
import styles from '../worksheet.module.css';

const BasicDrawing = dynamic(() => import('./drawing-surfaces/basic-drawing'), { ssr: false });
const MathDrawing = dynamic(() => import('./drawing-surfaces/math-drawing'), { ssr: false });
const MindmapDrawing = dynamic(() => import('./drawing-surfaces/mindmap-drawing'), { ssr: false });
const FlowchartDrawing = dynamic(() => import('./drawing-surfaces/flowchart-drawing'), { ssr: false });

const TOOL_LABELS = {
  free: '基础绘图',
  math: '数学作图',
  'mind-map': '思维导图',
  flowchart: '流程图',
} as const;

function documentIsEmpty(document: DrawingDocument): boolean {
  if (!document.data || typeof document.data !== 'object' || Array.isArray(document.data)) return true;
  const data = document.data as Record<string, unknown>;
  if (document.tool === 'free') return !Array.isArray(data.paths) || data.paths.length === 0;
  if (document.tool === 'math') return !Array.isArray(data.elements) || data.elements.length === 0;
  if (document.tool === 'flowchart') return !Array.isArray(data.nodes) || data.nodes.length === 0;
  const nodeData = data.nodeData;
  if (!nodeData || typeof nodeData !== 'object' || Array.isArray(nodeData)) return true;
  const root = nodeData as Record<string, unknown>;
  return root.topic === '中心主题' && (!Array.isArray(root.children) || root.children.length === 0);
}

export function DrawingToolBody({ node, draft, onChange, disabled }: {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'ink' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}) {
  const tool = readDrawingTool(node);
  const background = readDrawingBackground(node);
  const backgroundUrl = background.url ? worksheetAssetUrl(background.url) : null;
  const [maximized, setMaximized] = useState(false);
  const box = draft.box.w > 0 && draft.box.h > 0 ? draft.box : defaultInkBox(node);
  const drawingDocument = draft.drawing?.tool === tool ? draft.drawing : undefined;

  useEffect(() => {
    if (!maximized) return;
    const previous = documentBodyOverflow();
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMaximized(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [maximized]);

  const update = useCallback((data: unknown) => {
    const nextDocument: DrawingDocument = {
      tool,
      data,
      // ⚠️ **保留上一次的快照**：`data` 每改一下这份文档就重建一次，顺手把 `image` 丢掉
      //    等于「学生一动笔，教师/AI 手里那张图就没了」（而且不报错）。
      ...(drawingDocument?.image ? { image: drawingDocument.image } : {}),
    };
    onChange({
      kind: 'ink',
      box,
      strokes: [],
      drawing: documentIsEmpty(nextDocument) ? undefined : nextDocument,
    });
  }, [box, drawingDocument?.image, onChange, tool]);

  /** 抓图回来：只补 `image`，**不动 `data`**（快照晚到一步，不能覆盖学生刚改的内容）。 */
  const updateImage = useCallback((image: string) => {
    const data = drawingDocument?.data;
    if (data === undefined) return;
    onChange({ kind: 'ink', box, strokes: [], drawing: { tool, data, image } });
  }, [box, drawingDocument?.data, onChange, tool]);

  const Surface = tool === 'math'
    ? MathDrawing
    : tool === 'mind-map'
      ? MindmapDrawing
      : tool === 'flowchart'
        ? FlowchartDrawing
        : BasicDrawing;

  const content = (
    <div
      className={`${styles.thirdPartyWorkspace} ${maximized ? styles.thirdPartyWorkspaceMaximized : ''}`}
      style={{ '--third-party-canvas-height': maximized ? 'calc(100dvh - 112px)' : '520px' } as CSSProperties}
    >
      <div className={styles.drawingWorkspaceHeader}>
        <div><strong>{TOOL_LABELS[tool]}</strong><span>本题使用此工具作答</span></div>
        <button className={styles.drawingToolbarButton} type="button" onClick={() => setMaximized(value => !value)} aria-label={maximized ? '退出全屏画板' : '全屏画板'}>
          {maximized ? '退出全屏' : '全屏画板'}
        </button>
      </div>
      <Surface
        starter={readDrawingStarter(node)}
        data={drawingDocument?.data}
        backgroundUrl={backgroundUrl}
        disabled={disabled}
        onChange={update}
        onImage={updateImage}
      />
    </div>
  );
  /*
   * ★ M4（审查留下的）：**不再用 `createPortal` 换渲染位置**。
   * 原来全屏时走 `createPortal(content, document.body)` —— 同一个 JSX 元素换个位置渲染，React 会
   * **卸载再挂载**整棵子树 ⇒ 画板实例重建 ⇒ **撤销历史（住在 ref 里）归零**：学生画了半天、
   * 切一下全屏，撤销键就灰了，而且没有任何提示。
   * ✅ 全屏本来就该由 CSS 负责：`.thirdPartyWorkspaceMaximized` 已经是 `position: fixed; inset: 0`
   * （在「portal 到 body」的前提下那句其实是冗余的 —— 它的存在恰好说明当初的意图就是 CSS 全屏）。
   * ⚠️ `position: fixed` 在祖先链带 `transform` / `filter` / `will-change` 时会退化成相对那个祖先。
   * 若真机上发现全屏没铺满，就是撞上了这一条 —— 那要另想办法，**别默默把 portal 加回来**：
   * 加回来等于重新接受「切全屏丢历史」。
   */
  return content;
}

function documentBodyOverflow(): string {
  return typeof document === 'undefined' ? '' : document.body.style.overflow;
}
