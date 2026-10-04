import type { WorksheetQuestionNode } from './types';

/**
 * 学习单的**题型词汇表**与**作答态形状** —— 全项目唯一一份。
 *
 * 🔴 这个文件存在的理由是「第二份真源」：同一份 `content` 会被**两段 JSX**画出来 ——
 * 学生端的作答面板（`src/app/classroom/worksheet/worksheet-panel.tsx`）与教师端的
 * 「学生端预览」（`src/app/teacher/worksheets/edit/preview-modal.tsx`）。规格 §6.3 的原话是
 * 「教师看到的就是学生看到的宽度」，而教师是**拿这个弹窗当验收依据**的 ——
 * 两份各写一遍「选项怎么读出来」「题型叫什么」，就会在某一处先漂移，
 * 症状是「预览里长这样、学生那里不是」，**没有任何报错**。
 *
 * 所以「题型名」与「选项的读法」都收在这里：
 *   · 学生端面板直接引本文件；
 *   · 教师端的编辑器内核（`worksheet-editor-core.ts`）从这里**转出**（不是抄一份），
 *     它自己的 `question-card.tsx`、编辑器页面与 `worksheet-editor-core.test.ts`
 *     仍然从内核 import，一行都不用改。
 *
 * ★ M4a/D1：**作答值形状与拖拽/点选状态机已经搬去两个新文件**，这里只**转出**它们
 *（`worksheet-answer-value.ts` / `worksheet-drag.ts`），消费者一行都不用改：
 *   · `worksheet-answer-value.ts` —— `WorksheetAnswerValue` / `AnswerDraft` /
 *     `emptyDraftFor` / `isDraftEmpty` / `buildAnswerValue` / `draftFromValue`；
 *   · `worksheet-drag.ts` —— 排序 / 连线 / 归类共用的点选态与落位操作（纯逻辑，
 *     本批唯一能被 `node --test` 钉住的那一半）。
 * 搬家的理由只有一个但很硬：作答值要读题目 `data` 里的条目，而本文件要转出它们 ——
 * 留在同一个文件里就变成自我引用。依赖因此是**单向**的：本文件 → 那两个文件 → `./types`。
 *
 * ⚠️ **本文件不引任何 React / DOM，也不引任何联名路径（`@/…`）**：它要能被
 * `node --test` 直接执行（Node 24 的类型擦除），而内核是**相对路径**引它的
 * （`'../../../../lib/worksheet-questions.ts'`）—— 带 `.ts` 后缀是那件事的前提，
 * `tsconfig.json` 的 `allowImportingTsExtensions` 已开。
 * 同理，`import type` 是**唯一**的 import 形态（类型擦除会整段删掉它）。
 * ⚠️ 下面这几条 `export … from './…ts'` **必须带 `.ts` 后缀**（同上：`node --test` 直接跑）。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 */
export {
  buildAnswerValue,
  draftFromValue,
  emptyDraftFor,
  isDraftEmpty,
  isMultiBlank,
  readBlankCount,
  readCategorizeItems,
  readCategorizeZones,
  readEntries,
  readMatchLeft,
  readMatchRight,
  readOrderItems,
  type AnswerDraft,
  type EntryTextField,
  type WorksheetAnswerValue,
  type WorksheetEntry,
} from './worksheet-answer-value.ts';

/**
 * 题型。⚠️ 这是**服务端注册表**（`server/src/services/worksheet-questions.ts` 的
 * `QUESTION_TYPES`）在前端的投影，不是第二份权威：真正的校验在服务端
 * （`routes/worksheets.ts` 的 `parseContent`），多出来的题型会被 400 拒绝。
 * 这里窄一点只影响「能新建哪几种」，不会让非法题型落库。
 *
 * ⚠️ 两边的**成员必须逐字相同**，但**顺序不必相同** —— 实测两边今天就不一样：
 * 服务端的 `QUESTION_TYPES` 把 `short-answer` 排在**第 5 位**（紧跟 `fill-blank`），
 * 而下面的 `QUESTION_TYPE_OPTIONS` 把它排在**最后**（加题弹窗里主观题垫底更好找）。
 * 没有任何代码依赖这两个顺序一致：弹窗按本数组的顺序列出来，学生端的题号旁标签按题型查名。
 * ⇒ 「顺序不一样」不是缺陷；**成员不一样**才是（前端多一个 ⇒ 保存时被服务端 400 拒；
 * 服务端多一个 ⇒ 加题弹窗里根本没有它）。
 */
