import type { WorksheetBoardAnswerRow, WorksheetQuestionNode } from '@/lib/types';
// 题型的读法（选项、作答值 → 输入态）只有一份，在 `src/lib/worksheet-questions.ts`
// （学生端作答面板与教师端预览都引它）。这里**转出**同一份，不是抄一份。
// ⚠️ 相对路径 + `.ts` 后缀是**必须的**：本文件要能被 `node --test` 直接执行
// （Node 24 的类型擦除会把 `import type` 整段删掉，剩下的运行时 import 必须是
// Node 也解析得了的相对路径）。加一行 `@/…` 的运行时 import 就会让
// `worksheet-drawer-state.test.ts` 整个跑不起来 —— `import type` 那一行是唯一的例外。
import { draftFromValue, flattenQuestions, questionTypeLabel, readOptions } from '../../../lib/worksheet-questions.ts';

/**
 * 教师看板**学习单抽屉**的两种形态的判据 —— 纯函数，不碰 React / DOM / 网络。
 *
 * 🔴 为什么单独成文件、单独断言：这里每一条判据错了都**不抛异常、不让编译失败**，
 * 只会让教师在课上看到一句错的结论 ——
 *   · 主观题上冒出一个 ✓/✗（学生答得对不对，系统根本不知道）；
 *   · 未作答的题上冒出一个「标记已查看」按钮（点下去服务端回 **409**，纯属必然失败）；
 *   · 正确率的分母用错（拿参与者数当分母 ⇒ 一份交了一半的卷子显示「正确率 50%」，
 *     而它其实一道没错）；
 *   · 「已交 N/M」的分母漏掉没作答的人（那个数没有任何地方会报错）。
 * 本仓没有前端测试框架（规格 §11），但 `node --test` 能直接跑本文件：
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-drawer-state.test.ts
 * ```
 *
 * ── 数据来源（规格 §7.4）──────────────────────────────────────────────
 *   · 逐题状态 / 对错 / 「已查看」 —— `GET /api/worksheets/classroom/:id/answers`
 *     （D4 补的历史读端点；在此之前只有广播，教师刷新一次页面看板就失忆）；
 *   · 题目清单 / 题号 / 题型 / 选项文字 —— `GET /api/worksheets/:id` 的 `content.nodes`
 *     （**只有**它会带答案字段，而它只留在教师端内存里，见 §5.4 的边界：
 *     本模块读它是为了**画题号与题型**，绝不把它下发给学生）。
 */

/** 一道题在这一格上的状态（与看板方格阵同一组取值，规格 §7.2）。 */
export type WorksheetQuestionStatus = 'unanswered' | 'draft' | 'submitted';

/**
 * 这一道题的**对错**。
 *
 * `none` 有两种来源，界面上都不显示 ✓/✗：
 *   · 主观题（问答题）**本来就没有对错** —— 服务端的 `grade()` 对它恒返回 `null`；
 *   · 自动判分关掉时 / 还没提交时 —— `WorksheetAnswer.isCorrect` 为 `null`。
 */
export type WorksheetOutcomeMark = 'correct' | 'wrong' | 'none';

/**
 * 只有这两种题型有对错。**唯一一份** —— 与 `grade()` 的分派一致，但它是**白名单**：
 * 将来加一种新题型时，它会自动落到「没有对错」那一侧（少显示一个 ✓ 不会骗人，
 * 多显示一个会）。⚠️ 顺带它也是「主观题没有 ✓/✗」那条要求的**第二道闸**：
 * 即使库里某一行 `short-answer` 的 `isCorrect` 被手工改成了 `true`，这里也不会显示 ✓。
 */
export const GRADED_QUESTION_TYPES: readonly string[] = ['single-choice', 'fill-blank'];

export function isGradedType(type: string): boolean {
  return GRADED_QUESTION_TYPES.includes(type);
}

export interface QuestionOutcome {
  status: WorksheetQuestionStatus;
  /** ✓ / ✗ / 什么都没有（主观题、未提交、关闭自动判分）。 */
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
}

/**
 * 一道题的完整结论。`row` 是**这个参与者在**这道题上的作答行；`undefined` = 一道没动过。
 *
 * 分支顺序：状态 → 对错 → 按钮 → 原答案。其中对错的判据是**三条并列**的与：
 * 题型有对错 + 已提交 + `isCorrect` 是个真布尔值。
 */
