import type { WorksheetBoardAnswerRow, WorksheetGradeState, WorksheetQuestionNode } from '@/lib/types';
// 题型的读法（选项、作答值 → 输入态）只有一份，在 `src/lib/worksheet-questions.ts`
// （学生端作答面板与教师端预览都引它）。这里**转出**同一份，不是抄一份。
// ⚠️ 相对路径 + `.ts` 后缀是**必须的**：本文件要能被 `node --test` 直接执行
// （Node 24 的类型擦除会把 `import type` 整段删掉，剩下的运行时 import 必须是
// Node 也解析得了的相对路径）。加一行 `@/…` 的运行时 import 就会让
// `worksheet-drawer-state.test.ts` 整个跑不起来 —— `import type` 那一行是唯一的例外。
import {
  draftFromValue, flattenAnswerable, QUESTION_TYPE_OPTIONS, questionTypeLabel, readOptions,
  type AnswerableQuestion,
  readCategorizeItems, readCategorizeZones, readMatchLeft, readMatchRight, readOrderItems,
  TRUE_FALSE_OPTIONS,
} from '../../../lib/worksheet-questions.ts';
// ★ M4b/E1：笔迹的读数**只有一份实现**（`readInkValue`），这里直接引它。
// 🔴 **刻意不包一层 `readAnswerInk(node, value)`**：包一层多出来的那个 `node` 参数
// 今天用不上，而下一个人会照着它猜「这里是不是该按题型分支」—— 判据**只认 `format`，不看题型**
// （理由见 `formatAnswer` 里那一支的注释）。
// ⚠️ 路径**必须是相对路径 + `.ts` 后缀**（与上面那条同一条纪律，理由在文件头那段）：
// 本文件要能被 `node --test` 直接执行，`@/lib/worksheet-ink` 会让
// `worksheet-drawer-state.test.ts` 整个跑不起来（实测见 E1 报告）。
// `worksheet-ink.ts` 自己**没有任何 import**，所以这条值 import 不会把 `@/` 传染进来。
import { readInkValue, type InkValue } from '../../../lib/worksheet-ink.ts';
// ★ 2026-09-28：奖励的换算**只有一份**（`src/lib/worksheet-reward.ts`，零 import，
// 所以本文件仍然能被 `node --test` 直接跑）。看板这一侧此前**一处都没有**它 —— 见
// `participantOverview` 上面那一段。
import { rewardAmount, rewardSymbol, rewardTotalText, type RewardScale } from '../../../lib/worksheet-reward.ts';

/**
 * 教师看板**学习单抽屉**的两种形态的判据 —— 纯函数，不碰 React / DOM / 网络。
 *
 * 🔴 为什么单独成文件、单独断言：这里每一条判据错了都**不抛异常、不让编译失败**，
 * 只会让教师在课上看到一句错的结论 ——
 *   · 主观题上冒出一个 ✓/½/✗（学生答得对不对，系统根本不知道）；
 *   · 未作答的题上冒出一个「标记已查看」按钮（点下去服务端回 **409**，纯属必然失败）；
 *   · 正确率的分母用错（拿参与者数当分母 ⇒ 一份交了一半的卷子显示「正确率 50%」，
 *     而它其实一道没错）；
 *   · ★ M4a：正确率的**分子**把部分给分算成对（`非 incorrect 即算对` 这种写法在类型上完全合法），
 *     10 行 4 全对 3 部分给分 3 错会显示 70% 而不是 40% —— 见 `questionAggregate` 上面那段；
 *   · ★ M4a：部分给分那一行落进 `wrong` ⇒ 教师把「算进分母却不算对」读成「答错了」；
 *   · 「已交 N/M」的分母漏掉没作答的人（那个数没有任何地方会报错）。
 * 本仓没有前端测试框架（规格 §11），但 `node --test` 能直接跑本文件：
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-drawer-state.test.ts
 * ```
 *
 * ── 数据来源（规格 §7.4）──────────────────────────────────────────────
 *   · 逐题状态 / 判分档（三态）/ 「已查看」 —— `GET /api/worksheets/classroom/:id/answers`
 *     （D4 补的历史读端点；在此之前只有广播，教师刷新一次页面看板就失忆）；
 *   · 题目清单 / 题号 / 题型 / 选项文字 —— `GET /api/worksheets/:id` 的 `content.nodes`
 *     （**只有**它会带答案字段，而它只留在教师端内存里，见 §5.4 的边界：
 *     本模块读它是为了**画题号与题型**，绝不把它下发给学生）。
 */

/** 一道题在这一格上的状态（与看板方格阵同一组取值，规格 §7.2）。 */
export type WorksheetQuestionStatus = 'unanswered' | 'draft' | 'submitted';

/**
 * 这一道题的**判分档**。
 *
 * ★ M4a：从三档（`correct | wrong | none`）扩成**四档**，多出来的是 `partial`。
 * 🔴 为什么必须画得出来：正确率的口径是「**全对才算对**」⇒ 部分给分**进分母、不进分子**，
 * 于是部分给分是**唯一**一种「算进分母却不算对」的行。它若没有自己那一档，就只能
 * 落到 `wrong`（看起来是答错了）或 `none`（看起来是没判分）—— 两句话都是假的。
 *
 * `none` 的来源（界面上都不显示 ✓/½/✗）没变：
 *   · 主观题（问答题）**本来就没有对错** —— 服务端的 `grade()` 对它恒返回 `null`；
 *   · 自动判分关掉时 / 还没提交时 —— `gradeState`（以及兜底的 `isCorrect`）为 `null`。
 * ⚠️ 注意「`gradeState` 认不出来的值」也走这一档（见 `rowVerdict`）：**不猜**。
 *
 * ── 🔴 画在哪、画成什么（E2 的裁定；规格字面已于 2026-09-24 回填）──────
 *
 * **画在抽屉里，不在看板的方格阵里。** §12 那句现在是「部分给分必须在**看板那一侧**画得出来」，
 * 而「看板那一侧」= **抽屉** —— §12 已于 2026-09-24 更正并注明「是抽屉里，不是方格阵的格子」；
 * 更正之前它写的是「**格子**上」，与 §7.2 按字面读会打架（E2 核清的就是这一处）。
 * 判据是 §7.2 把逐题对错**明确排除**在格子之外（「方格阵着色 = 状态…不编码对错」＋
 * 「**对错在抽屉里**（7.3），不在格子里」），而且 §12 自己点名的实现物
 * `WorksheetOutcomeMark` 本来就只由抽屉消费（全仓只有 `worksheet-drawer.tsx` 引它；
 * `worksheet-tile-state.ts` 里连一个 `mark` / `gradeState` 都没有）。
 * ⇒ 核清过程的实测依据见 E2 报告。
 *
 * **符号是 `½`。** 此前 §12 的字面写的是 `◐`，也已于 2026-09-24 一并更正。理由：
 *   · `◐` 在同一份抽屉列表里**已经被占用两次** —— `◐ 作答中` / `◐ 已提交`（没有对错的那一支，
 *     见 `NO_VERDICT_VIEW`），而 §7.3 的图例逐字写着「`◐` = 作答中 / 已提交但**没有对错**」。
 *     同一个符号在一列上带三种含义，「画得出来」就落空了 —— 教师得逐行读字才分得清。
 *   · 学生端 `worksheet-panel.tsx` 也用它表示「作答中」（那倒是不同屏，不是主要理由）。
 *   · `½` 直接读作「一半」，与 `✓ 答对` / `✗ 答错` 并排时同族同宽，且全仓此前零占用。
 * ⇒ 落到代码里是 `{ glyph: '½', label: '部分给分' }`，见 `VERDICT_VIEW`。
 */
