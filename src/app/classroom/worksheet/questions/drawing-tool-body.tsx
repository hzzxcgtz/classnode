'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { readDrawingBackground, readDrawingTool } from '@/lib/worksheet-drawing';
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
    const nextDocument: DrawingDocument = { tool, data };
    onChange({
      kind: 'ink',
      box,
      strokes: [],
      drawing: documentIsEmpty(nextDocument) ? undefined : nextDocument,
    });
  }, [box, onChange, tool]);

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
          {maximized ? '退出全屏' : '全屏作图'}
        </button>
      </div>
      <Surface data={drawingDocument?.data} backgroundUrl={backgroundUrl} disabled={disabled} onChange={update} />
    </div>
  );
  return maximized && typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

function documentBodyOverflow(): string {
  return typeof document === 'undefined' ? '' : document.body.style.overflow;
}
