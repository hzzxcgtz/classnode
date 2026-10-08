import type { WorksheetQuestionNode } from './types';

export const DRAWING_EXTENSIONS = ['math', 'mind-map', 'flowchart'] as const;
export type DrawingExtension = (typeof DRAWING_EXTENSIONS)[number];
export const DRAWING_TOOLS = ['free', ...DRAWING_EXTENSIONS] as const;
export type DrawingMode = (typeof DRAWING_TOOLS)[number];

export const DRAWING_TOOL_OPTIONS: ReadonlyArray<{
  value: DrawingMode;
  label: string;
  description: string;
}> = [
  { value: 'free', label: '基础绘图', description: '自由书写、圈画和标注，适合绝大多数开放作图题。' },
  { value: 'math', label: '数学作图', description: '直线、箭头、圆和常用几何图形，支持网格吸附。' },
  { value: 'mind-map', label: '思维导图', description: '用主题框、文字和分支连线整理想法。' },
  { value: 'flowchart', label: '流程图', description: '用开始/结束、过程、判断和箭头表达步骤。' },
];

export const DRAWING_BACKGROUND_PRESETS = [
  { value: 'blank', label: '空白', description: '纯白画布', url: null },
  { value: 'small-grid', label: '小方格', description: '适合几何与坐标作图', url: '/worksheet/drawing-backgrounds/small-grid.svg' },
  { value: 'field-grid', label: '田字格', description: '适合汉字、结构与位置练习', url: '/worksheet/drawing-backgrounds/field-grid.svg' },
  { value: 'ruled', label: '横线', description: '适合书写、标注与分步表达', url: '/worksheet/drawing-backgrounds/ruled.svg' },
  { value: 'dot-grid', label: '点阵', description: '轻量定位，不遮挡笔迹', url: '/worksheet/drawing-backgrounds/dot-grid.svg' },
  { value: 'coordinate', label: '坐标纸', description: '四象限坐标与方格', url: '/worksheet/drawing-backgrounds/coordinate.svg' },
  { value: 'number-line', label: '数轴', description: '带刻度与方向的水平数轴', url: '/worksheet/drawing-backgrounds/number-line.svg' },
] as const;

export type DrawingBackgroundPreset = (typeof DRAWING_BACKGROUND_PRESETS)[number]['value'];

/**
 * 没挑过背景的作图题用哪一档（★ 2026-10-06 教师：「背景默认应该是点阵图」）。
 *
 * 🔴 **必须只有这一处**：学生端解析（`readDrawingBackground`）与教师端那个选择器
 *    都要走它 —— 两处各写一个默认值的话，会出现「教师看到选中的是空白、学生看到的
 *    是点阵」这种谁都不报错的偏差。
 * ⚠️ `blank` 仍是**可选项**（第一位、教师想纯白就点它）；这里改的只是**没挑过时**的兜底。
 */
export const DEFAULT_DRAWING_BACKGROUND: DrawingBackgroundPreset = 'dot-grid';

/**
 * **本站上传图片**的 URL 形状（作图背景、学生拍的照片、第三方画板的位图，都认这一个）。
 *
 * 🔴 一处定义、多处读：这条形状同时是**文件读取的入口**（服务端导出/AI 分析要拿它拼磁盘
 *    路径），所以放宽它等于给任意路径开口子；而**散成三份**必然分叉 —— 实测原来确实有三份，
 *    其中 `worksheet-answer-value.ts` 那两份**不认 `.jpeg`**（服务端认），
 *    于是「服务端存得下、学生端读不回来」的照片会**静默**变成空作答。
 * ⚠️ 与 `server/src/services/worksheet-ink.ts` 的 `CHAT_IMAGE_URL` 逐字相同（跨工程对拍网钉着）。
 */
export const CHAT_IMAGE_URL = /^\/uploads\/chat\/chat-[0-9a-f-]+\.(?:png|jpe?g|webp)$/i;

export function readDrawingExtensions(node: Pick<WorksheetQuestionNode, 'type' | 'data'>): DrawingExtension[] {
  if (node.type !== 'drawing' || !Array.isArray(node.data.drawingExtensions)) return [];
  const values = node.data.drawingExtensions.filter(
    (value): value is DrawingExtension => typeof value === 'string'
      && (DRAWING_EXTENSIONS as readonly string[]).includes(value),
  );
  return DRAWING_EXTENSIONS.filter(value => values.includes(value));
}

/**
 * 绘图题只允许一种工具。新数据读 `drawingTool`；旧版的多选扩展按固定顺序取第一项，
 * 空扩展回到基础绘图，从而无需迁移历史学习单。
 */
export function readDrawingTool(node: Pick<WorksheetQuestionNode, 'type' | 'data'>): DrawingMode {
  if (node.type !== 'drawing') return 'free';
  const raw = node.data.drawingTool;
  if (typeof raw === 'string' && (DRAWING_TOOLS as readonly string[]).includes(raw)) return raw as DrawingMode;
  return readDrawingExtensions(node)[0] ?? 'free';
}