export type WorksheetOutcomeMark = 'correct' | 'partial' | 'wrong' | 'none';

/**
 * 哪些题型有对错（**抽屉里**画 ✓/½/✗ 的那些 —— ⚠️ 不是看板格子，见上面 `WorksheetOutcomeMark`
 * 那一段对 §12「格子」二字的核清）。
 *
 * 🔴 **派生，不再并列。** 这里曾经是与题型清单并列的第二份白名单
 * （`['single-choice', 'fill-blank']`），靠它自己的一句注释提醒「将来加新题型时它会自动
 * 落到『没有对错』那一侧」—— 而**漏改的表现不是少一个 ✓，是正确率算错**：
 * 正确率的分母（★ M4a 起是 `questionAggregate` 里 `rowVerdict` 非空的行数，
 * 在那之前是 `isCorrect` 非空的行数）与服务端判分走的是
 * **题型无关**的路，于是一个新的可判分题型会**进分母却不画标记**
 * （⚠️ **本句原话写的是「进分母却不进格子」** —— 按 §7.2 与 §12 的更正，标记**一直**画在
 * **抽屉里**、从来不在方格阵的格子上，所以那个「格子」是笔误，**不是**对当时状态的描述；
 * 引在这里只是免得下一个人以为它说的是两件不同的事），全程无报错。
 * ★ M4a 换的是**读哪个字段**，不是结构：分母仍然与题型无关，这条闸仍然必须存在。
 *
 * 现在「加一个题型」这个动作本身就必须在 `QUESTION_TYPE_OPTIONS` 里回答
 * 「它判不判分」（`graded` 那一格），漂移在结构上不可能发生。
 *
 * ⚠️ 它顺带也是「主观题没有 ✓/½/✗」那条要求的**第二道闸**：即使库里某一行
 * `short-answer` 的 `gradeState`（或兜底的 `isCorrect`）被手工改成了 `'correct'`，这里也不会显示 ✓。
 * 这条闸靠的是 `short-answer` 在 `QUESTION_TYPE_OPTIONS` 里是 `graded: false` ——
 * `worksheet-drawer-state.test.ts` 有一条用例把这两件事钉在一起。
 */
export const GRADED_QUESTION_TYPES: readonly string[] =
  QUESTION_TYPE_OPTIONS.filter((option) => option.graded).map((option) => option.value);

export function isGradedType(type: string): boolean {
  return GRADED_QUESTION_TYPES.includes(type);
}

export interface QuestionOutcome {
  status: WorksheetQuestionStatus;
  /** ✓ / ½ / ✗ / 什么都没有（主观题、未提交、关闭自动判分）。 */
  mark: WorksheetOutcomeMark;
  /** 教师是否已经「查看」过这道题（`reviewedAt` 非空）。 */
  reviewed: boolean;
  /**
   * 该不该给「标记已查看」按钮。
   *
   * 🔴 `status === 'unanswered'` 时**不给** —— 服务端对「还没作答的题」回 **409**
   * （`POST /:id/review`，见它 handler 的注释：凭空建一行空答案会把假信号喂给下游）。
   * 给一个必然失败的按钮，等于把服务端的业务规则复制一份到界面上，而且复制错了。
   */
  canReview: boolean;
  /** 学生原答案的人类可读文字；`null` = 没有可显示的东西（未作答 / 读不出来）。 */
  answerText: string | null;
  /**
   * ★ M4b：学生画的笔迹（`null` = 这一行不是笔迹作答 / 读不出来）。
   *
   * 🔴 **它与 `answerText` 不互相顶替，两个都要看**：笔迹作答的 `answerText` **恒为 `null`**
   *（笔迹不是文字，见 `formatAnswer`），所以抽屉里那句 `{answerText ?? '未作答'}` 会把
   * 「画了一整幅画」说成「未作答」。`ink` 就是给渲染点的第二问 —— 判据在
   * `worksheet-drawer.tsx` 里逐字是「先看 `ink`，没有才落到 `answerText` / 未作答」。
   *
   * ⚠️ 读数直接引 `src/lib/worksheet-ink.ts` 的 `readInkValue`（**不包一层**）：判据是
   * 作答值的 `format`，**与 `node.type` 无关** —— 教师把一道题从手写改回键盘之后，
   * 学生**之前交的**那幅画仍然要显示得出来（库里那一行没变）。
   */
  ink: InkValue | null;
}

