/**
 * 学习单编辑器的**纯函数内核**：不碰 React、不碰 DOM、不碰网络，只依赖类型。
 *
 * 🔴 **本文件不得出现 `@/…` 联名路径的运行时 import，也不得引 React / DOM。**
 * 这不是风格要求，而是下面这件事的前提：本仓没有前端测试框架（规格 §11），但
 * `node --test` 能直接执行本文件 —— Node 24 的类型擦除会把 `import type` 整段删掉，
 * 而**剩下那几行运行时 import 必须是 Node 也能解析的相对路径**（带 `.ts` 后缀，
 * 见下面从 `lib/worksheet-questions.ts` 转出的那几行）。联名路径 Node 解析不了，
 * 加一行就会让本文件的唯一回归网整个跑不起来。
 *
 * ```bash
 * node --test src/app/teacher/worksheets/edit/worksheet-editor-core.test.ts
 * ```
 *
 * 之所以值得为它划一条界线、单独成文件且可执行，是因为这里的东西**错了不报错**：
 * 题目 id 的稳定性、选项重编号后正确答案的去向、`undo` 的栈语义、草稿形状校验 ——
 * 这几处的错法既不抛异常也不让编译失败，只会让已经收上来的作答安静地错位
 * （规格 §3-P：答案按 `questionId` 关联，改序不能让已答数据错位）。
 * 改动本文件时，`worksheet-editor-core.test.ts` 是唯一的回归网。
 *
 * ⚠️ 本文件的内容是**同一份字节**：原样搬自 `use-worksheet-editor.ts`，不是照抄的第二份。
 * 那个文件现在从这里 import，并把这些符号**重新导出**（所以页面侧的 import 路径不用改）；
 * 解释设计取舍的注释也跟着搬了过来。
 */

import type { QuestionPointsDraft, WorksheetContent, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { DEFAULT_WORKSHEET_BACKGROUND, normalizeWorksheetBackgroundTheme } from '../../../../lib/worksheet-backgrounds.ts';
// ★ 2026-09-27（教师）：「学生页面的学习单区域可以增加一些透明度……也可以在学习单设置中增加
// 几档透明度供选择。」档位、名字与那两个 alpha **只有那一份** —— 教师端的设置面板与学生端的
// 面板读的是同一个模块（`@/lib/worksheet-surface`）。
import { DEFAULT_WORKSHEET_SURFACE, normalizeWorksheetSurfaceOpacity } from '../../../../lib/worksheet-surface.ts';
// 题型词汇表与「选项怎么读出来」的唯一一份在 `src/lib/worksheet-questions.ts`：
// 学生端的作答面板直接引它，本文件**转出**同一份（不是抄一份）—— 理由见那个文件的文件头。
// ⚠️ 相对路径 + `.ts` 后缀是**必须的**（Node 解析不了 `@/…`），见上面的文件头。
import {
  flattenAnswerable,
  isMultipleChoice,
  optionKey,
  POINTS_FULL_MIN,
  TASK_TYPE,
  POINTS_MAX,
  QUESTION_TYPE_OPTIONS,
  readBlankCount,
  readOptions,
  TRUE_FALSE_OPTIONS,
} from '../../../../lib/worksheet-questions.ts';
// 奖励形式的取值域、默认档与归一化函数也只有一份，在 `src/lib/worksheet-reward.ts`
// （学生端的奖励徽章与这里读的是同一份）。⚠️ 同样必须是相对路径 + `.ts` 后缀。
import {
  DEFAULT_HALF_STEP,
  DEFAULT_REWARD_STEP,
  DEFAULT_REWARD_STYLE,
  normalizeHalfStep,
  normalizeRewardStep,
  normalizeRewardStyle,
} from '../../../../lib/worksheet-reward.ts';
import type { ChoiceOption, QuestionType } from '../../../../lib/worksheet-questions.ts';
import { blankCount, readPromptRuns } from '../../../../lib/worksheet-prompt-marks.ts';

// ★ 2026-09-27：`isMultipleChoice` 也在这一串里 —— 它搬去了 `@/lib/worksheet-questions`，
// 因为**学生端现在也要问同一个问题**（多选题的题干前要加「多选」提示），而学生端读不到
// 这个内核。原样再导出 ⇒ 本文件的所有消费者与用例**一行都不用改**。
export { isMultipleChoice, optionKey, POINTS_FULL_MIN, POINTS_MAX, QUESTION_TYPE_OPTIONS, readOptions, TRUE_FALSE_OPTIONS };
export type { ChoiceOption, QuestionPointsDraft, QuestionType };


/**
 * 题型。⚠️ 定义在 `src/lib/worksheet-questions.ts`（学生端与教师端共用一份），
 * 上面已转出。它是**服务端注册表**（`server/src/services/worksheet-questions.ts` 的
 * `QUESTION_TYPES`）在前端的投影，不是第二份权威。
 */

export const SCHEMA_VERSION = 1;

/**
 * 撤销栈上限。**每次改动一条**（包括每一次击键，见 `contentReducer` 的说明），
 * 200 条 ≈ 一次正常编辑会话的深度；再深只会让「撤销」要按很多下才回到想回的地方。
 */
export const HISTORY_LIMIT = 200;

/**
 * 单选题**由界面新建**的选项数上限 —— 由 `optionKey` 的值域（A–Z）决定，不是随手定的数。
 *
 * ⚠️ 它是「加号按不动了」的那条线，**不是**读一份既有内容时的硬顶：服务端对选项数
 * 不设上限（`validateQuestion` 只要求 `>= 2`），所以库里可能存在 26 个以上的题。
 * `writeOptions` 对超出部分**不丢弃**（见那里的说明），否则一份 30 选项的单子会在
 * 教师改任意一处选项时被悄悄砍掉 4 个。
 */
export const MAX_OPTIONS = 26;

/** 自动保存草稿的间隔（规格 §6.4：每 10 秒**或失焦**）。 */
export const DRAFT_INTERVAL_MS = 10_000;

// `ChoiceOption` / `optionKey` 定义在 `src/lib/worksheet-questions.ts`，上面已转出。

/**
 * 内容树的**唯一写入口**。
 *
 * 🔴 所有改动都经 reducer，**撤销栈才可能正确** —— 散落的 `setState` 的第一处
 * 就是 undo 开始漏的地方。本页因此没有第二个能改 `content` 的地方：
 * `grep -n 'setContent\|setHistory' src/app/teacher/worksheets/edit/` 应当只剩 reducer。
 *
 * ⚠️ **每次改动都进栈**（含每一次击键），刻意不做「合并连续输入」：
 * 合并会让「撤销」的粒度随时长变化（同样一段文字，打得慢和打得快撤销的行为不同），
 * 而逐次入栈的行为恰好与浏览器原生文本撤销一致。代价是栈深 200 只覆盖 200 次击键，
 * 这一点写在 `HISTORY_LIMIT` 上。
 *
 * `reset` 是列表里唯一一个**不进栈**的改动：它表示「换了一份学习单 / 恢复了草稿」，
 * 那是新的基线，不是可撤销的一步。
 */
export type ContentAction =
  /**
   * ★ 2026-09-25：**加到哪儿**不再是隐含的。
   *
   * 原动作是 `{ kind: 'add'; questionType }`，**只往顶层追加** —— 而第 2 步的迁移已经把
   * 库里的学习单包进了任务 ⇒ 教师新加的题永远落在任务**外面**（学生端因此是散题，
   * 与任务里的题长得不一样，也永远编不进任务内序号）。
   * `parentId: null` = 顶层（散题是合法数据，老学习单里就有）。
   */
  | {
    kind: 'addQuestion';
    questionType: QuestionType;
    parentId: string | null;
    /**
     * ★ 2026-09-25（教师裁定）：新题的**分值**直接写成学习单当前那两档
     *（新建单就是 1 / 0）—— 于是框里是**真实数字**，不是灰提示。
     * ⚠️ **老题一个字不改**：`points` 仍是「没有」＝跟随学习单。两条路的分界是**时间**，
     * 不是题型（见 `points` 的注释与「两格留空 = 用学习单的默认分值」那句话）。
     */
    points?: QuestionPointsDraft;
  }
  /** ★ 2026-09-25：新建一个**任务**容器，标题按序号预填（教师可改）。 */
  | { kind: 'addTask' }
  /**
   * 改题干（★ 2026-09-26：可选地**同一次**带上一批 `data` 补丁）。
   *
   * 🔴 `data` 存在的唯一理由：所见即所得编辑器敲一个字同时改了 `prompt` 与
   * `promptRuns`，分两次 dispatch 会让 ⌘Z 的第一下退到一个**什么都没变**的动作上
   *（教师看到屏幕纹丝不动，只能再按一次）。一个按键 = 一格撤销栈。
   * ⚠️ 补丁里一个**显式的 `undefined`** 意思是「把这个键删掉」（`promptRuns` 全默认时
   * 就是这么清掉的），不是「没变」—— 别拿 `===` 一律当成「没变」。
   */
  | { kind: 'updatePrompt'; id: string; prompt: string; data?: Record<string, unknown> }
  | { kind: 'updateData'; id: string; patch: Record<string, unknown> }
  | { kind: 'updatePoints'; id: string; points: QuestionPointsDraft | undefined }
  // ★ M4b/D1：逐题的作答方式（键盘 / 手写）。它是**唯一**能让手写笔迹变成可达的开关 ——
  // 没有它，`inputMode: 'handwriting'` 永远只活在手工改过的库行里。
  // 取值域是 `WorksheetQuestionNode.inputMode` 那两个字面量，**不是**学习单级的
  // `settings.defaultInputMode`（那一个今天仍然是死的，见 `DEFAULT_SETTINGS`）。
  | { kind: 'updateInputMode'; id: string; inputMode: 'keyboard' | 'handwriting' }
  /** ★ 2026-09-25：逐题的「允许自动评分」开关。 */
  | { kind: 'updateAutoGrade'; id: string; autoGrade: boolean }
  /** ★ 2026-09-25：部分给分的容错档。`null` = 缺省（旧规则）。 */
  | { kind: 'updateTolerance'; id: string; tolerance: number | null }
  | { kind: 'move'; id: string; delta: -1 | 1 }
  /**
   * ★ 2026-09-26（spec 第 5 步，拖拽）：把 `id` 挪到**同一层**的第 `toIndex` 位。
   *
   * 🔴 为什么不能靠连按 `move`：从第 3 位拖到第 7 位是**四次换位 ⇒ 四格撤销**，
   * 而教师按一次 `⌘Z` 只会退回一位 —— 「撤销」在那时就不再是「撤销我刚才那一个动作」了。
   */
  | { kind: 'reorder'; id: string; toIndex: number }
  | { kind: 'remove'; id: string }
  | { kind: 'reset'; content: WorksheetContent }
  | { kind: 'undo' }
  | { kind: 'redo' };

export interface EditorHistory {
  past: WorksheetContent[];
  present: WorksheetContent;
  future: WorksheetContent[];
}

export function createEmptyContent(): WorksheetContent {
  return { schemaVersion: SCHEMA_VERSION, nodes: [] };
}

export function createHistory(content: WorksheetContent): EditorHistory {
  return { past: [], present: content, future: [] };
}

/**
 * `crypto.randomUUID()` 只在**安全上下文**（https / localhost）里存在。
 * 教师端通常走 localhost，但本应用会把局域网地址印给学生 —— 教师若照那个
 * `http://192.168.x.x:4001` 打开教师端，`crypto.randomUUID` 就是 `undefined`。
 * 这里的 id 只需要在**一份学习单内**唯一（它是答案行的外键，作用域就是这棵树），
 * 不参与任何安全判定，所以退回随机串可以接受。
 */
function randomIdSuffix(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 条目数组（M4a/C2）：order 的 `items` · match 的 `left`/`right` · categorize 的 `items`/`zones`
//
// 🔴 **条目 id 生成一次就不能再变** —— 与题目 id（规格 §3-P）**逐字同一条纪律**，
// 理由也逐字相同：它是**学生作答值里的键**（`order: string[]`、`links[].leftId/rightId`、
// `assignment` 的键），**绝不能用下标代替**。改一次条目的先后顺序就会让已经收上来的
// 作答全部错位，而且**没有任何报错**（判分只是把每一条都判错）。
//
// ⚠️ 唯一不用 id 的是填空题的「空」：服务端读的是 `texts: string[]`，**按位置对应**。
// 那是 D1/D2 的协议（`fill-multi/v1`），不是这里的取舍 —— 代价是改空的个数会让已收上来的
// 作答与空错位，见 `fill-blanks-body.tsx` 上那句注释。

/** 一个带 id 的条目。`text` / `label` 由 `EntryTextField` 决定（服务端读的就是这两个键名）。 */
export interface ItemEntry {
  id: string;
  text: string;
}

/** 条目文本的键名：`items` / `left` / `right` 用 `text`，`zones` 用 `label`。 */
export type EntryTextField = 'text' | 'label';

/** 条目 id。前缀只是让人在日志/库里认得出这是哪一类 id，**不参与任何判据**。 */
export function newItemId(): string {
  return `i_${randomIdSuffix()}`;
}

/** 归类题「框」的 id（与条目同一条纪律）。 */
export function newZoneId(): string {
  return `z_${randomIdSuffix()}`;
}

/**
 * 这一题**最高能拿几分**（★ 2026-09-28，表格填空）。
 *
 * 逐空给分（`fillScoring: 'per-blank'`）时，服务端的得分是 `命中空数 × 本题满分`
 * ⇒ 界面上要显示的那个数也是 `每个空的满分 × 空数`。否则教师看到的「最高 1 分」
 * 与学生实际能拿的 6 分对不上，而**没有任何报错**。
 *
 * 🔴 空数必须读 **`readBlankCount`**（题干里的空 + **表格里的空**），
 * 不能读 `blankCount(promptRuns)` —— 后者只数题干，表格题会少算。
 *
 * ⚠️ 这条改动顺带修了一个口径：**一个空都还没有**的填空题，原来算的是
 * `full × 0 = 0`（「最高 0 分」），现在算 `full × 1` —— 因为服务端的
 * `answerSlotCount` 对「还没有答案的空题」给的正是 **1** 个答案槽。
 * 两个数从此一致（原来不一致，而屏幕上只是「最高 0 颗星星」这种没人会读的显示）。
 */
export function maximumPointsFor(node: WorksheetQuestionNode, fullPoints: number): number {
  const perBlank = (node.type === 'fill-blank' || node.type === 'choice-blank')
    && node.data.fillScoring === 'per-blank';
  return perBlank ? fullPoints * readBlankCount(node) : fullPoints;
}

/**
 * 填空域的 id（★ 2026-09-28 从 `prompt-editor.tsx` 提上来）。
 *
 * 🔴 **题干里的空与表格里的空共用这一个造法**：两者在 `data` 里是**同一个命名空间**
 *（`fillBlankSettings` 就按它存、`blankLayout` 按它编号），各写一份随机器不会撞
 *（36^6），但会有两个地方要改 id 格式 —— 而「两处各写一份、只改了一处」正是本仓
 * 反复栽的那一类。前缀只是让人认得出来，**不参与任何判据**。
 * ⚠️ 造 id 只能由调用方做：纯逻辑层（`worksheet-table.ts` / `worksheet-prompt-marks.ts`）
 * 自己造标识的话，它的用例就不确定了。
 */
export function newBlankId(): string {
  return `blank_${randomIdSuffix()}`;
}

/**
 * 读一组条目。**容错**（`data` 是库里的 JSON，手改过的行可能有别的形状）：
 * 非对象元素丢掉、`text` 不是字符串当空串、**缺 id 读成空串**。
 *
 * 🔴 「缺 id 读成空串」而**不是**在这里补一个：补 id 必须**恰好补一次**，而在读的时候补
 * 等于每渲染一次就换一个 id（组件一秒钟能重渲染很多次）—— 那正是「id 会变」这个毛病的形态，
 * 只是从「错位」变成了「每次刷新都不一样」。补的动作放在**写**那一侧（`writeEntries`），
 * 因为写是教师的动作触发的，一次就是一次。
 */
export function readEntries(raw: unknown, field: EntryTextField = 'text'): ItemEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ItemEntry[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const text = row[field];
    entries.push({
      id: typeof row.id === 'string' ? row.id : '',
      text: typeof text === 'string' ? text : '',
    });
  });
  return entries;
}

/**
 * 写回条目（`{ id, text }` / `{ id, label }`，**只带这两个键**）。
 *
 * 🔴 缺 id 的条目在这里**补一个** —— 见 `readEntries` 的说明。补出来的 id 与原来的条目
 * 没有血缘关系，但它**不可能错位任何已答数据**：一个没有 id 的条目在学生的作答值里
 * 根本不存在键（学生端按 id 索引），所以补一个只是让这道题变得可保存。
 * 触发补 id 的是教师**动一下这个列表**（改文字 / 增删），不是「打开页面」。
 */
export function writeEntries(entries: ItemEntry[], field: EntryTextField = 'text'): Array<Record<string, unknown>> {
  return entries.map((entry) => ({ id: entry.id || newItemId(), [field]: entry.text }));
}

/**
 * 给缺 id 的条目补上 id（**返回新的数组，不改入参**；已经有 id 的一个字都不动）。
 *
 * 🔴 与 `writeEntries` 的关系：那个函数在**写**的时候补（顺带把形状摆成 `{id, text}`）；
 * 本函数是同一件事的**条目形状**版本，给那些「要先在内存里把 id 补齐、再拿它们当答案键」
 * 的地方用 —— 答案键必须在**补完之后**才算得出来。
 *
 * ⚠️ 它**不能在渲染路径上调**（每渲染一次就换一批新 id = 另一种「id 会变」）。
 * 只许由教师的动作触发，且同一次动作里算出的答案键与补好的条目**一起**写回去。
 */
export function ensureEntryIds(entries: ItemEntry[]): ItemEntry[] {
  return entries.map((entry) => (entry.id ? entry : { ...entry, id: newItemId() }));
}

/** 一组条目里**能当答案键用**的 id（非空者，按出现顺序）。 */
export function readEntryIds(raw: unknown): string[] {
  return readEntries(raw)
    .map((entry) => entry.id)
    .filter((id) => id !== '');
}

/** 读一串非空字符串（`correctOrder` / `correctKeys`），别的元素丢掉。 */
function readStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

/**
 * 读正确答案的选项 key（单选 / 判断 / 多选共用）。
 *
 * ⚠️ 与**服务端** `readStrings` 同一条口径（丢掉空串）：`correctKeys: ['']` 在服务端
 * 等于「没有正确答案」，前端若把它读成一个有效的 key，界面就会显示「已选」而保存被拒。
 */
export function readCorrectKeys(node: WorksheetQuestionNode): string[] {
  return readStringList(node.data.correctKeys);
}

/** 读一个 `id → id` 的映射（归类题的 `placement`），只收非空字符串值。 */
export function readPlacement(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === 'string' && value) out[key] = value;
  });
  return out;
}

