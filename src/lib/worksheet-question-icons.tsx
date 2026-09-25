import type { ReactNode } from 'react';
import type { QuestionType } from './worksheet-questions';

/**
 * ★ 2026-09-25（教师裁定）：**题型在学生端只剩一个象形图标**。
 *
 * 原话：「也不用加题型『选择题』『判断题』，题型可以在标题前加一个象形的图标。」
 * ⇒ 学生端每张小题卡的头行 = 图标 + 题干，**没有编号、没有题型文字**。
 *
 * 🔴 **`Record<QuestionType, …>` 不是装饰**：这张表与 `QUESTION_TYPE_OPTIONS` 是同一族
 * 「加题型时必须同时回答」的地方 —— 往 `QuestionType` 里加一项，这里**编译不过**。
 * 少了这一层，新题型的学生卡片会**没有图标**（一块空白），而那**没有任何报错**：
 * 屏幕上只是「这一张的头行有点空」。本仓在 `VALIDATORS` / `JUDGES` / `GRADED_QUESTION_TYPES`
 * 三处用的是同一个手法。
 *
 * ⚠️ 与 UI 简报里那句「不要加图标装饰」**不冲突**：那句禁的是**装饰**（渐变、彩色标签、
 * 与内容无关的小图形）；这里每个图标**承载题型这一条信息**，它取代的是原来那行文字。
 * 简报自己给的判据是「结构性的东西要承载信息」，这条符合。
 *
 * ⚠️ 图标一律 `stroke="currentColor"` + `fill="none"`：颜色跟着文字走（灰阶），
 * 不引入第二种强调色 —— 简报的配色纪律是「强调色只留给可点的、当前生效的」，
 * 而学生端这个图标是**说明**，不是控件。
 *
 * ⚠️ 全部是内联 `<svg>`（本仓不引图标库，先例是 `src/lib/navigation-icons.tsx`）：
 * 学生端跑在 Safari 15 的老 iPad 上，内联 SVG 没有加载与兼容风险。
 */

/** 所有图标的共同外壳 —— 尺寸与线宽只在这里定一次，免得九个图标各写各的。 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const QUESTION_TYPE_ICONS: Record<QuestionType, ReactNode> = {
  // 单选：一个圈 + 一个实心点（收音机按钮）
  'single-choice': (
    <Glyph><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></Glyph>
  ),
  // 多选：方框里打勾（复选框）
  'multi-choice': (
    <Glyph><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 12.5l2.5 2.5L16 9.5" /></Glyph>
  ),
  // 判断：一个勾（对 / 错这一组里，勾就是「对」）
  'true-false': (
    <Glyph><path d="M5 13l4.5 4.5L19 7" /></Glyph>
  ),
  // 填空：一条下划线 + 上方一小段文字
  'fill-blank': (
    <Glyph><path d="M4 16.5h16" /><path d="M7 10.5h4" /><path d="M15 10.5h2" /></Glyph>
  ),
  // 问答：三行文字（主观题要写一段）
  'short-answer': (
    <Glyph><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h8" /></Glyph>
  ),
  // 排序：三条长短不一的横杠 + 一个上下箭头
  order: (
    <Glyph><path d="M4 7h9" /><path d="M4 12h12" /><path d="M4 17h7" /><path d="M19 8v8" /><path d="M16.5 10.5L19 8l2.5 2.5" /></Glyph>
  ),
  // 连线：两列点 + 一条连线
  match: (
    <Glyph><circle cx="6" cy="7" r="2" /><circle cx="6" cy="17" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 7.8l8 3.4" /><path d="M8 16.2l8-3.4" /></Glyph>
  ),
  // 归类：两个条目落进一个框
  categorize: (
    <Glyph><rect x="3" y="13" width="18" height="8" rx="3" /><rect x="6" y="5" width="5" height="5" rx="1.5" /><rect x="14" y="5" width="5" height="5" rx="1.5" /></Glyph>
  ),
  // 绘图：一支笔
  drawing: (
    <Glyph><path d="M4 20l4-1 10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5 4 20z" /><path d="M13.5 6.5l4 4" /></Glyph>
  ),
};

/**
 * 取一个题型的图标。**未知题型回落 `null`**（不回落成某一种的图标 ——
 * 那会让一道不认识的题在屏幕上**谎称自己是单选题**，与 `questionTypeLabel`
 * 「回落成类型串本身」是同一条纪律）。
 *
 * ⚠️ 库里手工改过的行可能有任何 `type` 串，所以这里的入参是 `string` 而不是 `QuestionType`。
 */
export function questionTypeIcon(type: string): ReactNode {
  return (QUESTION_TYPE_ICONS as Record<string, ReactNode>)[type] ?? null;
}
