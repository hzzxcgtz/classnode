'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { QuestionPointsDraft, WorksheetQuestionNode } from '@/lib/types';
import { readPromptImage, readPromptRunsFor, worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { PromptText } from '@/lib/worksheet-prompt-text';
// ★ 2026-09-26（spec 第 4 步）：题干的**所见即所得**编辑器（contenteditable）。
// 它单独一个文件是因为里面全是**本机验不了的** DOM 原语（光标 / 选区 / 重建），
// 混在这张卡片里会把「卡片只负责画控件」这条分工冲掉。
import { PromptEditor } from './prompt-editor';
// ★ 2026-09-27：「粘贴题目」的确认窗（题干 + 选项一起识别）—— 单独一个文件，
// 因为它是**一次粘贴**的界面，与「画一道题的控件」不是同一件事。
import { PasteQuestionDialog, type PasteQuestionResult } from './paste-question-dialog';
import {
  canGivePartial,
  maximumPointsFor,
  displayPoints,
  effectiveHalfStep,
  gradesOnSubmit,
  isGradedQuestionType,
  toleranceOf,
  choiceModePatch,
  isChoiceQuestion,
  isMultipleChoice,
  isPartialPoints,
  parsePointInput,
  pasteDataPatch,
  planPointInputChange,
  pointText,
  POINTS_FULL_MIN,
  POINTS_MAX,
  pointsSignature,
  QUESTION_TYPE_OPTIONS,
  readBlankAnswers,
  type RejectedPointInput,
  shouldWarnZeroHalfCredit,
  showsPartialPoints,
  // 从**纯函数内核**直接取：这张卡片只用纯逻辑，不碰 hook（React 状态 / 路由 / 网络）。
  // 内核就是 `node --test` 直接跑的那一份，回归网在 `worksheet-editor-core.test.ts`。
} from './worksheet-editor-core';
// ★ 2026-09-26：**学生端那套只读题面**（九种题型一份实现）。跨目录引用与本页的
// 「学生端预览」弹窗同源（`preview-modal.tsx` 引 `WorksheetQuestionList`）——
// 规格 §6.3 要的就是「教师看到的就是学生看到的」。
import { QuestionInput } from '@/app/classroom/worksheet/questions';
// ★ M4a：6 个题型的编辑体（单选复用 `choice-options` 那一个受控组件）。
// 组件与内核分家的理由见各文件头：内核里全是可以 `node --test` 的纯函数，
// 组件这一层**没有回归网**（本仓没有 jsdom / testing-library）。
import { TrueFalseBody } from './bodies/true-false-body';
import { ChoiceOptionsBody, ChoicePartialCreditBody } from './bodies/multi-choice-body';
import { ChoiceBlankSetup, SymbolListInput } from './bodies/fill-blanks-body';
// ★ 2026-09-30：主观题的**参考答案**（不判分）。输入框与填空题那份是**同一个组件**。
import { fillGradingTotals, fillSettingsFor, hasExplicitFillGrading, splitChoiceText } from '@/lib/worksheet-fill-modes';
import { TableBody } from './bodies/table-body';
import { tableMarkIndex } from '@/lib/worksheet-table';
// ⚠️ 只引 `OrderBody` —— `OrderAnswerBody`（正确顺序）现在住在它里面（两栏并排），
//    这一页不再直接渲染它。
import { OrderBody } from './bodies/order-body';
import { MatchBody } from './bodies/match-body';
import { CategorizeBody } from './bodies/categorize-body';
import { DrawingSettings } from './bodies/drawing-settings';
// ★ M4b/D1：「这道题是不是手写作答」这个判据只有一份，在 `src/lib/worksheet-ink.ts`
//（学生端的分派器 `questions/index.tsx` 用的也是它）。此处**不重写**那条判据 ——
// 重写一遍就是两份真源，而它们漂移的后果是「教师在教师端选的档」与「学生端拿到的输入形态」
// 不一致，且屏幕上看不出来。
import { isInkNode } from '@/lib/worksheet-ink';
import { questionTypeIcon } from '@/lib/worksheet-question-icons';
import { api } from '@/lib/api';
import { normalizePastedText } from '@/lib/worksheet-text-normalize';
// ★ 2026-10-06：判断「这一题的作图工具是不是流程图」只有这一份判据 —— 教师端那个
// 作图工具选择器（`bodies/drawing-settings.tsx`）与学生端画布读的是同一个函数。
import { readDrawingTool } from '@/lib/worksheet-drawing';
import { EditorIcon, TrashIcon } from './editor-icons';

/**
 * 作答体那一块的标题 / 说明（**只服务 `answerBlock` 的兜底那一支**）。
 *
 * 🔴 ★ 2026-10-06：这里原来有 10 条，其中 5 条（single-choice / multi-choice / true-false /
 *    fill-blank / choice-blank）**永远渲染不到** —— 唯一读取点是 `answerBlock`，而
 *    `answerBlock` 先给那五种题型分派了各自的标题：
 *      · `true-false` ⇒ `null`（它的答案「对 / 错」住在题干后面那一块里）；
 *      · 选择题（单选 / 多选）⇒「选项」；
 *      · 填空题与选择填空 ⇒「填空设置」。
 *    ⇒ 到得了这张表最后一行的只有 order / match / categorize / short-answer / drawing
 *      （也就是下面剩下的这五条）。删掉那五条**不改变任何渲染**，只是把那句「死文案」
 *      从屏幕上拿掉（它连注释都在讲一条早已搬走的粘贴入口）。
 * ⚠️ `Partial<…>`：表里只剩五种题型，读取点于是必须自己兜底（下面 `?? { … }`）——
 *    写回 `Record<…>` 的话索引签名会谎报「一定取得到」，兜底看起来像死代码。
 *    ⚠️ 题型串是 `string`（库里手工改过的行可能有任何值）⇒ 兜底那一支**不是**摆设。
 */
const QUESTION_EDITOR_COPY: Partial<Record<string, { title: string; description: string }>> = {
  order: {
    title: '选项顺序',
    // 两栏直接用「学生看到 / 正确顺序」点明含义，不再常驻额外说明。
    description: '',
  },
  match: {
    title: '连线项目与正确配对',
    description: '',
  },
  categorize: {
    title: '分类框与条目归属',
    // 两个子区块已分别叫「分类框」与「条目与归属」，不再复述操作。
    description: '',
  },
  'short-answer': {
    title: '学生作答',
    // 档位由紧下方的单选控件自己说明，不另外复述。
    description: '',
  },
  drawing: {
    title: '学生作答',
    // 画板绘制 / 照片上传就在紧下方，这里不再复述。
    description: '',
  },
};

/**
 * ★ 2026-10-06（教师，信息科技课的流程图作业）：AI 评分那一块的**结构要点模板**。
 *
 * 🔴 这段文字是**信息科技课标对流程图的结构要求**（判断框要两分出边并标 是/否、循环要有回边、
 *    一个框只说一步操作、要有明确的开始与结束）—— 面向中小学信息科技课的标准流程图作业，
 *    判的是**结构**（这几条对不对），不是画得好不好看。
 *    ⇒ 所以模板里一个字都不讲美观，只讲结构。
 * ⚠️ 标注写法必须与**画板的默认值**一致：画板判断框出边的默认标注是「是 / 否」
 *    （`DECISION_BRANCH_LABELS`，中文教材口径），快照那边也照它画 ⇒ 这里写 `Y/N` 会自相矛盾
 *    （学生照着模板写 Y/N，画板给的是是/否，两边都不报错）。
 * ⚠️ 放在**命名常量**里：课标表述将来要跟着教材改时，只改这一处（与按钮上的写入共用它）。
 */
const STRUCTURE_POINTS_TEMPLATE =
  '判断框必须有两分出边并标注 是/否；循环必须有一条回到判断框的线；每个框的文字要说清一步操作；流程要有明确的开始与结束。';

/**
 * 标题栏右上角那个**滑动开关**（★ 2026-09-27）。
 *
 * 🔴 **一份实现**：「多选」与「自动评分」是同一个控件（都是「一个布尔档」），
 * 各写一份必然在某一处先变样。滑块本体的样式是 `.worksheet-editor-autograde-control`，
 * 这个组件只负责「标签 + 滑块」那一行的排版。
 *
 * ⚠️ `text` 可以不给 —— 自动评分那张卡的**标题就是它的名字**，再写一遍是重复
 * （教师 2026-09-27：「做得简洁一下，两个框及文字可以合并」）。
 */
function HeadSwitch({ checked, onChange, label, title, text }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏念的名字（画面上那点小字对它不够用）。 */
  label: string;
  title: string;
  /** 开关左边的小字。省略 ⇒ 只有滑块（名字由所在卡片的标题给）。 */
  text?: string;
}) {
  return (
    <label className="worksheet-editor-head-switch" title={title}>
      {text}
      <span className="worksheet-editor-autograde-control">
        <input
          type="checkbox"
          checked={checked}
          onChange={event => onChange(event.target.checked)}
          aria-label={label}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

/**
 * 一道题的编辑卡片（规格 §6.2 的题流）。
 *
 * 分工：卡片只负责**把这道题的控件画出来并把改动交给 reducer**，不做校验、
 * 不碰网络、不碰历史栈。所有写入口都是 `onPromptChange` / `onDataChange` / `onPointsChange`，
 * 它们最终都落到 `contentReducer` 上。
 *
 * ⚠️ 这里有几处「看起来像校验」的东西，它们**不是**判据，只是本地提示：
 *   1. 少于两个选项时禁用删除按钮（服务端要求 `options.length >= 2`）；
 *   2. 没选正确答案时给一句提示；
 *   3. 分值只填了一个框时给一句提示（真正的拦阻在 `save()` 的 `findPartialPoints`）；
 *   4. 多选「漏选算部分给分」+ 部分给分档 0 时给一句提示（规格 §12 裁定 3 的连带要求）。
 * 真正的判据在服务端（`routes/worksheets.ts` 的 `parseContent` → `validateQuestion`），
 * 保存失败时会把逐题的原因原样带回来。这里重复一遍是为了**不必先保存一次才知道**，
 * 但它们可能与服务端漂移 —— 漂移的后果只是提示早晚，不是放行。
 */
export function QuestionCard({ heading, index, expanded, focusedMode = false, onToggle, inTask, taskId, onDragStart, node, inheritedPoints, pointsUnit, rejectedPointInput, onPromptChange, onDataChange, onPointsInputChange, onPointsChange, onInputModeChange, onAutoGradeChange, onToleranceChange, onNotice, onRemove }: {
  /**
   * ★ 2026-09-25（第二轮终审 F3）：卡片上显示的**两级题号**（`任务一 · 2`）——
   * 与看板列头 / 抽屉 / 导出 / **保存失败的报错**同一份，由 `editorRenderRows` 给出。
   *
   * 🔴 它取代了原来的 `index + 1`（容器内下标）。那个数在正常路径上就错：两个任务时
   * 同屏有**两张「第 1 题」**，而保存失败说「任务二 · 1 的分值只填了一个框」——
   * 教师得在两处「第 1 题」之间猜是哪一张。
   * ⚠️ `index` 同时是**折叠态徽章**上那个「任务一 · 2」的来源（`badgeLabel`），
   *    所以它必须留着 —— 「换位是同层内的」这条规则也仍然成立（拖拽那一路）。
   */
  heading: string;
  /** 同层内的位置（0-based）—— 折叠态徽章用它，**不是**给换位边界用的了（见下）。 */
  index: number;
  /**
   * ★ 2026-09-26（spec 第 2 步）：**这张卡展开了没有**（一页 20 题，只展开一张）。
   * 折叠态只画一行摘要（题号 · 题型 · 题干一行 · 分值 · 工具）；展开态才是今天这一整张。
   */
  expanded: boolean;
  /** 工作台聚焦模式下当前题始终展开，摘要行只承担题号与题型说明。 */
  focusedMode?: boolean;
  onToggle: () => void;
  /** ★ 2026-09-26：这道题是不是**任务里的小题**（决定徽章显不显示任务名前缀）。 */
  inTask: boolean;
  /** ★ 2026-09-26（spec 第 5 步）：它所在的那一层 —— 任务 id，顶层散题是 `null`。 */
  taskId: string | null;
  /** ★ 2026-09-26：指针落在把手上 ⇒ 开始拖（拖动中不该顺手把卡片展开）。 */
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  node: WorksheetQuestionNode;
  /**
   * 学习单级的**两档**（`settings.rewardStep` / `settings.halfStep`）—— 逐题留空时继承的就是它们。
   * ⚠️ 它的用法**只有两种**：画「继承中」的占位符、以及判断「部分给分 0 分」那条提示。
   * **不要**拿它去预填输入框 —— 预填等于把继承拍成了副本（规格 §12 裁定 4 的理由）。
   */
  inheritedPoints: { full: number; half: number };
  /**
   * ★ 2026-09-26（教师）：「这里要根据学习单的设置来调整，比如几朵花，几颗五角星，
   * **不能一直使用「分」**。」—— 逐题分值的**量词**，由学习单的奖励档决定
   *（`pointsUnitLabel`，它有纯函数用例）。⚠️ 由上层算好传进来：卡片只负责画，
   * 而「哪一档配哪个量词」是一个能被 `node --test` 钉住的判据。
   */
  pointsUnit: string;
  /** 这一题那两格里**还没进 reducer** 的文本（`useWorksheetEditor` 持有，见 `PointsRow`）。 */
  rejectedPointInput: RejectedPointInput | undefined;
  /**
   * ★ 2026-09-26：第二个参数是**与题干同一次**提交的 `data` 补丁（题干的格式分段）。
   * 🔴 类型上必须带上它 —— 少一个参数，`PromptEditor` 传进来的格式会被**静默丢掉**
   * （编译器不报错：少参函数可以赋给多参签名），症状是「设了格式、保存后没了」。
   */
  onPromptChange: (prompt: string, data?: Record<string, unknown>) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
  /** ★ M4b/D1：逐题的作答方式（键盘 / 手写）。走 reducer，所以进撤销栈。 */
  onInputModeChange: (inputMode: 'keyboard' | 'handwriting' | 'photo') => void;
  /** ★ 2026-09-26：「允许自动评分」那个开关。 */
  onAutoGradeChange: (autoGrade: boolean) => void;
  /** ★ 2026-09-26：部分给分的容错档。`null` = 缺省（旧规则「只要有一部分对就给分」）。 */
  onToleranceChange: (tolerance: number | null) => void;
  /**
   * ★ 2026-09-30（教师第三轮）：说一句话给教师听 —— 由 `PromptEditor` 转给公式弹窗，
   * 供「复制成功」那句提示用。**在这里只是个过路参数**（真正的 toast 在编辑页那一层）。
   * ⚠️ 第三轮把公式入口搬回题干工具栏之后，弹窗住进了 `PromptEditor`，
   * 而 toast 住在 `page.tsx` ⇒ 中间必须有人把它转下去，否则复制成功一声不吭。
   */
  onNotice: (message: string, type: 'success' | 'error') => void;
  onRemove: () => void;
}) {
  const typeOption = QUESTION_TYPE_OPTIONS.find(option => option.value === node.type);
  const typeLabel = node.type === 'single-choice' || node.type === 'multi-choice'
    ? (isMultipleChoice(node) ? '多选题' : '单选题')
    : typeOption?.label ?? node.type;
  const promptRuns = readPromptRunsFor(node);
  const promptImage = readPromptImage(node);

  /**
   * ★ 2026-09-27（教师）：「在题目内容框内增加从剪贴板粘贴类似的按钮，不要使用在选项框内
   * onpaste，还是有个按钮用户使用更方便。」+「连题干也一起识别」。
   *
   * `pasteOpen` 开着时那个确认窗才存在；`pasteText` 是框里的原文 —— **可编辑**：
   * 读不到剪贴板时它是唯一的输入口，读到了也能改（拆错了就地改一行比重来一遍快）。
   */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const rubricImageInputRef = useRef<HTMLInputElement>(null);
  const [rubricUploading, setRubricUploading] = useState(false);
  const rubricText = typeof node.data.rubricText === 'string' ? node.data.rubricText : '';
  const rubricImageUrl = typeof node.data.rubricImageUrl === 'string' ? node.data.rubricImageUrl : '';

  const uploadRubricImage = async (file: File) => {
    setRubricUploading(true);
    try {
      const result = await api.uploadWorksheetImage(file);
      onDataChange({ rubricImageUrl: result.url });
      onNotice('评分标准图片已上传', 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '评分标准图片上传失败', 'error');
    } finally {
      setRubricUploading(false);
      if (rubricImageInputRef.current) rubricImageInputRef.current.value = '';
    }
  };

  /**
   * 点「粘贴题目」：**只开窗**，不碰剪贴板。
   *
   * 🔴 这里原来写的是 `await navigator.clipboard.readText()` —— 那一下会弹出**浏览器自己的
   * 「粘贴」授权浮层**（Safari 弹一个原生「粘贴」按钮、Chrome 弹权限框），教师看到的是一个
   * 莫名其妙的 tip，而且浮层不处理掉、这一次读就永远不返回（2026-09-27 教师实测：
   * 「点击这个按钮后会出现一个 tip（粘贴），然后点了其它地方弹窗才会出现」）。
   * ⇒ 那个 API 在教师常用的浏览器上做不到「点了就有」，就不用它。
   * 按 ⌘V 那一下由弹窗里那个**已经聚焦**的输入框接住 —— 不需要任何授权，也不会弹任何东西。
   */
  const requestPaste = () => {
    setPasteText('');
    setPasteOpen(true);
  };

  /**
   * 确认填入。
   *
   * 🔴 **题干与选项必须同一次提交**（走 `onPromptChange` 的第二个参数）：分两次 dispatch
   * 会让这一次粘贴占掉**两格**撤销栈，教师按一下 ⌘Z 只退掉一半 ——
   * 而屏幕看起来「退了一次，怎么还剩一半」。
   *
   * ⊘ 2026-09-29：补丁的算法整个搬去 `pasteDataPatch`（纯函数，`node --test` 能跑）。
   * 此前这段逻辑长在本文件里，而**本组件在本机没有回归网** —— 四种题型的拆分规则
   * 一起长在这儿的话，每一条都只能靠人眼在浏览器里看。这里只剩「算一次、提交一次」。
   */
  const applyPaste = (result: PasteQuestionResult) => {
    const patch = pasteDataPatch(result, node);
    if (result.stem !== null) onPromptChange(result.stem, patch);
    else if (Object.keys(patch).length > 0) onDataChange(patch);
    setPasteOpen(false);
  };

  /**
   * ★ M4b/D1：「作答方式」那一行**画不画**（三个判据，逐个说清）：
   *
   * ① 题型**不判分**（`QUESTION_TYPE_OPTIONS` 里那一条的 `graded === false`）⇒ 画。
   *    今天这类题型有**两个**（问答题、绘图题），而绘图题走 ③ 那一支。
   *    理由：判分题型的作答区**就是**它的交互（选项 / 条目 / 空），它们没有「手写」这个形态
   *    —— 一道排序题没法手写排序。给它们一个能选到「手写」的开关，等于让教师**把这道题
   *    改坏**：学生会拿到一个画布，而那道题的 `data` 里是条目表。
   * ② 兜底：一道**判分题**的 `inputMode` 已经是 `handwriting`（只可能来自手工改过的库行）
   *    ⇒ **仍然画**。不画的话教师没有任何办法把它改回键盘（他只能去改库）。
   *    ⚠️ 这一条看的是 `node.inputMode`，**不是**题型。判据取自 A1 的 `isInkNode` ——
   *    它在非 `drawing` 的节点上恰好等于 `node.inputMode === 'handwriting'`（那正是这里要的
   *    那一条；`isInkNode` 的另一半是 `type === 'drawing'`，而那种节点压根到不了这里）。
   * ③ `drawing` 例外：它**不画开关**，画一行静态说明（见下面那个分支）。它的作答方式由题型
   *    决定，与这一格无关 —— `inkFormatOf` 是**题型优先**的，所以就算这一格被改成 `keyboard`，
   *    作答值仍然是 `drawing/v1`，学生拿到的仍然是画布。
   */
  /**
   * ★ 2026-09-26（教师）：「这个任务一有点多余」—— 那道题**就在**标题写着「任务一」的
   * 容器里，徽章上再拼一遍前缀是同一句话说两次（一屏 20 行就是 20 遍）。
   * ⇒ 任务里的小题显示**任务内序号**（`1` `2` `3`），任务名由**容器头**承担；
   * 散题（不在任何任务里）仍用 `heading`（它本来就是裸的 `1` `2`）。
   * ⚠️ `aria-label` 仍用完整的 `heading` —— 读屏用户听得见「这道题在哪个任务里」，
   * 而屏幕上看不见的**前缀**在那里是有用的。
   * ⚠️ 保存失败的报错仍写 `任务二 · 1`（那是全局文案）；教师靠**容器头 + 序号**对得上，
   * 而容器头就在眼前 —— 这是本次取舍的代价，写在 `editorRenderRows` 那一侧也可以。
   */
  const badgeLabel = inTask ? String(index + 1) : heading;
  /** ★ 2026-09-26：这道题**会不会判分**（开关关掉 ⇒ 答案与分值一起隐藏）。 */
  const gradedOn = gradesOnSubmit(node);
  const showInputModeRow = typeOption?.graded === false || isInkNode(node) || node.inputMode === 'photo';
  const editorCopy = QUESTION_EDITOR_COPY[node.type] ?? {
    title: '作答设置',
    description: '',
  };
  /**
   * ★ 2026-09-27：容器 A 的**第二个块**（这一题的作答体）叫什么。
   *
   * ⚠️ `null` = 这道题没有这个块 —— 判断题的答案（对/错）在容器 B 里，
   * 与填空题的「标准答案」并排，所以它的容器 A 只有题干。
   */
  const isBlankType = node.type === 'fill-blank' || node.type === 'choice-blank';
  /** 题干里有表格域标记 ⇒ 出现「表格域作答设置」（判据只有它）。 */
  const hasTableMark = tableMarkIndex(node.prompt) >= 0;
  /**
   * ★ 2026-09-28（教师）：点题干里那个 chip ⇒ 把设置块**滚进视野**。
   * ⚠️ 不再是「展开/收起」：标记在不在就是显示/隐藏（教师第二轮：「这里不用展开收拢？」）。
   */
  const tableBlockRef = useRef<HTMLDivElement | null>(null);
  const answerBlock: { title: string; hint: string } | null =
    node.type === 'true-false'
      ? null
      : isChoiceQuestion(node)
        ? { title: '选项', hint: '拖动左侧把手调整顺序，点右侧圆点设置答案。' }
        : isBlankType
          // ★ 2026-10-06：「填空域与表格域会自动同步」与「表格域作答设置」那一块里的
          // 「表格里的空与题干里的空是同一批」是同一个事实（表格域不出现时这句还是错的）⇒ 删这边半句。
          ? { title: '填空设置', hint: '' }
          : { title: editorCopy.title, hint: editorCopy.description };
  const shownPoints = displayPoints(node, inheritedPoints);
  // ★ 2026-09-28（表格填空）：这笔账搬去了 `maximumPointsFor`（有用例）。
  // 🔴 原来这里数的是 `blankCount(promptRuns)` —— **不含表格里的空** ⇒
  //    一道两个空的表格题显示「最高 1 分」，而服务端按逐空给分、学生实际能拿 2 分。
  //    教师看到的数字与实际给分对不上，而**没有任何报错**（本仓最防的那一类）。
  const maximumPoints = maximumPointsFor(node, shownPoints.full);
  const fillSettings = node.type === 'fill-blank' ? fillSettingsFor(node, readPromptRunsFor(node)) : [];
  const explicitFillScoring = node.type === 'fill-blank' && hasExplicitFillGrading(fillSettings);
  const fillTotals = fillGradingTotals(fillSettings);
  /**
   * 这一型有没有**整题级**的 AI 评分设置块（开关 + 满额 + 评分标准 + 图片）。
   *
   * ⊘ ★ 2026-10-05（教师裁定 B）：「评分标准已经细化到每一空（如果选了手工填写），
   * 不需要整体的评分标准。……为了简化，填空题的评分标准不需要上传图片。」
   * ⇒ 填空题**没有**这一块：它的标准是「填空与作答设置」里每个空那一份
   *（手工填写时那一格的标签就叫「评分标准」），而那份文字会以
   * **「参考答案（逐空）」** 的形式进分析载荷 —— 模型该拿到的已经拿到了。
   * ⚠️ 服务端仍保留「填空题 + `autoGrade === false` 时也读 `rubricText`」那条老路
   *（`analysis-question.ts`）—— **旧数据里已经写过的整题标准照旧会发出去**，
   * 只是编辑页不再提供入口。删那条路等于让老学习单的评分标准**静默失效**。
   */
  const supportsAiScoring = node.type === 'short-answer' || node.type === 'drawing';
  const aiScoringEnabled = explicitFillScoring ? fillTotals.ai > 0 : node.data.aiScoringEnabled === true;
  const aiScoringMaxScore = typeof node.data.aiScoringMaxScore === 'number'
    ? node.data.aiScoringMaxScore : 10;
  const aiScoringCriteria = typeof node.data.aiScoringCriteria === 'string'
    ? node.data.aiScoringCriteria : '';
  const gradingStatus = explicitFillScoring
    ? (gradedOn ? `混合评分 · 最高 ${fillTotals.total} ${pointsUnit}` : '仅统计作答')
    : aiScoringEnabled
    ? `AI 评分 · 最高 ${aiScoringMaxScore} ${pointsUnit}`
    : isGradedQuestionType(node.type)
      ? (gradedOn ? `自动评分 · 最高 ${maximumPoints} ${pointsUnit}` : '仅统计作答')
      : '教师查看';

  return (
    <section
      className={`worksheet-editor-question${focusedMode ? ' is-focused' : ''}`}
      data-expanded={expanded ? '1' : '0'}
      /* ★ 2026-09-26（spec 第 3 步）：↑/↓ 在题间跳时靠它定位（见 `page.tsx` 的那段 effect）。 */
      data-question-id={node.id}
      /* ★ 2026-09-26（spec 第 5 步）：拖拽要靠它找**同层**的兄弟行（任务内的小题同一层、
         顶层散题同一层）—— 见 `page.tsx` 的指针处理。 */
      data-row-id={node.id}
      data-layer={taskId ?? ''}
      aria-label={`${heading} ${typeLabel}`}
      /*
        ★ 2026-09-26（教师）：「鼠标在某题上停留时，可以点击这题框中的**任何位置**都可以
        激活编辑状态。」⇒ 折叠时整块可点（不再只有那一行摘要）。
        ⚠️ **只在折叠时挂**：展开之后点卡片里的空白处**不该**把它收起来 ——
        教师正在改这一张，点一下正文就没了是灾难。
        ⚠️ 落点收口在 CSS：预览区里的控件是学生端那套（`disabled`），而浏览器**不派发**
        落在 disabled 元素上的点击（事件被吞，冒泡不到这里）⇒ 预览区整块设
        `pointer-events: none`，点击于是落在这一层上（见 `globals.css`）。
        ⚠️ 划词选中时不切换：教师可能正想复制题干，一松手就展开/收起会很恼火。
      */
      onClick={expanded ? undefined : () => {
        if (typeof window !== 'undefined' && window.getSelection()?.toString()) return;
        onToggle();
      }}
    >
      <header className="worksheet-editor-question-head">
        {/*
          ★ 2026-09-26（spec 第 2 步）：**折叠态那一行**。整行是一个按钮（点它展开/收起）。
          ⚠️ 题干在这里是**纯文本 + 省略号**（CSS 做），不是 textarea —— 折叠时不该有输入框，
          否则 `Tab` 会依次落进 20 个看不见的框里，而那一整页的键盘导航就废了。
          ⚠️ 分值用的是 `displayPoints`（核心里、有用例），不是 `effectiveHalfStep`
          —— 后者半填时回 `null`（给警告条用的判据），而这一行**必须**有个数。
        */}
        <button
          type="button"
          className="worksheet-editor-question-summary"
          onClick={focusedMode ? undefined : onToggle}
          aria-expanded={expanded}
          title={focusedMode ? undefined : (expanded ? '收起这道题' : '展开这道题')}
        >
          {/*
            ★ 2026-09-26（教师）：「这个为什么会重复？」—— 摘要行原来也印了一遍题干，
            而下面那份只读题面本来就画着它。⇒ **摘要行不再印题干**，它只负责
            「这是第几题 · 什么题型 · 多少分」这三件**题面里没有**的事。
            ⚠️ 别再把题干挪回来：重复一次不会报错，只会让人以为有两道一样的题。
          */}
          <span className="worksheet-editor-question-index">{badgeLabel}</span>
          {focusedMode ? (
            <span className="worksheet-editor-question-heading-copy">
              <span>编辑题目</span>
              <strong><span className="worksheet-editor-type-glyph">{questionTypeIcon(node.type)}</span>{typeLabel}</strong>
            </span>
          ) : (
            <span className="worksheet-editor-question-type"><span className="worksheet-editor-type-glyph">{questionTypeIcon(node.type)}</span>{typeLabel}</span>
          )}
          <span className={`worksheet-editor-grade-status${gradedOn ? ' is-on' : ' is-manual'}`}>
            {gradingStatus}
          </span>
        </button>
        {/* ⚠️ `stopPropagation`：这一块在折叠时也挂在可点的 `<section>` 里，
            不拦住的话按一下把手会顺带把整张卡展开（而教师只想挪一位）。 */}
        <div className="worksheet-editor-question-tools" onClick={event => event.stopPropagation()}>
          {/*
            ★ 2026-09-26（spec 第 5 步）：**拖拽把手**。
            ⚠️ 为什么必须是把手、不能让整行可拖：整行已经挂「点一下展开」了 ——
            两者会抢同一个手势（教师想展开却被拖走）。
            ⚠️ `touch-action: none`（CSS）是**必须**的：不写的话触屏上浏览器会先把这次
            拖动解释成滚动，`pointermove` 到一半就断了。
            ★ 2026-09-30（教师）：「排序按钮可以取消了」⇒ 把手右边那对 `▲▼`
            （`onMove`）**删掉了**，这一行现在只剩把手与删除。换位**只有拖拽一条路**。
            🔴 代价写在明处：拖拽对**键盘用户不可用**（`onPointerDown` 起手），
              这一改等于把「键盘换题序」这条能力一起拿掉了。别当成免费的清理。
          */}
          <button
            type="button"
            className="worksheet-editor-drag-handle"
            onPointerDown={onDragStart}
            title="拖这一行调整顺序"
            aria-label={`拖动「${heading}」调整顺序`}
          >
            ⠿
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button is-danger"
            onClick={onRemove}
            title="删除这道题"
            aria-label="删除这道题"
          >
            {/* ★ 2026-10-05：这个垃圾桶搬去了 `editor-icons.tsx` —— 教师要求
                「删除统一用垃圾桶图标」，于是它成了全编辑页的那一个图标，不再是本文件私有的内联 SVG。 */}
            <TrashIcon />
          </button>
        </div>
      </header>

      {/* ⚠️ `(<>` 后面**不能**多一个 `)`：多了会被 JSX 当成**文本节点**渲染出一个孤零零的
          `)`，而 tsc / eslint / 用例**全都不会红**（语法合法）。教师 2026-09-26 在真机上
          就是这么发现的 —— 见那一天的提交。 */}
      {expanded && (<>
      <div className="worksheet-editor-question-form">
      {/*
        ★ 2026-09-27（教师裁定）：编辑页从「五张平级卡片」改成**两层** ——

          容器 A「题目内容」      题干 + 这一题的作答体（选项 / 作答方式 / 条目 / …）
          中间「自动评分」        一个开关；**关掉时下面整块不出现**
          容器 B「自动评分设置」  判分相关的那几块（仅开启时）

        🔴 两型的**块标题刻意对齐**（教师：「两者要统一起来……一定要取得精准到位」）：
             选择题   评分方式 → 得分规则
             填空题   得分方式 → 得分规则 → 标准答案
           ⚠️ 中间那张卡原来也叫「评分方式」，与容器 B 里第一块**重名**，已改成「自动评分」。

        ⚠️ 块与块之间只用一条细线分隔（`.worksheet-editor-block`），**不再套第二层卡片**：
           卡片套卡片会立刻失去层次（本页第一轮定下的视觉规矩：边框与投影只给「浮起来的」东西）。
        ⚠️ 判断题没有「作答体」块 —— 它的答案（对/错）在容器 B 里，与填空题的「标准答案」并排。

        🔴 **这一套是「模板」，不是只给这两种题型用的。** 教师 2026-09-27 原话：
           「到时候我在优化另外几种题型，也参考这种布局和命名方式，**但不是现在**。」
        ⇒ 还没细分块的是 **`order` / `match` / `categorize`**：它们的作答体仍把「条目」与
           「答案」（正确顺序 / 配对 / 归属）挤在**同一个块**里。按这套办事时，该把那两样
           分别放进容器 A 与容器 B —— 也正是 `fill-blank` 这一步做过的事
           （「每个空的作答方式」留在 A、「标准答案」搬去 B）。
        ⚠️ 命名规矩：容器名两型共用；块名**能共用的必须共用**（`得分规则` / `标准答案`），
           共不了的才各取各的（`选项` / `每个空的作答方式`）。**重名是硬伤** ——
           中间那张卡原来就叫「评分方式」，与容器 B 里第一块撞名。
      */}
      <section className="worksheet-editor-question-section is-prompt">
        <div className="worksheet-editor-section-head">
          <div>
            <h3><EditorIcon kind="content" />题目与作答</h3>
          </div>
          <span>必填</span>
        </div>

        <div className="worksheet-editor-block">
          <div className="worksheet-editor-block-head">
            <div>
              {/* ⚠️ 这个「题干」标题是**新的层级**要的：以前它在卡片头部下面，与
                  「题目内容 / 写清学生需要完成什么」是同一句话说两次，所以当时删掉了。
                  现在「题目内容」是容器的名字、块要有自己的名字，它不再重复。 */}
              <h4><EditorIcon kind="prompt" />题干</h4>
            </div>
          </div>
          <PromptEditor
            node={node}
            onPromptChange={onPromptChange}
            onDataChange={onDataChange}
            onRequestPaste={requestPaste}
            // ★ 2026-09-28：点题干里的 {表格域} chip（或刚插入一个）⇒ 展开设置面板
            onTableMarkClick={() => tableBlockRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
            onNotice={onNotice}
          />
        </div>
        {/*
          ★ 2026-10-06（教师）：「判断题的答案设置移到上面题干的后面」。
          ⊘ 它原来在**最下面**（自动评分、分值设置之后）—— 判分相关的设置都堆在那里，
            而「对还是错」是这道题的**答案**，与题干是同一件事的两半 ⇒ 摆回题干后面。
          ⊘ 填空题**没有**这一块（教师 2026-10-05 裁定 A）：每个空的答案住在「填空与作答设置」
            的卡片里。两个入口编辑同一份数据就是本仓最防的那种分叉。
        */}
        {node.type === 'true-false' && (
          <div className="worksheet-editor-block">
            <div className="worksheet-editor-block-head">
              <div>
                <h4><EditorIcon kind="answer" />正确答案</h4>
              </div>
            </div>
            <TrueFalseBody node={node} onDataChange={onDataChange} showAnswer />
          </div>
        )}
        {answerBlock && (
          <div className="worksheet-editor-block">
            <div className="worksheet-editor-block-head">
              <div>
                <h4><EditorIcon kind="answer" />{answerBlock.title}</h4>
                {answerBlock.hint && <p>{answerBlock.hint}</p>}
              </div>
              {/* ★ 2026-09-27（教师）：「这个使用左右滑动的开关打开，就表示可以多选，放到右上角去。」
                  ⚠️ 开关上**只写「多选」**：关着就是单选、开着就是多选 —— 两个状态用一个开关
                     表达，正是教师描述的那个心智模型（写两个标签就退回成分段控件了）。 */}
              {isChoiceQuestion(node) && (
                <HeadSwitch
                  checked={isMultipleChoice(node)}
                  onChange={next => onDataChange(choiceModePatch(next, node))}
                  label="可以多选"
                  title={isMultipleChoice(node) ? '已打开：学生可以选多个答案' : '已关闭：学生只能选一个答案'}
                  text="多选"
                />
              )}
            </div>

            {showInputModeRow && <InputModeRow node={node} onInputModeChange={onInputModeChange} />}

            {node.type === 'drawing' && (
              <DrawingSettings node={node} onDataChange={onDataChange} onNotice={onNotice} />
            )}

            {/* 题型 → 作答体。这里保持与学生端题型数据结构一一对应。
                🔴 本页是按 `node.type === '…'` 逐个分派的（不是 `Record`），少写一支的后果是
                **这个题型在编辑页什么都不渲染** —— 教师建得出来、却配不了，而屏幕上只是一片空白。 */}
            {(node.type === 'single-choice' || node.type === 'multi-choice') && (
              <ChoiceOptionsBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />
            )}
            {node.type === 'fill-blank' && hasTableMark && (
              <div className="worksheet-editor-block worksheet-editor-table-setup" ref={tableBlockRef}>
                <div className="worksheet-editor-block-head">
                  <div>
                    <h4><EditorIcon kind="content" />表格设置</h4>
                  </div>
                </div>
                <TableBody node={node} onDataChange={onDataChange} />
              </div>
            )}
            {/* ★ 2026-09-28：这一块现在覆盖**这道题全部的空**（题干里的 + 表格里的），
                所以它排在表格面板**之后**（表格在上、空的清单在下，读起来才是一条线）。 */}
            {(node.type === 'fill-blank' || node.type === 'choice-blank') && (
              // ★ 2026-10-05（教师最新裁定）：每个空的**答案**也在这里（卡片最下方的独立第三行），
              // 所以要把「全对的奖励数量」传进去 —— 「逐空评分」那笔账是在这里算给教师看的。
              <ChoiceBlankSetup
                node={node}
                onDataChange={onDataChange}
                fullPoints={shownPoints.full}
                pointsUnit={pointsUnit}
              />
            )}

            {/* ★ 2026-09-28（表格填空，裁定③）：网格面板 —— 表格属于**题面**，
                所以它排在题干这一侧，不排到答案那一块里。
                ⚠️ **它排在「每个空的作答方式」之前是刻意的**（2026-09-28 教师反馈）：
                   那两块原来顺序相反，「作答方式」先对一道表格题说「题干中还没有填空域」，
                   紧接着下面那块又说「点某几格标成填空」—— 两块互相打脸，
                   教师读到的第一句就是假的（原话：「一头雾水，东跳跳西跳跳」）。
                ⚠️ 它只服务 `fill-blank`：表格里的空 v1 只有「手工填写」一档，
                   选择填空那套待选词不跟表格组合（组合爆炸，等真有人要再说）。 */}
            {/* ★ 2026-09-28（教师）：「只有在题干中出现了表格域才会『出现填空的位置（表格）』，
                如果删除了表格域，那么也随之隐藏。」
                ⇒ 判据**只有标记**：删掉标记那一块就跟着消失（`data.table` 还在库里，
                  但不渲染 —— 再插回标记它就回来）。
                ⚠️ 于是「有表没标记」这种状态在界面上**没有入口**了（它只可能来自
                  手工改过的库）；那种题保存时会被服务端拒（「学生看不到这张表」）。 */}
            {node.type === 'order' && <OrderBody node={node} onDataChange={onDataChange} />}
            {node.type === 'match' && <MatchBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
            {node.type === 'categorize' && <CategorizeBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}

            {(node.type === 'short-answer' || node.type === 'drawing') && (
              // ★ 2026-09-30（教师）：「主观题也需要设置参考答案，但是可以选择不本地评分。」
              // + 澄清：「主观题**不需要评分**」。
              // 🔴 所以这一块**只是让答案有个入口** —— 它不接判分那条链：
              //    `graded` 仍是 false、服务端的判分器仍恒返回 null。
              //    答案的两个去处：**印在教师用卷上**、以及你在看板查看时有个对照。
              // ⚠️ 输入框与填空题的「标准答案」是**同一个组件**（`SymbolListInput`，
              //    它本来就是待选词与标准答案共用的那个）—— 两处各写一份就是本仓最防的分叉。
              // ⚠️ 写回的是 **nested 形状**（`answers: [items]`，每空一份）：
              //    内核的纪律是「写一律写 nested」（单空与多空没有区别的那个形状）。
              <div className="worksheet-editor-block worksheet-editor-reference-block">
                <div className="worksheet-editor-block-head">
                  <div>
                    <h4><EditorIcon kind="answer" />{node.type === 'drawing' ? '参考要点' : '参考答案'}</h4>
                    <p>{node.type === 'drawing' ? '写下作品必须包含的要点。' : '写下可接受的核心答案。'}</p>
                  </div>
                </div>
                <SymbolListInput
                  values={readBlankAnswers(node)[0] ?? []}
                  split={splitChoiceText}
                  placeholder={node.type === 'drawing' ? '例如：包含蒸发、凝结、降水，并用箭头表示过程' : '例如：春天、春季'}
                  onChange={(items) => onDataChange({ answers: [items] })}
                />
              </div>
            )}
            {/*
              ★ 2026-10-05（教师）：「评分标准与下面的评分要求重复了，你把『评分标准』替换
              下面的『评分要求』，带图片上传。」
              ⇒ 这里原本是**两块**：这块独立的「评分标准」（文字 + 图片）与下面 AI 评分块里
                那个「评分要求」。两处的文字都会进同一份分析载荷，而 `buildAnalysisMessage`
                也确实印了两行（`评分标准：…` / `评分要求：…`）—— 同一份东西在提示词里也说两遍。
              🔴 现在**只有下面那一个输入框**（`rubricText`，带图片上传），
                `aiScoringCriteria` 降级为**旧数据回退**（唯一读取点：`rubricTextOf`）。
              ⚠️ 教师 2026-10-05 明确选了「只在 AI 评分打开时显示」——
                代价是关掉 AI 评分后这里没有编辑入口，而「发给 AI 分析」仍会读这份标准。
            */}
            {/*
              ★ 2026-10-05（教师裁定 B）：填空题**整块去掉**（上一版按裁定 A 缩成了「AI 评分标准」，
              教师看到之后说「这里也不对……不需要整体的评分标准」）。
              ⇒ 现在这一块只服务**问答题 / 绘图题**：那两型没有逐空的评分方式，
                整题的开关、满额、评分标准就该在这儿，评分标准也仍然可以带图片。
              ⚠️ 填空题的评分为何不需要「整题标准」：它的标准已经细化到每一空
                （手工填写那一格的标签就叫「评分标准」），并以「参考答案（逐空）」进载荷。
              ⚠️ 旧的「评分标准 / 评分要求」合并（见上面那段）对这两型仍然有效：
                `rubricText` 为准，`aiScoringCriteria` 只作回退。
            */}
            {supportsAiScoring && (
              <div className="worksheet-editor-block worksheet-editor-ai-scoring">
                <div className="worksheet-editor-block-head">
                  <div>
                    <h4><EditorIcon kind="grading" />AI 评分</h4>
                    <p>按评分标准生成分数与建议。</p>
                  </div>
                  <HeadSwitch
                    checked={aiScoringEnabled}
                    onChange={(enabled) => onDataChange({ aiScoringEnabled: enabled })}
                    label="AI 评分"
                    title={aiScoringEnabled ? '已开启 AI 评分' : '已关闭 AI 评分'}
                  />
                </div>
                {aiScoringEnabled && (
                  <div className="worksheet-editor-ai-scoring-fields">
                    <div className="worksheet-editor-ai-scoring-field">
                      <label htmlFor={`ai-scoring-max-${node.id}`}>
                        {/* ★ 2026-10-06：这一格与本地判分块那一格是**同一个字段**
                            （这道题最多给多少），原来两边各叫各的（满分 / 满额 / 分值）。
                            ⇒ 现在两处**同名**，而且名字跟着学习单的奖励形式走：
                              分数档叫「分值」，图标 / 奖杯那一档叫「奖励数量」——
                              同一个字段，量词要对得上后面那个单位（「3 座奖杯」不是「分值 3 座奖杯」）。 */}
                        {pointsUnit === '分' ? '分值' : '奖励数量'}（{pointsUnit}）
                      </label>
                      <div className="worksheet-editor-ai-scoring-stepper">
                        <button
                          type="button"
                          disabled={aiScoringMaxScore <= 1}
                          onClick={() => onDataChange({ aiScoringMaxScore: Math.max(1, aiScoringMaxScore - 1) })}
                          aria-label={`减少 1 ${pointsUnit}`}
                        >−</button>
                        <input
                          id={`ai-scoring-max-${node.id}`}
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={aiScoringMaxScore}
                          onChange={(event) => {
                            const value = Number.parseInt(event.target.value, 10);
                            if (Number.isInteger(value) && value >= 1 && value <= 100) {
                              onDataChange({ aiScoringMaxScore: value });
                            }
                          }}
                          aria-label={`AI 评分分值（${pointsUnit}）`}
                        />
                        <button
                          type="button"
                          disabled={aiScoringMaxScore >= 100}
                          onClick={() => onDataChange({ aiScoringMaxScore: Math.min(100, aiScoringMaxScore + 1) })}
                          aria-label={`增加 1 ${pointsUnit}`}
                        >+</button>
                      </div>
                    </div>
                    {/*
                      🔴 显示的是**合并后**的值：`rubricText` 为准，旧字段 `aiScoringCriteria`
                      作回退 —— 老学习单只填过「评分要求」的，教师在这里照旧看得见原文。
                      ⚠️ `onChange` 必须把旧字段**一并清掉**：只写 `rubricText` 的话，
                      教师把输入框删空之后，回退值会重新出现（「删不掉」）。
                    */}
                    <label className="is-wide">
                      <span>评分标准</span>
                      <textarea
                        value={rubricText || aiScoringCriteria}
                        maxLength={2400}
                        rows={4}
                        placeholder="例如：观点明确；至少写出两个依据；能结合题目材料说明。也可以只上传评分量表图片。"
                        /*
                          ★ 2026-10-06（教师）：「这里复制进来的文本，格式要去掉」。
                          🔴 从 Word / PDF 复制中文带进来的是**排版**：每行缩进、全角空格、
                             标点**前面**多一个空格（「（1 分） ；」）—— 肉眼以为是内容，其实全是噪音。
                          ⇒ 粘贴时自己接管（`preventDefault` + 写入归一化后的文本，避免「先脏后清」闪一下）；
                             另外在**离开输入框时**再收一次：粘贴发生在我们接上之前的旧内容也能被清干净
                             （归一化是幂等的，干净的文本不会被改样）。
                          ⚠️ 光标不特意复位：`onDataChange` 之后受控值会把光标带到末尾 —— 粘完接着打字
                             本来就在末尾，这点可接受；真有人抱怨再补一个 ref + effect。
                          ⚠️ 只去排版、不动内容：数字与单位之间（「满分 4 分」）与拉丁词之间
                             （「AI 评分」）的空格都保留，标点后的空格只在紧跟中文时才删。
                        */
                        onPaste={(event) => {
                          const raw = event.clipboardData.getData('text/plain');
                          if (!raw) return;
                          event.preventDefault();
                          const element = event.currentTarget;
                          const start = element.selectionStart ?? element.value.length;
                          const end = element.selectionEnd ?? element.value.length;
                          const next = `${element.value.slice(0, start)}${normalizePastedText(raw)}${element.value.slice(end)}`;
                          onDataChange({ rubricText: next, aiScoringCriteria: undefined });
                        }}
                        onBlur={(event) => {
                          const next = normalizePastedText(event.target.value);
                          if (next !== event.target.value) onDataChange({ rubricText: next, aiScoringCriteria: undefined });
                        }}
                        onChange={(event) => onDataChange({
                          rubricText: event.target.value,
                          aiScoringCriteria: undefined,
                        })}
                      />
                    </label>
                    {/*
                      ★ 2026-10-06（教师）：信息科技课的流程图作业判的是**结构**，所以给一颗
                      「插入结构要点模板」—— 按一下把 `STRUCTURE_POINTS_TEMPLATE` 那几条要点
                      追加进评分标准，教师再按自己这一题改写。

                      🔴 **只在「作图题 + 作图工具是流程图」时出现**：判据是
                        `readDrawingTool(node) === 'flowchart'`（那份判据只有一份，见文件头的 import）。
                        别的题型（含基础绘图 / 数学作图 / 思维导图）没有「判断框、回边」这些结构要求，
                        把这段模板摆给它们就是一句**屏幕上说得出口的谎话**。
                      ⚠️ 它收在 `aiScoringEnabled` 那一支里（跟着上面那个输入框显隐）：
                        标准框关着的时候不摆按钮 —— 否则教师按了，文字写进了 data，而屏幕上
                        一个能读它的输入框都没有（本仓最防的那类「静默写入」）。
                      ⚠️ **追加，不是覆盖**：已有内容时前面补一个换行（教师写了一半再点它，
                        原来那半句不许被吞掉）。
                      ⚠️ 写回走的是与上面 `onChange` **同一条路**：`rubricText` 为准，
                        旧字段 `aiScoringCriteria` 一并清掉（只写 `rubricText` 的话，教师把框删空后
                        回退值会重新出现，看起来像「删不掉」）。
                      ⚠️ 按钮**不许放进 `<label>`**：`<label>` 会把点击转发给内部第一个可标注元素
                        （`<button>` 就是），标签里的空白点一下也会触发它 —— 那条教训见上面
                        「分值 / 奖励数量」那一格（教师报过「点了下面空白地方也会减」）。
                    */}
                    {readDrawingTool(node) === 'flowchart' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          // 显示值可能是旧数据里的 `aiScoringCriteria`（见上面那段说明）⇒ 取合并后的那一份。
                          const current = rubricText || aiScoringCriteria;
                          onDataChange({
                            rubricText: current ? `${current}\n${STRUCTURE_POINTS_TEMPLATE}` : STRUCTURE_POINTS_TEMPLATE,
                            aiScoringCriteria: undefined,
                          });
                        }}
                      >
                        插入结构要点模板
                      </button>
                    )}
                    <input
                      ref={rubricImageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadRubricImage(file);
                      }}
                    />
                    {rubricImageUrl ? (
                      <div className="worksheet-editor-rubric-image">
                        <img src={worksheetAssetUrl(rubricImageUrl)} alt="评分标准" />
                        <div>
                          <button type="button" className="btn btn-secondary" disabled={rubricUploading} onClick={() => rubricImageInputRef.current?.click()}>
                            {rubricUploading ? '正在上传…' : '更换图片'}
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => onDataChange({ rubricImageUrl: undefined })}>移除图片</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-secondary worksheet-editor-rubric-upload" disabled={rubricUploading} onClick={() => rubricImageInputRef.current?.click()}>
                        {rubricUploading ? '正在上传图片…' : '上传评分标准图片'}
                      </button>
                    )}
                    <p className="worksheet-editor-ai-scoring-note">
                      AI 评分仅供参考，不会覆盖教师评价。
                      {pointsUnit === '分' ? '分数最多保留一位小数。' : `${pointsUnit}按整数发放。`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 填空题的答案由下方总开关统一显隐，关闭状态已在「自动评分」区说明；
            这里的额外提示只服务答案控件仍位于本区的其它客观题，避免同一句出现两次。 */}
        {!gradedOn && isGradedQuestionType(node.type) && !isBlankType && (
          <p className="worksheet-editor-answer-disabled">
            自动评分已关闭，答案设置暂时隐藏。
          </p>
        )}
      </section>

      {/*
        ★ 2026-09-27（教师）：「中间不要分隔，在一个大窗口里。」
        ⇒ 原来「自动评分」（开关）与「自动评分设置」（判分的块）是**两张卡**，
        中间隔着一条缝。现在合成**一张**：开关就是这张卡的标题行，下面的块是它的设置。
        🔴 于是容器 B 那个名字（「自动评分设置」）不再单独存在 —— 卡片标题取「自动评分」，
        因为**开关关着时这张卡也还在**（开关得有人按），而一张只剩标题的卡叫「…设置」
        是说不通的。开关自己的位置就是状态，标题里不再写「已开启 / 已关闭」。
        ⚠️ 关掉时**下面整块不渲染**（教师：「如果不是其他选项全部隐藏，就不用显示了」）。

        ★ 2026-10-05（教师最终裁定）：填空题的「自动评分」是**整题总开关**。
        开启时显示上方每个空的评分方式、答案 / 评分标准与分值；关闭时隐藏并停止
        本地和 AI 评分，但已有设置保留，重新开启即可恢复。
        🔴 这不是纯显隐：服务端 `grade()` 与 AI 评分入口也必须先读 `node.autoGrade`，
        否则教师看到关闭，学生提交后仍会得到分数。
      */}
      {isGradedQuestionType(node.type) && (
        <section className="worksheet-editor-question-section is-grading">
          <div className="worksheet-editor-section-head">
            <div>
              <h3><EditorIcon kind="grading" />自动评分</h3>
              <p>{explicitFillScoring
                ? '控制各空的评分设置。关闭后仅统计作答。'
                : '关闭后仅统计作答，不计分。'}</p>
            </div>
            <div className="worksheet-editor-head-actions">
              {/* ⚠️ 徽章里**不写「自动评分」** —— 卡片标题就是它（原来那句
                  `gradingStatus`（「自动评分 · 最高 1 颗星星」）是给**折叠态那一行**用的，
                  那里没有标题，所以不能直接搬过来）。 */}
              {gradedOn && <span className="worksheet-editor-points-badge">本题满分 {explicitFillScoring ? fillTotals.total : maximumPoints} {pointsUnit}</span>}
              <HeadSwitch
                checked={gradedOn}
                onChange={onAutoGradeChange}
                label="自动评分"
                title={gradedOn ? '已开启：系统按正确答案判对错并计分' : '已关闭：只统计作答进度，不计分'}
              />
            </div>
          </div>

          {gradedOn && (<>

          {isMultipleChoice(node) && (
            <div className="worksheet-editor-block">
              <div className="worksheet-editor-block-head">
                <div>
                  <h4><EditorIcon kind="grading" />评分方式</h4>
                </div>
              </div>
              <ChoicePartialCreditBody node={node} onDataChange={onDataChange} />
            </div>
          )}

          {/*
            ★ 2026-10-05（教师最终裁定）：「我觉得应该删掉，因为现在总开关只需要负责是否
            自动评分（含 AI 评分），打开后每题单独设置单独给分，**已经不涉及按整题给的问题**。」
            ⇒ **填空题**那一块（「得分方式 按空给分 / 整题给分」+「分值」两行）**整块删除**：
              分值是逐空的事，它的入口在「填空与作答设置」每个空的卡片里（答案行末尾那一格），
              合计也在那张卡里（就排在逐空那些格下面）。⇒ 这张卡对填空题只剩**开关**一个控件
              （旁边那个「本题满分 N」是只读徽章）。

            🔴 为什么**选择填空**还留着它：判分的逐空那一支在服务端写死了
              `node.type === 'fill-blank'`（`worksheet-questions.ts` 的 `grade()`），
              AI 评分（`analysis-scoring.ts`）同样只认填空题 ⇒ 选择填空的判分口径**仍是**
              题目级的「得分方式 + 分值」。删掉它，那一型就一个分值入口都没有了
              （它的空卡片上那一格是死控件，已按同一条纪律不画）。
              ⚠️ 那一型要不要也收口成逐空，是一次**判分口径**的决定（它会失去「整题给分」），
                 没有跟着这次裁定一起做。

            📌 老数据的填空题（库里 `fillScoring: 'whole'`、还没设过逐空评分方式）**照旧按
              旧口径判分**，界面上由 `bodies/fill-blanks-body.tsx` 底部那句「旧口径」说明 +
              一个转换按钮交代 —— 不替教师把整题那一份分偷偷摊到每个空上。
          */}
          {node.type === 'choice-blank' && (
            <div className="worksheet-editor-block">
              <FillScoringMethodRow node={node} onDataChange={onDataChange} />
              <FillPointsRow
                node={node}
                inheritedPoints={inheritedPoints}
                pointsUnit={pointsUnit}
                onPointsChange={onPointsChange}
              />
            </div>
          )}

          {/*
            ★ 2026-10-05（教师裁定，与上面那次删除同一条）：「总开关只需要负责是否自动评分」。
            ⇒ **填空题不再有这一块** —— 它原来只在「设过逐空评分方式」时显示一句逐空合计，
              而那个数在「填空与作答设置」每个空的分值格下面已经有了（同一件事说两遍）。
              填空题这张卡从此只剩：开关（+ 满额徽章）。
            ⚠️ 选择填空**本来就不走这里**（`isBlankType` 时旧的判据是 `explicitFillScoring`，
              而它恒为假）—— 它的分值在上面那块「得分方式 + 分值」里，一个字没动。
          */}
          {!isBlankType && (
          <div className="worksheet-editor-block">
            <div className="worksheet-editor-block-head">
              <div>
                <h4><EditorIcon kind="points" />分值设置</h4>
                <p>{showsPartialPoints(node)
                  ? `设置完全正确和部分答对时获得的${pointsUnit}。`
                  : `设置完全正确时获得的${pointsUnit}。`}</p>
              </div>
            </div>
            <PointsRow
              heading={heading}
              node={node}
              inheritedPoints={inheritedPoints}
              pointsUnit={pointsUnit}
              rejectedInput={rejectedPointInput}
              onPointsInputChange={onPointsInputChange}
              onPointsChange={onPointsChange}
            />
            {/*
              ★ 2026-09-26（教师裁定）：「如果部分给分框内设了非 0 值，则显示判分依据的设置」。
              ⚠️ 判据用的是 `effectiveHalfStep`（内核里、有 6 条用例）—— 「这一题**实际会用到**的
              部分给分档」。半填（只填了一个框）时它回 `null`（说不准）⇒ 那时**不显示**这一行：
              教师还在打字的中间态，弹出一行要他选容错档是打断。
            */}
            {/* ⚠️ 外层已经限定 `!isBlankType`（2026-10-05：这一块对填空题整块删掉了），
                所以这里不再重复写那个判据 —— 一处就够了。 */}
            {canGivePartial(node.type) && (effectiveHalfStep(node, inheritedPoints) ?? 0) > 0 && (
              <ToleranceRow node={node} onToleranceChange={onToleranceChange} />
            )}
          </div>
          )}

          {/* ⊘ ★ 2026-09-30（教师）：「排序题的答案设置可以参考连线题和归类题，放在
              **选项顺序的右侧**。」⇒ 「正确顺序」从这一张卡**搬回**容器 A，与条目**并排**
              （见 `OrderBody` 里那个 `.worksheet-editor-order-columns`）。
              ⚠️ 这是它**第二次**改位置：2026-09-28 教师要求搬进来、今天要求搬出去。
                 两次都不算「设计反复」—— 上一次他看到的是「答案该在开关旁边」，
                 这一次他看到的是「调顺序时两个列表要并排着看」。两次都照做。
              ⚠️ 于是这张卡对排序题只剩下面那两块（开关 + 分值 + 容错档），不再是空壳。 */}


          </>)}
        </section>
      )}

      {/*
        ⊘ ★ 2026-10-05（教师）：「这部分是不是多余了？」—— 是，已整块删除。
        ⇒ 原来这里还有**第三张卡**：「评分说明 / 查看方式」，内容是复述上面两块 ——
          评分打开时说「满额 N · 智能体会按上方评分要求给出 0–N …」，
          关掉时说「教师查看 · 不设置本地分值」。
        🔴 唯一别处没有的那句「**该结果不会覆盖教师评价**」没有丢 ——
          它并进了 AI 评分块脚注（见那一段的 `.worksheet-editor-ai-scoring-note`）。
        ⚠️ 关掉 AI 评分时失去的那句「由教师查看」，由「作答方式」那一行的提示承担
          （「主观题不做本地自动评分 —— 看板上统计作答进度，可由教师查看或交给 AI 分析」）；
          上方「参考答案」块只说它的去处（「会作为智能体分析本题的参考依据」）。
        ⚠️ 于是 `isGradedQuestionType` 这两支现在**各只有一张卡**：
          客观题 = 「自动评分」，主观题 = 「AI 评分」。
      */}
      </div></>)}

      {/*
        ★ 2026-09-26（教师修正）：「折叠只是指折叠所有**设置项**，题干和选项还是要保留的，
        不要只剩一个标题。」⇒ 折起来的那一道题要读起来像**一张已经出好的卷子**。
        🔴 **复用学生端那套只读渲染**（`QuestionInput` + `disabled`）—— 就是「学生端预览」
        用的同一份组件，九种题型一行不用重写。自己另写一份文字预览 = 第二份渲染实现，
        改了这边那边不动，而两边都不报错（本仓最防的那种分叉）。
        ✅ `disabled` 同时解决了键盘导航：原生 `disabled` 的控件**不在 Tab 序里**。
        ⚠️ 展开时这里**不渲染**（那时下面渲染的是可编辑的编辑体）—— 否则题面会画两遍。
      */}
      {!expanded && (
        <div className="worksheet-editor-question-preview">
          {/* ★ 2026-09-26：这一处原来**另写了一份**题干渲染（读同一份 `promptStyle`，
              与学生端那份各画各的）。现在两处共用一个 `PromptText` —— 行内格式一旦
              要按区间切分，两份实现就是把一个分叉翻倍。
              ⚠️ 那个 `<p>` 的类里还留着 `font-weight: 600` 与 `color: #0f172a`：
              它们以前被这里的行内样式盖住（**一直没生效**），现在只作用于
              「（题干还没写）」那句占位文字。要不要让题干也用它，是一个独立的外观决定。 */}
          {/* ⚠️ 这里是 `<div>` 而不是 `<p>`（★ 2026-09-28）：题干里可能有一个
              **块级**的表格域，而 `<p>` 装不下 `<table>` —— 浏览器会在表格前把段落
              闭掉，DOM 与 JSX 就对不上（版面看上去只是「表格跳到段落外面了」）。
              那个类名里留下的 `font-weight` / `color` 仍然生效，一个字没少。 */}
          <div className="worksheet-editor-question-preview-prompt">
            <PromptText
              text={node.prompt}
              runs={promptRuns}
              placeholder="（题干还没写）"
              table={node.data.table}
            />
          </div>
          {promptImage && (
            <img
              className="worksheet-editor-question-preview-image"
              src={worksheetAssetUrl(promptImage)}
              alt="题干配图预览"
            />
          )}
          <QuestionInput node={node} draft={undefined} disabled />
        </div>
      )}

      {pasteOpen && (
        <PasteQuestionDialog
          text={pasteText}
          node={node}
          onTextChange={setPasteText}
          onCancel={() => setPasteOpen(false)}
          onConfirm={applyPaste}
        />
      )}
    </section>
  );
}

/**
 * **选择填空**的**得分方式**（★ 2026-09-27 从原来的 `FillScoringRow` 里拆出来）。
 *
 * 🔴 拆开的理由与选择题对齐：教师裁定「两型统一成『得分方式 → 得分规则 → 标准答案』」——
 * 选择题那边「怎么算分」与「多少分」本来就是两块，填空题挤在一块会让两型的块数不一样，
 * 教师从一种题型换到另一种时位置感就断了。
 *
 * 🔴 ★ 2026-10-05（教师最终裁定）：这一行**只服务选择填空**了 —— 填空题的「得分方式」
 *    与「分值」已被整块删除（分值下沉到每个空）。留下的理由写在调用点那段注释里：
 *    判分的逐空那一支服务端只认 `node.type === 'fill-blank'`，选择填空的口径仍是题目级的。
 */
function FillScoringMethodRow({ node, onDataChange }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const perBlank = node.data.fillScoring === 'per-blank';
  return (
    <div className="worksheet-editor-flat-row">
      {/* ★ 2026-10-06：行首标签与组名统一叫「评分方式」（`bodies/fill-blanks-body.tsx`
          逐空那一排早就这么叫）—— 原来这里写「得分方式」，同一个字段两个名字。 */}
      <span className="worksheet-editor-flat-label">评分方式</span>
      {/*
        ★ 2026-10-05（教师）：两个大卡换成与「作答方式 / 评分方式」**同款**的药丸
        （`.worksheet-editor-mode-tabs`）—— 一屏里三处互斥选择长得一样，才不用重新认。
        ⚠️ 原来那个 `.worksheet-editor-scoring-options` 是**多选「评分方式」与「卡片透度」**
           共用的（见 `multi-choice-body.tsx` / `page.tsx`），所以这里换控件，
           而不是去改那条 CSS（改它会连带挤坏那两处）。
        ⚠️ 原来写在卡片小字里的解释（「每答对一空就得分」）**没有丢** —— 它跟着选中的那一档
           显示在右边，而块标题那句与它重复的说明整句删掉了。
      */}
      <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label="评分方式">
        <label className={perBlank ? 'is-selected' : ''}>
          <input type="radio" name={`fill-score-${node.id}`} checked={perBlank} onChange={() => onDataChange({ fillScoring: 'per-blank' })} />
          <span>按空给分</span>
        </label>
        <label className={!perBlank ? 'is-selected' : ''}>
          <input type="radio" name={`fill-score-${node.id}`} checked={!perBlank} onChange={() => onDataChange({ fillScoring: 'whole' })} />
          <span>整题给分</span>
        </label>
      </div>
      <span className="worksheet-editor-flat-note">{perBlank ? '每答对一空就得分' : '所有空都答对才得分'}</span>
    </div>
  );
}

/** **选择填空**的**得分规则**：那一格分值（口径跟着「评分方式」走）。同上，只服务选择填空。 */
function FillPointsRow({ node, inheritedPoints, pointsUnit, onPointsChange }: {
  node: WorksheetQuestionNode;
  inheritedPoints: { full: number; half: number };
  pointsUnit: string;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
}) {
  /* ⚠️ 这一行不再看「得分方式」：口径解释搬到了上面那一行（跟着选中的档显示），
     这里再说一遍就是同一件事说两遍 —— 而那正是教师说的「一层套一层」。 */
  const value = node.points?.full ?? inheritedPoints.full;
  const setValue = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > POINTS_MAX) return;
    onPointsChange({ full: parsed, half: 0 });
  };
  return (
    /* ★ 2026-10-05（教师）：原来这里是一张**内层卡片**（「每空得分 / 答对几个空，就累计几份奖励」
       + 输入框）—— 卡里套卡就是教师说的「一层套一层」。现在是一行：
       标签「分值」（今天刚统一的叫法）+ 输入框 + 单位；口径解释在上一行的「评分方式」那里，
       不再说第二遍。 */
    <div className="worksheet-editor-flat-row">
      <span className="worksheet-editor-flat-label">分值</span>
      <span className="worksheet-editor-points-control">
        <input
          className="input"
          type="number"
          min={1}
          max={POINTS_MAX}
          value={value}
          aria-label="这一题的分值"
          onChange={event => setValue(event.target.value)}
        />
        <b>{pointsUnit}</b>
      </span>
    </div>
  );
}

/**
 * 逐题分值的**两栏行**（规格 §12 裁定 4 / 5）。
 *
 * ```
 * 分值  全对 [ 7 ]  部分给分 [   ]      ← 留空 = 跟随学习单（3 / 2）
 * ```
 *
 * 🔴 **留空 = 继承，且不要预填。** 输入框为空 ⇒ `onPointsChange(undefined)`（整份
 * `points` 消失 = 跟随学习单级）。占位符显示**继承中的那个数**，于是「留空」在屏幕上
 * 不是一个空洞，而是一个**看得见、但是灰的**数 —— 教师能分辨「这是跟随的值」与
 * 「这是我填的值」。预填成实字就分不出这两者了，而教师改学习单级的档时，已保存的题
 * 不会跟随，他看不到任何提示（裁定 4 要防的正是这个）。
 *
 * ⚠️ **两个框要么都填、要么都空**。只填一个**不是一个能保存的状态**：
 * 服务端的 `normalizePoints` 会把缺的那一端补成 `DEFAULT_POINTS`（**不是**学习单级的档）
 * ⇒ 教师填了「全对 7」、部分给分留空，部分给分**静默变成 0 分**。实测与完整理由见
 * `findPartialPoints`。这里给红字，保存时 `save()` 会真的拦下。
 *
 * ⚠️ **非法输入不进 reducer**（`onPointsChange` 不被调用）：`points` 只装整数
 *（**全对 1–99 / 部分给分 0–99**，★ M4a/I1 —— 两档的下界不同，见上面的红字分支），
 * 塞不进 `'7.5'`。被拒的文本靠 `rejectedInput` 留在屏幕上 —— 它是**受控**的，
 * 由 `useWorksheetEditor` 持有（**不是**这里的 `useState`），因为 `save()` 必须看得见它：
 * 否则教师看到框里写着 `7.5`、顶栏写着「已保存」，而发出去的其实是上一次的合法值
 * （2026-09-24 审查实机复现的「界面在说假话」）。它带**签名**，
 * `node.points` 一变（撤销 / 恢复草稿 / 换题）就自动失效。
 */
function PointsRow({ heading, node, inheritedPoints, pointsUnit, rejectedInput, onPointsInputChange, onPointsChange }: {
  /** 两级题号 —— 只用于两个输入框的 `aria-label`（读屏要能说清是哪一题的分值）。 */
  heading: string;
  node: WorksheetQuestionNode;
  inheritedPoints: { full: number; half: number };
  /** 见 `QuestionCard` 上那一条（量词跟着学习单的奖励档走）。 */
  pointsUnit: string;
  /** 屏幕上还没进 reducer 的那两格文本（父层持有，因为 `save()` 要看得见它）。 */
  rejectedInput: RejectedPointInput | undefined;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
}) {
  const signature = pointsSignature(node);
  /**
   * ★ 2026-09-27（教师）：「判断题不存在部分正确，和单选一样，所以得分规则要改。」
   *
   * 🔴 判据在**内核**里（`showsPartialPoints`，有用例 + 变异检验过）—— 这里只读它。
   * 原来这三行在本文件里现算，而那个表达式（`!isChoice || …`）**把判断题算成了「非选择题」**
   * ⇒ 它拿到了跟排序 / 连线 / 归类一样的两栏，可它走的是 `judgeSingleChoice`、
   * 永远返回不了 `partial` —— 那一格是**一句谎话**（填进去的分值没有任何学生拿得到）。
   *
   * ⚠️ **同一个判据还管着三条「拦保存」的闸门**（`findPartialPoints` / `findInvalidPoints` /
   * `findUncommittedPointInput`）。它们的形式是「拦下 → 让教师到那一栏去改」，
   * 所以那一栏一旦不画，就绝不能再拦 —— 见内核那条注释。
   */
  const showHalf = showsPartialPoints(node);
  const shown = rejectedInput && rejectedInput.signature === signature ? rejectedInput : null;

  const fullText = shown?.full !== undefined ? shown.full : pointText(node.points?.full);
  const halfText = shown?.half !== undefined ? shown.half : pointText(node.points?.half);

  // 判据整个在 `planPointInputChange`（内核）里 —— 「非法时两格都记」「半填如实提交」
  // 这两条都有回归网，而组件这一层没有。
  const commit = (which: 'full' | 'half', raw: string) => {
    const plan = planPointInputChange(node, which, raw, rejectedInput);
    if (plan.kind === 'rejected') {
      onPointsInputChange(plan.input);
      return;
    }
    onPointsInputChange(null);
    onPointsChange(plan.points);
  };

  // 两格的域不同（全对 1–99 / 部分给分 0–99），所以**提示文案必须分开** —— 一句
  // 「只能是 0–99 的整数」对着填了 0 的全对框就是错的（0 确实在 0–99 里）。
  const fullInvalid = parsePointInput(fullText, 'full').kind === 'invalid';
  // ⚠️ 只在**那一栏真画出来**时才判 `half` 的合法性：不画的话，这条红字说的是「请改一下」，
  // 而教师**没有那个框可改**（`text` 那一侧读的还是库里那个值）。
  const halfInvalid = showHalf && parsePointInput(halfText, 'half').kind === 'invalid';
  const invalidHint = fullInvalid
    // 🔴 ★ I1：这句必须**指名道姓**说清「全对」那一档，并交代「不计分」今天没有出口 ——
    // 教师填 0 的动机通常就是「这题不计分」，而**今天没有这个设置**（留空只是跟随学习单的
    // 档，不是不计分）。不写这一句，他就会去找一个不存在的选项，或者干脆留下 0。
    ? `「全对给几分」必须是 ${POINTS_FULL_MIN} 以上（${POINTS_FULL_MIN}–${POINTS_MAX} 的整数）——`
      // ⚠️ 这段字是**教师看到的原文**（`<p>` 里渲染，不走 markdown）⇒ 不许出现 `**` 这类记号。
      + ` 填 0 的话，答对这道题的学生会看到红叉：他答对了，却一分都没有。`
      + ` 今天没有「这题不计分」这个设置 —— 两个框都留空只表示跟随学习单的档`
      + `（${inheritedPoints.full} / ${inheritedPoints.half}），不是不计分。`
    : halfInvalid
      // 这一条同时覆盖两种来路：
      //   · 教师**刚打的**那个字（`rejectedInput` 把它留在屏幕上）—— 它没进 reducer，
      //     而且 `save()` 也会拦住保存（`findUncommittedPointInput`）；
      //   · 库里**已经存在**的越界值（只能来自手工改过的行，编辑器的输入路径产生不了它）
      //     —— `save()` 由 `findInvalidPoints` 拦。
      //     第二种没有这条提示就等于**静默**：服务端的 `normalizePointValue` 对越界值
      //     **回落** `DEFAULT_POINTS`（200 变成 1），保存照常 200，而框里还写着 200。
      ? `部分给分只能是 0–${POINTS_MAX} 的整数（0 = 不给部分分），请改一下。`
      : null;
  // ⚠️ 非法值优先：两框非法 + 只填了一个时只显示前一条 —— 两条红字挤在一起，
  // 教师会先去改那个**更靠前**的错，而两条的路数是同一个（先把框改成合法值）。
  // ⚠️ 同样只在画了那两个框时才有意义 —— 这句话说的是「两个框要么都填」，而单栏的题只有一个。
  const partialHint = !invalidHint && showHalf && isPartialPoints(node.points)
    ? '两个框要么都填，要么都留空 —— 只填一个的话，另一个会按 0 分算，学生那边看不出来。'
    : null;

  return (
    <div className="worksheet-editor-points">
      <div className={`worksheet-editor-points-grid${showHalf ? '' : ' is-single'}`}>
        <label className="worksheet-editor-points-field">
          <span>
            <strong>完全正确</strong>
          </span>
          <span className="worksheet-editor-points-control">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={fullText}
              placeholder={String(inheritedPoints.full)}
              aria-label={`${heading} 全对得分`}
            onChange={event => {
              if (!showHalf) {
                const parsed = parsePointInput(event.target.value, 'full');
                if (parsed.kind === 'value') onPointsChange({ full: parsed.value, half: 0 });
                if (parsed.kind === 'empty') onPointsChange(undefined);
                return;
              }
              commit('full', event.target.value);
            }}
            />
            <b>{pointsUnit}</b>
          </span>
        </label>
        {showHalf && <label className="worksheet-editor-points-field">
          <span>
            {/* ★ 2026-10-06：这里原来还有一句「达到下方条件时获得」—— 紧下方那一行
                「部分得分条件」说着同一件事（「学生达到该条件时获得…的分值」），只留那一处。
                ⚠️ 原来那个三元表达式的另一半（「该题型通常不使用部分分」）是**死分支**：
                这一格只在 `showsPartialPoints` 为真时渲染，而它蕴含 `canGivePartial`。 */}
            <strong>部分答对</strong>
          </span>
          <span className="worksheet-editor-points-control">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={halfText}
              placeholder={String(inheritedPoints.half)}
              aria-label={`${heading} 部分给分`}
              onChange={event => commit('half', event.target.value)}
            />
            <b>{pointsUnit}</b>
          </span>
        </label>}
      </div>
      {/*
        ★ 2026-09-25（教师问「留空 = 跟随学习单（1 / 0）这个什么意思」⇒ 那句话没写好）：
        改成一句能直接读懂的话，并把两个数**标上名字** —— 原来光秃秃的「1 / 0」
        得先知道括号里是「全对 / 部分给分」两档才看得懂。
      */}
      <p className="worksheet-editor-points-note">
        {showHalf
          ? `两项都清空时使用默认值：完全正确 ${inheritedPoints.full} ${pointsUnit}，部分答对 ${inheritedPoints.half} ${pointsUnit}。`
          : `清空时使用默认值：完全正确 ${inheritedPoints.full} ${pointsUnit}。`}
      </p>
      {invalidHint && <p className="worksheet-editor-warn-hint">{invalidHint}</p>}
      {partialHint && <p className="worksheet-editor-warn-hint">{partialHint}</p>}
      {shouldWarnZeroHalfCredit(node, inheritedPoints) && (
        // 🔴 规格 §12 裁定 3 的**连带要求**，一个字都不许省：没有这句，教师会以为自己开了
        // 部分得分，而学生**一分都拿不到**，且没有任何报错 —— 他会去怀疑学生。
        <p className="worksheet-editor-warn-hint">
          部分给分设成 0 分，等于全对才算 —— 若想给部分分，请把它填成一个正数。
        </p>
      )}
    </div>
  );
}

/**
 * ★ 2026-09-26（教师裁定）：「**判分依据**」—— 部分给分给到哪一步。
 *
 * 只有部分给分 > 0 时才画（=0 表示不给部分分，那时这一行没有意义）；
 * 也只有 `canGivePartial` 的五个题型才画（单选/判断**永远拿不到部分分**）。
 *
 * 两档语义（与内核 `meetsTolerance` 逐字对应）：
 *   · 缺省 = **旧规则**「只要有一部分对就给分」（`undefined`，不写键）；
 *   · `N` = 「错不超过 N 处」。
 * ⚠️ 档位只列到 3：再大就与缺省档等效（一道 3 项的题「错不超过 2 处」＝「只要有一部分对」），
 * 列出来只会让教师以为两者有区别。真需要更大的容错时缺省档本来就覆盖了。
 */
const TOLERANCE_WORDING: Record<string, { unit: string; verb: string }> = {
  'multi-choice': { unit: '个', verb: '漏选不超过' },
  'fill-blank': { unit: '个空', verb: '错不超过' },
  order: { unit: '处', verb: '位置错不超过' },
  match: { unit: '条', verb: '连错不超过' },
  categorize: { unit: '个', verb: '归错不超过' },
};

function ToleranceRow({ node, onToleranceChange }: {
  node: WorksheetQuestionNode;
  onToleranceChange: (tolerance: number | null) => void;
}) {
  const wording = TOLERANCE_WORDING[node.type] ?? { unit: '处', verb: '错不超过' };
  const current = toleranceOf(node);
  return (
    <label className="worksheet-editor-tolerance">
      <span>
        <strong>部分得分条件</strong>
        <em>学生达到该条件时获得“部分答对”的分值。</em>
      </span>
      <select
        className="input worksheet-editor-tolerance-select"
        value={current === null ? '' : String(current)}
        onChange={event => onToleranceChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">只要有一部分对就给分</option>
        {[1, 2, 3].map((n) => (
          <option key={n} value={n}>{wording.verb} {n} {wording.unit}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * ★ M4b/D1：逐题的**作答方式**（规格 §3-V 那个字段落到 UI 上的地方）。
 *
 * ```
 * 作答方式   ○ 键盘   ○ 手写
 * 手写作答的题不自动评分 —— 看板上只统计作答进度，答案要靠人眼看。
 * ```
 *
 * 画不画这一行由 `QuestionCard` 的 `showInputModeRow` 决定（三条判据写在那里），
 * 本组件只管画。
 *
 * 🔴 **那句提示不能省**（与 C1 的「部分给分给 0 分」那句是同一条纪律）：手写作答**不参与判分**
 * （规格 §12 裁定 3，服务端两条闸见 B1）。教师把一道题改成手写之后，**看板的抽屉里不会再有
 * ✓/½/✗**，而屏幕上没有任何报错 —— 不写这句话，他会以为自己开了一个新功能，
 * 而整题的自动反馈其实消失了。
 *
 * ⚠️ **两个 `radio` 的 `name` 必须带 `node.id`**：同卷多题如果共用名字，选了第 1 题会把
 * 第 2 题的选择顶掉（这条纪律逐字来自学生端 `questions/choice-body.tsx` 的
 * `name={`worksheet-choice-${node.id}`}` 那一处注释；教师端同一张卡片里的
 * `bodies/multi-choice-body.tsx`「评分方式」那一组用 `partial-${node.id}` 是同一条）。
 *
 * ⚠️ **`<label>` 必须包住 `<input>`**（不是 `<span>` + 裸 `input`）：这样整块文字都是点击热区。
 * 教师端这一页**没有**学生端那套 `styles.option`（实测 `src/app/teacher/worksheets/edit/`
 * 下零个 CSS module），省掉这一层的话热区就只剩那个小圆点 ——「看起来能用、用起来别扭」那一类。
 *
 * ⚠️ 复用「评分方式」那一组的类名与版式是**有意的**（`.worksheet-editor-inline-actions`
 * + `.worksheet-editor-option-correct`，两者都已在 `globals.css` 里 —— 见 `:1985` / `:1970`）：
 * `globals.css` 那一节的注释自己写着这条理由 ——
 * 「新的题型直接复用它们（同一张卡片里两套长得不一样的控件比少几条 CSS 糟得多）」。
 */
function InputModeRow({ node, onInputModeChange }: {
  node: WorksheetQuestionNode;
  onInputModeChange: (inputMode: 'keyboard' | 'handwriting' | 'photo') => void;
}) {
  // ⚠️ 「键盘」那一档的判据写成 `!== 'handwriting'`（不是 `=== 'keyboard'`）：
  // 库里的值域虽然就是这两个字面量（服务端 `normalizeNode` 保证），但草稿是**外部输入**
  // （`parseDraft` 只查 id / type / data，不查这一格），一个缺这一格的旧草稿会让**两个**
  // 按钮都没有选中态 —— 而运行时的实际行为（`isInkNode` 回 false ⇒ 学生拿到文本框）是键盘。
  // 屏幕上显示的档与运行时的档必须一致。
  const handwriting = node.inputMode === 'handwriting';
  const photo = node.inputMode === 'photo';
  const drawing = node.type === 'drawing';
  return (
    <>
      <div className="worksheet-editor-inline-actions worksheet-editor-input-modes" role="radiogroup" aria-label="作答方式">
        {!drawing && (
          <label className="worksheet-editor-option-correct">
            <input
              type="radio"
              name={`worksheet-inputmode-${node.id}`}
              checked={!handwriting && !photo}
              onChange={() => onInputModeChange('keyboard')}
            />
            <span><EditorIcon kind="keyboard" />键盘输入</span>
          </label>
        )}
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`worksheet-inputmode-${node.id}`}
            checked={handwriting}
            onChange={() => onInputModeChange('handwriting')}
          />
          {/* ★ 2026-10-06：原来这里写「手写输入」—— 同一张卡的说明里本来就说「手写」，
              同一个字段两个词 ⇒ 统一成「手写」。 */}
          <span><EditorIcon kind="handwriting" />{drawing ? '画板绘制' : '手写'}</span>
        </label>
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`worksheet-inputmode-${node.id}`}
            checked={photo}
            onChange={() => onInputModeChange('photo')}
          />
          <span><EditorIcon kind="photo" />照片上传</span>
        </label>
      </div>
      {/* 🔴 后果提示，写在开关旁边（不是藏在悬停里、也不是只在选中「手写」之后才出现）：
          它说的是一件**已经发生**的事，教师要在点下去**之前**就看得见。 */}
      <p className="worksheet-editor-hint">
        {photo
          ? '照片提交后可供教师查看和 AI 分析。'
          : '仅统计作答进度，可由教师查看或交给 AI 分析。'}
      </p>
    </>
  );
}