/** 一条连线（教师侧的 `data.pairs`；学生那一侧叫 `links`，见 §12 的裁定）。 */
export interface PairEntry {
  leftId: string;
  rightId: string;
}

/** 读连线题的配对，形状不全的条目直接丢掉（与服务端 `readPairs` 同形）。 */
export function readPairs(raw: unknown): PairEntry[] {
  if (!Array.isArray(raw)) return [];
  const pairs: PairEntry[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    if (typeof row.leftId === 'string' && row.leftId && typeof row.rightId === 'string' && row.rightId) {
      pairs.push({ leftId: row.leftId, rightId: row.rightId });
    }
  });
  return pairs;
}

/** 改一个条目的文字（按**位置**，id 原样留着 —— 它是学生作答值里的键，改文字不能碰它）。 */
export function renameEntryAt(entries: ItemEntry[], index: number, text: string): ItemEntry[] {
  return entries.map((entry, itemIndex) => (itemIndex === index ? { ...entry, text } : entry));
}

/** 把一个 id 在列表里挪一格（▲▼）。越界 / 未知 id ⇒ **原样返回**（不造无谓的改动）。 */
export function moveIdInList(ids: string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = ids.slice();
  next[index] = next[target];
  next[target] = id;
  return next;
}

/**
 * 一道新题。
 *
 * 🔴 题目 id 用 `crypto.randomUUID()` 生成**一次**，此后不随位置变化
 * （规格 §3-P：答案按 `questionId` 关联，改序不能让已答数据错位）。
 * 前缀 `q_` 与服务端补 id 时的形状（`routes/worksheets.ts` 的 `` `q_${crypto.randomUUID()}` ``）
 * 一致，所以「前端漏给 id、服务端补一个」这条支路产出的行与这里长得一样。
 *
 * ⚠️ **答案键一律留空**（`correctKeys: []` / `answers: []` / `correctOrder: []` /
 * `pairs: []` / `placement: {}`），单选题那条注释里的理由对**每一个**题型都成立：
 * 默认选中 A 会安静地把一道没配答案的题变成「所有选 A 的学生都对」。
 *
 * 🔴 **2026-09-24 更正**：本函数的前一版需求写着「产出的题必须立刻能通过
 * `validateQuestion`」，那句话既做不到、也不该做 ——
 *   · **做不到**：`validateQuestion` 的第一句是「题干不能为空」，而这里的 `prompt` 恒为 `''`
 *     ⇒ 任何题型的初始值都过不了；教师「什么都不改就保存」的失败原因永远是题干，他看得懂。
 *   · **不该做**：满足它的唯一办法是给每个题型**臆造一份完整答案**（多选 `['A']`、
 *     判断 `['T']`、填空 `['答案一']`、连线 identity 配对…）⇒ 教师填完题干忘了配答案
 *     ⇒ **一道拿着臆造答案键的题静默判分**。
 * ⇒ 代价如实记：教师要**多按一次保存**（服务端 400 的文案指名道姓，如「多选题至少要指定一个正确答案」），
 * 换来的是一道不会静默判分的题。
 *
 * ⚠️ 各题型的**非答案**内容给两三个已填好文案的占位条目（`选项一` / `条目一` / `框一`…），
 * 让教师**替换**而不是从零填。占位文案会被原样保存（教师只填题干时会留下它们），
 * 但那时答案键是空的 ⇒ 保存被拦下，不会有任何静默判分。
 */
/** 普通填空与选择填空都需要在题干中插入结构化的填空槽。 */
export function hasPromptBlankSlots(type: string): boolean {
  return type === 'fill-blank' || type === 'choice-blank';
}

export function newQuestion(type: QuestionType): WorksheetQuestionNode {
  const question: WorksheetQuestionNode = {
    id: `q_${randomIdSuffix()}`,
    type,
    prompt: '',
    // ★ M4b：绘图题**恒为手写**（它的作答值格式由题型决定，与这一格无关 —— 见
    // `src/lib/worksheet-ink.ts` 的 `inkFormatOf`，它是**题型优先**的）。
    // 其余题型不动：规格 §3-V 那条「第一批的题恒为 keyboard」继续成立，
    // 改它的是教师逐题点的那一个开关（`updateInputMode`）。
    inputMode: type === 'drawing' ? 'handwriting' : 'keyboard',
    // ★ 2026-09-26（教师）：「默认不勾选」—— 新题的「允许自动评分」开关**默认关**。
    //
    // 🔴 这一条**必须写进数据**，不能只是界面上不勾：服务端判分的判据是
    // `autoGrade === false` 才不判（见 `services/worksheet-questions.ts` 的 `judge`），
    // 而「没有这个键」= 照常判分。只改界面的话，教师看着开关是关的、分却照给。
    // ⚠️ 只给**判分题型**写（问答题/绘图题本来就不判分，给它们写是噪音，
    // 与 `normalizeNode` 那条「有值才写」同一条纪律）。
    // ⚠️ **已有题目一个字不动**：这条只影响之后新建的题（老题的键本来就存在或缺席，
    // 上面那个默认值不回溯）。
    ...(isGradedQuestionType(type) ? { autoGrade: false as const } : {}),
    data: {},
    children: [],
  };
  // ⚠️ `drawing` **不进下面这条链**（它不在这里出现，也**不许**在这里出现）：
  // 它的 `data` 恒为 `{}` —— 没有答案键、也没有条目，与 `short-answer` 同一档。
  // 给它臆造一份 `data`（哪怕只是一个空壳键）就是 M4a/C2 Step 1 立过的那条纪律
  // 所禁的事，代价是**静默判分**。
  if (type === 'single-choice') {
    // ⚠️ 单选的选项文案**保持空串**（不是这次的「占位文案」那一条）：它的初始形状有既有用例
    // 逐字钉着（`worksheet-editor-core.test.ts` 的「newQuestion 的单选题 correctKeys 默认是空的」），
    // 而 Step 1 要改的是**新增的 6 个题型**。改它没有需求、却要动一条既有断言。
    question.data = {
      options: [{ key: optionKey(0), text: '' }, { key: optionKey(1), text: '' }],
      correctKeys: [],
      choiceMode: 'single',
    };
  } else if (type === 'true-false') {
    // 选项**固定为对/错**（不存 `options`，规格 §12），所以这里只有答案键，且它是空的。
    question.data = { correctKeys: [] };
  } else if (type === 'multi-choice') {
    question.data = {
      options: [{ key: optionKey(0), text: '选项一' }, { key: optionKey(1), text: '选项二' }],
      correctKeys: [],
      // ⚠️ `partialCredit` **不是**答案键，是判分口径，所以它有默认值：
      // 界面上那两个单选按钮需要有一个选中态，而服务端只认这两个字面量
      //（认不出的值一律按「全对才算」走，见 `allowsMissing`）——
      // 显式写 `'all-or-nothing'` 与「不写这个键」在判分上是同一件事，
      // 区别只是教师能在屏幕上看见自己选的是哪一个。
      partialCredit: 'all-or-nothing',
    };
  } else if (type === 'fill-blank') {
    // ⚠️ **单空形状，不是 `blanks`**（规格 §12：单空仍是 `{ answers }`，不动）。
    // 编辑体把它画成**一个空**，教师点「＋ 增加一个空」时才升级成多空。
    question.data = { answers: [], fillScoring: 'per-blank' };
  } else if (type === 'order') {
    question.data = {
      // ⚠️ 占位条目的**文字刻意不是「一、二」的升序**：`items` 是**学生看到的顺序**，
      // 而「取当前顺序」会把屏幕上这个顺序变成答案 —— 先给它一个看着就是打乱的形状，
      // 教师替换文字时便不会以为这个顺序本身有任何含义。
      items: [
        { id: newItemId(), text: '条目二' },
        { id: newItemId(), text: '条目一' },
      ],
      // 空数组 = **还没配过答案**（教师用「取当前顺序」或 ▲▼ 配上）。
      // ⚠️ 它同时让 A1 Step 5 那条「显示顺序必须与正确顺序不同」暂时无从谈起
      //（长度都不同，谈不上相同）—— 那条校验要等答案配好之后才有内容，
      // 而配好之后维持它的是 `ensureOrderDistinct`（见那里）。
      correctOrder: [],
    };
  } else if (type === 'match') {
    question.data = {
      left: [
        { id: newItemId(), text: '左项一' },
        { id: newItemId(), text: '左项二' },
      ],
      right: [
        { id: newItemId(), text: '右项一' },
        { id: newItemId(), text: '右项二' },
      ],
      // 一条配对都没有 = 还没配答案。教师用每行的下拉一条一条配。
      pairs: [],
    };
  } else if (type === 'categorize') {
    question.data = {
      items: [
        { id: newItemId(), text: '条目一' },
        { id: newItemId(), text: '条目二' },
      ],
      zones: [
        { id: newZoneId(), label: '框一' },
        { id: newZoneId(), label: '框二' },
      ],
      // 每个条目都还没归到框里（下拉显示「请选择」）。
      placement: {},
    };
  }
  return question;
}

// `readOptions` 定义在 `src/lib/worksheet-questions.ts`，上面已转出（学生端渲染同一份
// `content` 的题面，读法必须只有一份）。

/**
 * 写回选项：**重新按位置编号**，并让正确答案跟着那道选项走。
 *
 * 🔴 这是本页最容易做错的一处。选项的 `key` 是学生答案里的值
 * （`{ format: 'choice/v1', selected: ['B'] }`），所以删掉「A」之后，
 * 原来的「B」必须变成「A」—— 否则学生会答一个不存在的选项。而正确答案若只按字母跟着变，
 * 就会从「光合作用」跳到「呼吸作用」上，**判分从此全错且没有任何报错**。
 * 所以：先把旧 key 映射到新位置，再用它翻译 `correctKeys`。
 *
 * 🔴 **超出 A–Z 的选项原样保留，不截断。** 服务端对选项数不设上限，所以库里可能存在
 * 26 个以上的题；在这里 `slice(0, MAX_OPTIONS)` 会把它们悄悄砍掉，而被砍掉的选项让
 * `correctKeys` 找不到映射 —— 于是「改一处选项文字」这一步会顺手删掉几个选项、
 * 并把正确答案清空，**没有任何报错**。保留下来只是 key 不再是单字母（`optionKey`
 * 的值域到 Z 为止，第 27 个起沿用原来的 key），而教师把选项删回 26 个以内时会自然
 * 重新编号回 A–Z。
 */
export function writeOptions(rawOptions: ChoiceOption[], correctKeys: unknown): { options: ChoiceOption[]; correctKeys: string[] } {
  return writeChoiceOptions(rawOptions, correctKeys, false);
}

/**
 * 写回选项的**唯一实现**（单选与多选共用）；`multiple` 只决定**正确答案留几个**。
 *
 * 🔴 `multiple` 这个开关**不是**可选的装饰：`writeOptions` 结尾的 `slice(0, 1)` 是单选的
 * 口径（只有一个正确答案），多选题直接走它会把**第 2 个正确答案静默丢掉** ——
 * 教师勾了三个正确答案，保存下来只剩一个，而屏幕上一直显示着三个勾。
 * ⇒ 重编号 + 翻译 `correctKeys` 的逻辑只能有这一份，两个导出各自调它。
 */
function writeChoiceOptions(
  rawOptions: ChoiceOption[],
  correctKeys: unknown,
  multiple: boolean,
): { options: ChoiceOption[]; correctKeys: string[] } {
  const remap = new Map<string, string>();
  const options = rawOptions.map((option, index) => {
    // A–Z 之内按位置重编号；之外原样保留（不重编号、也不丢弃）。
    if (index >= MAX_OPTIONS) return option;
    const key = optionKey(index);
    remap.set(option.key, key);
    return { key, text: option.text, ...(option.imageUrl ? { imageUrl: option.imageUrl } : {}) };
  });
  // 超上限那些选项的 key 没有新旧之分（上面原样返回），翻译 `correctKeys` 时按原值放行。
  const keptKeys = new Set(options.slice(MAX_OPTIONS).map((option) => option.key));

  const previous = Array.isArray(correctKeys)
    ? correctKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const translated: string[] = [];
  for (const key of previous) {
    const next = remap.get(key) ?? (keptKeys.has(key) ? key : undefined);
    if (next && !translated.includes(next)) translated.push(next);
  }
  // 单选：最多一个正确答案。多出来的（例如两道选项被手工合并到同一位置）截掉。
  // 多选：全留下 —— 一个都不许丢（见 `writeChoiceOptions` 的说明）。
  return { options, correctKeys: multiple ? translated : translated.slice(0, 1) };
}

/** `writeOptions` 的多选变体。见 `writeChoiceOptions`。 */
export function writeMultipleOptions(
  rawOptions: ChoiceOption[],
  correctKeys: unknown,
): { options: ChoiceOption[]; correctKeys: string[] } {
  return writeChoiceOptions(rawOptions, correctKeys, true);
}

// ── 从剪贴板粘贴一整道题（★ 2026-09-27）──────────────────────────────────

/**
 * 这道题有**可编辑的选项表**吗（= 选择题）。
 *
 * 🔴 判断题**不算**：它的选项固定是对 / 错两个，`data` 里连 `options` 都没有 ——
 * 把「粘贴题目」摆在一道判断题上，教师会粘进来一列选项，然后什么也看不见。
 * 「哪些题型有选项表」这个问题**只许有一个答案**（工具栏按它决定按钮画不画、
 * 粘贴补丁按它决定选项写不写），所以它住在这里。
 */
export function isChoiceQuestion(node: WorksheetQuestionNode): boolean {
  return node.type === 'single-choice' || node.type === 'multi-choice';
}

/**
 * 把一个选项挪到另一个位置（★ 2026-09-27，选项拖动排序）。
 *
 * 口径与 `reorder`（题目拖动）**逐字相同**：`to` 是**抽走被拖那一项之后**的目标下标
 * （`page.tsx` 那边往下拖时会先 `index - 1`，这里沿用同一个约定，免得两处差一）。
 *
 * 🔴 无事发生时**返回原数组**：`updateData` 逐键按 `===` 判有没有变，返回一个新数组会让
 * 一次「拖回原位」白占一格撤销栈 —— 教师按 ⌘N 时屏幕纹丝不动，只能再按一次。
 */
export function moveOptionTo(options: ChoiceOption[], from: number, to: number): ChoiceOption[] {
  if (from < 0 || from >= options.length) return options;
  const target = Math.max(0, Math.min(to, options.length - 1));
  if (target === from) return options;
  const next = options.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * 「单选 / 多选」那个开关的 `data` 补丁（★ 2026-09-27）。
 *
 * 🔴 切回单选时**必须把正确答案截到一个**：服务端的单选口径要求「恰好一个」
 *（`validateSingleAnswer`），多留一个的后果是那道题**永远存不进去**（400），
 * 而屏幕上只是那个开关被关掉了 —— 教师会去别处找原因。
 *
 * ⚠️ 两个方向都重置 `partialCredit`：它在单选口径下**无意义**（判分器不读它），
 * 留着就是一段「这道题还能漏选得分」的死数据。
 * ⚠️ 这两条判据原来写在 `multi-choice-body.tsx` 里，现在住在这里 —— 因为开关本身
 * 搬到了题目卡的 section 头上（教师：「放到右上角去」），那个组件已经拿不到它了。
 */
export function choiceModePatch(multiple: boolean, node: WorksheetQuestionNode): Record<string, unknown> {
  return {
    choiceMode: multiple ? 'multiple' : 'single',
    partialCredit: 'all-or-nothing',
    ...(multiple ? {} : { correctKeys: readCorrectKeys(node).slice(0, 1) }),
  };
}

/* `isMultipleChoice` 在 2026-09-27 搬去了 `@/lib/worksheet-questions`（学生端也要用），
   本文件从上面那串 `export { … }` 里原样再导出 —— 原来的注释跟着它一起搬走了。 */

/** 带括号的标记：`(A)` `（A）` `[A]` `【A】`、`(1)` `（1）`。 */
// 🔴 **不要求前面有空白**：中文卷子最常见的写法是 `（1）光合作用（2）呼吸作用` —— 紧挨着的。
// 括号本身就是分隔符，所以它不需要额外的边界判据。
const BRACKET_MARKER = /[（(\[【]\s*([A-Za-z]|\d{1,2})\s*[）)\]】]/g;
/**
 * 带分隔符的标记：`A.` `A、` `A)` `A）` `A．` `A:` `A：`，数字同理。
 *
 * 🔴 **必须落在行首或空白之后**。少了这条，正文里那个 `答案：A. 北京` 的 `A.` 会被当成前缀，
 * 于是「答案：」被吃掉、选项变成半句话 —— 而教师看到的是「粘贴之后文字少了一截」。
 */
const SEPARATED_MARKER = /(^|\s)([A-Za-z]|\d{1,2})\s*[.、．)）:：]/g;

/** 粘贴解析的结果。 */
export interface ParsedQuestionPaste {
  /**
   * 题干 = 第一个选项标记**之前**那一段（已剥掉题号）。识别不到 ⇒ `null`。
   *
   * ⚠️ 它只在「认出了选项表」时才存在 —— 见 `findOptionRun` 那段。
   */
  stem: string | null;
  /** 选项正文（前缀已剥掉、已 `trim`）。最多 `MAX_OPTIONS` 条；没识别到 ⇒ `[]`。 */
  texts: string[];
  /**
   * 选项**怎么拆出来的**：`'marker'` = 按 `A.` / `(1)` 这类前缀；`'line'` = 一行一个。
   * 一条都没拆出来 ⇒ `null`。
   * 🔴 预览窗必须照实说出来 —— 拆错不可怕（替换前能看、替换后每格还能改），
   * **拆错了却不说**才可怕。
   */
  optionSplit: 'marker' | 'line' | null;
  /** 因为超过 `MAX_OPTIONS` 被丢掉的条数。**大于 0 时预览窗必须说**。 */
  dropped: number;
}

interface FoundMarker {
  /** 标记**本身**的起点（排序与「两个标记之间」的判断都用它）。 */
  at: number;
  /** 标记**之后**（= 正文开始）的位置。 */
  contentAt: number;
  /** 标记**之后**的位置（= 上一个标记的正文到此为止）。 */
  end: number;
  token: string;
}

/** 找出所有标记，丢掉互相重叠的那些（`（1）` 会被两条正则各命中一次，取起点靠前的）。 */
function findOptionMarkers(text: string): FoundMarker[] {
  const found: FoundMarker[] = [];
  for (const match of text.matchAll(BRACKET_MARKER)) {
    const at = match.index ?? 0;
    found.push({ at, contentAt: at + match[0].length, end: at + match[0].length, token: match[1] });
  }
  for (const match of text.matchAll(SEPARATED_MARKER)) {
    const at = match.index ?? 0;
    // `(^|\s)` 里那个空白是**匹配到的**，标记本身从它后面一个字开始。
    const markerAt = at + (match[1] === '' ? 0 : match[1].length);
    found.push({ at: markerAt, contentAt: at + match[0].length, end: at + match[0].length, token: match[2] });
  }
  found.sort((a, b) => a.at - b.at);
  const kept: FoundMarker[] = [];
  for (const marker of found) {
    // 与已收下的那个重叠 ⇒ 丢掉（同一个 `（1）` 被两条正则各命中一次，只用先出现的）。
    if (kept.some(other => marker.at < other.end)) continue;
    kept.push(marker);
  }
  return kept;
}

