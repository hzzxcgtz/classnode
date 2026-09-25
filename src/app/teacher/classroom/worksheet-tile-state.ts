import type { WorksheetMaterialSummary, WorksheetQuestionNode } from '@/lib/types';
// 题型的中文名与「一道题算一道题」的拍平规则都只有一份，在 `src/lib/worksheet-questions.ts`
// （学生端作答面板与教师端预览都引它）。这里**转出**同一份，不是抄一份。
// ⚠️ 相对路径 + `.ts` 后缀是**必须的**：本文件要能被 `node --test` 直接执行
// （Node 24 的类型擦除会把 `import type` 整段删掉，剩下的运行时 import 必须是
// Node 也解析得了的相对路径）。加一行 `@/…` 的运行时 import 就会让
// `worksheet-tile-state.test.ts` 整个跑不起来。
import { flattenAnswerable, questionTypeLabel, type AnswerableQuestion } from '../../../lib/worksheet-questions.ts';

/**
 * 教师看板**学习单格子**的状态机 —— 纯函数，不碰 React / DOM / 网络。
 *
 * 🔴 为什么单独成文件、单独断言：这一段是 D3 **唯一「错了不报错」的逻辑**。格子上那几个字
 * 是教师课上唯一的信息来源，而它错了的表现是「看起来一切正常」——「正在做第 3 题」说成
 * 「第 4 题」、「停住了」永远不出现、全部交完的格子还写着「正在做」，这些都不抛异常、
 * 不让编译失败，只会让教师点错人、讲错题。本仓没有前端测试框架（规格 §11），
 * 但 `node --test` 能直接跑本文件：
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-tile-state.test.ts
 * ```
 *
 * ── 判据的出处（规格 §7.2 / §3-H / §3-AD / §3-AE）────────────────────
 *   · 「正在做哪题」= **最后一次保存的那一题**（`lastQuestionId`），不引入滚动位置上报；
 *   · 「停住了」    = **在线** 且 距最后一次保存 > 5 分钟 且 **未全部提交**；
 *   · 格子**不带学习单标题**（§3-AE：214px 放不下）；「这份是哪张单」在抽屉里（D4）；
 *   · 逐题方格**只编码状态，不编码对错**（§7.2）。
 *
 * ── 数据来源（规格 §7.4）──────────────────────────────────────────────
 *   · 题目清单 / 题数 —— `GET /api/worksheets/:id` 的 `content.nodes`；
 *   · 逐题状态与「最后一次保存哪题」—— `worksheet-answer-updated` 广播（房间 `teacher:<id>`，
 *     载荷含 `questionId`，B4 落地）。⚠️ 读端点**是存在的**（`GET /api/worksheets/classroom/:id/answers`，
 *     D4 落地），**缺的是格子没消费它** —— 所以看板仍然只知道「打开之后发生的作答」，
 *     `no-progress` 那一态就是为它准备的，见下面的注释。
 */

/**
 * 一道题在方格阵里的三种状态。**只有状态，没有对错**（规格 §7.2）。
 *
 * 🔴 **不要往这里加判分档**（E2 核清的一处规格字面冲突，结论写在这里免得下一个人重走一遍）：
 * 规格 §12 曾经有一句「**半对必须在格子上画得出来**」，而 §7.2 明写「方格阵着色 = 状态…**不编码
 * 对错**」＋「**对错在抽屉里**（7.3），不在格子里」—— 两句按字面读是打架的。
 * ✅ **规格字面已于 2026-09-24 回填**：§12 那句改成了「半对必须在**看板那一侧**画得出来」，
 * 并注明「**是抽屉里，不是方格阵的格子**」；派生计划同源那处也改了。
 *   ⇒ 下面这个结论**不再是「实施者的判断」**，而是规格现在的口径。
 * 结论：**§7.2 赢**，「看板那一侧」= 抽屉 ——
 *   · 全仓唯一产出对错标记的 `WorksheetOutcomeMark` 只由抽屉消费
 *     （`worksheet-drawer.tsx` 的 `OutcomeMark`）；本文件的 `WorksheetCellStatus` 里
 *     **一个** `mark` / `gradeState` / `isCorrect` 都没有；
 *   · 格子这一侧连数据都没有：`ParticipantWorksheetProgress` 只有 `status`
 *     （那个读端点也还没被格子消费，见 `WorksheetTileState` 那一段的更正）；
 *   · §7.2 给了理由：五档颜色在十几像素的方块上分不清、红绿对色觉障碍教师尤其不友好，
 *     而「哪个学生第 3 题错了」不是课上能当场处理的信息（「哪道题错得多」走按题聚合）。
 * ⇒ 半对画在**抽屉**里（`½ 半对`，见 `worksheet-drawer-state.ts` 的 `VERDICT_VIEW`）。
 * 往方格阵里塞对错是**为了满足一句已经更正掉的字面**而加一层规格明确排除的编码，不是修 bug。
 */
