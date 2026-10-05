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

const UPLOADED_DRAWING_BACKGROUND = /^\/uploads\/chat\/chat-[0-9a-f-]+\.(?:png|jpe?g|webp)$/i;

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
  if (node.type !== 'drawing') return { preset: 'blank', url: null };
  const rawPreset = node.data.drawingBackgroundPreset;
  if (rawPreset === 'custom') {
    const rawUrl = node.data.drawingBackgroundImageUrl;
    return typeof rawUrl === 'string' && UPLOADED_DRAWING_BACKGROUND.test(rawUrl)
      ? { preset: 'custom', url: rawUrl }
      : { preset: 'blank', url: null };
  }
  const preset = DRAWING_BACKGROUND_PRESETS.find(option => option.value === rawPreset)
    ?? DRAWING_BACKGROUND_PRESETS[0];
  return { preset: preset.value, url: preset.url };
}

export function drawingModesFor(node: Pick<WorksheetQuestionNode, 'type' | 'data'>): DrawingMode[] {
  return [readDrawingTool(node)];
}