export function readDrawingBackground(node: Pick<WorksheetQuestionNode, 'type' | 'data'>): {
  preset: DrawingBackgroundPreset | 'custom';
  url: string | null;
} {
  if (node.type !== 'drawing') return { preset: 'blank', url: null };   // 不是作图题 ⇒ 与「没挑过」无关
  /*
   * 所有画板统一使用点阵；历史的空白/方格/横线等选择不再影响显示。
   * 唯一例外是数学题的教师图片底图：它是题目内容，不是装饰背景，学生只能在上面作答。
   */
  const rawPreset = node.data.drawingBackgroundPreset;
  if (readDrawingTool(node) === 'math' && rawPreset === 'custom') {
    const rawUrl = node.data.drawingBackgroundImageUrl;
    return typeof rawUrl === 'string' && CHAT_IMAGE_URL.test(rawUrl)
      ? { preset: 'custom', url: rawUrl }
      : { preset: DEFAULT_DRAWING_BACKGROUND, url: '/worksheet/drawing-backgrounds/dot-grid.svg' };
  }
  const preset = DRAWING_BACKGROUND_PRESETS.find(option => option.value === DEFAULT_DRAWING_BACKGROUND)!;
  return { preset: preset.value, url: preset.url };
}

export function drawingModesFor(node: Pick<WorksheetQuestionNode, 'type' | 'data'>): DrawingMode[] {
  return [readDrawingTool(node)];
}

/**
 * 「改动停下来多久抓一张」与「**最多**隔多久必抓一张」这两条一起算出的等待时间。
 *
 * 🔴 只有防抖的那一版（`delayMs` 一条）在**学生连续画**的时候**一张都不抓** ——
 *    每次改动都把计时器重置，于是图永远停在「他上一次停手时」那一张。
 *    教师 2026-10-07：「我在学生端修改流程图……**图没有及时更新**」——
 *    方块与状态行跟着**保存**（1.5 秒）立刻变，而图跟着**抓图**，两条节拍不一样，
 *    屏幕上的表现就是「旁边的字变了、画没变」。
 * ✅ 加一条**上限**：距上次抓图超过 `maxDelayMs` 就缩短这次要等的时间 ⇒
 *    连续画的时候也能定期刷新（学生端多花的是「每 N 秒一次 SVG→PNG」，见下）。
 * ⚠️ 上限**不能太短**：抓一张要跑一次 SVG→PNG（老 iPad 上是实打实的开销），
 *    而这条通道本来就是**为教师那一格**服务的，不能让学生端卡顿。
 */
export function rasterDelayMs(input: {
  now: number;
  /** 上一次**真正抓图**的时刻；`null` = 还没抓过。 */
  lastCaptureAt: number | null;
  /** 改动停下来多久抓（防抖）。 */
  delayMs: number;
  /** 最多隔多久必抓一张。 */
  maxDelayMs: number;
}): number {
  const { now, lastCaptureAt, delayMs, maxDelayMs } = input;
  if (lastCaptureAt === null) return delayMs;
  const sinceLast = Math.max(0, now - lastCaptureAt);
  if (sinceLast >= maxDelayMs) return 0;
  return Math.min(delayMs, maxDelayMs - sinceLast);
}

/**
 * ★ 2026-10-07（审计抓到的思维导图那条）—— **抓图绝不抛，失败回 `null`。**
 *
 * 🔴 这条承诺是抓图那一套的（`worksheet-drawing-raster.ts` 的 `svgToPngBlob` 上写着
 *   「抓图炸掉不该把作答那一步带走」），所以由**这一层**保证，而不是指望每个调用点的
 *   `capture` 都守规矩：`svgToPngBlob` 守着，而思维导图调的是第三方库的 `exportPng`，
 *   库失败时 **reject** ⇒ `useDrawingRaster` 里那句 `void (async () => { await capture() … })()`
 *   成为 **unhandled rejection**（仓里没有兜底线），这一次快照静默不更新，屏幕上什么都不说。
 * ⇒ 收在这里：四个画板一起受益，将来谁再写一个会 reject 的 capture 也漏不出去。
 *
 * ⚠️ 它住在**这个文件**而不是 `worksheet-drawing-raster.ts`：那个模块 import 了 `./api`
 *   （webpack 风格、无扩展名），`node --test` 装载不起来 —— 而这条判据必须能跑
 *  （与 `rasterDelayMs` 同一个理由，见 `worksheet-drawing-raster.test.ts` 的文件头）。
 */
export async function safeCapture(capture: () => Promise<Blob | null>): Promise<Blob | null> {
  try {
    return await capture();
  } catch {
    // ⚠️ **刻意不报错、也不弹提示**：抓图是派生数据（教师预览 / AI 联系表 / 报告都用它），
    //    抓不到就这一次跳过 —— 作答本身一个字都不受影响，而打断学生去报一个他无能为力的错更坏。
    return null;
  }
}
