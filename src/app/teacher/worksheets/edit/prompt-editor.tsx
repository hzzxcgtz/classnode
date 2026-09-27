'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';
import type { WorksheetQuestionNode } from '@/lib/types';
import {
  DEFAULT_PROMPT_STYLE,
  blankRuns,
  insertBlank,
  isPlainRuns,
  rangeColor,
  rangeHasKey,
  recognizeBlanks,
  remapRuns,
  removePromptRange,
  setStyleOnRange,
  type PromptBooleanKey,
  type PromptRun,
} from '@/lib/worksheet-prompt-marks';
import {
  WORKSHEET_TEXT_COLORS,
  readPromptImage,
  readPromptRunsFor,
  worksheetAssetUrl,
} from '@/lib/worksheet-presentation';
import { hasPromptBlankSlots, isChoiceQuestion, newBlankId, readBlankAnswers } from './worksheet-editor-core';
import { caretOffset, placeSelection, renderRunsInto, selectedRange } from './prompt-rich-text';

/**
 * 题干的**所见即所得**编辑器（★ 2026-09-26，教师裁定 ①）。
 *
 * 教师原话：「需增加下划线和着重号，并且可以**只选择下面的部分文字**来设置。」
 * 三条路（纯文本框 + 下方预览 / 文本框 + 镜像层 / 所见即所得）里他选了**体验最好、
 * 风险最大**的一条 —— 下面写清它难在哪，以及每一条难处对应的那几行代码。
 *
 * ── 🔴 五条硬约束（少一条就坏，不是「最好这样」）────────────────────────────
 *
 * 1. **React 永远不许重渲这个框的子节点。**
 *    JSX 里那个 `<div contentEditable>` **一个子节点都不挂** —— 内容全部由
 *    `renderRunsInto` 用 JS 写。一旦 React 按 state 重画它，输入法拼字会被打断，
 *    🔴 **症状是「这个框没法打中文」**，而这个仓的用户全是中文教师。
 *
 * 2. **拼字期间一个字都不许回写。**
 *    `compositionstart` → `compositionend` 之间 `onInput` 直接 return：不写 DOM、
 *    不算区间、不 setState。**这是唯一会让字段彻底不可用的一条。**
 *    （另外再用 `nativeEvent.isComposing` 兜一层 —— 两处都留着是有意的。）
 *
 * 3. **靠「文本对不对得上」区分「自己的回声」与「外部改动」。**
 *    外部改动 = ⌘Z 撤销（本仓的历史栈**有意**抢掉了浏览器的撤销，见 `edit/page.tsx`
 *    那一段）、换了一道题、别处改了同一道题。判据：`el.textContent !== node.prompt`。
 *    ⇒ 外部 ⇒ **整块重建**并把光标放回去；相等 ⇒ 自己刚敲的那一下的回声 ⇒ **什么都不做**。
 *    ⚠️ 少了「重建」，⌘Z 之后数据变了而屏幕纹丝不动；少了「什么都不做」，
 *    每敲一个字都要重建一次 DOM，光标当场跳回开头。
 *
 * 4. **重建之后光标要放回去**（夹紧到新长度）。
 *    `<textarea>` 是**白拿**这一条的（React 换 `value`，浏览器自己管光标）；
 *    contenteditable 不给 `selectionStart`，只能自己按**字符偏移**存/取。
 *
 * 5. **换题整块重建**（`node.id` 变了就重建，不试图 diff）。
 *
 * ── 裁定 ②：没选中文字 ⇒ 什么都不做 ────────────────────────────────────────
 * 工具栏那几个按钮**永远只管选中的那一段**，没有第二种含义（「没选 = 整段」那种双关
 * 会让教师分不清自己刚才设的是哪一段）。`selectedRange` 返回 `null` 时按钮点了不生效，
 * `is-active` 也全部不亮。
 *
 * ⚠️ **本文件在本机没有任何自动化能替它作证**（没有 jsdom、没有浏览器）：输入法、
 * 光标、着重号字形、下划线位置 —— 只能真机走查。所以「设格式到底改了什么」全部下沉到
 * `@/lib/worksheet-prompt-marks`（那半边有用例、做过变异检验），这里只负责把选区接上去、
 * 把结果画回来。
 */
