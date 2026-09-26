import { getApiBaseUrl } from './api-base';
import { WORKSHEET_TEXT_COLORS, readPromptRuns, type PromptRun } from './worksheet-prompt-marks';
import type { WorksheetQuestionNode } from './types';

// ⚠️ 这张表**搬到 `worksheet-prompt-marks.ts` 了**（2026-09-26）：那个文件必须零 import
// 才能在 `node --test` 下直接加载，而本文件 import 了 `./api-base`。
// 这里原样再导出一次，调用方一行不用改。
// ⚠️ 是 `export { X }`（本地已有绑定）而不是 `export { X } from '…'` —— 后者**不产生
// 本地名字**，而下面的 `readPromptStyle` 还要用它。
export { WORKSHEET_TEXT_COLORS };

export interface WorksheetTextStyle {
  bold: boolean;
  italic: boolean;
  color: string;
}

const DEFAULT_STYLE: WorksheetTextStyle = { bold: false, italic: false, color: '#1e293b' };

export function readPromptStyle(node: WorksheetQuestionNode): WorksheetTextStyle {
  const raw = node.data.promptStyle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_STYLE;
  const style = raw as Record<string, unknown>;
  const color = WORKSHEET_TEXT_COLORS.some(item => item.value === style.color)
    ? style.color as string
    : DEFAULT_STYLE.color;
  return { bold: style.bold === true, italic: style.italic === true, color };
}

/**
 * 题干的行内格式分段 —— **渲染端该调的那一个**。
 *
 * ★ 2026-09-26。内联格式（粗 / 斜 / 下划线 / 着重号 / 颜色）的取值与切分全在
 * `worksheet-prompt-marks.ts`（零 import、`node --test` 直接跑），这里只是把
 * 「从节点的哪个字段读」收成一处。
 *
 * 🔴 **这里曾经是一个「临时桥」**：第 2 步把渲染并成一处时，库里还没有 `promptRuns` 的题
 * 会回落整段的 `promptStyle` —— 少了它，那一步会让**所有已经设过格式的老题当场掉格式**。
 * 第 3 步的内容迁移（`worksheet-prompt-migration.ts`，在服务端启动时跑）把老数据
 * 全部转成分段之后，那个回落就**删掉了** —— 格式的来源从**两个**变成一个。
 * ⚠️ 再也不要加回任何形式的回落：两条来源漂移的后果是「界面上是 A、库里是 B」，
 * 而两边都不报错。
 */
export function readPromptRunsFor(node: WorksheetQuestionNode): PromptRun[] {
  return readPromptRuns(node.data.promptRuns, node.prompt);
}

export function readPromptImage(node: WorksheetQuestionNode): string | null {
  const value = node.data.promptImageUrl;
  return typeof value === 'string' && value.startsWith('/uploads/chat/') ? value : null;
}

export function worksheetAssetUrl(value: string): string {
  return value.startsWith('/uploads/') ? `${getApiBaseUrl()}${value}` : value;
}
