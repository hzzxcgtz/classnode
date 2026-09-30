import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { DEFAULT_PROMPT_STYLE, blankAriaLabel, blankValueStyle, inputWidthCh, isBlankRun, promptTextStyle, type PromptRun } from './worksheet-prompt-marks';
// ★ 2026-09-30：题面里的数学公式（`$x^2$`）。**切分**是纯逻辑（`worksheet-math.ts`，16 条
// 边界用例钉着），**画**是 `worksheet-math-view.tsx`（全仓唯一一处调 KaTeX 渲染题面公式的
// 地方 —— 这里不许再调一次）。
import { splitMath } from './worksheet-math.ts';
import { MathSpan } from './worksheet-math-view.tsx';
// ★ 2026-09-27：答错标记搬去了 `@/components/worksheet-wrong-mark` —— 选择题的选项现在也要
// 用它，而从「题干渲染器」里导出它读起来是错的层次（那枚标记自己写着完整理由）。
import { BlankSlot } from './worksheet-blank-slot.tsx';
import { TABLE_MARK_TEXT } from './worksheet-table.ts';
import { WorksheetTableView } from './worksheet-table-view.tsx';

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
  /**
   * `readPromptRunsFor(node)` 的结果（归一化过的分段）。
   *
   * ★ 2026-09-30 起**可选**：选项 / 条目 / 框名 / 表格单元格 / 答案那些「纯文本」场景
   * 不传它，内部按「一个覆盖全文的默认分段」处理。
   * 🔴 让纯文本也走**这一个**组件（而不是新写一个渲染器），是因为两份渲染器就是本仓
   *    最防的那种分叉 —— 这个文件的文件头记着一次同类的账（题干曾经有两份实现，
   *    症状是「预览里画得出来、学生那里画不出来」）。
   */
  runs?: PromptRun[];
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
  /**
   * ★ 2026-09-28（教师）：**表格域** —— 题干里那个 `{表格域}` 标记处画的那张表。
   *
   * ⚠️ 标记是**纯文本**（没有自己的分段，照 `{填空域}` 那条「由文本决定」的裁定），
   * 所以它在普通分段里被就地认出来。本组件是**唯一**一份实现：学生端、教师端折叠
   * 预览、编辑页都走它 —— 三处各画一次就是本仓最防的那种分叉。
   * ⚠️ 它是这一层唯一一个**块级**元素（其余全是行内 `<span>`）⇒ 调用方的容器
   * 不能是 `<p>`（浏览器会把 `<p>` 在表格前闭掉，DOM 与 JSX 就对不上了）。
   */
  table?: unknown;
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
  /**
   * ★ 2026-09-28：表格里的空从第几号开始（= `blankLayout(node).tableBase`）。
   * ⚠️ **标记之后的文本空要接着表格往后数** —— 编号就是 `answers` 的下标。
   */
  tableBase?: number;
  /** 表格里有几个空（走标记时把编号往前推这么多，那些号被表格占了）。 */
  tableCount?: number;
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

/* ⊘ 2026-09-27 删除：`WRONG_MARK_ANCHOR`（`position: absolute; top: 1; right: 2`）。
 *
 * 它把标记**绝对定位在盒子右上角**，而那个盒子是「按内容算宽 + 2ch 富裕」的输入框 ⇒
 * 学生的答案一长，红叉就**压在字上**。教师 2026-09-27 报的正是这个（「叉叉打上后原来的字
 * 会最淡」—— 字被叉盖住了一角）。
 *
 * 🔴 **标记一律走布局，不走定位。** 两条路现在都是「文字后面的一个普通兄弟节点」：
 * 槽那边靠 flex（`alignSelf`），输入框那边就是紧跟其后的一个内联兄弟。
 * ⚠️ 所以这个文件里**一个 `position: absolute` 都不该再有**（`worksheet-prompt-text.test.ts`
 *    那条用例钉着这一点：绝对定位回来 = 那个叉又能盖住字）。
 */

/**
 * 一段文字 → React 节点，**公式就地切成 `MathSpan`**（★ 2026-09-30）。
 *
 * 🔴 与 `{表格域}` 的切分是**同一个模式**（那也是先把 chunk 切成 head / 表格 / tail）——
 *    顺序无所谓，两者互不干扰（`{表格域}` 里没有 `$`，公式里的 `{}` 也拼不出那五个字）。
 * ⚠️ 认不出来的 `$` 由 `splitMath` **原样带回**（那是它的安全阀），所以这里不需要任何
 *    兜底分支 —— 一个字都不会丢。
 */
