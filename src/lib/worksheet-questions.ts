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
 * ⚠️ **本文件不引任何 React / DOM，也不引任何联名路径（`@/…`）**：它要能被
 * `node --test` 直接执行（Node 24 的类型擦除），而内核是**相对路径**引它的
 * （`'../../../../lib/worksheet-questions.ts'`）—— 带 `.ts` 后缀是那件事的前提，
 * `tsconfig.json` 的 `allowImportingTsExtensions` 已开。
 * 同理，`import type` 是**唯一**的 import 形态（类型擦除会整段删掉它）。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 */

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
  | 'order' | 'match' | 'categorize';

/**
 * 题型清单。**加题弹窗、每张卡片右上角的题型名、学生端的题号旁标签共用这一份。**
 *
 * 🔴 `graded` 这一格是 M4a 加的，**它不是描述、是判据**：`true` ⇒ 教师看板的格子上会画
 * ✓/◐/✗，`false` ⇒ 只统计作答进度。它存在的理由是「加题型」这个动作**必须**同时回答
 * 「它判不判分」—— 见 `src/app/teacher/classroom/worksheet-drawer-state.ts` 的
 * `GRADED_QUESTION_TYPES`（它现在从这一格**派生**，不再是一份并列的白名单，
 * 那份白名单漏改的表现是「正确率把新题型算进分母，格子上却不画任何标记」，全程无报错）。
 */
export const QUESTION_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  hint: string;
  /** 能不能自动判分。`true` ⇒ 看板会画 ✓/◐/✗；`false` ⇒ 只统计作答进度。 */
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
];

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
 * 提交给服务端的**作答值**（规格 §4.3）。
 *
 * 🔴 **格式串是协议的一部分**，不是给界面看的：服务端的判分（`grade()`）按 `format` 分派。
 * 改这里的字符串等于改协议，两边必须同时改。
 *
 * ⚠️ 手写与绘图（`ink/v1` / `drawing/v1`）**第一批不产生**，所以这个联合里没有它们 ——
 * 第一批的 UI 也不提供产生它们的路径。
 */
export type WorksheetAnswerValue =
  | { format: 'choice/v1'; selected: string[] }
  | { format: 'fill/v1'; text: string }
  | { format: 'text/v1'; text: string };

/**
 * 界面上**一道题的输入态**（还没变成作答值）。
 *
 * 单选只用 `selected`（存选中的 key，空串 = 没选），填空与问答只用 `text`。
 * 一个形状两种题型都用，是因为两者**互斥**：一道题是哪一种由 `node.type` 决定，
 * 拆成两个状态容器只会让「哪道题现在是哪种」多一处需要同步的地方。
 */
export interface AnswerDraft {
  selected: string;
  text: string;
}

export function emptyDraft(): AnswerDraft {
  return { selected: '', text: '' };
}

/** 这一题的输入态里**有没有东西**。空白字符不算（单选没有这个问题）。 */
export function isDraftEmpty(draft: AnswerDraft): boolean {
  return !draft.selected && !draft.text.trim();
}

/**
 * 把界面上的输入态变成**作答值**；`null` = 「这一题没有内容可提交」。
 *
 * 单选：没选任何选项 ⇒ `null`；填空 / 问答：全是空白 ⇒ `null`。
 * ⚠️ 判断题面与空值的是**这里**，别在调用点再写一遍 —— 服务端对「没作答就提交」回 400,
 * 而那条 400 的文案是「请先作答再提交本题」；前端如果自己算错了「有没有内容」，
 * 学生就会点到一个必然失败的按钮。
 */
export function buildAnswerValue(node: WorksheetQuestionNode, draft: AnswerDraft): WorksheetAnswerValue | null {
  if (node.type === 'single-choice') {
    return draft.selected ? { format: 'choice/v1', selected: [draft.selected] } : null;
  }
  if (node.type === 'fill-blank') {
    return draft.text.trim() ? { format: 'fill/v1', text: draft.text } : null;
  }
  if (node.type === 'short-answer') {
    return draft.text.trim() ? { format: 'text/v1', text: draft.text } : null;
  }
  // 未知题型：**不产生作答**。给它编一种格式会让服务端收到一个它判不了的形状，
  // 而那份作答会以「已提交」的样子出现在教师看板上。
  return null;
}

/**
 * `buildAnswerValue` 的**反向**：把一个作答值读回界面上的输入态。
 *
 * 用在两处，都是「屏幕上的东西必须和学生写过的一致」：
 *   · 学生端面板挂载时，把 `localStorage` 队列里**还没发出去**的作答填回输入框
 *     （刷新一下不该让答案从屏幕上消失，哪怕它还在队列里）；
 *   · 教师端抽屉显示「原答案」（D4）。
 *
 * ⚠️ 容错：值可能来自手改过的行或上一个版本，读不出来就返回 `emptyDraft()`，
 * **不抛**。它是渲染路径上的东西，一次 TypeError 会让整个面板白屏。
 */
export function draftFromValue(value: unknown): AnswerDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDraft();
  const row = value as Record<string, unknown>;
  if (row.format === 'choice/v1') {
    const selected = Array.isArray(row.selected) ? row.selected : [];
    const first = selected.filter((key): key is string => typeof key === 'string' && !!key)[0];
    return { selected: first ?? '', text: '' };
  }
  if (row.format === 'fill/v1' || row.format === 'text/v1') {
    return { selected: '', text: typeof row.text === 'string' ? row.text : '' };
  }
  return emptyDraft();
}