/**
 * 一行作答的**判分结论**。`null` = 这一行没有判分 —— 与 `'incorrect'` 是**两件事**
 * （服务端的 `grade()` 对主观题恒回 `null`；关掉自动判分时全班都是 `null`）。
 *
 * 🔴 判据的**优先级**就是下面三条分支的顺序，改顺序 = 改结论：
 *
 *   1. `gradeState` 是三个认得的取值之一 ⇒ **就按它**。它是 M4a 的新列，也是**唯一**能区分
 *      `incorrect` 与 `partial` 的东西（`isCorrect: false` 把两者混成了一个值）。
 *   2. `gradeState` 为 `null` / 整个字段缺失 ⇒ 退到 `isCorrect`。
 *      ⚠️ 这是**兜底，不是第二真相源**：A1 的启动期回填已把 M3 落库的旧行的 `gradeState` 补齐
 *      （`server/src/services/worksheet-schema.ts` 的
 *      `UPDATE … CASE WHEN "isCorrect" THEN 'correct' ELSE 'incorrect' END`），
 *      所以这条只该在**回填没跑到**时生效（回填失败、或浏览器里的旧 bundle 配新服务端）。
 *      落点的选择也是它该有的样子：旧行里**不存在部分给分**（那时没有这个概念），
 *      所以 `false` 只能落 `incorrect` —— 把旧行的 `false` 猜成 `partial` 是编的。
 *      ⚠️ 这条兜底**有回归网**：`worksheet-drawer-state.test.ts` 的「🔴 形态 A：`gradeState`
 *      缺失时 `isCorrect` 兜底（回填没跑到的旧行），认不出的值不猜」那条用例就钉着它
 *      （删掉本分支 ⇒ 那条变红）。
 *      ⊘ 2026-09-24 更正：这里原先写「这条兜底还留着这件事本身值得记：**删掉它不会让任何
 *      用例变红**（旧行的 `gradeState` 今天都非空），删掉的表现是…」—— **两句都不成立**：
 *      前半句是假的（用例就在 50 行外），后半句的括号也不对（回填**可能没跑到**：
 *      回填失败、或浏览器里的旧 bundle 配新服务端 —— 那正是本条要兜的两种情形）。
 *      那句话最坏的地方不是错，而是它**在劝人删掉这条兜底**，而删掉的表现是
 *      「升级当天所有历史作答的标记消失」（学生侧看不出来，教师会以为全班没答）。
 *   3. `gradeState` 是个**认不出来的字符串** ⇒ `null`，**不猜、也不掉回 `isCorrect`**。
 *      将来服务端加第四档判分时，旧客户端会走到这一支；那时「没有标记」是唯一诚实的一档
 *      （画 `✗` 是假话），而掉回 `isCorrect` 更糟 —— 一个 `false` 会把新档说成「答错」。
 */
export function rowVerdict(row: WorksheetBoardAnswerRow | undefined): WorksheetGradeState | null {
  // ⚠️ 读成 `unknown` 而不是直接信类型：这个字段来自线缆（两条读端点 + 一条广播），
  // 而浏览器里的 bundle 与服务端**不保证同一个版本** —— 第 3 条分支要真能走到。
  const state: unknown = row?.gradeState;
  if (state === 'correct' || state === 'partial' || state === 'incorrect') return state;
  if (state === null || state === undefined) {
    return typeof row?.isCorrect === 'boolean' ? (row.isCorrect ? 'correct' : 'incorrect') : null;
  }
  return null;
}

/**
 * 判分结论 → 界面上那一档。
 *
 * ⚠️ 名字对不上是有意的：服务端叫 `incorrect`、界面这一档叫 **`wrong`**
 * （规格 §12 逐字写的 `'correct' | 'partial' | 'wrong' | 'none'`）。
 * 这里**不做**改名统一 —— `worksheet-drawer.tsx` 与两处用例都按 `'wrong'` 分支。
 */
function markFromVerdict(verdict: WorksheetGradeState | null): WorksheetOutcomeMark {
  if (verdict === 'correct') return 'correct';
  if (verdict === 'partial') return 'partial';
  if (verdict === 'incorrect') return 'wrong';
  return 'none';
}

/**
 * 一道题的完整结论。`row` 是**这个参与者在**这道题上的作答行；`undefined` = 一道没动过。
 *
 * 分支顺序：状态 → 判分档 → 按钮 → 原答案 → 笔迹。其中判分档的判据是**三条并列**的与：
 * 题型有对错 + 已提交 + `rowVerdict` 给出了结论（见那个函数的三条优先级）。
 *
 * ★ M4b：`ink` 与 `answerText` **同一口径的空值** —— `status === 'unanswered'` 时两个都回
 * `null`。不给 `ink` 的理由与 `answerText` 逐字相同：抽屉会为一个「没作答」的行画出一幅
 * **空画布**，而那个空框与「学生画了东西但读不出来」长得一模一样，也没有任何报错。
 */
export function questionOutcome(
  node: WorksheetQuestionNode,
  row: WorksheetBoardAnswerRow | undefined,
): QuestionOutcome {
  const status: WorksheetQuestionStatus =
    row?.status === 'submitted' ? 'submitted' : row?.status === 'draft' ? 'draft' : 'unanswered';

  const mark: WorksheetOutcomeMark =
    isGradedType(node.type) && status === 'submitted' ? markFromVerdict(rowVerdict(row)) : 'none';

  // ⚠️ 读的是 `row?.value`（不是 `formatAnswer` 的结果）：笔迹那条路**不经过**
  // `draftFromValue` 的文字分支，两件事各读各的、互不顶替。
  const ink = status === 'unanswered' ? null : readInkValue(row?.value);

  return {
    status,
    mark,
    reviewed: Boolean(row?.reviewedAt),
    canReview: status !== 'unanswered',
    answerText: status === 'unanswered' ? null : formatAnswer(node, row?.value),
    ink,
  };
}

/** 条目表里按 id 取文本；查不到就**退回 id 本身**（与单选「选项对不上时退回 key」同一条纪律）。 */
function entryText(entries: Array<{ id: string; text: string }>, id: string): string {
  const entry = entries.filter((item) => item.id === id)[0];
  return entry ? entry.text || entry.id : id;
}

