'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { QuestionPointsDraft, WorksheetQuestionNode } from '@/lib/types';
import { api } from '@/lib/api';
import { WORKSHEET_TEXT_COLORS, readPromptImage, readPromptRunsFor, readPromptStyle, worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { PromptText } from '@/lib/worksheet-prompt-text';
import {
  canGivePartial,
  displayPoints,
  effectiveHalfStep,
  gradesOnSubmit,
  isGradedQuestionType,
  toleranceOf,
  isPartialPoints,
  parsePointInput,
  planPointInputChange,
  pointText,
  POINTS_FULL_MIN,
  POINTS_MAX,
  pointsSignature,
  QUESTION_TYPE_OPTIONS,
  type RejectedPointInput,
  shouldWarnZeroHalfCredit,
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
import { ChoiceOptionsEditor } from './bodies/choice-options';
import { TrueFalseBody } from './bodies/true-false-body';
import { MultiChoiceBody } from './bodies/multi-choice-body';
import { FillBlanksBody } from './bodies/fill-blanks-body';
import { OrderBody } from './bodies/order-body';
import { MatchBody } from './bodies/match-body';
import { CategorizeBody } from './bodies/categorize-body';
// ★ M4b/D1：「这道题是不是手写作答」这个判据只有一份，在 `src/lib/worksheet-ink.ts`
//（学生端的分派器 `questions/index.tsx` 用的也是它）。此处**不重写**那条判据 ——
// 重写一遍就是两份真源，而它们漂移的后果是「教师在教师端选的档」与「学生端拿到的输入形态」
// 不一致，且屏幕上看不出来。
import { isInkNode } from '@/lib/worksheet-ink';

const QUESTION_EDITOR_COPY: Record<string, { title: string; description: string }> = {
  'single-choice': {
    title: '选项与正确答案',
    description: '编辑学生看到的选项；开启自动评分后，需要指定一个正确答案。',
  },
  'true-false': {
    title: '判断答案',
    description: '学生从“正确”和“错误”中选择；开启自动评分后，需要指定标准答案。',
  },
  'multi-choice': {
    title: '选项与正确答案',
    description: '可设置多个正确答案，并决定漏选时是否给部分分。',
  },
  'fill-blank': {
    title: '填空与参考答案',
    description: '为每个空设置答案；学生的答案将按这些内容自动判断。',
  },
  order: {
    title: '排序条目与正确顺序',
    description: '编辑需要排序的条目，并调整标准答案中的正确次序。',
  },
  match: {
    title: '连线项目与正确配对',
    description: '编辑左右两侧内容，并为每一项指定正确的连接关系。',
  },
  categorize: {
    title: '分类框与条目归属',
    description: '先设置分类框，再指定每个条目应该放入哪个分类。',
  },
  'short-answer': {
    title: '学生作答方式',
    description: '问答题由学生输入文字或手写内容，提交后由教师人工查看。',
  },
  drawing: {
    title: '学生作答方式',
    description: '绘图题固定使用手写画布，适合演算、标注和自由绘制。',
  },
};

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
export function QuestionCard({ heading, index, total, expanded, focusedMode = false, onToggle, inTask, taskId, onDragStart, node, inheritedPoints, rejectedPointInput, onPromptChange, onDataChange, onPointsInputChange, onPointsChange, onInputModeChange, onAutoGradeChange, onToleranceChange, onMove, onRemove }: {
  /**
   * ★ 2026-09-25（第二轮终审 F3）：卡片上显示的**两级题号**（`任务一 · 2`）——
   * 与看板列头 / 抽屉 / 导出 / **保存失败的报错**同一份，由 `editorRenderRows` 给出。
   *
   * 🔴 它取代了原来的 `index + 1`（容器内下标）。那个数在正常路径上就错：两个任务时
   * 同屏有**两张「第 1 题」**，而保存失败说「任务二 · 1 的分值只填了一个框」——
   * 教师得在两处「第 1 题」之间猜是哪一张。
   * ⚠️ `index` / `total` **留着**，但它们只服务 ▲▼ 的边界（换位是**同层内**的）。
   */
  heading: string;
  /** 同层内的位置与个数（0-based）—— ▲▼ 的边界判据，**不用于显示**。 */
  index: number;
  total: number;
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
  /** 这一题那两格里**还没进 reducer** 的文本（`useWorksheetEditor` 持有，见 `PointsRow`）。 */
  rejectedPointInput: RejectedPointInput | undefined;
  onPromptChange: (prompt: string) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
  /** ★ M4b/D1：逐题的作答方式（键盘 / 手写）。走 reducer，所以进撤销栈。 */
  onInputModeChange: (inputMode: 'keyboard' | 'handwriting') => void;
  /** ★ 2026-09-26：「允许自动评分」那个开关。 */
  onAutoGradeChange: (autoGrade: boolean) => void;
  /** ★ 2026-09-26：部分给分的容错档。`null` = 缺省（旧规则「只要有一部分对就给分」）。 */
  onToleranceChange: (tolerance: number | null) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const typeOption = QUESTION_TYPE_OPTIONS.find(option => option.value === node.type);
  const typeLabel = typeOption?.label ?? node.type;
  const promptRuns = readPromptRunsFor(node);
  const promptImage = readPromptImage(node);

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
  const isDrawing = node.type === 'drawing';
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
  const showInputModeRow = !isDrawing && (typeOption?.graded === false || isInkNode(node));
  const editorCopy = QUESTION_EDITOR_COPY[node.type] ?? {
    title: '作答设置',
    description: '设置学生作答时需要看到和填写的内容。',
  };
  const shownPoints = displayPoints(node, inheritedPoints);
  const gradingStatus = isGradedQuestionType(node.type)
    ? (gradedOn ? `自动评分 · 最高 ${shownPoints.full} 分` : '仅统计作答')
    : '教师人工查看';

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
              <strong>{typeLabel}</strong>
            </span>
          ) : (
            <span className="worksheet-editor-question-type">{typeLabel}</span>
          )}
          <span className={`worksheet-editor-grade-status${gradedOn ? ' is-on' : ' is-manual'}`}>
            {gradingStatus}
          </span>
        </button>
        {/* ⚠️ `stopPropagation`：这一块在折叠时也挂在可点的 `<section>` 里，
            不拦住的话按一下 ▲ 会顺带把整张卡展开（而教师只想挪一位）。 */}
        <div className="worksheet-editor-question-tools" onClick={event => event.stopPropagation()}>
          {/*
            ★ 2026-09-26（spec 第 5 步）：**拖拽把手**。
            ⚠️ 为什么必须是把手、不能让整行可拖：整行已经挂「点一下展开」了 ——
            两者会抢同一个手势（教师想展开却被拖走）。
            ⚠️ `touch-action: none`（CSS）是**必须**的：不写的话触屏上浏览器会先把这次
            拖动解释成滚动，`pointermove` 到一半就断了。`▲▼` 留着：拖拽对键盘用户不可用。
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
            className="worksheet-editor-icon-button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title={index === 0 ? '已经是第一题' : '上移一位'}
            aria-label="上移一位"
          >
            ▲
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title={index === total - 1 ? '已经是最后一题' : '下移一位'}
            aria-label="下移一位"
          >
            ▼
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button is-danger"
            onClick={onRemove}
            title="删除这道题"
            aria-label="删除这道题"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
            </svg>
          </button>
        </div>
      </header>

      {/* ⚠️ `(<>` 后面**不能**多一个 `)`：多了会被 JSX 当成**文本节点**渲染出一个孤零零的
          `)`，而 tsc / eslint / 用例**全都不会红**（语法合法）。教师 2026-09-26 在真机上
          就是这么发现的 —— 见那一天的提交。 */}
      {expanded && (<div className="worksheet-editor-question-form">
      <section className="worksheet-editor-question-section is-prompt">
        <div className="worksheet-editor-section-head">
          <div>
            <h3>题目内容</h3>
            <p>写清学生需要完成什么，题干会直接显示在学生端。</p>
          </div>
          <span>必填</span>
        </div>
        <PromptEditor
          node={node}
          onPromptChange={onPromptChange}
          onDataChange={onDataChange}
        />
      </section>

      <section className="worksheet-editor-question-section is-answer">
        <div className="worksheet-editor-section-head">
          <div>
            <h3>{editorCopy.title}</h3>
            <p>{editorCopy.description}</p>
          </div>
          <span>{typeLabel}</span>
        </div>

        {showInputModeRow && <InputModeRow node={node} onInputModeChange={onInputModeChange} />}

        {/* 题型 → 编辑体。这里保持与学生端题型数据结构一一对应。 */}
        {node.type === 'single-choice' && <SingleChoiceBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'true-false' && <TrueFalseBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'multi-choice' && <MultiChoiceBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'fill-blank' && <FillBlanksBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'order' && <OrderBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'match' && <MatchBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}
        {node.type === 'categorize' && <CategorizeBody node={node} onDataChange={onDataChange} showAnswer={gradedOn} />}

        {!gradedOn && isGradedQuestionType(node.type) && (
          <p className="worksheet-editor-answer-disabled">
            自动评分已关闭，正确答案暂时隐藏；选项和条目仍可继续编辑。
          </p>
        )}
        {node.type === 'short-answer' && (
          <p className="worksheet-editor-manual-note"><strong>人工查看</strong>学生提交后不自动判分，看板只统计作答进度。</p>
        )}
        {node.type === 'drawing' && (
          <p className="worksheet-editor-manual-note"><strong>固定为手写画布</strong>学生可自由书写和绘制，提交后由教师人工查看。</p>
        )}
      </section>

      <section className="worksheet-editor-question-section is-grading">
        <div className="worksheet-editor-section-head">
          <div>
            <h3>评分设置</h3>
            <p>{isGradedQuestionType(node.type) ? '决定这道题是否自动判断，以及答对后获得多少分。' : '这类题不自动判断答案，教师可在课堂中查看学生的作答内容。'}</p>
          </div>
          <span className={gradedOn ? 'is-active' : ''}>{gradingStatus}</span>
        </div>

      {/*
        ★ 2026-09-25（教师裁定）：**不设答案的选择题不判分**，所以这里不给它分值行 ——
        一个「全对 1 / 部分给分 0」的输入框摆在一道不判分的题上，就是在说「它会算分」。
        ⚠️ 判据是 `gradesOnSubmit`（核心里、有用例），不是「题型是不是选择题」——
        填空/排序/连线/归类的答案在别的键上，拿选择题的尺子量它们会让分值行**整片消失**。
        ⚠️ 区分两种情况，话不一样：题型**本来就不判分**（问答 / 绘图）时什么都不说，
        因为那是题型的性质、教师改不了；只有「能判分却没设答案」才需要一句话告诉他为什么。
      */}
      {/*
        ★ 2026-09-26（教师裁定）：**「允许自动评分」这个开关 + 由它决定显示什么**。
        开着（缺省）⇒ 答案、全对分、部分给分都要设；关掉 ⇒ 三样一起隐藏，这道题不判分。
        ⚠️ 开关**只对「本来就能判分」的题型画**（问答 / 绘图 / 任务没有它 ——
        它们本来就不判分，给一个开了也没用的开关是骗人）。
      */}
      {isGradedQuestionType(node.type) && (
        <label className="worksheet-editor-autograde">
          <span className="worksheet-editor-autograde-copy">
            <strong>自动评分</strong>
            <em>{gradedOn ? '已开启。系统会按标准答案判断，并使用下方得分规则。' : '已关闭。这道题只统计是否作答，不显示对错，也不计入得分。'}</em>
          </span>
          <span className="worksheet-editor-autograde-control">
            <input
              type="checkbox"
              checked={node.autoGrade !== false}
              onChange={event => onAutoGradeChange(event.target.checked)}
              aria-label="允许自动评分"
            />
            <span aria-hidden="true" />
          </span>
        </label>
      )}

      {gradesOnSubmit(node) && (
        <PointsRow
          heading={heading}
          node={node}
          inheritedPoints={inheritedPoints}
          rejectedInput={rejectedPointInput}
          onPointsInputChange={onPointsInputChange}
          onPointsChange={onPointsChange}
        />
      )}

      {/*
        ★ 2026-09-26（教师裁定）：「如果部分给分框内设了非 0 值，则显示判分依据的设置」。
        ⚠️ 判据用的是 `effectiveHalfStep`（内核里、有 6 条用例）—— 「这一题**实际会用到**的
        部分给分档」。半填（只填了一个框）时它回 `null`（说不准）⇒ 那时**不显示**这一行：
        教师还在打字的中间态，弹出一行要他选容错档是打断。
      */}
      {gradesOnSubmit(node) && canGivePartial(node.type)
        && (effectiveHalfStep(node, inheritedPoints) ?? 0) > 0 && (
        <ToleranceRow node={node} onToleranceChange={onToleranceChange} />
      )}

      {!gradesOnSubmit(node) && isGradedQuestionType(node.type) && (
        <p className="worksheet-editor-ungraded-hint">
          当前为<strong>仅统计作答</strong>。原有正确答案和分值会保留，重新开启自动评分即可恢复。
        </p>
      )}
        {!isGradedQuestionType(node.type) && (
          <div className="worksheet-editor-manual-grade">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>无需设置分值</strong>
              <p>学生提交后由教师人工查看，系统不会根据答案自动给分。</p>
            </div>
          </div>
        )}
      </section>
      </div>)}

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
          <p className="worksheet-editor-question-preview-prompt">
            <PromptText text={node.prompt} runs={promptRuns} placeholder="（题干还没写）" />
          </p>
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
    </section>
  );
}