export type QuestionType =
  | 'single-choice' | 'true-false' | 'multi-choice' | 'fill-blank' | 'short-answer'
  | 'order' | 'match' | 'categorize'
  | 'drawing'
  // ★ 2026-09-26（教师）：「选择填空」—— 题干与填空题同一条（题干里的空），
  // 多出一排待选词，学生**拖**它们进空。⚠️ 它与服务端 `QUESTION_TYPES` 的成员
  // **必须逐字相同**（这个联合是那份清单在前端的投影，不是第二份权威）。
  | 'choice-blank';

/**
 * 题型清单。**加题弹窗、每张卡片右上角的题型名、学生端的题号旁标签共用这一份。**
 *
 * 🔴 `graded` 这一格是 M4a 加的，**它不是描述、是判据**：`true` ⇒ 教师看板的**抽屉里**会画
 * ✓/½/✗（⚠️ **不是方格阵的格子** —— 对错标记在抽屉里、不在看板格子上，规格 §7.2；
 * §12 那句「部分给分必须在看板那一侧画得出来」已于 2026-09-24 更正为「是抽屉里」），
 * `false` ⇒ 只统计作答进度。它存在的理由是「加题型」这个动作**必须**同时回答
 * 「它判不判分」—— 见 `src/app/teacher/classroom/worksheet-drawer-state.ts` 的
 * `GRADED_QUESTION_TYPES`（它现在从这一格**派生**，不再是一份并列的白名单，
 * 那份白名单漏改的表现是「正确率把新题型算进分母，抽屉里却不画任何标记」，全程无报错）。
 */
export const QUESTION_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  /**
   * ★ 2026-09-28（教师）：**给学生看的别名** —— 「适合中小学生的、朗朗上口的」。
   *
   * 教师给的对照表（逐字）：
   *   选择题 慧眼选择 · 填空题 开心填空 · 连线题 巧手连线 · 分类题 分类达人 ·
   *   判断题 真假侦探 · 排序题 顺序高手 · 问答题 妙语问答 · 绘图题 创意画板
   *
   * 🔴 它与 `label`（教师端用的正式题型名）**是两件事，都要留着**：
   *   教师端下拉里写「慧眼选择」会让人对不上教材与教研的用词。
   * ⇒ 学生端显示 `nickname`，教师端一切照旧用 `label`。
   * ⚠️ 表里没有的三个（`choice-blank` / `task`）见各自的注释。
   */
  nickname: string;
  hint: string;
  /** 能不能自动判分。`true` ⇒ 看板的**抽屉里**会画 ✓/½/✗；`false` ⇒ 只统计作答进度。 */
  graded: boolean;
}> = [
  // ★ 2026-09-26：紧挨着填空题排（它就是填空题的一个变体，教师找它时会先看那里）。
  { value: 'choice-blank', label: '选择填空', nickname: '开心填空', hint: '题干里有几个空，下方给出待选词，学生拖词入空', graded: true },
  { value: 'single-choice', label: '单选题', nickname: '慧眼选择', hint: '若干选项，只有一个正确答案', graded: true },
  { value: 'true-false', label: '判断题', nickname: '真假侦探', hint: '对 / 错两个选项', graded: true },
  { value: 'multi-choice', label: '多选题', nickname: '慧眼选择', hint: '若干选项，正确答案可以不止一个', graded: true },
  { value: 'fill-blank', label: '填空题', nickname: '开心填空', hint: '学生填一段文字，答对任一可接受答案即算正确', graded: true },
  { value: 'order', label: '排序题', nickname: '顺序高手', hint: '把打乱的条目排成正确顺序', graded: true },
  { value: 'match', label: '连线题', nickname: '巧手连线', hint: '把左栏与右栏一一连起来', graded: true },
  { value: 'categorize', label: '归类题', nickname: '分类达人', hint: '把若干条目拖到对应的框里', graded: true },
  { value: 'short-answer', label: '问答题', nickname: '妙语问答', hint: '主观题，不自动判分', graded: false },
  // ★ M4b：`drawing` 这个题型名是**本计划的裁定**（规格没有给）—— 见 `QuestionType` 的注释。
  // `graded: false` **是有意的决定，不是补测试**：手写 / 绘图不参与自动判分（规格 §12 裁定 3）。
  // 服务端那一侧有**两条**闸（B1，提交 `e1ff80c`）：`JUDGES.drawing` 恒回 `null`；
  // `judge()` 见到 ink 值**直接短路回 `null`**（后一条管的是「题型不是 `drawing`、值却是 ink」）。
  // ⚠️ 这句话的依据**不是** Global Constraints 里的某一条（那里没有这句话），
  // 而是规格 §12 裁定 3 本身 + `worksheet-answer-value.ts` 里那段「`format` 在服务端只被读两处、
  // 两处都不拿它当判据」（现在在 `:48-71`）—— B1 之前它写的是「`format` 服务端一个字节都不读」。
  // 这一格是 false ⇒ 看板抽屉里只统计作答进度、不画 ✓/½/✗（`GRADED_QUESTION_TYPES` 从这一格派生）。
  { value: 'drawing', label: '绘图题', nickname: '创意画板', hint: '学生可用画板绘制或拍照上传，不自动判分', graded: false },
];