/**
 * 把一份作答值读成人话。
 *
 * 单选：读成「B. 阳光」（选项文字比 key 有用得多，而 key 在题干里没有上下文）；
 * 选项读不出来（题被改过、value 是上个版本的）时**退回 key 本身**，不要显示空白 ——
 * 空白会让教师以为学生没选。
 * 填空 / 问答：原文。
 *
 * ⚠️ 用 `draftFromValue`（学生端面板读回本地队列用的是同一个函数）：值可能来自手改过的行，
 * 读不出来时它返回空输入态而不是抛错 —— 这里是渲染路径，一次 TypeError 会让整个抽屉白屏。
 *
 * ★ M4a/D1：`draftFromValue` 的签名多了第一个入参（题目）—— 输入态的形状是**逐题型**的，
 * 读回时要与题目当下的样子对齐。这里本来就拿得到 `node`，所以只是把它递进去。
 *
 * ⚠️ 顺带把「读哪个字段」收成 `draft.kind` 的分派（过去读 `draft.text` / `draft.selected`
 * 是因为那时的输入态只有一个形状）。**差异逐条列清**，三处都是「变多」不是「变少」：
 *   · **`fill-multi/v1`（多空）从「看不见」变成「看得见」**：旧实现读 `draft.text`，而
 *     多空的作答值里根本没有 `text` 键 ⇒ 恒 `null` ⇒ 学生在多空填空题里写的东西在抽屉里
 *     **一片空白**。现在 join 成一段文字（`texts.join(' ')`）。所以「行为逐字不变」这句话
 *     **不严格** —— 落在多空填空上时是修好了一处旧缺陷。
 *   · **单选 / 问答** 逐字不变（含「选项对不上时退回 key 本身」那条）。
 *   · ⊘ 2026-09-24 更正：这一条原先写的是「**单选 / 单空填空 / 问答** 逐字不变」——
 *     🔴 **单空填空也在上面那一支里，只是触发条件更窄**：单空题（没有 `data.blanks`）拿到的
 *     值若还是**多空形状**（教师把一道题从多空改回单空，而学生那份作答是改之前交的），
 *     旧实现同样认不出那个格式（`draftFromValue` 那时只认 `choice/v1` / `fill/v1` / `text/v1`）
 *     ⇒ 抽屉里是 `null`（一片空白）；现在按 `texts` 读出来 ⇒ **有字**。
 *     ⇒ 与上一支同一个方向（看不见 → 看得见），不是变少。
 *     实测（探针，2026-09-24）：
 *       `formatAnswer(单空题, { format: 'fill-multi/v1', texts: ['H2O'] })`
 *         · 58e9b7d 之前：`null`　· 现在：`"H2O"`
 *     对照组（值本身是单空形状）两边都是 `"H2O"` —— **那一支**才是逐字不变的那一支。
 *   · ⊘ **2026-09-25 更正**：上面那两条原先写的是「**多选 / 判断题** 不在本函数展开，
 *     一律返回 `null`（既有口径，本轮没改）」。
 *     🔴 **那个「口径」是一个缺陷**：两条都落到最后那条只认 `text` / `fill` 的三元链上
 *     ⇒ 抽屉把**答过**的学生显示成「未作答」。现已各成一族（下面 `multi-choice` /
 *     `true-false` 两支），与本文件其余各题型同一条路。
 *     ⇒ 今天 `formatAnswer` 覆盖**全部 9 个题型**，没有一支是「故意不管」的。
 */
export function formatAnswer(node: WorksheetQuestionNode, value: unknown): string | null {
  // ★ M4b：**笔迹不是文字** ⇒ `answerText` 回 `null`（`readInkValue` 认得它）。那一幅画由
  // `questionOutcome` 的 `ink` 带走、由 `worksheet-drawer.tsx` 的 `InkPreview` 画出来 ——
  // 这里回 `null` **不是**「学生没作答」。
  //
  // 🔴 为什么要**在最前面**判这一次：不判的话它落到下面那条
  // `draft.kind === 'text' ? … : draft.kind === 'fill' ? … : ''` 上，得到的就是**空串 ⇒ `null`**
  // —— 结果**碰巧一样**，但那是巧合（本函数的分支里没有一条认得 ink），而下一个人会以为
  // 「这里已经处理过笔迹了」。更坏的是他可能顺手把 ink 的输入态读成文字：
  // `draftFromValue` 对 ink 值返回的是 `{ kind: 'ink', box, strokes }`，上面那两分支都取不到
  // 东西 —— 一旦有人给它加一条 `draft.kind === 'ink' ? …` 的读法，教师看到的就会是
  // **一串坐标**。
  //
  // ⚠️ **只认 `format`，不看题型**（与 `draftFromValue` 里先读 ink 那一段同一条纪律）：
  // 教师把一道题从「手写」改回「键盘」之后，学生**之前交的**仍然是一幅画（库里那一行没变），
  // 而抽屉的天职是「把学生写过的东西显示出来」。按题型判会让那幅画从抽屉里消失 ——
  // 而它与「学生什么都没写」长得一模一样。
  if (readInkValue(value)) return null;
  const draft = draftFromValue(node, value);
  // ★ 2026-09-25：**条目型（排序 / 连线 / 归类）**。这三支过去**根本不存在** ——
  // 值里存的是 **id**（`i1` / `z2`），而下面那条三元链只认 `text` / `fill` ⇒ 落进最后的 `''`
  // ⇒ `null` ⇒ 抽屉把**答过**的学生显示成「未作答」。与 M4b 的笔迹同一个形状的缺陷。
  //
  // 🔴 三支都**先于**下面那句 `node.type === 'single-choice'`，判据与 ink 那一段逐字相同：
  // **`format` 是第一判据、题型只是兜底**。教师把一道排序题改成单选之后，学生**之前交的**
  // 那份排序仍然在库里，抽屉的天职是把它显示出来 —— 按题型判会让它变回「未作答」。
  // （`draftFromValue` 也是这么分派的：`format` 认得出就用 `format`。）
  //
  // ⚠️ 条目文本按 id 从**题目**里查；查不到（教师删了那个条目 / 改了题型）就**退回 id 本身**,
  // 与单选「选项对不上时退回 key 本身」同一条纪律 —— 空白会让教师以为学生没答。
  if (draft.kind === 'order') {
    // 🔴 「他到底排过没有」读的是**原始值**里的那个数组，**不是** `draft.order`：
    // `reconcileWithNode` 会把题里所有条目按出题顺序补进 `order`（教师后加的条目也必须排得
    // 进去），于是一份 `order: []` 的行读回来是**满满一列**、与「学生排好了」长得一模一样
    // ⇒ 那会是一句**假话**（我们在替学生说他没说过的话）。空就是空。
    // 判据形状照抄 `readStringList` 的容错：非对象 / 非数组一律当空。
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).order : undefined;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const items = readOrderItems(node);
    const texts: string[] = [];
    draft.order.forEach((id) => { texts.push(entryText(items, id)); });
    return texts.length > 0 ? texts.join(' → ') : null;
  }
  if (draft.kind === 'match') {
    // ⚠️ 按**左栏顺序**输出，不是按 `links` 自己的顺序：后者是学生的点击顺序，
    // 逐人不同、看着像随机，教师横着比一串学生时会以为「每个人连得都不一样」。
    const left = readMatchLeft(node);
    const right = readMatchRight(node);
    const pairs: string[] = [];
    left.forEach((entry) => {
      const link = draft.links.filter((item) => item.leftId === entry.id)[0];
      if (link) pairs.push(`${entryText(left, entry.id)} — ${entryText(right, link.rightId)}`);
    });
    return pairs.length > 0 ? pairs.join('；') : null;
  }
  if (draft.kind === 'categorize') {
    // 按**框**归组（`哺乳类：猫、狗`），不是逐条列「猫→哺乳类」—— 后者要教师自己在脑子里
    // 重排一遍才能看出学生把哪几条放到了一起。框的顺序取**题目的**，同样是为了横向可比。
    const zones = readCategorizeZones(node);
    const items = readCategorizeItems(node);
    const parts: string[] = [];
    zones.forEach((zone) => {
      const inside: string[] = [];
      items.forEach((item) => {
        if (draft.assignment[item.id] === zone.id) inside.push(entryText(items, item.id));
      });
      // 空框**不出现**（「鸟类：（空）」是噪声，而一个框空着这件事由「哪些条目没出现」表达）
      if (inside.length > 0) parts.push(`${zone.text || zone.id}：${inside.join('、')}`);
    });
    // 🔴 没归类的条目**必须说出来**：少了这一句，教师会以为学生把条目全归完了。
    // 它不是理论上的分支 —— 教师删掉一个框之后，那份旧作答里指向它的条目就落到这里。
    //
    // ⚠️ 但它**只在已经有东西归好类时**才说（`parts.length > 0`）：一份**一条都没归**的
    // 作答如果把条目全列成「未归类：…」，那句话读起来像「学生**故意**把它们留在外面」——
    // 而事实是他什么都没做。没做**就该是 `null`（未作答）**，不是一句替他表了态的总结。
    const loose: string[] = [];
    items.forEach((item) => {
      const zoneId = draft.assignment[item.id];
      if (zones.filter((zone) => zone.id === zoneId).length === 0) loose.push(entryText(items, item.id));
    });
    if (loose.length > 0 && parts.length > 0) parts.push(`未归类：${loose.join('、')}`);
    return parts.length > 0 ? parts.join('；') : null;
  }
  if (node.type === 'single-choice') {
    const selected = draft.kind === 'choice' ? draft.selected[0] ?? '' : '';
    if (!selected) return null;
    const option = readOptions(node).filter((item) => item.key === selected)[0];
    return option ? `${option.key}. ${option.text}` : selected;
  }
  // ★ 2026-09-25：**多选**。它与单选同一个缺陷（只认 `single-choice` ⇒ 落进最后那条
  // 三元链 ⇒ `null` ⇒ 「未作答」），只是从没人报过。
  if (node.type === 'multi-choice') {
    const selected = draft.kind === 'choice' ? draft.selected : [];
    if (selected.length === 0) return null;
    const options = readOptions(node);
    const parts: string[] = [];
    // 按**选项表**的顺序输出，不是 `selected` 自己的顺序 —— 后者是学生的点击顺序，
    // 逐人不同（与排序 / 连线 / 归类那三支同一条理由：教师要横着比一串学生）。
    options.forEach((option) => {
      if (selected.includes(option.key)) parts.push(`${option.key}. ${option.text}`);
    });
    // 选中的 key 不在选项表里（题被改过 / 上个版本的值）⇒ 退回 key 本身，与单选同一条纪律
    selected.forEach((key) => {
      if (!options.some((item) => item.key === key)) parts.push(key);
    });
    return parts.length > 0 ? parts.join('；') : null;
  }
  // ★ 2026-09-25：**判断题**。🔴 它**不存 `options`**（规格 §12：`data` 里只有 `correctKeys`）
  // ⇒ 这里必须读 `TRUE_FALSE_OPTIONS` 那一份常量。用 `readOptions(node)` 会读回空表，
  // 于是每个学生都「退回 key 本身」，抽屉里印出 `T` / `F` 两个字母 —— 判分协议对教师没有意义。
  if (node.type === 'true-false') {
    const selected = draft.kind === 'choice' ? draft.selected[0] ?? '' : '';
    if (!selected) return null;
    const option = TRUE_FALSE_OPTIONS.filter((item) => item.key === selected)[0];
    // 只给那个字（「对」），**不印 key**（与多选刻意不同：`A.` 那种前缀在判断题上是噪声）
    return option ? option.text : selected;
  }
  // 填空（单空 / 多空）与问答都是「一段文字」。多空用空格接起来 —— 逐空分行是 D4 的
  // 呈现细节，这里只保证**有内容就显示出来**（学生写过的字不许在抽屉里变成空白）。
  const text = draft.kind === 'text' ? draft.text : draft.kind === 'fill' ? draft.texts.join(' ') : '';
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/** 状态 → 界面上的那一个词。三态与看板方格阵同一组（规格 §7.2 / §7.3 的图例）。 */
export function statusLabel(status: WorksheetQuestionStatus): string {
  if (status === 'submitted') return '已提交';
  if (status === 'draft') return '作答中';
  return '未作答';
}

