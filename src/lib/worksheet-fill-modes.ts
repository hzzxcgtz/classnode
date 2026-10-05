import type { WorksheetQuestionNode } from './types.ts';
import { blankRuns, type PromptRun } from './worksheet-prompt-marks.ts';
import { blankLayout, cellAtSlot, cellLabel, tableBlankIds } from './worksheet-table.ts';
// ★ 2026-09-30：落词要按**判分口径**写进草稿（见 `placedValue`）。
import { mathText, splitMath } from './worksheet-math.ts';

export type FillAnswerMode = 'text' | 'pool' | 'inline';
export type FillGradingMode = 'auto' | 'ai' | 'none';

export interface FillBlankSetting {
  mode: FillAnswerMode;
  choices: string[];
  /** 逐空评分；缺失表示老题，继续走题目级评分规则。 */
  gradingMode?: FillGradingMode;
  /** 该空答对时的满额。图标奖励同样只能设置完整个数。 */
  maxScore?: number;
}

export function hasExplicitFillGrading(settings: readonly FillBlankSetting[]): boolean {
  return settings.some(setting => setting.gradingMode !== undefined);
}

export function fillGradingTotals(settings: readonly FillBlankSetting[]): { auto: number; ai: number; total: number } {
  let auto = 0;
  let ai = 0;
  settings.forEach((setting) => {
    const score = Number.isInteger(setting.maxScore) && (setting.maxScore ?? 0) > 0 ? setting.maxScore! : 1;
    if (setting.gradingMode === 'auto') auto += score;
    if (setting.gradingMode === 'ai') ai += score;
  });
  return { auto, ai, total: auto + ai };
}

/**
 * **单行**输入框里那一串 → 条目表（★ 2026-09-28，教师）。**待选词与标准答案共用它。**
 *
 * 教师第一轮原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示
 * 使用常见的符号分隔即可。」第二轮（看到我按含义区分了两套分隔符之后）：
 * 「我说的是**常见符号提示都能用**，不要光是分号、顿号、逗号……」
 * 第三轮（★ 2026-09-30）：「用户在输入的时候可以用各种常见的分隔符号，**你多想几个，
 * 都是支持的**，也不用刻意地转成某一个特别的符号。」
 *
 * 🔴 **两种输入共用这一个分隔符集合**（曾经分成两套，被教师否掉）：
 *   顿号 `、﹑`、逗号 `，,`、分号 `；;`、斜杠 `/／`、竖线 `|｜`、
 *   各种间隔号与项目符号 `·•‧・`、制表符、换行。
 *   ⚠️ **代价要记住**：既然这些都算分隔，「小明、小红」这种**本身含标点的答案**
 *   会被拆成两个可接受答案 ⇒ 学生答出半句也算对。教师知情并选择了这个便利
 *   （我上一轮按「答案是短语、词是词」分成两套，被否了）。
 *   ⇒ 所以**提示必须写出来**（见 `question-card.tsx` 里「标准答案」那句块说明）：
 *     教师猜错分隔符的表现是**静默的判分变化**，而屏幕上什么都看不出来。
 *
 * 🔴 **`／`（全角斜杠）与 `\t`（制表符）是 2026-09-30 补的，两个都有实测理由**：
 *   · 中文输入法里按 `/` 打出来的**就是全角 `／`** —— 原来只认半角 ⇒
 *     教师**照着提示打也切不开**，屏幕上只是**一整个**词条（不报错、不提示）。
 *   · 从 Word 表格 / Excel 复制一列过来，列与列之间是**制表符**，不是换行。
 *
 * 🔴 **`\` 刻意不是分隔符** —— 这条最容易被「顺手加上」：
 *   「凡教师能打字处」现在包含**标准答案**，而答案可以是一条公式（`$\frac{a}{b}$`）。
 *   把 `\` 当分隔符会把公式劈成几段，而屏幕上什么都看不出来（判分那边只表现为
 *   「答案对不上」）。同理 `{ } ^ $` 一个都不能碰。
 *
 * 🔴 **只用在输入这一侧。** 读库那一侧（`fillSettingsFor` / `sharedPoolChoices`）
 * 仍然走 `splitChoiceLines` —— 让**读**也按逗号切，会把库里一个含逗号的词条
 * 悄悄切成两个，而那是**数据变更**（存进去的是「甲,乙」一个词，读出来变两个）。
 *
 * ⚠️ **空格不是分隔符**：「New York」是一个词。教师说的也是「符号」。
 * ⚠️ 数组直接交给 `splitChoiceLines`（它已经是一份条目表了，再切一次就是重复解析）。
 */
