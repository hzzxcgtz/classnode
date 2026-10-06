import { CHAT_IMAGE_URL, DRAWING_TOOLS, type DrawingMode } from './worksheet-drawing.ts';

/** 第三方绘图编辑器写入作答值的统一信封；内部数据由各编辑器适配器维护。 */
export interface DrawingDocument {
  tool: DrawingMode;
  data: unknown;
  /**
   * ★ 2026-10-06：**一张位图**（本站上传目录里的 PNG）。
   *
   * 🔴 为什么服务端需要它：`data` 只有那几种编辑器自己看得懂（流程图是 nodes/edges、
   *    思维导图是 nodeData、数学作图是 elements），**服务端渲染不了**它们 ——
   *    而 AI 分析的联系表与 Word 报告都要看学生画的东西。
   *    ⇒ 客户端在改动停下来之后抓一张 PNG 传上来，服务端把它当**照片**拼进联系表/报告。
   * ⚠️ 没抓成（网络抖动）时它可能是旧的那张、也可能没有：**作答本身不受影响**，
   *    受影响的是「教师/AI 看到的那张图」——所以它**只是快照**，不是作答的真源。
   */
  image?: string;
}

/** 单题绘图文档上限。服务端仍会对整份请求设置更外层的限制。 */
export const DRAWING_DOCUMENT_MAX_CHARS = 600_000;

export function readDrawingDocument(raw: unknown): DrawingDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.tool !== 'string' || !(DRAWING_TOOLS as readonly string[]).includes(row.tool)) return null;
  if (!Object.prototype.hasOwnProperty.call(row, 'data')) return null;
  const image = typeof row.image === 'string' && CHAT_IMAGE_URL.test(row.image) ? row.image : undefined;
  try {
    const serialized = JSON.stringify(row.data);
    if (serialized === undefined || serialized.length > DRAWING_DOCUMENT_MAX_CHARS) return null;
    // ⚠️ 形状不对的 `image` **丢掉**（不是整份作废）：作答的真源是 `data`，
    //    为一张可选的快照把学生的作答判成「读不出来」是本末倒置。
    return { tool: row.tool as DrawingMode, data: JSON.parse(serialized) as unknown, ...(image ? { image } : {}) };
  } catch {
    return null;
  }
}