/**
 * 一档判分结论在界面上长什么样（符号 / 词 / 颜色 / 强调档）。
 *
 * 🔴 为什么把「画什么」从 JSX 搬到这里、而不是留在 `worksheet-drawer.tsx` 里：
 * 本任务（E2）的全部要求就是「**四档在界面上可区分**」，而这一层判据写在 JSX 里就
 * **没有任何回归网**（本仓没有前端测试框架，`node --test` 加载不了 JSX）——
 * 把 `'partial'` 那一支改成与 `'wrong'` 一模一样，不会有任何东西变红。
 * 所以哪怕只是「哪个符号」也住在有测试的这一侧，与 `statusLabel` 同一个理由、同一个去处。
 */
export interface OutcomeMarkView {
  /** 图形符号。 */
  glyph: string;
  /** 符号右边那个词。 */
  label: string;
  color: string;
  /**
   * 强调档。分成三档而不是一个布尔，是为了**逐字保留** E2 之前那两支各自的字号
   * （判分结论 0.813rem 加粗 / `─ 未作答` 0.813rem / 状态词 0.75rem）——
   * 顺手统一字号会让一处既有渲染发生没人要求的变化。
   */
  emphasis: 'verdict' | 'plain' | 'status';
}

/**
 * 三档**判分结论**的长相。`'none'` 不在这里 —— 它要按状态再分三种说法（见下一张表）。
 *
 * 🔴 键类型是 `Exclude<WorksheetOutcomeMark, 'none'>`：给 `WorksheetOutcomeMark` 加第五档
 * 而忘了补这张表，`tsc` 直接红（`Record` 的键集合就是那个联合）。这正是 M4a 之前
 * `'correct' | 'wrong' | 'none'` 手抄第二份时漏掉的那件事。
 *
 * ★ `partial` 那一行是 E2 的交付物：**`½ 部分给分`**，琥珀色（与三档的另外两端同字号同字重）。
 *   符号为什么不沿用规格 §12 字面写的 `◐`：见 `WorksheetOutcomeMark` 上面那一段
 *   —— `◐` 在同一列上已经被「作答中 / 已提交但没有对错」占用了两次。
 */
