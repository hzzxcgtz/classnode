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
  | 'drawing';

/**
 * 题型清单。**加题弹窗、每张卡片右上角的题型名、学生端的题号旁标签共用这一份。**
 *
 * 🔴 `graded` 这一格是 M4a 加的，**它不是描述、是判据**：`true` ⇒ 教师看板的**抽屉里**会画
 * ✓/½/✗（⚠️ **不是方格阵的格子** —— 对错标记在抽屉里、不在看板格子上，规格 §7.2；
 * §12 那句「半对必须在看板那一侧画得出来」已于 2026-09-24 更正为「是抽屉里」），
 * `false` ⇒ 只统计作答进度。它存在的理由是「加题型」这个动作**必须**同时回答
 * 「它判不判分」—— 见 `src/app/teacher/classroom/worksheet-drawer-state.ts` 的
 * `GRADED_QUESTION_TYPES`（它现在从这一格**派生**，不再是一份并列的白名单，
 * 那份白名单漏改的表现是「正确率把新题型算进分母，抽屉里却不画任何标记」，全程无报错）。
 */
export const QUESTION_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  hint: string;
  /** 能不能自动判分。`true` ⇒ 看板的**抽屉里**会画 ✓/½/✗；`false` ⇒ 只统计作答进度。 */
  graded: boolean;
}> = [
  { value: 'single-choice', label: '单选题', hint: '若干选项，只有一个正确答案', graded: true },
  { value: 'true-false', label: '判断题', hint: '对 / 错两个选项', graded: true },
  { value: 'multi-choice', label: '多选题', hint: '若干选项，正确答案可以不止一个', graded: true },
  { value: 'fill-blank', label: '填空题', hint: '学生填一段文字，答对任一可接受答案即算正确', graded: true },
  { value: 'order', label: '排序题', hint: '把打乱的条目排成正确顺序', graded: true },
  { value: 'match', label: '连线题', hint: '把左栏与右栏一一连起来', graded: true },
  { value: 'categorize', label: '归类题', hint: '把若干条目拖到对应的框里', graded: true },
  { value: 'short-answer', label: '问答题', hint: '主观题，不自动判分', graded: false },
  // ★ M4b：`drawing` 这个题型名是**本计划的裁定**（规格没有给）—— 见 `QuestionType` 的注释。
  // `graded: false` **是有意的决定，不是补测试**：手写 / 绘图不参与自动判分（规格 §12 裁定 3）。
  // 服务端那一侧有**两条**闸（B1，提交 `e1ff80c`）：`JUDGES.drawing` 恒回 `null`；
  // `judge()` 见到 ink 值**直接短路回 `null`**（后一条管的是「题型不是 `drawing`、值却是 ink」）。
  // ⚠️ 这句话的依据**不是** Global Constraints 里的某一条（那里没有这句话），
  // 而是规格 §12 裁定 3 本身 + `worksheet-answer-value.ts` 里那段「`format` 在服务端只被读两处、
  // 两处都不拿它当判据」（现在在 `:48-71`）—— B1 之前它写的是「`format` 服务端一个字节都不读」。
  // 这一格是 false ⇒ 看板抽屉里只统计作答进度、不画 ✓/½/✗（`GRADED_QUESTION_TYPES` 从这一格派生）。
  { value: 'drawing', label: '绘图题', hint: '学生在画布上画图，不自动判分', graded: false },
];

/**
 * ★ M4a：**逐题分值**（全对 / 半对两档）的取值上限 —— 与服务端
 * `services/worksheet-questions.ts` 的 `POINTS_MAX` 是**同一对**字面量（服务端读不到 `src/`）。
 *
 * 🔴 两处必须一起改，且**不能只改一处**：服务端的 `normalizePointValue` 对越界值
 * **回落** `DEFAULT_POINTS`（全对 1 / 半对 0），不是拒绝保存 —— 所以前端放宽而服务端不放宽时，
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
 * 学生端对错档按 `score >= 1` 画 ⇒ **红叉**；教师抽屉读 `gradeState` ⇒ **`✓ 答对`（绿）**
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
export function questionTypeLabel(type: string): string {
  const found = QUESTION_TYPE_OPTIONS.filter((option) => option.value === type)[0];
  return found ? found.label : type;
}

export interface ChoiceOption {
  key: string;
  text: string;
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
