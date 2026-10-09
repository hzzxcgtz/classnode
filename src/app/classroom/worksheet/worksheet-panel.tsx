'use client';

import { normalizeGeneration, type WorksheetGeneration } from './worksheet-generation';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getStudentSessionAuthorization } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { effectiveGroupWorksheet } from '@/lib/classroom-material';
import type { WorksheetAnswerMode, WorksheetGradeState, WorksheetQuestionNode } from '@/lib/types';
// ★ 2026-09-30：题目开放方式四档 —— 归一化与**学生端闸门**都在这里（有用例）。
// 🔴 本文件原先自己内联了一份「哪几档 + 怎么判」的副本，加第四档时它会把 `manual`
// 静默降级成 `open`（学生看到全部题目，而老师以为卷子是锁着的）。
import { answerModeView, normalizeAnswerMode, normalizeOpenQuestions } from '@/lib/worksheet-answer-mode';
// 奖励的取值域、默认档与取值函数只有一份（规格 §9）—— 教师端那个设置面板引的也是它。
import { resolveFullPoints, resolveRewardScale, resolveWorksheetFullStep, rewardAmount, type RewardScale } from '@/lib/worksheet-reward';
import { correctKeysFromPayload, isMultipleChoice, questionTypeLabel, studentVisibleGroups, type AnswerableGroup } from '@/lib/worksheet-questions';
import { readPromptImage, readPromptRunsFor, worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { readBlankCount } from '@/lib/worksheet-answer-value';
import { fillSettingsFor, hasExplicitFillGrading } from '@/lib/worksheet-fill-modes';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { questionTypeIcon } from '@/lib/worksheet-question-icons';
import { questionTypeNickname } from '@/lib/worksheet-questions';
import {
  normalizeWorksheetBackgroundTheme,
  resolveWorksheetBackgroundSources,
} from '@/lib/worksheet-backgrounds';
// ★ 2026-09-27：卡片透度（题目卡片 + 任务容器两个面）。档位与数值只有那一份 ——
// 教师端的设置面板读的是同一个模块。
import {
  DEFAULT_WORKSHEET_SURFACE,
  normalizeWorksheetSurfaceOpacity,
  surfaceAlphas,
} from '@/lib/worksheet-surface';
import type { WorksheetBackgroundTheme, WorksheetSurfaceOpacity } from '@/lib/types';
// ★ M4a/D1：作答态的形状与那两个转换函数住在 `lib/worksheet-answer-value.ts`
//（`worksheet-questions.ts` 只是转出它们）。这里直接引那个文件，是为了让
// 「面板读/写的是哪个形状」在这份 import 清单里就看得见。
import { emptyDraftFor, isDraftEmpty, type AnswerDraft } from '@/lib/worksheet-answer-value';
import type { ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { MODULE_META } from '../module-meta';
import { useModuleViewport } from '../shell/use-module-viewport';
// ★ M4a/D2：作答区**只有一份实现**（`questions/index.tsx` 的分派器 + 6 个作答体）。
// 教师端的「学生端预览」渲染的是下面这个 `WorksheetQuestionList`，所以它自动用上同一份。
import { QuestionInput } from './questions';
import { ChoiceBlankAnswer } from './questions/choice-blank-answer';
import {
  questionDisplayState,
  useWorksheetAnswers,
  type WorksheetQuestionStatus,
  type WorksheetScore,
} from './use-worksheet-answers';
import { readCorrectBlanks, type SavedAnswerRow } from './worksheet-queue';
import { QuestionReward, RewardBurst, RewardTotal } from './reward-badge';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { ResultGlyph } from './result-glyph';
import { WorksheetStatusIcon } from '@/components/worksheet-status-icon';
import styles from './worksheet.module.css';

/**
 * 学生端的学习单面板（规格 §8）。
 *
 * 契约与探究空间面板同款：`extends ModulePanelProps`，六项都由外壳给（`active` /
 * `state` / `classroom` / `session` / `toast` / `setToast`）。
 *
 * ── 三条硬约束，逐条对应下面的一处代码 ────────────────────────────────────────
 *
 * ① **层内滚动**（规格 §8.1）：`.stage` 是 `overflow: hidden`，每一层自己管自己的滚动。
 *    所以面板是 `height:100%` + **内部滚动容器**（`.scroller`），**不是滚页面** ——
 *    后者会让「保存了没有」那一条随整卷滚出视口。
 *
 * ② **iOS 键盘 / viewport 走 D1 抽出的共用 hook**（§3-AB）：**不要**在这里另写一套
 *    `visualViewport` 处理。两个模块各写一套必然分叉，其中一个修了 bug 另一个没修。
 *    ⚠️ `cssVar` 必须传 `'--module-viewport-height'` —— 与学伴面板**同一个名字**是刻意的
 *    （理由在那个 hook 的文档里：共用才不会出现「新面板的变量还没被设过」的那一帧）。
 *
 * ③ **本组未配置学习单 ≠ 老师没布置**（规格 §8.4）：高级模式下每个组各有一份，
 *    「这一组没有」被 `effectiveGroupWorksheet` 收成 `null`，界面要说对是谁的问题，
 *    并且**绝不拿别组的顶上**。
 *
 * ── 为什么首屏走 `GET /code/:code` 而不是 socket 的 `joined` ────────────────────
 * socket 的 `joined` 载荷里**只有 `groups[]`，没有课堂级 `worksheets`**（它从来也不发
 * `webapps`）。标准 / 分组模式的材料权威来源是**课堂级**那一个数组 ——
 * 面板若只依赖 `joined`，那两种模式下会「什么都没有」且不报错。本面板读的是外壳从
 * `useClassroomSession` 拿到的 `classroom`，而那条链路走的是 `GET /api/classroom/code/:code`，
 * 课堂级 `worksheets` 与 `groups[].worksheet` **都在**（`resolveGroupMaterialViews` /
 * `loadClassroomWorksheets`）。题目结构再按 id 单独拉（服务端已剥掉答案字段，§5.4）。
 */

/**
 * 从 `GET /:id/answers` 的响应里读出作答行。**容错**：读不出来就当「还没有作答」。
 *
 * ⚠️ 这是**渲染路径**：一次 TypeError 会让整个面板白屏，而白屏的学生会以为
 * 「老师没布置」。所以逐条校验形状、坏条目丢掉（照 `readQueue` 对存储的取舍），
 * 而不是把响应整体断言成那个类型。
 *
 * ⚠️ 信封那个键是 `rows`（「作答行」），**不是** `answers` —— 后者是**正确答案**那个
 * 字段的名字，服务端两个端点都被「响应里不许出现 `ANSWER_KEYS` 里的键」扫着。
 */
function parseSavedAnswers(raw: unknown): SavedAnswerRow[] {
  const rows = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).rows
    : undefined;
  if (!Array.isArray(rows)) return [];
  const out: SavedAnswerRow[] = [];
  rows.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    if (typeof row.questionId !== 'string' || !row.questionId) return;
    out.push({
      questionId: row.questionId,
      // `null` / `undefined` 都是「这一题的作答被清空了」——与队列里的 `null` 同义。
      value: (row.value ?? null) as SavedAnswerRow['value'],
      status: typeof row.status === 'string' ? row.status : 'draft',
      // ⚠️ 只认 `boolean`：`undefined`（`.json()` 失败）必须落到 `null`（**没判分**），
      // 不能变成 `false`（判错）—— `scoreFromWire` 那条注释里有完整理由。
      isCorrect: typeof row.isCorrect === 'boolean' ? row.isCorrect : null,
      gradeState: row.gradeState === 'correct' || row.gradeState === 'partial' || row.gradeState === 'incorrect'
        ? row.gradeState
        : null,
      wrongBlankIndexes: Array.isArray(row.wrongBlankIndexes)
        ? row.wrongBlankIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0)
        : [],
      // ★ 2026-09-27：**刷新之后答案还得在**。服务端在 `GET /:id/answers` 里一直发着它
      //（`routes/worksheets.ts` 那条 `correctBlanks`），而这里当初没接 ⇒ 学生一刷新，
      // 答错的空只剩一个叉、「正确答案」整块消失，选择 / 判断那边连叉都没有 ——
      // 屏幕上没有任何异常。读法只有一处（`readCorrectBlanks`），别再在这儿写第二份。
      correctBlanks: readCorrectBlanks(row.correctBlanks),
      // ★ M4a：逐题得分的**绝对值**（教师填的那个数）。同一个纪律：只认有限数，
      // 读不出来落到 `null`（= 没判分），而 `scoreFromWire` 会回落到 `isCorrect` ——
      // **升级前落库的旧行没有 `score`**，那正是那条兜底存在的理由。
      score: typeof row.score === 'number' && isFinite(row.score) ? row.score : null,
    });
  });
  return out;
}