/**
 * 单行「符号分隔列表」认的那些**符号** —— ★ 2026-09-30 收成**一份**。
 *
 * 🔴 为什么必须是一个常量：这份集合在仓里原来有**三份拷贝**
 *（`splitChoiceText` 的正则、`worksheet-editor-core.ts` 的 `POOL_SPLIT`、
 *  以及那个文件里判 `loose` 的第二条正则），而后两条的注释写着
 *「与 `splitChoiceText`（输入那一侧）**同一套**」—— 那句话在给输入那一侧加了
 *  全角斜杠之后**当场变成假话**（`（高兴／难过）` 在粘贴解析那一侧认不出来，
 *  症状是**整个括号连词一起留在题干里**）。假注释会被下一个人当依据，所以收了。
 * ⚠️ **不含空白**：空格算不算分隔符由**调用方**定 ——
 *    单行输入框里「New York」是一个词（下面那条纪律），而 `extractPoolWords`
 *    那一档刻意把空格也算上（教师原话「通常会有分隔符**或空格**」，判不准的那一档另有
 *    `loose` 报警）。所以这里只放**符号**，空白由各自的调用点自己加。
 */
export const CHOICE_SEPARATORS = '、﹑，,；;/／|｜·•‧・';

/**
 * 上面那份符号 + 换行/制表符。**由常量派生**（不是另写一条正则）——
 * 两处各写一条，就是下一次「加了一个字符、只改了一边」的地方。
 */
const CHOICE_SPLIT = new RegExp(`[${CHOICE_SEPARATORS}\\t\\r\\n]+`);

