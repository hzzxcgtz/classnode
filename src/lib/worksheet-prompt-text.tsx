import type { CSSProperties, ReactNode } from 'react';
import { promptRunStyle, type PromptRun } from './worksheet-prompt-marks';

/**
 * 题干那一段文字的**唯一一份渲染**（★ 2026-09-26）。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────
 * 在此之前题干有**两份**渲染实现：学生端面板一处、教师编辑页「折叠时那一眼」另写一处
 *（`worksheet-editor-question-preview-prompt`）。两份都在读同一份样式，而**谁也不会
 * 因为另一份改了而报错** —— 本仓最防的那种分叉（症状是「预览里画得出来、学生那里
 * 画不出来」）。加上行内格式之后，两份各自实现一遍区间切分等于把这个分叉翻倍。
 *
 * ── 为什么只写行内样式、不带类名 ────────────────────────────────────────────
 * 两个调用方分属**两套 CSS 模块**：学生端是 `worksheet.module.css`（受 Safari 15
 * 门禁扫），教师端是 `globals.css`。本组件在两边的**基线**（字号 / 行高 / 颜色）
 * 由调用方那个元素的类决定，它自己只负责「哪一段是什么格式」。
 * ⇒ 它才放得进 `src/lib`：**一个实现，三处用**（学生端面板、编辑页折叠预览、
 * 第 4 步那个所见即所得编辑器）。
 *
 * ⚠️ 样式本身（含着重号那两个 `-webkit-` 属性）在 `promptRunStyle` 里，**有用例钉着** ——
 * 那是本次最容易被人「顺手清理」掉、而清理之后在老 iPad 上**静默不显示**的东西。
 */
export interface PromptTextProps {
  /** 题干**原文**（未 trim —— 渲染的就是原文，首尾空白由调用方的 `white-space` 决定）。 */
  text: string;
  /** `readPromptRunsFor(node)` 的结果（归一化过的分段）。 */
  runs: PromptRun[];
  /** 题干为空时显示的东西。⚠️ 两处措辞不同，所以由调用方给。 */
  placeholder: ReactNode;
}

export function PromptText({ text, runs, placeholder }: PromptTextProps) {
  // ⚠️ 判空用 `trim()`，渲染用**原文** —— 与合并之前那两处逐字同一条判据
  //（全是空白的题干要显示占位语，而不是一条看不见的空行）。
  if (!text.trim()) return <>{placeholder}</>;
  return (
    <>
      {runs.map(run => (
        // ⚠️ `key` 用 `start`：分段是拼满且不重叠的，所以 start 天然唯一。
        <span key={run.start} style={promptRunStyle(run) as CSSProperties}>
          {text.slice(run.start, run.end)}
        </span>
      ))}
    </>
  );
}