interface StudentAiReferenceScore {
  score: number | null;
  maxScore: number;
  unit: string;
  comment: string;
  advice: string;
}

/** 学生作答回读中只取“本人逐题参考分”；坏形状静默忽略，不能拖垮整张学习单。 */
function parseAiReferenceScores(raw: unknown): Record<string, StudentAiReferenceScore> {
  const rows = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).rows
    : undefined;
  if (!Array.isArray(rows)) return {};
  const result: Record<string, StudentAiReferenceScore> = {};
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const score = row.aiReferenceScore;
    if (typeof row.questionId !== 'string' || !score || typeof score !== 'object' || Array.isArray(score)) continue;
    const value = score as Record<string, unknown>;
    if ((value.score !== null && (typeof value.score !== 'number' || !Number.isFinite(value.score)))
      || typeof value.maxScore !== 'number' || !Number.isFinite(value.maxScore)
      || typeof value.unit !== 'string' || !value.unit) continue;
    result[row.questionId] = {
      score: value.score,
      maxScore: value.maxScore,
      unit: value.unit,
      comment: typeof value.comment === 'string' ? value.comment.trim().slice(0, 200) : '',
      advice: typeof value.advice === 'string' ? value.advice.trim().slice(0, 1200) : '',
    };
  }
  return result;
}

/** `student-view` 的一次读取。 */
interface LoadedWorksheet {
  id: string;
  title: string;
  /**
   * 屏幕上逐段画的就是它 —— 按任务分好段、空任务已滤掉、每段带标题与小题。
   * ⚠️ 与 `questions` 在**同一次 `setLoad`** 里建好（理由见下）。
   */
  groups: AnswerableGroup[];
  /**
   * 同上，只取节点 —— 作答状态机（`useWorksheetAnswers`）按 `node.id` 建态与校验题号。
   * ⚠️ **与 `items` 在同一次 `setLoad` 里建好**（不是渲染时现 `map` 一遍）：
   * 那个 hook 把 `questions` 存进 ref、并拿 `savedAnswers` 当水合 effect 的依赖项，
   * 「每次渲染换一个数组身份」正是本文件反复警告的那类陷阱。
   */
  questions: WorksheetQuestionNode[];
  /**
   * 「提交之后还能不能改」（规格 §8.4 的「三层控制」里的**第二层**）。
   *
   * 第一层在服务端（`PUT /:id/answers` 对已提交的题回 **409**，B3 做的）—— 那一层是
   * 唯一真正说了算的。但**只有它不够**：学生照样能敲字、能看见自己在改，然后那一次改动
   * 被 409 丢掉。所以这一层在这里：`false` 时已提交的题**收起输入控件**，
   * 与规格 §8.4 那张表说的「学生改已提交的题」的唯一合法前提（`allowResubmit` 为真）对齐。
   */
  allowResubmit: boolean;
  answerMode: WorksheetAnswerMode;
  /**
   * 这一份单的奖励配置（规格 §9.2，**学习单级**）。由 `resolveRewardScale` 收成
   * 「一定合法」的那一档：缺字段与坏值都落到默认档（星星），与新建学习单、
   * 与服务端 `normalizeSettings` 是同一个默认值，所以学生看到的那一档与教师配的是同一个。
   *
   * ★ M4a：它**只剩「哪一档」**（`RewardScale` 上的 `step` / `halfStep` 已删）——
   * 画出来的个数是**得分**（绝对值模型，规格 §12），学习单级那两个数由服务端折算进得分。
   */
  reward: RewardScale;
  /**
   * ★ 2026-10-08（教师 第 7 项）：画奖励**槽位**要的"满分几个"里**学习单级那一半**。
   *
   * 🔴 它**不在 `RewardScale` 上**（M4a 把 `step`/`halfStep` 从那个类型里删了，理由见其注释）。
   * 学生端现在要画"满分 N 枚、已得 M 枚"，而**服务端只下发得分、不下发满分**
   * ⇒ 满分只能在客户端自算：逐题填了用题上的 `points.full`，留空则用这一格回退。
   * ⚠️ 这条规则与服务端 `resolvePoints` 是**同一句话的两个实现**，详情与代价写在
   * `@/lib/worksheet-reward` 的 `resolveFullPoints` 上（改一处必须三处一起改）。
   */
  rewardFullFallback: number;
  backgroundTheme: WorksheetBackgroundTheme;
  backgroundImageUrl: string | null;
  backgroundPortraitImageUrl: string | null;
  /**
   * ★ 2026-09-27：**卡片透度**（题目卡片 + 任务容器两个面）。
   * 归一化与数值在 `@/lib/worksheet-surface`；缺字段 / 坏值一律回默认档（= 今天的样子）。
   */
  surfaceOpacity: WorksheetSurfaceOpacity;
  /**
   * 这名学生**已有的作答**（`GET /:id/answers` 的 `rows`）。
   *
   * 🔴 它是「学生做了一半刷新页面后，做好的题没了」的修复：作答走 HTTP、保存成功即出队
   * （规格 §8.3 的队列只管**还没发出去**的），所以**已经保存成功的题只能从服务端读回来**。
   *
   * ⚠️ 它放在 `LoadedWorksheet` 里、与题目一起**由同一次 `Promise.all` 灌进同一个 state**，
   * 这不是顺手：这个数组的身份决定了水合 effect 什么时候重跑（见
   * `UseWorksheetAnswersOptions.savedAnswers` 那条注释），而「每次 fetch 只建一份」
   * 是它引用稳定的**唯一**来源。挪出去现 map 一份，学生每敲一个字都会被水合抹掉。
   */
  savedAnswers: SavedAnswerRow[];
  generation: WorksheetGeneration;
  /**
   * AI 对当前学生的逐题参考分（评语与建议）。
   * 🔴 ★ 2026-10-07（教师裁定 2）：那份分**也**写回了 `WorksheetAnswer.score` ⇒
   *   它**会**参与总分与奖励。这一栏留给学生的是**评语与建议**（逐题明细），
   *   奖励那一格读的是行上的 `score`。⚠️ 别再写「不参与正式判分与奖励」。
   */
  aiReferenceScores: Record<string, StudentAiReferenceScore>;
  /**
   * ★ 2026-09-30：这间课堂**已开放的题 id**（教师看板的「逐题开放」，`manual` 档才用得上）。
   *
   * ⚠️ 缺字段（更老的服务端）⇒ **空数组** —— 那在 `manual` 档下的含义是「老师还没开放
   * 任何题」，学生会看到那句提示而不是一片空白。收干净由 `normalizeOpenQuestions` 负责
   *（`student-view` 与 socket 广播两个来路共用它，有用例）。
   */
  openQuestions: string[];
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; worksheet: LoadedWorksheet }
  | { kind: 'error'; message: string };

/**
 * 还没读到作答时给水合用的**空数组**。
 *
 * ⚠️ 必须是模块级常量，不能在渲染里现写 `[]`：那会让 `savedAnswers` 每次渲染都换一个
 * 身份 ⇒ 水合 effect 每次都重跑 ⇒ 学生敲进去的字被整体抹掉。
 */
const NO_SAVED_ANSWERS: SavedAnswerRow[] = [];

/**
 * ★ 2026-09-30：`openQuestions` 的默认值。
 *
 * ⚠️ 与上面那条**同一个理由**（模块级常量，不在渲染里现写 `[]`）：这个数组的**身份**
 * 进 `answerModeView` 之后会决定 `Set` 的构建，而每渲染一个新数组就是一次白做功 ——
 * 更要紧的是它是 props 的默认值，每次渲染换身份会让下游的 `memo`/依赖比较永远为真。
 */
const NO_OPEN_QUESTIONS: readonly string[] = [];

/**
 * ── 作答态渲染（唯一一份）────────────────────────────────────────────────────
 *
 * 🔴 这个组件**同时**被两处渲染，这是刻意的：
 *   · 学生端的本面板（`interactive`，学生真的在作答）；
 *   · 教师端的「学生端预览」（`interactive={false}`，只读）。
 *
 * 规格 §6.3 让教师**拿那个弹窗当验收依据**（原话是「教师看到的就是学生看到的宽度」）。
 * 在本次改动之前，教师端那个弹窗里是**手写的一份只读模仿** —— 于是同一份 `content`
 * 被两段各自演化的 JSX 画出来，「预览里长这样、学生那里不是」会成为一种没有任何报错的
 * 失真。现在两处是同一个组件、同一套样式（这个文件的 CSS module），分叉在结构上不可能。
 *
 * `interactive={false}` 时：控件 `disabled`、不渲染「提交本题」、不做任何状态芯片
 * （预览没有作答态可言），也不显示正确答案 —— 那会让教师误以为学生也看得到。
 *
 * 题目树在**调用方**拍平（`flattenAnswerable` → 只取节点），所以两处传进来的都是扁平的一列 ——
 * 「屏幕上画几道」这条口径也只有一处。
 */