export type WorksheetCellStatus = 'unanswered' | 'draft' | 'submitted';

/** 一条作答广播攒出来的、**一名参与者在一份学习单上**的进度。 */
export interface ParticipantWorksheetProgress {
  /**
   * 题 id → 那条答案行的状态。
   *
   * ⚠️ 按 `questionId` 存（规格 §3-P），**绝不按下标**：教师改序 / 增删题时按下标的记录会
   * 整片错位，而那是**静默**的 —— 学生会看到「第 3 题已提交」，实际交的是第 5 题。
   */
  cells: Record<string, 'draft' | 'submitted'>;
  /**
   * 最后一次收到作答的是**哪一题**（`null` = 收到过广播但没带题号，正常接不到）。
   * 「正在做第 N 题」的唯一依据（规格 §3-H）。
   */
  lastQuestionId: string | null;
  /**
   * 最后一次收到广播的**本地**时刻（ms）。
   *
   * 🔴 用本地时钟而不是服务端时间：广播载荷里没有作答行的 `updatedAt`
   * （B4 的用例正面断言了字段集合，加字段会让那条用例变红），而「停住了」判的是
   * 「距最后一次保存」—— 广播是保存成功之后立刻发的，本地收报时刻就是它最好的代理。
   * 代价：教师本地时钟被改过时这个数会跟着偏，而「停住了」本来就是个 5 分钟量级的软判断。
   */
  lastAt: number;
}