export interface PromptEditorProps {
  node: WorksheetQuestionNode;
  /**
   * ★ 2026-09-26：`data` 补丁与题干**同一次**提交 —— 一个按键只进一格撤销栈。
   * 理由见 `worksheet-editor-core.ts` 里 `updatePrompt` 的注释。
   */
  onPromptChange: (prompt: string, data?: Record<string, unknown>) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  /**
   * ★ 2026-09-27（教师）：「在题目内容框内增加从剪贴板粘贴类似的按钮，不要使用在选项框内
   * onpaste，还是有个按钮用户使用更方便。」⇒ 工具栏里多一个按钮，**由题目卡处理那次粘贴**
   * —— 一次粘贴可能同时改题干与选项，而选项不在这个组件的职责里。
   */
  onRequestPaste: () => void;
}

/** 工具栏的亮灯状态 —— 由**当前选区**决定，所以必须是 state（选区变了要重画按钮）。 */
interface ToolbarState {
  hasSelection: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  emphasis: boolean;
  color: string;
}

const NO_SELECTION: ToolbarState = {
  hasSelection: false,
  bold: false,
  italic: false,
  underline: false,
  emphasis: false,
  color: DEFAULT_PROMPT_STYLE.color,
};

/**
 * 四个布尔按钮的图标与提示。**一个地方定义**，省得图标与 title 漂移。
 *
 * ⚠️ 图标**自己就是那个样子**（`<i>I</i>` 是斜的、`<u>U</u>` 带下划线）—— 这是原来
 * `B` / `<i>I</i>` 那一版的写法，**别图省事改成纯字符串**：那样图标就不自证了
 *（把 `'I'` 写成纯文本时它就不再是斜的 —— 2026-09-26 我改成字符串时真的丢了这一层，
 * 教师看出来的）。
 * ⚠️ 类名要 `ReactNode` 而不是 `string` 正是为了这个。
 * 对应的样式在 `globals.css` 里显式写了一份（`.worksheet-editor-formatbar > button u/i`）——
 * 不靠浏览器默认值，免得哪天的全局重置把它悄悄弄没。
 */
/**
 * 造一个空的标识（★ 2026-09-26）。
 * ⚠️ **随机性只许留在这一侧**：纯逻辑那一层（`@/lib/worksheet-prompt-marks`）拿了标识
 * 当参数，它自己不许造 —— 否则那里的用例就不确定了。
 */
/** 教师端可读的填空占位串；学生端仍根据 run 的 blank 标识渲染真正输入区。 */
const FILL_BLANK_TEXT = '{填空域}';

/**
 * 文本变了之后重算分段：**先跟随文本重映射区间，再按文本重新识别填空域**。
 *
 * 🔴 **两步都不能省，而且顺序不能反**：
 *   · `remapRuns` 负责「区间跟着文本走」（在空前面打字，空要挪位、身份不变）。
 *   · `recognizeBlanks` 负责**教师裁定的那条规则**：`{填空域}` 就是 5 个普通字符 ⇒
 *     **是不是空由文本决定**。只 remap 不识别的话，被删掉一个字符的占位串**还会**算成
 *     一个空（个数不降、答案还挂着），而那是**静默**的。
 *   · 反过来也不行：识别会拿没重映射过的区间去比对，「在空前面打字」会被判成新空、答案错位。
 */
function runsFromText(prevRuns: PromptRun[], prevText: string, nextText: string): PromptRun[] {
  const moved = remapRuns(prevRuns, prevText, nextText);
  return recognizeBlanks(moved, nextText, FILL_BLANK_TEXT, () => newBlankId());
}

/**
 * 把一段**纯文本**整段当成新题干时，要跟着一起提交的 `data` 补丁（★ 2026-09-27，粘贴题目用）。
 *
 * 🔴 **不能只写 `prompt` 就完事**：题干的分段存在 `data.promptRuns` 里，而 `readPromptRuns`
 * **只认存量**、不会从文本里重新认填空域 —— 会做那件事的只有 `recognizeBlanks`。
 * 粘进来的题干是纯文本，所以这里从空数组起重认一遍：
 *   · 普通题干 ⇒ 一整段普通分段 ⇒ `isPlainRuns` 为真 ⇒ 写 `undefined`（把旧格式清干净）；
 *   · 题干里带着 `{填空域}`（教师从自己的稿子里抄过来的）⇒ 认成真正的空。
 * ⚠️ 少了它，粘进来的 `{填空域}` 在教师端画不出灰底、学生端也不会在那里画输入框 ——
 * **而屏幕上只是几个普通字符**，没有任何东西会报错。
 */
export function promptRunsPatchFor(text: string): Record<string, unknown> {
  const runs = recognizeBlanks([], text, FILL_BLANK_TEXT, () => newBlankId());
  return { promptRuns: isPlainRuns(runs) ? undefined : runs };
}

