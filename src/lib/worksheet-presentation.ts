import { getApiBaseUrl } from './api-base';
import type { WorksheetQuestionNode } from './types';

export const WORKSHEET_TEXT_COLORS = [
  { value: '#1e293b', label: '深灰' },
  { value: '#1d4ed8', label: '蓝色' },
  { value: '#b91c1c', label: '红色' },
  { value: '#15803d', label: '绿色' },
  { value: '#7e22ce', label: '紫色' },
] as const;

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

export function readPromptImage(node: WorksheetQuestionNode): string | null {
  const value = node.data.promptImageUrl;
  return typeof value === 'string' && value.startsWith('/uploads/chat/') ? value : null;
}

export function worksheetAssetUrl(value: string): string {
  return value.startsWith('/uploads/') ? `${getApiBaseUrl()}${value}` : value;
}
