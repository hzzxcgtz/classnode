import type { CSSProperties } from 'react';
import type { WorksheetQuestionNode } from './types';
import { CANVAS_STAR_LABEL, canvasAnswerMode, canvasDeskReviewSettings } from '../../server/src/services/worksheet-image-canvas.ts';
import type { CanvasMatchChoice, CanvasRect, CanvasWidget, CanvasWidgetKind } from '../../server/src/services/worksheet-image-canvas.ts';
import { CANVAS_MIN_HEIGHT, CANVAS_MIN_WIDTH } from '../../server/src/services/worksheet-image-canvas.ts';

export * from '../../server/src/services/worksheet-image-canvas.ts';

export const CANVAS_WIDGET_LABELS = { answer: '作答区', label: '文字标签', hint: '点击提示' } satisfies Record<CanvasWidgetKind, string>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function moveCanvasRect(rect: CanvasRect, dx: number, dy: number): CanvasRect {
  return { ...rect, x: clamp(rect.x + dx, 0, 100 - rect.width), y: clamp(rect.y + dy, 0, 100 - rect.height) };
}

export const CANVAS_RESIZE_EDGES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type CanvasResizeEdge = typeof CANVAS_RESIZE_EDGES[number];

export function resizeCanvasRect(rect: CanvasRect, dx: number, dy: number, edge: CanvasResizeEdge = 'se'): CanvasRect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = edge.includes('w') ? clamp(rect.x + dx, 0, right - CANVAS_MIN_WIDTH) : rect.x;
  const y = edge.includes('n') ? clamp(rect.y + dy, 0, bottom - CANVAS_MIN_HEIGHT) : rect.y;
  const endX = edge.includes('e') ? clamp(right + dx, x + CANVAS_MIN_WIDTH, 100) : right;
  const endY = edge.includes('s') ? clamp(bottom + dy, y + CANVAS_MIN_HEIGHT, 100) : bottom;
  return { x, y, width: endX - x, height: endY - y };
}

export const CANVAS_PROPORTIONAL_EDGES = ['nw', 'ne', 'se', 'sw'] as const;

export function resizeCanvasRectProportionally(rect: CanvasRect, dx: number, dy: number, edge: CanvasResizeEdge): CanvasRect {
  const west = edge.includes('w');
  const north = edge.includes('n');
  const anchorX = west ? rect.x + rect.width : rect.x;
  const anchorY = north ? rect.y + rect.height : rect.y;
  const scale = clamp(
    1 + ((west ? -dx : dx) / rect.width + (north ? -dy : dy) / rect.height) / 2,
    Math.max(CANVAS_MIN_WIDTH / rect.width, CANVAS_MIN_HEIGHT / rect.height),
    Math.min((west ? anchorX : 100 - anchorX) / rect.width, (north ? anchorY : 100 - anchorY) / rect.height),
  );
  const width = Math.max(CANVAS_MIN_WIDTH, rect.width * scale);
  const height = Math.max(CANVAS_MIN_HEIGHT, rect.height * scale);
  return { x: Math.max(0, west ? anchorX - width : anchorX), y: Math.max(0, north ? anchorY - height : anchorY), width, height };
}

export function newCanvasWidget(kind: CanvasWidgetKind, count = 0): CanvasWidget {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(3)), part => part.toString(36)).join('-');
  if (kind === 'answer') {
    return { id, kind, x: 6 + (count % 2) * 46, y: 83 - Math.floor(count / 2) * 11, width: 42, height: 10, label: '', detail: '' };
  }
  return { id, kind, x: 6 + (count % 4) * 6, y: 8 + (count % 5) * 9, width: 28, height: 9,
    label: CANVAS_WIDGET_LABELS[kind], detail: '' };
}

export function canvasRectStyle(rect: CanvasRect) {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` };
}

export function canvasWidgetStyle(widget: CanvasWidget, rect: CanvasRect = widget) {
  return { ...canvasRectStyle(rect), borderRadius: widget.matchShape === 'ellipse' ? '50%' : undefined,
    borderColor: widget.borderColor, backgroundColor: widget.backgroundColor, color: widget.textColor,
    '--canvas-text-color': widget.textColor, borderStyle: widget.borderStyle, borderWidth: widget.borderStyle === 'double' ? 3 : undefined } as CSSProperties;
}

const MATCH_TINTS = ['#dceefe', '#e4f4e9', '#fff1ce', '#f5e8f8', '#ffe7df', '#e4edf4'];

export function canvasChoiceColor(choice: Pick<CanvasMatchChoice, 'id' | 'color'>): string {
  if (choice.color) return choice.color;
  const index = Array.from(choice.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % MATCH_TINTS.length;
  return MATCH_TINTS[index];
}

export function canvasChoiceFill(choice: Pick<CanvasMatchChoice, 'id' | 'color'>): string {
  const color = canvasChoiceColor(choice);
  return color === 'transparent' ? color : `${color}b3`;
}

export function canvasRecordingStyle(widget: CanvasWidget, rect: CanvasRect = widget): CSSProperties {
  return {
    ...canvasRectStyle(rect),
    '--canvas-voice-border': widget.borderColor,
    '--canvas-voice-background': widget.backgroundColor,
    '--canvas-voice-line': widget.borderStyle,
    '--canvas-voice-line-width': widget.borderStyle === 'double' ? '3px' : undefined,
    '--canvas-text-color': widget.textColor,
  } as CSSProperties;
}

export function canvasAnswerLabel(inputMode: string, peer = false): string {
  if (inputMode === 'star-rating') return CANVAS_STAR_LABEL;
  if (inputMode === 'peer-audio') return '同桌录音与评星';
  if (inputMode === 'audio') return peer ? '给同桌录音' : '录音作答';
  if (inputMode === 'photo') return '拍照或上传';
  if (inputMode === 'handwriting') return '手写作答';
  return '输入文字';
}

export function canvasRegionNode(node: WorksheetQuestionNode, widget: CanvasWidget): WorksheetQuestionNode {
  const data = { ...node.data };
  delete data.imageCanvas;
  const mode = canvasAnswerMode(node, widget);
  const deskReview = canvasDeskReviewSettings(node, widget);
  delete data.deskReview;
  if (deskReview) data.deskReview = deskReview;
  const inputMode = mode === 'peer-audio' ? 'audio' : (mode === 'region-match' || mode === 'star-rating') ? 'keyboard' : mode;
  return { ...node, type: 'short-answer', inputMode, data };
}
