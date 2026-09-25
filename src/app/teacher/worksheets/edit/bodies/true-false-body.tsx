'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { readCorrectKeys, TRUE_FALSE_OPTIONS } from '../worksheet-editor-core';

/**
 * 判断题：**只有「正确答案 ○ 对 ○ 错」一行**（brief Step 2）。
 *
 * 🔴 **判断题不存 `options`**（规格 §12）：选项恒为对/错两个，`data` 里只有 `correctKeys`。
 * 那两个选项的文字来自 `TRUE_FALSE_OPTIONS`（`src/lib/worksheet-questions.ts`）——
 * 学生端的作答体（D2）读的是同一份，两处各写一份就会漂移
 *（教师看到「对 / 错」，学生那边不一样，**没有任何报错**）。
 *
 * ⚠️ **不做「选项文案可编辑」**：能改的话，这道题的 `key` 与文字就可能对不上
 *（`T` 显示成「错」），而判分只认 `key` ⇒ 学生选「对」被判错，教师看不出原因。
 *
 * ⚠️ 初始 `correctKeys` 是**空的**（不是 `['T']`）：见 `newQuestion` 的注释 ——
 * 默认选中一个答案会安静地把一道没配答案的题变成「所有选对的学生都对」。
 */
export function TrueFalseBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ **整个编辑体就是答案选择器**，整块不渲染。 */
  showAnswer?: boolean;
}) {
  const correctKeys = readCorrectKeys(node);

  // 🔴 判断题的编辑体**整个就是「选正确答案」**（题面只有题干 + 固定的对/错两个按钮，
  // 不存 `options`）⇒ 关掉自动评分时它整块不渲染，而不是只藏一半。
  if (!showAnswer) return null;

  return (
    <div className="worksheet-editor-inline-actions">
      <span className="worksheet-editor-block-label">正确答案</span>
      {TRUE_FALSE_OPTIONS.map(option => (
        <label key={option.key} className="worksheet-editor-option-correct" title="选为正确答案">
          <input
            type="radio"
            // ⚠️ `name` 必须带 `node.id`：同卷多题共用名字会让选了一道题顶掉另一道题（同 `choice-options.tsx`）。
            name={`correct-${node.id}`}
            checked={correctKeys[0] === option.key}
            onChange={() => onDataChange({ correctKeys: [option.key] })}
          />
          <span>{option.text}</span>
        </label>
      ))}
      {correctKeys.length !== 1 && (
        <span className="worksheet-editor-warn-hint">还没有指定正确答案 —— 在「对」或「错」上点一下</span>
      )}
    </div>
  );
}