export interface WorksheetQuestionListProps {
  /**
   * 要画的**段** —— 一个任务一段（标题 + 它的小题），连续散题合一段（无标题）。
   *
   * 🔴 不是「题目树里所有节点」：任务不是一道题（它没有作答控件），把它算进来会让
   * 屏幕上多出一张只有标题、没东西可答的卡（spec §十一）。
   *
   * ★ 2026-09-25（教师裁定）：学生看到的那一页**按任务分块** —— 任务名自己占一行，
   * 小题上不再挂编号、也不再写题型文字（题型退化成一个象形图标）。
   * 空任务已经由 `studentVisibleGroups` 滤掉，所以这里每一段至少有一道小题。
   */
  groups: AnswerableGroup[];
  /** 界面上的输入态。只读态传空对象即可。 */
  drafts: Record<string, AnswerDraft>;
  statuses: Record<string, WorksheetQuestionStatus>;
  submitting: Record<string, boolean>;
  interactive: boolean;
  /**
   * 「提交之后还能不能改」（规格 §8.4 的第二层，第一层在服务端的 409）。
   *
   * `false` ⇒ **已提交**的题收起输入控件、不渲染「重新提交」。只读态（预览）不受影响 ——
   * 那里 `statuses` 是空的，没有「已提交」可言。
   */
  allowResubmit: boolean;
  /**
   * 这一份单的奖励配置（规格 §9.2）。**不传 = 这个列表一处奖励都不画** ——
   * 教师端的「学生端预览」就是靠不传它来保证「教师端不出现奖励」（规格 §3-U）
   * 的，而不是靠某处 `if (是教师)`。⚠️ 与下面 `interactive` 那道闸门是**两道**，
   * 不是重复：这一道管「没有配置就没有奖励」，那一道管「只读的预览永远没有奖励」。
   */
  reward?: RewardScale | null;
  /** ★ 2026-10-08（教师 第 7 项）：学习单级的满分回退值（题上没填 `points.full` 时用它）。 */
  rewardFullFallback?: number;
  /** 每道题的得分（`useWorksheetAnswers` 的 `scores`）。不传 = 一道题都没判分。 */
  scores?: Record<string, WorksheetScore>;
  gradeStates?: Record<string, WorksheetGradeState | null>;
  /** 远程智能体给当前学生的参考分；只在学生端传入，教师预览不显示。 */
  aiReferenceScores?: Record<string, StudentAiReferenceScore>;
  wrongBlankIndexes?: Record<string, number[]>;
  /** ★ 2026-09-27：答错的空的正确答案（空下标 → 答案）。**只在已提交的题上有内容**。 */
  correctBlanks?: Record<string, Record<string, string>>;
  rewardBursts?: Record<string, number>;
  answerMode?: WorksheetAnswerMode;
  /**
   * ★ 2026-09-30：教师**已开放的题 id**（`manual` 档专用，其它三档一律忽略）。
   *
   * 🔴 不传 = 空数组 = 「一道都还没开放」—— 在 `manual` 档下那是**学生看到一句话**
   *（「老师还没开放后面的题」）而不是一片空白。所以教师端的只读预览不传它也没有副作用
   *（那一档的闸门根本不在预览里跑，见上面 `interactive` 那段注释）。
   */
  openQuestions?: readonly string[];
  onChange?: (node: WorksheetQuestionNode, draft: AnswerDraft) => void;
  onSubmit?: (node: WorksheetQuestionNode) => void;
  /**
   * ★ M5a：课堂级「锁定作答」。
   *
   * 🔴 与上面那条 `allowResubmit`（本题已提交且不许重交）是**两件事**，刻意分成两个字段：
   * 一个是**题级**的、由学习单的设置决定；一个是**课堂级**的、由老师此刻按下的按钮决定。
   * 合并成一个布尔值之后，「锁定期间还能交卷、而已提交的题不能重交」就表达不出来了。
   *
   * ⚠️ **必填**（不给默认值）：本组件同时被教师端的「学生端预览」渲染，那条路永远是
   * `false` —— 但让它**显式**写出来，比留一个默认值更能防止学生端那条路忘传。
   */
  answersLocked: boolean;
}