/** 标记的序数（字母按 A=1、数字按自身）。 */
function markerRank(token: string, letters: boolean): number {
  return letters ? token.toUpperCase().charCodeAt(0) - 64 : Number(token);
}

/**
 * 从标记表里找出那一段**像选项表**的连续区间。
 *
 * 四条判据缺一不可（每一条都对应一个真实的误判）：
 *
 *   1. **至少两个** —— 一个标记不成表（`A. 甲` 单独一行不是四个选项）。
 *   2. **从头就是 `A`/`a`/`1`** —— 🔴 这条拦的是**正文**：`3.14 是圆周率` / `2.71 是自然对数`
 *      两行的 `3.` `2.` 会被正则命中，而它们首项不是 A/1 ⇒ 不当标记 ⇒ **一个字都不剥**
 *      （退化成按行拆）。宁可拆得笨一点，也不要吃掉教师的正文。
 *   3. **同族且严格递增** —— 拦 `1. 甲 / 2. 乙 / 1. 丙` 这类回头编号，也拦住 `A` 与 `1` 混着来。
 *   4. 🔴 **一直延伸到最后一个标记** —— 这条是「题干也一起识别」逼出来的，也是本函数
 *      最容易写错的一条。前面那三条只管**一段**，而 `1. 题干` 与 `1. 甲` 都是标记 ⇒
 *      从第二个 `1.` 起算才是选项表，它前面那一段正好是题干。
 *      ⇒ 但「一段合规的标记」不等于「它就是选项表」：`A. 甲\nB. 乙\n1. 丙` 里那三个标记
 *      能切出 `[A,B]` 这一段，而尾巴上那个 `1.` **会被丢掉**（没有哪一段认领它）。
 *      要求**跑到最后一个标记**就没有这个洞：不满足就整段退回按行拆，**一个字都不丢**。
 */
function findOptionRun(tokens: string[]): { from: number; to: number } | null {
  for (let start = 0; start < tokens.length; start += 1) {
    const letters = /^[A-Za-z]$/.test(tokens[start]);
    const digits = /^\d{1,2}$/.test(tokens[start]);
    if (!letters && !digits) continue;
    const first = tokens[start].toUpperCase();
    if (letters ? first !== 'A' : Number(first) !== 1) continue;
    let end = start;
    while (end + 1 < tokens.length
      && /^[A-Za-z]$/.test(tokens[end + 1]) === letters
      && markerRank(tokens[end + 1], letters) > markerRank(tokens[end], letters)) {
      end += 1;
    }
    if (end - start + 1 >= 2 && end === tokens.length - 1) return { from: start, to: end };
  }
  return null;
}

/**
 * 题干开头那个**题号**：`1.` `2、` `（3）` `第4题` `(5)`。
 *
 * 🔴 两支都**必须带括号或分隔符**。写成「开头有 1~2 个数字就剥掉」的后果是
 * `2024 年的第一场雪` 变成 `24 年的第一场雪` —— 教师的题干少一截，而屏幕上只是一行字。
 * ⚠️ 括号与「第 N 题」这两种形态**自带边界**，单独一支就能判准。
 */
const LEADING_BRACKETED_NUMBER = /^\s*(?:第\s*\d+\s*题[.、．:：]?|[（(\[【]\s*\d{1,2}\s*[）)\]】])\s*/;
/** 「数字 + 分隔符」那一支 —— 它**需要额外一道判据**，见 `stripLeadingQuestionNumber`。 */
const LEADING_NUMBER_WITH_SEPARATOR = /^\s*\d{1,2}\s*[.、．)）:：]\s*/;

/**
 * 剥掉题干开头的题号（剥不出就原样返回）。
 *
 * 🔴 `3.14 是圆周率` 开头那个 `3.` 与题号 `3.` **长得一模一样** —— 光靠正则分不开。
 * 补的那道判据是：**剥完之后紧接着又是一个数字 ⇒ 那是小数，不是题号**。
 * 少了它的后果是题干变成 `14 是圆周率`，而屏幕上只是一行看起来还算正常的字。
 * （这条是**用例先红**抓出来的：`parseQuestionPaste('3.14 是圆周率\nA. 甲\nB. 乙')`。）
 */
function stripLeadingQuestionNumber(stem: string): string {
  const bracketed = LEADING_BRACKETED_NUMBER.exec(stem);
  if (bracketed) return stem.slice(bracketed[0].length).trim();
  const numbered = LEADING_NUMBER_WITH_SEPARATOR.exec(stem);
  if (!numbered) return stem;
  const rest = stem.slice(numbered[0].length);
  if (/^\d/.test(rest)) return stem;
  return rest.trim();
}

/**
 * 把一整段粘贴的文本解析成**题干 + 选项**。
 *
 * 三条出路：
 *   · 认出了选项表（`findOptionRun`）⇒ 它**之前**那一段是题干、它自己切成选项；
 *   · 没认出选项表但有多行 ⇒ 一行一个选项（题干由预览窗里的开关交给教师定）；
 *   · 只有一行 ⇒ 只能当题干。
 * 什么都没有（空白 / 非字符串）⇒ `null`。
 */
export function parseQuestionPaste(raw: unknown): ParsedQuestionPaste | null {
  if (typeof raw !== 'string') return null;
  // CRLF 归一化：Windows 上从 Word 复制出来的就是 CRLF。
  const text = raw.replace(/\r\n?/g, '\n');
  if (!text.trim()) return null;

  const markers = findOptionMarkers(text);
  const run = findOptionRun(markers.map(marker => marker.token));
  if (run) {
    const texts = markers.slice(run.from, run.to + 1).map((marker, index, list) => {
      const next = list[index + 1];
      return text.slice(marker.contentAt, next ? next.at : text.length).trim();
    });
    const before = stripLeadingQuestionNumber(text.slice(0, markers[run.from].at).trim());
    const dropped = Math.max(0, texts.length - MAX_OPTIONS);
    return {
      stem: before || null,
      texts: texts.slice(0, MAX_OPTIONS),
      optionSplit: 'marker',
      dropped,
    };
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return { stem: lines[0] ?? text.trim(), texts: [], optionSplit: null, dropped: 0 };
  const dropped = Math.max(0, lines.length - MAX_OPTIONS);
  return { stem: null, texts: lines.slice(0, MAX_OPTIONS), optionSplit: 'line', dropped };
}

/**
 * 把解析出来的选项文本变成 `data` 补丁。**全部替换**（教师裁定）。
 *
 * ⚠️ 正确答案**按位置**跟着走：旧字母交给 `writeOptions` / `writeMultipleOptions` 翻译，
 * 于是「原来勾在第 2 个上的答案」会留在第 2 个；新列表更短、那个位置没了时它被丢掉，
 * 界面随即显示「尚未设置正确答案」（预览窗已经把这两件事都说出来了）。
 *
 * 🔴 抽成纯函数是为了**让这条最难的判断能跑用例**：它要读三个东西（选项、正确答案、
 * 这道题是不是多选），三个都在 `node` 里，而组件那一层在本机没有回归网。
 * ⚠️ 它**不截断**到 `MAX_OPTIONS` —— 截断与「丢了几条」的报数在解析那一层，
 * 这里再截一次就是第二个真源。
 */
export function optionPastePatch(texts: string[], node: WorksheetQuestionNode): { options: ChoiceOption[]; correctKeys: string[] } {
  const multiple = isMultipleChoice(node);
  const options = texts.map((text, index) => ({ key: optionKey(index), text }));
  const correctKeys = readCorrectKeys(node);
  const written = multiple
    ? writeMultipleOptions(options, correctKeys)
    : writeOptions(options, correctKeys);
  return { options: written.options, correctKeys: written.correctKeys };
}

/**
 * 填空题**单空形状**的「答案」textarea 值（规格 §3-R：一行一个可接受答案）。
 *
 * ★ M4a/C2：本函数改成「**第 0 个空**的文本」（`readBlankText` 的同一份实现）。
 * 单空形状下它与原实现逐字相同（`data.answers` 就是第 0 个空）；
 * 多空形状下它原来返回空串 —— 那个取值没有任何调用方依赖，而「第 0 个空」更符合它的名字。
 * 多空的每一个空请用 `readBlankText(node, index)`。
 */
export function readFillAnswers(node: WorksheetQuestionNode): string {
  return readBlankText(node, 0);
}

/** 反向的 `readFillAnswers`。**刻意保留空行**：textarea 的换行要靠它，往返才是无损的。 */
export function writeFillAnswers(text: string): string[] {
  return text.split('\n');
}

/**
 * 「选择填空」的**待选词**的字符串值（★ 2026-09-26）—— 与上面的答案那份**同一条规矩**：
 * 一行一个词、**刻意保留空行**，往返无损。
 *
 * ⊘ 2026-09-28：教师把**输入框**换成了单行（词与词之间用顿号/逗号/分号分隔，
 * 见 `@/lib/worksheet-fill-modes` 的 `splitChoiceText`）—— 但**这一对函数的契约没变**：
 * 它们读写的是那个「每行一项」的字符串，调用方把词表 `join('\n')` 之后喂进来。
 * ⚠️ 名字里的「textarea」已经不对了，留着这两行是为了不改调用方；
 * 若将来没人用字符串形态，这一对可以整个删掉（存储是数组，不经过它们）。
 *
 * ⚠️ 空行由 `sanitizeContentForSave` 在**出网之前**丢掉（见那里）—— 编辑期留着，
 * 否则「敲一下回车想在下一行接着写」会被当场吃掉。
 */
export function readChoicesText(node: WorksheetQuestionNode): string {
  const raw = node.data.choices;
  if (!Array.isArray(raw)) return '';
  return raw.filter((item): item is string => typeof item === 'string').join('\n');
}

/** 反向的 `readChoicesText`。返回的是**补丁**（与 `writeBlankText` 同形）。 */
export function writeChoicesText(text: string): Record<string, unknown> {
  return { choices: text.split('\n') };
}

/**
 * 去掉一组可接受答案里的空行（非字符串元素也一并丢掉）。
 * 返回 `null` = **一个都没去掉**（调用方据此判断要不要造新对象）。
 */
function withoutEmptyAnswers(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const answers = raw.filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0);
  return answers.length === raw.length ? null : answers;
}

/**
 * 保存前的最后一道清理：填空题的 `answers` 去掉空行（**单空与多空两种形状都清**）。
 *
 * 🔴 不清理的后果是**安静的满分**：`grade()` 用 `normalizeFillText` 比较，
 * 空串归一化之后还是空串 —— `answers: ['']` 会把学生的**空作答**判成正确，
 * 而且看板上会显示为「全班都对」。编辑期允许空行存在（textarea 的换行需要它），
 * 但**出网之前必须去掉**，唯一出网点是 `buildPayload()`。
 *
 * 🔴 **多空（M4a）的答案在第二层**：`data.blanks = [{ answers: […] }, …]`。
 * 只清 `data.answers` 的话，M3 修过的那个毛病会在新形状上**原样重现** ——
 * 而这次连「有没有清」都不会有人发现（单空那条路看起来还好好的）。
 * 两个形状的清法**必须是同一段代码**（`withoutEmptyAnswers`）。
 */
export function sanitizeContentForSave(content: WorksheetContent): WorksheetContent {
  // ★ 2026-09-25：改成**递归**（`mapAll`）。原先只 `map` 顶层，理由写在下面那条「只清顶层」
  // 的旧注释里 —— 那个理由（「嵌套里的题教师看不见」）在迁移之后不成立了。
  const nodes = mapAll(content.nodes, (node) => {
    // ★ M4a：`points` 为 `undefined` 时**把键删掉**，而不是留一个 `{ points: undefined }`。
    //
    // 两种形状在 `JSON.stringify` 之后长得一样（`undefined` 的属性会被丢掉），所以这不是
    // 在修一个能观察到的 bug —— 它让「**没有 = 键不存在**」这条约定在**内存里**也成立
    // （服务端 `normalizeNode` 那句 `...(points ? { points } : {})` 就是按这条约定的写法）。
    // 留着一个值为 `undefined` 的键，下游任何一处 `'points' in node` 式的判断都会被它骗到。
    //
    // ⚠️ 半填（只填了一个字段）**原样保留**：`buildPayload` 的产物同时也是**草稿**的内容，
    // 丢掉它等于教师恢复草稿时屏幕上刚打的字消失。拦住半填出网的是 `save()` 里的
    // `findPartialPoints`，不是这里 —— 一个纯清理函数不该承担「拒绝保存」这件事。
    let current = node;
    if (current.points === undefined && 'points' in current) {
      const dropped: WorksheetQuestionNode = { ...current };
      delete dropped.points;
      current = dropped;
    }
    // ★ 2026-09-26：**「选择填空」也走这一支** —— 它的答案与填空逐字同形（每空一份），
    // 多出来的只有 `choices`（待选词）。
    // 🔴 少了它，`choice-blank` 的答案**不会被清理**（空行留着 ⇒ 服务端那条
    // 「每个空至少要有一个可接受的答案」会被一行空白骗过去），而且下面那段
    // 「新形状逐空清」也跑不到。
    const isFillLike = current.type === 'fill-blank' || current.type === 'choice-blank';
    if (!isFillLike) return current;
    const next: Record<string, unknown> = { ...current.data };
    let changed = false;

    // ★ 2026-09-26：**新形状**（每空一份）在这里要逐空清，不能整份丢给 `withoutEmptyAnswers` ——
    // 它的判据是「元素必须是字符串」，而新形状的元素是**数组** ⇒ 它会把每一份答案都当成
    // 坏元素丢掉，**存一次就把全题的答案清空**（而且没有报错）。
    if (fillShape(current) === 'nested') {
      const nested = (next.answers as unknown[]).map((entry) => withoutEmptyAnswers(entry) ?? entry);
      const nestedChanged = nested.some((entry, index) => entry !== (next.answers as unknown[])[index]);
      if (nestedChanged) { next.answers = nested; changed = true; }
    } else {
      const flat = withoutEmptyAnswers(next.answers);
      if (flat) { next.answers = flat; changed = true; }
    }

    if (Array.isArray(next.blanks)) {
      let blanksChanged = false;
      const blanks = next.blanks.map((blank) => {
        if (!blank || typeof blank !== 'object' || Array.isArray(blank)) return blank;
        const cleaned = withoutEmptyAnswers((blank as Record<string, unknown>).answers);
        if (!cleaned) return blank;
        blanksChanged = true;
        return { ...(blank as Record<string, unknown>), answers: cleaned };
      });
      if (blanksChanged) { next.blanks = blanks; changed = true; }
    }

    // 🔴 待选词里的空行必须丢掉：`choices.length` 是**校验**（词不能比空少）与
    // 「还有哪些词没用」的依据，一个空串会被当成一个词 ⇒ 那道题看起来够用、
    // 学生却少一个词可拖。
    if (current.type === 'choice-blank') {
      const cleaned = withoutEmptyAnswers(next.choices);
      if (cleaned) { next.choices = cleaned; changed = true; }
    }

    if (!changed) return current;
    return { ...current, data: next };
  });
  return nodes === content.nodes ? content : { ...content, nodes };
}

// ── 6 个题型的编辑形状（M4a / C2）──────────────────────────────────────
//
// 这一节是**编辑器这一侧**的形状读写；权威是服务端 `worksheet-questions.ts` 的
// `VALIDATORS` / `JUDGES`（同一份协议的另外两侧）。每个写函数都遵守两条纪律：
//
//   1. **每次改动把题面与答案一起提交**（`items` 陪着 `correctOrder`、`left`/`right` 陪着
//      `pairs`…）。分开写会有一个「题面已经变了、答案还指着旧 id」的窗口期，
//      而那个窗口期一旦被保存或撤销命中，落库的就是一张判分全错的题（**没有任何报错**）。
//   2. **维持题型的结构不变量**（如「学生看到的顺序 ≠ 正确顺序」）。这与 `writeOptions`
//      的重编号是同一条纪律：每一次结构改动都要维持它，而不是把教师留在一个
//      「自己能看出问题在哪」其实并不成立的状态里。

// —— 填空（多空）──────────────────────────────────────────────────────

/**
 * 这道填空题的答案是**哪一种历史形状**（★ 2026-09-26 起只影响**读**）。
 *
 * 三种形状（不同时期落库的，一份都不能丢）：
 *   · `'multi'` —— 老多空：`blanks: [{ answers: […] }, …]`，答案住在 `blanks` 里面；
 *   · `'single'` —— 老单空：`answers: ['氧气']`，**平铺**的一份；
 *   · `'nested'` —— **新形状**：`answers: [['氧气'], …]`，**每空一份**。
 *
 * 🔴 **写**一律写 `'nested'`（读的三条路只是过渡）。理由：三种形状并存是本仓最防的
 * 那类分叉，而「每空一份」是唯一一个**单空与多空没有区别**的形状 ——
 * 判分（`answerSlotCount` / `acceptableAnswersFor`）、编辑器、迁移都能只写一套。
 * ⚠️ 判据「**每一个**元素都是数组」而不是「第一个是」：教师的坏数据里出现一个 `[]`
 * 会让「第一个是数组」判错，于是平铺那份被当成「多个空」（服务端那条 M3 边界用例
 * 就是这么红的）。
 */
export function fillShape(node: WorksheetQuestionNode): 'single' | 'multi' | 'nested' {
  const answers = node.data.answers;
  if (Array.isArray(answers) && answers.length > 0 && answers.every(Array.isArray)) return 'nested';
  return Array.isArray(node.data.blanks) ? 'multi' : 'single';
}

/**
 * 每个空的可接受答案，**编辑期原样**（含空行 —— textarea 的换行要靠它，见 `writeFillAnswers`）。
 *
 * ⚠️ 单空形状返回**恰好一个**空（`[answers]`），哪怕 `answers` 是空的：教师看到的是一个
 * 可以往里填的框，「＋ 增加一个空」才有一个升级的起点。
 * ⚠️ 多空形状的 `blanks: []`（教师把空删光了）返回**零个**空 —— 界面上一行都没有，
 * 只有「＋ 增加一个空」。不替它造一个空：那样屏幕上就有一行教师没建过的框。
 */