const VERDICT_VIEW: Record<Exclude<WorksheetOutcomeMark, 'none'>, OutcomeMarkView> = {
  // 绿色只表示**结论为对**，而部分给分不是对（正确率的分子里没有它）—— 所以部分给分不用绿。
  correct: { glyph: '✓', label: '答对', color: '#15803d', emphasis: 'verdict' },
  // 琥珀是这块看板既有的「**中间档**」色（`停住了`、`作答中` 都用它），而红/绿是两端。
  // 不为部分给分再引入第四种色相：同屏出现两个近似橙黄，教师反而分不出来。
  // 同列上它与 `◐ 作答中` 同色 —— 靠**符号与词**区分（这正是本任务要的那一层）。
  partial: { glyph: '½', label: '部分给分', color: '#b45309', emphasis: 'verdict' },
  wrong: { glyph: '✗', label: '答错', color: '#dc2626', emphasis: 'verdict' },
};

/**
 * **没有判分结论**时按状态给的那三种说法。三个词都取自 `statusLabel`（同一份，不另抄）。
 *
 * 🔴 这一档**必须既不像「答错」也不像「部分给分」**：它说的是「系统没判过」这个事实，
 * 画成 `✗` 就是把「不知道」说成「错」，画成 `½` 就是把「不知道」说成「部分给分」。
 * 所以符号只有 `─`（未作答）与 `◐`（作答中 / 已提交）两个，都与那三档判分结论不重样。
 */
const NO_VERDICT_VIEW: Record<WorksheetQuestionStatus, OutcomeMarkView> = {
  unanswered: { glyph: '─', label: statusLabel('unanswered'), color: '#cbd5e1', emphasis: 'plain' },
  draft: { glyph: '◐', label: statusLabel('draft'), color: '#b45309', emphasis: 'status' },
  submitted: { glyph: '◐', label: statusLabel('submitted'), color: '#1d4ed8', emphasis: 'status' },
};

/**
 * 判分档 + 状态 → 抽屉里那一小块。
 *
 * ⚠️ `status` **只在没有判分结论时**才影响长相（`'none'` 那一支）。判分结论自己说完了话，
 * 就不再拿状态去修饰它 —— 否则「已提交的部分给分」与「作答中的部分给分」会长得不一样，
 * 而后者根本不可能存在（`questionOutcome` 已经把它挡在 `'none'` 上）。
 */
export function outcomeMarkView(mark: WorksheetOutcomeMark, status: WorksheetQuestionStatus): OutcomeMarkView {
  return mark === 'none' ? NO_VERDICT_VIEW[status] : VERDICT_VIEW[mark];
}

/**
 * 按题聚合（规格 §7.3 形态 B 的第二层：`正确 92%  已交 5/5`）。
 *
 * 🔴 **两个分母是两件事，不能互相顶替**：
 *   · 「已交 N/M」的 M 是**参与者数**（有几个人/组该答这道题），不是「答过的人」——
 *     用后者算，一份只有一半人交的卷子会显示「已交 5/5」，而那正是教师要看的东西；
 *   · 「正确率」的分母是**已判过的行数**（`rowVerdict` 非 `null`），不是已交的人数 ——
 *     主观题恒不判分、关闭自动判分时全班都不判分，拿已交人数当分母会得到 0%。
 *
 * 🔴 **「正确」的口径 = 全对才算对**（规格 §12 的裁定，**不是**这里能自由发挥的地方）：
 *   · **部分给分进分母、不进分子** ⇒ 10 行里 4 全对 / 3 部分给分 / 3 错 = **40%**，不是 70%；
 *   · 这**不是自动成立的**：把分子写成「非 `incorrect` 即算对」在类型上完全合法、
 *     跑起来也不报错，只是把部分给分算成了对（教师看到的正确率凭空变高）。
 *     `worksheet-drawer-state.test.ts` 里那条 10 行 4/3/3 的用例就是钉它用的 ——
 *     ⚠️ 那条用例是**唯一**能区分「全对才算对」与「非错即对」的用例，别把它改成别的形状。
 *   · 全部都是部分给分 ⇒ `accuracy` 是 **0**（它们进了分母、一个也没进分子），**不是 `null`**：
 *     `null` 的意思只有一句 —— 一行都没判过（界面显示「—」）。
 *
 * `accuracy === null` 表示**没有已判过的行** ⇒ 界面上显示「—」（主观题那一行就是它）。
 * 返回的是**已四舍五入的整数百分比**：界面上写的是 `92%`，多给小数位只会让人以为更精确。
 */
export interface QuestionAggregate {
  /** 分母：参与者数（`rows.length` —— 每个参与者一格，没作答的那一格是 `undefined`）。 */
  total: number;
  submitted: number;
  /** 已判过的行数（`rowVerdict` 非 `null`，**含部分给分**）—— 正确率的分母。 */
  graded: number;
  /** 判为**全对**的行数 —— 正确率的分子。部分给分**不在**这里。 */
  correct: number;
  /** 0–100 的整数；`null` = 没有已判过的行（显示「—」）。 */
  accuracy: number | null;
}

export function questionAggregate(rows: Array<WorksheetBoardAnswerRow | undefined>): QuestionAggregate {
  let submitted = 0;
  let graded = 0;
  let correct = 0;
  for (const row of rows) {
    if (!row) continue;
    if (row.status === 'submitted') submitted += 1;
    // ⚠️ 分母与分子读的是**同一个结论**（`rowVerdict`），只是筛的档不同 ——
    // 两处各读一个字段（比如分母读 `gradeState`、分子读 `isCorrect`）会让它们
    // 在旧行上分叉，而那种分叉的表现是「分母里有一行，分子里永远数不到」。
    const verdict = rowVerdict(row);
    if (verdict !== null) {
      graded += 1;
      // 🔴 只有 `correct` 进分子 —— `partial` **不**进（规格 §12 的裁定）。
      if (verdict === 'correct') correct += 1;
    }
  }
  return {
    total: rows.length,
    submitted,
    graded,
    correct,
    accuracy: graded > 0 ? Math.round((correct / graded) * 100) : null,
  };
}

/**
 * 「N 个组在用」/「N 人在用」里那个量词。
 *
 * 分组 / 高级模式下这里数的是**小组**（一块设备 = 一个组，规格 §1.2），
 * 而标准模式下是人。用错量词的话，高级模式下一间 5 个组的课堂会写「5 人在用」，
 * 而教师心里那个班有 40 个人 —— 那句话会让他以为这功能坏了。
 */
export function participantUnitLabel(kinds: readonly string[]): string {
  return kinds.length > 0 && kinds.every((kind) => kind === 'group') ? '个组' : '人';
}

