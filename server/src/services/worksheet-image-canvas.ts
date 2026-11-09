export type CanvasWidgetKind = 'answer' | 'label' | 'hint';
export type CanvasRect = { x: number; y: number; width: number; height: number };
export type CanvasWidget = CanvasRect & { id: string; kind: CanvasWidgetKind; label: string; detail: string };
export type WorksheetImageCanvas = { url: string; width: number; height: number; widgets: CanvasWidget[] };
export type DeskRating = { stars: number; maxStars: 3 | 5 };

export const CANVAS_WIDGET_LIMIT = 16;
export const CANVAS_MIN_WIDTH = 8;
export const CANVAS_MIN_HEIGHT = 5;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isExpressionTask(type: string): boolean {
  return type === 'short-answer' || type === 'open-ended';
}

export function readImageCanvas(value: unknown): WorksheetImageCanvas | null {
  const { url, width, height, widgets } = record(value);
  if (typeof url !== 'string' || !/^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[a-f0-9-]+\.(?:png|jpg|jpeg|webp)$/i.test(url)
    || typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 20000
    || typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > 20000
    || !Array.isArray(widgets) || widgets.length > CANVAS_WIDGET_LIMIT) return null;
  const items: CanvasWidget[] = [];
  const ids = new Set<string>();
  let hasAnswer = false;
  for (const raw of widgets) {
    const widget = record(raw);
    const { id, kind, x, y, width: w, height: h, label, detail } = widget;
    if (typeof id !== 'string' || !/^[a-z\d-]{1,80}$/i.test(id) || ids.has(id)
      || (kind !== 'answer' && kind !== 'label' && kind !== 'hint')
      || (kind === 'answer' && hasAnswer)
      || typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number'
      || ![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < CANVAS_MIN_WIDTH || h < CANVAS_MIN_HEIGHT
      || x + w > 100.000001 || y + h > 100.000001) return null;
    ids.add(id);
    hasAnswer ||= kind === 'answer';
    items.push({ id, kind, x, y, width: w, height: h, label: typeof label === 'string' ? label.slice(0, 100) : '',
      detail: kind === 'hint' && typeof detail === 'string' ? detail.slice(0, 600) : '' });
  }
  return { url, width, height, widgets: items };
}

export function readDeskRating(value: unknown): DeskRating | null {
  const { stars, maxStars } = record(value);
  return (maxStars === 3 || maxStars === 5) && typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= maxStars
    ? { stars, maxStars } : null;
}

export function deskReviewSettings(node: { type: string; inputMode?: string; data: Record<string, unknown> }): { maxStars: 3 | 5; instruction: string } | null {
  if (!isExpressionTask(node.type) || node.inputMode !== 'audio') return null;
  const { maxStars, instruction } = record(node.data.deskReview);
  return maxStars === 3 || maxStars === 5 ? { maxStars, instruction: typeof instruction === 'string' ? instruction.slice(0, 600) : '' } : null;
}