export function readBlankAnswers(node: WorksheetQuestionNode): string[][] {
  const shape = fillShape(node);
  const clean = (raw: unknown): string[] => (
    Array.isArray(raw) ? raw.filter((answer): answer is string => typeof answer === 'string') : []
  );
  if (shape === 'nested') {
    // 新形状：每空一份。⚠️ **长度就是空数** —— 这里不补也不裁。
    return (node.data.answers as unknown[]).map(clean);
  }
  if (shape === 'multi') {
    const blanks = node.data.blanks as unknown[];
    return blanks.map((blank) => {
      if (!blank || typeof blank !== 'object' || Array.isArray(blank)) return [];
      return clean((blank as Record<string, unknown>).answers);
    });
  }
  return [clean(node.data.answers)];
}

/** 第 `index` 个空的 textarea 值（一行一个可接受答案）。往返无损。 */
export function readBlankText(node: WorksheetQuestionNode, index: number): string {
  const answers = readBlankAnswers(node)[index];
  return answers ? answers.join('\n') : '';
}

/**
 * 写第 `index` 个空的答案。**形状保持不变** —— 单空写回 `answers`、多空写回 `blanks`。
 *
 * 单空题不会因为打字而悄悄换形状：一道在用中的题换形状 = 库里那份数据换了结构，
 * 而学生那边的作答形状（`text` → `texts`）也跟着变。
 */
export function writeBlankText(node: WorksheetQuestionNode, index: number, text: string): Record<string, unknown> {
  const answers = writeFillAnswers(text);
  const blanks = readBlankAnswers(node);
  // 下标越界 = 调用方算错了（界面上没有第二条路），返回空补丁而不是写进一个空。
  if (index < 0 || index >= blanks.length) return {};
  // ★ 一律写**新形状**（每空一份）+ 把老的 `blanks` 键**清掉**：
  // 两份答案并存会让「哪一份算数」有两个答案。
  return {
    blanks: undefined,
    answers: blanks.map((current, blankIndex) => (blankIndex === index ? answers : current)),
  };
}

/**
 * 「＋ 增加一个空」。
 *
 * 🔴 单空形状在这一步**升级成多空**：平面的 `answers` 成为第一个空，并且把 `answers` 键
 * 置成 `undefined`（`JSON.stringify` 会丢掉值为 `undefined` 的键 ⇒ 落库的形状只有 `blanks` 一份）。
 * 两份答案并存会让「哪一份算数」有两个答案 —— 服务端按 `blanks` 走，前端若再读 `answers`
 * 就与服务端分岔了。
 *
 * 🔴 **升级之后不再退回。** 把空删回一个时仍然是 `blanks` 形状。理由：退回是一条
 * **会静默改形状的路径**，而它换不来任何好处 —— 服务端两种都收，一个空时判分也逐字相同
 *（`hit === blanks.length` ⇒ 全对，否则全错，`partial` 不可能出现）。
 * 代价是「这道题在库里是什么形状」不再随教师的增删来回变。
 */
export function addBlank(node: WorksheetQuestionNode): Record<string, unknown> {
  // ★ 一律写新形状：老形状（平铺 / `blanks`）在**读**的时候已经被摊成同一份了，
  // 所以这里不必再分情况 —— 这正是「统一成每空一份」换来的东西。
  return { blanks: undefined, answers: [...readBlankAnswers(node), []] };
}

/**
 * 「🗑 删掉这个空」。
 *
 * ⚠️ 界面在**只剩一个空**时**不渲染**那个删除按钮（服务端要求「至少要有一个空」），
 * 所以这里够不到「零个空」。够得到的话，单空形状返回**空补丁**而不是 `{ answers: [] }` ——
 * 后者会把一道「还没填答案」的题变成「填了空答案」的题，而教师只是按了一下那个按钮
 *（它本来就不该按得动：界面上没有它）。
 */
export function removeBlank(node: WorksheetQuestionNode, index: number): Record<string, unknown> {
  const blanks = readBlankAnswers(node);
  // ⚠️ 界面在**只剩一个空**时**不渲染**那个删除按钮（服务端要求「至少要有一个空」），
  // 所以这里够不到「零个空」。够得到的话返回**空补丁**而不是 `{ answers: [] }` ——
  // 后者会把一道「还没填答案」的题变成「填了空答案」的题，而教师只是按了一下那个按钮。
  // ⚠️ 老的单空形状（`fillShape === 'single'`，即答案还是**平铺**的）**不删**：
  // 它只有一个空，删它就是上面那种情况。
  if (fillShape(node) === 'single' && blanks.length <= 1) return {};
  if (index < 0 || index >= blanks.length) return {};
  return { blanks: undefined, answers: blanks.filter((_, blankIndex) => blankIndex !== index) };
}

// —— 排序 ──────────────────────────────────────────────────────────────

export interface OrderData {
  items: ItemEntry[];
  correctOrder: string[];
}

/** 读排序题：`items` 是**学生看到的顺序**、`correctOrder` 是**正确顺序**（A1 的判据）。 */
export function readOrder(node: WorksheetQuestionNode): OrderData {
  return {
    items: readEntries(node.data.items),
    correctOrder: readStringList(node.data.correctOrder),
  };
}

/** 写回排序题。**两个键一起写**（见本节的纪律 1）。 */
export function writeOrder(items: ItemEntry[], correctOrder: string[]): Record<string, unknown> {
  return { items: writeEntries(items), correctOrder };
}

/**
 * 「学生看到的顺序」与「正确顺序」现在是不是**逐位相同**。
 * `true` ⇒ 学生什么都不做就是满分（A1 Step 5 那条校验会拦下它）。
 *
 * ⚠️ 长度不同 / `correctOrder` 还不是一个排列时返回 `false`：那两种情形有它们自己的错
 *（「正确顺序必须正好是这些条目各一次」），在这里再报一句只会让教师同时看到两条红字，
 * 而它们指向的是同一处。
 */
export function isOrderAmbiguous(items: ItemEntry[], correctOrder: string[]): boolean {
  if (items.length < 2 || items.length !== correctOrder.length) return false;
  return items.every((entry, index) => entry.id === correctOrder[index]);
}

/**
 * 需要的话，把「学生看到的顺序」挪到一个与正确顺序**不同**的位置。
 *
 * 相同 ⇒ 返回**循环左移一位**的结果：id 互不相同 ⇒ 移完之后第一位是原来的第二位 ⇒
 * **一定**不等。确定性、不用随机数、不重试。
 * 不同 ⇒ **原样返回同一个引用**（不造无谓的改动，也就不占撤销栈）。
 *
 * 🔴 为什么结构改动会自动重排「学生看到的顺序」，而不是只提示一句、让教师自己去点「重新排列」：
 * 「两个顺序相同」是一个**学生什么都不做就满分**的状态，而它有一个不带任何提示的来路 ——
 * 删掉一个条目之后，剩下的两个列表可能刚好变得逐位相同
 *（实测的一个例子：`items=[b,a,c]` / `correctOrder=[a,c,b]`，删掉 `b` ⇒ 两边都是 `[a,c]`）。
 * ⇒ 与 `writeOptions` 的重编号同一条纪律：**每一次结构改动都要维持那道不变量**。
 * 重排是**看得见**的（「学生看到的顺序」那一行就在屏幕上），而服务端的 400 只有点保存之后才来。
 */
export function ensureOrderDistinct(items: ItemEntry[], correctOrder: string[]): ItemEntry[] {
  if (!isOrderAmbiguous(items, correctOrder)) return items;
  return [...items.slice(1), items[0]];
}

/**
 * 「重新排列」：重排 `items`，并**保证**结果不等于 `correctOrder`。
 *
 * 🔴 保证是必须的，不是谨慎：随机洗牌**有**可能洗出与正确答案一样的顺序
 * （2 个条目时是一半的概率），那一刻学生什么都不做就是满分，而屏幕上只是
 * 「顺序看起来没怎么变」—— 没有任何报错。
 * ⇒ Fisher–Yates 之后检查一次，相同就再洗（上限 20 次）；试不出来（例如只有一个条目、
 * 而正确答案就是它）就退回确定性的循环左移。
 * `random` 可注入：本仓前端没有别的回归网，这个保证只能靠用例钉住。
 */
export function shuffleOrderItems(
  items: ItemEntry[],
  correctOrder: string[],
  random: () => number = Math.random,
): ItemEntry[] {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const held = shuffled[index];
      shuffled[index] = shuffled[swap];
      shuffled[swap] = held;
    }
    if (!isOrderAmbiguous(shuffled, correctOrder)) return shuffled;
  }
  return ensureOrderDistinct(items, correctOrder);
}

/**
 * 「取当前顺序」：把屏幕上现在的顺序**定为正确答案**，同时把学生看到的顺序打乱。
 *
 * 🔴 两件事必须**一起**做，否则这个按钮产出的是一道**立刻无效**的题：
 * 答案取自 `items` ⇒ 两边逐位相同 ⇒ A1 Step 5 那条校验会拒绝它。
 * ⇒ 复用 `shuffleOrderItems`（它保证结果不同），于是点一下就得到一个能保存的状态。
 */
export function orderUseCurrentOrder(state: OrderData, random: () => number = Math.random): OrderData {
  // 🔴 **先把缺 id 的条目补上 id，再拿它们当答案键。** 反过来写会产出一个**点一次修不好**的状态：
  // 缺 id 的条目被读成空串 ⇒ 答案是 `['','']`；而写回时 `writeEntries` 给条目补了**全新的** id，
  // 所以 `correctOrder` 里那两个空串指不到任何条目 ⇒ 排列不成立 ⇒ 保存被 400 拦下，
  // 而界面上**看不出能怎么办** —— 那一行只显示「还没设置正确顺序」，教师得**再点一次**
  // 「取当前顺序」才拿到补好的 id。补 id 之后，答案键落在补好的那些 id 上 ——
  // 一次点击就得到一个合法的状态（`writeEntries` 那侧是幂等的）。
  //
  // ⚠️ 2026-09-24（C3）更正：这里原先写的是（逐字照抄 `a4b1a11`，只省掉中间那半句）
  //   「反过来写的后果是一处**死局**（审查者实测）：… ⇒ 排列不成立 ⇒ 保存被 400 拦下，
  //     而**屏幕上看不出能怎么办**（两行「这个条目已经被删掉了」）。」
  // **实测证伪** —— `readStringList` 丢空串 ⇒ 落库的 `["",""]` 读回界面是 `[]` ⇒
  // 老判据照样渲染那个按钮，所以它是「两次点击」而不是「死局」。真正会被藏掉按钮的是
  // `correctOrder` **非空但不合法**（见 `isOrderAnswerUsable`；「教师唯一的出路是删掉这道题」
  // 那句在 `order-body.tsx` 里，本文件从来没写过）。反转本行后的实测：9377e87 那一版要点 2 次。
  const items = ensureEntryIds(state.items);
  const correctOrder = items.map((entry) => entry.id);
  return { items: shuffleOrderItems(items, correctOrder, random), correctOrder };
}

/**
 * 「正确顺序」现在**能不能用** —— 即它正好是这些条目 id 的一个排列（服务端那条校验的判据）。
 *
 * `false` 的每一种来路都必须让界面**留着**一个重设它的入口（「取当前顺序」），
 * 否则教师会卡在一个**既存不下、又从界面上修不好**的僵局里，唯一出路是删掉这道题：
 *   · 还没配过（`correctOrder` 空）；
 *   · 条目**缺 id**（服务端会以「排序题里有条目缺少 id」拦下，任何 `correctOrder` 都救不了）；
 *   · 长度对不上 / 有重复 / 内容对不上（手工改过的行，或早先版本写进去的空串）。
 */
export function isOrderAnswerUsable(items: ItemEntry[], correctOrder: string[]): boolean {
  if (items.length < 2) return false;
  if (items.some((entry) => !entry.id)) return false;
  if (correctOrder.length !== items.length) return false;
  if (new Set(correctOrder).size !== correctOrder.length) return false;
  const ids = items.map((entry) => entry.id);
  return correctOrder.every((id) => ids.includes(id));
}

/**
 * 加一个条目：`items` 与 `correctOrder` **一起**变。
 *
 * ⚠️ `correctOrder` **还没配过**（空数组）时**不往里加**：那是「还没配答案」的中间态，
 * 往里塞一个 id 会让界面上那句「还没有设置正确顺序」的提示消失，而它其实仍然配不全
 *（服务端会以「正确顺序必须正好是这些条目各一次」拦下 —— 只是理由变得难懂）。
 * 已经配过时：新条目**追加在两个列表的末尾**（两个列表都追加同一个 id，
 * 「是否逐位相同」的结论不变），再兜一次 `ensureOrderDistinct`。
 */
export function orderAddItem(state: OrderData, text: string): OrderData {
  const entry: ItemEntry = { id: newItemId(), text };
  const nextCorrect = state.correctOrder.length === 0 ? state.correctOrder : [...state.correctOrder, entry.id];
  return { items: ensureOrderDistinct([...state.items, entry], nextCorrect), correctOrder: nextCorrect };
}

/**
 * 删一个条目（按**位置**，不是按 id：缺 id 的条目 id 是空串，按 id 删会一次删掉所有那种行）。
 * `items` 与 `correctOrder` 一起删 —— 留着它，服务端那句「正确顺序必须正好是这些条目各一次」
 * 会拦下整道题，而教师看到的只是一条他看不懂的红字。
 */
export function orderRemoveItem(state: OrderData, index: number): OrderData {
  const target = state.items[index];
  if (!target) return state;
  const nextItems = state.items.filter((_, itemIndex) => itemIndex !== index);
  // ⚠️ 按 id 过滤：id 是空串时 `correctOrder` 里本来就没有它（`readStringList` 丢掉空串）⇒ 不动。
  const nextCorrect = state.correctOrder.filter((entryId) => entryId !== target.id);
  return { items: ensureOrderDistinct(nextItems, nextCorrect), correctOrder: nextCorrect };
}

// —— 连线 ──────────────────────────────────────────────────────────────

export interface MatchData {
  left: ItemEntry[];
  right: ItemEntry[];
  pairs: PairEntry[];
}

/** 读连线题（教师侧叫 `pairs`，学生侧叫 `links` —— §12 的裁定，别写反）。 */
export function readMatch(node: WorksheetQuestionNode): MatchData {
  return {
    left: readEntries(node.data.left),
    right: readEntries(node.data.right),
    pairs: readPairs(node.data.pairs),
  };
}

/** 写回连线题。三个键**一起写**（左栏 + 右栏 + 答案）。 */
export function writeMatch(left: ItemEntry[], right: ItemEntry[], pairs: PairEntry[]): Record<string, unknown> {
  return { left: writeEntries(left), right: writeEntries(right), pairs };
}

/**
 * 设定一个左项的配对（`rightId` 传空串 = 清掉这一条）。
 *
 * 🔴 **同一个右项只能被一个左项占用**：重复连同一个右项时**旧的被顶掉**、不是并存 ——
 * 并存会让服务端的 `isCompleteMatching` 拒绝**整道题**（「必须把左栏每一项都连到
 * 右栏的一个不同项上」），而教师看到的只是两个下拉选着同一个值。
 * 那道题**一个学生都判不了分**，而看板上只表现为「正确率 0%」。
 *
 * ⚠️ D1 的 `src/lib/worksheet-drag.ts` 里有一个同名同义的 `setPair`（学生端**作答态**
 * 的 `links`）；这一个管教师侧的 `pairs`（**答案**）。两者各有回归网，别合并成一份 ——
 * 键名相同（`{leftId, rightId}`）是协议规定，不是它们是一回事。
 */
export function matchSetPair(pairs: PairEntry[], leftId: string, rightId: string): PairEntry[] {
  const kept = pairs.filter((pair) => pair.leftId !== leftId && pair.rightId !== rightId);
  return rightId ? [...kept, { leftId, rightId }] : kept;
}

/**
 * 给**第 `index` 个左项**配一个右项 —— 下拉的 `onChange` 整个逻辑在这里。
 *
 * 🔴 **先把缺 id 的条目的 id 补上，再配**（审查者实测的原始缺陷）：左项缺 id 时它是空串，
 * `matchSetPair(pairs, '', rightId)` 产出的那条配对会被 `readPairs`（以及服务端）
 * 按「leftId 为空即丢掉」过滤掉 —— 教师看到的是**下拉当场弹回「请选择」**，
 * 而他不知道自己做错了什么（那条配对本该正是他刚选的）。补 id 之后，这一次点击
 * 就把配对落在补好的 id 上，同一次提交里完成，屏幕上立刻显示他选的那一项。
 *
 * ⚠️ 与 `orderUseCurrentOrder` 同一个道理：**答案键必须在补完 id 之后才算得出来**。
 * ⚠️ 右栏也一起补（下拉的 `value` 是右项的 id，右栏缺 id 时它根本选不中 ——
 * 那个情形由界面显式画成一条禁用的选项说明怎么修，见 `match-body.tsx`）。
 */
export function matchPairLeftRow(state: MatchData, index: number, rightId: string): MatchData {
  const left = ensureEntryIds(state.left);
  const right = ensureEntryIds(state.right);
  const target = left[index];
  if (!target) return state;
  return { left, right, pairs: matchSetPair(state.pairs, target.id, rightId) };
}

/**
 * 加一组（左栏、右栏**各一个**）。
 *
 * ⚠️ 刻意不做「单独加一个左项」：服务端要求左右栏条数相同，而两个独立的「＋」按钮
 * 能产出的中间态里有一半是必然被拒的。加一组则让那条校验在界面上够不着。
 * ⚠️ 新左项**没有配对**（下拉显示「请选择」）—— 不替教师臆造一条连线。
 */
export function matchAddRow(state: MatchData): MatchData {
  return {
    left: [...state.left, { id: newItemId(), text: '' }],
    right: [...state.right, { id: newItemId(), text: '' }],
    pairs: state.pairs,
  };
}

/**
 * 删一组（左 i 与同位置的右 i），并清掉**任何一端**指向这两个 id 的配对。
 *
 * ⚠️ 那一对里的右项可能正是**另一个左项**的答案（配对与行位置无关）—— 那条配对会被一起
 * 清掉，教师会在那个下拉里看到它回到「请选择」。**代价如实记**：他要重新配一次。
 * 不清的代价更大：那条配对指向一个已经不存在的右项，服务端会拒绝**整道题**，一个学生都判不了。
 */
export function matchRemoveRow(state: MatchData, index: number): MatchData {
  const leftEntry = state.left[index];
  const rightEntry = state.right[index];
  if (!leftEntry || !rightEntry) return state;
  return {
    left: state.left.filter((_, itemIndex) => itemIndex !== index),
    right: state.right.filter((_, itemIndex) => itemIndex !== index),
    pairs: state.pairs.filter((pair) => pair.leftId !== leftEntry.id && pair.rightId !== rightEntry.id),
  };
}

// —— 归类 ──────────────────────────────────────────────────────────────

export interface CategorizeData {
  items: ItemEntry[];
  zones: ItemEntry[];
  placement: Record<string, string>;
}

