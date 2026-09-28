'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import { emptyDraftFor } from '@/lib/worksheet-answer-value';
import { isInkNode } from '@/lib/worksheet-ink';
import { CategorizeBody } from './categorize-body';
import { ChoiceBody } from './choice-body';
import { InkBody } from './ink-body';
import { MatchBody } from './match-body';
import { OrderBody } from './order-body';
import styles from '../worksheet.module.css';

/**
 * **作答区的分派器** —— 同一份 `content`（题干 + 作答控件）在屏幕上只有这一份实现。
 *
 * 🔴 这个文件的**存在理由**是消掉一处已知的漂移风险：作答区被**两段 JSX**画出来 ——
 * 学生端的作答面板（`worksheet-panel.tsx` 的 `WorksheetQuestionList`）与教师端的
 * 「学生端预览」（`preview-modal.tsx`，它渲染的是**同一个** `WorksheetQuestionList`）。
 * 在 D2 之前，那里的作答区是一条平铺的 `node.type === …` 链；M4a 一次加 6 个题型
 * ⇒ 两份各加 6 支 ⇒ **必然漂移**，而症状是「教师预览里画得出来、学生那里画不出来」，
 * **没有任何报错**（`worksheet-questions.ts` 的文件头为「题型词汇表」写过同一条理由）。
 *
 * ⇒ 一个 `QuestionInput`，内部按 `node.type` 分派；6 个作答体各管一个题型家族。
 * 学生端面板与预览弹窗**都只引它**，两处不可能再分叉。
 *
 * ── 只读态（`disabled`）────────────────────────────────────────────────────
 * 教师端的预览以 `disabled` 渲染：控件带 `disabled` 属性、手势全部不生效（`usePointerDrag`
 * 的 `disabled`），但**题面与控件的形状一个都不少** —— 那句「教师看到的就是学生看到的
 * 宽度」（规格 §6.3）说的是**看到的东西一样**，不是「能操作」。
 * ⚠️ 按钮类的控件（▲▼ / 条目）还要自己上加 `disabled` 属性，见各自的文件。
 *
 * ── 未知题型 ───────────────────────────────────────────────────────────────
 * 库里手工改过的一行可能有任何题型串。**明说一句**，而不是渲染成一个空的题
 *（学生会以为界面坏了）—— 这与 D2 之前面板上那句话逐字相同，只是搬到了这里，
 * 因为它现在与分派是同一件事。
 */
export interface QuestionInputProps {
  node: WorksheetQuestionNode;
  /**
   * 这一题的输入态。`undefined` = **学生一个指头都还没动过**（面板的 `drafts` 里没有它）。
   *
   * ⚠️ 它**不是**「空输入态」的同义词，而且这个区别是有用的：排序题的「空输入态」
   * 是一列已经排好的条目（`data.items` 的存储顺序），而「还没碰过」意味着那一列是
   * **屏幕上显示的起点**、不是学生写的作答。面板据此决定「提交本题」能不能点
   *（见 `worksheet-panel.tsx` 的 `untouched`）。
   */
  draft: AnswerDraft | undefined;
  /** 输入态变了。**只在真的有变化时**调（拖拽的每一帧都不写，见 `use-pointer-drag.ts`）。 */
  onChange?: (node: WorksheetQuestionNode, draft: AnswerDraft) => void;
  disabled: boolean;
  /**
   * ★ 2026-09-27：**选择题 / 判断题的正确答案**（选项 key），服务端在判过分、且学生没全对
   * 时才下发。只有 `ChoiceBody` 读它。
   *
   * 🔴 **学生端那条路给它，教师端的预览不给**（`preview-modal.tsx` 不传）——
   * 教师预览里出现「正确答案 B」会让他以为学生也看得到答案。
   * ⚠️ 所以这里必须是**可选**的，而且默认的「没给」= **不打叉、不写答案**（不是「全错」）。
   */
  correctKeys?: string[];
  /**
   * ★ 2026-09-28：**答错时要给的正确答案**（下标 → 一句话）。
   * ⚠️ 与填空共用同一个 prop 名与同一个形状 —— 服务端那道窄口（`wrongAnswers`）
   * 两个题型发的就是同一个 `Record<index, string>`（那半边的键名是 `correctBlanks`）。
   * 连线题拿到的是「《绝句》 → 《望庐山瀑布》」这样一整句话。
   */
  correctBlanks?: Record<string, string>;
}