/**
 * ★ M4a：**逐题分值**（全对 / 部分给分两档）的取值上限 —— 与服务端
 * `services/worksheet-questions.ts` 的 `POINTS_MAX` 是**同一对**字面量（服务端读不到 `src/`）。
 *
 * 🔴 两处必须一起改，且**不能只改一处**：服务端的 `normalizePointValue` 对越界值
 * **回落** `DEFAULT_POINTS`（全对 1 / 部分给分 0），不是拒绝保存 —— 所以前端放宽而服务端不放宽时，
 * 教师填的 `200` 会变成 `1`，保存照常 200，**没有任何报错**。
 *
 * ⚠️ 它是**两个档共用的上界**（`full` 与 `half` 各自上到 99），不是「`full + half <= 99`」；
 * 也**不是** `HALF_STEPS` / `REWARD_STEPS` 那套四选一 —— 学习单级是下拉，逐题是两个自由输入框
 * （规格 §12 裁定 4/5）。把两者「统一」起来会让教师填的 `4` 被静默改成 `1`。
 */
export const POINTS_MAX = 99;

/**
 * ★ M4a/I1：**「全对」档的下界**（`half` 的下界是 `0`，两者**有意不同**）。
 *
 * 🔴 `full = 0` 会让**答对**的题拿到 0 分，于是一次提交里三个观测互相打架：
 * 学生端**一枚奖励图标都不画**（角标只在 `amount > 0` 时出现）；教师抽屉读 `gradeState`
 * ⇒ **`✓ 答对`（绿）**
 * 并计进正确率分子；学生奖励累计 +0。**全程无一处报错。**
 * ⇒ 服务端 `services/worksheet-questions.ts` 的 `POINTS_FULL_MIN` 是**同一个数**：
 * 那边拒绝保存（400），这边的输入框**当场**报红字。
 * ⚠️ 两处必须一起改，且**不能只改一处**：只改服务端 ⇒ 教师看到框里是 0、点保存才被拒；
 * 只改前端 ⇒ 手工改过的库行与别的前端仍能把它落库。
 *
 * ⚠️ 别顺手把 `half` 的 `0` 也挡掉：那是**合法选择**（= 不给部分分，规格 §12 裁定 3 的
 * 默认值就是它），`shouldWarnZeroHalfCredit` 那条提示正建立在它上面。
 */
export const POINTS_FULL_MIN = 1;

/**
 * 题型的中文名。未知题型（库里手工改过的行）**回落成类型串本身**，不回落成「单选题」——
 * 后者会让一道不认识的题在界面上谎称自己是单选。
 */
/**
 * 给学生看的**别名**（★ 2026-09-28，教师给的对照表）。
 *
 * ⚠️ 表里没有的题型（`task` 是任务容器、不是题）**回落到正式题型名** ——
 * 回落成空串会让那一行只剩一个图标，而屏幕上不会报任何错。
 */
export function questionTypeNickname(type: string): string {
  const found = QUESTION_TYPE_OPTIONS.filter((option) => option.value === type)[0];
  return found ? found.nickname : type;
}

export function questionTypeLabel(type: string): string {
  const found = QUESTION_TYPE_OPTIONS.filter((option) => option.value === type)[0];
  return found ? found.label : type;
}

export interface ChoiceOption {
  key: string;
  text: string;
  /** 选项可选配图。只接受本机上传目录，避免把外部跟踪图片带进学生端。 */
  imageUrl?: string;
}

/**
 * 判断题的**固定选项**。★ M4a：它是唯一一份 —— 教师端的判断题编辑体（`true-false-body.tsx`）
 * 与学生端的作答体（D2 的 `choice-body.tsx`）都从这里取，两处各写一份就会漂移
 *（教师看到「对 / 错」，学生那边不一样，**没有任何报错**）。
 *
 * 🔴 **判断题不存 `options`**（规格 §12）：题面只有题干 + 对/错两个按钮，
 * `data` 里只有 `correctKeys`。所以这份常量是「学生看到哪两个选项」的唯一答案，
 * 而它**不是** `data` 的一部分 —— 服务端判分（`judgeSingleChoice`）只读 `correctKeys`，
 * 学生的作答值是 `{ format: 'choice/v1', selected: ['T'] }`。
 *
 * ⚠️ `key` 用 `'T'` / `'F'` 是**协议**（A2 的判分用例逐字钉着 `correctKeys: ['T']`），
 * 改它等于改协议：库里已经落下的判断题会变成「没有任何学生能答对」。
 */