/** 读归类题（`zones` 的文案键名是 `label`，不是 `text`）。 */
export function readCategorize(node: WorksheetQuestionNode): CategorizeData {
  return {
    items: readEntries(node.data.items),
    zones: readEntries(node.data.zones, 'label'),
    placement: readPlacement(node.data.placement),
  };
}

/** 写回归类题。三个键**一起写**（条目 + 框 + 答案）。 */
export function writeCategorize(
  items: ItemEntry[],
  zones: ItemEntry[],
  placement: Record<string, string>,
): Record<string, unknown> {
  return { items: writeEntries(items), zones: writeEntries(zones, 'label'), placement };
}

/** 把一个条目归到某个框（`zoneId` 传空串 = 取消归放）。**不改入参**。 */
export function placementSet(placement: Record<string, string>, itemId: string, zoneId: string): Record<string, string> {
  const next = { ...placement };
  if (zoneId) next[itemId] = zoneId;
  else delete next[itemId];
  return next;
}

/** 加一个条目。它**没有归放**（下拉显示「请选择」）—— 不替教师臆造一个框。 */
export function categorizeAddItem(state: CategorizeData, text: string): CategorizeData {
  return { ...state, items: [...state.items, { id: newItemId(), text }] };
}

/** 删一个条目（按位置），`placement` 里那一条一起删 —— 留着它就是一个指向不存在条目的键。 */
export function categorizeRemoveItem(state: CategorizeData, index: number): CategorizeData {
  const target = state.items[index];
  if (!target) return state;
  return {
    ...state,
    items: state.items.filter((_, itemIndex) => itemIndex !== index),
    placement: placementSet(state.placement, target.id, ''),
  };
}

/** 加一个框（`placement` 不受影响 —— 新框里本来就是空的）。 */
export function categorizeAddZone(state: CategorizeData, label: string): CategorizeData {
  return { ...state, zones: [...state.zones, { id: newZoneId(), text: label }] };
}

/**
 * 删一个框（按位置）。
 *
 * 🔴 指向它的 `placement` **必须一起清掉**：留着它，那个条目就永远落不到任何框里
 *（服务端那条「每个条目都必须落到一个框里」会拒绝**整道题**），而界面上那个条目
 * 还显示着「已经归到框二」—— 教师看不出问题在哪。清掉之后它回到「请选择」，重新选一个即可。
 */
export function categorizeRemoveZone(state: CategorizeData, index: number): CategorizeData {
  const target = state.zones[index];
  if (!target) return state;
  const nextPlacement: Record<string, string> = {};
  Object.entries(state.placement).forEach(([itemId, zoneId]) => {
    if (zoneId !== target.id) nextPlacement[itemId] = zoneId;
  });
  return { ...state, zones: state.zones.filter((_, zoneIndex) => zoneIndex !== index), placement: nextPlacement };
}

// ── 逐题分值（M4a，规格 §12 裁定 4 / 5）────────────────────────────────
//
// 这一组是**编辑器这一侧**的判据，服务端那三个函数（`normalizePointValue` /
// `normalizePoints` / `resolvePoints`）**不是**它们的对应物 —— 两边回答的是不同的问题：
//   · 服务端回答「这题**判分时**用哪两个数」（`resolvePoints`，只认落库后的形状）；
//   · 这里回答「教师**在屏幕上填了什么**、那个状态能不能保存」。
// ⚠️ 所以不要把一个搬到另一边去：服务端拿到的是**已经归一化过的** `points`，
// 那里不存在「半填」这个状态（`normalizePoints` 会把缺的那一端补成 `DEFAULT_POINTS`）。

/**
 * 输入框文本 → 分值。**三种结果必须分开**（`''` 与「填错了」不是一回事）：
 *   · `empty`   —— 空框。**这是一个有意义的取值**：留空 = 继承学习单级（裁定 4）。
 *   · `invalid` —— 填了东西但不是这一档的合法整数。界面要**当场**提示，
 *     不能等到保存时才报 —— 服务端的 `normalizePointValue` 对越界值**回落** `DEFAULT_POINTS`，
 *     保存照常成功，教师会以为自己填的数生效了。
 *   · `value`   —— 合法。
 *
 * 🔴 ★ M4a/I1：**两档的域不同，所以必须传 `field`**（`full` 是 `1..POINTS_MAX`、
 * `half` 是 `0..POINTS_MAX`）。`full = 0` 不是「0 分」而是「答对了却给 0 分」——
 * 学生端显示「暂未获得」，而教师抽屉读 `gradeState` ⇒ **绿 `✓ 答对`**。
 * 域的理由写在 `POINTS_FULL_MIN`（`src/lib/worksheet-questions.ts`）上。
 * ⚠️ 参数**没有默认值**是刻意的：默认成 `'half'` 会让「忘了传字段」的那一处静默接受 0，
 * 而这条路上「静默」正是要防的东西。
 *
 * ⚠️ **不用 `Number()`**（那个想法很容易顺手写下去）：`Number('')` 与 `Number('   ')` 是 `0`
 * （空框会变成一个合法的 0 分）、`Number('0x10')` 是 16、`Number('1e2')` 是 100、
 * `Number('7.5')` 是 7.5 —— 每一个都会把一个「不是分值」的输入变成一个合法分值，
 * 而教师在框里看到的明明是自己打的那串字。所以只认纯十进制数字串。
 */
export type ParsedPointInput = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'value'; value: number };

export function parsePointInput(raw: string, field: 'full' | 'half'): ParsedPointInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (!/^\d+$/.test(text)) return { kind: 'invalid' };
  const value = Number(text);
  if (value > POINTS_MAX) return { kind: 'invalid' };
  // ★ I1：只有「全对」那一档有下界（部分给分的 0 是合法的「不给部分分」）。
  if (field === 'full' && value < POINTS_FULL_MIN) return { kind: 'invalid' };
  return { kind: 'value', value };
}

/**
 * 这道题的逐题分值是不是**只填了一个**（`{ full: 7 }` / `{ half: 2 }`）。
 *
 * 两个字段都填 = 已单独配分；两个都没填 = 跟随学习单级；**只有一个**是编辑期的中间态，
 * 而它**不是一个能保存的状态** —— 理由见 `findPartialPoints`。
 */
/**
 * ★ 2026-09-25（教师裁定）：**这道题实际会不会判分**。
 *
 * 「选择题的答案设置非必须，可以不设答案，也就是不用给分」—— 于是「判不判分」不再只由
 * **题型**决定，还取决于**这一题有没有配答案**。
 *
 * 🔴 它存在的理由是界面那一半：一块「全对 1 / 部分给分 0」的分值行摆在一道**不判分**的题上，
 * 就是在告诉教师「这道题会算分」—— 而它不会。服务端那一半（校验器放行 + 判分器回 `null`）
 * 在 `server/src/tests/worksheet-ungraded.test.ts`。
 *
 * ⚠️ **只有选择题那一族（单选 / 判断 / 多选）的答案在 `correctKeys` 里。** 填空 / 排序 /
 * 连线 / 归类的答案在 `data` 的别的键上，而且**由校验器强制要求** ⇒ 它们永远到不了
 * 「没答案」这个状态。所以这里**只对那一族查 `correctKeys`** —— 拿它去量那四种会把它们
 * 全判成「不判分」，症状是分值行从这四种题上**整片消失**（教师再也改不了分值）。
 */
/**
 * **题型本身**判不判分 —— 读 `QUESTION_TYPE_OPTIONS` 的 `graded` 那一格（那**唯一真源**）。
 *
 * ⚠️ 与学生端抽屉的 `isGradedType`（`worksheet-drawer-state.ts`）是**同一格的两个读者**，
 * 不是两份真源：两处都从 `graded` 派生，行为不可能分叉。
 * ⚠️ 与 `gradesOnSubmit` 的区别：这个只看**题型**，那个还看**这一题有没有配答案**。
 */
export function isGradedQuestionType(type: string): boolean {
  const option = QUESTION_TYPE_OPTIONS.filter((item) => item.value === type)[0];
  return option?.graded === true;
}

/**
 * ★ 2026-09-26：**哪些题型会给部分分** —— 判分器里真会返回 `partial` 的那五个。
 *
 * 🔴 它是一条**判据**（决定「判分依据」那一行画不画），所以住在核心里而不是 JSX 里：
 * 一道单选 / 判断题**永远拿不到部分分**（`judgeSingleChoice` 只有对与错），
 * 给它画一行「部分给分怎么算」是**一句谎话**。问答 / 绘图连判分都没有，更不画。
 * ⚠️ 与 `QUESTION_TYPE_OPTIONS` 的 `graded` **不是同一件事**：那一格是「判不判分」，
 * 这一条是「判不判得出部分对」—— 五个题型两者皆是，单选/判断只有前者。
 */
const PARTIAL_TYPES: readonly string[] = ['multi-choice', 'fill-blank', 'order', 'match', 'categorize'];

export function canGivePartial(type: string): boolean {
  return PARTIAL_TYPES.includes(type);
}

/**
 * ★ 2026-09-27（教师）：「判断题不存在部分正确，和单选一样，所以得分规则要改。」
 *
 * **「得分规则」那一块里到底画不画「部分正确」那一栏。**
 *
 * 🔴 改之前 `PointsRow` 用的判据是 `!isChoice`（`isChoice` 只认单选 / 多选）⇒
 * **判断题落进了「不是选择题」那一支**，跟排序 / 连线 / 归类一样拿到了两栏。
 * 而判断题走的是 `judgeSingleChoice`：只有对与错两态、永远返回不了 `partial`
 * ⇒ 那一栏是**一句谎话** —— 教师填进去的分值任何学生都拿不到，且没有任何报错。
 *（同一个文件里的 `canGivePartial` 早就写着「单选 / 判断**永远拿不到部分分**」，
 *  两处判据打架。）
 *
 * ⚠️ **填空也没有这一栏**：它的「得分规则」是 `FillPointsRow`（每空得分 / 整题总分），
 * 从头到尾只有一格。
 * ⚠️ 多选那一档与服务端 `allowsMissing` 逐字一致（只认 `'allow-missing'`）——
 * 认不出的值一律按「全对才算」，否则会给一个服务端并不认的档画出输入框。
 *
 * 🔴 **它是一条「那一栏画不画」的判据，所以在所有读 `points.half` 的地方都必须是同一个**：
 *   · `PointsRow`                —— 画不画那一格（以及那两条指着它的红字）；
 *   · `findPartialPoints`        —— 半填拦保存；
 *   · `findInvalidPoints`        —— 越界值拦保存；
 *   · `findUncommittedPointInput` —— 屏幕上那段没进 reducer 的文本拦保存。
 * 后三条的形态都是「拦下 → 让教师到那一栏去改」，所以它们的**前提**是那一栏真的在屏幕上；
 * 不成立的题型上拦下来的后果是一个**死锁**：保存永久失败，而教师**没有任何地方**能改那个值，
 * 屏幕上那条红字还指着两个并不存在的框。旧草稿与手工改过的库行都能造出这个状态
 *（`findUncommittedPointInput` 那条还多一条**可达**的路：多选从「漏选给分」切回「全对才得分」）。
 */
export function showsPartialPoints(node: WorksheetQuestionNode): boolean {
  if (node.type === 'fill-blank' || node.type === 'choice-blank') return false;
  if (!canGivePartial(node.type)) return false;
  if (isChoiceQuestion(node)) return isMultipleChoice(node) && node.data.partialCredit === 'allow-missing';
  return true;
}

export function gradesOnSubmit(node: WorksheetQuestionNode): boolean {
  // ★ 2026-09-25（教师最终裁定）：判不判分**只看那个开关**，不再以「有没有答案」推断。
  // ⚠️ 上一版（同一个下午）是 `isChoice ? readCorrectKeys(node).length > 0 : true` ——
  // 教师随后要求「加一个开关，选允许则要求设置答案」⇒ 两条路留着会有两个来源，
  // 而「有答案却不判分」在他关掉开关时是**正常状态**，推断不出来。
  return isGradedQuestionType(node.type) && node.autoGrade !== false;
}

/**
 * 读一道题的**容错档**（与 `points` 同一条容错口径）。
 * 返回 `null` = **缺省**＝旧规则「只要有一部分对就给分」。
 */
export function toleranceOf(node: WorksheetQuestionNode): number | null {
  const raw = node.partialTolerance;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return null;
  return raw;
}

/**
 * ★ 2026-09-26（spec 第 2 步）：**折叠态那一行**要显示的分值。
 *
 * 逐题优先，`points` 被清空时用默认档。⚠️ 与判分那侧的 `resolvePoints(node, DEFAULT_POINTS)`
 * 是**同一把尺子**（服务端迁移之后逐题分值恒存在，清空是编辑期的中间态）。
 *
 * ⚠️ 不要拿 `effectiveHalfStep` 来拼这一行：它半填时回 `null`（「说不准」），
 * 那是给**警告条**用的判据；而折叠态那一行**必须**显示一个数（显示 `—` 会更让人困惑）。
 */
export function displayPoints(
  node: WorksheetQuestionNode,
  fallback: { full: number; half: number },
): { full: number; half: number } {
  return { full: node.points?.full ?? fallback.full, half: node.points?.half ?? fallback.half };
}

/**
 * ★ 2026-09-26（spec 第 4 步）：一组题的**小题数**与**满分合计**。
 *
 * 两处用它：**页面头**（这份单几道题、满分多少）与**任务容器头**（这一组几道题、满分多少）
 * ——「一屏看全局」是工具与表单的分界，而这两个数是那个「全局」里最常被问的。
 *
 * 🔴 **只数「会判分的题」的满分**：不判分的题（问答 / 绘图 / 关掉了自动评分的）给不出分，
 * 把它们算进满分会让这个数**比学生实际能拿到的分大** —— 而教师会用这个数去分配课堂时间。
 * ⚠️ `questions` 数的是**可作答的题**（与看板、抽屉、导出同一份口径，见 `flattenAnswerable`）：
 * 任务不是题，它不该进这个数。
 * ⚠️ 分值的来源是 `displayPoints`（逐题优先、清空时默认档），与判分那侧同一把尺子。
 */
export function scoreSummary(
  nodes: WorksheetQuestionNode[],
  fallback: { full: number; half: number },
): { questions: number; maxScore: number } {
  const items = flattenAnswerable(nodes);
  let maxScore = 0;
  for (const { node } of items) {
    if (!gradesOnSubmit(node)) continue;
    const full = displayPoints(node, fallback).full;
    const slots = (node.type === 'fill-blank' || node.type === 'choice-blank') && node.data.fillScoring === 'per-blank'
      ? blankCount(readPromptRuns(node.data.promptRuns, node.prompt))
      : 1;
    maxScore += full * slots;
  }
  return { questions: items.length, maxScore };
}

/**
 * ★ 2026-09-26（spec 第 5 步，拖拽）：**指针落在第几行之前**。
 *
 * 入参是每一行**同层**的矩形（`top` / `height`，屏幕坐标即可），返回值是插入下标
 * （`0..rows.length`）。判据是**行的中线**：指针在某一行的上半 ⇒ 插到它前面，
 * 下半 ⇒ 插到它后面 —— 那是「一条线」的直觉，也是所有列表拖拽的通用做法。
 *
 * ⚠️ 它只算**位置**，不判合法性：同层才能拖（跨层的拖拽在 `editorRenderRows` 那一侧
 * 就没有落点可言，见 `canDropInLayer`）。
 * ⚠️ 空列表 ⇒ `0`；坏矩形（`height <= 0`）当零高处理，不会抛。
 */
export function dropIndexAt(rows: Array<{ top: number; height: number }>, pointerY: number): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (pointerY < row.top + row.height / 2) return index;
  }
  return rows.length;
}

/**
 * ★ 2026-09-26：**这两个能不能互换位置** —— 同层才行。
 *
 * 🔴 分层的理由与 `moveInTree` 逐字相同：一道题从「任务一」拖进「任务二」是**换组**，
 * 而换组还有一整套没表态的问题（题号重排、答案的归属、绑定关系）。
 * 「拖动排序」这一步只做**同层排序** —— 跨层留给一条明确的裁定。
 */