function PromptEditor({ node, onPromptChange, onDataChange }: {
  node: WorksheetQuestionNode;
  onPromptChange: (prompt: string) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const style = readPromptStyle(node);
  const imageUrl = readPromptImage(node);
  const updateStyle = (patch: Partial<typeof style>) => {
    onDataChange({ promptStyle: { ...style, ...patch } });
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
      <span className="worksheet-editor-rich-label">题干</span>
      <div className="worksheet-editor-formatbar" aria-label="题干文字格式">
        <button type="button" className={style.bold ? 'is-active' : ''} onClick={() => updateStyle({ bold: !style.bold })} aria-pressed={style.bold} title="加粗">B</button>
        <button type="button" className={style.italic ? 'is-active' : ''} onClick={() => updateStyle({ italic: !style.italic })} aria-pressed={style.italic} title="斜体"><i>I</i></button>
        <label className="worksheet-editor-color-control">
          <span>文字颜色</span>
          <select value={style.color} onChange={event => updateStyle({ color: event.target.value })} aria-label="题干文字颜色">
            {WORKSHEET_TEXT_COLORS.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}
          </select>
          <b style={{ backgroundColor: style.color }} aria-hidden="true" />
        </label>
        <label className="worksheet-editor-image-upload">
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
            event.target.value = '';
          }} />
          {uploading ? '上传中…' : imageUrl ? '更换图片' : '添加图片'}
        </label>
      </div>
      <textarea
        className="input"
        rows={3}
        value={node.prompt}
        style={{ color: style.color, fontWeight: style.bold ? 700 : 600, fontStyle: style.italic ? 'italic' : 'normal' }}
        onChange={event => onPromptChange(event.target.value)}
        placeholder={node.type === 'fill-blank' ? '例如：植物进行光合作用释放的气体是____。' : '例如：光合作用需要哪些条件？'}
      />
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
function PointsRow({ heading, node, inheritedPoints, rejectedInput, onPointsInputChange, onPointsChange }: {
  /** 两级题号 —— 只用于两个输入框的 `aria-label`（读屏要能说清是哪一题的分值）。 */
  heading: string;
  node: WorksheetQuestionNode;
  inheritedPoints: { full: number; half: number };
  /** 屏幕上还没进 reducer 的那两格文本（父层持有，因为 `save()` 要看得见它）。 */
  rejectedInput: RejectedPointInput | undefined;
  onPointsInputChange: (input: RejectedPointInput | null) => void;
  onPointsChange: (points: QuestionPointsDraft | undefined) => void;
}) {
  const signature = pointsSignature(node);
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
  const halfInvalid = parsePointInput(halfText, 'half').kind === 'invalid';
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
  const partialHint = !invalidHint && isPartialPoints(node.points)
    ? '两个框要么都填，要么都留空 —— 只填一个的话，另一个会按 0 分算，学生那边看不出来。'
    : null;

  return (
    <div className="worksheet-editor-points">
      <div className="worksheet-editor-points-head">
        <div>
          <strong>得分规则</strong>
          <span>留空时跟随学习单的默认分值，也可以为本题单独设置。</span>
        </div>
        <span>最高 {fullText || inheritedPoints.full} 分</span>
      </div>
      <div className="worksheet-editor-points-grid">
        <label className="worksheet-editor-points-field">
          <span>
            <strong>完全正确</strong>
            <em>答案全部符合标准</em>
          </span>
          <span className="worksheet-editor-points-control">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={fullText}
              placeholder={String(inheritedPoints.full)}
              aria-label={`${heading} 全对得分`}
              onChange={event => commit('full', event.target.value)}
            />
            <b>分</b>
          </span>
        </label>
        <label className="worksheet-editor-points-field">
          <span>
            <strong>部分正确</strong>
            <em>{canGivePartial(node.type) ? '达到下方条件时获得' : '该题型通常不使用部分分'}</em>
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
            <b>分</b>
          </span>
        </label>
      </div>
      {/*
        ★ 2026-09-25（教师问「留空 = 跟随学习单（1 / 0）这个什么意思」⇒ 那句话没写好）：
        改成一句能直接读懂的话，并把两个数**标上名字** —— 原来光秃秃的「1 / 0」
        得先知道括号里是「全对 / 部分给分」两档才看得懂。
      */}
      <p className="worksheet-editor-points-note">
        两项都清空时使用默认值：完全正确 {inheritedPoints.full} 分，部分正确 {inheritedPoints.half} 分。
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
        <em>只有部分正确分值大于 0 时才会使用此条件。</em>
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
 * 手写作答的题不自动判分 —— 看板上只统计作答进度，答案要靠人眼看。
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
  onInputModeChange: (inputMode: 'keyboard' | 'handwriting') => void;
}) {
  // ⚠️ 「键盘」那一档的判据写成 `!== 'handwriting'`（不是 `=== 'keyboard'`）：
  // 库里的值域虽然就是这两个字面量（服务端 `normalizeNode` 保证），但草稿是**外部输入**
  // （`parseDraft` 只查 id / type / data，不查这一格），一个缺这一格的旧草稿会让**两个**
  // 按钮都没有选中态 —— 而运行时的实际行为（`isInkNode` 回 false ⇒ 学生拿到文本框）是键盘。
  // 屏幕上显示的档与运行时的档必须一致。
  const handwriting = node.inputMode === 'handwriting';
  return (
    <>
      <div className="worksheet-editor-inline-actions">
        <span className="worksheet-editor-block-label">作答方式</span>
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`worksheet-inputmode-${node.id}`}
            checked={!handwriting}
            onChange={() => onInputModeChange('keyboard')}
          />
          <span>键盘</span>
        </label>
        <label className="worksheet-editor-option-correct">
          <input
            type="radio"
            name={`worksheet-inputmode-${node.id}`}
            checked={handwriting}
            onChange={() => onInputModeChange('handwriting')}
          />
          <span>手写</span>
        </label>
      </div>
      {/* 🔴 后果提示，写在开关旁边（不是藏在悬停里、也不是只在选中「手写」之后才出现）：
          它说的是一件**已经发生**的事，教师要在点下去**之前**就看得见。 */}
      <p className="worksheet-editor-hint">
        手写作答的题不自动判分 —— 看板上只统计作答进度，答案要靠人眼看。
      </p>
    </>
  );
}

/**
 * 单选题：选项列表（增删改）+ 正确答案单选。
 *
 * ★ M4a：选项编辑的**逻辑与实现**搬进了 `bodies/choice-options.tsx`（单选/多选共用一份，
 * 用 `multiple` 开关区分），这里只剩「按单选口径调它」这一层。
 * 那条「`options` 与 `correctKeys` 必须**一起**提交」的纪律也跟着搬了过去 —— 它现在只有
 * 一处需要遵守（那正是拆出这个组件的目的：多选直接用 `SingleChoiceBody` 的话，
 * `writeOptions` 结尾的 `slice(0, 1)` 会把第 2 个正确答案静默丢掉）。
 */
function SingleChoiceBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  showAnswer?: boolean;
}) {
  return <ChoiceOptionsEditor node={node} multiple={false} onDataChange={onDataChange} showAnswer={showAnswer} />;
}
