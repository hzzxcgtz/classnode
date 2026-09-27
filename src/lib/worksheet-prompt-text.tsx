import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { blankAnswerStyle, inputWidthCh, isBlankRun, promptRunStyle, type PromptRun } from './worksheet-prompt-marks';

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
   * ★ 2026-09-26：**填空域的输入绑定**（教师裁定：「填空是在题目文字中间输入」）。
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
  /** 第 `index` 个空（**从 0 起、从左到右**）被改了。⚠️ 落点模式下**不会**被调用（不许打字）。 */
  onChange: (index: number, value: string) => void;
  disabled: boolean;
  /** 混合作答时决定某一空画输入框还是落词槽；缺省时保持原来的整题模式。 */
  modeOf?: (index: number) => 'input' | 'drop';
  /**
   * ★ 2026-09-26：**落点模式**（「选择填空」）—— 空不是一个能打字的输入框，
   * 而是一个**等着被拖入的槽**。
   *
   * 🔴 为什么是同一个渲染器的另一种模式、而不是另写一份：题干里那几个空的位置
   * 与切分逻辑只有一段代码（`runs` 的分段），另写一份就是本仓最防的那种分叉 ——
   * 症状是「填空题的空在这个位置、选择填空的空在那个位置」。
   */
  /**
   * ★ 2026-09-27：第 `index` 个空**答错时应该是什么**（正确答案）。`null` = 没有这一格
   *（答对了 / 没提交 / 教师没设答案键）。
   *
   * 🔴 **只在已提交的题上有值** —— 服务端刻意剥掉整张答案键、只放行答错的几个空。
   * ⇒ 渲染这一侧**拿到什么画什么，不再自己判**「该不该显示」。
   * ⚠️ 它在**外层**绑定上、不在 `drop` 里：打字那条路（input）也要用它。
   */
  wrongOf?: (index: number) => boolean;
  drop?: {
    /** 第 `index` 个空的落点 id（写进 `data-drop-id`，拖拽那一层按它找人）。 */
    idOf: (index: number) => string;
    /** 点了这个空（点选那一条路：先点词、再点空）。 */
    onPlace: (index: number) => void;
    /** 此刻「手里拿着」的那个词 —— 有值时把空格点亮，告诉学生「可以放这儿」。 */
    pending: string | null;
    /** 拖拽时指针正经过的落点 id。只突出当前这一格，避免所有空一起抢眼。 */
    activeId?: string | null;
    /** 紧跟在某个空后面的内容（选择填空的“（阳光 水分）”形式）。 */
    after?: (index: number) => ReactNode;
  };
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
          if (blanks && blanks.drop && blanks.modeOf?.(blankIndex) !== 'input') {
            const index = blankIndex;
            const filled = (blanks.values[index] ?? '') !== '';
            // ★ 答错 ⇒ 原答案红色 + 删除线。（正确答案不在这里 —— 见 `wrongOf` 的注释。）
            const wrong = blanks.wrongOf?.(index) ?? false;
            const dropId = blanks.drop.idOf(index);
            const active = blanks.drop.activeId === dropId;
            // 落点：一个**槽**，不是输入框（学生不许在这里打字 —— 词只能从待选区来）。
            // ⚠️ 宽度取那段占位的长度，与普通填空的空**同一套版面**。
            return (
              <Fragment key={run.start}>
              <span
                data-drop-id={dropId}
                aria-label={`第 ${index + 1} 空`}
                onClick={blanks.disabled ? undefined : () => blanks.drop?.onPlace(index)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: `${Math.max(3, run.end - run.start)}ch`,
                  minHeight: '34px',
                  padding: '3px 8px 1px',
                  margin: '-3px 3px -4px',
                  borderBottom: active ? '2px solid #2563eb' : '1.5px solid #94a3b8',
                  background: active ? '#eaf2ff' : filled ? '#f1f5f9' : '#f8fafc',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(37, 99, 235, .22)' : 'none',
                  borderRadius: '4px 4px 2px 2px',
                  // ★ 2026-09-27：字重不再写死 600 —— 与打字那条路**共用同一条规则**
                  //（`blankAnswerStyle`）。此前两处各写一套，教师看到「同一个空、
                  //  换个模式粗细就变了」。
                  ...(blankAnswerStyle(run) as CSSProperties),
                  // 🔴 **必须在下面那次展开之后**：`blankAnswerStyle` 里含 `promptRunStyle` 的 `color`，
                  //    写在它前面会被整个盖掉（2026-09-27 教师看到「打字那条红了、待选区那条没红」就是这一条）。
                  color: blanks.drop.pending && !filled ? '#2563eb' : undefined,
                  textAlign: 'center',
                  verticalAlign: 'baseline',
                  cursor: blanks.disabled ? 'default' : 'pointer',
                  transition: 'background-color .16s ease-out, border-color .16s ease-out',
                }}
              >
                {filled ? blanks.values[index] : '\u00a0'}
              </span>
              {/* ★ 2026-09-27：答错 ⇒ 一个细红叉（**内联 SVG，不用 emoji** —— 学生端跑在学校的旧
                  iPad 上，emoji 各家字体渲染差很远）。`role="img"` + `aria-label`：光秃秃一个叉对
                  读屏无意义（本仓立过「图标化只减视觉宽度、不减无障碍信息」）。 */}
              {wrong && (
                <sup role="img" aria-label="答错了" style={{ color: '#dc2626', marginLeft: 3, lineHeight: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </sup>
              )}
              {blanks.drop.after?.(index)}
              </Fragment>
            );
          }
          if (blanks) {
            const index = blankIndex;
            // ★ 同 drop 分支：答错 ⇒ 框里的字红色 + 删除线，正确答案写在**框外**后面。
            // ⚠️ 框仍然是 `<input>`（截图里那个「保存修改」要能用 —— 学生得能改）。
            const wrong = blanks.wrongOf?.(index) ?? false;
            return (
              <Fragment key={run.start}>
              <input
                type="text"
                value={blanks.values[index] ?? ''}
                disabled={blanks.disabled}
                // 读屏要能说清是哪一格（空与空之间可能隔着好几行题干）。
                aria-label={`第 ${index + 1} 空`}
                onChange={(event) => blanks.onChange(index, event.target.value)}
                // ★ 2026-09-26（教师）：「填写时这个框要重新设计，太粗、太突兀。
                // 另外在输入的长度较长时，这个区域的宽度要自适应增大。」
                // ⇒ 边框 / 焦点态 / 内边距那些搬到 `globals.css` 的
                // `.worksheet-blank-input`（行内样式写不了 `:focus`，而「太粗」的
                // 那圈正是浏览器**默认的焦点框**）。
                className="worksheet-blank-input"
                style={{
                  // 同一条规则（此前这里是 `promptRunStyle` ⇒ 400，而 drop 那边是 600）。
                  ...(blankAnswerStyle(run) as CSSProperties),
                  // 🔴 宽度**跟着内容长**：`ch` 是半角数字的宽，汉字占两格 ⇒
                  // 用 `inputWidthCh` 算（那一行算术有用例）。
                  // ⚠️ 同时**不小于占位那一段**（`run.end - run.start`）——
                  // 空着的时候要与那串下划线一样宽，否则一填字版面就跳。
                  width: `${Math.max(Math.max(3, run.end - run.start), inputWidthCh(blanks.values[index] ?? '') + 2)}ch`,
                }}
              />
              {/* ★ 2026-09-27：答错 ⇒ 一个细红叉（**内联 SVG，不用 emoji** —— 学生端跑在学校的旧
                  iPad 上，emoji 各家字体渲染差很远）。`role="img"` + `aria-label`：光秃秃一个叉对
                  读屏无意义（本仓立过「图标化只减视觉宽度、不减无障碍信息」）。 */}
              {wrong && (
                <sup role="img" aria-label="答错了" style={{ color: '#dc2626', marginLeft: 3, lineHeight: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </sup>
              )}

              </Fragment>
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