export function canReorder(
  nodes: WorksheetQuestionNode[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return false;
  const layerOf = (id: string, list: WorksheetQuestionNode[]): WorksheetQuestionNode[] | null => {
    if (list.some((node) => node.id === id)) return list;
    for (const node of list) {
      const found = layerOf(id, kidsOf(node));
      if (found) return found;
    }
    return null;
  };
  const sourceLayer = layerOf(sourceId, nodes);
  const targetLayer = layerOf(targetId, nodes);
  return sourceLayer !== null && sourceLayer === targetLayer;
}

export function isPartialPoints(points: QuestionPointsDraft | undefined): boolean {
  if (!points) return false;
  return (points.full === undefined) !== (points.half === undefined);
}

/**
 * 逐题分值那两格的**文本签名** —— 「这段输入还是不是当前这一题、这两个值的样子」。
 *
 * 🔴 它存在的唯一理由是：编辑器允许屏幕上存在**还没进 reducer** 的文本
 * （教师打了一半、或打了一个非法值，见 `PointsRow` 的 `rejected`）。那段文本要能
 * ① 在 `node.points` 变化时自动失效（撤销 / 恢复草稿 / 换题），② 被 `save()` 看见。
 * 两处用**同一个**签名算法是 ② 不落空的前提 —— 各写一份就会「组件认为它还有效、
 * 而 `save()` 认为它已经失效」（或反过来），而两者都不会报错。
 */
export function pointsSignature(node: WorksheetQuestionNode): string {
  const full = node.points?.full === undefined ? '' : String(node.points.full);
  const half = node.points?.half === undefined ? '' : String(node.points.half);
  return `${node.id}:${full}/${half}`;
}

/** `points` 里那一格的文本（`undefined` ⇒ 空串 = 没填）。半填靠它渲染出来。 */
export function pointText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * 教师动了某一格之后该做什么 —— `PointsRow` 的 `onChange` 整个逻辑都在这里。
 *
 * 🔴 **它必须在内核里**（而不是留在组件里）：这条路上有两个「错了不报错」的坑，
 * 而组件没有回归网：
 *   1. 非法文本只记**刚动的那一格** ⇒ 另一格里还没提交的文本被 `node.points` 顶掉，
 *      教师没碰那个框、字却没了（2026-09-24 审查实测的原始 bug）；
 *   2. 合法时忘了把另一格的值一起算进来 ⇒ 半填 / 覆盖的次序一错，落库的值就与屏幕不符。
 * ⇒ 两格一起算、非法时**两格都记**，这里一条路走完。
 */
export function planPointInputChange(
  node: WorksheetQuestionNode,
  which: 'full' | 'half',
  raw: string,
  currentInput: RejectedPointInput | undefined,
): { kind: 'rejected'; input: RejectedPointInput } | { kind: 'commit'; points: QuestionPointsDraft | undefined } {
  const signature = pointsSignature(node);
  // 签名不匹配 ⇒ 那段输入是上一份内容留下的，已经作废（撤销 / 恢复草稿 / 换题之后）。
  const shown = currentInput && currentInput.signature === signature ? currentInput : undefined;
  const nextFull = which === 'full' ? raw : (shown?.full ?? pointText(node.points?.full));
  const nextHalf = which === 'half' ? raw : (shown?.half ?? pointText(node.points?.half));

  const full = parsePointInput(nextFull, 'full');
  const half = parsePointInput(nextHalf, 'half');
  if (full.kind === 'invalid' || half.kind === 'invalid') {
    // 🔴 **两格都记**，不只是刚动的那一格 —— 见上面的坑 1。
    return { kind: 'rejected', input: { signature, full: nextFull, half: nextHalf } };
  }

  // ⚠️ 半填要**如实**交出去（不能因为「另一端还没填」就不提交）—— 否则教师刚打的那个字
  // 会被下一次渲染吞掉（输入框的值是从 `node.points` 算出来的）。
  const points: QuestionPointsDraft = {};
  if (full.kind === 'value') points.full = full.value;
  if (half.kind === 'value') points.half = half.value;
  return {
    kind: 'commit',
    points: points.full === undefined && points.half === undefined ? undefined : points,
  };
}

/** 屏幕上**还没进 reducer** 的那两格文本（按题 id 存）。`undefined` 的字段 = 那一格没被拒过。 */
export interface RejectedPointInput {
  /** `pointsSignature(node)` 在当时的值 —— 不匹配就整条失效。 */
  signature: string;
  full?: string;
  half?: string;
}

/** 哪一格。`both` 只在拼文案时用得上。 */
export type PointField = 'full' | 'half' | 'both';

export function describeWhich(which: PointField): string {
  if (which === 'both') return '全对与部分给分';
  return which === 'full' ? '全对' : '部分给分';
}

/**
 * 把 `Array<{heading, which}>` 拼成「任务一 · 2 的全对、3 的全对与部分给分」。
 *
 * ★ 2026-09-25：`index`（数组下标 +1）换成 **`heading`（两级题号）** —— 与 R7 同一条：
 * 题号一律裸显示。原来那句「第 N 题」在有任务之后会**指错题**（任务节点占了顶层的一个位置）。
 */
export function describePoints(items: Array<{ heading: string; which: PointField }>): string {
  return items.map((item) => `${item.heading} 的${describeWhich(item.which)}`).join('、');
}

/**
 * 这个数**能不能当分值落库**（编辑期的判据）。
 *
 * 🔴 它比服务端的 `isUsablePointValue` **更严**，这个差异是**有意的**，别「统一」：
 *   · 服务端那个用 `Math.round`，所以 `7.5` 算有效（⇒ 8）—— 它的入参是**库里的 JSON**，
 *     可能来自手工改过的行或将来的批量工具；
 *   · 这里要求**整数**，因为输入框那一侧的判据（`parsePointInput`）就不接受小数 ——
 *     让一个屏幕上根本打不出来的值悄悄落库，等于界面与服务端两套规则。
 *
 * 🔴 ★ M4a/I1：**它现在是 `parsePointInput` 的一层薄封装，不自己写判据。**
 * 原先它自己抄了一份 `Number.isInteger(value) && value >= 0 && value <= POINTS_MAX`
 * ——两档的域一变，两处就得各改一次，而**漏改一处不会红**（2026-09-24 的反证实测：
 * 只把 `parsePointInput` 的全对下界去掉时，`findInvalidPoints` 那条用例**仍然全绿**，
 * 因为库里那份走的是这个复制品）。走 `String(value)` 把数变回文本、交给同一个判据，
 * 「屏幕上打不出来的值不许落库」就只剩一处实现。
 * 逐条对照（实测）：`7.5` / `-1` / `200` / `NaN` / `Infinity` / `0.4` 都非法；
 * `0` 只在 `half` 合法；`undefined` 表示「这一格没填」⇒ 不算非法。
 */
function isValidPointNumber(value: number | undefined, field: 'full' | 'half'): boolean {
  if (value === undefined) return true;
  return parsePointInput(String(value), field).kind === 'value';
}

/**
 * 🔴 **`points` 里已经有一个不是合法分值的题**（顶层）—— 与 `findPartialPoints`
 * 并列，由 `save()` 拦下。
 *
 * 它拦的是**库里那一份**（`content`）。编辑器的输入路径产生不了这种值
 * （`parsePointInput` 会把小数 / 越界 / 十六进制都拒掉），所以命中它的只有**手工改过的库行**。
 *
 * ⚠️ 不拦的后果是**静默改写**：服务端的 `normalizePointValue` 对越界值**回落**
 * `DEFAULT_POINTS`（`full: 200` ⇒ `1`），保存照常 200，而卡片上还写着 200 ——
 * 教师没有任何办法知道他的分数已经变成了 1。
 *
 * ⚠️ ★ M4a/I1：`full: 0` 现在也在这里被拦（域是 `1..99`）。它的后果与越界值不同 ——
 * 不是「静默变成 1」而是**服务端 400**（那一侧也拒收），所以拦住它同时是
 * 「别让教师点了保存才看到一句报错」。
 *
 * ⚠️ 与 `findPartialPoints` 一样**只看顶层**（嵌套里的题教师看不见也改不了，
 * 拦了会让保存按钮废掉）。
 */
export function findInvalidPoints(content: WorksheetContent): Array<{ id: string; heading: string; which: PointField }> {
  const found: Array<{ id: string; heading: string; which: PointField }> = [];
  answerableOf(content).forEach(({ node, heading }) => {
    const points = node.points;
    if (!points) return;
    const fullBad = !isValidPointNumber(points.full, 'full');
    // ★ 2026-09-27：`half` 只在**那一栏真画得出来**的题型上查 —— 见 `showsPartialPoints`。
    // 那道红字说的是「请改一下」，而那一栏不画的话教师改不了（这一条命中的又只有手工改过的库行，
    // 于是症状正好是「红字指着一个不存在的框、保存点不动」）。
    const halfBad = showsPartialPoints(node) && !isValidPointNumber(points.half, 'half');
    if (!fullBad && !halfBad) return;
    found.push({ id: node.id, heading, which: fullBad && halfBad ? 'both' : fullBad ? 'full' : 'half' });
  });
  return found;
}

/**
 * 🔴 **屏幕上有一段还没进 reducer 的非法文本**的题 —— `save()` 的第三条拦阻。
 *
 * 为什么必须有它（2026-09-24 审查实机复现）：教师把全对填成 `7.5`，框里**明明白白写着
 * `7.5`**，那串字却因为非法而没进 reducer（`points` 只装整数）⇒ 点保存发出的是**上一次的
 * 合法值** `4` ⇒ 顶栏显示「已保存」，而框里还是 `7.5`。**界面在说假话，且没有任何报错。**
 *
 * ⇒ 只提示是不够的（brief Step 1 的「非整数即时提示」讲的是**不要拖到保存才报**，
 * 不是「不许拦」）。所以：**没提交的非法文本同样拦住保存。**
 *
 * ⚠️ 判据要连签名一起比：`rejected` 里那一段文本只有在 **`signature` 仍然等于当前节点**
 * 时才作数 —— 撤销 / 恢复草稿 / 换题之后 `node.points` 会变，那串文本就作废了
 * （否则教师撤销之后还会被一段早已不存在的文本拦住）。
 *
 * ⚠️ `rejected` 里**合法的**那一格不构成拦阻：教师可能在全对留着一格非法文本的同时
 * 把部分给分改成了合法值，而那一格只在整题提交时才有意义（见 `PointsRow` 的 `commit`）。
 */
export function findUncommittedPointInput(
  content: WorksheetContent,
  rejected: Record<string, RejectedPointInput>,
): Array<{ id: string; heading: string; which: PointField }> {
  const found: Array<{ id: string; heading: string; which: PointField }> = [];
  answerableOf(content).forEach(({ node, heading }) => {
    const entry = rejected[node.id];
    if (!entry || entry.signature !== pointsSignature(node)) return;
    // ⚠️ 两格的域不同（`full` 是 1..99），所以按格传 `field` —— 与 `parsePointInput` 同一个判据。
    const fullBad = entry.full !== undefined && parsePointInput(entry.full, 'full').kind === 'invalid';
    // ★ 2026-09-27：`half` 那一格同理（见 `showsPartialPoints`）。这条路是**可达**的：
    // 多选题上打了半截非法文本（没进 reducer，只留在 `rejectedInput`）→ 教师把评分方式
    // 切回「全对才得分」⇒ 那一栏消失、那段文本还在 ⇒ 不挡的话保存**永久失败**。
    const halfBad = showsPartialPoints(node) && entry.half !== undefined && parsePointInput(entry.half, 'half').kind === 'invalid';
    if (!fullBad && !halfBad) return;
    found.push({ id: node.id, heading, which: fullBad && halfBad ? 'both' : fullBad ? 'full' : 'half' });
  });
  return found;
}

/**
 * 🔴 **只填了一个框**的题（可作答的题，按屏幕顺序）—— `save()` 用它拦下保存。
 *
 * 为什么必须拦（2026-09-24 实测，A2 审查带出）：服务端的 `normalizePoints` 对
 * 「只填了一端」的处理是**用 `DEFAULT_POINTS` 补另一端**（全对 1 / 部分给分 0），
 * **不是**用学习单级的档。于是「学习单级 `{full:3, half:2}` + 这道题 `points:{full:7}`」
 * 在判分时部分给分得 **0 分**，而教师以为自己只是把全对调成了 7、部分给分还在跟随学习单。
 *
 * 实测（隔离库 + 真实 `POST /api/worksheets`，载荷 `points: {full: 7}`）：
 * 回包与库里的都是 `points: {full: 7, half: 0}` —— **`half` 被补齐成了 0，不是缺席**。
 * ⇒ 「改 `resolvePoints` 为逐字段回落」那条路**修不了这个**：库里那个 `half: 0` 是一个
 * 有效分值，逐字段回落会照用它。**这才是这里必须拦、而不是去改判分的原因。**
 *
 * ⚠️ **原来只看顶层**，理由逐字是「编辑器的题流只渲染顶层…嵌套里的题教师看不见也改不了，
 * 拦下保存会让他卡死在一个无法修复的错误上」。**那个理由在第 2 步的迁移之后失效了**：
 * 库里的题都在任务里，而编辑页现在把它们画出来也改得动 ⇒ 拦下是对的，改回递归。
 *
 * 返回 `heading` 是**两级题号**（`任务一 · 2`）—— 与看板 / 抽屉 / 导出 / 分析载荷同一份。
 *
 * 🔴 ★ 2026-09-27：**只拦「真会画出「部分正确」那一栏」的题**（`showsPartialPoints`）。
 *
 * 这条闸门的形态是「拦下 → 让教师到那一栏去改」，所以它有一个**前提**：那一栏真的在屏幕上。
 * 不成立的题型上（判断题 / 单选 / 问答 / 绘图，以及只有一格的填空）拦下的后果是一个**死锁**：
 * 保存永久失败，而教师**没有任何地方**能改那个值 —— 屏幕上那条红字还指着两个并不存在的框。
 * （改之前它们走不到**死锁**那一步 —— 那一栏画得出来，教师改得动。判断题这一栏
 *   2026-09-27 被拿掉之后，旧草稿与手工改过的库行立刻能把它撞出来。）
 */
export function findPartialPoints(content: WorksheetContent): Array<{ id: string; heading: string }> {
  const found: Array<{ id: string; heading: string }> = [];
  answerableOf(content).forEach(({ node, heading }) => {
    if (showsPartialPoints(node) && isPartialPoints(node.points)) found.push({ id: node.id, heading });
  });
  return found;
}

/**
 * 这道题**实际会用到的部分给分档**；`null` = **说不准**（调用方据此不判断）。
 *
 * 只有两种情形说得准（能保存的状态下）：
 *   · 逐题填了（两端齐全）⇒ 用它那个数；
 *   · 逐题留空（或 `{}` —— 服务端 `normalizePoints({})` 也回 `undefined`，同义）⇒ 用学习单级的。
 */
export function effectiveHalfStep(
  node: WorksheetQuestionNode,
  inherited: { full: number; half: number },
): number | null {
  const points = node.points;
  // ⚠️ **半填（只填了一个字段）⇒ 说不准**，`{ half: 0 }` 与 `{ full: 7 }` 都算。
  // 2026-09-24 修：这里原来只挡住了「部分给分为空」那一半（`points.half === undefined`），
  // 于是 `{ half: 0 }` 会走下面那一支算出 0 ⇒ 返回 true，与本函数文档说的「半填不判断」
  // 矛盾。今天够不着（编辑器还写不出多选），但 C2 补上多选编辑体之后，
  // 教师在多选卡上先填部分给分 0、还没填全对时，同一张卡会同时挂两条红字 ——
  // 正是 `shouldWarnZeroHalfCredit` 要避免的情形。
  if (points && isPartialPoints(points)) return null;
  if (!points || points.half === undefined) return inherited.half;
  return points.half;
}

/**
 * 🔴 规格 §12 裁定 3 的**连带要求**：教师给多选题选了「漏选算部分给分」、而部分给分档是 **0** 时，
 * 界面必须说一句 —— 否则他以为自己开了部分得分，而学生**一分都拿不到**，且没有任何报错。
 *
 * 判据是「**这题实际会用到的部分给分档**」（`effectiveHalfStep`）。
 *
 * ⚠️ **半填时返回 `false`（不提示）**，`{ full: 7 }` 与 `{ half: 0 }` **都是**：半填的题
 * 已经被 `findPartialPoints` 拦下、根本存不进去，而它自己那条「两个框要么都填」的提示
 * 更靠前 —— 一张卡片上同时挂两条红字只会让教师不知道先看哪条。（也正因为如此，这里
 * **不**去模拟服务端「半填补 0」的行为：那要再抄一份 `DEFAULT_POINTS`，而它在这条路上
 * 永远不会被用到。）
 */
export function shouldWarnZeroHalfCredit(
  node: WorksheetQuestionNode,
  inherited: { full: number; half: number },
): boolean {
  if (node.type !== 'multi-choice') return false;
  if (node.data.partialCredit !== 'allow-missing') return false;
  return effectiveHalfStep(node, inherited) === 0;
}

/**
 * 递归地把树里**每一个**节点过一遍 `fn`（**孩子先、自己后**）。
 * 没变就**原对象返回** —— 与 `mapTree` 同一条纪律（不制造假变化）。
 */
function mapAll(
  nodes: WorksheetQuestionNode[],
  fn: (node: WorksheetQuestionNode) => WorksheetQuestionNode,
): WorksheetQuestionNode[] {
  let touched = false;
  const next = nodes.map((node) => {
    let current = node;
    const kids = kidsOf(node);
    if (kids.length > 0) {
      const nextKids = mapAll(kids, fn);
      if (nextKids !== kids) {
        current = { ...node, children: nextKids };
        touched = true;
      }
    }
    const out = fn(current);
    if (out !== current) touched = true;
    return out;
  });
  return touched ? next : nodes;
}

/**
 * 这份 `content` 里**可作答的题**及它们的**两级题号**。
 *
 * 🔴 保存路径上的四个判据（`sanitizeContentForSave` / `findInvalidPoints` /
 * `findPartialPoints` / `findUncommittedPointInput`）原先一律 `content.nodes.forEach` ——
 * **只认顶层**。它们当时的注释逐字写着「编辑器的题流只渲染顶层（第一批没有容器编辑 UI），
 * 嵌套里的题教师**看不见也改不了**，拦下保存会让他卡死在一个无法修复的错误上」。
 * 那个理由在第 2 步的迁移之后**不成立**：库里每一道题都在任务里，而编辑页现在把它们
 * 画出来也改得动。⇒ 四个判据全部跟上来，且文案里的指代改用**两级题号**
 *（与看板 / 抽屉 / 导出 / 分析载荷同一份，见 `lib/worksheet-questions.ts`）。
 */
function answerableOf(content: WorksheetContent): Array<{ node: WorksheetQuestionNode; heading: string }> {
  return flattenAnswerable(content.nodes);
}

/**
 * 树里某个节点的孩子。**非数组一律当没有孩子** —— 与 `flattenQuestions` /
 * `flattenAnswerable` 同一条守卫（一行手改过的数据不该让编辑页整个炸掉）。
 */
function kidsOf(node: WorksheetQuestionNode): WorksheetQuestionNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

/**
 * 在题目树里把 `id` 那个节点按 `transform` 换掉 —— **递归**，任务里的小题同样找得到。
 *
 * 🔴 原实现只 `map` 顶层 `nodes`（它的注释原话是「只动**顶层** `nodes`…将来加容器时再说」）。
 * 第 2 步的迁移把库里的题**都**包进了任务之后，那个「将来」就到了：只认顶层 =
 * 任务里的小题**一个字都改不动**，而且因为是静默返回原对象，**连撤销栈都不进** ——
 * 教师按下去什么也没发生，也没有任何报错。
 *
 * ⚠️ 没命中（或 `transform` 返回原对象）就**原对象返回**，免得制造一条空的历史
 *（与 `updatePrompt` 的「同值去重」是同一条纪律）。
 * ⚠️ 只重建**走到的那条路径**：兄弟节点与别的任务整棵照搬（有用例钉着）。
 */
function mapTree(
  nodes: WorksheetQuestionNode[],
  id: string,
  transform: (node: WorksheetQuestionNode) => WorksheetQuestionNode,
): WorksheetQuestionNode[] {
  let touched = false;
  const next = nodes.map((node) => {
    if (node.id === id) {
      const replaced = transform(node);
      if (replaced !== node) touched = true;
      return replaced;
    }
    const kids = kidsOf(node);
    if (kids.length === 0) return node;
    const nextKids = mapTree(kids, id, transform);
    if (nextKids === kids) return node;
    touched = true;
    return { ...node, children: nextKids };
  });
  return touched ? next : nodes;
}

/** 树里替换一个节点（顶层或任务内）。没命中就**返回原对象**。 */
function replaceNode(
  content: WorksheetContent,
  id: string,
  transform: (node: WorksheetQuestionNode) => WorksheetQuestionNode,
): WorksheetContent {
  const nodes = mapTree(content.nodes, id, transform);
  return nodes === content.nodes ? content : { ...content, nodes };
}

/**
 * 在**同层内**把 `id` 那个节点挪 `delta` 位。
 *
 * ⚠️ 只在它**所在的那一层**里换位：任务内的小题上移下移不该跨出任务、也不该把它挪到任务外面
 *（与「删一道小题」同一条边界）。越界 ⇒ 原样返回（不制造历史）。
 */
function moveInTree(
  nodes: WorksheetQuestionNode[],
  id: string,
  delta: -1 | 1,
): WorksheetQuestionNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = index + delta;
    if (target < 0 || target >= nodes.length) return nodes;
    const next = nodes.slice();
    next[index] = nodes[target];
    next[target] = nodes[index];
    return next;
  }
  let touched = false;
  const next = nodes.map((node) => {
    const kids = kidsOf(node);
    if (kids.length === 0) return node;
    const nextKids = moveInTree(kids, id, delta);
    if (nextKids === kids) return node;
    touched = true;
    return { ...node, children: nextKids };
  });
  return touched ? next : nodes;
}

