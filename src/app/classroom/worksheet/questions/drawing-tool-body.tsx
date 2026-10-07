'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { readDrawingBackground, readDrawingTool } from '@/lib/worksheet-drawing';
import { readDrawingStarter } from '@/lib/worksheet-drawing-starter.ts';
import { keepsDrawingDocument, type DrawingDocument } from '@/lib/worksheet-drawing-document';
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
      /*
       * ★ 2026-10-07：判据是**「学生画了东西」或「有一张快照」**，不再是「学生那份数据非空」——
       * 教师设了初始化图时，学生那份 `data` 本来就是空的（底稿不算他的作答），
       * 而快照画的是「底稿 + 学生画的」。原来把两者一起丢掉 ⇒ 教师面板空白（详见那条函数的注释）。
       */
      drawing: keepsDrawingDocument(nextDocument) ? nextDocument : undefined,
    });
  }, [box, drawingDocument?.image, onChange, tool]);

  /**
   * 抓图回来：只补 `image`，**不动 `data`**（快照晚到一步，不能覆盖学生刚改的内容）。
   *
   * ★ 2026-10-07：**快照可以单独成立** —— 教师设了初始化图、学生还没动笔时，
   *   第一张快照到达时 `data` 还是 `undefined`（上一拍交出去的是一份空文档）。
   *   原来这里 `data === undefined` 直接 return ⇒ 那张（画着底稿的）图**永远进不来**
   *   ⇒ 教师监控面板一直空着。⚠️ `{}` 是合法的空 `data`（`readDrawingDocument` 只要求「有 data 这个键」），
   *   学生一动笔 `update` 就会把真数据换上来，图仍然保留。
   */
  const updateImage = useCallback((image: string) => {
    const data = drawingDocument?.data ?? {};
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
        /* ★ 2026-10-06：题目 id 当「撤销历史」的 key —— 全屏切 portal 会重挂子树，
           历史靠这个 key 从模块级的表里取回来（见 `types.ts` 的 `historyKey`）。 */
        historyKey={node.id}
      />
    </div>
  );
  /*
   * ★ 2026-10-06（**教师在真机上发现**）：**portal 必须保留** —— 上一轮我曾把它去掉（为了保住
   * 撤销历史），结果全屏当场坏掉，已回退。
   *
   * 🔴 为什么 CSS 做不到：全屏态 `.thirdPartyWorkspaceMaximized` 是 `position: fixed; inset: 0`，
   * 但 `fixed` 在有些祖先下会**退化成相对那个祖先**（`transform` / `filter` / `backdrop-filter` /
   * `contain` / `will-change` 任一即可）。教师实测：去掉 portal 之后，全屏那层**只覆盖题目卡那么大、
   * 根本没铺满**，还盖住了旁边的画板。我翻遍 `worksheet` / `shell` / `globals` 三个样式表也没定位到
   * 是哪个祖先干的 —— **但 portal 到 `document.body` 能绕开这一切**（body 之上没有祖先劫持它）。
   * 这大概就是当初写 portal 的真正理由。
   *
   * ⚠️ 它的代价是真实的：同一棵子树换个渲染位置 ⇒ React **卸载再挂载** ⇒ 画板实例重建。
   * 那份代价用「历史跨挂载存活」正面解决（见 `@/lib/worksheet-flowchart-history.ts` 的
   * `loadHistory` / `saveHistory`，以及画板里的 `historyKey`），**不是**靠去掉 portal 来回避。
   */
  return maximized && typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

function documentBodyOverflow(): string {
  return typeof document === 'undefined' ? '' : document.body.style.overflow;
}