export const TRUE_FALSE_OPTIONS: ChoiceOption[] = [
  { key: 'T', text: '对' },
  { key: 'F', text: '错' },
];

/**
 * 判断题那两个选项**画出来的记号** —— `✓` / `✗`。
 *
 * 与看板抽屉里的对错标记同一族（`✓ 答对` / `✗ 答错`，见 `worksheet-drawer-state.ts`），
 * 也正是小学卷子上「对的打 √、错的打 ×」那个约定 —— `T` / `F` 对小学生是噪声。
 */
const TRUE_FALSE_BADGES: Record<string, string> = { T: '✓', F: '✗' };

/**
 * ★ 2026-09-27（教师）：「学生页面中两个选项不要使用 T 和 F，只勾勾和叉叉。」
 *
 * 🔴 **改的只是记号，不是 `key`。** `key` 是判分协议（服务端用例逐字钉着
 * `correctKeys: ['T']`）—— 动它等于让库里已有的判断题**没有任何学生能答对**。
 * ⇒ 「T 该显示成什么」是一条**派生**规则，住在**读**的一侧，与 `TRUE_FALSE_OPTIONS`
 * 那句「改 key 等于改协议」是同一件事的两面。
 *
 * ⚠️ 认不出的 key **原样吐回来**（不回落成空串、也不回落成某个记号）：那个格子什么记号
 * 都不画的后果是「学生看到一个没有记号的选项」，而屏幕上**没有任何报错**。
 * 来路有两条且都不报错：手工改过的库行、以及将来真加了第三态（「无法判断」之类）。
 */
export function optionBadge(type: string, key: string): string {
  if (type !== 'true-false') return key;
  return TRUE_FALSE_BADGES[key] ?? key;
}

/**
 * 这道选择题是不是**多选**口径（能勾多个正确答案）。
 *
 * ⚠️ `single-choice` + `data.choiceMode === 'multiple'` 也算 ——「多选题」是 M4a 之后才独立
 * 出来的题型，旧数据里那批多选仍然长在 `single-choice` 上。
 * 🔴 判据原来在 `multi-choice-body.tsx` 里各写一遍（一边画界面、一边定判分口径），两处漂移的
 * 后果是「勾了三个正确答案、保存下来只剩一个」。
 *
 * ★ 2026-09-27：**从 `worksheet-editor-core.ts` 搬到这里**。教师要求「学生页面中，如果是
 * 多选题的话，要在题干前面自动加上『多选』这样的提示文字」⇒ 学生端也要问同一个问题，
 * 而它读不到编辑页的内核（那边是给 `node --test` 用的纯函数内核，且只服务编辑页）。
 * 与其在学生端再抄一遍，不如搬到**两边都引**的这一份上；编辑页照旧从内核 import
 *（内核把它原样再导出，见那边的 `export { … }`），所以编辑页各处**一行都不用改**。
 * ⚠️ 那条「只有一份」的纪律现在由用例钉着（`worksheet-editor-core.test.ts` 里比函数同一性）。
 */
export function isMultipleChoice(node: { type: string; data: Record<string, unknown> }): boolean {
  return node.type === 'multi-choice' || node.data.choiceMode === 'multiple';
}

/**
 * ★ 2026-09-27（教师）：「选择和判断学生错误后也要与填空一样给出叉叉符号并给出正确答案。」
 *
 * 答错时该在**哪些选项**上打叉 —— 学生选中的那些里、不属于正确答案的。
 *
 * 🔴 **`correctKeys` 为空 ⇒ 一个都不打。** 这条闸不是可选的：服务端**只在判过分、且学生
 * 没全对**时才下发正确答案（`wrongChoiceAnswers`，那条窄口的注释写了完整理由），所以
 * 「空」同时包含「还没判分」与「全对了」两种情形。少了这道闸，一道**还没提交**的题会把
 * 学生勾过的每一个选项都打上叉 —— 而那正是「界面在说假话」。
 *
 * ⚠️ **多选漏选（只对了一部分）⇒ 空**：他没有选错任何一个，只是少选了。
 *    该告诉他的是「正确答案是 A、C」（那块提示区），不是给已选的打叉。
 *
 * ⚠️ 判据是**集合**：`selected` 的顺序是学生的点击顺序，逐人不同，与对错无关。
 */