export function splitChoiceText(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitChoiceLines(raw);
  if (typeof raw !== 'string') return [];
  return raw
    .split(CHOICE_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 把一份条目表拼成**人看的一行**（单行输入框显示存下来的值时用）。
 *
 * 🔴 **四处必须用同一个**（教师 2026-09-30：「几个地方要统一下」）——
 *    在此之前四处各传一个（` / ` / `；` / `、` / `、`），而**主观题「参考答案」那一处的
 *    占位语写的是「例如：春天、春季」（顿号）、值却用斜杠显示**，自己跟自己就不一致。
 * ⚠️ **它只管显示**：解析那一侧是 `splitChoiceText`，两边**不是**互逆的一对
 *    （教师打逗号、存成条目、再显示成顿号 —— 那是允许的，见 `SymbolListInput`）。
 */
export const CHOICE_JOINER = '、';

/**
 * 那几处单行「符号分隔列表」输入框**共用的提示句**（★ 2026-09-30 统一）。
 *
 * 🔴 为什么是一个常量：这句话原来在 `question-card.tsx` 里有**两份**，都写着
 *    「顿号、逗号、分号」—— 而扩充分隔符集合时是**同一个事实**，两份就是两次漂移的机会
 *    （本仓的老账：「同一个事实在仓里常有多份拷贝，改一处只改一处」）。
 * ⚠️ 它必须说清「有哪些」：教师猜错分隔符的表现是**静默的**（选词只出来一个、或者
 *    答案只认半个），屏幕上什么都看不出来 —— 见 `splitChoiceText` 的文件头。
 * ⚠️ 不提「空格」：空格**不是**分隔符（「New York」是一个词），
 *    写进来反而会让教师以为要换个写法。
 */
export const CHOICE_SEPARATOR_HINT = '多个之间用常见的符号分隔即可（顿号、逗号、分号、斜杠、竖线都认）。';

/**
 * 两份条目表是不是**同一个**（逐项相等，顺序也算）。
 *
 * 🔴 它存在的理由：单行输入框**不再**把教师打的符号规范化掉（★ 2026-09-30），
 *    于是「什么时候该拿外面那份值回填」需要一个判据 —— 见 `SymbolListInput`。
 * ⚠️ 判据必须是逐项相等，**不是**「拼出来的字符串相等」：后者会把
 *    「教师打了逗号、而外面那份用顿号拼」判成两个不同的值 ⇒ 当场把他的稿子改掉，
 *    而那正是本次要修掉的那个毛病。
 */
export function sameChoiceItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function splitChoiceLines(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];
  return raw.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function storedSettings(node: WorksheetQuestionNode): Record<string, unknown> {
  const raw = node.data.fillBlankSettings;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/**
 * 这道题的**空的清单** —— 题干里的空在前、表格里的空在后（★ 2026-09-28，教师反馈）。
 *
 * 教师原话：「表格填空……和原来已有的题干和每个空的作答方式都完全割裂了……
 * 东跳跳西跳跳」。具体的一条是：`fillSettingsFor` 原来只遍历 `promptRuns` 的分段
 * ⇒ **一道表格题在「每个空的作答方式」那一块显示「题干中还没有填空域」**，
 * 而上面明明有一张表、里面标着空 —— 两块互相打脸。
 *
 * 🔴 顺序与**答案编号**同一条规则（题干在前、表格在后），所以
 * `slots[i]` 就是「第 i 个空」：标签用 `blankLabelAt`、身份用 `id`
 *（`fillBlankSettings` 的键）。三处一条规则，不会再各说各的。
 * ⚠️ `label` 由 `blankLabelAt` 给（有用例）—— 这里不自己拼「第几行第几格」。
 */
export interface BlankSlot {
  /** 空的身份 —— `fillBlankSettings` 的键，与题干里的空共用同一个命名空间。 */
  id: string;
  /** 它在哪：`第 2 空` / `第 2 行第 2 格`。 */
  label: string;
  kind: 'text' | 'table';
}

export function blankSlots(node: WorksheetQuestionNode, runs: PromptRun[]): BlankSlot[] {
  const textRuns = blankRuns(runs);
  // ⚠️ 把 `runs` 传进去：`blankLayout` 自己会读 `node.data.promptRuns`，两个来源
  // 一旦不是同一份，编号就会静默算错（这个坑我踩过一次）。
  const { tableBase } = blankLayout(node, runs);
  const tableIds = tableBlankIds(node.data.table);
  const slots: BlankSlot[] = [];
  // ① 标记**之前**的文本空
  textRuns.slice(0, tableBase).forEach((run, index) => {
    slots.push({ id: run.blank, label: `第 ${index + 1} 空`, kind: 'text' });
  });
  // ② 表格里的空（行优先）—— 插在中间了（★ 2026-09-28：表格域能插在题干中间）
  tableIds.forEach((id, index) => {
    const at = cellAtSlot(node.data.table, index);
    slots.push({
      id,
      label: at ? cellLabel(at.row, at.col) : `表格里的第 ${index + 1} 个空`,
      kind: 'table',
    });
  });
  // ③ 标记**之后**的文本空 —— 号接着表格往后数
  textRuns.slice(tableBase).forEach((run, index) => {
    slots.push({
      id: run.blank,
      label: `第 ${tableBase + tableIds.length + index + 1} 空`,
      kind: 'text',
    });
  });
  return slots;
}

export function fillSettingsFor(node: WorksheetQuestionNode, runs: PromptRun[]): FillBlankSetting[] {
  const stored = storedSettings(node);
  const legacyChoices = splitChoiceLines(node.data.choices);
  const legacyInline = node.type === 'choice-blank' && node.data.choiceLayout === 'inline-pairs';
  // ⚠️ 下标用 `blankSlots` 的顺序：题干里的空在前（与 `blankRuns` 的下标逐位相同，
  //    所以下面那两处沿用它算「第几个空」的旧逻辑照旧成立），表格里的空在后面。
  return blankSlots(node, runs).map((slot, index) => {
    const raw = stored[slot.id];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      const mode: FillAnswerMode = item.mode === 'pool' || item.mode === 'inline' ? item.mode : 'text';
      const gradingMode: FillGradingMode | undefined = item.gradingMode === 'auto' || item.gradingMode === 'ai' || item.gradingMode === 'none'
        ? item.gradingMode : undefined;
      const maxScore = typeof item.maxScore === 'number' && Number.isInteger(item.maxScore) && item.maxScore >= 1 && item.maxScore <= 99
        ? item.maxScore : undefined;
      return { mode, choices: splitChoiceLines(item.choices), gradingMode, maxScore };
    }
    // 表格里的空：缺省「手工填写」（v1 不给表格开选词 —— 存过的设置上面已经读到了）
    if (slot.kind === 'table') return { mode: 'text', choices: [] };
    if (node.type === 'choice-blank') {
      return legacyInline
        ? { mode: 'inline', choices: legacyChoices.slice(index * 2, index * 2 + 2) }
        : { mode: 'pool', choices: [] };
    }
    return { mode: 'text', choices: [] };
  });
}

/**
 * 把每个空的作答方式写回去。**按身份写**（`blankSlots` 的顺序给每份设置找到自己的空）。
 * ⚠️ 签名从 `(runs, settings)` 变成 `(node, runs, settings)`：表格里的空不在 `runs` 里，
 * 光看分段认不出它们。
 */
export function writeFillSettings(
  node: WorksheetQuestionNode,
  runs: PromptRun[],
  settings: FillBlankSetting[],
): Record<string, FillBlankSetting> {
  const result: Record<string, FillBlankSetting> = {};
  blankSlots(node, runs).forEach((slot, index) => {
    const setting = settings[index] ?? { mode: 'text' as const, choices: [] };
    result[slot.id] = {
      mode: setting.mode,
      choices: splitChoiceLines(setting.choices),
      ...(setting.gradingMode ? { gradingMode: setting.gradingMode } : {}),
      ...(setting.maxScore ? { maxScore: setting.maxScore } : {}),
    };
  });
  return result;
}

export function sharedPoolChoices(node: WorksheetQuestionNode): string[] {
  return splitChoiceLines(node.data.fillChoicePool ?? node.data.choices);
}

/**
 * 学生**点/拖**一个候选词时，写进作答草稿的值（★ 2026-09-30）。
 *
 * 🔴 它必须是**判分口径**的词（剥掉公式定界符），不能是候选词的原文。
 *    根因：选择填空的学生**不打字** —— 他点的是**教师自己写的那个词**，`$` 是教师文本
 *    自带的。而判分侧（`gradableAnswers`）比的是剥离之后的文本 ⇒ 不剥的话
 *    **他点对了却判错**，而且屏幕上「他点的那个词」与「正确答案」都渲染成同一个公式，
 *    看起来一模一样 —— 本仓最防的那类静默错判。
 * ⚠️ 与「学生打 `$x=5$` 要判错」（裁定 ④ 的另一半）**不矛盾**：那说的是学生**手打**的
 *    字符，这里是教师文本的引用，两回事。
 * ⚠️ 没有公式的词一个字节都不动；不成公式的 `$`（「这本书 $5」）也原样保留 ——
 *    那一条由 `splitMath` 的安全阀保证，这里不另设规则。
 */
export function placedValue(word: string): string {
  return mathText(splitMath(word));
}