/**
 * 形态 B 第三层的标题：「第 2 题」那一行下面列的是**参与者**，可能是组不是人。
 *
 * 规格 §7.3 明写标题叫「全部作答」而**不是**「全班答案」，两个理由：① 高级/分组模式下
 * 列的是组；② 「答案」在本项目里已被 §5.4 占用为「正确答案」，而这里给的是学生的原答案。
 */
export function participantColumnTitle(kinds: readonly string[]): string {
  return participantUnitLabel(kinds) === '个组' ? '各组作答' : '各人作答';
}

/**
 * 按题号索引题目（题干、题型、题号都从这里来）。
 *
 * ⚠️ 走 `flattenAnswerable`（递归展开**并跳过任务**）而不是只看顶层 `nodes`：`content` 是树，
 * 服务端算「整卷交齐」与看板数格子都会递归 —— 只看顶层会让带嵌套的那几道题
 * **在抽屉里不存在**，而它们在格子上有方块。
 * 🔴 也**不是** `flattenQuestions`：那一个把**任务**节点也吐出来，任务就成了一行「题」
 * —— 它没有作答、也没法点开看谁答了，而抽屉里会多出这么一行。
 *
 * `questionId` 在 `answerRows` 里**没有顺序保证**（数据库按写入顺序回），所以题号一律
 * 从这里查，绝不拿数组下标当题号（规格 §3-P：按下标会在教师改序时整片错位，且是静默的）。
 */
export function indexQuestions(nodes: WorksheetQuestionNode[]): {
  /** 可作答的题（**任务不在其中**），按屏幕顺序 —— 抽屉里逐行渲染的就是它。 */
  items: AnswerableQuestion[];
  /** 同上，只取节点 —— 给那些只要节点的调用方。 */
  questions: WorksheetQuestionNode[];
  /** 题号（两级）查表。**绝不拿下标当题号**（规格 §3-P）。 */
  headingOf: (questionId: string) => string | null;
  byId: Map<string, WorksheetQuestionNode>;
} {
  const items = flattenAnswerable(nodes);
  const questions = items.map((item) => item.node);
  const headings = new Map(items.map((item) => [item.node.id, item.heading]));
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    items,
    questions,
    byId,
    headingOf: (questionId: string) => headings.get(questionId) ?? null,
  };
}

/**
 * 题号 + 题型，抽屉里每一行的第一列。题号查不到时**不编一个假题号**，只给题型。
 *
 * ★ 2026-09-25：第二参从「0-based 拍平序」换成**两级题号串**（`任务一 · 2`；散题是 `2`）。
 * 换的理由不只是显示：拍平序把**任务节点也算了一号** ⇒ 任务一旦在树里，
 * 它后面每一道题的号都比屏幕上该显示的大 —— 而两处都不报错。
 */
export function questionHeading(node: WorksheetQuestionNode, heading: string | null): string {
  const type = questionTypeLabel(node.type);
  return heading ? `${heading}. ${type}` : type;
}

/* ═══════════════════════════════════════════════════════════════════════
   ★ 2026-09-28：形态 A 的「该生全貌」与「答题过程」（教师第 2、3 条）
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 一个参与者在**这一份学习单**上的全貌 —— 六个计数 + 奖励。
 *
 * 🔴 **六档互斥，且和必须正好是题数。** 这是这一行唯一可观测的错法：少了哪一档、
 * 或者两档数了同一道题，屏幕上只是「数字有点怪」，而没有任何东西会报错。
 * 本仓没有前端测试框架，判据写进 JSX 就没有回归网 —— 所以它在这里。
 *
 * 六档的口径（**主观题那一条最要紧**）：
 *   · `correct` / `partial` / `wrong` —— 只有**可判分的题型**（`isGradedType`）且已提交
 *     才可能落进来，判据与抽屉里那个 ✓/½/✗ **走同一个** `rowVerdict`（一份真源）；
 *   · `noVerdict` —— **已提交但没有对错**：主观题、关闭自动判分、以及判分档认不出来的行。
 *     🔴 主观题**既不进 ✓ 也不进 ✗** —— 把它算进 correct 是「把不知道说成对」，
 *     算进 wrong 是「把不知道说成错」，而系统对它**根本没有结论**（服务端恒回 null）；
 *   · `draft` —— 作答中（他动过，但没交）；
 *   · `unanswered` —— 一行都没有，或那一行是 `unanswered`。
 *
 * ── 奖励 ──────────────────────────────────────────────────────────────
 * 奖励是**派生**的：各题得分之和（`rewardAmount` 的绝对值模型，规格 §12）。
 * 所以它**不需要新表、也不需要单独清** —— 答案行没了，奖励自然归零。
 *
 * 🔴 **只累加「还在学习单里的那些题」**，与上面六个计数同一个分母。
 * 教师课上删掉一道题之后，库里留给它的那行答案**仍然带着分数**；把它算进来的话，
 * 这一行的六个计数说「共 5 题」而奖励里含着第 6 题的星星 —— 同一行里的两个数
 * 用了两个分母，而屏幕上没有任何东西提示这件事。
 * ⚠️ 代价（写在这里免得下一个人以为是 bug）：被删掉的那道题的奖励会从这个总数里消失，
 * 而学生在自己屏幕上可能还看到过它。**取舍是刻意的**：一行数字内部的自洽优先。
 *
 * `rewardKnown === false` 表示**学习单的 `settings` 还没加载到** ⇒ 界面画「—」。
 * 🔴 那时**不许显示 0** —— 0 是一句假话（学生/教师会以为这题一分没得）。
 * `reward` 那个数本身与样式无关，所以它照样算得出来。
 */
export interface ParticipantOverview {
  correct: number;
  partial: number;
  wrong: number;
  /** 已提交但**没有对错**（主观题 / 关闭自动判分 / 认不出的档）。 */
  noVerdict: number;
  draft: number;
  unanswered: number;
  /** 各题得分之和（绝对值模型：它同时就是「奖励之和」，规格 §12）。 */
  reward: number;
  /** 学习单的奖励样式**知道了没有**；`false` ⇒ 界面画「—」而不是 0。 */
  rewardKnown: boolean;
  /**
   * 奖励那一格的文字（`⭐×6` / `+6 分` / 为 0 时 `⭐×0`）。
   * `null` = **不知道**（`settings` 没到）—— 与 `rewardKnown === false` 是同一件事。
   */
  rewardText: string | null;
}