export function wrongSelectedKeys(
  selected: readonly string[],
  correctKeys: readonly string[],
): string[] {
  if (correctKeys.length === 0) return [];
  return selected.filter((key) => !correctKeys.includes(key));
}

/**
 * 「正确答案」那句话里那一段 —— 把服务端发回来的那串 key 变成给学生看的字。
 *
 * 🔴 **判断题要翻成「对 / 错」**：它的 key 是协议里的 `T` / `F`（`TRUE_FALSE_OPTIONS` 的注释
 * 写了为什么不能改），而「正确答案 T」对一个小学生是噪声 —— 同一件事在抽屉那边也做过
 *（`worksheet-drawer-state.ts`：判断题**只印『对』、不印 key**，理由逐字相同）。
 *
 * ⚠️ 其余题型**原样回 key**（`A` / `B` / `C`）：题干里就是用字母指代选项的
 *（「下面哪个是 B」），翻成选项文字反而对不上；而且多选题的选项文字可能很长。
 *
 * ⚠️ 分隔符是顿号 `、`：一屏里可能有多个正确答案（多选），而逗号在中文里读起来像分句。
 */
/**
 * 服务端那串「答错时要展示的正确答案」→ **按下标排好的一列**。
 *
 * 线上形状是 `Record<下标, 答案>`（`routes/worksheets.ts` 的 `correctBlanks`，下标从 0 起），
 * 因为填空要按下标说「第几空」、而选择要按顺序排「A、C」—— 同一份形状服务两种题型。
 *
 * 🔴 **必须按数值排，不能按字典序。** 字典序下 `'10'` 会排在 `'2'` 前面，于是多选题的
 *    第 11 个答案跑到第二位去 —— 而屏幕上看起来只是一串「正确答案」，没人会发现顺序错了。
 *
 * ⚠️ 这一行 `.sort()` **今天其实可以省掉**：JS 对象对整数样式的键本来就按数值升序迭代
 *    （规范保证），所以删掉它输出一个字节都不变（变异检验实测）。留着是**刻意**的 ——
 *    显式排一次，读的人看得见「这里要求的是数值序」这条约定，而不必先想起那条规范细节。
 *    ⇒ **别以为这一行有用例守着**：用例钉的是输出顺序，不是这个实现。
 *
 * ⚠️ 顺带滤掉空串：填空那边「没设答案键的空」不发（见 `wrongBlankAnswers`），
 *    真漏进一个空串时也不该在「正确答案」后面写出一个空档。
 */
export function correctKeysFromPayload(byIndex: Record<string, string> | undefined): string[] {
  if (!byIndex) return [];
  return Object.keys(byIndex)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => byIndex[key])
    .filter((value): value is string => typeof value === 'string' && value !== '');
}

export function correctAnswerLabel(type: string, keys: readonly string[]): string {
  return keys
    .map((key) => (type === 'true-false'
      ? TRUE_FALSE_OPTIONS.filter((option) => option.key === key)[0]?.text ?? key
      : key))
    .join('、');
}

/**
 * 拍平题目树（含嵌套）。
 *
 * 规格 §4.3 的 `content` 是**嵌套树**（`children` 为将来的材料题组预留），第一批虽然
 * 没有任何容器编辑 UI（`children` 恒为空），但**读的一侧不能假装它不存在**：
 * 只渲染顶层节点的话，一份手工改过、带嵌套的 content 会让几道题**在屏幕上不存在**，
 * 而服务端算「整卷交齐」时把它们算进去 —— 学生永远交不了卷，且没有任何报错。
 *
 * ⚠️ 顺序与判据必须与服务端的 `flattenQuestions`（`server/src/services/worksheet-questions.ts`）
 * 同构：**先本节点、再按序递归 `children`**。服务端那个是「整卷交齐」与「题数」的权威，
 * 这个决定屏幕上画几道、进度条的分母是几 —— 两边不一致的表现是「进度条到不了头」。
 */
export function flattenQuestions(nodes: WorksheetQuestionNode[]): WorksheetQuestionNode[] {
  const out: WorksheetQuestionNode[] = [];
  nodes.forEach((node) => {
    out.push(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.push(...flattenQuestions(node.children));
    }
  });
  return out;
}

