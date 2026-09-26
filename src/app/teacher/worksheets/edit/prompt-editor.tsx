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
  remapRuns,
  setStyleOnRange,
  type PromptBooleanKey,
} from '@/lib/worksheet-prompt-marks';
import {
  WORKSHEET_TEXT_COLORS,
  readPromptImage,
  readPromptRunsFor,
  worksheetAssetUrl,
} from '@/lib/worksheet-presentation';
import { readBlankAnswers } from './worksheet-editor-core';
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
 *    那一段）、换了一道题、别处改了同一道题。判据：`el.textContent !== node.prompt`
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
function blankIdSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** 插入到题干里的那段占位（★ 2026-09-26「填空区域」按钮）。
 *  ⚠️ 改它的长度就改了那个区域在题干里有多宽 —— 它**不是**一个结构化标记，
 *  只是教师眼睛看得见的一串下划线（理由见 `insertBlank` 的注释）。 */
const FILL_BLANK_TEXT = '________';

const BOOLEAN_BUTTONS: { key: PromptBooleanKey; label: ReactNode; title: string }[] = [
  { key: 'bold', label: 'B', title: '加粗' },
  { key: 'italic', label: <i>I</i>, title: '斜体' },
  { key: 'underline', label: <u>U</u>, title: '下划线' },
  // ⚠️ 这一档**写全名**（教师 2026-09-26 第二次改口：先要「『重』字下面带一个着重号」，
  // 看到之后说「直接写『着重号』吧，下面不要有点了」）。与另外三个不同，它不是自证的 ——
  // 「着重号」三个字本身就是说明。
  { key: 'emphasis', label: '着重号', title: '着重号（字下加点）' },
];

