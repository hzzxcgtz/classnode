import type { CSSProperties, ReactNode } from 'react';
import { isBlankRun, promptRunStyle, type PromptRun } from './worksheet-prompt-marks';

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
  /**
   * ★ 2026-09-26：**填空区域的输入绑定**（教师裁定：「填空是在题目文字中间输入」）。
   *
   * ⚠️ **有它 ⇒ 空画成输入框；没有它 ⇒ 空画成那串下划线占位**（教师端的只读预览）。
   * 这是同一份渲染器的两种用途，不是两套实现 —— 学生端那个框与教师端预览看到的
   * 下划线，切分逻辑是同一段代码。
   *
   * ⚠️ `values` 按**从左到右**（`blankRuns` 的顺序），与 `data.answers` 同一个口径。
   */
  blanks?: PromptBlankBinding;
}

export interface PromptBlankBinding {
  /** 每个空的当前值（按从左到右）。长度不足时缺的那几格当空串。 */
  values: string[];
  /** 第 `index` 个空（**从 0 起、从左到右**）被改了。 */
  onChange: (index: number, value: string) => void;
  disabled: boolean;
}

export function PromptText({ text, runs, placeholder, blanks }: PromptTextProps) {
  // ⚠️ 判空用 `trim()`，渲染用**原文** —— 与合并之前那两处逐字同一条判据
  //（全是空白的题干要显示占位语，而不是一条看不见的空行）。
  if (!text.trim()) return <>{placeholder}</>;
  // ⚠️ 空是**按出现先后**编号的（第几个空 = 它前面有几个空分段）—— 就地数，
  // 不从外面传：那个数就是 `data.answers` 的下标，两处必须由同一条规则给。
  let blankIndex = -1;
  return (
    <>
      {runs.map((run) => {
        if (isBlankRun(run)) {
          blankIndex += 1;
          if (blanks) {
            const index = blankIndex;
            return (
              <input
                key={run.start}
                type="text"
                value={blanks.values[index] ?? ''}
                disabled={blanks.disabled}
                // 读屏要能说清是哪一格（空与空之间可能隔着好几行题干）。
                aria-label={`第 ${index + 1} 空`}
                onChange={(event) => blanks.onChange(index, event.target.value)}
                // ⚠️ 只用行内样式：本组件在 `src/lib`，两套 CSS 模块都不该依赖它
                //（学生端是 `worksheet.module.css`、教师端是 `globals.css`）。
                // 宽度取那段占位的长度 ⇒ 空的宽窄与它原来那串下划线一致，版面不跳。
                style={{
                  ...(promptRunStyle(run) as CSSProperties),
                  display: 'inline-block',
                  width: `${Math.max(3, run.end - run.start)}ch`,
                  padding: '0 2px',
                  border: 'none',
                  borderBottom: '1.5px solid #94a3b8',
                  borderRadius: 0,
                  background: 'transparent',
                  textAlign: 'center',
                  font: 'inherit',
                  verticalAlign: 'baseline',
                }}
              />
            );
          }
        }
        return (
          // ⚠️ `key` 用 `start`：分段是拼满且不重叠的，所以 start 天然唯一。
          <span key={run.start} style={promptRunStyle(run) as CSSProperties}>
            {text.slice(run.start, run.end)}
          </span>
        );
      })}
    </>
  );
}