/**
 * ★ 2026-09-25：「任务」这个**容器类型**的类型串 —— 全项目唯一一份。
 *
 * ⚠️ 它**不在** `QuestionType` 联合里，也**不在** `QUESTION_TYPE_OPTIONS` 里：
 * 那个数组是「加题弹窗的九宫格」，而任务由另一个按钮加（教师裁定 ①：任务**不能作答**，
 * 它只是分组 + 一段说明）。两件事混进同一份清单的症状是教师在加题弹窗里选中「任务」、
 * 保存被服务端 400 拒 —— 那个窗口**真实发生过一次**（`drawing` 加进前端却没加进服务端）。
 *
 * 服务端那一份在 `services/worksheet-questions.ts` 的 `QUESTION_TYPES` 里（它**有**）；
 * 两份必须同时值 `'task'`，`worksheet-heading-parity.test.ts` 盯着本常量与镜像。
 */
export const TASK_TYPE = 'task';

/** `flattenAnswerable` 的一项：一道**可作答**的题，以及它在两级结构里的题号。 */
export interface AnswerableQuestion {
  node: WorksheetQuestionNode;
  /**
   * 两级题号：`任务一 · 1`。任务标题留空时**没有前缀**（就是 `1`）——
   * 不编一个「任务N」，理由见 `flattenAnswerable`。
   */
  heading: string;
  /**
   * **全卷连续序号** —— 题号去掉任务前缀的数字部分（`1`）。
   *
   * 🔴 矩阵按任务分块之后，段头已经把任务名说完了，小题上只画这一个数
   * ⇒ 那个数必须是**算出来的**，不许由渲染侧拿下标推：
   * 散题共用**跨全文**的计数器（散题 A、任务一、散题 B 里 B 是 `2`），
   * 而它在自己那一段里的下标是 0 —— `index + 1` 会印出一个不存在的「1」，
   * 屏幕上看起来只是「题号怪怪的」。用例把这条冲突摆明了（`worksheet-questions.test.ts`）。
   *
   * ⚠️ 它与 `heading` 是**同一个 `counter.n`**（`heading` 就是前缀拼上它）——
   * 两处不许分家，用例逐条核「题号的尾巴就是序号」。
   */
  label: string;
}

/**
 * 拍平成**可作答的题**，并给每一道带上两级题号（`任务一 · 1`）。
 *
 * 🔴 **为什么不是改 `flattenQuestions` 的返回值**：它是「递归展开这棵树」，
 * 展开出来的数组里**任务节点与小题混在一起**，而全仓有 11 个消费者拿它当「题列表」——
 * 其中至少四处在拿**下标当题号**（矩阵行）或拿 **`.length` 当「几道题」**（服务端题数）。
 * 改它的返回值，那 11 处会**各自静默地错**（多一格、题号整体后移、进度条到不了头）。
 * ⇒ 两者**分家**：`flattenQuestions` 原样不动（它就是「树里所有节点」），
 * 「一道题一条」的消费者改调本函数。
 *
 * 题号规则（2026-10-01 调整为全卷连续）：
 *   · 全卷所有可作答小题连续编号，任务只提供标题前缀，不重置序号；前缀是任务节点的 `prompt`（那是它的**标题**，迁移写的就是
 *     「任务一」这种；§六 把 task 级操作叫「改名」）；
 *   · 标题留空 ⇒ **不带前缀**。这里**不按位置编一个「任务N」** —— 那等于替教师写一个
 *     他没写过的名字，与「迁移不猜内容」是同一条纪律（裁定 ①a：纯分组是合法数据）；
 *   · 散题（顶层非任务节点）同样使用这一个全卷计数器，不带前缀。
 *
 * ⚠️ 遍历顺序**必须**与 `flattenQuestions` 同构（先本节点、再按序递归 `children`）：
 * 两个函数一个决定「屏幕上画几道、什么顺序」，一个决定「题号是几」，
 * 不同构的表现是题号与题**错位**，而屏幕上看起来只是「题号怪怪的」。
 * `worksheet-questions.test.ts` 有一条用例把两者逐项比对钉住。
 *
 * ⚠️ 非任务节点带 `children`（手工改过的库）时，孩子**沿用同一层序号**继续往下编 ——
 * 与 `flattenQuestions` 的 DFS 同序，不丢题也不另起一套号。
 */