export function PromptEditor({ node, onPromptChange, onDataChange }: PromptEditorProps) {
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
    // 区间跟着文字走（纯逻辑，那半边有用例）。
    const nextRuns = remapRuns(runsRef.current, node.prompt, nextText);
    // 文字变了 ⇒ 之前记下的那段选区作废（见 `pendingRangeRef`）。
    pendingRangeRef.current = null;
    onPromptChange(nextText, { promptRuns: isPlainRuns(nextRuns) ? undefined : nextRuns });
    refreshToolbar();
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
   * 在**光标处**插入一个填空区域（教师 2026-09-26：这个按钮**只出现在填空题里**）。
   * ⚠️ 名字带 `AtCaret` 是**故意的**：纯逻辑里那个 `insertBlank(runs, …)` 才是真正
   * 干活的那个，而局部这个名字一度把它遮住（`insertBlank(...)` 解析到本地这个零参函数
   * ⇒ 编译器报「Expected 0 arguments, but got 6」）。
   *
   * ★ 2026-09-26（同一天晚些时候）：**它已经不再只是「视觉占位」了。**
   * 这个按钮经纯逻辑那一层的 `insertBlank` 插入，会给那一段打上**空的标识**
   * ⇒ 学生端**就在那里**画一个输入框（`PromptText` 的 `blanks`）。教师原话
   * 「学生……在填空区域输入答案」至此落地。
   * ⚠️ 那段文字仍然是一串下划线（占位文案），但它现在是**结构性**的 ——
   * 教师把它当普通文字删掉/改写都会让那个空消失（退回桥那一支）。
   * ⚠️ 插入时**还要在插入位置上同步 splice `data.answers`**（标识不是答案序号，
   * 答案序号是「从左到右排第几」）—— 那件事属于第 4 步（编辑器的答案那一栏），
   * 目前**还没做**，已记在 ledger 里。
   */
  const insertBlankAtCaret = () => {
    const el = editableRef.current;
    if (!el) return;
    const text = node.prompt;
    const range = selectedRange(el) || pendingRangeRef.current;
    const from = range ? range.from : (caretOffset(el) ?? text.length);
    const to = range ? range.to : from;
    // ★ 走纯逻辑那一层（它有用例）：插一段占位**并把它标成空**。
    // 🔴 这个按钮上一版**只插了一串下划线、没标空**（那时纯逻辑里还没有 `insertBlank`）
    // —— 于是「填空区域」插进去的其实只是普通文字，学生端根本不会在那儿画输入框。
    // ⚠️ 标识由**这一侧**造（每题唯一，与 `optionKey` / `q_…` 同源）：纯逻辑那一层
    // 不许有随机性，否则它的用例就不确定了。
    // 🔴 **答案那一栏要跟着在同一个位置上 splice。**
    // 空的标识只回答「这几条是不是同一个空」，**不是答案序号** —— 答案序号是
    // 「从左到右排第几」（服务端按 `texts[i]` 取值）。不 splice 的话，在中间插一个空
    // 会让**后面所有答案整体错位一格**：教师看着答案还在，而学生答对的被判错。
    const before = blankRuns(runsRef.current).filter((run) => run.start < from).length;
    const current = readBlankAnswers(node);
    const answers = [...current.slice(0, before), [], ...current.slice(before)];
    const inserted = insertBlank(runsRef.current, text, from, to, FILL_BLANK_TEXT, `blank_${blankIdSuffix()}`);
    if (inserted.text === text) return;
    onPromptChange(inserted.text, {
      promptRuns: isPlainRuns(inserted.runs) ? undefined : inserted.runs,
      // ⚠️ 顺手把老形状的 `blanks` 清掉：两份答案并存会让「哪一份算数」有两个答案。
      answers,
      blanks: undefined,
    });
    renderRunsInto(el, inserted.text, inserted.runs);
    // 光标落在**插入的那一段之后**（接着打字不该把这串下划线拆开）。
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
          {BOOLEAN_BUTTONS.map(button => (
            <button
              key={button.key}
              type="button"
              className={toolbar[button.key] ? 'is-active' : ''}
              // ⚠️ 用 `onMouseDown` 而不是 `onClick`：**点按钮那一下会把输入框的焦点与选区
              // 一起拿走**，等 `onClick` 跑到的时候 `selectedRange` 已经是空了 ——
              // 症状是「选中一段点 B 没反应」。`preventDefault` 保住选区（而 not 保焦点）。
              onMouseDown={(event) => {
                event.preventDefault();
                applyToSelection({ [button.key]: !toolbar[button.key] } as Partial<Record<PromptBooleanKey, boolean>>);
              }}
              aria-pressed={toolbar[button.key]}
              title={button.title}
            >
              {button.label}
            </button>
          ))}
          {/* ★ 2026-09-26（教师）：「工具栏里还要有一个按钮『填空区域』，点击后可以在光标的
            位置插入一个填空区域……**这个按钮只会出现在填空题中**。」 */}
        {node.type === 'fill-blank' && (
          <button
            type="button"
            title="在光标处插入一个填空区域"
            // ⚠️ 与另外四个格式按钮同一条：`onMouseDown` + `preventDefault` 保住光标/选区，
            // 否则点它那一下就把光标拿走了，`caretOffset` 读到的是「没焦点」。
            onMouseDown={(event) => {
              event.preventDefault();
              insertBlankAtCaret();
            }}
          >
            填空区域
          </button>
        )}
        {/* 颜色：**自定义下拉**（原生 `<select>` 的 `<option>` 上不了色，理由见 `colorOpen`）。
              ⚠️ 触发按钮上**不能**加 `preventDefault` 那一套：它会把下拉一起按死
              （2026-09-26 就是这么坏的）。选区由外面那一层的捕获负责（`pendingRangeRef`）。 */}
          <div className="worksheet-editor-color-control" ref={colorBoxRef}>
            <button
              type="button"
              className="worksheet-editor-color-trigger"
              onClick={() => setColorOpen(open => !open)}
              aria-haspopup="listbox"
              aria-expanded={colorOpen}
              aria-label="题干文字颜色"
            >
              <span>文字颜色</span>
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
          <label className="worksheet-editor-image-upload">
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
              event.target.value = '';
            }} />
            {uploading ? '上传中…' : imageUrl ? '更换图片' : '添加图片'}
          </label>
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
          data-placeholder={node.type === 'fill-blank' ? '例如：植物进行光合作用释放的气体是____。' : '例如：光合作用需要哪些条件？'}
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