function renderInline(text: string, run: PromptRun, plain: boolean): ReactNode {
  // ★ 2026-09-30：`plain`（调用方**没给** `runs`）= 纯文本场景 ⇒ **不写行内样式**。
  // 🔴 见 `promptTextStyle` 的注释：`promptRunStyle` 永远返回 `color` 与 `fontWeight`，
  //    而行内样式**永远赢过**父容器继承下来的值 ⇒ 会把「答错选项的红字」「正确答案的
  //    深红 + 加粗」「归类框名的字重」「看板上未勾选=灰」这些**教师已经做过的决定**
  //    静默打掉。那批全是交付当天复审抓出来的。
  const style = promptTextStyle(run, plain) as CSSProperties | undefined;
  const pieces = splitMath(text);
  // 常见情形（这一段里没有公式）：走原来那条老路，不多造一层 Fragment。
  if (pieces.length === 1 && pieces[0].kind === 'text') {
    return <span style={style}>{text}</span>;
  }
  return pieces.map((piece, index) => (
    piece.kind === 'math'
      // ⚠️ `key` 用下标：`splitMath` 不返回位置，而下标在这个数组里天然唯一、稳定
      //（同一段文字的切分结果是确定的）。
      ? <MathSpan key={index} tex={piece.tex} />
      : <span key={index} style={style}>{piece.text}</span>
  ));
}

