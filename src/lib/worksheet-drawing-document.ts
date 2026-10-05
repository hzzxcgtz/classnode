import { DRAWING_TOOLS, type DrawingMode } from './worksheet-drawing.ts';

/** 第三方绘图编辑器写入作答值的统一信封；内部数据由各编辑器适配器维护。 */
export interface DrawingDocument {
  tool: DrawingMode;
  data: unknown;
}

/** 单题绘图文档上限。服务端仍会对整份请求设置更外层的限制。 */
export const DRAWING_DOCUMENT_MAX_CHARS = 600_000;

export function readDrawingDocument(raw: unknown): DrawingDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.tool !== 'string' || !(DRAWING_TOOLS as readonly string[]).includes(row.tool)) return null;
  if (!Object.prototype.hasOwnProperty.call(row, 'data')) return null;
  try {
    const serialized = JSON.stringify(row.data);
    if (serialized === undefined || serialized.length > DRAWING_DOCUMENT_MAX_CHARS) return null;
    return { tool: row.tool as DrawingMode, data: JSON.parse(serialized) as unknown };
  } catch {
    return null;
  }
}