export function WorksheetQuestionList({
  groups,
  drafts,
  statuses,
  submitting,
  interactive,
  allowResubmit,
  reward,
  rewardFullFallback,
  scores,
  gradeStates,
  aiReferenceScores,
  wrongBlankIndexes,
  correctBlanks,
  rewardBursts,
  answerMode = 'open',
  openQuestions = NO_OPEN_QUESTIONS,
  onChange,
  onSubmit,
  // 改名解构：下面那个 map 里 `locked` 已经表示「本题已提交且不许重交」，
  // 两个都叫 locked 会让 `controlsDisabled` 那一行读不出是哪一条在起作用。
  answersLocked: classroomLocked,
}: WorksheetQuestionListProps) {
  if (groups.length === 0) {
    return (
      <div className={styles.questions} data-interactive={interactive ? '1' : '0'}>
        <p className={styles.cardNote}>这份学习单还没有题目。</p>
      </div>
    );
  }

  /*
    ★ 2026-09-30：这段「哪几道题此刻可作答」的判据**搬进了 `@/lib/worksheet-answer-mode`**
    （`answerModeView`，四档各有用例）。搬走的理由不是好看：加第四档 `manual` 时，
    内联版本要同时改三处（分支、隐藏计数、末尾那句解锁提示），而**每一处漏改都不报错** ——
    最典型的是提示语：手动档复用分步那句「完成当前小题后继续解锁」是一句学生做不到的**假话**。
    ⚠️ `interactive` 不进那个纯函数：它是**渲染**的事（教师端的只读预览永远看全卷，
       那不是「学生此刻能看什么」的问题）。
  */
  const view = interactive
    ? answerModeView({ groups, statuses, answerMode, openQuestions })
    : { groups, hiddenCount: 0, unlockHint: '' };
  const visibleGroups = view.groups;
  const hiddenQuestionCount = view.hiddenCount;

  return (
    <div className={styles.questions} data-interactive={interactive ? '1' : '0'}>
      {visibleGroups.map((group, groupIndex) => (
        // ⚠️ `key` 用下标 + 标题：散题那几段的 `title` 恒为 `null`，拿它当 key 会撞。
        // 段本身不重排（页面上唯一会重排的是小题，而它们各自按 `node.id` 作 key）。
        // ★ 2026-09-26（教师）：「题目要**装在**任务容器里」—— 原来只有一个标题 + 一串平铺的卡，
        // 标题看起来像它自己也是一道题（而它没有提交，只是看着像）。
        // ⚠️ **只在有标题的那几段**加容器：散题那一段（`title === null`）没有名字，
        // 给它套一个框只是噪音 —— 而它本来就是老数据才有的形态。
        <div
          className={styles.group}
          data-container={group.title ? '1' : '0'}
          key={`${groupIndex}:${group.title ?? ''}`}
        >
          {group.title && <h3 className={styles.groupTitle}>{group.title}</h3>}
          {/* ★ 2026-09-25（教师裁定）：任务的**描述** —— 例如「读下面的材料，回答 1–3 题」。
              它挂在任务上（`data.description`），不是题目的一部分。 */}
          {group.description && <p className={styles.groupDescription}>{group.description}</p>}
          {group.items.map(({ node, heading }) => {
        // 🔴 `raw`（学生动过没有）与 `draft`（屏幕上画什么）**是两件事**，别合并：
        //   · `draft` = `raw ?? emptyDraftFor(node)` —— 负责**渲染**。排序题的起点是一列
        //     排好的条目（`data.items` 的顺序），所以「还没碰过」也不能画成空的；
        //   · `raw` —— 负责**判「这一题有没有内容」**。`undefined` = 学生一个指头都没动过，
        //     那时「提交本题」必须按死：排序题的起点虽然是合法作答，但它**还没被保存过**
        //     （服务端要那一行存在才收提交，见 `routes/worksheets.ts` 的
        //     「请先作答再提交本题」），点下去只会换来一句把网络问题说成学生问题的话。
        const raw = drafts[node.id];
        const draft = raw ?? emptyDraftFor(node);
        const state = questionDisplayState(statuses[node.id], raw);
        const submitted = statuses[node.id] === 'submitted';
        // 已提交 + 不许重交 ⇒ 这一题对学生是「定稿」。控件收起，按钮不出现。
        const locked = submitted && !allowResubmit;
        const untouched = raw === undefined || isDraftEmpty(raw);
        // 没内容可提交、又还没交过 ⇒ 按钮按不动（点下去必然被服务端 400 拒）。
        const submitDisabled = Boolean(submitting[node.id]) || (!submitted && untouched);
        // ★ M5a：课堂级锁定也禁用控件（停笔），但它**不**收起提交按钮 ——
        // 裁定 ③ 是「停笔，但还能交卷」。见下面渲染那一段。
        const controlsDisabled = !interactive || locked || classroomLocked;
        const promptRuns = readPromptRunsFor(node);
        // 填空题的空 ↔ 作答草稿的绑定（见 `PromptText` 的 `blanks`）。
        const fillDraft = draft && draft.kind === 'fill' ? draft : null;
        const blankBinding = {
          values: fillDraft ? fillDraft.texts : [],
          disabled: controlsDisabled,
          onChange: (index: number, value: string) => {
            // ⚠️ 长度以**题目里的空数**为准，不是以旧草稿的长度为准：教师加了一个空之后
            // 学生屏幕还没刷新时，旧草稿会短一格 —— 按下标写回去的话那一格会被吃掉。
            const count = Math.max(readBlankCount(node), index + 1);
            const texts = Array.from({ length: count }, (_, i) => (
              i === index ? value : ((fillDraft && fillDraft.texts[i]) || '')
            ));
            // ⚠️ 走 `onChange` 这个 **prop**（本组件同时被「学生端预览」渲染 ——
            // 那一侧的 `onChange` 是个空操作）。别在这里直接碰作答状态机的内部。
            // ⚠️ `onChange` 是**可选 prop**（预览那一侧没有它，且那些框是 disabled）。
            onChange?.(node, { kind: 'fill', texts });
          },
        };
        const promptImage = readPromptImage(node);
        const questionIcon = <span className={styles.questionIcon}>{questionTypeIcon(node.type)}</span>;
        const gradeState = interactive ? gradeStates?.[node.id] : undefined;
        const aiReferenceScore = interactive ? aiReferenceScores?.[node.id] : undefined;
        const mixedFillScoring = node.type === 'fill-blank'
          && node.autoGrade !== false
          && hasExplicitFillGrading(fillSettingsFor(node, promptRuns))
          && Boolean(aiReferenceScore);
        /**
         * ★ 2026-09-28（教师）：「按这种效果制作」—— 状态、判分与奖励合成**一条**，
         * 三段用细线分开（效果图：✓已完成 ｜ !部分答对 ｜ 🚀获得奖励 ×1）。
         *
         * 🔴 原来它们是**两块**：一个 `✓ 已完成` 的小徽章 + 一个「全部答对／部分答对」的
         * 反馈框（奖励挂在那个框里）。合成一条之后，学生一眼看完「做完没 / 对不对 /
         * 拿到什么」，不用在两处找。
         * ⚠️ **判分与奖励仍然只在 `interactive` 时有**（教师端预览 `gradeState` 是
         * `undefined` ⇒ 那两段根本不渲染）—— 这条闸一个字没动。
         * ⚠️ `role="status"` + `aria-live` 从原来那个反馈框搬到这里：判分结果是
         * 提交后才出现的一段反馈，读屏要念出来。
         */
        /*
         * ★ 2026-10-08（教师 第 7 项）：画奖励槽位要的**满分**（= 全对能得几分 = 画几枚图标）。
         * 逐题填了 `points.full` 就用它，留空则继承学习单级（`rewardFullFallback`）。
         * 🔴 与服务端的 `resolvePoints` 是**同一句话的两个实现** —— 代价与三处同步的约束
         *    写在 `@/lib/worksheet-reward` 的 `resolveFullPoints` 上，改那里就要一起改。
         */
        const fullPoints = resolveFullPoints(node.points, rewardFullFallback ?? 1);
        const verdictLabel = mixedFillScoring
          ? (gradeState === 'correct' ? '自动评分部分全对' : gradeState === 'partial' ? '自动评分部分答对' : '自动评分部分再想想')
          : gradeState === 'correct' ? '全部答对' : gradeState === 'partial' ? '部分答对' : '再想一想';
        const questionMeta = state !== 'empty' || gradeState || aiReferenceScore ? (
          // ★ 2026-09-29（教师 ⑤）：外面多了一层**锚点** —— 奖励角标要挂在判定那一格的
          // 右上角上，而 `.questionResult` 有 `overflow: hidden`（它要把两格的底色裁进圆角里）
          // ⇒ 角标必须是它的**兄弟**才不会被裁掉。`margin-left: auto`（原来在
          // `.questionResult` 上，负责把整条顶到最右）跟着搬到这一层。
          <span className={styles.resultRewardAnchor}>
            {/*
              ★ 2026-10-08（教师 第 7 项，含第二批的补充）：
                第 7 项原话：「改一种显示方式，**移动到这行绿色文字信息框的前面**……
                评分前先显示非常浅的灰度化图标，评分后把指定个数改为正常颜色」；
                第二批又补：「**图标在框外**，图标可以大一些」。
              ⇒ 所以它是 `.resultRewardAnchor` 下的**兄弟**、排在 `.questionResult`
                （那条白底圆角边框）**之前** —— 在**框外**，不是条子里的一格。
              ⚠️ 门是 `state !== 'empty' || gradeState`：题目**完全没作答过**时不画 ——
                一排灰图标挂在没碰过的题上只是噪音。
              ⚠️ 这条设计线上的三次反转、以及 09-28 那条「框高一致」的顾虑，
                完整记在 `reward-badge.tsx` 的 `QuestionReward` 上。
            */}
            {reward && (state !== 'empty' || gradeState) && (
              <span className={styles.resultReward}>
                <QuestionReward scale={reward} full={fullPoints} score={scores?.[node.id] ?? null} />
              </span>
            )}
            <div className={styles.questionResult} role="status" aria-live="polite">
              {state !== 'empty' && (
                <span
                  className={styles.resultCell}
                  data-tone={state === 'submitted' ? 'progress-completed' : 'progress-drafting'}
                >
                  <WorksheetStatusIcon name={state === 'submitted' ? 'completed' : 'drafting'} size={18} />
                  {state === 'submitted' ? '已完成' : '编辑中'}
                </span>
              )}
              {gradeState && (
                <span className={styles.resultCell} data-tone={gradeState}>
                  {/* ★ 2026-09-29（教师）：「三种状态的图标，如果都用圆来表示呢？」
                      ⇒ 记号从**字符**换成**画出来的圆环 + 填充比例**：
                      全对 ● 填满、部分答对 ◐ 左半边、不对 ○ 不填。
                      🔴 形状与三条理由全在 `result-glyph.tsx` 的文件头（含「顺带修掉
                        `−` 那个『换一个浏览器就偏高』的字体度量缺陷」）。
                      ⚠️ 与教师看板抽屉那套 `✓ / ½ / ✗` 仍然**刻意分叉**：那是给教师看的
                        统计符号（一屏几十行，要极窄），这边是给中小学生看的反馈。 */}
                  <ResultGlyph state={gradeState} />
                  {verdictLabel}
                  {/* ★ 2026-10-08（教师 第 7 项）：奖励**不再挂在这一格里** —— 它搬到了整条
                      `.questionResult` 的最前面（见上面那一段）。这里原先是 2026-09-29 的
                      绝对定位角标；那次「不占行内空间 ⇒ 两格高度不变」的顾虑**仍然有效**，
                      所以在上面那段里用 18px 图标 + `gap: 1px` 自己保住。 */}
                </span>
              )}
              {aiReferenceScore && (
                <span
                  className={`${styles.resultCell} ${styles.aiReferenceCell}`}
                  data-tone="ai-reference"
                  aria-label={aiReferenceScore.score === null
                    ? 'AI 暂时无法可靠评分，但给出了学习建议'
                    : `AI 评分 ${aiReferenceScore.score}/${aiReferenceScore.maxScore} ${aiReferenceScore.unit}。这是 AI 给你的小建议`}
                >
                  {reward && aiReferenceScore.score !== null && <RewardIcon kind={reward.style} state="earned" size={20} />}
                  <b>{aiReferenceScore.score === null ? 'AI 建议' : `${aiReferenceScore.score}/${aiReferenceScore.maxScore}`}</b>
                  {aiReferenceScore.score !== null && (!reward || reward.style === 'points') && <em>{aiReferenceScore.unit}</em>}
                  <small>这是 AI 给你的小建议</small>
                </span>
              )}
            </div>
          </span>
        ) : null;
        // ★ 2026-09-25（第二轮终审 F5）：`section` 的 `aria-label` 是**可访问名**，
        // 🔴 **视觉上仍然没有编号与题型文字**（教师裁定）—— 它不进视觉、不影响那条裁定。
        // 加它的理由：去掉那个题号徽章时，顺带把这一题在页面里唯一的身份一起删了 ——
        // 读屏用户听到的只有「题干 + 控件」，说不出自己在做哪一题。
        return (
          <section
            className={styles.question}
            data-state={state}
            key={node.id}
            aria-label={`${heading} ${questionTypeLabel(node.type)}`}
          >
            {interactive && reward && gradeStates?.[node.id] === 'correct' && (rewardBursts?.[node.id] ?? 0) > 0 ? (
              <RewardBurst
                key={`${node.id}:${rewardBursts?.[node.id]}`}
                scale={reward}
                score={scores?.[node.id] ?? null}
              />
            ) : null}
            {/* ★ 2026-09-26：「选择填空」的作答**跨了题干与题干下方**（空在题干里、
                待选词在下面），而**拖拽的手势状态必须在一个组件里**（见
                `choice-blank-answer.tsx` 的文件头）⇒ 这一段整个交给它。
                🔴 所以这里要**跳过**下面那两块 —— 否则题干会画两遍。 */}
            {(node.type === 'choice-blank' || node.type === 'fill-blank') ? (
              <ChoiceBlankAnswer
                node={node}
                draft={fillDraft ?? { kind: 'fill', texts: [] }}
                disabled={controlsDisabled}
                onChange={(next) => onChange?.(node, next)}
                // ★ 2026-09-27：答错的空的正确答案（**只这一题**；服务端只发答错的那几格）。
                wrongBlankIndexes={wrongBlankIndexes?.[node.id]}
                correctBlanks={correctBlanks?.[node.id]}
                // 图标 + **别名**一起给（那一行左边是「图标 别名」，见组件里的注释）
                leadingIcon={<>{questionIcon}<span className={styles.typeNickname}>{questionTypeNickname(node.type)}</span></>}
                status={questionMeta}
              />
            ) : (<>
            {/* ★ 2026-09-26：题干的渲染**只有这一份实现**了（`PromptText`）。
                在此之前这里画一次、教师编辑页折叠时另画一次，两份都不会因为另一份改了
                而报错。样式（粗细 / 斜 / 下划线 / 着重号 / 颜色）由 `promptRunStyle` 给，
                本组件的 `.prompt` 只管基线（字号 / 行高 / 换行 / 默认色）。 */}
            {/* ★ 2026-09-28（教师，图 49）：这一行只放两样 —— 左边题型图标 + 别名，
                右边结果条；**题干正文挪到下一行**（原来三样挤一行，题干被夹在中间）。 */}
            <div className={styles.questionLead}>
              {questionIcon}
              <span className={styles.typeNickname}>{questionTypeNickname(node.type)}</span>
              {questionMeta}
            </div>
            <div className={styles.prompt}>
              {/* ★ 2026-09-27（教师）：「学生页面中，如果是多选题的话，要在题干前面自动加上
                  『多选』这样的提示文字。」
                  🔴 判据是**共享的那一份** `isMultipleChoice`（`@/lib/worksheet-questions`，
                      编辑页的「多选」开关用的是同一个函数对象 —— 有一条同一性用例钉着）。
                      在这里自己写一遍 `node.type === 'multi-choice'` 就会漏掉旧数据：那批多选
                      长在 `single-choice` 上（`data.choiceMode === 'multiple'`），
                      症状是**老卷子不显示提示、新卷子显示**，而两边都不报错。
                  ⚠️ 贴在题干**行内最前面**（不是单独一行）：它是一个前缀标签，不是一段说明 ——
                      单开一行会在题干与选项之间插进一个元素，而这一屏的层次是「题干 > 其它」。
                  ⚠️ 不加 `aria-hidden`：**「这题不止一个答案」正是学生要听到的信息**
                      （本仓那条「图标化只减视觉宽度、不减无障碍信息」的同一条纪律）。 */}
              {isMultipleChoice(node) && <span className={styles.multiHint}>多选</span>}
              <PromptText
                text={node.prompt}
                runs={promptRuns}
                placeholder={<span className={styles.placeholder}>（这道题的题干还没写）</span>}
                // ★ 2026-09-26：填空题的空**就在题干里**（教师裁定），所以输入框由题干
                // 这一份渲染器画 —— 而不是像原来那样在题干**下面**再画一排。
                // ⚠️ 绑定**恒给**（不是「有草稿才给」）：教师端的「学生端预览」走的是
                // 同一个组件、`drafts` 是空的，那里也要看到**同样的输入框**（规格 §6.3：
                // 教师看到的就是学生看到的）。没草稿时值是空的、并且 disabled。
                blanks={node.type === 'fill-blank' ? blankBinding : undefined}
              />
            </div>
            {promptImage && (
              <img className={styles.promptImage} src={worksheetAssetUrl(promptImage)} alt="题目配图" />
            )}

            {/* ★ M4a/D2：作答区**一个分派器**（6 个作答体 + 判断题/单选/多选合成一个）。
                在这之前这里是三条平铺的 `node.type === …`，而教师端的预览渲染同一个组件
                —— 再加 6 个题型就是两处各加 6 支，必然漂移（症状：预览里画得出来、
                学生那里画不出来，**没有任何报错**）。见 `questions/index.tsx` 的文件头。
                ⚠️ `draft` 而不是 `raw`：渲染用的起点必须是有形状的那一份。 */}
            <QuestionInput
              node={node}
              draft={draft}
              onChange={onChange}
              disabled={controlsDisabled}
              // ★ 2026-09-27（教师）：「选择和判断学生错误后也要与填空一样给出叉叉符号并
              // 给出正确答案。」服务端只在**判过分、且学生没全对**时才发这串东西
              //（`wrongChoiceAnswers` 那条窄口）⇒ 还没提交的题这里是空表，
              // 答错标记一个都不会画（判据在 `wrongSelectedKeys`，有用例）。
              // ⚠️ 教师端的预览走的是同一个组件、**不传**这个 prop。
              correctKeys={correctKeysFromPayload(correctBlanks?.[node.id])}
              // ★ 2026-09-29（教师）：「连线题在批改后，如果错误的话，没有出现错误信息。」
              //
              // 🔴 这一行就是那个 bug 的修复，而根因值得记下来：服务端 2026-09-28 就修好了
              //（`wrongAnswers` 按题型分派，连线题发「《绝句》 → 杜甫」那样一整句话），
              // 客户端那一半**只给 `ChoiceBlankAnswer` 那条路接了** `correctBlanks`
              //（`f6b6ab8`）—— 而填空 / 选择填空走的正是那条路，所以它们当场就好了。
              // **连线题走的是 `QuestionInput` 这条路，而这里从来没接过这个 prop**
              // ⇒ 学生答错了什么也看不到，全程没有一处报错。
              //
              // ⚠️ 上面那个 `correctKeys` 是**另一件东西**（选择/判断的选项 key，由
              // `correctKeysFromPayload` 从同一份数据里解出来）—— 两者都要传：
              // 少了上面那个，选择题不标红；少了下面这个，连线题没有正确答案。
              // 这条接线由 `panel-props-parity.test.ts` 看着（它查「每一个可选 prop 都传了」）。
              correctBlanks={correctBlanks?.[node.id]}
            />
            </>)}

            {interactive && aiReferenceScore?.comment && (
              <aside className={styles.aiScoreComment} aria-label="AI 评分反馈">
                <span className={styles.aiScoreCommentMark} aria-hidden="true">AI</span>
                <details className={styles.aiScoreCommentBody}>
                  <summary className={styles.aiScoreCommentSummary}>
                    <span className={styles.aiScoreCommentHeading}>
                      <strong>AI 给你的评价</strong>
                      <small>{aiReferenceScore.advice ? '点击查看详细建议' : '继续保持并认真订正'}</small>
                    </span>
                    <span className={styles.aiScoreCommentText}>{aiReferenceScore.comment}</span>
                  </summary>
                  {aiReferenceScore.advice && (
                    <span className={styles.aiScoreAdvice}>
                      <strong>接下来可以这样做</strong>
                      <span>{aiReferenceScore.advice}</span>
                    </span>
                  )}
                </details>
              </aside>
            )}

            {/* 「提交本题」内联在每题下方，**不做固定底栏**（规格 §3-AC）。
                ⚠️ 锁住时不渲染按钮，而是说清楚为什么 —— 一个按不动的「重新提交」比
                一句话难懂得多（学生会反复点它）。 */}
            {/* ⊘ 2026-09-28（教师）：「这个字不要了」—— 原来 `locked` 那一支只有一句话
                （「这道题已经完成，老师设置为不能再修改」），删掉之后那一支空了。
                ⇒ 直接改成「非锁定才渲染提交区」：锁定时这里什么都不画（按钮本来就不渲染）。 */}
            {interactive && !locked && (
                <>
                  {/* ★ M5a：锁定期间**保留提交**（停笔但可交卷），这句话是它的说明。
                      「只能提交已保存的内容」不是修辞 —— 有未保存改动的那道题会被拦下
                      （见 `use-worksheet-answers.ts` 的 `submit`）。 */}
                  {classroomLocked && (
                    <p className={styles.lockedNote}>老师已锁定作答 —— 只能提交已保存的内容</p>
                  )}
                  <div className={styles.submitRow}>
                    <button
                      type="button"
                      className={`${styles.submitButton}${submitted ? ` ${styles.submitButtonResubmit}` : ''}`}
                      disabled={submitDisabled}
                      onClick={() => onSubmit?.(node)}
                    >
                      {/* ★ M6b/13：判分要等服务端往返，而这段时间原先屏幕上只有**半透明的按钮 + 三个字**。
                          加一个 12px 的纯 CSS 旋转圈。keyframe 定义在 `worksheet.module.css`
                          自己的 `@keyframes submitSpin` —— 🔴 **不能**改成引 `globals.css` 的
                          全局 `spin`：CSS 模块会把 `animation-name` 加哈希前缀，跨文件引用
                          会变成悬空引用（圈不转、构建还不报错）。见 `src/lib/css-module-animation.test.ts`。 */}
                      {submitting[node.id] ? (
                        <>
                          <span className={styles.spinner} aria-hidden="true" />
                          正在保存…
                        </>
                      ) : submitted ? '保存修改' : '完成作答'}
                    </button>
                  </div>
                </>
            )}
          </section>
          );
          })}
        </div>
      ))}
      {hiddenQuestionCount > 0 && (
        <div className={styles.lockedTail}>
          <span aria-hidden="true">🔒</span>
          <strong>后面还有 {hiddenQuestionCount} 道小题</strong>
          {/* ⚠️ 那半句解锁说明**由判据层给**（`view.unlockHint`）—— 在这里写三元就会在
              加档时漏掉一处，而漏掉的那一档对学生说的是一句做不到的事。 */}
          <span>{view.unlockHint}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 面板本体。
 *
 * props 就是契约那六项，没有额外项 —— 与探究空间面板不同，学习单**不需要**借 socket
 * （作答走 HTTP，实时广播是服务端 → 教师看板那一侧的事，§5.7）。
 */
/**
 * ★ M5a 给学习单面板加的 props —— **在 `ModulePanelProps` 之外**，不往上加字段。
 *
 * 🔴 **为什么不加进 `ModulePanelProps`**（两条都是 `tsc` 当场给的，不是推演）：
 *   · 那个接口被 `ExplorePanelProps` / `ModulePlaceholderProps` 继承 ⇒ 加一个必填字段会
 *     逼着**探究空间面板与占位面板**各背一个它们根本不用的 prop（`error TS2741`，
 *     两个调用点都要改）；
 *   · 它还被 `_ContractCheck`（`ChatPanelProps extends Omit<ModulePanelProps, …>`，
 *     `classroom-types.ts:308`）钉着 ⇒ 学伴面板也得跟着加（`error TS2344`）。
 * 而「锁定作答」只有学习单这一个模块会读。外壳本来就持有这个布尔量，直接递给本面板即可。
 */
export interface WorksheetPanelProps extends ModulePanelProps {
  /**
   * ★ M5a：这间课堂此刻是否锁定了作答（会话层的专门 state + socket 事件，外壳转手）。
   *
   * ⚠️ **不要**改成读 `classroom?.answersLocked`：那个对象 15 秒才刷新一次，而锁定要
   * **立刻**生效 —— 学生多写 15 秒就不是「停笔」了。
   */
  answersLocked: boolean;
  /**
   * ★ 2026-09-30：教师「逐题开放」的清单（按学习单 id 分键；`manual` 档才用得上）。
   *
   * 🔴 与 `answersLocked` 不同，这里的**初值不来自会话快照**，而是面板自己那次
   * `student-view` 读取（它比 15 秒快照新，而且知道「是哪一份单」）。这个 prop 只承载
   * **socket 上那条广播**：`worksheetOpen[自己这份单的 id]` 有值就用它，没有就用读到的那份。
   * ⚠️ 两者不是「二选一」而是**并存**：广播里带的是状态本身（那是列表，快照兜不住），
   * 而读取那份保证「刚进面板时是对的」。谁新谁旧在这里不重要 —— 广播是**边沿**，
   * 它一到就覆盖；读取是**底**，它只在没有广播时说话。
   */
  worksheetOpen: Record<string, string[]>;
}

export function WorksheetPanel({ active, classroom, session, toast, setToast, answersLocked, worksheetOpen }: WorksheetPanelProps) {
  const accent = MODULE_META.worksheet.accent;
  const label = MODULE_META.worksheet.label;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // 见文件头 ②：`cssVar` 与学伴面板共用同一个名字，**不要**改成模块专属的名字。
  useModuleViewport({ active, containerRef, cssVar: '--module-viewport-height' });

  /**
   * 🔴 网页/智能体/学习单三者的解析口径**完全一致**（`@/lib/classroom-material`）：
   * 高级模式只认**学生自己的组**，本组没配就是 `null`，**不回落**到课堂级数组
   * （那个数组在高级模式下可能是别的组的材料 —— 学生会静默地用别的组的单子，
   * 而画面看起来完全正常）。
   */
  const material = effectiveGroupWorksheet(classroom, session);
  const worksheetId = material?.id ?? null;

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  /** 重试按钮的计数器：+1 ⇒ 重新拉一次（不改 key，避免把面板整个重挂）。 */
  const [reloadToken, setReloadToken] = useState(0);
  /**
   * ★ 2026-09-28：收到清除指令后重拉服务端那一份。
   * 🔴 **必须 `useCallback` 稳定**：它进了 `useWorksheetAnswers` 里那条 effect 的依赖，
   * 内联箭头每次渲染都是新引用 ⇒ 那条 effect 每帧都跑。今天有 token 守卫兜着不会成环，
   * 但那是**碰巧**（守卫在调用之前）—— 别把这个当许可。
   */
  const handleCleared = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!worksheetId) {
      setLoad({ kind: 'loading' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    (async () => {
      const auth = { ...getStudentSessionAuthorization() };
      const base = `${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(worksheetId)}`;
      try {
        // 🔴 **两次读取并行、一起失败**（`Promise.all`，不是一个接一个）：
        //   · 并行的理由是延迟 —— 学生端那台老 iPad 上，两次串行就是两个来回；
        //   · 「一起失败」是**本修复要害**的一条：作答读不回来而题目照常显示的话，
        //     学生看到的是一份**空白**的卷子，而他的作答其实好好地躺在服务端 ——
        //     那正是这次要修的那个症状，只是换了个成因。宁可整块报错 + 给一个重试按钮
        //     （下面那个 `error` 卡片），也不要让他看着空白以为自己白写了。
        const [viewRes, rowsRes] = await Promise.all([
          fetch(`${base}/student-view`, { credentials: 'include', headers: auth }),
          // ⚠️ 与 `student-view` **分两条路**（不是把那五列塞进 `student-view` 的响应体）：
          // 理由写在服务端 `GET /:id/answers` 的注释里 —— 一句话是「那条响应体被一条
          // 对整串做 `!includes('answers')` 的红线用例守着，红线不该为新功能让路」。
          fetch(`${base}/answers`, { credentials: 'include', headers: auth }),
        ]);
        if (cancelled) return;
        if (!viewRes.ok || !rowsRes.ok) {
          // 拿**失败那一个**的 `error`（服务端给的是中文、且比客户端更清楚为什么）。
          const failed = !viewRes.ok ? viewRes : rowsRes;
          const payload = await failed.json().catch(() => null);
          const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : null;
          setLoad({ kind: 'error', message: message || `读取学习单失败（错误 ${failed.status}）` });
          return;
        }
        const data = await viewRes.json() as {
          id: string;
          title: string;
          content?: { nodes?: unknown };
          // ⚠️ 这份内联类型是**下发的 settings 的形状**（不是「本文件读的那几个键」）：
          // 奖励那三项里**只有 `rewardStyle` 经 `resolveRewardScale` 消费** ——
          // `rewardStep` / `halfStep` 仍在下发（服务端的 `readStudentSettings` 会带上它们），
          // 但学生端的显示层不读：它们已经由服务端折算进**得分**（M4a 的绝对值模型，
          // 规格 §12），照原样列在这里只是为了让「下发的形状」一眼看得全。
          settings?: {
            allowResubmit?: unknown;
            answerMode?: unknown;
            rewardStyle?: unknown;
            rewardStep?: unknown;
            halfStep?: unknown;
            backgroundTheme?: unknown;
            backgroundImageUrl?: unknown;
            backgroundPortraitImageUrl?: unknown;
            /** ★ 2026-09-27：卡片透度。同样是 `unknown` —— 归一化在下面那一处。 */
            surfaceOpacity?: unknown;
          };
          /** ★ 2026-09-30：这间课堂已开放的题 id（`manual` 档用；更老的服务端不发这一格）。 */
          openQuestions?: unknown;
        };
        const rowsData = await rowsRes.json().catch(() => null);
        if (cancelled) return;
        const rawNodes = data.content && Array.isArray(data.content.nodes) ? data.content.nodes : [];
        const groups = studentVisibleGroups(rawNodes as WorksheetQuestionNode[]);
        const questions = groups.flatMap((group) => group.items.map((item) => item.node));
        setLoad({
          kind: 'ready',
          worksheet: {
            id: data.id,
            title: data.title,
            // 🔴 任务不是一道题：它没有作答控件，**不能**当成一张卡片渲染。
            // 走 `flattenAnswerable` —— 于是学生看到的题号（`任务一 · 1`）与看板、抽屉、
            // 导出里那份是同一个函数算出来的。
            groups,
            questions,
            // 缺字段时按**允许**处理：服务端的 `readStudentSettings` 一定会补齐这几个键
            // （落库的 `settings` 都过了 `normalizeSettings`），所以缺字段只可能是更老的
            // 服务端。那种情况下把学生锁住，才是真正的伤害。
            allowResubmit: data.settings?.allowResubmit !== false,
            // ★ 2026-09-30：四档的判据**只有一份**（`@/lib/worksheet-answer-mode`）——
            // 这里原来也有一份内联副本，加第四档时它会把 `manual` 静默降级成 `open`。
            answerMode: normalizeAnswerMode(data.settings?.answerMode),
            // 与上面同一条纪律（坏形状 / 缺字段 ⇒ 空数组，不抛也不画错）。
            openQuestions: normalizeOpenQuestions(data.openQuestions),
            // 奖励同理：缺字段落到默认档（星星 ⭐），不抛也不画一个错的档。
            reward: resolveRewardScale(data.settings),
            // ★ 2026-10-08：学生端**画奖励槽位**要"满分几个"，而服务端只下发得分
            // ⇒ 学习单级那一半在这里算（逐题填了 `points.full` 就轮不到它）。
            // 🔴 走 `resolveWorksheetFullStep` 而**不是** `normalizeRewardStep` ——
            //    后者的域是 `{1,2,3,5}`（教师端下拉框的可选项），而服务端判分对
            //    `rewardStep` 只要求 `1..99`；两者用错会在手改过库的情况下静默错位。
            rewardFullFallback: resolveWorksheetFullStep(data.settings),
            backgroundTheme: normalizeWorksheetBackgroundTheme(data.settings?.backgroundTheme),
            // ★ 2026-09-27：与上面几格同一条纪律 —— 认不出 / 缺字段就回默认档，不抛。
            surfaceOpacity: normalizeWorksheetSurfaceOpacity(data.settings?.surfaceOpacity),
            backgroundImageUrl: typeof data.settings?.backgroundImageUrl === 'string' && data.settings.backgroundImageUrl.startsWith('/uploads/chat/')
              ? data.settings.backgroundImageUrl
              : null,
            backgroundPortraitImageUrl: typeof data.settings?.backgroundPortraitImageUrl === 'string' && data.settings.backgroundPortraitImageUrl.startsWith('/uploads/chat/')
              ? data.settings.backgroundPortraitImageUrl
              : null,
            // 每次 fetch **只建这一份**（引用稳定，见 `LoadedWorksheet.savedAnswers`）。
            savedAnswers: parseSavedAnswers(rowsData),
            generation: normalizeGeneration(rowsData?.generation),
            aiReferenceScores: parseAiReferenceScores(rowsData),
          },
        });
      } catch {
        if (!cancelled) setLoad({ kind: 'error', message: '网络不太好，学习单没能读出来' });
      }
    })();
    return () => { cancelled = true; };
  }, [worksheetId, reloadToken]);

  const questions = load.kind === 'ready' ? load.worksheet.questions : [];
  const answers = useWorksheetAnswers({
    classroomId: classroom?.id ?? null,
    participantId: session?.id ?? null,
    worksheetId,
    questions,
    // ⚠️ 走 `NO_SAVED_ANSWERS`（模块级常量）而不是现写 `[]`：水合 effect 拿它当依赖项，
    // 每次渲染换一个数组身份就会把学生正在敲的字抹掉。见那个常量的注释。
    generation: load.kind === 'ready' ? load.worksheet.generation : undefined,
    savedAnswers: load.kind === 'ready' ? load.worksheet.savedAnswers : NO_SAVED_ANSWERS,
    setToast,
    // ★ M5a：**从 props 进来**（D1 铺好的那条路：会话层专门 state → 外壳 → 本面板）。
    // ⚠️ 不要改成读 `classroom?.answersLocked`：那个对象 15 秒才刷新一次，
    // 而锁定要**立刻**生效 —— 学生多写 15 秒就不是「停笔」了。
    answersLocked,
    // ★ 2026-09-28：收到清除指令后重拉一次服务端那一份 —— 重水合走**本面板既有**的
    // 那条 `[worksheetId, reloadToken]` 取数 + `[queueKey, savedAnswers]` 水合，
    // 不在别处手写第二份（手写那份曾经把学生端搞成假死）。
    // ⚠️ 指令本身走**总线**（`worksheet-clear-bus.ts`），不经过本面板的任何 prop ——
    // 见那条链被拆掉的理由。
    onCleared: handleCleared,
  });

  const handleChange = useCallback((node: WorksheetQuestionNode, draft: AnswerDraft) => {
    answers.setDraft(node, draft);
  }, [answers]);
  const handleSubmit = useCallback((node: WorksheetQuestionNode) => {
    void answers.submit(node);
  }, [answers]);

  const overlayPortal = useOverlayPortal(active);

  const submittedCount = questions.filter((node) => answers.statuses[node.id] === 'submitted').length;
  const total = questions.length;

  /**
   * 顶栏的奖励累计（规格 §9.3 的 `⭐×3`）。
   *
   * 🔴 与**每题旁**那一个用同一条公式（`rewardAmount`），只是这里把所有题加起来 ——
   * 两处各写一份累加口径，「顶栏 3 颗星、题目里只有 2 颗」这种偏差不会有任何报错。
   * 只数**当前这份 `content` 里的题**：教师删掉一道题之后，`scores` 里可能还留着它的
   * 得分（键在、题没了），把它算进累计会让顶栏多出学生看不见的那几分。
   */
  const rewardScale = load.kind === 'ready' ? load.worksheet.reward : null;
  const backgrounds = load.kind === 'ready'
    ? resolveWorksheetBackgroundSources(
      load.worksheet.backgroundTheme,
      load.worksheet.backgroundImageUrl,
      load.worksheet.backgroundPortraitImageUrl,
    )
    : { landscape: null, portrait: null };
  const backgroundLandscape = backgrounds.landscape ?? backgrounds.portrait;
  const hasBackground = Boolean(backgroundLandscape);
  const backgroundStyle = backgroundLandscape
    ? {
      '--worksheet-background-landscape': `url(${worksheetAssetUrl(backgroundLandscape)})`,
      ...(backgrounds.portrait
        ? { '--worksheet-background-portrait': `url(${worksheetAssetUrl(backgrounds.portrait)})` }
        : {}),
    } as CSSProperties
    : undefined;
  /**
   * ★ 2026-09-27（教师）：「可以增加一些透明度，让漂亮的背景图片更明显一些。」
   *
   * 把**卡片透度**那两个 alpha 写成 CSS 变量（`.question` 与 `.group[data-container]` 读它们）。
   * ⚠️ **无论有没有背景图都要设**：教师可能配的是「清爽无图」但透度选了「通透」，
   *    那时屏幕上是浅蓝底上的半透明卡片 —— 一样是合法的选择，不该被这里悄悄改回不透明。
   *    所以这一段**不在** `backgroundLandscape ? … : undefined` 里面。
   * 🔴 数值只有一份来源（`@/lib/worksheet-surface` 的 `surfaceAlphas`）——
   *    在 CSS 里再写一套字面量 = 两处都能改，其中一处改了另一处不报错。
   */
  const surfaceStyle = (() => {
    const alphas = surfaceAlphas(load.kind === 'ready' ? load.worksheet.surfaceOpacity : DEFAULT_WORKSHEET_SURFACE);
    return {
      '--ws-card-alpha': String(alphas.card),
      '--ws-card-active-alpha': String(alphas.cardActive),
      '--ws-surface-alpha': String(alphas.container),
    } as CSSProperties;
  })();
  const rewardTotal = rewardScale
    ? questions.reduce((sum, node) => sum + rewardAmount(answers.scores[node.id] ?? null, rewardScale), 0)
    : 0;

  /**
   * 顶部那一条的保存状态（规格 §8.2）。**五种**文案，**判据只在这里一处**：
   *   · 有积压且上一次尝试失败/浏览器自报离线 ⇒ 「⚠ 离线 · N 条待同步」（整条变琥珀）
   *   · 自报离线但暂时没有积压 ⇒ 「⚠ 离线」（那时说「已保存」是一句假话）
   *   · ★ 锁定中且队列非空 ⇒ 「已锁定 · N 条未保存」（见下）
   *   · 有改动在防抖窗口里 / 有请求在途 / 队列非空 ⇒ 「保存中…」
   *   · 其余 ⇒ 「已保存 ✓」
   *
   * ★ M5a 那一档为什么必须有：锁定期间每条 PUT 都被 409 拒、而条目又**必须保留**
   * （丢掉就是学生锁前写的东西真没了）⇒ `pendingCount` **永远降不到 0**。
   * 少了这一档，顶栏会在整节课上写着「保存中…」，而**没有任何东西在保存** ——
   * 一句承诺了「正在进行、且不会自行完成」的动作的假话，而且它与同一屏那句
   * 「老师已锁定作答」互相矛盾。⚠️ 也**不能**改成「已保存 ✓」：那同样是假话（那些字确实没存住）。
   */
  const saveText = answers.pendingCount > 0 && answers.offline
    ? `⚠ 离线 · ${answers.pendingCount} 条待同步`
    : answers.offline
      ? '⚠ 离线'
      : answersLocked && answers.pendingCount > 0
        ? `已锁定 · ${answers.pendingCount} 条未保存`
        : answers.saving
          ? '保存中…'
          : '已保存 ✓';

  return (
    <div
      className={styles.panel}
      ref={containerRef}
      style={{ '--module-accent': accent } as CSSProperties}
      // 排障用的观测点：它记的是**界面上看不见、错了也不报错**的状态 ——
      // 「以为在线」与「其实在断网重试」在截图上完全一样。
      data-offline={answers.offline ? '1' : '0'}
      data-pending={answers.pendingCount}
      data-load={load.kind}
    >
      {worksheetId && load.kind === 'ready' ? (
        <>
          <div className={styles.topbar} data-offline={answers.offline ? '1' : '0'}>
            <div className={styles.title}>{load.worksheet.title || '学习单'}</div>
            <div className={styles.progress} aria-label={`已完成 ${submittedCount} 题，共 ${total} 题`}>
              <span className={styles.progressMap}>
                {load.worksheet.groups.map((group, groupIndex) => (
                  <span className={styles.progressGroup} key={`${groupIndex}:${group.title ?? ''}`}>
                    {group.items.map(({ node }) => {
                      const state = questionDisplayState(answers.statuses[node.id], answers.drafts[node.id]);
                      return (
                        /* ★ 2026-09-27（教师实测后裁定）：格子**只表示作答进度**（空 / 灰 / 蓝），
                           这里不再画那枚奖励图标。
                           🔴 它原来在符号档下渲染 `RewardIcon state="earned"` —— 而 `earned` 的样式
                              就是右边「已获得」那枚用的**同一张全彩图**。于是同一屏上同一张钥匙
                              有两个意思：左边「这题交了」、右边「拿到了」。教师实测时正是被这里
                              骗了：一串全彩钥匙读成「得了 3 把」，而累计那格写着 ×1
                              （该生只对了 1 格填空，×1 是对的）。
                           ⚠️ 进度格看的是 `statuses`（交没交），**不看对错** —— 规格 §7.2：
                              对错标记在抽屉里、不在格子上。所以「交了」与「拿到了」本来就是
                              两件事，用同一张图表达必然是假的。
                           ⚠️ 于是全屏只有一处会出现全彩奖励图标：右边那格 `RewardTotal`（带 ×N）。
                              每一题自己的奖励是**判定那一格右上角的角标**（★ 2026-09-29 改的，
                              见 `.resultReward` 与 `reward-badge.tsx`），那是第三处、也是对的。 */
                        <span className={styles.progressCell} data-state={state} key={node.id} />
                      );
                    })}
                  </span>
                ))}
              </span>
              <span className={styles.progressText}>{submittedCount}/{total}</span>
            </div>
            <div className={styles.saveState}>{saveText}</div>
            {/* 奖励累计（规格 §9.3）。一个都还没拿到时盒子里是空的 —— 不写 `⭐×0`：
                「还没有」与「统计过了，是 0」在屏幕上是同一行字，而后者是假话。 */}
            <div className={styles.rewardSlot}>
              {rewardScale ? <RewardTotal scale={rewardScale} amount={rewardTotal} /> : null}
            </div>
          </div>

          <div
            className={styles.scroller}
            data-has-background={hasBackground ? '1' : '0'}
            data-has-portrait={backgrounds.portrait ? '1' : '0'}
            // ⚠️ 透度那两个变量与背景的**同一个元素**：`.question` / `.group` 都是它的后代，
            //    CSS 变量靠继承传下去，不必逐层透传。
            style={{ ...backgroundStyle, ...surfaceStyle }}
          >
            <WorksheetQuestionList
              groups={load.worksheet.groups}
              drafts={answers.drafts}
              statuses={answers.statuses}
              submitting={answers.submitting}
              interactive
              allowResubmit={load.worksheet.allowResubmit}
              reward={load.worksheet.reward}
              rewardFullFallback={load.worksheet.rewardFullFallback}
              scores={answers.scores}
              gradeStates={answers.gradeStates}
              aiReferenceScores={load.worksheet.aiReferenceScores}
              wrongBlankIndexes={answers.wrongBlankIndexes}
              correctBlanks={answers.correctBlanks}
              rewardBursts={answers.rewardBursts}
              answerMode={load.worksheet.answerMode}
              // ★ 2026-09-30：**广播优先**（有这一份单的键就用广播那份，包括空数组 ——
              // 「老师把全部收回去了」也是一次广播），否则用 `student-view` 读到的那份。
              // ⚠️ 判据是「键在不在」而不是「数组非空」：空数组是**有效的状态**。
              openQuestions={worksheetOpen[load.worksheet.id] ?? load.worksheet.openQuestions}
              onChange={handleChange}
              onSubmit={handleSubmit}
              // ★ M5a：课堂级锁定（与 `allowResubmit` 那道**题级**闸门是两件事）。
              answersLocked={answersLocked}
            />
          </div>
        </>
      ) : (
        <div className={styles.overlay}>
          <div className={styles.card} style={{ '--module-accent': accent } as CSSProperties}>
            <span className={styles.badge}>{label}</span>
            {!worksheetId ? (
              // 高级模式下「本组没配」是**合法状态**，不是「老师忘了」——
              // 说错会把学生引向「等老师加」，而正确的话是「问老师要你们组的那一份」。
              classroom?.mode === 'advanced' ? (
                <>
                  <p className={styles.cardTitle}>本组未配置学习单</p>
                  <p className={styles.cardNote}>你们这一组没有安排学习单，先和小组同伴一起讨论，或者问问老师。</p>
                </>
              ) : (
                <>
                  <p className={styles.cardTitle}>老师还没有布置学习单</p>
                  <p className={styles.cardNote}>等老师把学习单放进来，这里就能直接作答。</p>
                </>
              )
            ) : load.kind === 'error' ? (
              <>
                <p className={styles.cardTitle}>学习单没能打开</p>
                <p className={styles.cardNote}>{load.message}。点一下重试，不用退出重来。</p>
                <button type="button" className={styles.retry} onClick={() => setReloadToken((prev) => prev + 1)}>
                  重试
                </button>
              </>
            ) : (
              <>
                <p className={styles.cardTitle}>正在打开学习单…</p>
                <p className={styles.cardNote}>马上就好。</p>
              </>
            )}
          </div>
        </div>
      )}

      {overlayPortal(toast ? <ClassroomToast toast={toast} setToast={setToast} /> : null)}
    </div>
  );
}
