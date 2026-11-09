import type { CanvasRect, CanvasWidget, CanvasWidgetKind } from '../../server/src/services/worksheet-image-canvas.ts';
import { CANVAS_MIN_HEIGHT, CANVAS_MIN_WIDTH } from '../../server/src/services/worksheet-image-canvas.ts';

export * from '../../server/src/services/worksheet-image-canvas.ts';

export const CANVAS_WIDGET_LABELS = { answer: '作答区', label: '文字标签', hint: '点击提示' } satisfies Record<CanvasWidgetKind, string>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function moveCanvasRect(rect: CanvasRect, dx: number, dy: number): CanvasRect {
  return { ...rect, x: clamp(rect.x + dx, 0, 100 - rect.width), y: clamp(rect.y + dy, 0, 100 - rect.height) };
}

export function resizeCanvasRect(rect: CanvasRect, dx: number, dy: number): CanvasRect {
  return { ...rect, width: clamp(rect.width + dx, CANVAS_MIN_WIDTH, 100 - rect.x),
    height: clamp(rect.height + dy, CANVAS_MIN_HEIGHT, 100 - rect.y) };
}

export function newCanvasWidget(kind: CanvasWidgetKind, count = 0): CanvasWidget {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(3)), part => part.toString(36)).join('-');
  return { id, kind, x: kind === 'answer' ? 12 : 6 + (count % 4) * 6, y: kind === 'answer' ? 74 : 8 + (count % 5) * 9,
    width: kind === 'answer' ? 76 : 28, height: kind === 'answer' ? 16 : 9,
    label: kind === 'answer' ? '' : CANVAS_WIDGET_LABELS[kind], detail: '' };
}

export function canvasRectStyle(rect: CanvasRect) {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` };
}

export function canvasAnswerLabel(inputMode: string, peer = false): string {
  if (inputMode === 'audio') return peer ? '给同桌录音' : '录音作答';
  if (inputMode === 'photo') return '拍照或上传';
  if (inputMode === 'handwriting') return '手写作答';
  return '输入文字';
}