export function PromptText({ text, runs, placeholder, blanks, table }: PromptTextProps) {
  // ⚠️ 判空用 `trim()`，渲染用**原文** —— 与合并之前那两处逐字同一条判据
  //（全是空白的题干要显示占位语，而不是一条看不见的空行）。
  if (!text.trim()) return <>{placeholder}</>;
  // ★ 2026-09-30：没给 `runs` ⇒ 整段**一个默认分段**（选项 / 条目 / 框名 / 表格单元格 /
  // 答案那些纯文本场景）。样式取默认档，`blank` 是空串（**不是**一个空域）。
  const plain = runs === undefined;
  const segments: PromptRun[] = runs ?? [{ start: 0, end: text.length, blank: '', ...DEFAULT_PROMPT_STYLE }];
  // ⚠️ 空是**按出现先后**编号的（第几个空 = 它前面有几个空分段）—— 就地数，
  // 不从外面传：那个数就是 `data.answers` 的下标，两处必须由同一条规则给。
  let blankIndex = -1;
  /**
   * ★ 2026-09-28：**标记之后的文本空要接着表格往后数**。
   *
   * 表格域把一行文本切成了两段，而空的编号是 `data.answers` 的下标、顺序是
   * 「标记前的文本空 → 表格空 → 标记后的文本空」（`blankLayout` 那一条）。
   * ⇒ 走过标记时把计数器一次推过表格占掉的那几号。
   * ⚠️ 少了这一推，标记**后面**的空会拿到表格那几号的下标 ⇒ 学生填的答案与
   * 判分取的位置**整体错位**，而屏幕上一切正常（本仓最防的那一类）。
   */
  let tableOffset = 0;
  return (
    <>
      {segments.map((run) => {
        if (isBlankRun(run)) {
          blankIndex += 1;
          if (blanks && blanks.drop && blanks.modeOf?.(blankIndex + tableOffset) !== 'input') {
            const index = blankIndex + tableOffset;
            const dropId = blanks.drop.idOf(index);
            return (
              // ★ 2026-09-28：槽的**画法**搬去了 `worksheet-blank-slot.tsx`
              //（表格里的空现在也能是槽 —— 两处必须长得一样）。
              <BlankSlot
                key={run.start}
                run={run}
                width={`${Math.max(3, run.end - run.start)}ch`}
                value={blanks.values[index] ?? ''}
                label={`第 ${index + 1} 空`}
                wrong={blanks.wrongOf?.(index) ?? false}
                disabled={blanks.disabled}
                active={blanks.drop.activeId === dropId}
                pending={blanks.drop.pending}
                dropId={dropId}
                onPlace={() => blanks.drop?.onPlace(index)}
              >
                {blanks.drop.after?.(index)}
              </BlankSlot>
            );
          }
          if (blanks) {
            const index = blankIndex + tableOffset;
            // ★ 2026-09-29（教师）：**答错不再是一枚红叉**，而是把这个框里的字改成
            // 暗红 + 删除线。原来那个 `inline-block` 的包裹层是为了让「框 + 叉」整体换行，
            // 叉没了它也就没用了（`<input>` 自己就是 `inline-block`，换行行为一样）。
            //
            // ⊘ 一段旧账（换形状的理由就在里面）：2026-09-27 教师报「叉叉打上后原来的字会最淡」，
            //    真因是**红叉压在字上**（它绝对定位在框的右上角，而框按内容算宽 ⇒ 答案一长就被
            //    盖掉一角）。当时的修法是把叉挪到框**外面**；现在的修法更彻底 ——
            //    **行内不再有第二个节点**，那一类缺陷从结构上没有了。
            // ⚠️ 框仍然是 `<input>`（学生得能改），而 `.worksheet-blank-input:disabled` 写的是
            //    `color: inherit` ⇒ 禁用态不会用 UA 的灰色盖掉这层暗红。
            const wrong = blanks.wrongOf?.(index) ?? false;
            return (
              <input
                key={run.start}
                type="text"
                value={blanks.values[index] ?? ''}
                disabled={blanks.disabled}
                // 读屏要能说清是哪一格（空与空之间可能隔着好几行题干）。
                // ★ 答错时把「答错了」并进来：删除线对读屏是无声的（原来那枚红叉自带
                // `aria-label="答错了"`，换形状时那条信息不能丢）。
                aria-label={blankAriaLabel(`第 ${index + 1} 空`, wrong)}
                onChange={(event) => blanks.onChange(index, event.target.value)}
                // ★ 2026-09-26（教师）：「填写时这个框要重新设计，太粗、太突兀。
                // 另外在输入的长度较长时，这个区域的宽度要自适应增大。」
                // ⇒ 边框 / 焦点态 / 内边距那些搬到 `globals.css` 的
                // `.worksheet-blank-input`（行内样式写不了 `:focus`，而「太粗」的
                // 那圈正是浏览器**默认的焦点框**）。
                className="worksheet-blank-input"
                style={{
                  // 🔴 走 `blankValueStyle`（不是 `blankAnswerStyle` + 自己叠答错色）：
                  // 顺序（答错那层必须在后）由那个有测试的函数定死，两个调用点各写一遍会分叉。
                  ...(blankValueStyle(run, wrong) as CSSProperties),
                  // 🔴 宽度**跟着内容长**：`ch` 是半角数字的宽，汉字占两格 ⇒
                  // 用 `inputWidthCh` 算（那一行算术有用例）。
                  // ⚠️ 同时**不小于占位那一段**（`run.end - run.start`）——
                  // 空着的时候要与那串下划线一样宽，否则一填字版面就跳。
                  width: `${Math.max(Math.max(3, run.end - run.start), inputWidthCh(blanks.values[index] ?? '') + 2)}ch`,
                }}
              />
            );
          }
        }
        const chunk = text.slice(run.start, run.end);
        const markAt = chunk.indexOf(TABLE_MARK_TEXT);
        if (markAt < 0) {
          return (
            // ⚠️ `key` 用 `start`：分段是拼满且不重叠的，所以 start 天然唯一。
            // ★ 2026-09-30：这一段改走 `renderInline` —— 它会就地把公式切成 `MathSpan`；
            // 这一段里没有公式时，行为与原来那个 `<span>` 逐字相同（有一条快速路径）。
            <Fragment key={run.start}>{renderInline(chunk, run, plain)}</Fragment>
          );
        }
        // ★ 2026-09-28：这一段里有**表格域标记** —— 就地画那张表。
        // ⚠️ 标记是纯文本（没有自己的分段），所以只能这样在普通分段里认。
        // ⚠️ 一个分段里**最多一处**标记（编辑期与校验都拦「两份标记」）；真的出现两处时
        //    第二处会跟着 `after` 一起当普通文字画出去 —— 那是坏数据的样子，不是静默的错。
        tableOffset = blanks?.tableCount ?? tableOffset;
        const head = chunk.slice(0, markAt);
        const tail = chunk.slice(markAt + TABLE_MARK_TEXT.length);
        return (
          <Fragment key={run.start}>
            {head ? renderInline(head, run, plain) : null}
            {table
              ? (
                <WorksheetTableView
                  table={table}
                  blanks={blanks ? { ...blanks, base: blanks.tableBase ?? 0 } : undefined}
                />
              )
              // ⚠️ 没有 `table`（例如题目结构坏掉）⇒ 如实画出标记本身，别假装那里什么都没有
              : <span style={promptTextStyle(run, plain) as CSSProperties | undefined}>{TABLE_MARK_TEXT}</span>}
            {tail ? renderInline(tail, run, plain) : null}
          </Fragment>
        );
      })}
    </>
  );
}