/** 「停住了」的无操作阈值（规格 §7.2 定死 5 分钟）。 */
export const WORKSHEET_STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * 这一格的显示状态。
 *
 * 四态（规格 §7.2）都在这上面：`no-progress` / `working` / `stuck` / `all-submitted`。
 * 另外三态说的是「**画不出**格子的那三种情形」，它们与四态不是一类东西 —— 前三种是说
 * 「这一格现在没有东西可看」，而四态是说「有东西可看，它是这样」：
 *   · `unconfigured` —— 这一格（组）没有学习单；
 *   · `loading`      —— 有学习单，但题目清单还没走完 REST；
 *   · `empty`        —— 这份学习单一道题都没有（分母是 0，四态全都无从谈起）。
 *
 * ⚠️ `no-progress` 与规格里那个「还没开始」**不是同一句话**，这是刻意的：
 * 这一态的唯一输入是 `worksheet-answer-updated` 广播攒出来的进度（`page.tsx` 的
 * `worksheetProgress`），所以「打开看板之后一条广播都没收到」既可能是「学生还没开始」，
 * 也可能是「他早就做完了，只是教师刚刷新过页面」。
 * 写成「还没有开始作答」会把后一种说成一个**假事实**——正是本项目反复出现的那类缺陷。
 * 所以这里说的是能确证的那一句，见 `worksheet-tiles.tsx` 里 `no-progress` 的文案。
 *
 * 🔴 **2026-09-23 更正。** 本文件这一段、以及 `page.tsx` 的两处注释，原先都写着
 * 「看板**没有拉取历史的 REST 端点**（全文只有学生端那三个端点能读 `WorksheetAnswer`）」
 * ——**那句话在本文件落地的同一个批次里就不再成立了**：教师端的读端点
 * `GET /api/worksheets/classroom/:classroomId/answers` 已落地
 * （`server/src/routes/worksheets.ts`），它读的正是 `WorksheetAnswer`。
 * **它不成立的方式值得记下来**：端点有了，但**格子没有消费它** —— 格子的进度仍然只由广播写入，
 * 而那个读端点缺**两个字段**才够格子用（它的 `answerRows` 是
 * `{ questionId, status, isCorrect, gradeState, score, reviewedAt, value }`，
 * 见 `routes/worksheets.ts` 的 `select`；★ M4a 起多了 `gradeState` / `score` 两列，
 * ⚠️ 它们**不改变这条结论** —— 那两个字段说的是「这道题得了几分、判成哪一档」，
 * 而格子按规格 §7.2 只编码**状态**、不编码对错，缺的仍然是下面这两个）：
 *   1. **哪一题是最后一次保存的**（`lastQuestionId`，本文件「正在做第 N 题」的唯一依据）；
 *   2. **最后一次保存的时刻**（本文件判「停住了」用的 5 分钟阈值靠它）。
 * ⇒ 结论不变（这一态仍然只能报「还没收到作答」），但理由要写成真话：
 * 不是「没有端点」，是「端点给不了那两个字段、格子也还没接它」。
 */
export type WorksheetTileState =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'no-progress' }
  // ★ 2026-09-25：`index`（0-based 拍平序）换成 `heading`（两级题号，`任务一 · 2`）。
  // 格子上写的从来就是「第几题」，而拍平序把**任务**也数了一号 ⇒ 它后面每一题的号都偏大。
  | { kind: 'working'; heading: string | null; typeLabel: string | null; cells: WorksheetCellStatus[]; headings: string[] }
  | { kind: 'stuck'; heading: string | null; typeLabel: string | null; minutes: number; cells: WorksheetCellStatus[]; headings: string[] }
  | { kind: 'all-submitted'; cells: WorksheetCellStatus[]; headings: string[] };

export interface WorksheetTileInput {
  /** 这一格的参与者（或小组）此刻该作答的那一份；`null` = 没有（未配置 / 高级模式下本组没配）。 */
  worksheet: WorksheetMaterialSummary | null;
  /** 那份学习单的**原始**题目树（`GET /api/worksheets/:id` 的 `content.nodes`）；`null` = 还没加载到。 */
  nodes: WorksheetQuestionNode[] | null;
  /** 这一格参与者的进度；`undefined` = 打开看板后**从没收到过**这个人的作答（不是「零作答」）。 */
  progress: ParticipantWorksheetProgress | undefined;
  /** 这一格此刻在线吗 —— 离线的学生不算「停住了」（规格 §7.2 的判据里有「在线」）。 */
  online: boolean;
  /** 现在几点（`Date.now()`）。传进来而不是内部读：否则「停住了」只能靠端到端手测。 */
  now: number;
}

/**
 * 从「题目树 + 这一格收到的广播」算出该显示什么。
 *
 * 分支顺序是有意的（每一条都短路掉后面的）：
 *   1. 没有学习单 / 题目还没到 / 一道题都没有 ⇒ 画不出格子，如实说（三种不同的说法）；
 *   2. 这份学习单上一道题的已知状态都没有 ⇒ `no-progress`（见 `no-progress` 的注释）；
 *   3. 全部提交 ⇒ 最高优先级的「好结局」，压过「停住了」（规格 §7.2 的判据明写「未全部提交」）；
 *   4. 其余按「在线 + 5 分钟」分成 `stuck` 与 `working`。
 */