export function QuestionInput({ node, draft, onChange, disabled, correctKeys, correctBlanks }: QuestionInputProps) {
  /**
   * 这一题的**起点**（形状一定与 `node.type` 同族）。
   *
   * 🔴 兜底**必须**走它，不能在各分支里现写一个空态：填空的起点是「与 `data.blanks`
   * 等长的一列空串」，写死 `{ texts: [''] }` 会让一道**多空**填空题在兜底路径上
   * **少画几个框** —— 学生填不了那个空，而且屏幕上看起来一切正常
   *（这条是渲染烟测抓出来的：只读态只画了一个框，而可交互态画了两个）。
   * 排序同理（起点是 `data.items` 的顺序），只是它的作答体自己会补齐条目。
   */
  const start = emptyDraftFor(node);
  /**
   * 学生写的那一支；形状对不上（题被改过 / 状态来自上一个版本）就回落到起点。
   *
   * ⚠️ `as` 断言只有一个出口（这里）：下面每个分支各写一遍 `draft.kind === …`
   * 会在某一次改动里漏掉一支，而漏掉的表现是**白屏**。
   *
   * 🔴 **下面那六个 `?? { kind: … }` 是死代码**（已知题型的 `start` 一定同族），
   * 它们的唯一作用是让类型完整 —— **它们因此没有任何回归网**：谁把某一支改回写死的值
   * （比如把填空那支写成 `{ kind: 'fill', texts: [''] }`），**测试一条都不会红**，
   * 而屏幕上多空填空题会少画几个框。2026-09-24 的渲染烟测正是这样抓到那个缺陷的
   * （写死的 `['']` vs 起点 `['', '']`）。判据在**上一层**：`emptyDraftFor` 对每个题型
   * 给的起点由 `worksheet-answer-value.test.ts` 逐条钉着（多空是 `['', '']`），
   * 所以正确的写法是**永远从 `emptyDraftFor` 取**，别在这里写任何字面量。
   */
  const pick = <K extends AnswerDraft['kind']>(kind: K): Extract<AnswerDraft, { kind: K }> | null => {
    if (draft && draft.kind === kind) return draft as Extract<AnswerDraft, { kind: K }>;
    if (start.kind === kind) return start as Extract<AnswerDraft, { kind: K }>;
    return null;
  };

  /**
   * ★ M4b：画布支（`InkBody`）。**两条判据都要**：题型是画布题（`isInkNode(node)`）
   * **且**输入态是 ink 形状（`pick('ink')` 非空）。
   *
   * ⚠️ 只写 `pick('ink')` 会在**可达**的路上走成死胡同：教师用编辑器里那个「作答方式」
   * 开关，把一道**已经被学生作答过**的手写问答改回键盘 ⇒ 库里那一行仍是 `ink/v1` ⇒
   * `draftFromValue` 会把它读回来（A2 的既有用例逐字要求它读得回来：教师改题不该让
   * 学生那幅画消失）⇒ `pick('ink')` 非空 ⇒ **一道键盘问答题上出现画布，而学生画完提交不了**
   * （`buildAnswerValue` 对 `short-answer` + ink 输入态回 `null` ⇒ 「提交本题」按死）。
   * ⇒ 判据是「**题型是画布题 且 输入态是 ink 形状**」。题型这一半赢，代价是那个学生
   * 在自己屏幕上看到的是空 textarea 而不是旧笔画 —— 值在库里、教师在抽屉里都还看得到，
   * 而且他现在能正常作答（那正是这道题当下该有的样子）。
   *
   * ⚠️ 必须排在下面那条 `node.type === 'single-choice' || …` 之前，理由与 A2 的
   * `valueFromDraft` 里「ink 支必须排在题型分支之前」逐字相同：手写的**问答题**会先命中
   * `short-answer` 那一支，`pick('text')` 回 `null` ⇒ 落到写死的 `{ kind: 'text', text: '' }`
   * ⇒ 学生看到一个**空 textarea**，而他的笔迹在库里、在教师抽屉里都能看见。
   *
   * 🔴 这里**不**给 ink 写 `?? { kind: 'ink', … }` 那种字面量兜底：`pick('ink')` 取的已经是
   * `emptyDraftFor(node)` 给的那一份（画布题的起点就是 ink），凭空写一个字面量就是在
   * 本文件里立第二份真源 —— 上面 `pick` 的文档注释（本文件 `:72-79`）点名的
   * 「六个 `?? { kind: … }` 是死代码、**没有任何回归网**」说的正是这件事。
   */
  if (isInkNode(node)) {
    const ink = pick('ink');
    if (ink) {
      return (
        <InkBody node={node} draft={ink} onChange={(next) => onChange?.(node, next)} disabled={disabled} />
      );
    }
  }
  if (node.type === 'single-choice' || node.type === 'true-false' || node.type === 'multi-choice') {
    return (
      <ChoiceBody
        node={node}
        draft={pick('choice') ?? { kind: 'choice', selected: [] }}
        onChange={(next) => onChange?.(node, next)}
        disabled={disabled}
        // ★ 2026-09-27：答错的叉与「正确答案」那句话都读它。⚠️ 教师端的预览不传
        //（见 prop 上的注释）⇒ 那里一处都不会出现。
        correctKeys={correctKeys}
      />
    );
  }
  // ★ 2026-09-26：填空题的空住在**题干里**（教师裁定：「填空是在题目文字中间输入」），
  // 那些输入框由**题干那一份渲染器**画（`PromptText` 的 `blanks`，见 `worksheet-panel.tsx`）。
  // ⚠️ `FillBody` 已经**完全走不到**（迁移早已上线，而且下面那句 `return null` 在它之前
  // 就返回了；文件里连 import 都没有）。⊘ 2026-09-28：这句原来写「这里仍然保留 FillBody，
  // 但它只在题干里还没有空时才画东西」—— 那是假话，`return null` 在它上面。
  // ★ 2026-09-26：**选择填空**的作答**跨了题干与题干下方**（空在题干里、待选词在下面），
  // 而拖拽的手势状态必须在一个组件里 ⇒ 整块由 `ChoiceBlankAnswer` 接管，
  // 由**面板**渲染（见 `worksheet-panel.tsx` 里那一条分支）。
  // 🔴 这里**不能**再画一份：那会让待选词出现两组，而两组各有一份选中态。
  if (node.type === 'choice-blank' || node.type === 'fill-blank') return null;
  if (node.type === 'short-answer') {
    return (
      <TextBody
        draft={pick('text') ?? { kind: 'text', text: '' }}
        onChange={(next) => onChange?.(node, next)}
        disabled={disabled}
      />
    );
  }
  if (node.type === 'order') {
    return (
      <OrderBody
        node={node}
        draft={pick('order') ?? { kind: 'order', order: [] }}
        onChange={(next) => onChange?.(node, next)}
        disabled={disabled}
      />
    );
  }
  if (node.type === 'match') {
    return (
      <MatchBody
        correctBlanks={correctBlanks}
        node={node}
        draft={pick('match') ?? { kind: 'match', links: [] }}
        onChange={(next) => onChange?.(node, next)}
        disabled={disabled}
      />
    );
  }
  if (node.type === 'categorize') {
    return (
      <CategorizeBody
        node={node}
        draft={pick('categorize') ?? { kind: 'categorize', assignment: {} }}
        onChange={(next) => onChange?.(node, next)}
        disabled={disabled}
      />
    );
  }
  return <p className={styles.cardNote}>（这道题的题型暂时没法在这里作答）</p>;
}

/**
 * 问答题（`short-answer`）的作答体 —— 一个多行输入框。
 *
 * ⚠️ 它住在**本文件**里而不是像其它题型那样单独成文件：它是**唯一**没有交互逻辑的
 * 一个（一个 `<textarea>` 与 onChange），为它开一个 30 行的文件只会让「6 个作答体」
 * 这个说法与实际文件数对不上。
 *
 * 🔴 软键盘 / viewport 那一套走**面板级**的共用 hook（`shell/use-module-viewport.ts`，
 * 规格 §3-AB / §14.2），这里**一行都不许复制**：两个模块各写一套必然分叉，
 * 其中一个修了 bug 另一个没修。`fill-body.tsx` 的文件头写着这条的完整理由
 * （以及「为什么这个组件自己**不**调那个 hook」）。
 */
function TextBody({ draft, onChange, disabled }: {
  draft: Extract<AnswerDraft, { kind: 'text' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}) {
  return (
    <textarea
      className={`${styles.input} ${styles.textarea}`}
      value={draft.text}
      rows={3}
      disabled={disabled}
      placeholder="在这里作答"
      onChange={(event) => onChange({ kind: 'text', text: event.target.value })}
    />
  );
}