export function questionOutcome(
  node: WorksheetQuestionNode,
  row: WorksheetBoardAnswerRow | undefined,
): QuestionOutcome {
  const status: WorksheetQuestionStatus =
    row?.status === 'submitted' ? 'submitted' : row?.status === 'draft' ? 'draft' : 'unanswered';

  const mark: WorksheetOutcomeMark =
    isGradedType(node.type) && status === 'submitted' && typeof row?.isCorrect === 'boolean'
      ? (row.isCorrect ? 'correct' : 'wrong')
      : 'none';

  return {
    status,
    mark,
    reviewed: Boolean(row?.reviewedAt),
    canReview: status !== 'unanswered',
    answerText: status === 'unanswered' ? null : formatAnswer(node, row?.value),
  };
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
 */
export function formatAnswer(node: WorksheetQuestionNode, value: unknown): string | null {
  const draft = draftFromValue(value);
  if (node.type === 'single-choice') {
    if (!draft.selected) return null;
    const option = readOptions(node).filter((item) => item.key === draft.selected)[0];
    return option ? `${option.key}. ${option.text}` : draft.selected;
  }
  const text = draft.text.trim();
  return text ? text : null;
}

/** 状态 → 界面上的那一个词。三态与看板方格阵同一组（规格 §7.2 / §7.3 的图例）。 */
export function statusLabel(status: WorksheetQuestionStatus): string {
  if (status === 'submitted') return '已提交';
  if (status === 'draft') return '作答中';
  return '未作答';
}

/**
 * 按题聚合（规格 §7.3 形态 B 的第二层：`正确 92%  已交 5/5`）。
 *
 * 🔴 **两个分母是两件事，不能互相顶替**：
 *   · 「已交 N/M」的 M 是**参与者数**（有几个人/组该答这道题），不是「答过的人」——
 *     用后者算，一份只有一半人交的卷子会显示「已交 5/5」，而那正是教师要看的东西；
 *   · 「正确率」的分母是**已判过对错的行数**（`isCorrect` 非 `null`），不是已交的人数 ——
 *     主观题恒不判分、关闭自动判分时全班都不判分，拿已交人数当分母会得到 0%。
 *
 * `accuracy === null` 表示**没有已判过的行** ⇒ 界面上显示「—」（主观题那一行就是它）。
 * 返回的是**已四舍五入的整数百分比**：界面上写的是 `92%`，多给小数位只会让人以为更精确。
 */
export interface QuestionAggregate {
  /** 分母：参与者数（`rows.length` —— 每个参与者一格，没作答的那一格是 `undefined`）。 */
  total: number;
  submitted: number;
  /** 已判过对错的行数（`isCorrect` 非 `null`）—— 正确率的分母。 */
  graded: number;
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
    if (typeof row.isCorrect === 'boolean') {
      graded += 1;
      if (row.isCorrect) correct += 1;
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
 * ⚠️ 走 `flattenQuestions`（递归展开）而不是只看顶层 `nodes`：`content` 是树，
 * 服务端算「整卷交齐」与看板数格子都会递归 —— 只看顶层会让带嵌套的那几道题
 * **在抽屉里不存在**，而它们在格子上有方块。
 *
 * `questionId` 在 `answerRows` 里**没有顺序保证**（数据库按写入顺序回），所以题号一律
 * 从这里查，绝不拿数组下标当题号（规格 §3-P：按下标会在教师改序时整片错位，且是静默的）。
 */
export function indexQuestions(nodes: WorksheetQuestionNode[]): {
  questions: WorksheetQuestionNode[];
  indexOf: (questionId: string) => number;
  byId: Map<string, WorksheetQuestionNode>;
} {
  const questions = flattenQuestions(nodes);
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    questions,
    byId,
    indexOf: (questionId: string) => questions.findIndex((question) => question.id === questionId),
  };
}

/** 题号（1-based）+ 题型，抽屉里每一行的第一列。题号查不到时不编号码（不编一个假题号）。 */
export function questionHeading(node: WorksheetQuestionNode, index: number): string {
  const type = questionTypeLabel(node.type);
  return index >= 0 ? `${index + 1}. ${type}` : type;
}