export function worksheetTileState(input: WorksheetTileInput): WorksheetTileState {
  const { worksheet, nodes, progress, online, now } = input;
  if (!worksheet) return { kind: 'unconfigured' };
  if (!nodes) return { kind: 'loading' };

  // `flattenAnswerable`（而不是只看 `nodes`，也不是 `flattenQuestions`）：`content` 是嵌套树，
  // 服务端算「整卷交齐」时也会递归展开 —— 只看顶层节点会让带嵌套的那几道题**在屏幕上不存在**，
  // 而分母还算着它们（症状：格子永远差几格才满）。
  // 🔴 更要紧的另一半：**任务节点不是一道题**。它在 `progress.cells` 里永远没有对应的行
  // ⇒ 它那一格恒为 `unanswered` ⇒ 下面 `every(submitted)` **永远不成立** ——
  // 学生明明交了卷，格子上永远停在「正在做」。规则的唯一一份在 `lib/worksheet-questions.ts`。
  const items = flattenAnswerable(nodes);
  if (items.length === 0) return { kind: 'empty' };

  // ⚠️ `cells` 与 `headings` 是**同一个数组的两个投影** —— 逐格对齐是结构性的，
  //    不是「记得两边一起改」那种约定（格子的 tooltip 要题号，见 `worksheet-tiles.tsx`）。
  const cells: WorksheetCellStatus[] = items.map((item) => progress?.cells[item.node.id] ?? 'unanswered');
  const headings: string[] = items.map((item) => item.heading);

  // 收到的作答**全都对不上现在这份学习单**（教师改单删掉了那些题）：格子上一个状态都画不出来。
  // 与「一条广播都没收到」在屏幕上没有区别，而后者那句话（「还没收到作答」）在这种情况下
  // 也是真的 —— 与其为这种边角再添一态，不如把它收进那一态。
  if (!cells.some((status) => status !== 'unanswered')) return { kind: 'no-progress' };
  // 走到这里 `progress` 必然在场（`cells` 全灰是上面那一条处理掉的），断言给 TS 看。
  const known = progress!;

  if (cells.every((status) => status === 'submitted')) return { kind: 'all-submitted', cells, headings };

  const at = activeQuestionIndex(items, cells, known.lastQuestionId);
  const typeLabel = at === null ? null : questionTypeLabel(items[at].node.type);
  const heading = at === null ? null : items[at].heading;
  const idleMs = now - known.lastAt;
  if (online && idleMs > WORKSHEET_STUCK_AFTER_MS) {
    // `Math.floor` 而不是四舍五入：8 分 59 秒说「8 分钟」是准的，说「9 分钟」是提前量。
    return { kind: 'stuck', heading, typeLabel, minutes: Math.floor(idleMs / 60_000), cells, headings };
  }
  return { kind: 'working', heading, typeLabel, cells, headings };
}

/**
 * 「他正在做第几题」的那个下标（0-based），`null` = 说不出来。
 *
 * 先认**最后一次保存的那一题**（规格 §3-H 定死的判据）；它已经不在这份学习单里时
 * （教师课上改单删掉了那题）退到「第一道还在作答中的题」—— 那是此刻唯一有依据的猜测，
 * 而不是随便挑一道。两者都没有就**不编**：返回 `null`，格子上只说「正在作答」。
 */
function activeQuestionIndex(
  items: AnswerableQuestion[],
  cells: WorksheetCellStatus[],
  lastQuestionId: string | null,
): number | null {
  if (lastQuestionId) {
    const found = items.findIndex((item) => item.node.id === lastQuestionId);
    if (found >= 0) return found;
  }
  const draft = cells.indexOf('draft');
  return draft >= 0 ? draft : null;
}

/**
 * 徽章行里那个**模块相关**的徽章（`null` = 这一格不该有它）。
 *
 * 与 `tileShowsClear` / `tileModuleBadge` 同源：判据都是该格**当前显示的模块**
 * （`tileModule`），不是学生实际所在的那个。
 */