const BOOLEAN_BUTTONS: { key: PromptBooleanKey; label: ReactNode; title: string }[] = [
  { key: 'bold', label: 'B', title: '加粗' },
  { key: 'italic', label: <i>I</i>, title: '斜体' },
  { key: 'underline', label: <u>U</u>, title: '下划线' },
  // ⚠️ 这一档**写全名**（教师 2026-09-26 第二次改口：先要「『重』字下面带一个着重号」，
  // 看到之后说「直接写『着重号』吧，下面不要有点了」）。与另外三个不同，它不是自证的 ——
  // 「着重号」三个字本身就是说明。
  { key: 'emphasis', label: <span className="worksheet-editor-emphasis-glyph">着</span>, title: '着重号（字下加点）' },
];

export function PromptEditor({ node, onPromptChange, onDataChange, onRequestPaste }: PromptEditorProps) {
  const supportsBlankSlots = hasPromptBlankSlots(node.type);
  /**
   * ★ 2026-09-27（教师）：「"粘贴题目"只在选择题中需要。」—— 判断题的选项固定是对/错、
   * 别的题型根本没有选项表，给它们画这个按钮，教师会粘进来一列选项然后**什么都看不见**。
   * ⚠️ 判据在核心里（`isChoiceQuestion`，有用例），别在这里重写一遍。
   */
  const canPasteQuestion = isChoiceQuestion(node);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [toolbar, setToolbar] = useState<ToolbarState>(NO_SELECTION);
  /**
   * 颜色那个自定义下拉开着没有。
   *
   * 🔴 **为什么不用原生 `<select>`**（原来是它）：原生下拉里那几行 `<option>` 是**系统
   * 画的**，`background-color` / `color` 一律被忽略 —— 教师只能看到「深灰 / 蓝色 / …」
   * 这一串字，而要选的是**颜色**（2026-09-26 教师原话：「图中右侧的色彩圆放到下拉列表里，
   * 让人在选的时候就能看到实际颜色」）。要让它看得见，只能自己画。
   */
  const [colorOpen, setColorOpen] = useState(false);
  const colorBoxRef = useRef<HTMLDivElement | null>(null);

  const runs = readPromptRunsFor(node);
  const imageUrl = readPromptImage(node);
  const editableRef = useRef<HTMLDivElement | null>(null);
  /** 拼字中（约束 2）。 */
  const composingRef = useRef(false);
  /** 这个框里现在画的是**哪一道题** —— 换题必须整块重建（约束 5）。 */
  const renderedIdRef = useRef<string | null>(null);
  /** `runs` 的最新一份（事件回调是闭包，`remapRuns` 要用**当下**的那一份）。 */
  const runsRef = useRef(runs);
  runsRef.current = runs;
  /**
   * 「按下工具栏那一刻」的选区。
   *
   * 🔴 **必须有它，而且不能靠 `preventDefault` 顶替。** 四个格式按钮用
   * `mousedown` + `preventDefault` 就能保住焦点与选区；但**颜色那个 `<select>` 不行** ——
   * `preventDefault` 会连**原生下拉都打不开**（2026-09-26 交付当天就是这么坏的：
   * 颜色点了没反应）。而原生下拉一打开，焦点与选区就没了。
   * ⇒ 在工具栏那一层的**捕获阶段**把当时的选区记下来（那时焦点还没跑），
   * 控件真正触发时拿它当落点。
   * ⚠️ 打字会把它作废（`handleInput` 里清掉）—— 否则「先选一段、再打字、再改颜色」
   * 会作用到一段早就不存在的范围上。
   */
  const pendingRangeRef = useRef<{ from: number; to: number } | null>(null);

  /** 按当前选区刷新工具栏的亮灯（没选中 ⇒ 全灭，裁定 ②）。 */
  const refreshToolbar = useCallback(() => {
    const el = editableRef.current;
    if (!el) {
      setToolbar(NO_SELECTION);
      return;
    }
    // ⚠️ 输入框**没有焦点**时退回「按下工具栏那一刻记下的选区」。
    //
    // 🔴 少了这一条会出一个很别扭的毛病：点开颜色下拉会**把焦点从输入框拿走** ⇒
    // `selectionchange` 随之触发 ⇒ 这里是「没选中」⇒ 工具栏被重置成 `NO_SELECTION`
    // ⇒ 下拉里那个「当前是哪个色」的勾**跳到深灰**，而选区上明明是红的。
    // 有焦点时只认**活的**选区（那时停在框里的光标就是真相，旧的那份已经过期）。
    const range = selectedRange(el) || (document.activeElement === el ? null : pendingRangeRef.current);
    const current = runsRef.current;
    if (!range || !current) {
      setToolbar(NO_SELECTION);
      return;
    }
    setToolbar({
      hasSelection: true,
      bold: rangeHasKey(current, range.from, range.to, 'bold'),
      italic: rangeHasKey(current, range.from, range.to, 'italic'),
      underline: rangeHasKey(current, range.from, range.to, 'underline'),
      emphasis: rangeHasKey(current, range.from, range.to, 'emphasis'),
      color: rangeColor(current, range.from, range.to) || DEFAULT_PROMPT_STYLE.color,
    });
  }, []);

  /**
   * 把 DOM 画成 `node` 那一份（约束 1/3/4/5 都落在这里）。
   *
   * ⚠️ 依赖刻意**不含 `runs`**：它是每次渲染新造的数组，拿它当依赖会让这个 effect
   * 每渲染跑一遍。真正的变化信号是 `node.prompt` 与 `node.data.promptRuns` ——
   * reducer 在「什么都没变」时返回**原对象**，所以那两个身份是稳的。
   */
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    // 约束 3：文本对得上 = 自己刚敲的那一下的回声 ⇒ **什么都不做**。
    // ⚠️ 换题那一下必须**不看文本**（两道题的题干可能一模一样，而格式不同）。
    if (renderedIdRef.current === node.id && el.textContent === node.prompt) return;
    // 约束 4：重建之前先记下光标位置（焦点不在这个框里就不记 —— 那时没有光标）。
    const caret = document.activeElement === el ? caretOffset(el) : null;
    renderRunsInto(el, node.prompt, readPromptRunsFor(node));
    renderedIdRef.current = node.id;
    if (caret !== null) placeSelection(el, Math.min(caret, node.prompt.length), Math.min(caret, node.prompt.length));
    refreshToolbar();
    // ⚠️ 依赖给的是整个 `node`（而不是那三个字段）：effect 体里还调了 `readPromptRunsFor(node)`，
    // 而它要的是整个节点。多跑几次不要紧 —— 第一句那个**字符串比较**会把绝大多数情况
    // 直接挡回去（这也是它刻意写在最前面的理由）。
  }, [node, refreshToolbar]);

  /**
   * 选区变了 ⇒ 刷新工具栏。
   * ⚠️ `selectionchange` 挂在 `document` 上（挂在元素上没有这个事件）。
   * 它是**每次**选区变化都派发的，所以回调必须便宜（几次字符累计而已）。
   */
  useEffect(() => {
    const onSelectionChange = () => refreshToolbar();
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [refreshToolbar]);

  /**
   * 颜色下拉开着的时候：点外面或按 Esc 关掉。
   * ⚠️ `mousedown`（不是 `click`）：点外面那一下要**在**它变成别处的点击之前关掉，
   * 否则那一下会先被别的控件吃掉，下拉还挂在屏幕上。
   */
  useEffect(() => {
    if (!colorOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const box = colorBoxRef.current;
      if (box && event.target instanceof Node && box.contains(event.target)) return;
      setColorOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColorOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [colorOpen]);

  /**
   * 敲了字（约束 2 的另一半 + 区间跟着走）。
   *
   * 🔴 顺序不能反：**先**看拼字标记再读文本 —— 拼字中途的 `textContent` 是**半成品**
   *（带下划线的那串拼音），拿它去 remap 会让区间在拼字期间来回抖。
   */
  const handleInput = (event: React.FormEvent<HTMLDivElement>) => {
    if (composingRef.current) return;
    if ((event.nativeEvent as InputEvent).isComposing) return;
    const el = editableRef.current;
    if (!el) return;
    const nextText = el.textContent || '';
    if (nextText === node.prompt) return;
    // 区间跟着文字走 + 按文本重新识别填空域（纯逻辑，那半边有用例）。
    const nextRuns = runsFromText(runsRef.current, node.prompt, nextText);
    // 文字变了 ⇒ 之前记下的那段选区作废（见 `pendingRangeRef`）。
    pendingRangeRef.current = null;
    const nextData: Record<string, unknown> = {
      promptRuns: isPlainRuns(nextRuns) ? undefined : nextRuns,
    };
    if (supportsBlankSlots) {
      const answers = readBlankAnswers(node);
      const byId = new Map(blankRuns(runsRef.current).map((run, index) => [run.blank, answers[index] ?? []]));
      nextData.answers = blankRuns(nextRuns).map(run => byId.get(run.blank) ?? []);
      nextData.blanks = undefined;
    }
    onPromptChange(nextText, nextData);
    refreshToolbar();
  };

  /** 删除一段题干；若命中填空占位符，答案按稳定 blank id 一起重排。 */
  const deletePromptRange = (from: number, to: number) => {
    const el = editableRef.current;
    if (!el) return;
    const removed = removePromptRange(runsRef.current, node.prompt, from, to);
    if (removed.text === node.prompt) return;
    // 删完也要重新识别：退回一个字可能把某个占位串删坏 ⇒ 按规则②它该降级成普通文字
    //（只 remap 不识别的话，那个空**还会**算一个空，而这是静默的）。
    removed.runs = recognizeBlanks(removed.runs, removed.text, FILL_BLANK_TEXT, () => newBlankId());
    const answers = readBlankAnswers(node);
    const byId = new Map(blankRuns(runsRef.current).map((run, index) => [run.blank, answers[index] ?? []]));
    onPromptChange(removed.text, {
      promptRuns: isPlainRuns(removed.runs) ? undefined : removed.runs,
      ...(supportsBlankSlots ? {
        answers: blankRuns(removed.runs).map(run => byId.get(run.blank) ?? []),
        blanks: undefined,
      } : {}),
    });
    renderRunsInto(el, removed.text, removed.runs);
    el.focus();
    placeSelection(el, from, from);
    pendingRangeRef.current = null;
    refreshToolbar();
  };


  /**
   * 回车 = 在光标处插入一个**换行符**，走模型；不让浏览器自己造换行。
   *
   * 🔴 根因（2026-09-27 教师报的两个症状，**同一个洞**）：此前这里没有任何 Enter 处理
   *    ⇒ 浏览器自己插 `<br>` / 建块级元素。而
   *      ① 写回模型走的是 `el.textContent`（`handleInput`）—— `<br>` 与块边界**都产生
   *         0 个字符** ⇒ 那些换行**既不在模型里、也不在字符偏移里**；
   *      ② `charsBefore` / `placeSelection` **只数文本节点** ⇒ 断行处两侧的偏移**相等**
   *         ⇒「上一行末尾的胶囊之后」与「下一行第一个胶囊之前」是**同一个偏移**。
   *    两个症状由此而来：回车那次换行模型不认（下次整块重建时又画出来 ⇒ 多一个空行）；
   *    在下一行首个胶囊前按退格，`handleAtomicBlankDelete` 按偏移匹配，命中的是
   *    **上一行末尾那个空**，把它删了。
   *    ⇒ 修法是让换行成为**模型里的一个真字符**，DOM 与偏移层就不会分叉。
   *
   * ⚠️ **拼字期间必须放行**（与 `handleInput` 同一道守卫，两处都留是有意的）：
   *    中文输入法用回车**上屏**，在这里 `preventDefault` 会让教师打不出中文 ——
   *    那是本文件五条硬约束里的第 2 条。
   * ⚠️ `.worksheet-editor-prompt-input` 有 `white-space: pre-wrap`（globals.css），
   *    所以这个 `\n` 会被画成真换行；改那个属性会让回车看起来「没反应」。
   */
  const handleEnter = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    if (composingRef.current) return;
    if ((event.nativeEvent as KeyboardEvent).isComposing) return;
    const el = editableRef.current;
    if (!el) return;
    const caret = caretOffset(el);
    if (caret === null) return;
    const selected = selectedRange(el);
    const from = selected ? selected.from : caret;
    const to = selected ? selected.to : caret;
    event.preventDefault();
    const nextText = `${node.prompt.slice(0, from)}\n${node.prompt.slice(to)}`;
    const nextRuns = remapRuns(runsRef.current, node.prompt, nextText);
    pendingRangeRef.current = null;
    const nextData: Record<string, unknown> = {
      promptRuns: isPlainRuns(nextRuns) ? undefined : nextRuns,
    };
    if (supportsBlankSlots) {
      const answers = readBlankAnswers(node);
      const byId = new Map(blankRuns(runsRef.current).map((run, index) => [run.blank, answers[index] ?? []]));
      nextData.answers = blankRuns(nextRuns).map(run => byId.get(run.blank) ?? []);
      nextData.blanks = undefined;
    }
    onPromptChange(nextText, nextData);
    renderRunsInto(el, nextText, nextRuns);
    el.focus();
    // ★ 2026-09-27：胶囊成了普通字符 ⇒ 落光标不再需要任何特判（那段 `placeCaretBesideNode`
    // 的绕法连同原子化那一整套一起删了）。换行符右侧现在就是普通位置。
    placeSelection(el, from + 1, from + 1);
    refreshToolbar();
  };

  // ★ 2026-09-27：方向键与退格都不再由我们接管 —— 胶囊是普通字符，浏览器自己管光标与删除；
  // 「删掉一个字符 ⇒ 那个空降级成普通文字」正是教师裁定的规则②。**只剩回车要拦**
  //（不然浏览器会造出模型接不住的 `<br>`）。
  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    handleEnter(event);
  };

  /**
   * 工具栏点了一下（裁定 ②：没选中就什么都不做）。
   *
   * ⚠️ 「设上还是取消」的判据是 `rangeHasKey`（**整段**都有才算）而不是「有一部分」：
   * 选一段半粗半不粗的文字点 B，那一下是「设上」，不是「取消」。
   *
   * ⚠️ 改完**整块重建 DOM 并把选区放回去**，不走「只改样式、保住选区」那条快路径：
   * 样式一变，分段的**条数**往往也变了（切开/合并），能保住选区的只有「条数没变」
   * 那一种情形，而那一条快路径是**第二处**能把选区算错的地方。宁可多画一次。
   */
  const applyToSelection = (patch: Partial<Record<PromptBooleanKey, boolean>> & { color?: string }) => {
    const el = editableRef.current;
    if (!el) return;
    // ⚠️ 活的选区优先；没有就用工具栏按下那一刻记下的那一份（颜色那个原生下拉
    // 一打开选区就没了）。
    const range = selectedRange(el) || pendingRangeRef.current;
    if (!range) {
      // 裁定 ②：一个字符都没选中 ⇒ 不生效（按钮本来也不亮）。
      setToolbar(NO_SELECTION);
      return;
    }
    const nextRuns = setStyleOnRange(runsRef.current, node.prompt, range.from, range.to, patch);
    if (nextRuns === runsRef.current) return;
    // 🔴 与题干**同一次**提交：分两次 dispatch 会让 ⌘Z 的第一下退到一个什么都没变的
    // 动作上（教师看到屏幕纹丝不动，只能再按一次）。
    onPromptChange(node.prompt, { promptRuns: isPlainRuns(nextRuns) ? undefined : nextRuns });
    renderRunsInto(el, node.prompt, nextRuns);
    // ⚠️ 先把焦点放回输入框再放选区：从原生下拉回来时焦点在 `<select>` 上，
    // 不放回来的话选区**画不出来**（数据是对的，但教师看不到自己设了哪一段）。
    el.focus();
    placeSelection(el, range.from, range.to);
    setColorOpen(false);
    refreshToolbar();
  };

  /**
   * 在**光标处**插入一个填空域。普通填空与选择填空都依赖同一份结构化空标记：
   * 前者让学生输入文字，后者把它作为词块的拖放目标。
   * ⚠️ 名字带 `AtCaret` 是**故意的**：纯逻辑里那个 `insertBlank(runs, …)` 才是真正
   * 干活的那个，而局部这个名字一度把它遮住（`insertBlank(...)` 解析到本地这个零参函数
   * ⇒ 编译器报「Expected 0 arguments, but got 6」）。
   *
   * ★ 2026-09-26（同一天晚些时候）：**它已经不再只是「视觉占位」了。**
   * 这个按钮经纯逻辑那一层的 `insertBlank` 插入，会给那一段打上**空的标识**
   * ⇒ 学生端**就在那里**画一个输入框（`PromptText` 的 `blanks`）。教师原话
   * 「学生……在填空域输入答案」至此落地。
   * 占位文案显示为紧凑的 `{填空域}`，并由 contenteditable=false 与 keydown 接管共同保证
   * 光标不能进入、一次删除整块。插入和删除时答案按稳定 blank id 同步重排。
   */
  const insertBlankAtCaret = () => {
    const el = editableRef.current;
    if (!el) return;
    const text = node.prompt;
    const range = selectedRange(el) || pendingRangeRef.current;
    const from = range ? range.from : (caretOffset(el) ?? text.length);
    const to = range ? range.to : from;
    // ★ 走纯逻辑那一层（它有用例）：插一段占位**并把它标成空**。
    // 🔴 这个按钮早期版本只插入普通占位文字、没标空（那时纯逻辑里还没有 `insertBlank`）
    // —— 于是「填空域」插进去的其实只是普通文字，学生端根本不会在那儿画输入框。
    // ⚠️ 标识由**这一侧**造（每题唯一，与 `optionKey` / `q_…` 同源）：纯逻辑那一层
    // 不许有随机性，否则它的用例就不确定了。
    // 🔴 **答案那一栏要跟着在同一个位置上 splice。**
    // 空的标识只回答「这几条是不是同一个空」，**不是答案序号** —— 答案序号是
    // 「从左到右排第几」（服务端按 `texts[i]` 取值）。不 splice 的话，在中间插一个空
    // 会让**后面所有答案整体错位一格**：教师看着答案还在，而学生答对的被判错。
    const existingBlanks = blankRuns(runsRef.current);
    const before = existingBlanks.filter((run) => run.start < from).length;
    // `readBlankAnswers` 为兼容老的单空数据，在「题干还没有空」时也会回 `[[]]`；
    // 这里的数量必须只听题干，先按已有占位符裁齐，再插入新的一格。
    const storedAnswers = readBlankAnswers(node);
    const current = existingBlanks.map((_, index) => storedAnswers[index] ?? []);
    const answers = [...current.slice(0, before), [], ...current.slice(before)];
    const inserted = insertBlank(runsRef.current, text, from, to, FILL_BLANK_TEXT, newBlankId());
    // 同一条规则：文本一变就重新识别（这里恒等，但别为它留例外 —— 例外就是下一次的静默分叉）。
    inserted.runs = recognizeBlanks(inserted.runs, inserted.text, FILL_BLANK_TEXT, () => newBlankId());
    if (inserted.text === text) return;
    onPromptChange(inserted.text, {
      promptRuns: isPlainRuns(inserted.runs) ? undefined : inserted.runs,
      // ⚠️ 顺手把老形状的 `blanks` 清掉：两份答案并存会让「哪一份算数」有两个答案。
      answers,
      blanks: undefined,
    });
    renderRunsInto(el, inserted.text, inserted.runs);
    // 光标落在**插入的那一段之后**（接着打字不该进入原子占位符内部）。
    const after = from + FILL_BLANK_TEXT.length;
    el.focus();
    placeSelection(el, after, after);
    refreshToolbar();
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    setUploadError('');
    try {
      const result = await api.uploadWorksheetImage(file);
      onDataChange({ promptImageUrl: result.url });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="worksheet-editor-rich-field">
      {/* ★ 2026-09-26（教师）：「这个有点多余」—— 这张卡的 section 头已经写着
          「题目内容 / 写清学生需要完成什么」，下面再挂一个「题干」是同一句话说两次。
          （原来的 `.worksheet-editor-rich-label` 也一并从 CSS 里删了。） */}
      {/* ★ 2026-09-26（教师）：「这个工具栏能不能集成到下面的编辑框里，现在感觉有点割裂感。」
          ⇒ 工具条与编辑区收进**同一个框**：框顶那一条是工具，下面就是正文（Word / 问卷星
          都是这个样子）。提示语挪到**框外面**去 —— 它原来是夹在两者中间的那一条，
          正是「割裂感」的一部分。 */}
      <div className="worksheet-editor-rich-box">
        <div
          className="worksheet-editor-formatbar"
          aria-label="题干文字格式"
          // ⚠️ 捕获阶段：要在**任何**控件把焦点拿走之前量。理由见 `pendingRangeRef`。
          onMouseDownCapture={() => {
            const el = editableRef.current;
            pendingRangeRef.current = el ? selectedRange(el) : null;
          }}
        >
          <div className="worksheet-editor-tool-group" role="group" aria-label="文字样式">
            {BOOLEAN_BUTTONS.map(button => (
              <button
                key={button.key}
                type="button"
                className={toolbar[button.key] ? 'is-active' : ''}
                disabled={!toolbar.hasSelection}
                // ⚠️ 用 `onMouseDown` 而不是 `onClick`：**点按钮那一下会把输入框的焦点与选区
                // 一起拿走**，等 `onClick` 跑到的时候 `selectedRange` 已经是空了 ——
                // 症状是「选中一段点 B 没反应」。`preventDefault` 保住选区（而 not 保焦点）。
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyToSelection({ [button.key]: !toolbar[button.key] } as Partial<Record<PromptBooleanKey, boolean>>);
                }}
                aria-pressed={toolbar[button.key]}
                aria-label={button.title}
                title={toolbar.hasSelection ? button.title : '请先选中文字'}
              >
                {button.label}
              </button>
            ))}
            <div className="worksheet-editor-color-control" ref={colorBoxRef}>
              <button
                type="button"
                className="worksheet-editor-color-trigger"
                disabled={!toolbar.hasSelection}
                onClick={() => setColorOpen(open => !open)}
                aria-haspopup="listbox"
                aria-expanded={colorOpen}
                aria-label="题干文字颜色"
                title={toolbar.hasSelection ? '文字颜色' : '请先选中文字'}
              >
                <span className="worksheet-editor-color-letter" style={{ color: toolbar.color }}>A</span>
                <b style={{ backgroundColor: toolbar.color }} aria-hidden="true" />
              </button>
              {colorOpen && (
                <div className="worksheet-editor-color-menu" role="listbox" aria-label="文字颜色">
                  {WORKSHEET_TEXT_COLORS.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      role="option"
                      aria-selected={toolbar.color === color.value}
                      className={`worksheet-editor-color-option${toolbar.color === color.value ? ' is-active' : ''}`}
                      onClick={() => applyToSelection({ color: color.value })}
                    >
                      <b style={{ backgroundColor: color.value }} aria-hidden="true" />
                      <span>{color.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* 普通填空与选择填空都需要题干内的结构化空；选择填空少了它就只有词块、没有落点。 */}
          <div className="worksheet-editor-tool-group is-insert" role="group" aria-label="插入题目内容">
          {/* ★ 2026-09-27（教师）：「在题目内容框内增加从剪贴板粘贴类似的按钮，不要使用在选项框内
              onpaste，还是有个按钮用户使用更方便。」⇒ 从剪贴板粘一整道题（题干 + 选项一起识别）。
              ⚠️ **只在选择题上画** —— 判据见 `canPasteQuestion`。
              ⚠️ 这里**不读剪贴板**（`navigator.clipboard.readText()` 会弹浏览器自己的「粘贴」
              授权浮层，教师看到的是一个莫名其妙的 tip）。按 ⌘V 那一下由弹窗里的输入框接住。 */}
          {canPasteQuestion && (
          <button
            type="button"
            title="粘贴一整道选择题（题干与选项一起识别）"
            aria-label="粘贴题目"
            onClick={onRequestPaste}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="3" width="8" height="4" rx="1.4" />
              <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
              <path d="M9 12h6M9 16h4" />
            </svg>
            粘贴题目
          </button>
          )}
          {supportsBlankSlots && (
            <button
              type="button"
              title="在光标处插入一个填空域"
              aria-label="插入填空域"
              onMouseDown={(event) => {
                event.preventDefault();
                insertBlankAtCaret();
              }}
            >
              <span className="worksheet-editor-blank-glyph" aria-hidden="true">{'{填空域}'}</span>
            </button>
          )}
          <label className="worksheet-editor-image-upload">
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
              event.target.value = '';
            }} />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9" r="1.5" /><path d="m5 17 4.5-4.5 3.5 3 2.5-2.5L19 17" />
            </svg>
            {uploading ? '上传中…' : imageUrl ? '换图' : '图片'}
          </label>
          </div>
        </div>
        {/*
          🔴 **一个子节点都不挂**（约束 1）：内容全由 `renderRunsInto` 用 JS 写。
          React 只认 `data-*` 那几个属性（占位符靠它们驱动 CSS），从不碰 children。
        */}
        <div
          ref={editableRef}
          className="worksheet-editor-prompt-input"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="题干"
          data-empty={node.prompt.trim() ? undefined : '1'}
          data-placeholder={supportsBlankSlots ? '输入题干，在需要学生作答的位置插入填空域。' : '例如：光合作用需要哪些条件？'}
          onKeyDown={handlePromptKeyDown}
          onInput={handleInput}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            // 拼字结束那一下 `onInput` 可能已经在标记清掉之前跑过了 ⇒ 这里补一次。
            handleInput(event);
          }}
        />
      </div>
      {/* ⚠️ 没选中时给一句为什么按不动（裁定 ② 的代价：这些按钮没有第二种含义）。
          放在**框外面**：它夹在工具条与正文中间的话，那个框就不像一个整体了。 */}
      <p className="worksheet-editor-format-hint">
        {toolbar.hasSelection ? '格式只作用于选中的那一段文字。' : '先选中要设置格式的文字，再点上面工具栏里的按钮。'}
      </p>
      {imageUrl && (
        <div className="worksheet-editor-upload-preview">
          <img src={worksheetAssetUrl(imageUrl)} alt="题干配图预览" />
          <button type="button" onClick={() => onDataChange({ promptImageUrl: undefined })}>移除图片</button>
        </div>
      )}
      {uploadError && <p className="worksheet-editor-upload-error" role="alert">{uploadError}</p>}
    </div>
  );
}
