'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeacherEmptyState, TeacherLoadingState, Toast } from '@/lib/components';
import type { AgentSummary, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { api } from '@/lib/api';
// 奖励形式的取值域 / 可选步长只有一份（`src/lib/worksheet-reward.ts`）—— 教师端这四行
// 与学生端那个徽章用的是同一份，加一档只改那一处。
import { pointsUnitLabel, DEFAULT_HALF_STEP, DEFAULT_REWARD_STEP, REWARD_STYLE_OPTIONS } from '@/lib/worksheet-reward';
import { QuestionCard } from './question-card';
import { TaskCard } from './task-card';
import { dropIndexAt, editorRenderBlocks, scoreSummary } from './worksheet-editor-core';
import { TASK_TYPE } from '@/lib/worksheet-questions';
import { WorksheetPreviewModal } from './preview-modal';
import { questionTypeIcon } from '@/lib/worksheet-question-icons';
import {
  WORKSHEET_BACKGROUND_OPTIONS,
} from '@/lib/worksheet-backgrounds';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { RewardIcon } from '@/components/worksheet-reward-icon';
// 纯符号（常量与类型）**一律从内核取**，不从 `use-worksheet-editor` 转手。
// `use-worksheet-editor.ts` 里有 `export * from './worksheet-editor-core'`，所以同一个
// `QUESTION_TYPE_OPTIONS` 有**两条 import 路径**。那不是一个假想的风险：`question-card.tsx`
// 与 `preview-modal.tsx` 已经改指内核了，而这一页还指着 hook —— 下一次给题型加一个字段时，
// 只更新一处就会让两边的标签表分叉，且没有任何编译期信号。
// ⚠️ 只把**内核里的**符号改成从内核取：`useWorksheetEditor` 是 hook（本身就在 hook 文件里），
// `SaveStatus` 是 hook 的状态类型（内核里没有），这两个留在原处。
import { useWorksheetEditor, type SaveStatus } from './use-worksheet-editor';
import {
  QUESTION_TYPE_OPTIONS,
  type EditorBlock,
  type QuestionType,
  type WorksheetDraft,
} from './worksheet-editor-core';

/**
 * 学习单编辑页（`/teacher/worksheets/edit/?id=xxx`）。
 *
 * `id` 走查询参数、缺省即空白编辑器（规格 §6.1）：静态导出没有动态路由（§3-X），
 * 全仓同类跳转都是这个写法。本页与 C1 的列表页共用同一个地址形状，
 * 「新建」与「编辑」是同一个页面。
 *
 * 版式分三层（规格 §6.2 方案乙）：
 *   顶栏（返回 / 标题 / 保存状态 / 设置 / 预览 / 保存）
 *   —— 题流（每题一张卡片，直接编辑题干、选项、正确答案）
 *   —— 底部的「＋ 添加题目」。
 *
 * ★ 2026-09-27（教师裁定）：顶栏的「撤销重做」与「复制一份」两个按钮删掉了；
 * 「保存」保留，它存的是**整张学习单**（见那一处的注释）。
 *
 * `useSearchParams` 必须被 Suspense 包住（静态导出预渲染的硬要求）——
 * 与 `teacher/classroom/page.tsx` 同一写法。
 */
export default function WorksheetEditPage() {
  return (
    <Suspense fallback={<TeacherLoadingState label="正在打开编辑器…" />}>
      <WorksheetEditorBody />
    </Suspense>
  );
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function describeSaveStatus(saveStatus: SaveStatus, dirty: boolean, hasId: boolean): string {
  if (saveStatus.kind === 'saving') return '保存中…';
  if (saveStatus.kind === 'error') return '保存失败';
  if (dirty) return '未保存';
  if (saveStatus.kind === 'saved' && saveStatus.at) return `已保存 ${formatClock(saveStatus.at)}`;
  // 一次都没保存过、也没有改动 ⇒ 这是一份还没落库的新学习单。
  if (!hasId) return '新学习单 · 还没保存过';
  return '已保存';
}

function WorksheetEditorBody() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || null;

  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const toastTimerRef = useRef<number | null>(null);
  const notify = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(previous => ({ ...previous, show: false })), 3000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const editor = useWorksheetEditor({ id, onNotice: notice => notify(notice.message, notice.type) });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  /**
   * 加题弹窗现在要知道**加到哪儿**（★ 2026-09-25）：
   *   `null`      = 弹窗没开；
   *   `{ parentId }` = 开着，`parentId` 为 `null` 表示加到顶层（散题，老数据形态）。
   * 迁移之后顶层的题都在任务里，所以绝大多数情况 `parentId` 是一个任务 id ——
   * 旧写法（没有这个参数）会让教师新加的题永远落在任务**外面**。
   */
  /** 当前在主工作区编辑的题。结构栏始终展示全卷，但主区域一次只显示这一题。 */
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const [pickerFor, setPickerFor] = useState<{ parentId: string | null } | null>(null);

  const { content, worksheetId, usage, saveStatus, draftFound } = editor;
  // ★ 2026-09-25：页面只做**哑映射** —— 切段与题号在核心里（纯函数、有测试）。
  const blocks = editorRenderBlocks(content.nodes);

  /**
   * 学习单级的**两档**（逐题留空的题继承的就是它们）—— 传给每张卡片当占位符。
   *
   * ⚠️ 只做**显示**与「部分给分 0 分」那条提示的判据，**绝不**拿它去预填逐题的输入框：
   * 预填等于把「跟随学习单」拍成一份副本，教师之后改这两档时已保存的题不会跟随，
   * 而他看不到任何提示（规格 §12 裁定 4 的理由）。
   *
   * `useMemo` 只是让每张卡片拿到同一个引用（值不变时不造新对象）；
   * ⚠️ 必须在下面那两个提前 return **之前**调用（Hooks 的调用顺序不许跳）。
   */
  const inheritedPoints = useMemo(
    // ★ 2026-09-26（教师裁定）：学习单级的那两档**不再参与判分**（逐题分值已由迁移钉住）
    // ⇒ 这里给的是**默认档**（1 / 0），它只剩一个用途：两格都清空时的落点。
    () => ({ full: DEFAULT_REWARD_STEP, half: DEFAULT_HALF_STEP }),
    [],
  );

  // ★ 2026-09-26（spec 第 4 步）：页面头的「N 题 · 满分 M」（核心里、有用例）。
  const totals = scoreSummary(content.nodes, inheritedPoints);

  /**
   * 工作台只编辑当前这一题。结构变化后，如果当前题已经被删除，就落到第一道可编辑题；
   * 空任务仍可单独选中并编辑标题与说明。
   */
  useEffect(() => {
    const currentBlock = blocks.find(block => block.questions.some(row => row.node.id === openId));
    if (currentBlock) {
      const taskId = currentBlock.task?.node.id ?? null;
      if (activeTaskId !== taskId) setActiveTaskId(taskId);
      return;
    }
    const currentTaskBlock = blocks.find(block => block.task?.node.id === activeTaskId);
    if (currentTaskBlock) {
      const firstInTask = currentTaskBlock.questions[0]?.node.id ?? null;
      if (openId !== firstInTask) setOpenId(firstInTask);
      return;
    }
    const firstQuestionBlock = blocks.find(block => block.questions.length > 0);
    if (firstQuestionBlock) {
      setOpenId(firstQuestionBlock.questions[0].node.id);
      setActiveTaskId(firstQuestionBlock.task?.node.id ?? null);
      return;
    }
    setOpenId(null);
    const firstTaskId = blocks.find(block => block.task)?.task?.node.id ?? null;
    if (activeTaskId !== firstTaskId) setActiveTaskId(firstTaskId);
  }, [activeTaskId, blocks, openId]);

  const activeBlock = useMemo(() => {
    if (openId) {
      const byQuestion = blocks.find(block => block.questions.some(row => row.node.id === openId));
      if (byQuestion) return byQuestion;
    }
    return blocks.find(block => block.task?.node.id === activeTaskId) ?? null;
  }, [activeTaskId, blocks, openId]);

  const selectQuestion = useCallback((questionId: string, taskId: string | null) => {
    setOpenId(questionId);
    setActiveTaskId(taskId);
  }, []);

  const selectTask = useCallback((block: EditorBlock) => {
    setActiveTaskId(block.task?.node.id ?? null);
    setOpenId(block.questions[0]?.node.id ?? null);
  }, []);

  const pendingNewQuestionIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const previous = pendingNewQuestionIds.current;
    if (!previous) return;
    for (const block of blocks) {
      const added = block.questions.find(row => !previous.has(row.node.id));
      if (!added) continue;
      pendingNewQuestionIds.current = null;
      selectQuestion(added.node.id, added.taskId);
      return;
    }
  }, [blocks, selectQuestion]);


  /**
   * 删题确认（规格 §6.4）。文案里必须含**已收到的作答份数** —— 不说的后果是教师
   * 以为「只是删一道题」，而学生已经写下的答案会变成看板与导出里的孤立数据。
   *
   * ⚠️ `usage.responseCount` 是**整卷**的作答份数（`WorksheetResponse` 行数），
   * 不是「这道题被答了多少次」—— 服务端没有按题统计的字段。所以措辞刻意分开：
   * 一个数字讲整卷，一句话讲这道题的答案会怎样，不能把它们说成同一件事。
   */
  /**
   * ★ 2026-09-26（spec 第 3 步）：**↑ / ↓ 在题与题之间跳**。
   *
   * 一页 20 题时，改完第 3 题要改第 4 题 —— 用鼠标滚 + 找 + 点，是这一页最频繁的动作之一。
   *
   * 🔴 **必须放行输入框里的上下键**：在题干 / 选项里，上下键是**移动光标**（多行文本框里
   * 尤其明显）。抢了它的后果是教师打字时按一下上就跳到别的题上 —— 而这一条与
   * `⌘Z` 那处**有意相反**（那里抢是对的：历史栈每次改动一条，退掉的正是上一个字符）。
   * ⇒ 判据是「焦点在不在输入类控件里」，`input` / `textarea` / `select` / `contenteditable` 一律放行。
   *
   * ⚠️ 只**移动焦点**，不展开、不折叠：教师是去「看下一题」，展开与否由他自己决定
   *（`Enter` / 空格 / 点一下才是展开 —— 那是按钮自带的键盘行为）。
   * ⚠️ 用 `focus()` 而不是自己算滚动：浏览器会把它滚进视野，且尊重 `prefers-reduced-motion`。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const target = event.target as HTMLElement | null;
      // 焦点在输入类控件里 ⇒ 放行（那是光标移动，不是跳题）。
      if (!target || target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const current = target.closest('[data-question-id]');
      if (!current) return;
      const all = Array.from(document.querySelectorAll<HTMLElement>('[data-question-id]'));
      const next = all[all.indexOf(current as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      next.querySelector<HTMLElement>('.worksheet-editor-question-summary')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * ★ 2026-09-26（spec 第 5 步）：**指针拖拽排序**（含落点那条线）。
   *
   * 🔴 用**指针事件**，不是 HTML5 拖放：学生端 `use-pointer-drag.ts` 已经踩过一遍
   * （老 iPad 上 HTML5 DnD 不可用），而这一页也可能在触屏笔记本上开。
   * ⚠️ 必须在把手上写 `touch-action: none`（CSS），否则触屏上浏览器会先把这次拖动
   * 解释成滚动，`pointermove` 到一半就断了。
   *
   * 落点只认**同层**的兄弟行（`data-layer`）：任务内的小题在同一个层里排，
   * 顶层那些（任务 + 散题）在另一个层里排。**跨层拖动是另一件事**（换组），
   * 内核的 `canReorder` 明确不许 —— 所以同层之外根本没有落点，线也不会跑出去。
   */
  const [drag, setDrag] = useState<{ id: string; layer: string; from: number } | null>(null);
  const [dropLine, setDropLine] = useState<{ y: number; left: number; width: number } | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  const startDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>, id: string, layer: string, from: number,
  ) => {
    // ⚠️ `preventDefault`：不拦的话按住把手拖到文字上会**顺带选中一片文字**。
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dropIndexRef.current = null;
    setDropLine(null);
    setDrag({ id, layer, from });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const rowsInLayer = () => Array.from(
      document.querySelectorAll<HTMLElement>(`[data-outline-layer="${CSS.escape(drag.layer)}"]`),
    );
    const onMove = (event: PointerEvent) => {
      const rows = rowsInLayer();
      if (rows.length === 0) return;
      const rects = rows.map((row) => row.getBoundingClientRect());
      const index = dropIndexAt(rects.map((rect) => ({ top: rect.top, height: rect.height })), event.clientY);
      dropIndexRef.current = index;
      // 线画在**行的边界**上（第 0 位画在第一行上沿，其余画在第 index-1 行的下沿）。
      const first = rects[0];
      setDropLine({
        y: index === 0 ? first.top : rects[index - 1].bottom,
        left: first.left,
        width: first.width,
      });
    };
    const onUp = () => {
      const index = dropIndexRef.current;
      // 🔴 **落点是从「还带着被拖那一行」的列表里量出来的** ⇒ 往下拖时下标要多减一
      //（先抽走它，后面的行整体前移一位）。差这一下的表现是「拖到两行之间，结果插到了下一行后面」。
      if (index !== null) {
        const to = index > drag.from ? index - 1 : index;
        if (to !== drag.from) editor.reorderQuestion(drag.id, to);
      }
      dropIndexRef.current = null;
      setDrag(null);
      setDropLine(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // ⚠️ `pointercancel` 也要收尾（系统手势抢走指针时）：不然线会**永远留在屏幕上**。
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, editor]);

  const requestRemove = useCallback(async (node: WorksheetQuestionNode, heading: string) => {
    // 🔴 任务是**一整块**，而它的删除按钮就在任务头行上 —— 与小题的删除按钮只隔几十像素。
    // 说成「确定删除第 1 题吗？」的后果是：教师以为在删一道题，实际删掉了整个任务
    // （在那之前更糟：迁移之后顶层往往只有一个任务，删它 = **清空整份学习单**）。
    const isTask = node.type === TASK_TYPE;
    const count = node.children.length;
    const lines = [
      isTask
        ? (count > 0 ? `确定删除这个任务吗？它里面的 ${count} 道小题会一起删掉。` : '确定删除这个任务吗？')
        : `确定删除第 ${heading} 题吗？`,
    ];
    if (!editor.worksheetId) {
      lines.push(isTask ? '这个任务还没保存过，删掉之后本机草稿里也不会再有它。' : '这道题还没保存过，删掉之后本机草稿里也不会再有它。');
    } else {
      const usageNow = await editor.ensureUsage();
      if (usageNow === null) {
        lines.push(isTask ? '这次没能读到作答情况，无法确认这个任务里有没有学生答过的题。' : '这次没能读到作答情况，无法确认这道题是否已经被学生作答过。');
      } else if (usageNow.responseCount > 0) {
        lines.push(`这份学习单已经收到 ${usageNow.responseCount} 份作答；删除后，学生${isTask ? '在这个任务里' : `在第 ${heading} 题上`}写下的答案会在看板与导出里变成孤立数据。`);
      } else {
        lines.push('这份学习单还没有收到过作答，删掉不影响任何学生。');
      }
    }
    lines.push('（删错了可以用「撤销」找回来。）');
    if (!window.confirm(lines.join('\n'))) return;
    editor.removeQuestion(node.id);
  }, [editor]);

  if (editor.loading) {
    return <TeacherLoadingState label="正在加载学习单…" />;
  }

  if (editor.loadError) {
    return (
      <TeacherEmptyState
        icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
        title="这份学习单没有加载出来"
        description={`${editor.loadError}。它本身没有丢，稍后重试即可（返回列表前请先回来重试，否则会看到一份空白的编辑器）。`}
        action={<button className="btn btn-secondary" onClick={editor.retryLoad}>重试</button>}
      />
    );
  }

  /**
   * 顶栏那句「被使用时警告」（规格 §6.4）。数字全部来自 `/usage`，
   * 前端不重新拼「是否在用」这个判据（`used` 已经由服务端算好）。
   */
  const usageHead = usage && usage.used
    ? [
      usage.classroomCount > 0 ? `本单正在被 ${usage.classroomCount} 堂课使用` : null,
      usage.responseCount > 0 ? `已收到 ${usage.responseCount} 份作答` : null,
    ].filter((part): part is string => part !== null).join(' · ') || '本单正在被使用'
    : null;

  const activeQuestion = activeBlock?.questions.find(row => row.node.id === openId) ?? null;
  const renderQuestionCard = (row: EditorBlock['questions'][number]) => (
    <QuestionCard
      key={row.node.id}
      heading={row.heading}
      index={row.index}
      total={row.total}
      expanded
      focusedMode
      onToggle={() => selectQuestion(row.node.id, row.taskId)}
      inTask={row.taskId !== null}
      taskId={row.taskId}
      onDragStart={event => startDrag(event, row.node.id, row.taskId ?? '', row.index)}
      node={row.node}
      inheritedPoints={inheritedPoints}
      // ★ 2026-09-26：逐题分值的量词跟着学习单的奖励档走（星星「颗」/ 花朵「朵」/ 分数「分」）。
      pointsUnit={pointsUnitLabel(editor.settings.rewardStyle)}
      rejectedPointInput={editor.rejectedPoints[row.node.id]}
      onPromptChange={(prompt, data) => editor.updatePrompt(row.node.id, prompt, data)}
      onDataChange={patch => editor.updateData(row.node.id, patch)}
      onPointsInputChange={input => editor.setPointsInput(row.node.id, input)}
      onPointsChange={points => editor.updatePoints(row.node.id, points)}
      onInputModeChange={inputMode => editor.updateInputMode(row.node.id, inputMode)}
      onAutoGradeChange={autoGrade => editor.updateAutoGrade(row.node.id, autoGrade)}
      onToleranceChange={tolerance => editor.updateTolerance(row.node.id, tolerance)}
      onMove={delta => editor.moveQuestion(row.node.id, delta)}
      onRemove={() => void requestRemove(row.node, row.heading)}
    />
  );

  return (
    <div className="worksheet-editor">
      <div className="worksheet-editor-topbar">
        <button type="button" className="worksheet-editor-back" onClick={editor.goBack} aria-label="返回学习单列表">←</button>
        <div className="worksheet-editor-heading">
          <span className="worksheet-editor-breadcrumb">学习单 / 编辑</span>
          <input
            className="worksheet-editor-title"
            value={editor.title}
            onChange={event => editor.setTitle(event.target.value)}
            maxLength={200}
            placeholder="未命名学习单"
            aria-label="学习单标题"
          />
        </div>
        <div className="worksheet-editor-meta">
          <span className="worksheet-editor-totals" title="这份学习单的题目数与满分">
            {blocks.filter(block => block.task).length} 个任务 · {totals.questions} 题 · 满分 {totals.maxScore}
          </span>
          <span className={`worksheet-editor-status${editor.dirty ? ' is-dirty' : ''}${saveStatus.kind === 'error' ? ' is-error' : ''}`}>
            {describeSaveStatus(saveStatus, editor.dirty, Boolean(worksheetId))}
          </span>
        </div>

        {/*
          ★ 2026-09-27（教师裁定）：顶栏只剩「设置 / 预览 / 保存」三个按钮。
          删掉的两样，各有各的理由：
          · **撤销 / 重做按钮** —— 快捷键（⌘Z / ⇧⌘Z / ⌘Y）照旧可用，见 `use-worksheet-editor.ts`
            的那个 effect。⚠️ 那两颗按钮原本是**给不知道快捷键的教师**的唯一入口，删掉之后
            本页就没有可见的撤销了 —— 这是明知的取舍，教师当天明确要求去掉。
          · **「复制一份」** —— 学习单列表页每张卡片上都有（`worksheet-card.tsx`），
            同一个动作不必两处都有。
          ⚠️ 「保存」**留着**：它存的是**整张学习单**（标题 + 题目 + 设置 + 备注）。
            设置弹窗里那个「保存设置」只存设置那一半 —— 两者的分工写在 `saveSettings` 的注释里。
        */}
        <div className="worksheet-editor-topbar-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>设置</button>
          <button type="button" className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>预览</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void editor.save()}
            disabled={saveStatus.kind === 'saving'}
            title="保存整张学习单（标题、题目、设置、备注）"
          >
            {saveStatus.kind === 'saving' ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {usageHead && (
        <div className="worksheet-editor-banner is-warning" role="status">
          ⚠ {usageHead} · 学生需刷新或重新进入学习单才能看到新内容
        </div>
      )}

      {draftFound && (
        <DraftBanner
          draft={draftFound.draft}
          onAccept={editor.acceptDraft}
          onDiscard={editor.discardDraft}
        />
      )}

      {saveStatus.kind === 'error' && saveStatus.message && (
        <div className="worksheet-editor-banner is-danger" role="alert">
          <strong>保存失败：</strong>{saveStatus.message}
          <div className="worksheet-editor-banner-note">
            {/* ⚠️ 这里原来写的是「再按一次保存即可」—— 现在**两个按钮**都会写这个状态
                （顶栏的「保存」与设置弹窗里的「保存设置」），所以不点名哪一个。 */}
            改动都还在，修好上面的问题后再保存一次即可。也可以随时用「预览」看看学生那边会看到什么。
          </div>
        </div>
      )}

      <div className="worksheet-editor-workspace">
        <aside className="worksheet-editor-outline" aria-label="学习单结构">
          <div className="worksheet-editor-outline-head">
            <div>
              <h2>学习单结构</h2>
              <p>选择一道题开始编辑</p>
            </div>
            <span>{totals.questions} 题</span>
          </div>

          <div className="worksheet-editor-outline-list">
            {blocks.map((block, blockIndex) => {
              if (!block.task) {
                return block.questions.map(row => (
                  <div
                    className={`worksheet-editor-outline-question${openId === row.node.id ? ' is-active' : ''}`}
                    key={row.node.id}
                    data-outline-layer=""
                  >
                    <button type="button" onClick={() => selectQuestion(row.node.id, null)}>
                      <span className="worksheet-editor-outline-number">{row.heading}</span>
                      <span className="worksheet-editor-outline-question-copy">
                        <strong><span className="worksheet-editor-type-glyph">{questionTypeIcon(row.node.type)}</span>{row.node.type === 'single-choice' || row.node.type === 'multi-choice' ? '选择题' : row.node.type === 'fill-blank' || row.node.type === 'choice-blank' ? '填空题' : QUESTION_TYPE_OPTIONS.find(option => option.value === row.node.type)?.label ?? row.node.type}</strong>
                        <em>{row.node.prompt.trim() || '未填写题干'}</em>
                      </span>
                    </button>
                  </div>
                ));
              }

              const task = block.task;
              const taskTotals = scoreSummary(task.node.children, inheritedPoints);
              const taskActive = activeTaskId === task.node.id;
              return (
                <section
                  className={`worksheet-editor-outline-task${taskActive ? ' is-active' : ''}`}
                  key={task.node.id}
                  data-outline-layer=""
                >
                  <div className="worksheet-editor-outline-task-head">
                    <button
                      type="button"
                      className="worksheet-editor-outline-task-select"
                      onClick={() => selectTask(block)}
                    >
                      <span className="worksheet-editor-outline-chevron">⌄</span>
                      <span>
                        <strong>{task.node.prompt.trim() || `任务 ${blockIndex + 1}`}</strong>
                        <em>{taskTotals.questions} 题 · 满分 {taskTotals.maxScore}</em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="worksheet-editor-drag-handle"
                      onPointerDown={event => startDrag(event, task.node.id, '', task.index)}
                      aria-label={`拖动任务 ${task.index + 1} 调整顺序`}
                      title="拖动调整任务顺序"
                    >⠿</button>
                  </div>

                  <div className="worksheet-editor-outline-questions">
                    {block.questions.map(row => (
                      <div
                        className={`worksheet-editor-outline-question${openId === row.node.id ? ' is-active' : ''}`}
                        key={row.node.id}
                        data-outline-layer={task.node.id}
                      >
                        <button type="button" onClick={() => selectQuestion(row.node.id, task.node.id)}>
                          <span className="worksheet-editor-outline-number">{row.index + 1}</span>
                          <span className="worksheet-editor-outline-question-copy">
                            <strong><span className="worksheet-editor-type-glyph">{questionTypeIcon(row.node.type)}</span>{row.node.type === 'single-choice' || row.node.type === 'multi-choice' ? '选择题' : row.node.type === 'fill-blank' || row.node.type === 'choice-blank' ? '填空题' : QUESTION_TYPE_OPTIONS.find(option => option.value === row.node.type)?.label ?? row.node.type}</strong>
                            <em>{row.node.prompt.trim() || '未填写题干'}</em>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="worksheet-editor-outline-drag"
                          onPointerDown={event => startDrag(event, row.node.id, task.node.id, row.index)}
                          aria-label={`拖动第 ${row.index + 1} 题调整顺序`}
                          title="拖动调整题目顺序"
                        >⠿</button>
                      </div>
                    ))}
                  </div>

                  <button type="button" className="worksheet-editor-outline-add-question" onClick={() => setPickerFor({ parentId: task.node.id })}>
                    ＋ 添加题目
                  </button>
                </section>
              );
            })}
          </div>

          <button type="button" className="worksheet-editor-add" onClick={() => editor.addTask()}>
            ＋ 添加任务
          </button>
        </aside>

        <main className="worksheet-editor-canvas">
          {blocks.length === 0 ? (
            <div className="worksheet-editor-canvas-empty">
              <span>01</span>
              <h2>先创建第一个任务</h2>
              <p>任务用于组织一组相关题目，学生会按任务顺序完成学习单。</p>
              <button type="button" className="btn btn-primary" onClick={() => editor.addTask()}>添加任务</button>
            </div>
          ) : activeBlock?.task ? (
            <>
              <div className="worksheet-editor-canvas-head">
                <div>
                  <span>任务 {activeBlock.task.index + 1}</span>
                  <h2>{activeQuestion ? '编辑题目' : '编辑任务'}</h2>
                </div>
                {activeQuestion && <span>第 {activeQuestion.index + 1} 题 / 共 {activeQuestion.total} 题</span>}
              </div>
              <TaskCard
                index={activeBlock.task.index}
                total={activeBlock.task.total}
                node={activeBlock.task.node}
                onTitleChange={prompt => editor.updatePrompt(activeBlock.task!.node.id, prompt)}
                onDescriptionChange={description => editor.updateData(activeBlock.task!.node.id, { description })}
                onMove={delta => editor.moveQuestion(activeBlock.task!.node.id, delta)}
                onRemove={() => void requestRemove(activeBlock.task!.node, '')}
                onDragStart={event => startDrag(event, activeBlock.task!.node.id, '', activeBlock.task!.index)}
                onAddQuestion={() => setPickerFor({ parentId: activeBlock.task!.node.id })}
                inheritedPoints={inheritedPoints}
              >
                {activeQuestion ? renderQuestionCard(activeQuestion) : null}
              </TaskCard>
            </>
          ) : activeQuestion ? (
            <>
              <div className="worksheet-editor-canvas-head">
                <div><span>独立题目</span><h2>编辑题目</h2></div>
              </div>
              {renderQuestionCard(activeQuestion)}
            </>
          ) : (
            <div className="worksheet-editor-canvas-empty">
              <h2>选择一道题开始编辑</h2>
              <p>从左侧结构中选择任务或题目。</p>
            </div>
          )}
        </main>
      </div>

      {/* ★ 2026-09-26（spec 第 5 步）：**落点那条线**（不是整块高亮 —— 高亮会盖住行本身，
          而教师要看的是「插到哪两行之间」）。`position: fixed` + 指针量出来的坐标。 */}
      {drag && dropLine && (
        <div
          className="worksheet-editor-drop-line"
          style={{ top: dropLine.y, left: dropLine.left, width: dropLine.width }}
        />
      )}

      {pickerFor && (
        <AddQuestionPicker
          onPick={questionType => {
            pendingNewQuestionIds.current = new Set(blocks.flatMap(block => block.questions.map(row => row.node.id)));
            editor.addQuestion(questionType, pickerFor.parentId);
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          description={editor.description}
          onDescriptionChange={editor.setDescription}
          settings={editor.settings}
          onSettingsChange={editor.updateSettings}
          onClose={() => setSettingsOpen(false)}
          // ★ 2026-09-27（教师裁定）：「要有真正的保存功能」。
          // 返回 `null` = 存上了 ⇒ 由这一层关窗；返回字符串 = 失败原因 ⇒ 留在窗里给教师看。
          onSave={async () => {
            const result = await editor.saveSettings();
            if (result.ok) { setSettingsOpen(false); return null; }
            return result.message;
          }}
          hasId={Boolean(worksheetId)}
        />
      )}

      {previewOpen && (
        <WorksheetPreviewModal
          title={editor.title}
          content={content}
          settings={editor.settings}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

/**
 * 「发现未保存的草稿」（规格 §6.4）。草稿**只在本机**（`localStorage`），
 * 所以这里必须说清「本机」与「那一刻」，教师才能判断它值不值得恢复。
 */
function DraftBanner({ draft, onAccept, onDiscard }: {
  draft: WorksheetDraft;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="worksheet-editor-banner is-info" role="status">
      <div>
        发现未保存的草稿（本机、{formatClock(draft.savedAt)} 存入，{draft.content.nodes.length} 题）。它是上一次在这台电脑上编辑、但没保存成功的内容。
      </div>
      <div className="worksheet-editor-banner-actions">
        <button type="button" className="btn btn-primary" onClick={onAccept}>恢复</button>
        <button type="button" className="btn btn-secondary" onClick={onDiscard}>丢弃</button>
      </div>
    </div>
  );
}

/** 题型选择（规格 §6.2：「加题 = 点底部『＋ 添加题目』，弹出题型选择后追加到末尾」）。 */
function AddQuestionPicker({ onPick, onClose }: {
  onPick: (questionType: QuestionType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="worksheet-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-add-question-title" style={{ width: 560 }}>
        <h3 id="worksheet-add-question-title">添加题目</h3>
        {/* ★ 2026-09-25：这句话原来写的是「题目会加到这份学习单的最后」—— 现在**加到
            你点的那个任务里**（`pickerFor.parentId`），▲▼ 也只在**同层内**换位。
            一句说错的帮助文字比没有更糟：教师会按它去找一个不存在的行为。 */}
        <p className="worksheet-editor-dialog-note">选择一种作答方式。添加后可从左侧抓住拖动把手调整顺序。</p>
        <div className="worksheet-editor-type-list">
          {QUESTION_TYPE_OPTIONS.filter(option => option.value !== 'choice-blank' && option.value !== 'multi-choice').map(option => (
            <button key={option.value} type="button" className="worksheet-editor-type-option" onClick={() => onPick(option.value)}>
              <span className="worksheet-editor-type-option-icon">{questionTypeIcon(option.value)}</span>
              <span className="worksheet-editor-type-option-copy">
                <span className="worksheet-editor-type-option-label">{option.value === 'single-choice' ? '选择题' : option.label}</span>
                <span className="worksheet-editor-type-option-hint">{option.value === 'single-choice' ? '可在题内设置为单选或多选' : option.value === 'fill-blank' ? '每个空可设置手工填写、右侧选词或下方选词' : option.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-lg" style={{ width: '100%' }} onClick={onClose}>取消</button>
      </div>
    </>
  );
}

/**
 * 「设置」面板（规格 §6.3）。装的是**这一张单**的设置：
 *   · 描述（标题在顶栏直接编 —— 它改得最勤）
 *   · 自动判分（学习单级开关，规格 §3-L）
 *   · 提交后可否修改（`allowResubmit`，规格 §8.4）
 *   · 奖励形式 + **两档**步长（规格 §9.2 与 §12 裁定 3 —— 2026-09-23 用户裁定：奖励是
 *     **学习单级**的，不做全局设置。「这堂课用得分制还是发小花」是这一张单的事。
 *     两档是 M4a 的「全对给几 / 部分给分给几」，它们同时是**逐题留空的题的默认值**，
 *     所以下面那两行必须说清这层关系 —— 见那一段注释）
 * 输入方式**不做 UI**（规格 §3-V，第一批恒为 keyboard），`settings.defaultInputMode`
 * 只是原样带着走，不在这里改。
 *
 * 每一项都写明了**关掉 / 改了之后会怎样**，因为它们的后果都不在教师眼前：
 * 一个让看板失去正确率，一个会让学生的修改请求被服务端拒绝，而奖励形式教师自己
 * **根本看不到**（规格 §3-U：教师端只有对错与正确率，一个星星都不出现）——
 * 所以那一行必须说清「这是给学生看的」。
 */
function SettingsModal({ description, onDescriptionChange, settings, onSettingsChange, onClose, onSave, hasId }: {
  description: string;
  onDescriptionChange: (value: string) => void;
  settings: WorksheetSettings;
  onSettingsChange: (patch: Partial<WorksheetSettings>) => void;
  onClose: () => void;
  /**
   * 点「保存设置」。`null` = 存上了（**关窗由调用方决定**）；字符串 = 失败原因。
   *
   * ⚠️ 失败原因**留在窗里**、不外抛：走「整份创建」那条路时它可能是
   * 「第 2 题：题干不能为空」—— 一句与设置无关、但教师必须看见的话。
   * 把它丢给页面顶上那条横幅，教师在这个弹窗里就什么也看不到（他刚点的按钮只闪了一下）。
   */
  onSave: () => Promise<string | null>;
  /** 这份学习单在服务端有没有行。没有 ⇒ 「保存设置」会连同整份一起创建（见 `saveSettings`）。 */
  hasId: boolean;
}) {
  /**
   * ★ 2026-09-27：这一层自己的两个瞬时状态。
   *
   * ⚠️ 弹窗里的每一格改动**仍然是即时写进编辑器状态的**（`onSettingsChange` 直通 hook），
   * 所以「点了保存 ×」不是「丢弃」—— 那些改动还在屏幕上，顶栏的「保存」照样会把它们存进去。
   * 把改动改成弹窗内的本地副本会让「关掉就走」变成一次静默丢弃，那比现在更危险。
   */
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    const message = await onSave();
    setSaving(false);
    if (message) setSaveError(message);
  };

  // 每个形式的符号与量词都从那一份取值域里取（规格 §9.2：星星/花朵论「个/朵」、
  // 分数论「分」、对错没有步长）。这里**不写**任何一档的字面量。
  const currentStyle = REWARD_STYLE_OPTIONS.find(option => option.value === settings.rewardStyle)
    ?? REWARD_STYLE_OPTIONS[0];

  // ★ M7b：分析型智能体的候选。**在模态挂载时按需取**（`{settingsOpen && <SettingsModal/>}`
  // ⇒ 挂载 = 打开）—— 这个列表只有打开设置才用得上，跟着页面一起取是白取。
  // ⚠️ 取失败**不阻断**：下拉退回只剩「（不指定）」那一项，教师仍能编辑别的设置。
  // 与「学习单列表加载失败不阻断创建」那条既有判断同形（`classroom/new/page.tsx`）。
  const [analysisAgents, setAnalysisAgents] = useState<AgentSummary[]>([]);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  useEffect(() => {
    let alive = true;
    api.getAgents('analysis')
      .then(list => { if (alive) setAnalysisAgents(list); })
      .catch(() => { if (alive) setAnalysisAgents([]); });
    return () => { alive = false; };
  }, []);

  const uploadBackground = async (file: File | undefined) => {
    if (!file) return;
    setBackgroundError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setBackgroundError('请选择 JPEG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setBackgroundError('图片不能超过 5 MB，建议先压缩到 300 KB 以内。');
      return;
    }
    setBackgroundUploading(true);
    try {
      const result = await api.uploadWorksheetImage(file);
      onSettingsChange({ backgroundTheme: 'custom', backgroundImageUrl: result.url });
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : '背景图上传失败，请稍后重试。');
    } finally {
      setBackgroundUploading(false);
    }
  };

  return (
    <>
      {/* ⚠️ 保存中不许点遮罩关窗：那一次请求的结果（成功/失败原因）会落在一个已经不存在的
          弹窗上，教师什么也看不到 —— 而顶栏那句状态他没在看。 */}
      <div className="modal-overlay" onClick={saving ? undefined : onClose} />
      <div className="worksheet-editor-dialog worksheet-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-settings-title">
        <div className="worksheet-settings-head">
          <div>
            <h3 id="worksheet-settings-title">学习单设置</h3>
            <p>设置整份学习单的作答规则与学生奖励。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭学习单设置">×</button>
        </div>

        <div className="worksheet-settings-body">
          <section className="worksheet-settings-section">
            <div className="worksheet-settings-section-head"><div><strong>学生端主题背景</strong><em>让学习单更像一本互动练习册，背景不会影响题目内容。</em></div></div>
            <div className="worksheet-background-grid" role="radiogroup" aria-label="学习单主题背景">
              {WORKSHEET_BACKGROUND_OPTIONS.map(option => (
                <label
                  key={option.id}
                  className={`worksheet-background-option${settings.backgroundTheme === option.id ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="worksheet-background-theme"
                    checked={settings.backgroundTheme === option.id}
                    onChange={() => onSettingsChange({ backgroundTheme: option.id })}
                  />
                  <span
                    className="worksheet-background-preview"
                    style={{ backgroundColor: option.swatch, backgroundImage: option.url ? `url(${option.url})` : undefined }}
                    aria-hidden="true"
                  />
                  <span className="worksheet-background-copy"><strong>{option.name}</strong><em>{option.description}</em></span>
                  <span className="worksheet-background-check" aria-hidden="true">✓</span>
                </label>
              ))}

              <label className={`worksheet-background-option worksheet-background-upload${settings.backgroundTheme === 'custom' ? ' is-selected' : ''}`}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={backgroundUploading}
                  onChange={event => { void uploadBackground(event.target.files?.[0]); event.target.value = ''; }}
                />
                <span
                  className="worksheet-background-preview"
                  style={settings.backgroundImageUrl ? { backgroundImage: `url(${worksheetAssetUrl(settings.backgroundImageUrl)})` } : undefined}
                  aria-hidden="true"
                >{!settings.backgroundImageUrl && <span>＋</span>}</span>
                <span className="worksheet-background-copy"><strong>{backgroundUploading ? '正在上传…' : '我的背景'}</strong><em>{settings.backgroundImageUrl ? '点击替换图片' : '上传自制图片'}</em></span>
                <span className="worksheet-background-check" aria-hidden="true">✓</span>
              </label>
            </div>
            {backgroundError && <p className="worksheet-background-error" role="alert">{backgroundError}</p>}
            <details className="worksheet-background-guide">
              <summary>教师自制背景图要求</summary>
              <ul>
                <li>横向 3:2，推荐 1536 × 1024 像素。</li>
                <li>中央约 70% 留空，装饰放在四周 12%-15% 范围内。</li>
                <li>使用浅色、低对比背景，不放文字、校徽或密集纹理。</li>
                <li>优先 WebP，建议不超过 300 KB，最大上传 5 MB。</li>
              </ul>
            </details>
          </section>

          <section className="worksheet-settings-section">
            <div className="worksheet-settings-section-head"><div><strong>教师备注</strong><em>仅教师可见，不会出现在学生端。</em></div></div>
            <label className="worksheet-editor-field">
              <span>使用说明</span>
              <textarea
                className="input"
                rows={3}
                value={description}
                maxLength={2000}
                onChange={event => onDescriptionChange(event.target.value)}
                placeholder="例如：第 3 课课堂练习，完成后一起讲评。"
              />
            </label>
          </section>

          <section className="worksheet-settings-section">
            <div className="worksheet-settings-section-head"><div><strong>作答规则</strong><em>决定学生提交后的行为和看板数据。</em></div></div>
            <fieldset className="worksheet-answer-mode">
              <legend>题目开放方式</legend>
              <div className="worksheet-answer-mode-options">
                {[
                  { value: 'open', title: '开放式', note: '打开即可看到全部题目，可以自由选择作答顺序。' },
                  { value: 'task-step', title: '按任务分步', note: '完成当前任务后，才显示下一个任务。' },
                  { value: 'question-step', title: '按小题分步', note: '完成当前小题后，才显示下一小题。' },
                ].map(option => (
                  <label key={option.value} className={settings.answerMode === option.value ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="worksheet-answer-mode"
                      checked={settings.answerMode === option.value}
                      onChange={() => onSettingsChange({ answerMode: option.value as WorksheetSettings['answerMode'] })}
                    />
                    <span><strong>{option.title}</strong><em>{option.note}</em></span>
                  </label>
                ))}
              </div>
              <p>分步模式只提示“后面还有内容”，不会提前显示后续任务名称和题目。</p>
            </fieldset>
            <label className="worksheet-settings-switch">
              <span className="worksheet-settings-switch-icon" aria-hidden="true">✓</span>
              <span className="worksheet-settings-switch-copy">
                <strong>自动判分</strong>
                <em>{settings.autoGrade ? '已开启：看板显示对错与正确率。' : '已关闭：只统计作答进度，不显示正确率。'}</em>
              </span>
              <span className="worksheet-editor-autograde-control">
                <input type="checkbox" checked={settings.autoGrade} onChange={event => onSettingsChange({ autoGrade: event.target.checked })} aria-label="自动判分" />
                <span aria-hidden="true" />
              </span>
            </label>

            <label className="worksheet-settings-switch">
              <span className="worksheet-settings-switch-icon" aria-hidden="true">↻</span>
              <span className="worksheet-settings-switch-copy">
                <strong>提交后可以修改</strong>
                <em>{settings.allowResubmit ? '已开启：学生可修改并重新提交。' : '已关闭：提交后即定稿，不能再修改。'}</em>
              </span>
              <span className="worksheet-editor-autograde-control">
                <input type="checkbox" checked={settings.allowResubmit} onChange={event => onSettingsChange({ allowResubmit: event.target.checked })} aria-label="提交后可以修改" />
                <span aria-hidden="true" />
              </span>
            </label>
          </section>

        {/* ★ M7b：分析型智能体（学习单级 —— 用户 2026-09-25 裁定 4）。
            🔴 候选只列 `purpose === 'analysis'` 的，而且**由服务端过滤**（`?purpose=analysis`）。
            🔴 **默认是「不指定」**：默认指定一个等于「默认把全班作业发给第三方 AI」。
            🔴 平台提示必须**在配的时候就**看到 —— 否则教师会在用的那一刻才发现绘图题发不出去。 */}
          <section className="worksheet-settings-section">
            <div className="worksheet-settings-section-head"><div><strong>课堂分析</strong><em>可选。用于看板中的“发给 AI 分析”。</em></div></div>
            <label className="worksheet-editor-field">
              <span>分析型智能体</span>
              <select
                className="input"
                value={settings.analysisAgentId ?? ''}
                onChange={event => onSettingsChange({ analysisAgentId: event.target.value || null })}
              >
                <option value="">不指定（分析按钮不可用）</option>
                {analysisAgents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.name}（{agent.platform}）</option>
                ))}
              </select>
              <em className="worksheet-settings-help">没有候选时，可去“智能体管理”新建并将用途设为“分析”。当前仅支持 Coze，绘图题也需要通过 Coze 分析。</em>
            </label>
          </section>

        {/* 奖励形式（规格 §9.2）。🔴 它是**这一张单**的配置，不是全局设置 ——
            用户 2026-09-23 的裁定：「教师在编辑学习单时可以选择得分制还是奖励小花、五角星」。
            放在「自动判分」下面也是刻意的：关掉自动判分就没有判分，也就没有奖励
            （规格 §9.3），两行挨着才看得出这层依赖。 */}
        {/* `fieldset` + `legend` 而不是「一段标签 + 一排按钮」：这是一组单选，读屏要能
            念出「奖励形式」这个组名。每个选项都是 `label`，所以点文字或图标都能选中。 */}
          <section className="worksheet-settings-section">
            <div className="worksheet-settings-section-head"><div><strong>学生奖励</strong><em>只改变学生端的呈现，不影响教师看板统计。</em></div></div>
            <fieldset className="worksheet-editor-reward">
              <legend className="worksheet-editor-reward-legend">奖励形式</legend>
              <div className="worksheet-editor-reward-options">
                {REWARD_STYLE_OPTIONS.map(option => (
                  <label key={option.value} className={`worksheet-editor-reward-option${settings.rewardStyle === option.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="worksheet-reward-style"
                      checked={settings.rewardStyle === option.value}
                      onChange={() => onSettingsChange({ rewardStyle: option.value })}
                    />
                    <span className="worksheet-editor-reward-glyph" aria-hidden="true">
                      <RewardIcon kind={option.value} state={settings.rewardStyle === option.value ? 'earned' : 'empty'} size={56} />
                    </span>
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <em className="worksheet-editor-switch-note">{currentStyle.hint}</em>
            </fieldset>

            <p className="worksheet-settings-notice">
              奖励显示在学生每道题旁和顶部累计处。关闭自动判分后不发奖励；问答、绘图等主观题也不自动发放。
            </p>
          </section>

        {/*
          ★ 2026-09-26（教师裁定）：「学习单设置里的默认给分就不要了，**已经在每小题中设置了**。」
          这里原来有两行下拉（每答对一题得几个 / 每答对一部分得几个），它们是逐题的**回落值**。
          ⇒ 已由 `worksheet-points-migration` 把每一道空着的题**钉住**，判分不再读它们
          （`routes/worksheets.ts` 的 `resolvePoints(node, DEFAULT_POINTS)`）。
          ⚠️ **不要顺手把 `settings` 里的那两个键也删掉**：老行的 JSON 里还带着它们，
          删类型会让读旧行出错；它们只是**不再被读**。
          ⚠️ 上面那块「奖励形式」（星星 / 花朵 / 奖杯 / 小熊 / 分数）**留着** —— 那是**呈现形式**。
        */}

        </div>
        {/*
          ★ 2026-09-27（教师裁定）：「完成设置」→「保存设置」，并且**真的存**。
          ⚠️ 底下那行说明必须与两个按钮的分工逐字一致 —— 它原来写的是
          「修改会暂存，点击顶栏"保存"后生效。」，而顶栏那个「保存」存的是整张学习单；
          不写清「这个按钮只存设置」的话，教师改完题目再点它，会以为题目也存了。
        */}
        {saveError && (
          <p className="worksheet-settings-error" role="alert">设置没有存上：{saveError}</p>
        )}
        <div className="worksheet-settings-footer">
          <span>
            {hasId
              ? '这一页的设置由「保存设置」提交；题目与标题的改动仍由顶栏「保存」提交。'
              : '这份学习单还没保存过，点「保存设置」会连同题目一起创建。'}
          </span>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </>
  );
}