export type TileBadge =
  /** 智能学伴：本格的对话轮数（学伴指标，只在学伴模块下才有意义 —— 用户 2026-09-23 的裁定）。 */
  | { kind: 'rounds'; rounds: number }
  /** 学习单：这一格的参与者在**当前这份学习单**上的已交题数。 */
  | { kind: 'submitted'; submitted: number; total: number };

/**
 * 这一态带不带方格阵（只有「画不出格子」的那三态不带）。
 *
 * 存在的理由：徽章的 `已交 N/M` 与格子里的方块**必须**数同一批东西 —— 各数一份的表现是
 * 徽章写着「已交 3/5」而下面只有 4 个方块，而没有人会去核对这两个数。
 */
export function stateHasCells(
  state: WorksheetTileState,
): state is Extract<WorksheetTileState, { cells: WorksheetCellStatus[] }> {
  return 'cells' in state;
}

/**
 * 学习单徽章的文字。⚠️ 只有**已知**才给数字（`null` = 连分母都不知道）。
 *
 * 🔴 规格 §3-I 写的是「已看 N/M」，而 `已看` 在 §7.4 里指的是
 * `WorksheetAnswer.reviewedAt`（**教师**标记的「已查看」，B4 的 `POST /:id/review`）。
 * 今天拿不到它，**原因不是「没有来源」**（那样写是错的，2026-09-23 已改），
 * 而是徽章的数据源到不了它：
 *   · `POST /:id/review` **不广播**（只有 `PUT /answers` 与 `POST /answers/submit` 会广播）
 *     ⇒ 教师点「已查看」的那一下没有任何推送；
 *   · 徽章算的是 `worksheetProgress`，而它只由 `worksheet-answer-updated` 广播写入
 *     （`page.tsx`）。教师端的读端点**存在**（`GET /api/worksheets/classroom/:classroomId/answers`，
 *     D4 落地，它的 `answerRows` 里就有 `reviewedAt`），**缺的是格子没有消费它** ——
 *     理由见上面 `WorksheetTileState` 那一段附的更正（那个端点还差两个字段才够格子用）。
 * ⇒ 按 `reviewedAt` 算出来的 N 恒为 0，而「已看 0/3」是一句**假话**（教师可能早就看过 2 题）。
 * 所以这里落的是**同一批答案行上算得出来的那个数**：已**交** N/M（术语取自 §7.3 的「已交 5/5」）。
 * 要把它换回「已看 N/M」，需要的是数据源（review 广播 + 历史拉取），不是文案。
 */
export function tileBadgeText(badge: TileBadge): string {
  return badge.kind === 'rounds' ? `${badge.rounds} 轮` : `已交 ${badge.submitted}/${badge.total}`;
}

/**
 * ★ M5a：模块筛选行那六个数字的**量词**。
 *
 * 🔴 判据是 `mode`：分组 / 高级模式下「一块设备 = 一个组」（规格 §1.2 逐字：
 * 「一个组一行参与者」），而那一行的六个数字数的正是**参与者**（`moduleDistribution` 逐
 * `students` 计数、`students` 的每一行是一个参与者）⇒ 那些模式下它是**组数**。
 * 个人（标准）模式下参与者就是学生 ⇒ 「人」。
 *
 * ⚠️ **只改量词，不改数字**：这个数字与「点它会筛出几张卡片」是同一件事，那正是筛选控件
 * 应有的口径；页头那个「N 名学生」是另一个口径（分组模式下按成员求和），两者都对、只是单位不同。
 *
 * ⚠️ 认不出的 `mode` 一律按**标准模式**（保守的一侧）：标准模式下参与者就是学生，
 * 而误说成「组」会让教师把 12 看成 12 个组。与 `ClassroomSummary.mode` 是可选字段同源 ——
 * 老服务端不发它时也会走到这里。
 */
export function moduleCountUnit(mode: string): '人' | '组' {
  return mode === 'group' || mode === 'advanced' ? '组' : '人';
}