/**
 * 把 `id` 挪到**它所在那一层**的第 `toIndex` 位（拖拽落点用；与 `moveInTree` 同一条边界：
 * 只在本层内）。
 *
 * ⚠️ `toIndex` 是**挪过去之后**的下标（0-based，允许等于层长度 = 挪到末尾）。
 * 越界 / 找不到 / 原地不动 ⇒ **原对象返回**（不制造历史）。
 */
function reorderInTree(nodes: WorksheetQuestionNode[], id: string, toIndex: number): WorksheetQuestionNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = Math.max(0, Math.min(toIndex, nodes.length - 1));
    if (target === index) return nodes;
    const next = nodes.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
  }
  let touched = false;
  const next = nodes.map((node) => {
    const kids = kidsOf(node);
    if (kids.length === 0) return node;
    const nextKids = reorderInTree(kids, id, toIndex);
    if (nextKids === kids) return node;
    touched = true;
    return { ...node, children: nextKids };
  });
  return touched ? next : nodes;
}

/**
 * 从树里删掉 `id` 那个节点（含它的整棵子树）。
 *
 * 🔴 任务那个节点**可以被删** —— 删它 = 删掉它和它的全部小题。
 * 原来的顶层 `filter` 只删得到顶层节点，而迁移之后顶层往往**只有一个任务**
 * ⇒ 删它就把整份学习单清空了（终审 C1）。
 */
function removeFromTree(nodes: WorksheetQuestionNode[], id: string): WorksheetQuestionNode[] {
  const filtered = nodes.filter((node) => node.id !== id);
  if (filtered.length !== nodes.length) return filtered;
  let touched = false;
  const next = nodes.map((node) => {
    const kids = kidsOf(node);
    if (kids.length === 0) return node;
    const nextKids = removeFromTree(kids, id);
    if (nextKids === kids) return node;
    touched = true;
    return { ...node, children: nextKids };
  });
  return touched ? next : nodes;
}

/**
 * ★ 2026-09-25（第二轮终审 F2/F3）：编辑页**要渲染的行** —— 一个纯函数给出。
 *
 * 🔴 它存在的理由有两条，都是终审抓出来的：
 *
 * 1. **渲染深度必须等于判据深度。** 三个拦阻保存的判据（`findInvalidPoints` /
 *    `findPartialPoints` / `findUncommittedPointInput`）经 `answerableOf` 递归**任意深**，
 *    而界面原先只画「顶层 + 任务里的小题」。于是一道**深度 ≥2** 的题（散题带 `children`，
 *    只有手改过的库能造出来）带半填的分值 ⇒ **保存被永久拦下**，而报错里那个题号在界面上
 *    找不到、也改不了（唯一出路是删掉它的父题，等于连坐删掉整棵子树）——
 *    正是旧注释当年担心的「卡在一个修不了的错误上」，只是换了个来路。
 *    ⇒ 两边的覆盖由**同一个规则**给出：这里按 `flattenAnswerable` 的同一套 DFS 展开。
 *
 * 2. **题号必须只有一份。** 卡片上原先显示「容器内下标 + 1」，而保存报错、看板列头、
 *    抽屉、导出用的都是两级题号 ⇒ 两个任务时同屏有**两张「第 1 题」**，保存失败说
 *    「任务二 · 1 的分值只填了一个框」而教师得在两处「第 1 题」之间猜。
 *
 * ⚠️ `index` / `total` 是**同层**的位置与个数 —— ▲▼ 的边界判据吃的是它
 *（换位是**同层内**的，见 `moveInTree`），与显示用的 `heading` 是两件事。
 */
export type EditorRow =
  | { kind: 'task'; node: WorksheetQuestionNode; index: number; total: number }
  | {
    kind: 'question';
    node: WorksheetQuestionNode;
    /** 两级题号（与看板 / 抽屉 / 导出 / 报错同一份）。 */
    heading: string;
    index: number;
    total: number;
    /** 属于哪个任务；`null` = 散题。 */
    taskId: string | null;
  };

export function editorRenderRows(nodes: WorksheetQuestionNode[]): EditorRow[] {
  const rows: EditorRow[] = [];
  // 题号只算一次（`flattenAnswerable` 的 DFS 顺序与本函数逐字相同，所以查表拿得到）。
  const headings = new Map(flattenAnswerable(nodes).map((item) => [item.node.id, item.heading]));

  const pushQuestion = (
    node: WorksheetQuestionNode,
    index: number,
    total: number,
    taskId: string | null,
  ) => {
    // 取不到题号 = 两套遍历漂了。给空串而不是编一个号（屏幕上会看得出来）。
    rows.push({ kind: 'question', node, heading: headings.get(node.id) ?? '', index, total, taskId });
    const kids = kidsOf(node);
    kids.forEach((child, childIndex) => pushQuestion(child, childIndex, kids.length, taskId));
  };

  nodes.forEach((node, index) => {
    if (node.type === TASK_TYPE) {
      rows.push({ kind: 'task', node, index, total: nodes.length });
      const kids = kidsOf(node);
      kids.forEach((child, childIndex) => pushQuestion(child, childIndex, kids.length, node.id));
      return;
    }
    pushQuestion(node, index, nodes.length, null);
  });
  return rows;
}

/** 编辑页的**一块**：一个任务行 + 它下面那些小题行；散题各自成块（`task: null`）。 */
export interface EditorBlock {
  task: Extract<EditorRow, { kind: 'task' }> | null;
  questions: Array<Extract<EditorRow, { kind: 'question' }>>;
}

/**
 * 把行按「任务一段」切块。**放在核心里而不是 JSX 里**：切错了的表现是
 * 「小题跑到别的任务下面」—— 那是一条**没有任何报错**的判据，写在 JSX 里就没有回归网
 *（本仓没有前端测试框架）。页面因此只剩一个哑映射。
 */
export function editorRenderBlocks(nodes: WorksheetQuestionNode[]): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  for (const row of editorRenderRows(nodes)) {
    if (row.kind === 'task') { blocks.push({ task: row, questions: [] }); continue; }
    const last = blocks[blocks.length - 1];
    // 任务行一定在它的小题行之前 ⇒ 有 `taskId` 时最后一块必然是那个任务。
    if (row.taskId !== null && last && last.task && last.task.node.id === row.taskId) {
      last.questions.push(row);
      continue;
    }
    blocks.push({ task: null, questions: [row] });
  }
  return blocks;
}

