import { getApiBaseUrl } from './api-base';
import {
  DEFAULT_PROMPT_STYLE,
  WORKSHEET_TEXT_COLORS,
  readPromptRuns,
  type PromptRun,
} from './worksheet-prompt-marks';
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
 * ★ 2026-09-26。
 *
 * 🔴 **临时桥**（第 3 步的内容迁移做完之后删掉这一段）：库里还没有 `promptRuns` 的题
 * 仍然靠整段的 `promptStyle` 渲染。少了它，第 2 步「渲染并成一处」会让**所有已经设过
 * 格式的老题当场掉格式**（而那时迁移还没跑）。桥只活一个提交，删它的那一步就是
 * 「格式的来源从两个变成一个」。
 *
 * ⚠️ 判据是 `!== undefined` 而不是 `Array.isArray`：键**在**就按分段读（脏值由
 * `readPromptRuns` 自己归一化掉），键不在才回落整段样式。「是不是数组」会让一个
 * 半途而废的写入被静默当成「这道题没格式」。
 */
export function readPromptRunsFor(node: WorksheetQuestionNode): PromptRun[] {
  if (node.data.promptRuns !== undefined) return readPromptRuns(node.data.promptRuns, node.prompt);
  const runs = readPromptRuns(undefined, node.prompt);
  const legacy = readPromptStyle(node);
  // ⚠️ 判据必须落在**整段样式**上：`runs` 那一份永远是「一条默认」（上面那一步是照着
  // 空数据归一化的），拿它去判「这道题有没有格式」会**恒真** —— 老题的格式全丢。
  const hasLegacy = legacy.bold || legacy.italic || legacy.color !== DEFAULT_PROMPT_STYLE.color;
  if (!hasLegacy) return runs;
  return runs.map(item => ({ ...item, bold: legacy.bold, italic: legacy.italic, color: legacy.color }));
}

export function readPromptImage(node: WorksheetQuestionNode): string | null {
  const value = node.data.promptImageUrl;
  return typeof value === 'string' && value.startsWith('/uploads/chat/') ? value : null;
}

export function worksheetAssetUrl(value: string): string {
  return value.startsWith('/uploads/') ? `${getApiBaseUrl()}${value}` : value;
}
