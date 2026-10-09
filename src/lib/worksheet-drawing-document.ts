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

/**
 * 这份绘图文档里**学生自己画的东西**是空的吗。
 *
 * ⚠️ 它**只看 `data`** —— 那是「学生自己画的那一份」（底稿在**读**的时候就剥掉了，
 *    见 `worksheet-drawing-starter.ts`）。所以**别拿它当「有没有东西可看」** —— 见下一条。
 */
export function drawingDocumentIsEmpty(document: DrawingDocument): boolean {
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

/**
 * 这份绘图文档**值不值得交上去**（交了才算「他答了这道题」）。
 *
 * 🔴 判据是**两条**：学生自己画了东西 **或者** 有一张快照。
 *    原来只有第一条 ⇒ 教师设了**初始化图**、学生还没动笔时：
 *      · 学生那份 `data` 是空的（底稿被 `subtractFlowchart` 剥掉了 —— 那一步是**对的**，
 *        「底稿不算学生的作答」）；
 *      · 而那张快照画的本来就是**底稿 + 学生画的**（`flowchart-drawing.tsx` 里
 *        `lastFlow.current = payload` 写的是全部那一份）；
 *      ⇒ 文档被判成空、**连快照一起丢掉** ⇒ 教师的监控面板里**空白一片**
 *        （学生屏幕上明明有底稿）—— 静默，两边都不报错。教师 2026-10-07 报的就是这个。
 * ⚠️ 反过来也成立：没底稿、学生也没动笔时，快照根本抓不出来（空图 `flowchartSvg` 回 `null`）
 *    ⇒ 仍然是「空」⇒ **不会**把「他只是打开了这道题」算成「作答中」。
 */
export function keepsDrawingDocument(document: DrawingDocument): boolean {
  return !drawingDocumentIsEmpty(document) || Boolean(document.image);
}

/**
 * 这一次改动之后，**上一张快照还该不该留着**（★ 2026-10-09 审计 §B5）。
 *
 * 🔴 判据只有一条：**这次改动是不是把学生自己画的东西清空了**。
 *    · **是** ⇒ 上一张快照画的正是他刚删掉的东西 ⇒ **作废**；
 *    · 不是（正常增删 / 他本来就什么都没画）⇒ **留着**。留着这一半是老的、仍然成立的理由：
 *      `data` 每改一下这份文档就重建一次，顺手丢掉 `image` 等于
 *      「学生一动笔，教师/AI 手里那张图就没了」（而且不报错）。
 *
 * 🔴 为什么清空那一半必须作废：`keepsDrawingDocument` 认「有快照」也算一份作答 ⇒
 *    一张过期的快照会让**一份已经被清空的作答照样交上去**：教师看板 / AI 联系表 /
 *    Word 报告里全是学生**已经删掉**的那张画，而学生屏幕上什么都没有 —— 两端都不报错。
 *
 * ⚠️ 「他本来就什么都没画」与「画过又清空」在**新数据**上完全一样（都是空），
 *    只有拿**上一份**比才分得开 ⇒ 所以本判据必须收 `previous`，不能只看新数据。
 *    两者处置**相反**：
 *      · 前者的快照**就是**教师设的底稿（2026-10-07 修的那条：学生还没动笔时，
 *        那是教师唯一能看到底稿的地方，丢了监控面板就空白）；
 *      · 后者是学生自己的东西被删掉之后的残留。
 *
 * ⚠️ `undefined`（没有上一份）与「换了工具」都回 `false`（没有可留的上一张）：
 *    调用点那边 `drawingDocument?.image` 已经先挡了一层，这两支在那里到不了。
 */
export function keepsPreviousImage(previous: DrawingDocument | undefined, tool: DrawingMode, data: unknown): boolean {
  if (!previous || previous.tool !== tool) return false;
  // 上一份本来就是空的（底稿快照那一档）⇒ 这一张不是「他刚删掉的东西」，留着。
  if (drawingDocumentIsEmpty(previous)) return true;
  // 上一份有内容：新数据也还有内容 ⇒ 正常改动；新数据空了 ⇒ 他刚把东西清掉 ⇒ 作废。
  return !drawingDocumentIsEmpty({ tool, data });
}