export function participantOverview(
  nodes: WorksheetQuestionNode[],
  /**
   * 这个参与者的**全部**作答行（`participant.answerRows`）。
   * 🔴 按 `questionId` 查，**绝不按下标**（规格 §3-P）—— 两边的顺序没有任何保证，
   * 而按下标对齐错了的表现是「张三的分数挂在李四的题上」，全程不报错。
   */
  answerRows: ReadonlyArray<WorksheetBoardAnswerRow>,
  rewardScale: RewardScale | null,
): ParticipantOverview {
  const items = flattenAnswerable(nodes);
  const byQuestion = new Map<string, WorksheetBoardAnswerRow>();
  for (const answerRow of answerRows) byQuestion.set(answerRow.questionId, answerRow);

  let correct = 0; let partial = 0; let wrong = 0; let noVerdict = 0; let draft = 0; let unanswered = 0;
  let reward = 0;

  for (const { node } of items) {
    const row = byQuestion.get(node.id);
    const status: WorksheetQuestionStatus =
      row?.status === 'submitted' ? 'submitted' : row?.status === 'draft' ? 'draft' : 'unanswered';
    if (status === 'unanswered') { unanswered += 1; continue; }
    if (status === 'draft') { draft += 1; continue; }

    // 判据与抽屉里那个 ✓/½/✗ 走**同一个** `rowVerdict`（一份真源）。
    const mark: WorksheetOutcomeMark =
      isGradedType(node.type) ? markFromVerdict(rowVerdict(row)) : 'none';
    if (mark === 'correct') correct += 1;
    else if (mark === 'partial') partial += 1;
    else if (mark === 'wrong') wrong += 1;
    else noVerdict += 1;

    reward += rewardAmount(row?.score ?? null, rewardScale ?? { style: 'star' });
  }

  return {
    correct, partial, wrong, noVerdict, draft, unanswered,
    reward,
    rewardKnown: rewardScale !== null,
    rewardText: rewardScale === null
      ? null
      : rewardTotalText(rewardScale, reward)
        ?? (rewardScale.style === 'points' ? '+0 分' : `${rewardSymbol(rewardScale.style) ?? '★'}×0`),
  };
}

/**
 * 「这一题上他做了什么」的三段事实（教师第 3 条）。
 *
 * 🔴 **三段各自可以为 `null`（= 不知道），而且必须可分辨。** 它们的 `null` 来自
 * 那一列上线之前的旧行（`ensureWorksheetAnswerColumns` **刻意不回填**：旧行被保存过几次、
 * 什么时候保存的，库里从来没有记过）。三种编法都是错的，且都不报错：
 *   · 编成 0 —— 「已保存 0 次」听起来像他什么都没做；
 *   · 编成「刚刚」—— 教师以为他正在写；
 *   · 拿**浏览器的** `Date.now()` 去减服务端的时间戳 —— 跨时钟，静默算错。
 * ⇒ 界面对 `null` 的处置是**整段不显示**。
 *
 * @param serverNowMs **服务端**此刻的时刻（读端点响应里的 `serverNow`）。
 *   时间那两段用的是「服务端减服务端」，与浏览器的时钟**无关** —— 偏差相消。
 *   `NaN`（旧服务端不发这个字段）⇒ 两段时间都是 `null`，而 `saveCount` 照给
 *   （次数不需要时钟）。
 */
export interface ProcessFacts {
  /** 这一题**第一次**落库距现在多久（ms）；`null` = 不知道。 */
  startedAgoMs: number | null;
  /** **最近一次保存**距今多久（ms）；`null` = 不知道。 */
  savedAgoMs: number | null;
  /** 保存过几次；`null` = 不知道。 */
  saveCount: number | null;
}

export function processFacts(
  row: WorksheetBoardAnswerRow | undefined,
  serverNowMs: number,
): ProcessFacts {
  const parse = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  };
  const clockKnown = Number.isFinite(serverNowMs);
  const created = parse(row?.createdAt);
  const saved = parse(row?.savedAt);
  const count = typeof row?.saveCount === 'number' && Number.isFinite(row.saveCount) ? row.saveCount : null;
  // ⚠️ 钳在 0：两次读之间若有写入落库，`serverNow - 那个时间戳` 可以是负的，
  // 而「-3 分钟前」是一句胡话。
  const ago = (at: number | null) =>
    clockKnown && at !== null ? Math.max(0, serverNowMs - at) : null;
  return { startedAgoMs: ago(created), savedAgoMs: ago(saved), saveCount: count };
}

/**
 * 一个时长说成人话：`刚刚` / `N 分钟前` / `N 小时前` / `N 天前`。
 *
 * ⚠️ **一律向下取整**（与「停住了」那个分钟数同一条纪律）：1 分 30 秒说「1 分钟前」
 * 是准的，说「2 分钟前」是提前量。`59_000` 落「刚刚」而不是「0 分钟前」——
 * 后者读起来像坏了。
 */
export function formatAgo(ms: number): string {
  if (ms < 60_000) return '刚刚';
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))} 小时前`;
  return `${Math.floor(ms / (24 * 60 * 60_000))} 天前`;
}

/**
 * ★ 2026-09-28：逐题那一列里**默认展开**哪一题 —— 教师第 3 条「更详细地展示正在答题的那个小题」。
 *
 * 判据：**还在作答中**（`draft`）的题里，**最近保存过**的那一道。
 *   · 多题同时是 `draft` 时取 `savedAt` 最大的那一道 —— 「他此刻在做哪一题」的判据
 *     与格子上的「正在做第 N 题」**同源**（规格 §3-H）；
 *   · 一道 draft 都没有（全交完了 / 一道没动）⇒ `null`，一题都不展开；
 *   · 有 draft 但都没有 `savedAt`（旧行）⇒ 取**题序最靠前**的那一道。
 *     ⚠️ 这只是「我们唯一能说的那一个」，不是「他正在做的那一个」—— 所以在没有
 *     时间戳时**不退化成编造**：题序最靠前是一句可解释的话（他是从前往后做的），
 *     而随便挑一题不是。
 */
export function inProgressQuestionId(
  nodes: WorksheetQuestionNode[],
  answerRows: ReadonlyArray<WorksheetBoardAnswerRow>,
): string | null {
  const byQuestion = new Map<string, WorksheetBoardAnswerRow>();
  for (const answerRow of answerRows) byQuestion.set(answerRow.questionId, answerRow);

  let best: { id: string; savedAt: number } | null = null;
  let firstDraft: string | null = null;
  for (const { node } of flattenAnswerable(nodes)) {
    const status = byQuestion.get(node.id)?.status;
    if (status !== 'draft') continue;
    if (firstDraft === null) firstDraft = node.id;
    const saved = byQuestion.get(node.id)?.savedAt;
    const at = typeof saved === 'string' ? Date.parse(saved) : Number.NaN;
    if (Number.isFinite(at) && (best === null || at > best.savedAt)) best = { id: node.id, savedAt: at };
  }
  return best?.id ?? firstDraft;
}
