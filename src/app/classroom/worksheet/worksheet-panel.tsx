'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getStudentSessionAuthorization } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { effectiveGroupWorksheet } from '@/lib/classroom-material';
import type { WorksheetQuestionNode } from '@/lib/types';
// 奖励的取值域、默认档与取值函数只有一份（规格 §9）—— 教师端那个设置面板引的也是它。
import { resolveRewardScale, rewardAmount, type RewardScale } from '@/lib/worksheet-reward';
import { studentVisibleGroups, type AnswerableGroup } from '@/lib/worksheet-questions';
import { questionTypeIcon } from '@/lib/worksheet-question-icons';
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
import {
  questionDisplayState,
  useWorksheetAnswers,
  type WorksheetQuestionStatus,
  type WorksheetScore,
} from './use-worksheet-answers';
import type { SavedAnswerRow } from './worksheet-queue';
import { QuestionReward, RewardTotal } from './reward-badge';
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
      // ★ M4a：逐题得分的**绝对值**（教师填的那个数）。同一个纪律：只认有限数，
      // 读不出来落到 `null`（= 没判分），而 `scoreFromWire` 会回落到 `isCorrect` ——
      // **升级前落库的旧行没有 `score`**，那正是那条兜底存在的理由。
      score: typeof row.score === 'number' && isFinite(row.score) ? row.score : null,
    });
  });
  return out;
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
  /** 每道题的得分（`useWorksheetAnswers` 的 `scores`）。不传 = 一道题都没判分。 */
  scores?: Record<string, WorksheetScore>;
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
  scores,
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

  return (
    <div className={styles.questions} data-interactive={interactive ? '1' : '0'}>
      {groups.map((group, groupIndex) => (
        // ⚠️ `key` 用下标 + 标题：散题那几段的 `title` 恒为 `null`，拿它当 key 会撞。
        // 段本身不重排（页面上唯一会重排的是小题，而它们各自按 `node.id` 作 key）。
        <div className={styles.group} key={`${groupIndex}:${group.title ?? ''}`}>
          {group.title && <h3 className={styles.groupTitle}>{group.title}</h3>}
          {group.items.map(({ node }) => {
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
        return (
          <section className={styles.question} key={node.id}>
            <div className={styles.questionHead}>
              {/*
                ★ 2026-09-25（教师裁定）：头行只剩一个**题型图标** ——
                没有编号、没有题型文字。原话：「也不用加题型『选择题』『判断题』，
                题型可以在标题前加一个象形的图标。」
                ⚠️ `heading` 在这里**不再显示**，但它仍然是布局之外的身份（看板 / 抽屉 /
                导出 / 分析载荷用同一份）。学生侧的题号由**段标题（任务名）**承担。
              */}
              <span className={styles.questionIcon}>{questionTypeIcon(node.type)}</span>
              {/* 状态挂在题号旁（规格 §8.2）：`✓ 已提交` / `◐ 作答中` / 空白 = 未作答。
                  文案由 `questionDisplayState` 一处给出，样式按 `data-state` 分三态。 */}
              <span className={styles.questionState} data-state={state}>
                {state === 'submitted' ? '✓ 已提交' : state === 'drafting' ? '◐ 作答中' : ''}
              </span>
              {/* 奖励出现在**每题旁**（规格 §9.3），交完立刻出现。
                  🔴 `interactive` 是第二道闸：本组件同时被教师端的「学生端预览」渲染
                  （`preview-modal.tsx`，`interactive={false}`），而奖励**教师端一处都不许出现**
                  （规格 §3-U：那里问的是「哪道题错得多」）。所以即使将来有人往预览里
                  传了奖励配置，这一行也不会画出来。 */}
              {interactive && reward ? (
                <QuestionReward scale={reward} score={scores?.[node.id] ?? null} />
              ) : null}
            </div>

            <div className={styles.prompt}>
              {node.prompt.trim()
                ? node.prompt
                : <span className={styles.placeholder}>（这道题的题干还没写）</span>}
            </div>

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
            />

            {/* 「提交本题」内联在每题下方，**不做固定底栏**（规格 §3-AC）。
                ⚠️ 锁住时不渲染按钮，而是说清楚为什么 —— 一个按不动的「重新提交」比
                一句话难懂得多（学生会反复点它）。 */}
            {interactive ? (
              locked ? (
                <p className={styles.lockedNote}>老师已设置本题提交后不可修改</p>
              ) : (
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
                          提交中…
                        </>
                      ) : submitted ? '重新提交' : '提交本题'}
                    </button>
                  </div>
                </>
              )
            ) : null}
          </section>
          );
          })}
        </div>
      ))}
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
}

export function WorksheetPanel({ active, classroom, session, toast, setToast, answersLocked }: WorksheetPanelProps) {
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
          settings?: { allowResubmit?: unknown; rewardStyle?: unknown; rewardStep?: unknown; halfStep?: unknown };
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
            // 奖励同理：缺字段落到默认档（星星 ⭐），不抛也不画一个错的档。
            reward: resolveRewardScale(data.settings),
            // 每次 fetch **只建这一份**（引用稳定，见 `LoadedWorksheet.savedAnswers`）。
            savedAnswers: parseSavedAnswers(rowsData),
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
    savedAnswers: load.kind === 'ready' ? load.worksheet.savedAnswers : NO_SAVED_ANSWERS,
    setToast,
    // ★ M5a：**从 props 进来**（D1 铺好的那条路：会话层专门 state → 外壳 → 本面板）。
    // ⚠️ 不要改成读 `classroom?.answersLocked`：那个对象 15 秒才刷新一次，
    // 而锁定要**立刻**生效 —— 学生多写 15 秒就不是「停笔」了。
    answersLocked,
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
            <div className={styles.progress}>
              <span className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ width: total > 0 ? `${Math.round((submittedCount / total) * 100)}%` : '0%' }}
                />
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

          <div className={styles.scroller}>
            <WorksheetQuestionList
              groups={load.worksheet.groups}
              drafts={answers.drafts}
              statuses={answers.statuses}
              submitting={answers.submitting}
              interactive
              allowResubmit={load.worksheet.allowResubmit}
              reward={load.worksheet.reward}
              scores={answers.scores}
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