export function flattenAnswerable(nodes: WorksheetQuestionNode[]): AnswerableQuestion[] {
  const out: AnswerableQuestion[] = [];
  /**
   * `children` 的守卫 —— **与 `flattenQuestions` 逐字同形**（它写的是 `Array.isArray(node.children)`）。
   *
   * 🔴 少了它，一行手改过的数据（`children: {}` / `42` / `true`）会**抛**
   * `TypeError: list is not iterable`，而 `children: "ab"` 更坏 —— 它会**按字符迭代**，
   * 编出两个单字符的假题一路流下去。要紧的是本函数落在**写路径**上（服务端的
   * `findQuestion` 用它判「这道题属不属于这份学习单」，且**没有 try/catch**）
   * ⇒ 一份坏数据让学生**每次保存都 500**，而同一份数据喂给 `flattenQuestions` 读得出来。
   */
  const kids = (node: WorksheetQuestionNode): WorksheetQuestionNode[] => (
    Array.isArray(node.children) ? node.children : []
  );

  /** 全卷只有一个计数器：进入新任务只换标题前缀，不从 1 重新开始。 */
  const counter = { n: 0 };
  const walk = (list: WorksheetQuestionNode[], prefix: string, counter: { n: number }) => {
    for (const node of list) {
      if (node.type === TASK_TYPE) {
        const title = typeof node.prompt === 'string' ? node.prompt.trim() : '';
        // 任务只切换标题前缀，序号仍沿用全卷计数器。
        walk(kids(node), title ? `${title} · ` : '', counter);
        continue;
      }
      counter.n += 1;
      // ⚠️ `heading` 与 `label` 是**同一个 `counter.n`** 的两种写法：一个是给人看的
      // 两级题号，一个是分块之后剩下来的那个数。分两次算就是给自己留一个会漂的副本。
      out.push({ node, heading: `${prefix}${counter.n}`, label: String(counter.n) });
      walk(kids(node), prefix, counter);
    }
  };
  walk(nodes, '', counter);
  return out;
}

/**
 * 学生端的一**段**：一个任务（或一段连续的散题）以及它的小题。
 *
 * ★ 2026-09-25（教师裁定）：学生看到的那一页**按任务分块** ——
 * 任务名自己占一行，下面挂它的小题；小题上不再挂题号、也不再写题型文字
 *（题型退化成一个象形图标，见 `worksheet-question-icons.tsx`）。
 */
export interface AnswerableGroup {
  /**
   * 这一段的主标题 —— 任务的 `prompt`（去首尾空白）。
   * `null` = **没有标题行**：散题那一段，或一个标题留空的任务。
   * ⚠️ `null` 时刻意**不编**一个「任务一」（与题号无前缀、迁移不猜是同一条纪律）。
   */
  title: string | null;
  /**
   * ★ 2026-09-25（教师裁定）：任务的**描述** —— 例如「读下面的材料，回答 1–3 题」。
   *
   * 存在任务节点的 `data.description`（`content` 是 JSON 列 ⇒ 不动库结构、不用迁移），
   * **两边都显示**（学生端在任务标题下、编辑页在标题输入框下）。
   * `null` = 没有描述：散题那一段，或教师没写 / 只写了空白。
   *
   * ⚠️ 它与 `title` 是**两件事**：`title` 是任务的**名字**（学生会看到它作为题号前缀），
   * 而描述是那一段的说明。裁定 ①a 的原话是「任务 = 分组 + **一段说明**」——
   * 这个字段就是那句话里的「说明」。
   */
  description: string | null;
  items: AnswerableQuestion[];
}

/**
 * 把题目树切成**段**：一个任务一段；**连续**的散题合成一段（无标题）。
 *
 * ⚠️ 「连续」是有意的：散题 A、任务一、散题 B 是**三段**（A 与 B 不合成一段）——
 * 它们中间隔着一个任务，合起来会让那一段的标题位置变得没有意义。
 *
 * ⚠️ 顺序与 `flattenAnswerable` **逐项相同**（用例钉着），因为两处都从
 * 「先本节点、再按序递归 children」那条遍历来。
 */
export function groupAnswerable(nodes: WorksheetQuestionNode[]): AnswerableGroup[] {
  // ⚠️ 题号（含散题那个**跨全文**的计数器）由 `flattenAnswerable` **算一次** ——
  // 逐节点分别调用会把散题的计数器每组重置成 1，于是每道散题都叫「1」。
  // 这里只做**切段**：因为拍平是 DFS、一个顶层节点的全部可作答后代在结果里**必然连续**，
  // 所以按各顶层节点的条数顺序切即可（条数用同一个函数数，不另写一份遍历规则）。
  const items = flattenAnswerable(nodes);
  /** 读任务的描述。**容错**（`data` 是库里的 JSON）：非字符串 / 空白的都当没有。 */
  const descriptionOf = (node: WorksheetQuestionNode): string | null => {
    const raw = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>).description : undefined;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  };

  const groups: AnswerableGroup[] = [];
  let loose: AnswerableQuestion[] = [];
  let cursor = 0;
  const flushLoose = () => {
    if (loose.length > 0) { groups.push({ title: null, description: null, items: loose }); loose = []; }
  };

  for (const top of nodes) {
    const count = flattenAnswerable([top]).length;
    const itemsOfTop = items.slice(cursor, cursor + count);
    cursor += count;
    if (top.type === TASK_TYPE) {
      // ⚠️ 「连续」的散题才合成一段：中间隔了一个任务，就不属于同一段了。
      flushLoose();
      const title = typeof top.prompt === 'string' ? top.prompt.trim() : '';
      groups.push({ title: title || null, description: descriptionOf(top), items: itemsOfTop });
      continue;
    }
    loose.push(...itemsOfTop);
  }
  flushLoose();
  return groups;
}