/** 中文序号（任务标题预填用）。够 1..99 —— 一份学习单不会有更多任务。 */
const TASK_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
function taskNumeral(n: number): string {
  if (n <= 9) return TASK_NUMERALS[n - 1];
  // ⚠️ 10..99 走中文序号；≥100 超出这套写法 ⇒ 回落阿拉伯数字（原来会产出「任务undefined十」）。
  // 一份学习单不会有 100 个任务，但产出「undefined」是一个**看着像 bug 的**字符串。
  if (n > 99) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : TASK_NUMERALS[tens - 1]}十${ones === 0 ? '' : TASK_NUMERALS[ones - 1]}`;
}

/**
 * 新任务预填的标题 —— 按**已有的顶层任务数**推下一个序号。
 *
 * ⚠️ 它是**输入框里的预填值**，不是定稿：教师可以改，也可以清空
 *（标题留空 ⇒ 学生端题号没有前缀，那是合法的，见 `flattenAnswerable`）。
 * 预填的理由：迁移写下的就是「任务一」这套惯例，新任务跟着它，
 * 两个任务的题号才不会长得一模一样（都是 `1 2 3`）。
 */
export function nextTaskTitle(nodes: WorksheetQuestionNode[]): string {
  // ★ 2026-09-25（第二轮终审 F4）：按**已有最大序号 + 1**，不是「已有任务个数 + 1」。
  // 按个数推的实测序列：新建→任务一、再新建→任务二、**删掉任务一**、再新建 ⇒ 两个「任务二」
  // ⇒ 题号逐字撞车（`任务二 · 1` 出现两次）。而 C3 那次改迁移判据要防的就是撞号 ——
  // 这条是同一件事的另一条来路（创建路径），所以一起堵上。
  // ⚠️ 教师改过名的任务**不参与**推断（解析不出序号的忽略）：一份全是自定义名字的学习单里，
  // 下一个新任务从「任务一」开始，不与任何**已用的号**冲突（它压根没占号）。
  let max = 0;
  for (const node of nodes) {
    if (node.type !== TASK_TYPE) continue;
    const match = /^任务([一二三四五六七八九十]+)$/.exec((node.prompt ?? '').trim());
    if (!match) continue;
    const value = numeralValue(match[1]);
    if (value > max) max = value;
  }
  return `任务${taskNumeral(max + 1)}`;
}

/** 中文序号 → 数（`taskNumeral` 的逆）。认不出回 0（调用方据此忽略那个名字）。 */
function numeralValue(text: string): number {
  const digits = '一二三四五六七八九';
  const ten = text.indexOf('十');
  if (ten < 0) {
    const only = digits.indexOf(text);
    return only < 0 ? 0 : only + 1;
  }
  const high = ten === 0 ? 1 : digits.indexOf(text[0]) + 1;
  const low = ten === text.length - 1 ? 0 : digits.indexOf(text[ten + 1]) + 1;
  return high * 10 + low;
}

/** 一个新任务容器：**空的是合法的**（教师 2026-09-25 裁定），所以不预置小题。 */
export function newTask(nodes: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return {
    id: `t_${randomIdSuffix()}`,
    type: TASK_TYPE,
    prompt: nextTaskTitle(nodes),
    inputMode: 'keyboard',
    data: {},
    children: [],
  };
}

/**
 * 编辑动作的实际计算。
 *
 * ★ 2026-09-25：**递归**。题可以长在任务里（第 2 步的迁移把存量都包进了任务），
 * 所以「改一道题」必须能在任意一层找到它 —— 见 `mapTree` / `moveInTree` / `removeFromTree`。
 * ⚠️ 「改一道题」仍然是**整棵子树照搬**（`{...node}` 会带上 `children`），这一条没变。
 */
function applyEdit(content: WorksheetContent, action: ContentAction): WorksheetContent {
  switch (action.kind) {
    case 'addQuestion': {
      const fresh = { ...newQuestion(action.questionType), ...(action.points ? { points: action.points } : {}) };
      if (action.parentId === null) return { ...content, nodes: [...content.nodes, fresh] };
      // ⚠️ 走 `replaceNode`（递归找）而不是只看顶层：父任务在树里的任何一层都找得到。
      // 找不到 ⇒ 原对象返回（不制造空历史）。
      return replaceNode(content, action.parentId, (parent) => ({
        ...parent,
        children: [...kidsOf(parent), fresh],
      }));
    }

    case 'addTask':
      return { ...content, nodes: [...content.nodes, newTask(content.nodes)] };

    case 'updatePrompt':
      return replaceNode(content, action.id, (node) => {
        // ⚠️ 不带 `data` 时与从前**逐字相同**（老路径：只改题干）。
        if (!action.data) {
          return node.prompt === action.prompt ? node : { ...node, prompt: action.prompt };
        }
        const data = action.data;
        // 「补丁里显式的 undefined」= 删掉那个键，所以它**不算没变**。
        const dataChanged = Object.keys(data).some((key) => (
          data[key] === undefined ? node.data[key] !== undefined : node.data[key] !== data[key]
        ));
        if (node.prompt === action.prompt && !dataChanged) return node;
        return { ...node, prompt: action.prompt, data: dataChanged ? { ...node.data, ...data } : node.data };
      });

    case 'updateData':
      // 与 `updatePrompt` 同一条规矩：补丁里每个键的值都与现值相同时返回原对象，
      // 否则 `replaceNode` 会无条件造一个新对象，于是一次「按下去什么也没发生」的
      // 动作也会占掉一格撤销栈 —— 教师按撤销时看到屏幕纹丝不动，只能再按一次。
      // 空补丁同理（`every` 对空数组为真）。
      //
      // ⚠️ 比较是**逐个键的 `===`**（与 `updatePrompt` 逐字同形），不递归比较内容：
      // 补丁里的 `options` / `correctKeys` 每次都是新造的数组，按引用比必然不同，
      // 所以它们照常进栈。刻意不做深比较 —— 深比较遇上「就地改了数组再交进来」
      // 会把**真的变化**判成没变，那比多一格撤销严重得多。
      return replaceNode(content, action.id, (node) => {
        const keys = Object.keys(action.patch);
        if (keys.every((key) => node.data[key] === action.patch[key])) return node;
        return { ...node, data: { ...node.data, ...action.patch } };
      });

    case 'updatePoints':
      // 与 `updatePrompt` / `updateData` 走**同一条**路（进撤销栈、同值去重）——
      // 散落的 `setState` 是 undo 开始漏的第一处，这条纪律在本文件头与
      // `ContentAction` 上各写了一遍，这里是它的第三个使用者。
      //
      // ⚠️ 比较是**逐字段的 `===`**：两个框各自的每一次击键都该进栈（与 `updatePrompt`
      // 逐字同形），但「重新赋成同一对值」（例如失焦时又提交了一次）不该占掉一格撤销 ——
      // 否则教师按撤销时屏幕纹丝不动，只能再按一次。
      //
      // ⚠️ `points` 允许**半填**（`{ full: 7 }`，另一个框还空着）：那是屏幕上真实存在的
      // 一瞬间状态，受控输入框要靠它渲染。拦住它出网的是 `save()` 里的 `findPartialPoints`，
      // 不是这里 —— reducer 只负责如实记录教师在屏幕上做了什么。
      return replaceNode(content, action.id, (node) => {
        const current = node.points;
        const next = action.points;
        if (current === undefined && next === undefined) return node;
        if (current && next && current.full === next.full && current.half === next.half) return node;
        return { ...node, points: next };
      });

    case 'updateInputMode':
      // 与 `updatePrompt` / `updateData` / `updatePoints` 走**同一条**路（进撤销栈、
      // **同值去重**）—— 散落的 `setState` 是 undo 开始漏的第一处，这条纪律在本文件头与
      // `ContentAction` 上各写了一遍，这里是它的第四个使用者。
      // ⚠️ 助手是既有的 `replaceNode(content, id, fn)`（**不是** `mapNode` —— 那个名字不存在），
      // 形状逐字照 `updatePoints` 那一支。
      return replaceNode(content, action.id, (node) => (
        // 同值 ⇒ 返回原对象：否则「重新点一次已经选中的那一档」也会占掉一格撤销栈，
        // 教师按撤销时屏幕纹丝不动，只能再按一次。
        node.inputMode === action.inputMode ? node : { ...node, inputMode: action.inputMode }
      ));

    case 'updateAutoGrade':
      // 与其余四条编辑动作走**同一条路**（进撤销栈、同值去重）。
      return replaceNode(content, action.id, (node) => (
        (node.autoGrade === false) === (action.autoGrade === false) && node.autoGrade !== undefined
          ? node
          : { ...node, autoGrade: action.autoGrade }
      ));

    case 'updateTolerance':
      // `null` = 缺省 ⇒ **把键删掉**（与 `points` 的「没有 = 键不存在」同一条约定）。
      return replaceNode(content, action.id, (node) => {
        if (toleranceOf(node) === action.tolerance) return node;
        if (action.tolerance === null) {
          const dropped: WorksheetQuestionNode = { ...node };
          delete dropped.partialTolerance;
          return dropped;
        }
        return { ...node, partialTolerance: action.tolerance };
      });

    case 'reorder': {
      const nodes = reorderInTree(content.nodes, action.id, action.toIndex);
      return nodes === content.nodes ? content : { ...content, nodes };
    }

    case 'move': {
      // 越界 ⇒ 原样返回（不制造历史）：第一题按 ▲ 或最后一题按 ▼ 不该占掉一次撤销。
      // ⚠️ 「同层内换位」这条边界在 `moveInTree` 里 —— 任务内的小题不会跨出任务。
      const nodes = moveInTree(content.nodes, action.id, action.delta);
      return nodes === content.nodes ? content : { ...content, nodes };
    }

    case 'remove': {
      const nodes = removeFromTree(content.nodes, action.id);
      return nodes === content.nodes ? content : { ...content, nodes };
    }

    default:
      // undo / redo / reset 在 `contentReducer` 里各自处理，到不了这里。
      return content;
  }
}

export function contentReducer(state: EditorHistory, action: ContentAction): EditorHistory {
  switch (action.kind) {
    case 'undo': {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    }

    case 'reset':
      return createHistory(action.content);

    default: {
      const present = applyEdit(state.present, action);
      // 没有实际变化（例如题干被重新赋成同一个值）⇒ 状态原样返回，不进栈。
      if (present === state.present) return state;
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present,
        // 新的改动让「重做」这条线失效。
        future: [],
      };
    }
  }
}

/** 保存载荷。**这里就是 sanitize 的唯一调用点**（见 `sanitizeContentForSave`）。 */
export interface WorksheetPayload {
  title: string;
  description: string | null;
  settings: WorksheetSettings;
  content: WorksheetContent;
}

export function buildPayload(
  title: string,
  description: string,
  settings: WorksheetSettings,
  content: WorksheetContent,
): WorksheetPayload {
  return {
    // 与服务端 `readTitle` / `readDescription` 同一套归一化（trim + 空串归 null）。
    // 前端先做一遍，是为了让「保存后的本地状态」与「库里的状态」逐字相同 ——
    // 否则 `dirty` 判据会在保存成功后仍然为真（一个永远擦不掉的「未保存」标记）。
    title: title.trim(),
    description: description.trim() || null,
    settings,
    content: sanitizeContentForSave(content),
  };
}

/**
 * ★ 2026-09-27（教师裁定）：「设置内容在弹窗内直接保存；顶栏的保存按钮是指整张学习单的保存。」
 *
 * ⇒ 从这一刻起**服务端上那份不再是一份**，而是两半、各自可能新旧不同：
 *
 *   | 这一半 | 装什么 | 谁会盖它 |
 *   |---|---|---|
 *   | `content`  | 标题 + 内容 | **只有**顶栏的「保存」 |
 *   | `settings` | 备注 + 设置 | 顶栏「保存」**与**弹窗里的「保存设置」 |
 *
 * 🔴 **为什么要显式分成两半、而不是各存各的字符串**：这两半共用一条 `dirty` 判据，
 * 而 `dirty` 是顶栏那句「未保存」**唯一**的依据。合成一份的后果是一个**会说谎的瞬间**：
 * 教师改完设置点了「保存设置」、而同一时刻他还改过题目 —— 顶栏显示「已保存」，
 * 题目却根本没进服务端。**界面上说假话、且没有任何报错**，正是本仓最防的那一类。
 *
 * ⚠️ 两半必须**不重叠**：`description` 归 `settings`（它就在那个弹窗里、与设置同一个按钮提交），
 * `title` 归 `content`（它在顶栏直接编，与题目一起由顶栏的「保存」提交）。
 *
 * ⚠️ 切分的是**归一化之后**的载荷（`buildPayload` 的产物），不是屏幕上那几格原始状态 ——
 * 否则标题带一个前后空格就会让「未保存」永远擦不掉。
 */
export interface SaveBaselines {
  /** 标题 + 内容。**只有顶栏的「保存」会盖它。** */
  content: string;
  /** 备注 + 设置。顶栏「保存」与弹窗里的「保存设置」都会盖它。 */
  settings: string;
}

/** 把一份载荷切成两半基线。**保存成功后拿它当新的基线**（哪一半存了就盖哪一半）。 */
export function snapshotsOf(payload: WorksheetPayload): SaveBaselines {
  return {
    content: JSON.stringify({ title: payload.title, content: payload.content }),
    settings: JSON.stringify({ description: payload.description, settings: payload.settings }),
  };
}

/**
 * 屏幕上那份与「服务端上那份」还差着东西吗。**任一****半**不同就是脏。
 *
 * ⚠️ `baselines === null`（还没加载完）⇒ 一律不脏：加载中途报「有未保存改动」是假的，
 * 那时屏幕上那份根本不是教师写的，而且草稿也不该在那时被写下去。
 */
export function isDirtyAgainst(baselines: SaveBaselines | null, payload: WorksheetPayload): boolean {
  if (!baselines) return false;
  const current = snapshotsOf(payload);
  return current.content !== baselines.content || current.settings !== baselines.settings;
}

/**
 * **题目那一半**（标题 + 内容）与「服务端上那份」一致吗。
 *
 * 🔴 它守的是**草稿那条不变量**，也是本组第二个「会说谎的瞬间」：`offerDraft` 丢草稿的判据是
 * 「服务端上的版本**不比草稿旧** ⇒ 草稿已经被覆盖进去了」。而「保存设置」会让服务端的
 * `updatedAt` 前进、**却一个字节的题目都没存** —— 那条前提在一瞬间变成假的，于是一份装着
 * 「还没保存过的题目改动」的草稿会被判成「已被覆盖」而**静默丢掉**。
 * ⇒ 只存设置之后，只有这一条为真才允许清草稿。**丢了就是丢数据，没有任何提示。**
 *
 * ⚠️ `baselines === null`（还没加载完）⇒ 一律 `false`：不知道服务端上是什么的时候，
 * 不许丢任何东西。
 */
export function isContentHalfSaved(baselines: SaveBaselines | null, payload: WorksheetPayload): boolean {
  if (!baselines) return false;
  return snapshotsOf(payload).content === baselines.content;
}

export const DEFAULT_SETTINGS: WorksheetSettings = {
  allowResubmit: true,
  autoGrade: true,
  answerMode: 'open',
  defaultInputMode: 'keyboard',
  // 奖励形式（规格 §9.2）：学习单级配置，默认「星星 ⭐、每答对一题 1 个」——
  // 依据（§9.2 的图里 ● 打在星星上、§8.2 的学生端版式图顶栏画着 `⭐×3`）写在
  // `worksheet-reward.ts` 的 `DEFAULT_REWARD_STYLE` 上。**两处必须是同一对默认值**：
  // 这里决定「新建的学习单长什么样」，服务端 `normalizeSettings` 决定「缺字段的行
  // 长什么样」，不一致的话新建出来与学生看到的就是两回事。
  rewardStyle: DEFAULT_REWARD_STYLE,
  rewardStep: DEFAULT_REWARD_STEP,
  // 部分给分档默认 **0**（规格 §12 裁定 3：新单默认「全对 1 / 部分给分 0」，与第一批行为逐字相同）。
  // ⚠️ 用 `DEFAULT_HALF_STEP` 而**不是** `DEFAULT_REWARD_STEP`：两者刚好是 0 与 1，
  // 写错了不会报错，只会让每一张新建的学习单都悄悄变成「部分给分也给 1」。
  halfStep: DEFAULT_HALF_STEP,
  // ★ M7b：**没有默认分析智能体**（与服务端 `normalizeSettings` 的默认**必须一致** ——
  // 上面那段注释说的就是这件事：这里决定新建的单、那边决定缺字段的行）。
  // 🔴 默认指定一个等于「默认把全班作业发给第三方 AI」。
  analysisAgentId: null,
  backgroundTheme: DEFAULT_WORKSHEET_BACKGROUND,
  backgroundImageUrl: null,
  backgroundPortraitImageUrl: null,
  surfaceOpacity: DEFAULT_WORKSHEET_SURFACE,
};

/**
 * 草稿（规格 §3-Y：**只写 localStorage，不写服务端**）。
 * `content` 存的是编辑期原样（含填空题的换行），恢复时才能一模一样地回到屏幕上。
 */
export interface WorksheetDraft {
  savedAt: number;
  title: string;
  description: string;
  settings: WorksheetSettings;
  content: WorksheetContent;
}

export function draftKeyFor(worksheetId: string | null): string {
  return `worksheet-draft:${worksheetId ?? 'new'}`;
}

/**
 * 一个节点**能不能当题目用**。这是 `parseDraft` 与 `normalizeLoadedContent` 共用的守卫。
 *
 * 🔴 `data` 必须一起查：`readOptions` 读 `node.data.options`、`readFillAnswers` 读
 * `node.data.answers`，两处都是**直接解引用**。只查 `id`/`type` 的话，一份缺 `data`
 * 的草稿会整份通过这道守卫，然后在第一次渲染时抛 TypeError —— 编辑页白屏，
 * 而那正是这两处的注释承诺过「形状不对就整份作废」要挡掉的结果。
 */
function isQuestionNode(value: unknown): value is WorksheetQuestionNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || node.id.length === 0 || typeof node.type !== 'string') return false;
  return Boolean(node.data) && typeof node.data === 'object' && !Array.isArray(node.data);
}

/**
 * ★ 2026-09-25（第二轮终审 F1）：草稿的**递归**守卫 —— 树的**每一层**都要是节点。
 *
 * 🔴 为什么草稿这一侧是「判对错」而 `normalizeLoadedTree` 那一侧是「归一」：
 *   · **库里的行**（`normalizeLoadedContent`）：要**让页面能打开** —— 坏孩子丢掉、
 *     `children` 归一成空数组，教师至少还能看见并抢救其余的题；
 *   · **草稿**：它**是我们自己写的东西**（`draftPayload` 存的是 `history.present`），
 *     形状不对说明版本错位或有人手改过 localStorage ⇒ 按它自己的契约**整份作废**
 *    （`parseDraft` 的文件头逐字写着「半个草稿比没有草稿更危险」）。
 *
 * 放行的后果（实测过）：教师点「恢复」之后 `TaskCard` 读 `node.children.length` 抛
 * TypeError ⇒ **整页白屏**（本仓没有 error.tsx），而 `setDraftFound(null)` 已经执行
 * ⇒ 连「丢弃」按钮都回不去，只能手清 localStorage。
 */
function isDraftNode(value: unknown): boolean {
  if (!isQuestionNode(value)) return false;
  const raw = (value as { children?: unknown }).children;
  // 缺 `children` 当没有（渲染那一侧有 `Array.isArray` 守卫，见 `TaskCard`）。
  if (raw === undefined) return true;
  return Array.isArray(raw) && raw.every(isDraftNode);
}

/**
 * ★ 2026-09-25：把一棵**载入的**树归一成可渲染的形状 —— **递归**。
 *
 * 🔴 为什么必须递归：`normalizeLoadedContent` 是 `nodes.filter(isQuestionNode)`，
 * 而任务的 `children` 是**没查过的外部输入**（手改过的库行、别的版本写的草稿）。
 * 一个坏孩子会让 `TaskCard` 里的 `node.children.map(...)` 抛 TypeError ⇒
 * **整页白屏** —— 而那正是这道守卫的职责（它上面那句注释逐字写着
 * 「手改过的库行不该让整个编辑页白屏」）。`children: 'nope'` 更隐蔽：`.map` 根本不存在。
 *
 * ⚠️ 没坏就**不重建对象**（全部孩子原样通过时返回原对象）—— 与 `mapAll` 同一条纪律，
 * 免得每次载入都把整棵树换一遍引用。
 */
function normalizeLoadedTree(value: unknown): WorksheetQuestionNode | null {
  if (!isQuestionNode(value)) return null;
  const raw = value.children;
  const children = Array.isArray(raw)
    ? raw.map(normalizeLoadedTree).filter((child): child is WorksheetQuestionNode => child !== null)
    : [];
  const unchanged = Array.isArray(raw)
    && children.length === raw.length
    && children.every((child, index) => child === raw[index]);
  return unchanged ? value : { ...value, children };
}

/**
 * 解析草稿。**localStorage 里的东西是外部输入**：可能是上一个版本写的、可能被人手改过、
 * 也可能是别的应用写的。形状不对就整份作废 —— 半个草稿比没有草稿更危险。
 */
export function parseDraft(raw: string | null): WorksheetDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const draft = parsed as Record<string, unknown>;
  if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) return null;
  if (typeof draft.title !== 'string' || typeof draft.description !== 'string') return null;
  if (!draft.settings || typeof draft.settings !== 'object' || Array.isArray(draft.settings)) return null;
  if (!draft.content || typeof draft.content !== 'object' || Array.isArray(draft.content)) return null;
  const nodes = (draft.content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes) || !nodes.every(isDraftNode)) return null;

  const settings = draft.settings as Record<string, unknown>;
  const content = draft.content as WorksheetContent;
  return {
    savedAt: draft.savedAt,
    title: draft.title,
    description: draft.description,
    settings: {
      allowResubmit: settings.allowResubmit !== false,
      autoGrade: settings.autoGrade !== false,
      answerMode: settings.answerMode === 'task-step' || settings.answerMode === 'question-step'
        ? settings.answerMode
        : 'open',
      defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
      // 奖励三项与 `normalizeLoadedSettings` 走的是**同一对**归一化函数（不是各写一遍：
      // 草稿来自 localStorage、详情来自服务端，两边的判据分叉会让「恢复草稿」与
      // 「打开已保存的单」给出不同的奖励档）。
      // ⚠️ 部分给分档用 `normalizeHalfStep` 而**不是** `normalizeRewardStep` —— 后者的域
      // 不含 0，会把「部分给分 0」变成 1（理由写在 `HALF_STEPS` 上）。
      rewardStyle: normalizeRewardStyle(settings.rewardStyle),
      rewardStep: normalizeRewardStep(settings.rewardStep),
      halfStep: normalizeHalfStep(settings.halfStep),
      // ★ M7b：非空字符串才算指定（与服务端同一判据：空串与坏值都回落 `null`）。
      analysisAgentId: typeof settings.analysisAgentId === 'string' && settings.analysisAgentId !== ''
        ? settings.analysisAgentId
        : null,
      backgroundTheme: normalizeWorksheetBackgroundTheme(settings.backgroundTheme),
      backgroundImageUrl: typeof settings.backgroundImageUrl === 'string' && settings.backgroundImageUrl.startsWith('/uploads/chat/')
        ? settings.backgroundImageUrl
        : null,
      backgroundPortraitImageUrl: typeof settings.backgroundPortraitImageUrl === 'string' && settings.backgroundPortraitImageUrl.startsWith('/uploads/chat/')
        ? settings.backgroundPortraitImageUrl
        : null,
      surfaceOpacity: normalizeWorksheetSurfaceOpacity(settings.surfaceOpacity),
    },
    content: { schemaVersion: typeof content.schemaVersion === 'number' ? content.schemaVersion : SCHEMA_VERSION, nodes },
  };
}

/**
 * 服务端 `normalizeNode` 保证了下发形状，这里只兜一层「这棵树不可用」的情况：
 * 手改过的库行不该让整个编辑页白屏。
 *
 * ⚠️ 逐题过 `isQuestionNode`，用的是与 `parseDraft` **同一道**守卫 —— 两处各写一份
 * 「差不多」的判据，就是漏掉 `data` 那一处的地方（见 `isQuestionNode` 的说明）。
 */
export function normalizeLoadedContent(content: unknown): WorksheetContent {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return createEmptyContent();
  const nodes = (content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return createEmptyContent();
  const schemaVersion = (content as Record<string, unknown>).schemaVersion;
  return {
    schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : SCHEMA_VERSION,
    nodes: nodes.map(normalizeLoadedTree).filter((node): node is WorksheetQuestionNode => node !== null),
  };
}

export function normalizeLoadedSettings(raw: unknown): WorksheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const settings = raw as Record<string, unknown>;
  return {
    allowResubmit: settings.allowResubmit !== false,
    autoGrade: settings.autoGrade !== false,
    answerMode: settings.answerMode === 'task-step' || settings.answerMode === 'question-step'
      ? settings.answerMode
      : 'open',
    defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
    // ⚠️ 这三项**必须**原样带过来，哪怕是本编辑器没有 UI 的旧字段：编辑页保存时是把
    // `settings` 整份发回去的（`buildPayload`），漏掉一个键就等于用默认值覆盖了库里的设置
    // —— 一次「只改了个标题」的保存会把教师配好的奖励形式悄悄改回星星。
    // ★ M4a：`halfStep` 就是靠这条规则才活下来的那一类键 —— 服务端的 `normalizeSettings`
    // 认它、`readStudentSettings` 下发它，但**只要这里漏一层**，教师保存一次就没了。
    rewardStyle: normalizeRewardStyle(settings.rewardStyle),
    rewardStep: normalizeRewardStep(settings.rewardStep),
    halfStep: normalizeHalfStep(settings.halfStep),
    // ★ M7b：非空字符串才算指定（与服务端 `normalizeSettings` 同一判据）。
    // ⚠️ 这一层**必须**有：`buildPayload` 保存时把 `settings` 整份发回去，
    // 这里漏一个键就等于用默认值覆盖库里的设置 —— 一次「只改了个标题」的保存
    // 会把教师配好的分析智能体悄悄清掉（上面那段注释说的正是这一类键）。
    analysisAgentId: typeof settings.analysisAgentId === 'string' && settings.analysisAgentId !== ''
      ? settings.analysisAgentId
      : null,
    backgroundTheme: normalizeWorksheetBackgroundTheme(settings.backgroundTheme),
    backgroundImageUrl: typeof settings.backgroundImageUrl === 'string' && settings.backgroundImageUrl.startsWith('/uploads/chat/')
      ? settings.backgroundImageUrl
      : null,
    backgroundPortraitImageUrl: typeof settings.backgroundPortraitImageUrl === 'string' && settings.backgroundPortraitImageUrl.startsWith('/uploads/chat/')
      ? settings.backgroundPortraitImageUrl
      : null,
    surfaceOpacity: normalizeWorksheetSurfaceOpacity(settings.surfaceOpacity),
  };
}

/* ————————————— 悬停看大图（★ 2026-09-27，教师） ————————————— */

/**
 * ★ 2026-09-27（教师）：「鼠标停留一会儿后，浮动显示大图，看效果。」
 *
 * 设置弹窗里那一格背景缩略图太小，看不出这套插图到底长什么样。
 *
 * ⚠️ **尺寸与位置分成两个纯函数**（都在这里，都有用例）：
 *   · `hoverPreviewSize`   只跟**视口**有关 ⇒ 鼠标扫过一排卡片时尺寸**不变**；
 *   · `placeHoverPreview`  只跟**卡片位置**有关 ⇒ 浮层跟着那一张卡走。
 *   合成一个函数的话，尺寸会随卡片变 —— 屏幕上就是「浮层一边飘一边缩放」。
 * 🔴 **不许把这两件事写进组件**：本仓的组件层没有回归网（无 jsdom），
 *    而「浮层跑到屏幕外面去了」正是那种**只在某些窗口宽度下**才出现的缺陷。
 */
export interface HoverPreviewSize {
  width: number;
  height: number;
}

/** 浮层与卡片之间的间隙、以及它与视口边缘的最小距离。 */
const HOVER_GAP = 12;
const HOVER_MARGIN = 12;

/** 横图是 3:2（`scripts` 里那批背景图就是这个比例）。 */
const HOVER_ASPECT = 3 / 2;

/** 再宽也不超过这个值 —— 一张背景图占满整个屏幕对「看效果」没有帮助。 */
const HOVER_MAX_WIDTH = 460;

/**
 * 浮层多大。**只取决于视口** —— 见上面那段（尺寸不许跟着卡片变）。
 * ⚠️ 窄视口下把两侧边距让出来（`viewport.width - 2 × MARGIN`），否则它会比屏幕还宽。
 */
export function hoverPreviewSize(viewport: { width: number; height: number }): HoverPreviewSize {
  const width = Math.max(1, Math.min(HOVER_MAX_WIDTH, viewport.width - HOVER_MARGIN * 2));
  return { width, height: Math.round(width / HOVER_ASPECT) };
}

/**
 * 浮层放哪儿 —— **优先贴卡片右侧**（一眼看出它说的是哪一张卡），
 * 右边放不下就翻到左侧，两边都放不下才水平居中（宁可盖住卡片，也不许溢出屏幕）。
 *
 * ⚠️ 垂直方向与卡片**中线对齐**（不是顶对齐）：卡片是一行两列，中线对齐读起来最稳。
 * 🔴 最后一律**夹进视口**（`Math.max(HOVER_MARGIN, …)`）：浮层比视口还高时，
 *    夹出来的上界会比下界还小 —— 那种情况下取 `HOVER_MARGIN`（贴顶），
 *    而不是返回一个负数。这条有用例（`placeHoverPreview` 那一条的最后一问）。
 */
export function placeHoverPreview(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: HoverPreviewSize,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const rightRoom = anchor.right + HOVER_GAP + size.width <= viewport.width - HOVER_MARGIN;
  const leftRoom = anchor.left - HOVER_GAP - size.width >= HOVER_MARGIN;
  let left: number;
  if (rightRoom) left = anchor.right + HOVER_GAP;
  else if (leftRoom) left = anchor.left - HOVER_GAP - size.width;
  else left = (viewport.width - size.width) / 2;
  // 夹进视口。⚠️ `Math.max(HOVER_MARGIN, viewport.width - HOVER_MARGIN - size.width)` 是上界；
  // 浮层比视口还宽时上界小于下界，`Math.min` 会取到那个更小的值 —— 所以外面还要再夹一次。
  const maxLeft = Math.max(HOVER_MARGIN, viewport.width - HOVER_MARGIN - size.width);
  left = Math.max(HOVER_MARGIN, Math.min(left, maxLeft));

  const centered = anchor.top + (anchor.bottom - anchor.top) / 2 - size.height / 2;
  const maxTop = Math.max(HOVER_MARGIN, viewport.height - HOVER_MARGIN - size.height);
  const top = Math.max(HOVER_MARGIN, Math.min(centered, maxTop));
  return { left: Math.round(left), top: Math.round(top) };
}