/**
 * 学生端要画的那几段 —— **空任务整段丢掉**（这是学生端与编辑页唯一的口径差别）。
 *
 * 教师 2026-09-25 裁定「允许空任务」：编辑器里点「+ 添加任务」之后还没放小题时，
 * 容器是一块看得见、可以往里加东西的地方。而**学生端**那一侧，一个空任务渲染出来
 * 是一行光秃秃的标题、下面什么都没有 —— 那是「渲染坏了」的长相，不是「这里可以加」。
 */
export function studentVisibleGroups(nodes: WorksheetQuestionNode[]): AnswerableGroup[] {
  return groupAnswerable(nodes).filter((group) => group.items.length > 0);
}

/** 选项的 key 由**位置**派生（A、B、C…），与规格 §4.3 的示例一致。 */
export function optionKey(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 读某道题的选项。**容错**：`data` 来自库里的 JSON，任何手改过的行都可能有别的形状。 */
export function readOptions(node: WorksheetQuestionNode): ChoiceOption[] {
  const raw = node.data.options;
  if (!Array.isArray(raw)) return [];
  const options: ChoiceOption[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const option = item as Record<string, unknown>;
    // 缺 key 的正常行由 `newQuestion` 保证不会出现；这里按**已收下的条数**补一个，
    // 而不是按原始下标 —— 跳过垃圾条目之后下标会留下空洞（A、C、D…）。
    options.push({
      key: typeof option.key === 'string' && option.key ? option.key : optionKey(options.length),
      text: typeof option.text === 'string' ? option.text : '',
      ...(typeof option.imageUrl === 'string' && option.imageUrl.startsWith('/uploads/chat/')
        ? { imageUrl: option.imageUrl }
        : {}),
    });
  });
  return options;
}

/**
 * ⚠️ **`WorksheetAnswerValue` / `AnswerDraft` 与四个转换函数已经搬到
 * `worksheet-answer-value.ts`**（D1），本文件**转出**它们（见文件头）。契约说明
 *（「协议是判分器读哪些字段名，不是 `format` 串」那张表、`links` / `assignment` 的裁定）
 * 也一起搬去了那边 —— 只有一份，别在这里再写一遍。
 *
 * ★ M4b：手写与绘图（`ink/v1` / `drawing/v1`）**已经加进那个联合**（共用同一个成员
 * `InkValue`，裁定 6「一个实现、两个 format 名」）。上面那个 `QuestionType` 多出来的
 * `'drawing'` 是**这一半的落地方式**：规格 §12 的 M4 范围表里「手写笔迹」是**输入方式、
 * 非题型**（所以它不在这里，它是题目节点上的 `inputMode: 'handwriting'`，由
 * `worksheet-ink.ts` 的 `isInkNode` 认），而「绘图题」是**题型** —— 题型必须有题型名。
 *
 * ⚠️ 由此 `QUESTION_TYPE_OPTIONS` 从 **8 条变 9 条**，而那句「**8 个题型**」说的**不是这个数** ——
 * 它的 8 是 **M4 范围表的行数**（6 个题型 + 2 个能力）：`specs/2026-09-23-milestones.md:73`
 * 逐字列着「… · 手写笔迹 · 绘图题」，那两项里只有后一项是题型。
 * ★ 规格自己对这件事有一条 2026-09-24 的追认，逐字在 `specs/2026-09-23-p1-worksheet.md:1263`：
 * 「§12 的『8 个题型』那张表列的是 **M4 范围的行数**，含手写笔迹与绘图题两项；而
 * `QUESTION_TYPES` 的**条目数**在 M4a 起就是另一回事」⇒ 两个计数**不是同一个数**，别混。
 * 本文件数的是**条目数**（沿用 M4a 的口径），所以是 9。
 */
